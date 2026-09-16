/**
 * Звірка якості: той самий рецепт на відкритих даних проти MPC (`T032`, `SC-002`).
 *
 * # Що саме порівнюється, і чому це два різні твердження
 *
 * `SC-002` у SPEC говорить про «якість **моделі**, навченої на зашифрованих
 * даних». Рецепт «частоти й розподіли» моделі не навчає — він віддає суми.
 * Продуктове рішення 2026-09-14 читає критерій так, як він працює для цього
 * продукту, і це **два** твердження, а не одне:
 *
 * 1. **Тотожність чисел.** Звіт MPC мусить збігтися з тими самими
 *    статистиками, порахованими відкрито над тими самими записами й тим самим
 *    фільтром. Розрив тут має бути **рівно нуль**: арифметика цілочисельна, і
 *    будь-яке відхилення — це дефект, а не «втрата якості». Це і є суттєве
 *    твердження задачі.
 * 2. **Якість скану.** На числах з обох боків будується те, що покупець
 *    справді з них будує — case-control скан за різницею частот алеля між
 *    ураженими й неураженими, — і його якість міряється проти **відомих
 *    наперед** причинних маркерів `tools/gen-dataset`. Це і дає число у
 *    відсоткових пунктах, якого вимагає критерій.
 *
 * # Сторож проти порожнього порівняння
 *
 * Якщо перше твердження виконується, друге виконується автоматично: однакові
 * числа дають однакові метрики, і розрив нуль. Само по собі це нічого не
 * доводить — скан, який не знаходить нічого **з обох боків**, теж дає розрив
 * нуль. Урок `T031` записаний тут прямо: перевірка мусить сама сказати, чи
 * було на що дивитись. Тому звірка окремо міряє **абсолютну** якість скану на
 * відкритих даних і оголошує порівняння порожнім, якщо вона не піднялась над
 * випадковою.
 *
 * # Незалежність
 *
 * Відкритий перерахунок написаний тут заново, з публічного опису рецепта:
 * пороги віку, кількість маркерів і поріг когорти оголошені в `encrypted-ixs`
 * і продубльовані в каталозі. Фільтри прогону беруться **з ланцюга**
 * (`Run.recipe_params`), а не з чужих слів: інакше звірка порівнювала б звіт з
 * перерахунком за іншими умовами й називала б це розбіжністю MPC.
 */

import { readFile } from 'node:fs/promises'
import type { Connection } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { decodeRun, decodeRunResult, fetchAccount } from './chain.ts'
import type { PlainRecord } from './no-plaintext.ts'
import { MIN_COHORT } from './no-plaintext.ts'
import type { Report, ReportLayout } from './report.ts'
import { decryptReport } from './report.ts'

export class ParityError extends Error {
  override readonly name = 'ParityError'
}

/** Пороги кумулятивних вікових лічильників. Публічні: оголошені в рецепті. */
export const AGE_THRESHOLDS = [20, 30, 40, 50, 60, 70, 80, 90] as const

/** Скільки маркерів вміщає профіль контуру. */
export const RECIPE_MARKERS = 64

/** «Будь-яке значення» у фільтрі: `sex` і `affected` це 0 або 1, тож 2 вільне. */
export const FILTER_ANY = 2

/** Скільки байтів займають параметри рецепта в акаунті прогону. */
export const RECIPE_PARAMS_LEN = 32

export interface RecipeFilters {
  minAge: number
  maxAge: number
  /** 0, 1 або `FILTER_ANY`. */
  sexFilter: number
  affectedFilter: number
}

/**
 * Розбирає `Run.recipe_params`.
 *
 * Хвіст мусить бути нулями, і це не педантизм: непорожній хвіст означає, що
 * клієнт поклав туди умову, якої рецепт не читає, — і відкритий перерахунок,
 * який її проігнорує, розійдеться зі звітом на рівному місці.
 */
export function decodeRecipeParams(raw: Uint8Array): RecipeFilters {
  if (raw.length !== RECIPE_PARAMS_LEN) {
    throw new ParityError(`параметри рецепта — ${RECIPE_PARAMS_LEN} байтів, отримано ${raw.length}`)
  }
  for (let at = 4; at < raw.length; at += 1) {
    if (raw[at] !== 0) throw new ParityError(`хвіст параметрів рецепта не нульовий на байті ${at}`)
  }

  const filters: RecipeFilters = {
    minAge: raw[0] ?? 0,
    maxAge: raw[1] ?? 0,
    sexFilter: raw[2] ?? FILTER_ANY,
    affectedFilter: raw[3] ?? FILTER_ANY,
  }
  for (const [name, value] of [
    ['статі', filters.sexFilter],
    ['ураженості', filters.affectedFilter],
  ] as const) {
    if (value !== 0 && value !== 1 && value !== FILTER_ANY) {
      throw new ParityError(`фільтр ${name} має бути 0, 1 або ${FILTER_ANY}, а не ${value}`)
    }
  }
  return filters
}

