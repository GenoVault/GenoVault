/**
 * Час прогону: з чого складається згортка і що з цього виходить (`T033`, `SC-003`).
 *
 * # Чому вимір читається з ланцюга, а не зі стопвотча драйвера
 *
 * `drive()` уміє сказати, скільки мілісекунд зайняв крок, і на `T030` саме так
 * і виміряно. Але число з нашого секундоміра відповідає на питання «скільки
 * чекала наша програма», а `SC-003` питає інше — скільки коштує згортка. Різниця
 * не академічна: у нашому чеканні сидить `POLL_INTERVAL_MS`, і драйвер, що
 * опитує ланцюг раз на 400 мс, домальовує до кожної згортки до 400 мс, яких у
 * ній немає. Стопвотч цього не бачить і не може побачити.
 *
 * Тому годинник тут — **слот**, а не `Date.now()`. Кожна транзакція прогону
 * лежить у ледері з номером слота, і різниця слотів між `dispatch_fold` і
 * callback'ом вузла — це те, скільки круг **дійсно** тривав. Тривалість слота
 * не постулюється, а міряється: `blockTime` першої й останньої транзакції
 * прогону, поділені на кількість слотів між ними. Число оголошується у звіті —
 * від нього залежить кожне інше.
 *
 * # Що саме розкладається
 *
 * Цикл згортки — це відрізок між двома сусідніми `dispatch_fold`, і в ньому
 * рівно чотири ділянки:
 *
 * | ділянка | від | до | чия |
 * |---|---|---|---|
 * | `mpc` | `dispatch_fold` | `frequencies_fold_callback` | Arcium |
 * | `idle` | callback | перший `write_batch` наступного батча | наша |
 * | `write` | перший `write_batch` | останній `write_batch` | наша |
 * | `arm` | останній `write_batch` | наступний `dispatch_fold` | наша |
 *
 * Розділення не косметичне: воно й вирішує, який важіль має сенс. Якщо вага
 * сидить у `mpc`, то прискорити прогін можна лише паралелізмом кластера, і
 * вилизування драйвера не дасть нічого; якщо в наших трьох ділянках — усе
 * навпаки. На `T033` виміряно перше.
 *
 * # Чому перевірка мусить уміти відмовитись
 *
 * `SC-003` міряється екстраполяцією: повний прогін на 10 000 записів це 2500
 * послідовних кругів, і в стенд він не вміщається. Екстраполяція чесна рівно
 * доти, доки вартість згортки стала, — а це твердження, яке треба доводити, а
 * не припускати. Тому в звіті є **драбина**: прогони різної довжини, і якщо
 * вартість згортки в них розійшлась більше за `LINEARITY_TOLERANCE`, звіряч
 * відмовляється екстраполювати замість того, щоб помножити перше-ліпше число
 * на 2500.
 *
 * Друга відмова — за неповним оглядом, урок `T031`. Скільки згорток мусило
 * бути, звіряч бере з `Run.folded_batches`, тобто з ланцюга, а не з нашого
 * корпусу. Побачив менше — це розбіжність, а не тиша.
 */

import type { Connection, PublicKey, VersionedTransactionResponse } from '@solana/web3.js'
import { decodeRun, fetchAccount } from './chain.ts'

export class TimingError extends Error {
  override readonly name = 'TimingError'
}

/** Скільки записів у стандартному датасеті `SC-003`. Число з SPEC. */
export const SC003_RECORDS = 10_000

/**
 * Бюджет `SC-003` у секундах — 4,5 години.
 *
 * Редакція 2026-09-14. Початкові «5 хвилин» знято продуктовим рішенням після
 * того, як `T033` виміряв стелю кластера: паралельні накопичувачі насичуються
 * на ×4, найкраща пропускна здатність — 1,31 с на згортку, і 10 000 записів це
 * ~55 хвилин **навіть при необмеженій паралельності**. Бюджет у 300 секунд
 * вимагав би 33 записи/с проти виміряних 3.
 *
 * 4,5 години, а не 3,5: між двома корпусами `T033` проєкція розійшлась на 12 %
 * (3,31 і 3,71 год), і це мінливість кластера, а не виміру. Межа, притерта до
 * найкращого прогону, червоніла б від погоди на стенді.
 */
export const SC003_BUDGET_SECONDS = 16_200

