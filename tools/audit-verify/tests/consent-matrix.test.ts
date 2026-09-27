import { readFile } from 'node:fs/promises'
import { BN } from '@anchor-lang/core'
import { createProgram, IDL } from '@genovault/sdk'
import {
  BUYER_CATEGORIES,
  CONSENT_VIOLATIONS,
  consentViolationOf,
  PROGRAM_ERRORS,
  USE_TYPES,
} from '@genovault/shared'
import { Connection, Keypair } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import {
  BUYER_CATEGORY_BITS,
  type ChainEvidence,
  CONSENT_DISCRIMINATOR,
  consentTerms,
  DATASET_DISCRIMINATOR,
  datasetConsentVersion,
  errorNameFromLogs,
  type FixtureScenario,
  judge,
  MatrixInputError,
  REASON_BY_ERROR,
  REQUEST_RUN_DISCRIMINATOR,
  RUN_ACCOUNT_DISCRIMINATOR,
  readFixture,
  requestRunArgs,
  summarize,
  USE_TYPE_BITS,
} from '../src/consent-matrix.ts'

/**
 * The `SC-004` verifier (`T041`).
 *
 * Two kinds of test. The first holds the verifier's own tables and decoders
 * against our packages — the verifier writes them from scratch so that it does
 * not inherit our mistakes, and that is only worth something if the two
 * independent versions are compared. The second holds the judgement: every
 * way a verdict can be wrong must turn it red.
 */

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })

describe('the verifier tables agree with ours', () => {
  it('dictionaries match packages/shared bit for bit', () => {
    expect(USE_TYPE_BITS).toEqual(USE_TYPES)
    expect(BUYER_CATEGORY_BITS).toEqual(BUYER_CATEGORIES)
  })

  it('every consent reason the product names is recognised in the logs', () => {
    const named = new Set(Object.values(REASON_BY_ERROR))
    for (const violation of CONSENT_VIOLATIONS) expect(named, violation).toContain(violation)
  })

  it('agrees with packages/shared on every program error it maps', () => {
    for (const [error, reason] of Object.entries(REASON_BY_ERROR)) {
      if (error === 'AccountNotInitialized') continue // Anchor's own, not in our table
      const inTable = PROGRAM_ERRORS.find(
        (entry) => entry.name.toLowerCase() === error.toLowerCase(),
      )
      expect(inTable, error).toBeDefined()
      expect(consentViolationOf(inTable?.name ?? ''), error).toBe(reason)
    }
  })

  it('reproduces the discriminators in the IDL', () => {
    const account = (name: string) =>
      IDL.accounts.find((entry) => entry.name === name)?.discriminator ?? []
    const instruction = IDL.instructions.find((entry) => entry.name === 'requestRun')
    expect(Array.from(DATASET_DISCRIMINATOR)).toEqual(account('dataset'))
    expect(Array.from(CONSENT_DISCRIMINATOR)).toEqual(account('consent'))
    expect(Array.from(RUN_ACCOUNT_DISCRIMINATOR)).toEqual(account('run'))
    expect(Array.from(REQUEST_RUN_DISCRIMINATOR)).toEqual(instruction?.discriminator)
  })
})

