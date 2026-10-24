import { BN } from '@anchor-lang/core'
import { createProgram, IDL } from '@genovault/sdk'
import { Connection, Keypair } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import type { Run } from '../src/chain.ts'
import type { MoneyMove, RunJudgement } from '../src/settlement.ts'
import {
  DATASET_SETTLED_DISCRIMINATOR,
  decodeEvent,
  decodeOwnerBalance,
  judgeRun,
  OWNER_BALANCE_DISCRIMINATOR,
  programData,
  RUN_COMPLETED_DISCRIMINATOR,
  RUN_REFUNDED_DISCRIMINATOR,
  sameOwnerHolds,
  shapeOf,
  verdict,
} from '../src/settlement.ts'

/**
 * The `SC-006` auditor must read what the program writes — checked against
 * Anchor's coder, which lives in `devDependencies` only — and it must be able
 * to say no: a check that cannot fail on a lost unit proves nothing.
 */

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })
const PROGRAM = program.programId.toBase58()
const TOKEN = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

const key = () => Keypair.generate().publicKey
const RUN = key()
const DATASETS = [key(), key()]
const OWNERS = [key().toBase58(), key().toBase58()]

function run(overrides: Partial<Run> = {}): Run {
  return {
    buyer: key().toBytes(),
    dispatcher: key().toBytes(),
    nonce: 1n,
    recipeId: 1,
    recipeParams: new Uint8Array(32),
    useType: 8,
    buyerCategory: 1,
    buyerX25519: new Uint8Array(32),
    datasets: DATASETS.map((dataset, index) => ({
      dataset: dataset.toBytes(),
      pricePer1k: 2_000n,
      recordsIncluded: index === 0 ? 12 : 0,
      belowFloor: index === 1,
      settled: true,
    })),
    feeBps: 333,
    escrowAmount: 1_000n,
    settledCount: 2,
    settledAmount: 30n,
    refunded: true,
    status: 'completed',
    resultHash: new Uint8Array(32),
    recordsIncluded: 15,
    suppressed: false,
    datasetCursor: 2,
    foldedBatches: 4,
    foldedHash: new Uint8Array(32),
    createdAt: 0n,
    bump: 255,
    ...overrides,
  }
}

function settled(index: number, gross: bigint, fee: bigint) {
  return {
    kind: 'settled' as const,
    run: RUN.toBase58(),
    dataset: DATASETS[index]?.toBase58() ?? '',
    owner: OWNERS[index] ?? '',
    recordsIncluded: 0,
    runRecordsIncluded: 15,
    pricePer1k: 1_000_003n,
    gross,
    fee,
    net: gross - fee,
  }
}

/** A run that converges: 1 000 in, 24 + 6 paid out, 970 back. */
function moves(): MoneyMove[] {
  return [
    { signature: 'deposit', slot: 1, vault: 1_000n, buyer: -1_000n, events: [] },
    { signature: 'settle-0', slot: 2, vault: null, buyer: null, events: [settled(0, 24n, 0n)] },
    { signature: 'settle-1', slot: 3, vault: null, buyer: null, events: [settled(1, 6n, 0n)] },
    {
      signature: 'finalize',
      slot: 4,
      vault: -970n,
      buyer: 970n,
      events: [{ kind: 'closed', via: 'completed', run: RUN.toBase58(), refunded: 970n }],
    },
  ]
}

