import { describe, expect, it } from 'vitest'
import {
  CanaryError,
  canaryRecords,
  MIN_COHORT,
  MIN_CONTRIBUTION,
  planRuns,
} from '../src/canary.ts'
import { SMALL_POOL } from '../src/corpus.ts'
import { RECIPE_MARKERS } from '../src/layout.ts'
import { syntheticRecords } from '../src/scenario.ts'

/**
 * Канарка має сенс рівно доти, доки її не можна сплутати з шумом, а корпус —
 * доки в ньому справді є два межові прогони. І перше, і друге залежить від
 * даних, а не від наміру, тож перевіряється числом.
 */

const CANARY_SEED = 0x5ca1ab1e

function smallPool() {
  return [
    canaryRecords(SMALL_POOL[0], CANARY_SEED),
    syntheticRecords(SMALL_POOL[1], 11),
    syntheticRecords(SMALL_POOL[2], 12),
  ]
}

describe('канарковий датасет', () => {
  it('відтворюється з зерна', () => {
    expect(canaryRecords(12, CANARY_SEED)).toEqual(canaryRecords(12, CANARY_SEED))
  })

  it('дає унікальний вік на кожен запис — інакше вікном його не розрізати', () => {
    const ages = canaryRecords(12, CANARY_SEED).map((record) => record.age)
    expect(new Set(ages).size).toBe(ages.length)
  })

  it('генотипи не повторюють період-3 синтетичного генератора', () => {
    const record = canaryRecords(1, CANARY_SEED)[0]
    if (record === undefined) throw new Error('канарка порожня')
    expect(record.genotypes).toHaveLength(RECIPE_MARKERS)

    // `(base + 31·marker) mod 3` дає точний період три. Канарка не повинна.
    const periodic = record.genotypes.every(
      (value, index) => index < 3 || value === record.genotypes[index - 3],
    )
    expect(periodic).toBe(false)
  })

  it('вікно з 24 генотипів жодного разу не повторюється в пулі', () => {
    const windows = new Set<string>()
    let total = 0
    for (const records of smallPool()) {
      for (const record of records) {
        for (let at = 0; at + 24 <= record.genotypes.length; at += 1) {
          windows.add(record.genotypes.slice(at, at + 24).join(''))
          total += 1
        }
      }
    }
    // Синтетичні датасети періодичні за побудовою, тож збіги там законні;
    // важливо, що канаркові вікна не збігаються ні з чим, включно між собою.
    const canaryWindows = new Set<string>()
    const canary = canaryRecords(SMALL_POOL[0], CANARY_SEED)
    for (const record of canary) {
      for (let at = 0; at + 24 <= record.genotypes.length; at += 1) {
        canaryWindows.add(record.genotypes.slice(at, at + 24).join(''))
      }
    }
    expect(canaryWindows.size).toBe(canary.length * (RECIPE_MARKERS - 24 + 1))
    expect(windows.size).toBeLessThanOrEqual(total)
  })
})

describe('план корпусу', () => {
  it('дає десять різних наборів умов', () => {
    const variants = planRuns(smallPool())
    expect(variants).toHaveLength(10)
    expect(new Set(variants.map((variant) => variant.label)).size).toBe(10)
  })

  it('має прогін, у якому когорта нижча за поріг', () => {
    const variants = planRuns(smallPool())
    const below = variants.filter(
      (variant) => variant.expectedCohort > 0 && variant.expectedCohort < MIN_COHORT,
    )
    expect(below.length).toBeGreaterThan(0)
  })

  it('має прогін, у якому когорта достатня, а всі внески нижчі за поріг', () => {
    const silent = planRuns(smallPool()).find(
      (variant) =>
        variant.expectedCohort >= MIN_COHORT &&
        variant.expectedPerDataset.every((count) => count < MIN_CONTRIBUTION),
    )
    expect(silent).toBeDefined()
  })

  it('відмовляє, коли пул не дає межових вікон', () => {
    // Один датасет із однаковим віком: ніяке вікно не відріже частину пулу.
    const flat = [
      Array.from({ length: 30 }, () => ({
        sex: 0 as const,
        age: 40,
        affected: 0 as const,
        genotypes: Array(RECIPE_MARKERS).fill(0),
      })),
    ]
    expect(() => planRuns(flat)).toThrow(CanaryError)
  })
})
