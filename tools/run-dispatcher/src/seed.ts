/**
 * Пул датасетів і замовлення прогону на локальному стенді (`T030`).
 *
 * Це те, що в продукті роблять три різні сторони через три різні екрани:
 * власник реєструє датасет і дає згоду, браузер шифрує записи, покупець
 * замовляє прогін. Тут вони зведені в один файл, бо стенд щоразу починає з
 * порожнього ланцюга — але **інструкції беруться ті самі**, з `packages/sdk`.
 * Другого шляху в ланцюг у сценарію немає й не має бути: сценарій, який
 * реєструє датасет власним кодом, доводить властивості власного коду.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatasetRecord } from '@genovault/crypto'
import { sealDataset } from '@genovault/crypto'
import { deriveReportKey, reportKeyMessage } from '@genovault/crypto/report-key'
import type { GenoVaultProgram, RunPoolEntry } from '@genovault/sdk'
import {
  datasetAddress,
  registerDatasetIx,
  requestRunIx,
  runAddress,
  setConsentIx,
  TOKEN_2022_PROGRAM_ID,
} from '@genovault/sdk'
import type { FrequenciesParams } from '@genovault/shared'
import { encodeFrequenciesParams, FREQUENCIES_RECIPE_ID } from '@genovault/shared'
import { ed25519 } from '@noble/curves/ed25519'
import type {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  AddressLookupTableProgram,
  PACKET_DATA_SIZE,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'

export class SeedError extends Error {
  override readonly name = 'SeedError'
}

export interface DatasetPlan {
  /** Ідентифікатор у seeds датасету — до 32 символів. */
  id: string
  owner: Keypair
  records: DatasetRecord[]
  /** Ціна за 1000 записів у базових одиницях розрахункового токена. */
  pricePer1k: bigint
  allowedUses: number
  forbiddenUses: number
  buyerCategories: number
  /** Секунди Unix; `null` — згода без строку. */
  expiresAt: bigint | null
}

export interface SeededDataset {
  id: string
  owner: PublicKey
  address: PublicKey
  consentVersion: number
  recordCount: number
  contentHash: string
  /** Куди ліг конверт — звідти його читає драйвер і звіряч. */
  envelopePath: string
}

export interface SeedOptions {
  connection: Connection
  program: GenoVaultProgram
  /** Публічний ключ MXE-кластера: на нього шифрується кожен датасет. */
  mxePublicKey: Uint8Array
  /** Тека під конверти. Одне джерело для драйвера й для звіряча. */
  storageDir: string
  plans: readonly DatasetPlan[]
  onProgress?(id: string, note: string): void
}

/**
 * Реєструє пул датасетів: шифрування, конверт на диск, `Dataset`, `Consent`.
 *
 * Шифрування коштує ~1,2 мс на польовий елемент, тобто датасет на 64 записи —
 * це ~5 секунд однопотокового CPU. Число тут не помилка й не привід
 * оптимізувати: воно й є та причина, з якої браузер шифрує у Web Worker із
 * прогресом, а не за спінером.
 */
export async function seedDatasets(options: SeedOptions): Promise<SeededDataset[]> {
  await mkdir(options.storageDir, { recursive: true })
  const seeded: SeededDataset[] = []

  for (const plan of options.plans) {
    const sealed = await sealDataset(plan.records, options.mxePublicKey)
    options.onProgress?.(plan.id, `зашифровано ${sealed.recordCount} записів`)

    const address = datasetAddress(plan.owner.publicKey, plan.id, options.program.programId).address
    const envelopePath = join(options.storageDir, `${address.toBase58()}.gvds`)
    await writeFile(envelopePath, sealed.bytes)

    await send(options.connection, plan.owner, [
      await registerDatasetIx(options.program, {
        owner: plan.owner.publicKey,
        datasetId: plan.id,
        contentHash: sealed.contentHash,
        recordCountClaimed: sealed.recordCount,
        pricePer1k: plan.pricePer1k,
      }),
      // Згода — окрема інструкція, а не поле реєстрації: власник має право
      // змінити її, не чіпаючи даних, і саме версія згоди їде в прогін.
      await setConsentIx(options.program, {
        owner: plan.owner.publicKey,
        datasetId: plan.id,
        currentVersion: 0,
        allowedUses: plan.allowedUses,
        forbiddenUses: plan.forbiddenUses,
        buyerCategories: plan.buyerCategories,
        expiresAt: plan.expiresAt,
      }),
    ])

    options.onProgress?.(plan.id, `зареєстровано ${address.toBase58()}`)
    seeded.push({
      id: plan.id,
      owner: plan.owner.publicKey,
      address,
      consentVersion: 1,
      recordCount: sealed.recordCount,
      contentHash: sealed.contentHash,
      envelopePath,
    })
  }

  return seeded
}

export interface OrderOptions {
  connection: Connection
  program: GenoVaultProgram
  buyer: Keypair
  mint: PublicKey
  dispatcher: PublicKey
  nonce: bigint
  useType: number
  buyerCategory: number
  maxEscrow: bigint
  params: FrequenciesParams
  datasets: readonly SeededDataset[]
}

export interface OrderedRun {
  run: PublicKey
  nonce: bigint
  /** Приватна половина ключа звіту. Живе рівно до розшифрування. */
  reportSecretKey: Uint8Array
  reportPublicKey: Uint8Array
  /** Скільки мілісекунд зайняло замовлення — від підпису ключа до підтвердження. */
  elapsedMs: number
}