describe('decoders read what Anchor wrote', () => {
  it('Dataset: consent_version', async () => {
    const encoded = await program.coder.accounts.encode('dataset', {
      owner: Keypair.generate().publicKey,
      datasetId: 'a-thirty-one-character-long-id-',
      version: 3,
      contentHash: Array.from({ length: 32 }, (_, index) => index),
      recordCountClaimed: new BN(9),
      pricePer1k: new BN(1_000),
      consentVersion: 7,
      status: { active: {} },
      verifiedBadge: null,
      bump: 250,
    })
    expect(datasetConsentVersion(Uint8Array.from(encoded))).toBe(7)
  })

  it('Consent: a deadline, a revocation, and their absence', async () => {
    const base = {
      dataset: Keypair.generate().publicKey,
      version: 2,
      allowedUses: 3,
      forbiddenUses: 16,
      buyerCategories: 1,
      prevVersion: null,
      bump: 251,
    }
    const dated = await program.coder.accounts.encode('consent', {
      ...base,
      expiresAt: new BN(1_790_000_030),
      revokedAt: new BN(1_790_000_100),
    })
    expect(consentTerms(Uint8Array.from(dated))).toEqual({
      expiresAt: 1_790_000_030n,
      revokedAt: 1_790_000_100n,
    })
    const open = await program.coder.accounts.encode('consent', {
      ...base,
      expiresAt: null,
      revokedAt: null,
    })
    expect(consentTerms(Uint8Array.from(open))).toEqual({ expiresAt: null, revokedAt: null })
  })

  it('request_run: nonce, use type and category', () => {
    const data = program.coder.instruction.encode('requestRun', {
      args: {
        nonce: new BN('18446744073709551615'),
        recipeId: 1,
        useType: 8,
        buyerCategory: 4,
        maxEscrow: new BN(1),
        buyerX25519: Array(32).fill(1),
        dispatcher: Keypair.generate().publicKey,
        recipeParams: Array(32).fill(0),
      },
    })
    expect(requestRunArgs(Uint8Array.from(data))).toEqual({
      nonce: 18_446_744_073_709_551_615n,
      useType: 8,
      buyerCategory: 4,
    })
    // Another instruction is not an order.
    const other = Uint8Array.from(data)
    other[0] = (other[0] ?? 0) ^ 0xff
    expect(requestRunArgs(other)).toBeNull()
  })

  it('names the constraint from a real program log line', () => {
    expect(
      errorNameFromLogs([
        'Program 9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb invoke [1]',
        'Program log: AnchorError occurred. Error Code: ConsentExpired. Error Number: 6019.',
      ]),
    ).toBe('ConsentExpired')
    expect(errorNameFromLogs(['Program log: Instruction: RequestRun'])).toBeNull()
  })
})

describe('the fixture is checked, not believed', () => {
  it('the committed fixture has the shape SC-004 names', async () => {
    const raw: unknown = JSON.parse(
      await readFile(new URL('../../../fixtures/consent-matrix.json', import.meta.url), 'utf8'),
    )
    const scenarios = readFixture(raw)
    expect(scenarios).toHaveLength(20)
    expect(scenarios.filter((scenario) => scenario.label === 'refused')).toHaveLength(10)
  })

  it('refuses a matrix of the wrong size or balance', async () => {
    const raw = JSON.parse(
      await readFile(new URL('../../../fixtures/consent-matrix.json', import.meta.url), 'utf8'),
    ) as { scenarios: { label: string }[] }
    expect(() => readFixture({ scenarios: raw.scenarios.slice(1) })).toThrow(MatrixInputError)
    const tilted = raw.scenarios.map((scenario, index) =>
      index === 0 ? { ...scenario, label: 'refused' } : scenario,
    )
    expect(() => readFixture({ scenarios: tilted })).toThrow(/10 allowed/)
  })
})

// ── The judgement ────────────────────────────────────────────────────────────

const REFUSED: FixtureScenario = {
  id: 'category-not-allowed',
  label: 'refused',
  reason: 'category-not-allowed',
  datasets: ['d'],
  useType: 'oncology',
  buyerCategory: 'commercial',
  orderAfterDeadline: false,
}
const ALLOWED: FixtureScenario = { ...REFUSED, id: 'exact-match', label: 'allowed', reason: null }

function refusedOnChain(overrides: Partial<ChainEvidence> = {}): ChainEvidence {
  return {
    gaps: [],
    verdict: 'refused',
    errorName: 'BuyerCategoryNotAllowed',
    runExists: false,
    opened: false,
    buyerTokenDelta: 0n,
    blockTime: 1_000,
    deadlines: [],
    currentDeadlines: [null],
    ...overrides,
  }
}

function acceptedOnChain(overrides: Partial<ChainEvidence> = {}): ChainEvidence {
  return refusedOnChain({
    verdict: 'allowed',
    errorName: null,
    runExists: true,
    opened: true,
    buyerTokenDelta: -9n,
    ...overrides,
  })
}

const API_REFUSED = { orderStatus: 403, reasons: ['category-not-allowed'] }
const API_ALLOWED = { orderStatus: 201, reasons: [] }