/**
 * Скільки записів з'їдає одна згортка.
 *
 * Дзеркало `BATCH` у рецепті, і взяте з опису рецепта, а не з нашого коду —
 * як і в `fold-chain.ts`. Саме воно перетворює «10 000 записів» на «2500
 * послідовних кругів до MPC».
 */
export const RECIPE_BATCH = 4

/**
 * Наскільки вартість згортки має право розійтися між прогонами драбини.
 *
 * Десять відсотків — не смак, а роздільна здатність годинника: слот триває
 * ~420 мс при циклі ~4,8 с, тобто одне округлення до слота це вже 8,7 %.
 * Вужчий поріг ловив би не нелінійність, а дискретність ледера.
 */
export const LINEARITY_TOLERANCE = 0.1

/**
 * Наскільки паралельний прогін має обігнати послідовний, щоб важіль вважався
 * знайденим.
 *
 * Двадцять відсотків при подвоєнні паралелізму — це поріг «щось таки
 * прискорилось», а не обіцянка лінійного зростання. Нижче нього кластер
 * рахує по черзі, і паралельні накопичувачі не куплять нічого.
 */
export const SPEEDUP_FLOOR = 1.2

export const DISPATCH_FOLD_DISCRIMINATOR = [23, 95, 246, 22, 242, 200, 20, 178] as const
export const FOLD_CALLBACK_DISCRIMINATOR = [134, 49, 189, 24, 38, 50, 166, 233] as const
export const WRITE_BATCH_DISCRIMINATOR = [241, 101, 221, 8, 160, 229, 116, 203] as const

/** Що саме сталося в транзакції. Інші інструкції прогону нас тут не цікавлять. */
export type EventKind = 'fold' | 'callback' | 'write'

export interface ChainEvent {
  kind: EventKind
  slot: number
  signature: string
  blockTime: number | null
}

/** Одна ділянка циклу згортки, у слотах. */
export interface CyclePhases {
  /** `dispatch_fold` → callback вузла. Час Arcium. */
  mpc: number
  /** Callback → перший запис наступного батча. Наш простій на опитуванні. */
  idle: number
  /** Перший запис батча → останній. */
  write: number
  /** Останній запис → наступний `dispatch_fold`. Підтвердження нашої транзакції. */
  arm: number
  /** Цілий цикл між сусідніми `dispatch_fold`. */
  total: number
}

export const PHASE_NAMES = ['mpc', 'idle', 'write', 'arm'] as const
export type PhaseName = (typeof PHASE_NAMES)[number]

/**
 * Розкладає стрічку подій на цикли згортки.
 *
 * Циклів завжди на один менше, ніж згорток: перший `dispatch_fold` не має
 * попередника, а вимірюється саме відрізок між двома. Цикл, у якому не
 * знайшлося callback'а або запису, у розкладку не потрапляє — і скільки таких,
 * видно з різниці між `folds` і довжиною цього списку.
 */
export function splitCycles(events: readonly ChainEvent[]): CyclePhases[] {
  const folds = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event.kind === 'fold')

  const cycles: CyclePhases[] = []
  for (let at = 1; at < folds.length; at += 1) {
    const previous = folds[at - 1]
    const current = folds[at]
    if (previous === undefined || current === undefined) continue

    const between = events.slice(previous.index + 1, current.index)
    const callback = between.find((event) => event.kind === 'callback')
    const writes = between.filter((event) => event.kind === 'write')
    const firstWrite = writes[0]
    const lastWrite = writes.at(-1)
    if (callback === undefined || firstWrite === undefined || lastWrite === undefined) continue

    cycles.push({
      mpc: callback.slot - previous.event.slot,
      idle: firstWrite.slot - callback.slot,
      write: lastWrite.slot - firstWrite.slot,
      arm: current.event.slot - lastWrite.slot,
      total: current.event.slot - previous.event.slot,
    })
  }

  return cycles
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** Вимір одного прогону. */
export interface RunTiming {
  run: string
  /** Скільки згорток каже ланцюг. Знаменник огляду, і він не наш. */
  folds: number
  /** Скільки `dispatch_fold` звіряч побачив у ледері. */
  foldsSeen: number
  /** Скільки повних циклів вдалося розкласти. */
  cycles: number
  status: string
  /** Тривалість слота, виміряна на цьому ж прогоні. */
  msPerSlot: number
  /** Середня ділянка циклу в мілісекундах. */
  phases: Record<PhaseName, number>
  /** Середній цикл згортки в мілісекундах. */
  foldMs: number
  /** Перший і останній слот прогону — межі, у яких його шукали. */
  firstSlot: number
  lastSlot: number
  problems: string[]
}

