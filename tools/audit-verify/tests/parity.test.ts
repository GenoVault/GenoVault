import { generateDataset } from '@genovault/gen-dataset'
import { describe, expect, it } from 'vitest'
import type { PlainRecord } from '../src/no-plaintext.ts'
import {
  AGE_THRESHOLDS,
  associationScan,
  compareReports,
  computeOpen,
  counted,
  decodeRecipeParams,
  FILTER_ANY,
  ParityError,
  RECIPE_MARKERS,
  type RecipeFilters,
  rankingAuc,
} from '../src/parity.ts'
import type { Report } from '../src/report.ts'

/**
 * `SC-002` тримається на двох властивостях, і обидві перевіряються з обох боків.
 *
 * Відкритий перерахунок мусить збігатись зі звітом, коли той чесний, і
 * **розходитись**, коли звіт зіпсовано на одне число. Скан мусить знаходити
 * причинні маркери там, де вони є, і не знаходити там, де їх немає, — інакше
 * розрив нуль між двома мовчазними сканами читався б як пройдений критерій.
 *
 * `@genovault/gen-dataset` тут — еталон із `devDependencies`; у рантайм звіряча
 * він не потрапляє (`independence.test.ts`).
 */

const ANY_FILTER: RecipeFilters = {
  minAge: 0,
  maxAge: 255,
  sexFilter: FILTER_ANY,
  affectedFilter: FILTER_ANY,
}

function params(bytes: readonly number[]): Uint8Array {
  const raw = new Uint8Array(32)
  raw.set(bytes, 0)
  return raw
}

/**
 * Три різні записи, повторені чотири рази.
 *
 * Дванадцять, а не три: когорта нижча за `MIN_COHORT` зобов'язана бути
 * придушеною, і звірка на такій фікстурі перевіряла б придушення замість
 * тотожності чисел.
 */
function records(): PlainRecord[] {
  const pattern: PlainRecord[] = [
    { sex: 1, age: 25, affected: 1, genotypes: Array.from({ length: RECIPE_MARKERS }, () => 1) },
    { sex: 0, age: 55, affected: 0, genotypes: Array.from({ length: RECIPE_MARKERS }, () => 2) },
    { sex: 1, age: 95, affected: 1, genotypes: Array.from({ length: RECIPE_MARKERS }, () => 0) },
  ]
  return Array.from({ length: 4 }, () => pattern).flat()
}

function report(overrides: Partial<Report>): Report {
  return {
    included: 0n,
    suppressed: 0n,
    male: 0n,
    affected: 0n,
    ageAtLeast: Array.from({ length: AGE_THRESHOLDS.length }, () => 0n),
    alleleSum: Array.from({ length: RECIPE_MARKERS }, () => 0n),
    ...overrides,
  }
}

describe('параметри рецепта з ланцюга', () => {
  it('читає вікно й обидва фільтри', () => {
    expect(decodeRecipeParams(params([18, 45, 1, 0]))).toEqual({
      minAge: 18,
      maxAge: 45,
      sexFilter: 1,
      affectedFilter: 0,
    })
  })

  it('непорожній хвіст валить розбір', () => {
    const raw = params([0, 255, FILTER_ANY, FILTER_ANY])
    raw[9] = 1
    expect(() => decodeRecipeParams(raw)).toThrow(ParityError)
  })

  it('невідоме значення фільтра валить розбір', () => {
    expect(() => decodeRecipeParams(params([0, 255, 3, FILTER_ANY]))).toThrow(ParityError)
  })
})

describe('відкритий перерахунок', () => {
  it('кумулятивні вікові лічильники, а не кошики', () => {
    const open = computeOpen(records(), ANY_FILTER)
    // Вік 25, 55, 95 по чотири рази; пороги 20/30/40/50/60/70/80/90.
    expect(open.included).toBe(12)
    expect(open.ageAtLeast).toEqual([12, 8, 8, 8, 4, 4, 4, 4])
  })

  it('фільтр ураженості ріже когорту так само, як контур', () => {
    const cases = computeOpen(records(), { ...ANY_FILTER, affectedFilter: 1 })
    const controls = computeOpen(records(), { ...ANY_FILTER, affectedFilter: 0 })

    expect(cases.included).toBe(8)
    expect(controls.included).toBe(4)
    expect(cases.male).toBe(8)
    // Σ генотипів по маркеру 0: уражені 4×1 + 4×0, неуражені 4×2.
    expect(cases.alleleSum[0]).toBe(4)
    expect(controls.alleleSum[0]).toBe(8)
  })

  it('вікове вікно виключає записи з обох боків', () => {
    const open = computeOpen(records(), { ...ANY_FILTER, minAge: 30, maxAge: 60 })
    expect(open.included).toBe(4)
    expect(counted(records()[0] as PlainRecord, { ...ANY_FILTER, minAge: 30, maxAge: 60 })).toBe(
      false,
    )
  })
})

