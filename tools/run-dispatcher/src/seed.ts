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
import type { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js'

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

  await send(options.connection, options.buyer, [
    await requestRunIx(options.program, {
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
    }),
  ])

  return {
    run: runAddress(options.buyer.publicKey, options.nonce, options.program.programId).address,
    nonce: options.nonce,
    reportSecretKey: reportKey.secretKey,
    reportPublicKey: reportKey.publicKey,
    elapsedMs: Date.now() - started,
  }
}

async function send(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message()

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