/**
 * Тривалість слота, виміряна по самому прогону.
 *
 * `blockTime` цілий у секундах, тож на короткому прогоні похибка помітна: 480
 * секунд на 1165 слотів дають ±0,2 %, а 20 секунд на 48 слотів — уже ±5 %.
 * Тому число повертається разом із прогоном, а не усереднюється по стенду:
 * читач мусить бачити, на чому воно поміряне.
 */
export function measureSlotMs(events: readonly ChainEvent[]): number {
  const timed = events.filter((event) => event.blockTime !== null)
  const first = timed[0]
  const last = timed.at(-1)
  if (first === undefined || last === undefined) {
    throw new TimingError('жодна транзакція прогону не має blockTime — годинник узяти нізвідки')
  }

  const slots = last.slot - first.slot
  const seconds = (last.blockTime ?? 0) - (first.blockTime ?? 0)
  if (slots <= 0 || seconds <= 0) {
    throw new TimingError(
      `прогін уклався в ${slots} слотів і ${seconds} с — цього замало, щоб виміряти слот`,
    )
  }
  return (seconds * 1000) / slots
}

export interface MeasureRunOptions {
  connection: Connection
  programId: PublicKey
  run: PublicKey
}

/** Міряє один прогін: події з ледера, розкладка циклу, повнота огляду. */
export async function measureRun(options: MeasureRunOptions): Promise<RunTiming> {
  const run = decodeRun(await fetchAccount(options.connection, options.run, 'прогін'))
  const events = await fetchEvents(options.connection, options.run, options.programId)

  const foldsSeen = events.filter((event) => event.kind === 'fold').length
  const cycles = splitCycles(events)
  const problems: string[] = []

  // Урок `T031`: скільки належить оглянути, каже ланцюг. Побачили менше —
  // це розбіжність, а не «стільки й було».
  if (foldsSeen !== run.foldedBatches) {
    problems.push(
      `у ледері ${foldsSeen} dispatch_fold, а Run.folded_batches каже ${run.foldedBatches} — ` +
        'огляд неповний, і будь-яке середнє з нього не про весь прогін',
    )
  }
  if (run.status !== 'completed') {
    problems.push(`прогін у статусі ${run.status}, а не completed — міряти нема чого`)
  }
  if (cycles.length === 0) {
    problems.push('жодного повного циклу згортки не склалось')
  }

  const first = events[0]
  const last = events.at(-1)
  if (first === undefined || last === undefined) {
    throw new TimingError(`у прогону ${options.run.toBase58()} немає транзакцій у ледері`)
  }

  const msPerSlot = measureSlotMs(events)
  const phases = {
    mpc: mean(cycles.map((cycle) => cycle.mpc)) * msPerSlot,
    idle: mean(cycles.map((cycle) => cycle.idle)) * msPerSlot,
    write: mean(cycles.map((cycle) => cycle.write)) * msPerSlot,
    arm: mean(cycles.map((cycle) => cycle.arm)) * msPerSlot,
  }

  return {
    run: options.run.toBase58(),
    folds: run.foldedBatches,
    foldsSeen,
    cycles: cycles.length,
    status: run.status,
    msPerSlot,
    phases,
    foldMs: mean(cycles.map((cycle) => cycle.total)) * msPerSlot,
    firstSlot: first.slot,
    lastSlot: last.slot,
    problems,
  }
}

/**
 * Хвиля прогонів, пущених разом.
 *
 * Одна хвиля — одне твердження про кластер: «стільки-то незалежних накопичувачів
 * одночасно дають стільки-то згорток за секунду». Пропускна здатність міряється
 * по хвилі цілком, а не по прогону: паралельні прогони ділять той самий кластер,
 * і сума їхніх окремих швидкостей нічого не означає.
 */
export interface WaveTiming {
  label: string
  concurrency: number
  runs: RunTiming[]
  /** Скільки згорток дала хвиля разом. */
  folds: number
  /** Від першої згортки хвилі до останньої, у слотах. */
  spanSlots: number
  /** Скільки мілісекунд коштувала згортка з погляду хвилі, а не прогону. */
  foldMs: number
  /** Прискорення проти хвилі з `concurrency = 1`. */
  speedup: number | null
}