/** Те саме, що накопичує рецепт, — але порахованим відкрито. */
export interface OpenReport {
  included: number
  male: number
  affected: number
  ageAtLeast: number[]
  alleleSum: number[]
}

/** Чи входить запис у когорту за умовами прогону — дзеркало `counted` у контурі. */
export function counted(record: PlainRecord, filters: RecipeFilters): boolean {
  if (record.age < filters.minAge || record.age > filters.maxAge) return false
  if (filters.sexFilter !== FILTER_ANY && record.sex !== filters.sexFilter) return false
  if (filters.affectedFilter !== FILTER_ANY && record.affected !== filters.affectedFilter) {
    return false
  }
  return true
}

/**
 * Рахує звіт відкрито.
 *
 * Порядок дій той самий, що в контурі, і це важливо для `age_at_least`:
 * лічильники **кумулятивні**, тобто запис на 55 років збільшує всі пороги до
 * 50 включно, а не один кошик.
 */
export function computeOpen(records: readonly PlainRecord[], filters: RecipeFilters): OpenReport {
  const open: OpenReport = {
    included: 0,
    male: 0,
    affected: 0,
    ageAtLeast: Array.from({ length: AGE_THRESHOLDS.length }, () => 0),
    alleleSum: Array.from({ length: RECIPE_MARKERS }, () => 0),
  }

  for (const record of records) {
    if (!counted(record, filters)) continue

    open.included += 1
    open.male += record.sex
    open.affected += record.affected

    for (const [bin, threshold] of AGE_THRESHOLDS.entries()) {
      if (record.age >= threshold) open.ageAtLeast[bin] = (open.ageAtLeast[bin] ?? 0) + 1
    }
    for (let marker = 0; marker < RECIPE_MARKERS; marker += 1) {
      open.alleleSum[marker] = (open.alleleSum[marker] ?? 0) + (record.genotypes[marker] ?? 0)
    }
  }

  return open
}

/** Розбіжність в одному числі звіту. */
export interface Difference {
  field: string
  mpc: bigint
  open: number
}

/**
 * Зводить звіт MPC із відкритим перерахунком, число за числом.
 *
 * Придушений звіт звіряється **проти нулів**, а не проти перерахунку: при
 * когорті меншій за `MIN_COHORT` рецепт зобов'язаний віддати нулі, і звіт, що
 * збігся б із перерахунком, був би тут дефектом, а не збігом.
 */
export function compareReports(report: Report, open: OpenReport): Difference[] {
  const differences: Difference[] = []
  const suppressed = report.suppressed === 1n
  const expected = suppressed
    ? {
        included: 0,
        male: 0,
        affected: 0,
        ageAtLeast: open.ageAtLeast.map(() => 0),
        alleleSum: open.alleleSum.map(() => 0),
      }
    : open

  const check = (field: string, mpc: bigint, value: number): void => {
    if (mpc !== BigInt(value)) differences.push({ field, mpc, open: value })
  }

  check('included', report.included, expected.included)
  check('male', report.male, expected.male)
  check('affected', report.affected, expected.affected)
  for (const [bin, value] of expected.ageAtLeast.entries()) {
    check(`age_at_least[${bin}]`, report.ageAtLeast[bin] ?? -1n, value)
  }
  for (const [marker, value] of expected.alleleSum.entries()) {
    check(`allele_sum[${marker}]`, report.alleleSum[marker] ?? -1n, value)
  }

  // Придушення мусить збігатись із тим, що каже сам перерахунок: звіт, який
  // придушено при достатній когорті, — це втрачені дані, за які заплачено.
  if (suppressed !== open.included < MIN_COHORT) {
    differences.push({
      field: 'suppressed',
      mpc: report.suppressed,
      open: open.included < MIN_COHORT ? 1 : 0,
    })
  }

  return differences
}

/** Одна половина скану: скільки записів і скільки копій алеля на маркер. */
export interface ScanArm {
  included: number
  alleleSum: readonly number[]
}

export interface Scan {
  /** |частота серед уражених − частота серед неуражених| на кожен маркер. */
  scores: number[]
  /** Індекси маркерів за спаданням оцінки; за рівних — за зростанням індексу. */
  ranking: number[]
  /** Частка причинних маркерів, що потрапили в топ-k. */
  recallAtK: number
  /** Імовірність, що причинний маркер стоїть вище за випадковий непричинний. */
  auc: number
}