describe('the auditor reads what the program writes', () => {
  it('reproduces the discriminators in the IDL', () => {
    const event = (name: string) => IDL.events.find((entry) => entry.name === name)?.discriminator
    expect(Array.from(DATASET_SETTLED_DISCRIMINATOR)).toEqual(event('datasetSettled'))
    expect(Array.from(RUN_COMPLETED_DISCRIMINATOR)).toEqual(event('runCompleted'))
    expect(Array.from(RUN_REFUNDED_DISCRIMINATOR)).toEqual(event('runRefunded'))
    expect(Array.from(OWNER_BALANCE_DISCRIMINATOR)).toEqual(
      IDL.accounts.find((entry) => entry.name === 'ownerBalance')?.discriminator,
    )
  })

  it('decodes DatasetSettled byte for byte', () => {
    const owner = key()
    const body = program.coder.types.encode('datasetSettled', {
      run: RUN,
      dataset: DATASETS[0],
      owner,
      recordsIncluded: 12,
      runRecordsIncluded: 15,
      pricePer1k: new BN('18446744073709551615'),
      gross: new BN(12_001),
      fee: new BN(399),
      net: new BN(11_602),
    })
    const event = decodeEvent(Uint8Array.from([...DATASET_SETTLED_DISCRIMINATOR, ...body]))
    expect(event).toEqual({
      kind: 'settled',
      run: RUN.toBase58(),
      dataset: DATASETS[0]?.toBase58(),
      owner: owner.toBase58(),
      recordsIncluded: 12,
      runRecordsIncluded: 15,
      pricePer1k: 18_446_744_073_709_551_615n,
      gross: 12_001n,
      fee: 399n,
      net: 11_602n,
    })
  })

  it('decodes both closing events', () => {
    const completed = program.coder.types.encode('runCompleted', {
      run: RUN,
      settledAmount: new BN(30),
      refunded: new BN(970),
    })
    const refunded = program.coder.types.encode('runRefunded', {
      run: RUN,
      refunded: new BN(1_000),
    })
    expect(decodeEvent(Uint8Array.from([...RUN_COMPLETED_DISCRIMINATOR, ...completed]))).toEqual({
      kind: 'closed',
      via: 'completed',
      run: RUN.toBase58(),
      refunded: 970n,
    })
    expect(decodeEvent(Uint8Array.from([...RUN_REFUNDED_DISCRIMINATOR, ...refunded]))).toEqual({
      kind: 'closed',
      via: 'refunded',
      run: RUN.toBase58(),
      refunded: 1_000n,
    })
  })

  it('decodes OwnerBalance', async () => {
    const owner = key()
    const encoded = await program.coder.accounts.encode('ownerBalance', {
      owner,
      accrued: new BN(11_602),
      withdrawn: new BN(3),
      bump: 254,
    })
    expect(decodeOwnerBalance(Uint8Array.from(encoded))).toEqual({
      owner: owner.toBase58(),
      accrued: 11_602n,
      withdrawn: 3n,
    })
  })

  it('takes Program data only from the program itself', () => {
    const ours = Buffer.from([1, 2, 3]).toString('base64')
    const theirs = Buffer.from([9, 9, 9]).toString('base64')
    const logs = [
      `Program ${PROGRAM} invoke [1]`,
      `Program ${TOKEN} invoke [2]`,
      `Program data: ${theirs}`,
      `Program ${TOKEN} success`,
      `Program data: ${ours}`,
      `Program ${PROGRAM} success`,
      `Program ${TOKEN} invoke [1]`,
      `Program data: ${theirs}`,
      `Program ${TOKEN} success`,
    ]
    expect(programData(logs, PROGRAM)).toEqual([Uint8Array.from([1, 2, 3])])
  })
})

describe('the verdict on a run', () => {
  it('passes a run that converges', () => {
    const judgement = judgeRun('ok', RUN.toBase58(), run(), moves())
    expect(judgement.problems).toEqual([])
    expect(judgement.difference).toBe(0n)
    expect(judgement.shape).toBe('surplus')
  })

  it('fails a refund one unit too large', () => {
    const tampered = moves()
    tampered[3] = {
      signature: 'finalize',
      slot: 4,
      vault: -971n,
      buyer: 971n,
      events: [{ kind: 'closed', via: 'completed', run: RUN.toBase58(), refunded: 971n }],
    }
    const judgement = judgeRun('off by one', RUN.toBase58(), run(), tampered)
    expect(judgement.passed).toBe(false)
    expect(judgement.difference).toBe(1n)
  })

  it('fails a fee taken by a second multiplication', () => {
    // The fee rounded down and the share rounded down: one unit vanishes.
    const tampered = moves()
    tampered[1] = { ...(tampered[1] as MoneyMove), events: [{ ...settled(0, 24n, 1n), net: 22n }] }
    const judgement = judgeRun('lost unit', RUN.toBase58(), run(), tampered)
    expect(judgement.passed).toBe(false)
    expect(judgement.problems.join('\n')).toMatch(/≠ gross/)
  })

  it('fails a run with a payout missing', () => {
    const judgement = judgeRun(
      'missing',
      RUN.toBase58(),
      run(),
      moves().filter((m) => m.signature !== 'settle-1'),
    )
    expect(judgement.passed).toBe(false)
    expect(judgement.problems.join('\n')).toMatch(/1 payouts, the run owes 2/)
  })

  it('fails a refund that went to someone other than the buyer', () => {
    const tampered = moves()
    tampered[3] = { ...(tampered[3] as MoneyMove), buyer: null }
    expect(judgeRun('elsewhere', RUN.toBase58(), run(), tampered).passed).toBe(false)
  })

  it('does not count another run’s events', () => {
    const tampered = moves()
    tampered[2] = {
      ...(tampered[2] as MoneyMove),
      events: [{ ...settled(1, 6n, 0n), run: key().toBase58() }],
    }
    expect(judgeRun('foreign', RUN.toBase58(), run(), tampered).passed).toBe(false)
  })
})