export interface Ladder {
  /** Вартість згортки в кожному прогоні драбини. */
  points: { run: string; folds: number; foldMs: number }[]
  /** Розкид між найдорожчою й найдешевшою згорткою, часткою від середнього. */
  spread: number
  /** Чи має звіряч право множити виміряне на 2500. */
  linear: boolean
}

/**
 * Драбина: чи стала вартість згортки в прогонах різної довжини.
 *
 * Без цього твердження екстраполяція — здогад. З ним вона лишається
 * екстраполяцією, але названою: «вартість згортки стала в межах X % на
 * прогонах від N до M згорток».
 */
export function buildLadder(runs: readonly RunTiming[]): Ladder {
  const points = runs.map((run) => ({ run: run.run, folds: run.folds, foldMs: run.foldMs }))
  const costs = points.map((point) => point.foldMs)
  const average = mean(costs)
  const lowest = Math.min(...costs)
  const highest = Math.max(...costs)
  const spread = average === 0 ? Number.POSITIVE_INFINITY : (highest - lowest) / average

  return { points, spread, linear: points.length >= 2 && spread <= LINEARITY_TOLERANCE }
}

export interface TimingVerdict {
  /** Тривалість слота, виміряна на найдовшому прогоні корпусу. */
  msPerSlot: number
  ladder: Ladder
  waves: WaveTiming[]
  /** Розкладка циклу на послідовному прогоні, у мілісекундах. */
  phases: Record<PhaseName, number>
  /** Вартість згортки, з якої рахується екстраполяція. */
  foldMs: number
  /** Скільки згорток потребує стандартний датасет. */
  foldsFor10k: number
  /** Скільки секунд вийде на 10 000 записів. `null` — екстраполювати не можна. */
  projectedSeconds: number | null
  /** У скільки разів проєкція промахує повз бюджет. */
  overBudget: number | null
  /** Скільки записів архітектура встигає за бюджетні 5 хвилин. */
  recordsInBudget: number
  /** Чи знайшовся важіль паралелізму. `null` — хвиль для висновку не було. */
  parallelismHelps: boolean | null
  /** Скільки одночасних накопичувачів потрібно, щоб укластись у бюджет. */
  accumulatorsNeeded: number
  passed: boolean
  problems: string[]
}

export interface TimingOptions {
  connection: Connection
  programId: PublicKey
  /** Прогони драбини — різної довжини, пущені по одному. */
  ladder: readonly PublicKey[]
  /** Хвилі паралелізму: скільки прогонів пущено разом і які саме. */
  waves: readonly { label: string; concurrency: number; runs: readonly PublicKey[] }[]
  /** Бюджет `SC-003` у секундах. Параметр, бо число з SPEC, а не з коду. */
  budgetSeconds?: number
  /** Скільки записів у стандартному датасеті. */
  records?: number
}

/**
 * Вимір `SC-003` цілком: драбина, хвилі, розкладка, проєкція й вердикт.
 *
 * Вердикт зелений рівно тоді, коли проєкція вкладається в бюджет і при цьому
 * її є з чого рахувати. Неповний огляд, нелінійна драбина або прогін, що не
 * дійшов до `completed`, роблять вердикт червоним **без** проєкції: число, яке
 * нема на чому тримати, гірше за його відсутність.
 */
