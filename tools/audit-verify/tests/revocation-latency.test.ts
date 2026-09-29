import { readFile } from 'node:fs/promises'
import { IDL } from '@genovault/sdk'
import { describe, expect, it } from 'vitest'
import {
  isBefore,
  judgeTrial,
  measureSlotSeconds,
  type OrderEvidence,
  type PlanInput,
  REVOKE_CONSENT_DISCRIMINATOR,
  type RevocationEvidence,
  RevocationInputError,
  readPlan,
  readRevocationReport,
  summarize,
  type TrialInput,
} from '../src/revocation-latency.ts'

/**
 * The `SC-005` verifier (`T042`).
 *
 * The first block holds the verifier's own constants against the IDL. The rest
 * holds the judgement: a trial built to pass passes, and each way the chain
 * or the API can fail the criterion — or the evidence can fail to show it —
 * turns it red. A verdict that cannot go red is not a measurement.
 */

describe('the verifier constants agree with the program', () => {
  it('reproduces the revoke_consent discriminator', () => {
    const instruction = IDL.instructions.find((entry) => entry.name === 'revokeConsent')
    expect(Array.from(REVOKE_CONSENT_DISCRIMINATOR)).toEqual(instruction?.discriminator)
  })

  it('reads buyer and nonce where Run keeps them', () => {
    // The census filters on these offsets: 8 (discriminator) for the buyer,
    // 8 + 32 + 32 for the nonce. If the struct is reordered, this goes red
    // before the census silently counts nothing.
    const run = IDL.types.find((entry) => entry.name === 'run')
    const fields = run !== undefined && 'fields' in run.type ? (run.type.fields ?? []) : []
    expect(fields.slice(0, 3).map((field) => [field.name, field.type])).toEqual([
      ['buyer', 'pubkey'],
      ['dispatcher', 'pubkey'],
      ['nonce', 'u64'],
    ])
  })
})

describe('the plan', () => {
  it('reads the committed plan', async () => {
    const raw = JSON.parse(
      await readFile(new URL('../../../fixtures/revocation-latency.json', import.meta.url), 'utf8'),
    )
    const plan = readPlan(raw)
    expect(plan.trials).toBe(10)
    expect(plan.budgetSeconds).toBe(60)
    expect(plan.afterSeconds).toBeGreaterThan(plan.budgetSeconds)
  })

  it('refuses a plan that watches for less than the budget', async () => {
    const raw = JSON.parse(
      await readFile(new URL('../../../fixtures/revocation-latency.json', import.meta.url), 'utf8'),
    )
    expect(() => readPlan({ ...raw, afterSeconds: 60 })).toThrow(RevocationInputError)
    expect(() => readPlan({ ...raw, trials: 0 })).toThrow(RevocationInputError)
    expect(() => readPlan({ ...raw, criterion: 'SC-004' })).toThrow(RevocationInputError)
  })

  it('refuses a report that is not for SC-005', () => {
    expect(() => readRevocationReport({ criterion: 'SC-004' })).toThrow(RevocationInputError)
  })
})

describe('order on the chain', () => {
  it('orders by slot, then by position in the block', () => {
    expect(isBefore({ slot: 10, index: 5 }, { slot: 11, index: 0 })).toBe(true)
    expect(isBefore({ slot: 10, index: 1 }, { slot: 10, index: 2 })).toBe(true)
    expect(isBefore({ slot: 10, index: 2 }, { slot: 10, index: 2 })).toBe(false)
    expect(isBefore({ slot: 10, index: 3 }, { slot: 10, index: 2 })).toBe(false)
  })

  it('measures the slot over the blocks, and refuses a span too short to say', () => {
    expect(
      measureSlotSeconds([
        { slot: 100, blockTime: 1_000 },
        { slot: 250, blockTime: 1_060 },
        { slot: 180, blockTime: 1_030 },
      ]),
    ).toBeCloseTo(0.4, 6)
    expect(
      measureSlotSeconds([
        { slot: 100, blockTime: 1_000 },
        { slot: 120, blockTime: 1_008 },
      ]),
    ).toBeNull()
  })
})

// ── A trial built to pass, and each way to break it ──────────────────────────

const PLAN: PlanInput = {
  trials: 1,
  budgetSeconds: 60,
  afterSeconds: 65,
  maxGapSeconds: 3,
  useType: 1,
  buyerCategory: 1,
}
const SLOT = 0.4
const REVOKE_SLOT = 1_000
const REVOKE_TIME = 50_000