/**
 * Case-control скан за різницею частот алеля.
 *
 * Це рівно те, що покупець будує зі звіту: частота = `allele_sum / (2 ×
 * included)`, бо кожна особа несе дві копії. Нічого складнішого зі звіту й не
 * побудувати — друга достатня статистика `Σg²` прибрана з рецепта на `T030`,
 * тож розподіл генотипів недоступний.
 *
 * Порядок за рівних оцінок — за зростанням індексу маркера. Він
 * детермінований і однаковий з обох боків, тож на розрив не впливає; але при
 * читанні абсолютного числа про нього треба пам'ятати.
 */
export function associationScan(
  cases: ScanArm,
  controls: ScanArm,
  causalMarkers: readonly number[],
): Scan {
  if (cases.included === 0 || controls.included === 0) {
    throw new ParityError(
      `скан потребує обох плечей: уражених ${cases.included}, неуражених ${controls.included}`,
    )
  }

  const scores = Array.from({ length: RECIPE_MARKERS }, (_, marker) => {
    const caseFrequency = (cases.alleleSum[marker] ?? 0) / (2 * cases.included)
    const controlFrequency = (controls.alleleSum[marker] ?? 0) / (2 * controls.included)
    return Math.abs(caseFrequency - controlFrequency)
  })

  const ranking = scores
    .map((score, marker) => ({ score, marker }))
    .sort((left, right) => right.score - left.score || left.marker - right.marker)
    .map((entry) => entry.marker)

  const causal = new Set(causalMarkers)
  const top = ranking.slice(0, causal.size)
  const recallAtK =
    causal.size === 0 ? 0 : top.filter((marker) => causal.has(marker)).length / causal.size

  return { scores, ranking, recallAtK, auc: rankingAuc(scores, causal) }
}

/**
 * AUC ранжування: частка пар «причинний, непричинний», де причинний вищий.
 *
 * Рівні оцінки рахуються за половину — інакше скан, який усім маркерам дав
 * однакову оцінку, отримав би або 0, або 1 замість чесних 0,5.
 */
export function rankingAuc(scores: readonly number[], causal: ReadonlySet<number>): number {
  const positives: number[] = []
  const negatives: number[] = []
  for (const [marker, score] of scores.entries()) {
    ;(causal.has(marker) ? positives : negatives).push(score)
  }
  if (positives.length === 0 || negatives.length === 0) {
    throw new ParityError('AUC потребує і причинних, і непричинних маркерів')
  }

  let better = 0
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive > negative) better += 1
      else if (positive === negative) better += 0.5
    }
  }
  return better / (positives.length * negatives.length)
}

export interface ArmVerdict {
  label: string
  run: string
  filters: RecipeFilters
  /** Розбіжності «звіт MPC проти відкритого перерахунку». Порожньо — тотожність. */
  differences: Difference[]
  mpc: ScanArm
  open: ScanArm
}

export interface ParityVerdict {
  cases: ArmVerdict
  controls: ArmVerdict
  /** Скільки записів прочитано у власника. */
  records: number
  causalMarkers: number[]
  scanMpc: Scan
  scanOpen: Scan
  /** Розриви у відсоткових пунктах — те, що й міряє `SC-002`. */
  recallGapPoints: number
  aucGapPoints: number
  problems: string[]
}

export interface ParityArmOptions {
  label: string
  run: PublicKey
  buyerSecretKey: Uint8Array
}

export interface ParityOptions {
  connection: Connection
  programId: PublicKey
  cases: ParityArmOptions
  controls: ParityArmOptions
  mxePublicKey: Uint8Array
  layout: ReportLayout
  /** Відкриті записи датасету — те, що власник знає про себе. */
  records: readonly PlainRecord[]
  /** Причинні маркери з маніфесту генератора: `SC-002` міряється на синтетиці. */
  causalMarkers: readonly number[]
  /** Нижня межа абсолютної якості скану, нижче якої порівняння порожнє. */
  scanFloor: number
  /** Бюджет `SC-002` у відсоткових пунктах. */
  budgetPoints: number
}

/** Читає одне плече скану й одразу звіряє його з відкритим перерахунком. */
async function readArm(
  options: ParityOptions,
  arm: ParityArmOptions,
  resultAddress: PublicKey,
): Promise<ArmVerdict> {
  const run = decodeRun(await fetchAccount(options.connection, arm.run, `прогін «${arm.label}»`))
  const result = decodeRunResult(
    await fetchAccount(options.connection, resultAddress, `результат «${arm.label}»`),
  )

  const report = decryptReport({
    buyerSecretKey: arm.buyerSecretKey,
    mxePublicKey: options.mxePublicKey,
    nonce: result.nonce,
    ciphertexts: result.ciphertexts,
    layout: options.layout,
  })

  // Умови прогону — з ланцюга. Перерахунок за іншим фільтром розійшовся б зі
  // звітом, і виглядало б це як помилка MPC.
  const filters = decodeRecipeParams(run.recipeParams)
  const open = computeOpen(options.records, filters)

  return {
    label: arm.label,
    run: arm.run.toBase58(),
    filters,
    differences: compareReports(report, open),
    mpc: { included: Number(report.included), alleleSum: report.alleleSum.map(Number) },
    open: { included: open.included, alleleSum: open.alleleSum },
  }
}

