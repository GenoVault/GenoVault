/**
 * Умови для виміру часу прогону (`T033`, `SC-003`).
 *
 * Ця команда, як `sc001` і `sc002`, нічого не перевіряє: вона створює те, що
 * потім міряє `tools/audit-verify timing` — і міряє з ланцюга, без нашого коду
 * в рантаймі. Тут лише два експерименти, і кожен відповідає на своє питання.
 *
 * # Драбина — чи можна взагалі екстраполювати
 *
 * Повний прогін на 10 000 записів це 2500 послідовних кругів до MPC, тобто
 * години. Замість нього беруться прогони різної довжини, і драбина відповідає
 * на питання, без якого екстраполяція була б здогадом: **чи стала вартість
 * згортки**. Якщо десята згортка коштує стільки ж, скільки сорокова, множити
 * на 2500 можна; якщо ні — звіряч відмовиться, і правильно зробить.
 *
 * # Хвилі — чи вміє кластер рахувати паралельно
 *
 * Згортки одного прогону суворо послідовні: накопичувач пускає одне обчислення
 * за раз (`AccumulatorBusy`), і саме це робить «скільки записів увійшло»
 * фактом. Відомий важіль проти `SC-003` — паралельні накопичувачі, і це
 * переробка `T025`-`T026`. Але **чи дасть вона щось**, залежить не від нашого
 * коду, а від кластера: якщо круг до MPC — це робота вузлів, то сорок
 * накопичувачів стануть у ту саму чергу й куплять нуль.
 *
 * Питання знімається **без** переробки. У кожного прогону вже є власний
 * накопичувач, тож достатньо пустити кілька незалежних прогонів одночасно й
 * подивитись, чи росте пропускна здатність. Хвиля на чотири прогони — це рівно
 * та паралельність, яку дала б переробка, тільки куплена нулем рядків у
 * програмі.
 *
 * # Навіщо тут `stallMs`
 *
 * Правило репозиторію: кожна перевірка `SC-*` доводиться негативним контролем
 * на живих даних. Для виміру часу негативний контроль — це відома затримка,
 * вставлена в цикл згортки: звіряч мусить її побачити, назвати її величину і
 * віднести її до **нашої** ділянки циклу, а не до MPC. Перевірка, яка цього не
 * вміє, не вміє й відрізнити повільний кластер від повільного драйвера.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AnchorProvider } from '@anchor-lang/core'
import { getMXEPublicKey } from '@arcium-hq/client'
import type { GenoVaultProgram } from '@genovault/sdk'
import type { FrequenciesParams } from '@genovault/shared'
import { buyerCategoryBit, useTypeBit } from '@genovault/shared'
import type { Connection, Keypair, PublicKey } from '@solana/web3.js'
import type { ArciumContext } from './arcium.ts'
import { drive } from './drive.ts'
import { RECIPE_BATCH } from './layout.ts'
import { syntheticRecords } from './scenario.ts'
import type { DatasetPlan, SeededDataset } from './seed.ts'
import { orderRun, seedDatasets } from './seed.ts'

export class TimingCorpusError extends Error {
  override readonly name = 'TimingCorpusError'
}

/**
 * Фільтр, який пропускає все.
 *
 * Вимір часу не залежить від того, скільки записів пройшло у когорту: контур
 * має сталу довжину й розшифровує весь батч незалежно від фільтра — це
 * виміряно на `T018` (87 % ваги — розшифрування й обмін). Фільтр, що когось
 * відсіює, зробив би прогін не швидшим, а лише менш зрозумілим.
 */
const EVERYTHING: FrequenciesParams = {
  minAge: 0,
  maxAge: 255,
  sex: 'any',
  affected: 'any',
}

export interface TimingCorpusRun {
  label: string
  run: string
  records: number
  /** Скільки згорток дав прогін за нашим лічильником. Ланцюг звіряч спитає сам. */
  folds: number
  status: string
  driveMs: number
}

export interface TimingWave {
  label: string
  /** Скільки прогонів ішло одночасно. Стільки ж було й незалежних накопичувачів. */
  concurrency: number
  runs: TimingCorpusRun[]
  /** Wall-clock хвилі цілком — від першого `drive()` до останнього. */
  wallMs: number
}