export async function auditTiming(options: TimingOptions): Promise<TimingVerdict> {
  const budget = options.budgetSeconds ?? SC003_BUDGET_SECONDS
  const records = options.records ?? SC003_RECORDS
  const problems: string[] = []

  const ladderRuns: RunTiming[] = []
  for (const run of options.ladder) {
    const timing = await measureRun({ ...options, run })
    ladderRuns.push(timing)
    problems.push(...timing.problems.map((line) => `${timing.run}: ${line}`))
  }

  const waves: WaveTiming[] = []
  for (const wave of options.waves) {
    const runs: RunTiming[] = []
    const events: ChainEvent[][] = []
    for (const run of wave.runs) {
      const timing = await measureRun({ ...options, run })
      runs.push(timing)
      problems.push(...timing.problems.map((line) => `${timing.run}: ${line}`))
      events.push(await fetchEvents(options.connection, run, options.programId))
    }
    waves.push(summariseWave(wave.label, wave.concurrency, runs, events))
  }

  // Проти чого міряється прискорення — хвиля, у якій накопичувач був один.
  const solo = waves.find((wave) => wave.concurrency === 1)
  for (const wave of waves) {
    wave.speedup = solo === undefined || wave.foldMs === 0 ? null : solo.foldMs / wave.foldMs
  }

  const ladder = buildLadder(ladderRuns)
  if (ladderRuns.length >= 2 && !ladder.linear) {
    problems.push(
      `вартість згортки розійшлась на ${(ladder.spread * 100).toFixed(1)} % ` +
        `при допуску ${(LINEARITY_TOLERANCE * 100).toFixed(0)} % — екстраполювати нема на чому`,
    )
  }
  if (ladderRuns.length < 2) {
    problems.push('драбина коротша за два прогони — сталість вартості згортки нічим не доведена')
  }

  // Розкладка береться з найдовшого послідовного прогону: на короткому кожна
  // ділянка стоїть на двох-трьох слотах, і округлення видно неозброєним оком.
  const longest = [...ladderRuns].sort((a, b) => b.folds - a.folds)[0]
  const phases: Record<PhaseName, number> = longest?.phases ?? { mpc: 0, idle: 0, write: 0, arm: 0 }
  const foldMs = longest?.foldMs ?? 0
  const msPerSlot = longest?.msPerSlot ?? 0

  const foldsFor10k = Math.ceil(records / RECIPE_BATCH)
  const usable = problems.length === 0 && foldMs > 0
  const projectedSeconds = usable ? (foldMs * foldsFor10k) / 1000 : null
  const overBudget = projectedSeconds === null ? null : projectedSeconds / budget
  const recordsInBudget = foldMs === 0 ? 0 : Math.floor((budget * 1000) / foldMs) * RECIPE_BATCH

  // Скільки накопичувачів довелось би пустити разом — і це нижня оцінка: вона
  // припускає, що паралельні згортки коштують стільки ж, скільки одинока.
  const accumulatorsNeeded = projectedSeconds === null ? 0 : Math.ceil(projectedSeconds / budget)

  const parallel = waves.filter((wave) => wave.concurrency > 1 && wave.speedup !== null)
  const best = parallel.map((wave) => wave.speedup ?? 0).sort((a, b) => b - a)[0]
  const parallelismHelps =
    parallel.length === 0 || best === undefined ? null : best >= SPEEDUP_FLOOR

  return {
    msPerSlot,
    ladder,
    waves,
    phases,
    foldMs,
    foldsFor10k,
    projectedSeconds,
    overBudget,
    recordsInBudget,
    parallelismHelps,
    accumulatorsNeeded,
    passed: projectedSeconds !== null && projectedSeconds <= budget,
    problems,
  }
}

/** Зводить хвилю: пропускна здатність міряється по хвилі, а не по прогону. */
export function summariseWave(
  label: string,
  concurrency: number,
  runs: readonly RunTiming[],
  events: readonly ChainEvent[][],
): WaveTiming {
  const folds = runs.reduce((sum, run) => sum + run.folds, 0)

  // Хвиля починається першою згорткою будь-якого з прогонів і закінчується
  // останнім callback'ом будь-якого з них. Брати межі прогонів цілком не можна:
  // засівання, замовлення й розрахунок у пропускну здатність не входять.
  const foldSlots = events.flat().filter((event) => event.kind === 'fold')
  const callbackSlots = events.flat().filter((event) => event.kind === 'callback')
  const start = Math.min(...foldSlots.map((event) => event.slot))
  const end = Math.max(...callbackSlots.map((event) => event.slot))
  const spanSlots = Number.isFinite(start) && Number.isFinite(end) ? end - start : 0

  const msPerSlot = mean(runs.map((run) => run.msPerSlot))
  const foldMs = folds === 0 ? 0 : (spanSlots * msPerSlot) / folds

  return { label, concurrency, runs: [...runs], folds, spanSlots, foldMs, speedup: null }
}

/**
 * Події прогону з ледера, у порядку слотів.
 *
 * Сторінками по 1000: прогін на 100 згорток — це вже 1315 підписів, і
 * непрогорнута перша сторінка виглядала б як прогін, що обірвався на
 * сімдесятій. Що сторінки не загубились, показує сам звіт — число побачених
 * згорток стоїть поруч із тим, що каже ланцюг.
 */