const RESULT_SEED = new TextEncoder().encode('result')

/**
 * Проходить обидва плечі скану й міряє `SC-002`.
 *
 * Обидва прогони читаються з мережі й розшифровуються ключами покупця; відкрита
 * половина рахується тут же над записами власника. Жодне число з драйвера в
 * порівняння не потрапляє.
 */
export async function auditParity(options: ParityOptions): Promise<ParityVerdict> {
  const result = (run: PublicKey): PublicKey =>
    PublicKey.findProgramAddressSync([RESULT_SEED, run.toBuffer()], options.programId)[0]

  const cases = await readArm(options, options.cases, result(options.cases.run))
  const controls = await readArm(options, options.controls, result(options.controls.run))

  const scanMpc = associationScan(cases.mpc, controls.mpc, options.causalMarkers)
  const scanOpen = associationScan(cases.open, controls.open, options.causalMarkers)

  const recallGapPoints = Math.abs(scanMpc.recallAtK - scanOpen.recallAtK) * 100
  const aucGapPoints = Math.abs(scanMpc.auc - scanOpen.auc) * 100

  const problems: string[] = []
  for (const arm of [cases, controls]) {
    for (const difference of arm.differences.slice(0, 8)) {
      problems.push(
        `«${arm.label}»: ${difference.field} — MPC ${difference.mpc}, відкрито ${difference.open}`,
      )
    }
    if (arm.differences.length > 8) {
      problems.push(`«${arm.label}»: і ще ${arm.differences.length - 8} розбіжностей`)
    }
  }

  if (recallGapPoints > options.budgetPoints) {
    problems.push(
      `розрив повноти ${recallGapPoints.toFixed(1)} п.п. більший за бюджет ${options.budgetPoints}`,
    )
  }
  if (aucGapPoints > options.budgetPoints) {
    problems.push(
      `розрив AUC ${aucGapPoints.toFixed(1)} п.п. більший за бюджет ${options.budgetPoints}`,
    )
  }

  // Сторож проти порожнього порівняння: скан, що нічого не знаходить з обох
  // боків, дає розрив нуль і не доводить нічого. Це не критерій SPEC, а межа
  // осмисленості вимірювання, і вона мусить бути названа числом.
  if (scanOpen.auc < options.scanFloor) {
    problems.push(
      `скан на відкритих даних дає AUC ${scanOpen.auc.toFixed(3)} при межі ${options.scanFloor} — ` +
        'порівнювати нема чого: розрив нуль тут означав би лише те, що обидві сторони мовчать',
    )
  }

  return {
    cases,
    controls,
    records: options.records.length,
    causalMarkers: [...options.causalMarkers],
    scanMpc,
    scanOpen,
    recallGapPoints,
    aucGapPoints,
    problems,
  }
}

/**
 * Читає датасет власника з NDJSON.
 *
 * Формат — вивід `tools/gen-dataset`: по запису на рядок. Читається як **дані**,
 * а не через наш пакет: звіряч, що імпортує генератор, звіряв би генератор із
 * самим собою.
 */
export async function readRecords(path: string): Promise<PlainRecord[]> {
  const text = await readFile(path, 'utf8')
  const records: PlainRecord[] = []

  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue
    const raw: unknown = JSON.parse(line)
    if (typeof raw !== 'object' || raw === null) {
      throw new ParityError(`рядок ${index + 1} датасету не об'єкт`)
    }
    const entry = raw as Record<string, unknown>
    const number = (name: string): number => {
      const value = entry[name]
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new ParityError(`рядок ${index + 1}: поле «${name}» не ціле число`)
      }
      return value
    }
    const genotypes = entry.genotypes
    if (!Array.isArray(genotypes) || genotypes.some((value) => typeof value !== 'number')) {
      throw new ParityError(`рядок ${index + 1}: генотипи мають бути масивом чисел`)
    }
    if (genotypes.length < RECIPE_MARKERS) {
      throw new ParityError(
        `рядок ${index + 1}: маркерів ${genotypes.length}, а рецепт читає ${RECIPE_MARKERS}`,
      )
    }
    records.push({
      sex: number('sex'),
      age: number('age'),
      affected: number('affected'),
      genotypes: genotypes.map((value: number) => value),
    })
  }

  if (records.length === 0) throw new ParityError('датасет порожній')
  return records
}
