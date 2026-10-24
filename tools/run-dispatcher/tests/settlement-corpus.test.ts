import { describe, expect, it } from 'vitest'
import { MIN_COHORT, MIN_CONTRIBUTION } from '../src/canary.ts'
import {
  datasetCount,
  planSettlementRuns,
  poolRecords,
  SETTLEMENT_POOLS,
  SettlementCorpusError,
} from '../src/settlement-corpus.ts'

/**
 * The live set is worth its half hour only if every shape is really in it.
 * Which shape a run gets depends on the records, not on the label, so it is
 * checked here by numbers, before anything is encrypted.
 */

function pools() {
  return new Map(SETTLEMENT_POOLS.map((spec) => [spec.name, poolRecords(spec)]))
}

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

describe('SC-006 corpus plan', () => {
  it('has every shape the MPC decides', () => {
    const runs = planSettlementRuns(pools())
    expect(new Set(runs.map((run) => run.aim))).toEqual(
      new Set(['exact', 'surplus', 'silent', 'suppressed', 'ceiling']),
    )
  })

  it('pays five owners above the floor in one run (T046)', () => {
    const [exact] = planSettlementRuns(pools())
    expect(exact?.expectedPerDataset).toHaveLength(5)
    expect(exact?.expectedPerDataset.every((n) => n >= MIN_CONTRIBUTION)).toBe(true)
  })

  it('puts more than one dataset under the floor in the surplus run', () => {
    const surplus = planSettlementRuns(pools()).find(
      (run) => run.pool === 'five' && run.aim === 'surplus',
    )
    const perDataset = surplus?.expectedPerDataset ?? []
    expect(perDataset.filter((n) => n > 0 && n < MIN_CONTRIBUTION).length).toBeGreaterThanOrEqual(2)
    expect(perDataset.some((n) => n >= MIN_CONTRIBUTION)).toBe(true)
  })

  it('reveals the silent pool and suppresses the small cohort', () => {
    const runs = planSettlementRuns(pools())
    const silent = runs.find((run) => run.aim === 'silent')?.expectedPerDataset ?? []
    const suppressed = runs.find((run) => run.aim === 'suppressed')?.expectedPerDataset ?? []
    expect(sum(silent)).toBeGreaterThanOrEqual(MIN_COHORT)
    expect(silent.every((n) => n < MIN_CONTRIBUTION)).toBe(true)
    expect(sum(suppressed)).toBeGreaterThan(0)
    expect(sum(suppressed)).toBeLessThan(MIN_COHORT)
  })

  it('has a dataset of one person next to a clinic', () => {
    const run = planSettlementRuns(pools()).find((entry) => entry.pool === 'individual')
    expect(run?.expectedPerDataset).toEqual([12, 9, 1])
  })

  it('makes the pool average overshoot the escrow in the ceiling run', () => {
    const spec = SETTLEMENT_POOLS.find((entry) => entry.name === 'ceiling')
    const run = planSettlementRuns(pools()).find((entry) => entry.aim === 'ceiling')
    expect(spec).toBeDefined()
    expect(run).toBeDefined()
    if (spec === undefined || run === undefined) return
    const ceil = (n: bigint, d: bigint) => (n === 0n ? 0n : (n - 1n) / d + 1n)
    const escrow = spec.sizes.reduce(
      (total, size, i) => total + ceil((spec.pricesPer1k[i] ?? 0n) * BigInt(size), 1000n),
      0n,
    )
    const per = run.expectedPerDataset.map(BigInt)
    const contributed = per[0] ?? 0n
    const records = per.reduce((total, n) => total + n, 0n)
    const bill = ceil((spec.pricesPer1k[0] ?? 0n) * contributed * records, contributed * 1000n)
    expect(bill).toBeGreaterThan(escrow)
  })

  it('needs one fresh owner per dataset', () => {
    expect(datasetCount()).toBe(10)
  })

  it('refuses a pool that has lost its shape', () => {
    const broken = pools()
    broken.set('five', [[], [], [], [], []])
    expect(() => planSettlementRuns(broken)).toThrow(SettlementCorpusError)
  })
})
