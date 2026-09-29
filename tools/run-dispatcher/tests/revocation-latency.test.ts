import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { revocationPlanSchema } from '../src/revocation-latency.ts'

/**
 * The revocation latency plan (`T042`, `SC-005`).
 *
 * The driver refuses a plan that could not show the criterion either way: a
 * stream that stops before the budget runs out, a cadence too coarse for the
 * gap rule, or an order the consent never allowed — that last one would be
 * refused before any revocation and "measure" a gate that was never open.
 */

async function plan(): Promise<Record<string, unknown>> {
  const raw = await readFile(
    new URL('../../../fixtures/revocation-latency.json', import.meta.url),
    'utf8',
  )
  return JSON.parse(raw) as Record<string, unknown>
}

function issues(value: unknown): string[] {
  const result = revocationPlanSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('the committed plan', () => {
  it('is valid and watches past the budget', async () => {
    const parsed = revocationPlanSchema.parse(await plan())
    expect(parsed.trials).toBe(10)
    expect(parsed.afterSeconds).toBeGreaterThan(parsed.budgetSeconds)
  })
})

describe('plans that could not show the criterion', () => {
  it('a stream that stops at the budget', async () => {
    expect(issues({ ...(await plan()), afterSeconds: 60 })).toEqual([
      'the stream must outlast the budget: 60 s after, budget 60 s',
    ])
  })

  it('a cadence too coarse for the gap rule', async () => {
    expect(issues({ ...(await plan()), probeIntervalMs: 2_000 })).toEqual([
      'orders every 2000 ms cannot keep gaps under 3 s',
    ])
  })

  it('fewer than two orders before the revocation', async () => {
    expect(issues({ ...(await plan()), beforeSeconds: 0.5 })).toEqual([
      'fewer than two orders fit before the revocation',
    ])
  })

  it('an order the consent does not allow', async () => {
    const base = await plan()
    expect(
      issues({ ...base, order: { useType: 'cardiology', buyerCategory: 'academic' } }),
    ).toEqual(['the consent does not allow cardiology'])
    expect(
      issues({ ...base, order: { useType: 'oncology', buyerCategory: 'commercial' } }),
    ).toEqual(['the consent does not allow commercial'])
    const forbidden = { ...(base.consent as object), forbidden: ['oncology'] }
    expect(issues({ ...base, consent: forbidden })).toEqual(['the consent does not allow oncology'])
  })

  it('a plan for another criterion', async () => {
    expect(issues({ ...(await plan()), criterion: 'SC-004' }).length).toBeGreaterThan(0)
  })
})