describe('звірка звіту з перерахунком', () => {
  it('чесний звіт розбіжностей не дає', () => {
    const open = computeOpen(records(), ANY_FILTER)
    const honest = report({
      included: BigInt(open.included),
      male: BigInt(open.male),
      affected: BigInt(open.affected),
      ageAtLeast: open.ageAtLeast.map((value) => BigInt(value)),
      alleleSum: open.alleleSum.map((value) => BigInt(value)),
    })
    expect(compareReports(honest, open)).toEqual([])
  })

  it('одне зіпсоване число знаходиться й називається', () => {
    const open = computeOpen(records(), ANY_FILTER)
    const sums = open.alleleSum.map((value) => BigInt(value))
    sums[7] = (sums[7] ?? 0n) + 1n

    const differences = compareReports(
      report({
        included: BigInt(open.included),
        male: BigInt(open.male),
        affected: BigInt(open.affected),
        ageAtLeast: open.ageAtLeast.map((value) => BigInt(value)),
        alleleSum: sums,
      }),
      open,
    )

    expect(differences).toHaveLength(1)
    expect(differences[0]?.field).toBe('allele_sum[7]')
  })

  it('придушений звіт звіряється проти нулів, а не проти перерахунку', () => {
    // Когорта 3 < MIN_COHORT: звіт зобов'язаний бути нульовим.
    const open = computeOpen(records().slice(0, 3), ANY_FILTER)
    expect(compareReports(report({ suppressed: 1n }), open)).toEqual([])
  })

  it('придушення при достатній когорті — розбіжність', () => {
    const open = computeOpen(records(), ANY_FILTER)
    const differences = compareReports(report({ suppressed: 1n }), open)
    expect(differences.some((entry) => entry.field === 'suppressed')).toBe(true)
  })
})

describe('скан і його метрики', () => {
  it('AUC половина, коли всі оцінки однакові', () => {
    const flat = Array.from({ length: RECIPE_MARKERS }, () => 0.5)
    expect(rankingAuc(flat, new Set([0, 1, 2]))).toBe(0.5)
  })

  it('AUC одиниця, коли причинні маркери стоять найвище', () => {
    const scores = Array.from({ length: RECIPE_MARKERS }, (_, marker) => (marker < 3 ? 1 : 0))
    expect(rankingAuc(scores, new Set([0, 1, 2]))).toBe(1)
  })

  it('знаходить причинні маркери на даних генератора', () => {
    const generated = generateDataset({
      records: 400,
      markers: RECIPE_MARKERS,
      causalMarkers: 5,
      seed: 7,
      effectSize: 0.8,
    })
    const causal = generated.manifest.groundTruth.causalMarkers
    const plain: PlainRecord[] = generated.records.map((record) => ({
      sex: record.sex,
      age: record.age,
      affected: record.affected,
      genotypes: record.genotypes,
    }))

    const cases = computeOpen(plain, { ...ANY_FILTER, affectedFilter: 1 })
    const controls = computeOpen(plain, { ...ANY_FILTER, affectedFilter: 0 })
    const scan = associationScan(cases, controls, causal)

    // Сторож проти порожнього порівняння: якщо скан не піднімається над
    // випадковим, розрив нуль у `SC-002` не означає нічого.
    expect(scan.auc).toBeGreaterThan(0.75)
    expect(scan.recallAtK).toBeGreaterThan(0.5)
  })

  it('нічого не знаходить там, де причинних маркерів немає', () => {
    // Ті самі записи в обох плечах: різниця частот нульова скрізь, і скан
    // мусить чесно сказати «випадково», а не вигадати сигнал.
    const arm = { included: 100, alleleSum: Array.from({ length: RECIPE_MARKERS }, () => 50) }
    const scan = associationScan(arm, arm, [0, 1, 2, 3, 4])
    expect(scan.auc).toBe(0.5)
  })

  it('відмовляє на порожньому плечі', () => {
    const arm = { included: 0, alleleSum: Array.from({ length: RECIPE_MARKERS }, () => 0) }
    expect(() => associationScan(arm, arm, [0])).toThrow(ParityError)
  })
})
