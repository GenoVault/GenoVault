/**
 * Корпус прогонів під `SC-001` — канарковий датасет і десять різних умов (`T031`).
 *
 * # Навіщо канарка
 *
 * Звіряч шукає у ланцюгу відкриті записи, і шукати він може тільки те, що знає.
 * Знає він рівно одне — **власні записи**, бо виступає власником датасету. Тому
 * в пул кладеться датасет, чиї записи згенеровані так, щоб влучання не можна
 * було сплутати з шумом: рядок генотипів у ньому **випадковий**, а не
 * породжений формулою.
 *
 * Різниця не косметична. `syntheticRecords` із `scenario.ts` робить генотипи як
 * `(base + 31·marker) mod 3` — послідовність із періодом три, яка збігається в
 * різних записах і в різних датасетах. Голка з такої послідовності влучала б у
 * будь-що. Вікно з 24 випадкових генотипів має 3²⁴ ≈ 2,8·10¹¹ станів, і
 * випадковий збіг на мегабайтах ланцюга — це подія з імовірністю 10⁻⁵.
 *
 * # Навіщо десять прогонів
 *
 * `SC-001` вимагає набір із десяти, і продуктове рішення 2026-09-14 читає це як
 * **різноманіття умов**, а не обсяг: обсяг це `SC-003`, і він міряється окремо.
 * Тому десять прогонів — це десять різних наборів фільтрів над одним пулом,
 * серед них два обчислені під конкретні межі:
 *
 * - прогін, у якому когорта **менша за `MIN_COHORT`**: агрегат по кількох
 *   записах і є ті записи, тож звіт мусить бути придушеним;
 * - прогін, у якому когорта достатня, але **кожен** датасет нижчий за
 *   `MIN_CONTRIBUTION`: внесок «3 записи» сказав би про власника більше, ніж
 *   увесь звіт (`T027a`).
 *
 * Вікна під ці дві умови не вигадуються, а **шукаються** по відкритих записах
 * пулу: набір даних змінюється разом із зерном, і зашитий діапазон розійшовся б
 * із ним мовчки.
 */

import type { DatasetRecord } from '@genovault/crypto'
import type { FrequenciesParams } from '@genovault/shared'
import { RECIPE_MARKERS } from './layout.ts'

export class CanaryError extends Error {
  override readonly name = 'CanaryError'
}

/** Дзеркала порогів рецепта — вони ж публічні числа каталогу. */
export const MIN_COHORT = 10
export const MIN_CONTRIBUTION = MIN_COHORT

/** Найбільший вік, який має сенс перебирати: рецепт бере `u8`, люди — менше. */
const MAX_AGE = 120

/**
 * Детермінований xorshift32.
 *
 * Потрібна саме **відтворюваність із високою ентропією**: перезапуск корпусу
 * має дати ті самі записи (інакше нічим звіряти впале влучання), а
 * послідовність — не мати періоду, помітного оком.
 */
function xorshift32(seed: number): () => number {
  let state = seed | 0 || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
}

/**
 * Канарковий датасет: випадкові генотипи, унікальний вік на кожен запис.
 *
 * Унікальний вік — не прикраса: саме за віковим вікном шукаються дві межові
 * умови корпусу, і датасет, у якому вік повторюється, різати вікном ніяк.
 */
export function canaryRecords(count: number, seed: number): DatasetRecord[] {
  const next = xorshift32(seed)
  return Array.from({ length: count }, (_, index) => ({
    sex: (next() % 2) as 0 | 1,
    age: 20 + index,
    affected: (next() % 2) as 0 | 1,
    genotypes: Array.from({ length: RECIPE_MARKERS }, () => next() % 3),
  }))
}

/** Умови одного прогону корпусу. */
export interface RunVariant {
  label: string
  params: FrequenciesParams
  /** Скільки записів очікуємо в когорті — рахується з відкритих даних пулу. */
  expectedCohort: number
  /** Скільки записів очікуємо від кожного датасету. */
  expectedPerDataset: number[]
}