export interface TimingCorpus {
  rpc: string
  programId: string
  storageDir: string
  /** Скільки записів у батчі. Від нього залежить, скільки згорток дає датасет. */
  batch: number
  /** Прогони різної довжини, пущені по одному. */
  ladder: TimingCorpusRun[]
  /** Хвилі різної паралельності на датасеті однакового розміру. */
  waves: TimingWave[]
  /** Скільки мілісекунд штучної затримки вставлено в цикл згортки. */
  stallMs: number
}

export interface TimingCorpusOptions {
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
  out: string
  nonce: bigint
  maxEscrow: bigint
  /** Розміри щаблів драбини в записах. Кратні батчу, інакше останній неповний. */
  ladderSizes: readonly number[]
  /** Розмір датасету, на якому міряються хвилі. */
  waveRecords: number
  /** Рівні паралельності. Один із них мусить бути одиницею — проти неї міряється решта. */
  waveLevels: readonly number[]
  /** Негативний контроль: затримка перед кожним батчем. */
  stallMs?: number
  writeConcurrency?: number
  callbackTimeoutMs?: number
  onProgress?(note: string): void
}

/**
 * Які датасети треба засіяти — і чи є сенс узагалі починати.
 *
 * Обидві перевірки коштують нуль, а ловлять корпус, який здасться правильним
 * аж після пів години прогонів: хвилі без одиниці нема з чим порівнювати, а
 * неповний останній батч коштує стільки ж, скільки повний, і зіпсував би саме
 * ту сталість вартості згортки, заради якої драбина існує.
 */
export function planCorpus(options: {
  ladderSizes: readonly number[]
  waveRecords: number
  waveLevels: readonly number[]
}): number[] {
  if (!options.waveLevels.includes(1)) {
    throw new TimingCorpusError(
      'серед рівнів паралельності немає одиниці — прискорення нема з чим порівнювати',
    )
  }
  if (options.ladderSizes.length < 2) {
    throw new TimingCorpusError(
      'драбина коротша за два щаблі — сталість вартості згортки не буде чим довести',
    )
  }
  for (const size of [...options.ladderSizes, options.waveRecords]) {
    if (size % RECIPE_BATCH !== 0) {
      throw new TimingCorpusError(
        `${size} записів не кратні батчу ${RECIPE_BATCH} — останній батч буде неповним, ` +
          'і вартість згортки в ньому не та сама',
      )
    }
  }

  // Датасети засіваються один раз на розмір: хвилі ганяють кілька прогонів по
  // тому самому шифротексту, і це законно — прогін не змінює датасету.
  return [...new Set([...options.ladderSizes, options.waveRecords])].sort((a, b) => a - b)
}

/** Датасет із синтетики: вимір часу не дивиться на вміст записів. */
function planFor(records: number, owner: Keypair, tag: string): DatasetPlan {
  return {
    id: `sc003-${tag}`.slice(0, 32),
    owner,
    records: syntheticRecords(records, records),
    pricePer1k: 1_000n,
    allowedUses: useTypeBit('populationGenetics'),
    forbiddenUses: 0,
    buyerCategories: buyerCategoryBit('academic'),
    expiresAt: null,
  }
}

/**
 * Засіває датасети й проганяє драбину та хвилі.
 *
 * Корпус пишеться на диск після кожного прогону: разом це сотні згорток, тобто
 * добрих пів години, і перерваний корпус має лишатись читабельним — рівно як у
 * `sc002`.
 */
