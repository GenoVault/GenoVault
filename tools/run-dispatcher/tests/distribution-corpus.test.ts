import { describe, expect, it } from 'vitest'
import { counts, MIN_CONTRIBUTION } from '../src/canary.ts'
import {
  checkPools,
  DISTRIBUTION_OWNERS,
  DistributionCorpusError,
  distributionPools,
  MEASURED_RUNS,
  ownerCount,
} from '../src/distribution-corpus.ts'

/**
 * The corpus of `SC-007` is the worst case for the distribution: full pools of
 * 50, everyone above the floor, a fresh pool per measured run. A plan that
 * quietly lost one of those would let the auditor time an easier run.
 */

const ALL = { minAge: 0, maxAge: 255, sex: 'any', affected: 'any' } as const

describe('the plan of SC-007', () => {
  const pools = distributionPools()

  it('has one full pool per measured run', () => {
    expect(pools).toHaveLength(MEASURED_RUNS)
    for (const pool of pools) expect(pool.records).toHaveLength(DISTRIBUTION_OWNERS)
    expect(ownerCount()).toBe(DISTRIBUTION_OWNERS * MEASURED_RUNS)
  })

  it('puts every dataset above the floor under the run’s filter', () => {
    for (const pool of pools) {
      expect(counts(pool.records, ALL).every((count) => count >= MIN_CONTRIBUTION)).toBe(true)
    }
    expect(() => checkPools(pools)).not.toThrow()
  })

  it('gives every dataset a price of its own, and an odd one', () => {
    const prices = pools.flatMap((pool) => pool.pricesPer1k)
    expect(new Set(prices).size).toBe(prices.length)
    expect(prices.every((price) => price % 2n === 1n)).toBe(true)
  })

  it('does not reuse records between pools', () => {
    const first = JSON.stringify(pools[0]?.records[0])
    expect(pools.slice(1).every((pool) => JSON.stringify(pool.records[0]) !== first)).toBe(true)
  })

  it('refuses a pool with a dataset under the floor', () => {
    const [pool] = distributionPools(1)
    if (pool === undefined) throw new Error('no pool')
    const short = {
      ...pool,
      records: [pool.records[0]?.slice(0, 9) ?? [], ...pool.records.slice(1)],
    }
    expect(() => checkPools([short])).toThrow(DistributionCorpusError)
  })

  it('refuses a pool short of 50', () => {
    const [pool] = distributionPools(1)
    if (pool === undefined) throw new Error('no pool')
    expect(() => checkPools([{ ...pool, records: pool.records.slice(1) }])).toThrow(
      'has 49 datasets, not 50',
    )
  })
})