/**
 * Фільтр рецепта, відтворений над відкритими записами.
 *
 * Це **драйвер**, а не звіряч: тут дзеркалити рецепт можна й треба, бо
 * інакше нічим було б обрати вікно під потрібну межу. Звіряч цього коду не
 * бачить і бачити не має (`FR-025`).
 */
function passes(record: DatasetRecord, params: FrequenciesParams): boolean {
  if (record.age < params.minAge || record.age > params.maxAge) return false
  if (params.sex === 'male' && record.sex !== 1) return false
  if (params.sex === 'female' && record.sex !== 0) return false
  if (params.affected === 'affected' && record.affected !== 1) return false
  if (params.affected === 'unaffected' && record.affected !== 0) return false
  return true
}

function counts(pool: readonly (readonly DatasetRecord[])[], params: FrequenciesParams): number[] {
  return pool.map((records) => records.filter((record) => passes(record, params)).length)
}

function variant(
  label: string,
  params: FrequenciesParams,
  pool: readonly (readonly DatasetRecord[])[],
): RunVariant {
  const perDataset = counts(pool, params)
  return {
    label,
    params,
    expectedCohort: perDataset.reduce((total, count) => total + count, 0),
    expectedPerDataset: perDataset,
  }
}

/** Перебирає вікові вікна, поки не знайде те, що задовольняє умову. */
function findWindow(
  pool: readonly (readonly DatasetRecord[])[],
  accept: (perDataset: readonly number[], total: number) => boolean,
): FrequenciesParams | null {
  for (let minAge = 0; minAge <= MAX_AGE; minAge += 1) {
    for (let maxAge = minAge; maxAge <= MAX_AGE; maxAge += 1) {
      const params: FrequenciesParams = { minAge, maxAge, sex: 'any', affected: 'any' }
      const perDataset = counts(pool, params)
      const total = perDataset.reduce((sum, count) => sum + count, 0)
      if (accept(perDataset, total)) return params
    }
  }
  return null
}

/**
 * Десять наборів умов над одним пулом.
 *
 * Вісім фіксованих — це те, що покупець замовляє щодня; два обчислені — межі,
 * заради яких `SC-001` і не зводиться до пошуку байтів.
 */
export function planRuns(pool: readonly (readonly DatasetRecord[])[]): RunVariant[] {
  const any = { sex: 'any', affected: 'any' } as const
  const allAges = { minAge: 0, maxAge: 255 } as const

  const fixed: RunVariant[] = [
    variant('без фільтрів', { ...allAges, ...any }, pool),
    variant('чоловіки', { ...allAges, sex: 'male', affected: 'any' }, pool),
    variant('жінки', { ...allAges, sex: 'female', affected: 'any' }, pool),
    variant('уражені', { ...allAges, sex: 'any', affected: 'affected' }, pool),
    variant('неуражені', { ...allAges, sex: 'any', affected: 'unaffected' }, pool),
    variant('вік 18…45', { minAge: 18, maxAge: 45, ...any }, pool),
    variant('вік 46…120', { minAge: 46, maxAge: 120, ...any }, pool),
    variant('чоловіки, уражені', { ...allAges, sex: 'male', affected: 'affected' }, pool),
  ]

  // Когорта, достатня для звіту, але жоден датасет не дотягує до порога
  // внеску. Саме цей випадок `T027a` і розбирав на стенді; тут він живий.
  const silent = findWindow(
    pool,
    (perDataset, total) =>
      total >= MIN_COHORT && perDataset.every((count) => count < MIN_CONTRIBUTION),
  )
  if (silent === null) {
    throw new CanaryError(
      'у пулі немає вікового вікна, де когорта достатня, а всі внески нижчі за поріг — ' +
        'зміни розміри датасетів',
    )
  }

  // Когорта менша за поріг: звіт мусить бути придушеним, інакше він і є
  // набір сирих записів.
  const belowCohort = findWindow(pool, (_, total) => total > 0 && total < MIN_COHORT)
  if (belowCohort === null) {
    throw new CanaryError('у пулі немає вікового вікна з когортою 1…9 — зміни розміри датасетів')
  }

  return [
    ...fixed,
    variant('усі мовчать (внески нижчі за поріг)', silent, pool),
    variant('когорта нижча за поріг', belowCohort, pool),
  ]
}