describe('judging one scenario', () => {
  it('a refusal for the named reason is a correct refusal', () => {
    const result = judge(REFUSED, refusedOnChain(), API_REFUSED, false)
    expect(result.examined).toBe(true)
    expect([result.falsePass, result.wrongReason, result.apiFalsePass]).toEqual([
      false,
      false,
      false,
    ])
  })

  it('a refused scenario the chain accepted is a false pass', () => {
    const result = judge(REFUSED, acceptedOnChain(), API_REFUSED, false)
    expect(result.falsePass).toBe(true)
    expect(result.apiFalsePass).toBe(false)
  })

  it('an allowed scenario the chain refused is a false refusal', () => {
    const result = judge(ALLOWED, refusedOnChain(), API_ALLOWED, false)
    expect(result.falseRefusal).toBe(true)
  })

  it('a refusal for another reason is a wrong reason, not a pass', () => {
    const result = judge(
      REFUSED,
      refusedOnChain({ errorName: 'UseTypeNotAllowed' }),
      API_REFUSED,
      false,
    )
    expect(result.wrongReason).toBe(true)
    expect(result.falsePass).toBe(false)
  })

  it('the API is judged on its own: a 2xx on a refused scenario is an API false pass', () => {
    const result = judge(REFUSED, refusedOnChain(), API_ALLOWED, false)
    expect(result.apiFalsePass).toBe(true)
    expect(result.falsePass).toBe(false)
  })

  it('a refusal that left a run, opened, or charged the buyer is not examined', () => {
    for (const broken of [
      refusedOnChain({ runExists: true }),
      refusedOnChain({ opened: true }),
      refusedOnChain({ buyerTokenDelta: -9n }),
      refusedOnChain({ buyerTokenDelta: null }),
    ]) {
      const result = judge(REFUSED, broken, API_REFUSED, false)
      expect(result.examined).toBe(false)
      expect(result.gaps.length).toBeGreaterThan(0)
    }
  })

  it('an order not provably past its deadline proves nothing about expiry', () => {
    const expired = { ...REFUSED, reason: 'expired', orderAfterDeadline: true }
    const early = judge(
      expired,
      refusedOnChain({ errorName: 'ConsentExpired', blockTime: 999, deadlines: [1_000n] }),
      API_REFUSED,
      true,
    )
    expect(early.examined).toBe(false)
    const late = judge(
      expired,
      refusedOnChain({ errorName: 'ConsentExpired', blockTime: 1_000, deadlines: [1_000n] }),
      { orderStatus: 403, reasons: ['expired'] },
      true,
    )
    expect(late.examined).toBe(true)
  })

  it('an order meant to be inside a deadline must be inside it', () => {
    const result = judge(
      ALLOWED,
      acceptedOnChain({ blockTime: 2_000, currentDeadlines: [2_000n] }),
      API_ALLOWED,
      false,
    )
    expect(result.examined).toBe(false)
  })
})

describe('the verdict', () => {
  const correct = [
    ...Array.from({ length: 10 }, (_, index) =>
      judge({ ...ALLOWED, id: `a${index}` }, acceptedOnChain(), API_ALLOWED, false),
    ),
    ...Array.from({ length: 10 }, (_, index) =>
      judge({ ...REFUSED, id: `r${index}` }, refusedOnChain(), API_REFUSED, false),
    ),
  ]

  it('twenty correct scenarios meet SC-004', () => {
    expect(summarize(correct, 20).passed).toBe(true)
  })

  it('nineteen correct and one unexamined do not', () => {
    const partial = [...correct.slice(1), { ...correct[0], examined: false } as (typeof correct)[0]]
    const audit = summarize(partial, 20)
    expect(audit.examined).toBe(19)
    expect(audit.passed).toBe(false)
  })

  it('a clean subset of the matrix does not pass for the whole', () => {
    expect(summarize(correct.slice(0, 12), 20).passed).toBe(false)
  })

  it('one false pass, one API false refusal, or one wrong reason each fail it', () => {
    const [first, ...rest] = correct
    for (const flaw of ['falsePass', 'apiFalseRefusal', 'wrongReason'] as const) {
      const audit = summarize([{ ...(first as (typeof correct)[0]), [flaw]: true }, ...rest], 20)
      expect(audit.passed, flaw).toBe(false)
    }
  })
})
