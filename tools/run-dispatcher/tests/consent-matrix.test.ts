import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { consentMatrixSchema, MATRIX_SIZE, PER_LABEL } from '../src/consent-matrix.ts'

/**
 * The consent matrix fixture (`T041`, `SC-004`).
 *
 * The driver refuses to run a matrix that is not the one `SC-004` names. Each
 * rule below would otherwise let the run go ahead and print a verdict about a
 * different set: eleven refusals, a refusal with no reason to check, one
 * scenario passing on another's consent.
 */

type Fixture = {
  criterion: string
  note: string
  scenarios: Record<string, unknown>[]
}

async function fixture(): Promise<Fixture> {
  const raw = await readFile(
    new URL('../../../fixtures/consent-matrix.json', import.meta.url),
    'utf8',
  )
  return JSON.parse(raw) as Fixture
}

function withScenario(base: Fixture, index: number, patch: Record<string, unknown>): Fixture {
  return {
    ...base,
    scenarios: base.scenarios.map((scenario, at) =>
      at === index ? { ...scenario, ...patch } : scenario,
    ),
  }
}

function issues(value: unknown): string[] {
  const result = consentMatrixSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map((issue) => issue.message)
}

describe('the committed matrix', () => {
  it('is the set SC-004 names', async () => {
    const matrix = consentMatrixSchema.parse(await fixture())
    expect(matrix.scenarios).toHaveLength(MATRIX_SIZE)
    for (const label of ['allowed', 'refused'] as const) {
      expect(matrix.scenarios.filter((scenario) => scenario.label === label)).toHaveLength(
        PER_LABEL,
      )
    }
  })

  it('covers every consent reason the product names at least once', async () => {
    const matrix = consentMatrixSchema.parse(await fixture())
    const reasons = new Set(matrix.scenarios.map((scenario) => scenario.reason))
    for (const reason of [
      'no-consent',
      'revoked',
      'expired',
      'use-forbidden',
      'use-not-allowed',
      'category-not-allowed',
    ]) {
      expect(reasons, reason).toContain(reason)
    }
  })
})

describe('a matrix that is not that set is refused', () => {
  it('nineteen scenarios', async () => {
    const base = await fixture()
    expect(issues({ ...base, scenarios: base.scenarios.slice(1) }).join()).toMatch(/names 20/)
  })

  it('eleven refusals', async () => {
    const base = await fixture()
    const index = base.scenarios.findIndex((scenario) => scenario.label === 'allowed')
    const tilted = withScenario(base, index, { label: 'refused', reason: 'use-not-allowed' })
    expect(issues(tilted).join()).toMatch(/10 allowed/)
  })

  it('a refusal without its reason, an allowance with one', async () => {
    const base = await fixture()
    const refused = base.scenarios.findIndex((scenario) => scenario.label === 'refused')
    const allowed = base.scenarios.findIndex((scenario) => scenario.label === 'allowed')
    expect(issues(withScenario(base, refused, { reason: null })).join()).toMatch(/must name/)
    expect(issues(withScenario(base, allowed, { reason: 'revoked' })).join()).toMatch(/no reason/)
  })

  it('two scenarios on one dataset', async () => {
    const base = await fixture()
    const shared = withScenario(base, 1, { pool: base.scenarios[0]?.pool })
    expect(issues(shared).join()).toMatch(/used twice/)
  })

  it('a revocation with nothing to revoke', async () => {
    const base = await fixture()
    const revokeFirst = withScenario(base, 0, {
      pool: [{ dataset: 'sc004-revoke-first', history: [{ revoke: true }] }],
    })
    expect(issues(revokeFirst).join()).toMatch(/revocation with no consent/)
  })

  it('an order after a deadline nobody wrote', async () => {
    const base = await fixture()
    const order = base.scenarios[0]?.order as Record<string, unknown>
    const waiting = withScenario(base, 0, { order: { ...order, orderAfterDeadline: true } })
    expect(issues(waiting).join()).toMatch(/no deadline is written/)
  })
})