describe('the verdict on the set', () => {
  const passing = (shape: RunJudgement['shape'], nets: bigint[]): RunJudgement => ({
    run: key().toBase58(),
    label: shape,
    shape,
    datasets: nets.length,
    belowFloor: 0,
    deposit: 0n,
    refund: 0n,
    owners: 0n,
    fees: 0n,
    difference: 0n,
    settled: nets.map((net, index) => ({
      ...settled(0, net, 0n),
      owner: `owner-${shape}-${index}`,
    })),
    problems: [],
    passed: true,
  })
  const full = () => [
    passing('exact', [1n, 2n, 3n, 4n, 5n]),
    passing('surplus', [1n]),
    passing('silent', [1n]),
    passing('suppressed', [0n]),
    passing('ceiling', [1n]),
  ]
  const balances = (judgements: RunJudgement[]) =>
    new Map(
      sameOwnerHolds(judgements, new Map()).map((owner) => [
        owner.owner,
        { accrued: owner.events, withdrawn: 0n },
      ]),
    )

  it('passes a complete set', () => {
    const judgements = full()
    const audit = verdict(5, 5, judgements, sameOwnerHolds(judgements, balances(judgements)))
    expect(audit.gaps).toEqual([])
    expect(audit.passed).toBe(true)
    expect(audit.fiveDifferent?.label).toBe('exact')
  })

  it('fails when the chain has a run the corpus does not name', () => {
    const judgements = full()
    const audit = verdict(6, 5, judgements, sameOwnerHolds(judgements, balances(judgements)))
    expect(audit.passed).toBe(false)
  })

  it('fails a set without one of the shapes', () => {
    const judgements = full().filter((judgement) => judgement.shape !== 'ceiling')
    const audit = verdict(4, 4, judgements, sameOwnerHolds(judgements, balances(judgements)))
    expect(audit.gaps.join('\n')).toMatch(/ceiling/)
  })

  it('fails when a balance holds money the events do not explain', () => {
    const judgements = full()
    const held = balances(judgements)
    const [first] = held.keys()
    if (first !== undefined) held.set(first, { accrued: 999n, withdrawn: 0n })
    const audit = verdict(5, 5, judgements, sameOwnerHolds(judgements, held))
    expect(audit.passed).toBe(false)
  })

  it('does not take equal payouts for T046', () => {
    const judgements = full()
    judgements[0] = passing('exact', [3n, 3n, 3n, 3n, 3n])
    const audit = verdict(5, 5, judgements, sameOwnerHolds(judgements, balances(judgements)))
    expect(audit.fiveDifferent).toBeNull()
    expect(audit.passed).toBe(false)
  })
})

describe('shape from the state', () => {
  it('names the ceiling', () => {
    const state = run({
      escrowAmount: 9_000_071n,
      recordsIncluded: 19,
      datasets: [
        {
          dataset: key().toBytes(),
          pricePer1k: 900_000_007n,
          recordsIncluded: 10,
          belowFloor: false,
          settled: true,
        },
        {
          dataset: key().toBytes(),
          pricePer1k: 1n,
          recordsIncluded: 0,
          belowFloor: true,
          settled: true,
        },
      ],
    })
    expect(shapeOf(state)).toBe('ceiling')
  })

  it('names the silent pool and the suppressed cohort', () => {
    const silent = run({
      datasets: run().datasets.map((d) => ({ ...d, recordsIncluded: 0, belowFloor: true })),
    })
    expect(shapeOf(silent)).toBe('silent')
    expect(shapeOf({ ...silent, recordsIncluded: 0 })).toBe('suppressed')
  })
})
