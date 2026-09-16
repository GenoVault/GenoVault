/**
 * Датасет звірки якості й два прогони скану (`T032`, `SC-002`).
 *
 * Датасет тут — **не** синтетика `scenario.ts`: та робить рівно форму запису й
 * не має жодної залежності генотипу від фенотипу, тож скан по ній нічого не
 * знайшов би ні в MPC, ні відкрито, і розрив нуль не доводив би нічого.
 * Береться `tools/gen-dataset`: він породжує когорту з **відомими наперед**
 * причинними маркерами, логістичною моделлю ризику й маніфестом, у якому
 * записана правильна відповідь. Правильна відповідь у каталог не потрапляє
 * ніколи — вона існує рівно для цієї перевірки.
 *
 * Прогонів два, і менше не буває: скан порівнює частоту алеля між ураженими й
 * неураженими, а звіт віддає суму по когорті цілком. Два прогони з фільтрами
 * `affected` дають два плечі, і кожне з них — окрема когорта, яку рецепт
 * рахує всередині MPC.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AnchorProvider } from '@anchor-lang/core'
import { getMXEPublicKey } from '@arcium-hq/client'
import type { DatasetRecord } from '@genovault/crypto'
import { generateDataset } from '@genovault/gen-dataset'
import type { GenoVaultProgram } from '@genovault/sdk'
import type { FrequenciesParams } from '@genovault/shared'
import { buyerCategoryBit, useTypeBit } from '@genovault/shared'
import type { Connection, Keypair, PublicKey } from '@solana/web3.js'
import type { ArciumContext } from './arcium.ts'
import { drive } from './drive.ts'
import { RECIPE_MARKERS } from './layout.ts'
import type { DatasetPlan } from './seed.ts'
import { orderRun, seedDatasets } from './seed.ts'

export class ParityCorpusError extends Error {
  override readonly name = 'ParityCorpusError'
}

/** Фільтри двох плечей скану. Вік не звужується: плечі має різати лише фенотип. */
const ALL_AGES = { minAge: 0, maxAge: 255 } as const
const CASES: FrequenciesParams = { ...ALL_AGES, sex: 'any', affected: 'affected' }
const CONTROLS: FrequenciesParams = { ...ALL_AGES, sex: 'any', affected: 'unaffected' }

export interface ParityCorpusRun {
  label: string
  run: string
  reportSecretKey: string
  status: string
  folds: number
  driveMs: number
}

export interface ParityCorpus {
  rpc: string
  programId: string
  storageDir: string
  dataset: string
  /** Шлях до NDJSON із відкритими записами — те, що знає про себе власник. */
  recordsPath: string
  /** Причинні маркери з маніфесту генератора. `SC-002` міряється на синтетиці. */
  causalMarkers: number[]
  recordCount: number
  effectSize: number
  seed: number
  cases: ParityCorpusRun
  controls: ParityCorpusRun
}

export interface ParityCorpusOptions {
  connection: Connection
  provider: AnchorProvider
  program: GenoVaultProgram
  arcium: ArciumContext
  rpc: string
  owner: Keypair
  buyer: Keypair
  dispatcher: Keypair
  mint: PublicKey
  storageDir: string
  /** Куди лягає NDJSON із відкритими записами. */
  recordsPath: string
  out: string
  nonce: bigint
  maxEscrow: bigint
  records: number
  causalMarkers: number
  seed: number
  effectSize: number
  writeConcurrency?: number
  callbackTimeoutMs?: number
  onProgress?(note: string): void
}

/** Запис генератора у форму, яку приймає шифрування датасету. */
function toDatasetRecord(record: {
  sex: 0 | 1
  age: number
  affected: 0 | 1
  genotypes: number[]
}): DatasetRecord {
  return {
    sex: record.sex,
    age: record.age,
    affected: record.affected,
    genotypes: record.genotypes,
  }
}

/**
 * Засіває датасет із причинними маркерами й проганяє обидва плечі скану.
 *
 * Корпус пишеться на диск після кожного плеча: два прогони по 100 згорток — це
 * майже пів години, і перерваний корпус має лишатись читабельним.
 */