/** An order at `slot`; its block time follows the slot at 0.4 s. */
function order(
  nonce: number,
  slot: number,
  verdict: 'allowed' | 'refused',
  patch: Partial<OrderEvidence> = {},
): OrderEvidence {
  const refused = verdict === 'refused'
  return {
    nonce: BigInt(nonce),
    kind: 'trial',
    trial: 0,
    gaps: [],
    found: true,
    landedPerReport: true,
    position: { slot, index: 1 },
    blockTime: REVOKE_TIME + Math.floor((slot - REVOKE_SLOT) * SLOT),
    verdict,
    errorName: refused ? 'ConsentIsRevoked' : null,
    api: {
      slotBefore: slot - 1,
      slotAfter: slot,
      status: refused ? 403 : 201,
      reasons: refused ? ['revoked'] : [],
    },
    ...patch,
  }
}

function witness(nonce: number, slot: number, verdict: 'allowed' | 'refused' = 'allowed') {
  return order(nonce, slot, verdict, { kind: 'witness', trial: null, errorName: null })
}

function passingTrial(): TrialInput {
  const orders: OrderEvidence[] = []
  let nonce = 1
  // 13 accepted before, one each slot.
  for (let slot = REVOKE_SLOT - 13; slot < REVOKE_SLOT; slot += 1) {
    orders.push(order(nonce++, slot, 'allowed'))
  }
  // Refused after, one each slot, for 66 s.
  for (let slot = REVOKE_SLOT; slot <= REVOKE_SLOT + 165; slot += 1) {
    orders.push(order(nonce++, slot, 'refused', { position: { slot, index: 2 } }))
  }
  const witnesses: OrderEvidence[] = []
  for (let slot = REVOKE_SLOT + 1; slot < REVOKE_SLOT + 165; slot += 3) {
    witnesses.push(witness(10_000 + slot, slot))
  }
  const revocation: RevocationEvidence = {
    gaps: [],
    position: { slot: REVOKE_SLOT, index: 1 },
    blockTime: REVOKE_TIME,
    revokedAt: BigInt(REVOKE_TIME),
  }
  return {
    index: 0,
    plan: PLAN,
    slotSeconds: SLOT,
    revocation,
    orders,
    witnesses,
    opened: { gaps: [], nonce: 13n, ok: true, position: { slot: REVOKE_SLOT + 170, index: 0 } },
  }
}

function withOrders(input: TrialInput, map: (order: OrderEvidence) => OrderEvidence): TrialInput {
  return { ...input, orders: input.orders.map(map) }
}

describe('a trial built to pass', () => {
  it('passes, and says why', () => {
    const judgement = judgeTrial(passingTrial())
    expect(judgement.gaps).toEqual([])
    expect(judgement.passed).toBe(true)
    expect(judgement.acceptedBefore).toBe(13)
    expect(judgement.acceptedAfter).toBe(0)
    expect(judgement.nearestAfterSlots).toBe(0)
    expect(judgement.coverageSeconds).toBeGreaterThanOrEqual(60)
    expect(judgement.api.lagSlots).toBe(0)
  })

  it('puts an order in the revocation block by its position, not its slot', () => {
    // Same slot, ahead of the revocation in the block: ordered before it, and
    // its acceptance is FR-007 working, not failing.
    // Nonces follow time within a trial, so the order taken is the first one
    // sent after the thirteen: it lands in the revocation's slot, ahead of it.
    const input = withOrders(passingTrial(), (entry) =>
      entry.nonce === 14n
        ? order(14, REVOKE_SLOT, 'allowed', {
            position: { slot: REVOKE_SLOT, index: 0 },
            api: {
              slotBefore: REVOKE_SLOT - 1,
              slotAfter: REVOKE_SLOT - 1,
              status: 201,
              reasons: [],
            },
          })
        : entry,
    )
    const judgement = judgeTrial(input)
    expect(judgement.acceptedAfter).toBe(0)
    expect(judgement.sameBlockBefore).toBe(1)
    expect(judgement.passed).toBe(true)
    // The same order one position later is after the revocation, and red.
    const behind = withOrders(input, (entry) =>
      entry.nonce === 14n ? { ...entry, position: { slot: REVOKE_SLOT, index: 3 } } : entry,
    )
    expect(judgeTrial(behind).acceptedAfter).toBe(1)
    expect(judgeTrial(behind).passed).toBe(false)
  })
})