/**
 * Замовляє прогін від імені покупця.
 *
 * Ключ звіту виводиться **з підпису гаманця**, як і в браузері: інакше сценарій
 * міряв би шлях, якого покупець не проходить. Підписує той самий ключ, яким
 * покупець платить, — Ed25519 у Solana детермінований за стандартом (RFC 8032),
 * і на цьому виведення й тримається.
 */
export async function orderRun(options: OrderOptions): Promise<OrderedRun> {
  const started = Date.now()

  const message = new TextEncoder().encode(
    reportKeyMessage(options.buyer.publicKey.toBase58(), options.nonce),
  )
  // `Keypair.secretKey` у web3.js — це 64 байти «зерно + публічний ключ»;
  // Ed25519 підписує зерном, і саме перші 32 байти тут і є ключ.
  const signature = ed25519.sign(message, options.buyer.secretKey.slice(0, 32))
  const reportKey = await deriveReportKey(signature)

  const pool: RunPoolEntry[] = options.datasets.map((dataset) => ({
    owner: dataset.owner,
    datasetId: dataset.id,
    consentVersion: dataset.consentVersion,
  }))

  const request = await requestRunIx(options.program, {
    buyer: options.buyer.publicKey,
    mint: options.mint,
    nonce: options.nonce,
    recipeId: FREQUENCIES_RECIPE_ID,
    useType: options.useType,
    buyerCategory: options.buyerCategory,
    maxEscrow: options.maxEscrow,
    buyerX25519: reportKey.publicKey,
    dispatcher: options.dispatcher,
    recipeParams: encodeFrequenciesParams(options.params),
    datasets: pool,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })

  // An order is one transaction (`T024`), so a pool that does not fit in a
  // packet goes through an address lookup table, not in portions. The table
  // only when it does not fit without one: a small pool stays the same order
  // it was before `T051`.
  const lookupTables = fitsInline(options.buyer.publicKey, [request])
    ? []
    : [
        await lookupTableFor(
          options.connection,
          options.buyer,
          request.keys.filter((key) => !key.isSigner).map((key) => key.pubkey),
        ),
      ]
  await send(options.connection, options.buyer, [request], lookupTables)

  return {
    run: runAddress(options.buyer.publicKey, options.nonce, options.program.programId).address,
    nonce: options.nonce,
    reportSecretKey: reportKey.secretKey,
    reportPublicKey: reportKey.publicKey,
    elapsedMs: Date.now() - started,
  }
}

/** How many addresses one extend transaction puts into the table. */
const LOOKUP_EXTEND_CHUNK = 30

/** Whether a single-signature transaction fits in a packet without a lookup table. */
function fitsInline(payer: PublicKey, instructions: TransactionInstruction[]): boolean {
  const message = new TransactionMessage({
    payerKey: payer,
    // Any 32 bytes: the size does not depend on the hash.
    recentBlockhash: payer.toBase58(),
    instructions,
  }).compileToV0Message()
  try {
    // One signature: 1 byte of list length + 64 bytes of signature.
    return 1 + 64 + message.serialize().length <= PACKET_DATA_SIZE
  } catch (error) {
    // `serialize` writes into a packet-sized buffer and throws on overflow.
    if (error instanceof RangeError) return false
    throw error
  }
}

/**
 * An address lookup table for one order.
 *
 * The buyer creates and pays for it — the same key that signs the order: a
 * table owned by someone else would make the pool in the buyer's transaction
 * depend on an account another party controls. The table's rent stays on the
 * stand.
 */
async function lookupTableFor(
  connection: Connection,
  payer: Keypair,
  addresses: readonly PublicKey[],
): Promise<AddressLookupTableAccount> {
  const unique = addresses.filter(
    (address, index) => addresses.findIndex((other) => other.equals(address)) === index,
  )
  // The creation slot must be in `SlotHashes`, i.e. already rooted.
  const recentSlot = await connection.getSlot('finalized')
  const [create, table] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot,
  })
  await send(connection, payer, [create])
  for (let at = 0; at < unique.length; at += LOOKUP_EXTEND_CHUNK) {
    await send(connection, payer, [
      AddressLookupTableProgram.extendLookupTable({
        authority: payer.publicKey,
        payer: payer.publicKey,
        lookupTable: table,
        addresses: unique.slice(at, at + LOOKUP_EXTEND_CHUNK),
      }),
    ])
  }

  // Wait for the root, not for the next slot. By the rule a table is readable
  // from the next slot, and simulation does see it, but the validator's
  // scheduler resolves addresses against the root bank: measured 2026-10-28 on
  // the bare validator, the first order on a fresh table landed after 12.5 s
  // (about the time to root), the following ones in 0.3–0.5 s on any pool up
  // to 50. With `maxRetries: 3` such an order simply expires.
  const extendedAt = await connection.getSlot('confirmed')
  while ((await connection.getSlot('finalized')) < extendedAt) {
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  const account = (await connection.getAddressLookupTable(table, { commitment: 'confirmed' })).value
  if (account === null || account.state.addresses.length !== unique.length) {
    throw new SeedError(
      `table ${table.toBase58()} holds ${account?.state.addresses.length ?? 0} of ${unique.length} addresses`,
    )
  }
  return account
}

async function send(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  lookupTables: AddressLookupTableAccount[] = [],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(lookupTables)

  const transaction = new VersionedTransaction(message)
  transaction.sign([payer])

  const signature = await connection.sendTransaction(transaction, { maxRetries: 3 })
  const status = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  )
  if (status.value.err !== null) {
    throw new SeedError(`транзакція ${signature} відхилена: ${JSON.stringify(status.value.err)}`)
  }
  return signature
}
