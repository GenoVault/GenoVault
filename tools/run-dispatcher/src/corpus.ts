/**
 * Корпус із десяти прогонів під `SC-001` (`T031`).
 *
 * Пул засівається **один раз**, а прогони йдуть по ньому різними фільтрами:
 * шифрування коштує ~1,2 мс на польовий елемент, і десять разів шифрувати ті
 * самі записи означало б витратити хвилини на те, що нічого не додає. Датасети
 * при цьому справжні: зареєстровані тими самими інструкціями `packages/sdk`,
 * зашифровані тим самим `sealDataset`, покладені в те саме сховище.
 *
 * Одинадцятий прогін — **повнорозмірний**, на пулі з двома датасетами по 64
 * записи. Він тут тому, що прогін `T030` уже не звірити: локальний валідатор
 * тримає ланцюг рівно доки живий, а стенд `T030` зупинено. Відтворити його
 * дешевше, ніж посилатись на ледер, якого немає.
 *
 * Корпус пишеться на диск **після кожного прогону**, а не в кінці. Причина та
 * сама, з якої звіт драйвера з'являється до прогону: одинадцять прогонів — це
 * чверть години, і перерваний корпус має лишатись читабельним.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AnchorProvider } from '@anchor-lang/core'
import { getMXEPublicKey } from '@arcium-hq/client'
import type { DatasetRecord } from '@genovault/crypto'
import type { GenoVaultProgram } from '@genovault/sdk'
import { buyerCategoryBit, useTypeBit } from '@genovault/shared'
import type { Connection, Keypair, PublicKey } from '@solana/web3.js'
import type { ArciumContext } from './arcium.ts'
import type { RunVariant } from './canary.ts'
import { canaryRecords, planRuns } from './canary.ts'
import { drive } from './drive.ts'
import { syntheticRecords } from './scenario.ts'
import type { DatasetPlan, SeededDataset } from './seed.ts'
import { orderRun, seedDatasets } from './seed.ts'

export class CorpusError extends Error {
  override readonly name = 'CorpusError'
}

/**
 * Малий пул: канарка, звичайний датасет і мовчазний.
 *
 * 12 + 10 + 9 — числа не круглі, і кожне обране: канарка має бути вищою за
 * `MIN_CONTRIBUTION`, щоб її внесок узагалі оголошувався; мовчазний датасет —
 * нижчим, щоб придушення внеску пройшло живим; а разом вони мусять давати
 * вікові вікна і під «когорта нижча за поріг», і під «усі мовчать».
 */
export const SMALL_POOL = [12, 10, 9] as const

/** Повнорозмірний пул одинадцятого прогону: канарка, два по 64 і мовчазний. */
export const FULL_POOL = [64, 64] as const

/** Зерно канарки. Стале — інакше впале влучання не було б із чим звіряти. */
const CANARY_SEED = 0x5ca1ab1e

export interface CorpusRunEntry {
  label: string
  run: string
  /** Приватна половина ключа звіту: без неї звіряч не розкладе звіт у числа. */
  reportSecretKey: string
  status: string
  folds: number
  driveMs: number
  /** Скільки записів мало увійти в когорту за відкритими даними пулу. */
  expectedCohort: number
  expectedPerDataset: number[]
}

export interface Corpus {
  rpc: string
  programId: string
  storageDir: string
  buyer: string
  dispatcher: string
  canary: {
    dataset: string
    /** Відкриті записи, які власник знає про себе. Єдине, що звіряч бере на віру. */
    records: DatasetRecord[]
  }
  datasets: { id: string; address: string; recordCount: number }[]
  runs: CorpusRunEntry[]
}

export interface CorpusOptions {
  connection: Connection
  provider: AnchorProvider
  program: GenoVaultProgram
  arcium: ArciumContext
  rpc: string
  /** Власники датасетів: троє на малий пул і ще двоє на повнорозмірний. */
  owners: readonly Keypair[]
  buyer: Keypair
  dispatcher: Keypair
  mint: PublicKey
  storageDir: string
  /** Куди писати корпус — переписується після кожного прогону. */
  out: string
  nonce: bigint
  maxEscrow: bigint
  /** Чи додавати одинадцятий, повнорозмірний прогін. */
  full: boolean
  writeConcurrency?: number
  callbackTimeoutMs?: number
  onProgress?(note: string): void
}

function pick(owners: readonly Keypair[], index: number): Keypair {
  const owner = owners.at(index)
  if (owner === undefined) throw new CorpusError(`немає власника ${index} серед ${owners.length}`)
  return owner
}

/**
 * Засіває пул і проганяє по ньому весь корпус.
 *
 * Згода на кожному датасеті дозволяє рівно той тип використання й рівно ту
 * категорію покупця, які замовляє прогін: ширша згода зробила б корпус
 * набором прогонів, які пройшли б і при зламаній перевірці згоди.
 */