describe('the chain failing the criterion turns the trial red', () => {
  it('one order accepted after the revocation (FR-007)', () => {
    const input = withOrders(passingTrial(), (entry) =>
      entry.nonce === 30n ? { ...entry, verdict: 'allowed', errorName: null } : entry,
    )
    const judgement = judgeTrial(input)
    expect(judgement.acceptedAfter).toBe(1)
    expect(judgement.passed).toBe(false)
  })

  it('the gate never closing: accepted to the end, past the budget', () => {
    const input = withOrders(passingTrial(), (entry) => ({
      ...entry,
      verdict: 'allowed',
      errorName: null,
    }))
    const judgement = judgeTrial(input)
    expect(judgement.chainLatencySeconds).toBeGreaterThanOrEqual(60)
    expect(judgement.passed).toBe(false)
  })

  it('a refusal after the revocation that names another reason', () => {
    const input = withOrders(passingTrial(), (entry) =>
      entry.nonce === 40n ? { ...entry, errorName: 'UseTypeNotAllowed' } : entry,
    )
    const judgement = judgeTrial(input)
    expect(judgement.wrongReasons).toBe(1)
    expect(judgement.passed).toBe(false)
  })
})

describe('evidence that cannot show the criterion turns the trial red', () => {
  it('a stream that stops before the budget', () => {
    const input = passingTrial()
    input.orders = input.orders.filter(
      (entry) => entry.position === null || entry.position.slot <= REVOKE_SLOT + 100,
    )
    const judgement = judgeTrial(input)
    expect(judgement.coverageSeconds).toBeLessThan(60)
    expect(judgement.passed).toBe(false)
  })

  it('a hole in the stream wider than the gap rule', () => {
    const input = passingTrial()
    input.orders = input.orders.filter(
      (entry) =>
        entry.position === null ||
        entry.position.slot < REVOKE_SLOT + 20 ||
        entry.position.slot > REVOKE_SLOT + 40,
    )
    const judgement = judgeTrial(input)
    expect(judgement.maxGapSeconds).toBeGreaterThan(PLAN.maxGapSeconds)
    expect(judgement.passed).toBe(false)
  })

  it('no order accepted before the revocation: the gate never shown open', () => {
    const input = passingTrial()
    input.orders = input.orders.filter(
      (entry) => entry.position !== null && entry.position.slot >= REVOKE_SLOT,
    )
    const judgement = judgeTrial(input)
    expect(judgement.examined).toBe(false)
    expect(judgement.passed).toBe(false)
  })

  it('an order refused while the consent was in force', () => {
    const input = withOrders(passingTrial(), (entry) =>
      entry.nonce === 5n ? { ...entry, verdict: 'refused', errorName: 'ConsentIsRevoked' } : entry,
    )
    expect(judgeTrial(input).passed).toBe(false)
  })

  it('an order the driver says landed that the chain does not have', () => {
    const input = withOrders(passingTrial(), (entry) =>
      entry.nonce === 50n ? { ...entry, found: false, position: null, blockTime: null } : entry,
    )
    const judgement = judgeTrial(input)
    expect(judgement.gaps.some((gap) => gap.includes('reported landed'))).toBe(true)
    expect(judgement.passed).toBe(false)
  })

  it('but an order that never landed is a missing sample, not a failure', () => {
    const input = withOrders(passingTrial(), (entry) =>
      entry.nonce === 50n
        ? { ...entry, found: false, landedPerReport: false, position: null, blockTime: null }
        : entry,
    )
    const judgement = judgeTrial(input)
    expect(judgement.dropped).toBe(1)
    expect(judgement.passed).toBe(true)
  })

  it('a witness refused while the trial was refused: the stand, not the gate', () => {
    const input = passingTrial()
    input.witnesses = input.witnesses.map((entry, at) =>
      at === 3 ? { ...entry, verdict: 'refused' } : entry,
    )
    const judgement = judgeTrial(input)
    expect(judgement.witnessRefused).toBe(1)
    expect(judgement.passed).toBe(false)
  })

  it('no witness at all over the refused stretch', () => {
    const input = { ...passingTrial(), witnesses: [] }
    expect(judgeTrial(input).passed).toBe(false)
  })

  it('the pre-revocation run not opened, or opened before the revocation', () => {
    expect(judgeTrial({ ...passingTrial(), opened: null }).passed).toBe(false)
    const early = passingTrial()
    early.opened = { gaps: [], nonce: 13n, ok: true, position: { slot: REVOKE_SLOT - 1, index: 0 } }
    expect(judgeTrial(early).passed).toBe(false)
    const refused = passingTrial()
    refused.opened = {
      gaps: [],
      nonce: 13n,
      ok: false,
      position: { slot: REVOKE_SLOT + 170, index: 0 },
    }
    expect(judgeTrial(refused).passed).toBe(false)
    const wrongRun = passingTrial()
    wrongRun.opened = {
      gaps: [],
      nonce: 40n,
      ok: true,
      position: { slot: REVOKE_SLOT + 170, index: 0 },
    }
    expect(judgeTrial(wrongRun).passed).toBe(false)
  })

  it('revoked_at that disagrees with the block time, or no revocation on the consent', () => {
    const skewed = passingTrial()
    skewed.revocation = { ...skewed.revocation, revokedAt: BigInt(REVOKE_TIME + 5) }
    expect(judgeTrial(skewed).passed).toBe(false)
    const unrevoked = passingTrial()
    unrevoked.revocation = { ...unrevoked.revocation, revokedAt: null }
    expect(judgeTrial(unrevoked).passed).toBe(false)
  })
})