export async function fetchEvents(
  connection: Connection,
  run: PublicKey,
  programId: PublicKey,
): Promise<ChainEvent[]> {
  const pages: { signature: string; slot: number; blockTime: number | null }[] = []
  let before: string | undefined
  for (;;) {
    const page = await connection.getSignaturesForAddress(
      run,
      before === undefined ? { limit: 1000 } : { limit: 1000, before },
      'confirmed',
    )
    if (page.length === 0) break
    for (const entry of page) {
      pages.push({
        signature: entry.signature,
        slot: entry.slot,
        blockTime: entry.blockTime ?? null,
      })
    }
    before = page.at(-1)?.signature
    if (page.length < 1000 || before === undefined) break
  }
  pages.reverse()

  const events: ChainEvent[] = []
  const size = 100
  for (let at = 0; at < pages.length; at += size) {
    const chunk = pages.slice(at, at + size)
    const responses = await connection.getTransactions(
      chunk.map((entry) => entry.signature),
      { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
    )
    for (const [index, response] of responses.entries()) {
      const entry = chunk[index]
      if (response === null || entry === undefined) continue
      const kind = classify(response, programId)
      if (kind === null) continue
      events.push({
        kind,
        slot: entry.slot,
        signature: entry.signature,
        blockTime: entry.blockTime,
      })
    }
  }

  // Слот — не унікальний ключ: у той самий слот падає десяток записів батча.
  // Порядок усередині слота зберігається таким, яким його віддав RPC.
  return events.sort((a, b) => a.slot - b.slot)
}

/**
 * Чим була транзакція: згорткою, callback'ом чи записом.
 *
 * Callback приходить від вузла **вкладеною** інструкцією: верхнього рівня там
 * `arcium::callback_computation`, а наш `frequencies_fold_callback` викликається
 * з неї через CPI. Дивитись лише на верхній рівень означало б не побачити
 * жодного callback'а — і порахувати весь круг до MPC як наш простій.
 */
export function classify(
  transaction: VersionedTransactionResponse,
  programId: PublicKey,
): EventKind | null {
  if (transaction.meta?.err != null) return null

  for (const data of programInstructions(transaction, programId)) {
    if (startsWith(data, DISPATCH_FOLD_DISCRIMINATOR)) return 'fold'
    if (startsWith(data, FOLD_CALLBACK_DISCRIMINATOR)) return 'callback'
    if (startsWith(data, WRITE_BATCH_DISCRIMINATOR)) return 'write'
  }
  return null
}

function startsWith(data: Uint8Array, discriminator: readonly number[]): boolean {
  if (data.length < discriminator.length) return false
  return discriminator.every((byte, index) => data[index] === byte)
}

/** Дані інструкцій, адресованих нашій програмі, — верхнього рівня й вкладених. */
function programInstructions(
  transaction: VersionedTransactionResponse,
  programId: PublicKey,
): Uint8Array[] {
  const keys = transaction.transaction.message.getAccountKeys({
    accountKeysFromLookups: transaction.meta?.loadedAddresses ?? null,
  })

  const found: Uint8Array[] = []
  for (const instruction of transaction.transaction.message.compiledInstructions) {
    if (keys.get(instruction.programIdIndex)?.equals(programId) === true) {
      found.push(Uint8Array.from(instruction.data))
    }
  }

  for (const inner of transaction.meta?.innerInstructions ?? []) {
    for (const instruction of inner.instructions) {
      if (keys.get(instruction.programIdIndex)?.equals(programId) !== true) continue
      // Вкладені інструкції приїжджають у base58, а не байтами: у
      // `VersionedTransactionResponse` це `CompiledInstruction`, а не
      // `MessageCompiledInstruction`.
      found.push(decodeBase58(instruction.data))
    }
  }

  return found
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/**
 * Base58 у байти.
 *
 * Своє, а не з бібліотеки: `bs58` не в залежностях звіряча, а тягнути пакет
 * заради тридцяти рядків у перевірку, яка навмисно не залежить від нашого SDK,
 * означало б розширити її поверхню довіри рівно там, де ми її звужували.
 */
export function decodeBase58(value: string): Uint8Array {
  const bytes: number[] = []
  for (const character of value) {
    const digit = BASE58.indexOf(character)
    if (digit < 0) throw new TimingError(`«${character}» не належить алфавіту base58`)

    let carry = digit
    for (let at = 0; at < bytes.length; at += 1) {
      carry += (bytes[at] ?? 0) * 58
      bytes[at] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Провідні нулі base58 кодує як «1», і жодне множення їх не породжує.
  for (const character of value) {
    if (character !== '1') break
    bytes.push(0)
  }

  return Uint8Array.from(bytes.reverse())
}