export async function buildCorpus(options: CorpusOptions): Promise<Corpus> {
  const note = (line: string): void => options.onProgress?.(line)

  const mxePublicKey = await getMXEPublicKey(options.provider, options.program.programId)
  if (mxePublicKey === null) {
    throw new CorpusError('MXE ще не має публічного ключа — keygen кластера не завершився')
  }

  const allowedUses = useTypeBit('populationGenetics')
  const buyerCategories = buyerCategoryBit('academic')
  const tag = options.nonce.toString(16)

  const smallRecords: DatasetRecord[][] = [
    canaryRecords(SMALL_POOL[0], CANARY_SEED),
    syntheticRecords(SMALL_POOL[1], 11),
    syntheticRecords(SMALL_POOL[2], 12),
  ]
  const fullRecords: DatasetRecord[][] = options.full
    ? [syntheticRecords(FULL_POOL[0], 13), syntheticRecords(FULL_POOL[1], 14)]
    : []

  const owners = [...smallRecords, ...fullRecords].map((_, index) => pick(options.owners, index))
  const prices = [1_000n, 2_000n, 3_000n, 1_500n, 2_500n]

  const plans: DatasetPlan[] = [...smallRecords, ...fullRecords].map((records, index) => ({
    id: `sc001-${index}-${tag}`.slice(0, 32),
    owner: owners[index] ?? pick(options.owners, index),
    records,
    pricePer1k: prices[index] ?? 1_000n,
    allowedUses,
    forbiddenUses: 0,
    buyerCategories,
    expiresAt: null,
  }))

  note(`шифруємо пул: ${plans.map((plan) => plan.records.length).join(' + ')} записів`)
  const seeded = await seedDatasets({
    connection: options.connection,
    program: options.program,
    mxePublicKey,
    storageDir: options.storageDir,
    plans,
    onProgress: (id, line) => note(`  ${id}: ${line}`),
  })

  const canary = seeded.at(0)
  if (canary === undefined) throw new CorpusError('канарковий датасет не засіявся')

  const smallPool = seeded.slice(0, smallRecords.length)
  const variants = planRuns(smallRecords)
  note(`умов прогонів: ${variants.length}`)
  for (const item of variants) {
    note(
      `  «${item.label}» — когорта ${item.expectedCohort} (${item.expectedPerDataset.join('+')})`,
    )
  }

  const corpus: Corpus = {
    rpc: options.rpc,
    programId: options.program.programId.toBase58(),
    storageDir: options.storageDir,
    buyer: options.buyer.publicKey.toBase58(),
    dispatcher: options.dispatcher.publicKey.toBase58(),
    canary: { dataset: canary.address.toBase58(), records: smallRecords[0] ?? [] },
    datasets: seeded.map((dataset) => ({
      id: dataset.id,
      address: dataset.address.toBase58(),
      recordCount: dataset.recordCount,
    })),
    runs: [],
  }

  await mkdir(dirname(options.out), { recursive: true })
  const persist = async (): Promise<void> => {
    await writeFile(options.out, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8')
  }
  await persist()

  const queue: { variant: RunVariant; pool: SeededDataset[] }[] = variants.map((item) => ({
    variant: item,
    pool: smallPool,
  }))

  if (options.full) {
    // Повнорозмірний прогін бере канарку разом із двома великими датасетами й
    // мовчазним: без канарки в пулі шукати в ньому не було б чого.
    const wide = [canary, ...seeded.slice(smallRecords.length), ...smallPool.slice(2)]
    queue.push({
      variant: {
        label: `повнорозмірний пул (${wide.map((entry) => entry.recordCount).join('+')})`,
        params: { minAge: 0, maxAge: 255, sex: 'any', affected: 'any' },
        expectedCohort: wide.reduce((total, entry) => total + entry.recordCount, 0),
        expectedPerDataset: wide.map((entry) => entry.recordCount),
      },
      pool: wide,
    })
  }

  for (const [index, item] of queue.entries()) {
    const nonce = options.nonce + BigInt(index)
    note(`\n[${index + 1}/${queue.length}] «${item.variant.label}»`)

    const order = await orderRun({
      connection: options.connection,
      program: options.program,
      buyer: options.buyer,
      mint: options.mint,
      dispatcher: options.dispatcher.publicKey,
      nonce,
      useType: allowedUses,
      buyerCategory: buyerCategories,
      maxEscrow: options.maxEscrow,
      params: item.variant.params,
      datasets: item.pool,
    })
    note(`  замовлено ${order.run.toBase58()}`)

    const driven = await drive({
      connection: options.connection,
      program: options.program,
      arcium: options.arcium,
      dispatcher: options.dispatcher,
      run: order.run,
      envelope: async (dataset) => {
        const found = seeded.find((entry) => entry.address.equals(dataset))
        if (found === undefined) throw new CorpusError(`конверта для ${dataset.toBase58()} немає`)
        return Uint8Array.from(await readFile(found.envelopePath))
      },
      ...(options.writeConcurrency === undefined
        ? {}
        : { writeConcurrency: options.writeConcurrency }),
      ...(options.callbackTimeoutMs === undefined
        ? {}
        : { callbackTimeoutMs: options.callbackTimeoutMs }),
    })

    corpus.runs.push({
      label: item.variant.label,
      run: order.run.toBase58(),
      reportSecretKey: Buffer.from(order.reportSecretKey).toString('hex'),
      status: driven.run.status,
      folds: driven.folds,
      driveMs: driven.elapsedMs,
      expectedCohort: item.variant.expectedCohort,
      expectedPerDataset: item.variant.expectedPerDataset,
    })
    await persist()

    note(
      `  ${driven.run.status} · когорта ${driven.run.recordsIncluded} · ` +
        `згорток ${driven.folds} · ${driven.elapsedMs} мс`,
    )
  }

  return corpus
}