export async function buildParityCorpus(options: ParityCorpusOptions): Promise<ParityCorpus> {
  const note = (line: string): void => options.onProgress?.(line)

  const mxePublicKey = await getMXEPublicKey(options.provider, options.program.programId)
  if (mxePublicKey === null) {
    throw new ParityCorpusError('MXE ще не має публічного ключа — keygen кластера не завершився')
  }

  const generated = generateDataset({
    records: options.records,
    markers: RECIPE_MARKERS,
    causalMarkers: options.causalMarkers,
    seed: options.seed,
    effectSize: options.effectSize,
  })
  const causal = generated.manifest.groundTruth.causalMarkers
  const affectedRate = generated.manifest.statistics.affectedRate
  note(
    `датасет: ${options.records} записів, ${RECIPE_MARKERS} маркерів, ` +
      `причинних ${causal.length} (${causal.join(', ')}), уражених ${(affectedRate * 100).toFixed(1)}%`,
  )

  // Обидва плечі мусять бути вищими за поріг когорти, інакше рецепт віддасть
  // нулі й порівнювати не буде чого. Це властивість даних, а не наміру, тож
  // перевіряється тут, до пів години прогонів.
  const cases = Math.round(affectedRate * options.records)
  const controls = options.records - cases
  if (cases < 10 || controls < 10) {
    throw new ParityCorpusError(
      `плечі скану ${cases} / ${controls} — одне з них нижче за поріг когорти; ` +
        'зміни розмір датасету, effect або seed',
    )
  }

  await mkdir(dirname(options.recordsPath), { recursive: true })
  await writeFile(
    options.recordsPath,
    `${generated.records.map((record) => JSON.stringify(record)).join('\n')}\n`,
    'utf8',
  )
  note(`відкриті записи: ${options.recordsPath}`)

  const allowedUses = useTypeBit('populationGenetics')
  const buyerCategories = buyerCategoryBit('academic')
  const plan: DatasetPlan = {
    id: `sc002-${options.nonce.toString(16)}`.slice(0, 32),
    owner: options.owner,
    records: generated.records.map(toDatasetRecord),
    pricePer1k: 1_000n,
    allowedUses,
    forbiddenUses: 0,
    buyerCategories,
    expiresAt: null,
  }

  const [seeded] = await seedDatasets({
    connection: options.connection,
    program: options.program,
    mxePublicKey,
    storageDir: options.storageDir,
    plans: [plan],
    onProgress: (id, line) => note(`  ${id}: ${line}`),
  })
  if (seeded === undefined) throw new ParityCorpusError('датасет не засіявся')

  const corpus: Partial<ParityCorpus> & { rpc: string } = {
    rpc: options.rpc,
    programId: options.program.programId.toBase58(),
    storageDir: options.storageDir,
    dataset: seeded.address.toBase58(),
    recordsPath: options.recordsPath,
    causalMarkers: causal,
    recordCount: options.records,
    effectSize: options.effectSize,
    seed: options.seed,
  }

  await mkdir(dirname(options.out), { recursive: true })
  const persist = async (): Promise<void> => {
    await writeFile(options.out, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8')
  }
  await persist()

  const arms: [keyof Pick<ParityCorpus, 'cases' | 'controls'>, string, FrequenciesParams][] = [
    ['cases', 'уражені', CASES],
    ['controls', 'неуражені', CONTROLS],
  ]

  for (const [key, label, params] of arms) {
    const nonce = options.nonce + BigInt(key === 'cases' ? 0 : 1)
    note(`\n«${label}»`)

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
      params,
      datasets: [seeded],
    })
    note(`  замовлено ${order.run.toBase58()}`)

    const driven = await drive({
      connection: options.connection,
      program: options.program,
      arcium: options.arcium,
      dispatcher: options.dispatcher,
      run: order.run,
      envelope: async () => Uint8Array.from(await readFile(seeded.envelopePath)),
      ...(options.writeConcurrency === undefined
        ? {}
        : { writeConcurrency: options.writeConcurrency }),
      ...(options.callbackTimeoutMs === undefined
        ? {}
        : { callbackTimeoutMs: options.callbackTimeoutMs }),
    })

    corpus[key] = {
      label,
      run: order.run.toBase58(),
      reportSecretKey: Buffer.from(order.reportSecretKey).toString('hex'),
      status: driven.run.status,
      folds: driven.folds,
      driveMs: driven.elapsedMs,
    }
    await persist()

    note(
      `  ${driven.run.status} · когорта ${driven.run.recordsIncluded} · ` +
        `згорток ${driven.folds} · ${driven.elapsedMs} мс`,
    )
  }

  if (corpus.cases === undefined || corpus.controls === undefined) {
    throw new ParityCorpusError('одне з плечей скану не дійшло до кінця')
  }
  return corpus as ParityCorpus
}