export async function buildTimingCorpus(options: TimingCorpusOptions): Promise<TimingCorpus> {
  const note = (line: string): void => options.onProgress?.(line)

  // Перевірки корпусу — до першої транзакції: корпус, зібраний не так,
  // з'ясувався б аж після пів години прогонів.
  const sizes = planCorpus(options)

  const mxePublicKey = await getMXEPublicKey(options.provider, options.program.programId)
  if (mxePublicKey === null) {
    throw new TimingCorpusError('MXE ще не має публічного ключа — keygen кластера не завершився')
  }

  note(`засіваємо ${sizes.length} датасетів: ${sizes.join(', ')} записів`)
  const seeded = await seedDatasets({
    connection: options.connection,
    program: options.program,
    mxePublicKey,
    storageDir: options.storageDir,
    plans: sizes.map((records, index) => planFor(records, options.owner, `${index}-${records}`)),
    onProgress: (id, line) => note(`  ${id}: ${line}`),
  })

  const bySize = new Map<number, SeededDataset>()
  for (const [index, size] of sizes.entries()) {
    const dataset = seeded[index]
    if (dataset === undefined) throw new TimingCorpusError(`датасет на ${size} записів не засіявся`)
    bySize.set(size, dataset)
  }

  const corpus: TimingCorpus = {
    rpc: options.rpc,
    programId: options.program.programId.toBase58(),
    storageDir: options.storageDir,
    batch: RECIPE_BATCH,
    ladder: [],
    waves: [],
    stallMs: options.stallMs ?? 0,
  }

  await mkdir(dirname(options.out), { recursive: true })
  const persist = async (): Promise<void> => {
    await writeFile(options.out, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8')
  }
  await persist()

  let nonce = options.nonce

  /** Замовляє прогін на датасеті й доводить його до кінця. */
  const runOnce = async (
    dataset: SeededDataset,
    label: string,
    at: bigint,
  ): Promise<TimingCorpusRun> => {
    const order = await orderRun({
      connection: options.connection,
      program: options.program,
      buyer: options.buyer,
      mint: options.mint,
      dispatcher: options.dispatcher.publicKey,
      nonce: at,
      useType: useTypeBit('populationGenetics'),
      buyerCategory: buyerCategoryBit('academic'),
      maxEscrow: options.maxEscrow,
      params: EVERYTHING,
      datasets: [dataset],
    })

    const driven = await drive({
      connection: options.connection,
      program: options.program,
      arcium: options.arcium,
      dispatcher: options.dispatcher,
      run: order.run,
      envelope: async () => Uint8Array.from(await readFile(dataset.envelopePath)),
      ...(options.stallMs === undefined ? {} : { stallMs: options.stallMs }),
      ...(options.writeConcurrency === undefined
        ? {}
        : { writeConcurrency: options.writeConcurrency }),
      ...(options.callbackTimeoutMs === undefined
        ? {}
        : { callbackTimeoutMs: options.callbackTimeoutMs }),
    })

    return {
      label,
      run: order.run.toBase58(),
      records: dataset.recordCount,
      folds: driven.folds,
      status: driven.run.status,
      driveMs: driven.elapsedMs,
    }
  }

  note('\nдрабина — чи стала вартість згортки')
  for (const size of options.ladderSizes) {
    const dataset = bySize.get(size)
    if (dataset === undefined) throw new TimingCorpusError(`датасету на ${size} записів немає`)

    const label = `${size} записів`
    note(`  «${label}» — ${size / RECIPE_BATCH} згорток`)
    nonce += 1n
    const result = await runOnce(dataset, label, nonce)
    corpus.ladder.push(result)
    await persist()
    note(`    ${result.status} · згорток ${result.folds} · ${result.driveMs} мс`)
  }

  note('\nхвилі — чи вміє кластер рахувати паралельно')
  const waveDataset = bySize.get(options.waveRecords)
  if (waveDataset === undefined) {
    throw new TimingCorpusError(`датасету хвиль на ${options.waveRecords} записів немає`)
  }

  for (const level of options.waveLevels) {
    const label = `${level} накопичувач${level === 1 ? '' : 'ів одночасно'}`
    note(`  «${label}»`)

    // Нонси роздаються наперед, а замовлення й відкриття прогону їдуть разом
    // із рештою хвилі. Пропускної здатності це не псує: вона міряється не за
    // цим `wallMs`, а за відрізком між першою згорткою хвилі й останнім
    // callback'ом, і замовлення в нього не входить. `wallMs` лишається
    // довідковим числом «скільки це зайняло цілком».
    const nonces: bigint[] = []
    for (let index = 0; index < level; index += 1) {
      nonce += 1n
      nonces.push(nonce)
    }

    const started = Date.now()
    const runs = await Promise.all(
      nonces.map(async (at, index) => runOnce(waveDataset, `${label} · ${index + 1}`, at)),
    )
    const wallMs = Date.now() - started

    corpus.waves.push({ label, concurrency: level, runs, wallMs })
    await persist()

    const folds = runs.reduce((sum, run) => sum + run.folds, 0)
    note(
      `    ${runs.map((run) => run.status).join(', ')} · згорток ${folds} · ${wallMs} мс · ` +
        `${((wallMs / folds) as number).toFixed(0)} мс на згортку по хвилі`,
    )
  }

  return corpus
}