describe('the API layer', () => {
  it('a stale build after the revocation is reported, not failed — the chain refused it', () => {
    const input = withOrders(passingTrial(), (entry) => {
      const slot = entry.position?.slot ?? 0
      if (slot >= REVOKE_SLOT && slot < REVOKE_SLOT + 31) {
        return { ...entry, api: { ...entry.api, status: 201, reasons: [] } }
      }
      return entry
    })
    const judgement = judgeTrial(input)
    expect(judgement.api.staleSlots).toBe(29)
    expect(judgement.api.lagSlots).toBe(31)
    expect(judgement.passed).toBe(true)
  })

  it('a lag past the budget turns it red', () => {
    const input = withOrders(passingTrial(), (entry) => {
      const slot = entry.position?.slot ?? 0
      if (slot >= REVOKE_SLOT && slot < REVOKE_SLOT + 155) {
        return { ...entry, api: { ...entry.api, status: 201, reasons: [] } }
      }
      return entry
    })
    const judgement = judgeTrial(input)
    expect(judgement.apiLagSeconds).toBeGreaterThanOrEqual(60)
    expect(judgement.passed).toBe(false)
  })

  it('an API that never says revoked, or builds again after it did', () => {
    const never = withOrders(passingTrial(), (entry) => ({
      ...entry,
      api: { ...entry.api, status: 201, reasons: [] },
    }))
    expect(judgeTrial(never).passed).toBe(false)

    const flapping = withOrders(passingTrial(), (entry) =>
      entry.nonce === 100n ? { ...entry, api: { ...entry.api, status: 201, reasons: [] } } : entry,
    )
    const judgement = judgeTrial(flapping)
    expect(judgement.api.flaps).toBe(1)
    expect(judgement.passed).toBe(false)
  })

  it('an API refusal after the revocation that names another reason', () => {
    const input = withOrders(passingTrial(), (entry) =>
      entry.nonce === 60n ? { ...entry, api: { ...entry.api, reasons: ['expired'] } } : entry,
    )
    const judgement = judgeTrial(input)
    expect(judgement.api.wrongReasons).toBe(1)
    expect(judgement.passed).toBe(false)
  })

  it('an API that never built an order before the revocation measures nothing', () => {
    const input = withOrders(passingTrial(), (entry) => ({
      ...entry,
      api: { ...entry.api, status: 403, reasons: ['unregistered'] },
    }))
    expect(judgeTrial(input).examined).toBe(false)
  })
})

describe('the summary', () => {
  const census = { runAccounts: 13, acceptedOrders: 13, buyerTransactions: 200 }

  it('passes only with every trial the plan names, examined and passed', () => {
    const judgement = judgeTrial(passingTrial())
    expect(summarize([judgement], 1, [], SLOT, census).passed).toBe(true)
    // Nine trials out of ten read exactly like ten.
    expect(summarize([judgement], 2, [], SLOT, census).passed).toBe(false)
  })

  it('a census discrepancy or an unmeasured slot turns it red', () => {
    const judgement = judgeTrial(passingTrial())
    expect(
      summarize([judgement], 1, ['run 99 is on chain but not an accepted order'], SLOT, census)
        .passed,
    ).toBe(false)
    expect(summarize([judgement], 1, [], null, census).passed).toBe(false)
  })
})
