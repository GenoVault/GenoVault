import { BN } from '@anchor-lang/core'
import { createProgram, IDL } from '@genovault/sdk'
import type { VersionedTransactionResponse } from '@solana/web3.js'
import { Connection, Keypair } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import type { Run } from '../src/chain.ts'
import type { RunTiming, RunTrace, TimedSet, TracedTransaction } from '../src/distribution.ts'
import {
  decodeRevealed,
  distributionVerdict,
  judgeTiming,
  RUN_REVEALED_DISCRIMINATOR,
  SC007_OWNERS,
  traceOf,
} from '../src/distribution.ts'
import { DATASET_SETTLED_DISCRIMINATOR, RUN_COMPLETED_DISCRIMINATOR } from '../src/settlement.ts'

/**
 * The `SC-007` auditor must read what the program writes — checked against
 * Anchor's coder — must count what is owed from the chain, and must be able to
 * say no: to a slow run, to a short pool, to a run with a payout missing, and
 * to a control that came in under the budget.
 */

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })
const PROGRAM = program.programId.toBase58()

const key = () => Keypair.generate().publicKey
const RUN = key()
const DATASETS = Array.from({ length: SC007_OWNERS }, () => key())
const OWNERS = Array.from({ length: SC007_OWNERS }, () => key())

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
    datasets: DATASETS.map((dataset) => ({
      dataset: dataset.toBytes(),
      pricePer1k: 1_000_003n,
      recordsIncluded: 10,
      belowFloor: false,
      settled: true,
    })),
    feeBps: 333,
    escrowAmount: 500_000n,
    settledCount: SC007_OWNERS,
    settledAmount: 500_000n,
    refunded: true,
    status: 'completed',
    resultHash: new Uint8Array(32),
    recordsIncluded: 500,
    suppressed: false,
    datasetCursor: SC007_OWNERS,
    foldedBatches: 150,
    foldedHash: new Uint8Array(32),
    createdAt: 0n,
    bump: 255,
    ...overrides,
  }
}

const revealedBody = (run = RUN) =>
  Uint8Array.from([
    ...RUN_REVEALED_DISCRIMINATOR,
    ...program.coder.types.encode('runRevealed', {
      run,
      recordsIncluded: 500,
      suppressed: false,
      resultHash: Array.from({ length: 32 }, (_, i) => i),
    }),
  ])

const settledBody = (index: number, owner = OWNERS[index], run = RUN) =>
  Uint8Array.from([
    ...DATASET_SETTLED_DISCRIMINATOR,
    ...program.coder.types.encode('datasetSettled', {
      run,
      dataset: DATASETS[index],
      owner,
      recordsIncluded: 10,
      runRecordsIncluded: 500,
      pricePer1k: new BN(1_000_003),
      gross: new BN(10_000 + index),
      fee: new BN(333),
      net: new BN(9_667 + index),
    }),
  ])

const completedBody = (run = RUN) =>
  Uint8Array.from([
    ...RUN_COMPLETED_DISCRIMINATOR,
    ...program.coder.types.encode('runCompleted', {
      run,
      settledAmount: new BN(500_000),
      refunded: new BN(0),
    }),
  ])

/** A transaction whose events our program printed, at a slot and a second. */
function tx(
  slot: number,
  blockTime: number | null,
  bodies: Uint8Array[],
  printer = PROGRAM,
): TracedTransaction {
  const logMessages = [
    `Program ${printer} invoke [1]`,
    ...bodies.map((body) => `Program data: ${Buffer.from(body).toString('base64')}`),
    `Program ${printer} success`,
  ]
  const response = { slot, blockTime, meta: { err: null, logMessages } }
  return {
    signature: `sig-${slot}-${bodies.length}`,
    tx: response as unknown as VersionedTransactionResponse,
  }
}

/**
 * A full run on the chain's clock: ordered at slot 0, revealed at `reveal`,
 * 50 payouts one slot apart, finalized one slot after the last. 400 ms slots.
 */
function chain(options: { reveal?: number; spacing?: number; payouts?: Uint8Array[] } = {}) {
  const reveal = options.reveal ?? 3_000
  const spacing = options.spacing ?? 1
  const at = (slot: number) => Math.floor((slot * 400) / 1000)
  const payouts = options.payouts ?? DATASETS.map((_, index) => settledBody(index))
  const list: TracedTransaction[] = [tx(0, 0, [])]
  list.push(tx(reveal, at(reveal), [revealedBody()]))
  payouts.forEach((body, index) => {
    const slot = reveal + spacing * (index + 1)
    list.push(tx(slot, at(slot), [body]))
  })
  const finalize = reveal + spacing * (payouts.length + 1)
  list.push(tx(finalize, at(finalize), [completedBody()]))
  return list
}

const judge = (trace: RunTrace, overrides: Partial<Run> = {}) =>
  judgeTiming('a run', RUN.toBase58(), run(overrides), trace)

describe('the auditor reads what the program writes', () => {
  it('reproduces the discriminator in the IDL', () => {
    expect(Array.from(RUN_REVEALED_DISCRIMINATOR)).toEqual(
      IDL.events.find((entry) => entry.name === 'runRevealed')?.discriminator,
    )
  })

  it('decodes RunRevealed byte for byte', () => {
    expect(decodeRevealed(revealedBody())).toEqual({
      run: RUN.toBase58(),
      recordsIncluded: 500,
      suppressed: false,
      resultHash: Uint8Array.from({ length: 32 }, (_, i) => i),
    })
    expect(decodeRevealed(completedBody())).toBeNull()
  })

  it('takes only our program’s events of this run', () => {
    const other = key()
    const trace = traceOf(
      [
        ...chain(),
        tx(3_010, 1_204, [settledBody(0, OWNERS[0], other)]),
        tx(3_011, 1_204, [revealedBody(other)]),
        tx(3_012, 1_204, [settledBody(1)], key().toBase58()),
      ],
      PROGRAM,
      RUN.toBase58(),
    )
    expect(trace.revealed).toHaveLength(1)
    expect(trace.settled).toHaveLength(SC007_OWNERS)
    expect(trace.closed).toHaveLength(1)
  })
})

describe('the verdict on a run', () => {
  it('times a full run from the reveal to finalize_run', () => {
    const timing = judge(traceOf(chain(), PROGRAM, RUN.toBase58()))
    expect(timing.problems).toEqual([])
    expect(timing.slots).toBe(51)
    expect(timing.msPerSlot).toBeCloseTo(400, 0)
    expect(timing.secondsBySlots).toBeCloseTo(20.4, 1)
    expect(timing.owners).toBe(SC007_OWNERS)
    expect(timing.withinBudget).toBe(true)
  })

  it('fails a distribution that takes 30 seconds or more', () => {
    // 75 slots × 400 ms = 30.0 s: the SPEC says "< 30", so 30 is over.
    const timing = judge(traceOf(chain({ spacing: 75 / 51 }), PROGRAM, RUN.toBase58()))
    expect(timing.complete).toBe(true)
    expect(timing.withinBudget).toBe(false)
  })

  it('takes the slower of the two clocks', () => {
    const list = chain()
    const last = list.at(-1)
    if (last === undefined) throw new Error('no finalize')
    // The finalize block stamped 40 s after the reveal while the slots say 20.
    last.tx.blockTime = 1_200 + 40
    const timing = judge(traceOf(list, PROGRAM, RUN.toBase58()))
    expect(timing.secondsBySlots).toBeLessThan(30)
    expect(timing.secondsByBlockTime).toBe(40)
    expect(timing.withinBudget).toBe(false)
  })

  it('fails a pool smaller than 50', () => {
    const timing = judge(
      traceOf(
        chain({ payouts: DATASETS.slice(0, 49).map((_, i) => settledBody(i)) }),
        PROGRAM,
        RUN.toBase58(),
      ),
      { datasets: run().datasets.slice(0, 49) },
    )
    expect(timing.problems).toContain('a pool of 49, SC-007 is about 50')
    expect(timing.withinBudget).toBe(false)
  })

  it('fails a run with a payout missing — it is not a fast run', () => {
    const payouts = DATASETS.slice(0, 49).map((_, i) => settledBody(i))
    const timing = judge(traceOf(chain({ payouts }), PROGRAM, RUN.toBase58()))
    expect(timing.problems).toContain('49 payouts, the run owes 50')
    expect(timing.withinBudget).toBe(false)
  })

  it('fails 50 payouts to 49 owners', () => {
    const payouts = DATASETS.map((_, i) => settledBody(i, i === 49 ? OWNERS[0] : OWNERS[i]))
    const timing = judge(traceOf(chain({ payouts }), PROGRAM, RUN.toBase58()))
    expect(timing.problems).toContain('49 different owners paid, SC-007 is about 50')
  })

  it('fails a run without the reveal', () => {
    const list = chain().filter((entry) => entry.tx.slot !== 3_000)
    const timing = judge(traceOf(list, PROGRAM, RUN.toBase58()))
    expect(timing.problems).toContain('0 reveal events, not one')
    expect(timing.seconds).toBeNull()
  })

  it('fails a run without block time', () => {
    const list = chain().map((entry) => ({
      ...entry,
      tx: { ...entry.tx, blockTime: null } as VersionedTransactionResponse,
    }))
    const timing = judge(traceOf(list, PROGRAM, RUN.toBase58()))
    expect(timing.problems).toContain(
      'no block time on the run: the slot length cannot be measured',
    )
    expect(timing.complete).toBe(false)
  })

  it('fails a run that is not completed', () => {
    const timing = judge(traceOf(chain(), PROGRAM, RUN.toBase58()), { status: 'running' })
    expect(timing.problems).toContain('status running, not completed')
  })
})

describe('the verdict on the set', () => {
  const fast = judge(traceOf(chain(), PROGRAM, RUN.toBase58()))
  // `finalized` on every payout: ~33 slots each.
  const slow = judge(traceOf(chain({ spacing: 33 }), PROGRAM, RUN.toBase58()))
  const set = (timings: RunTiming[], onChain = timings.length): TimedSet => ({
    onChain,
    named: timings.length,
    timings,
  })

  it('passes three fast runs and a slow control', () => {
    const audit = distributionVerdict(set([fast, fast, fast]), set([slow]))
    expect(audit.gaps).toEqual([])
    expect(audit.passed).toBe(true)
    expect(audit.worst?.seconds).toBeCloseTo(20.4, 1)
  })

  it('fails when the control meets the budget', () => {
    const audit = distributionVerdict(set([fast, fast, fast]), set([fast]))
    expect(audit.passed).toBe(false)
    expect(audit.gaps.join('\n')).toContain('the clock does not see a slow distribution')
  })

  it('fails without a control', () => {
    const audit = distributionVerdict(set([fast, fast, fast]), set([]))
    expect(audit.passed).toBe(false)
  })

  it('fails on fewer than three measured runs', () => {
    expect(distributionVerdict(set([fast, fast]), set([slow])).passed).toBe(false)
  })

  it('fails when the chain has a run the corpus does not name', () => {
    const audit = distributionVerdict(set([fast, fast, fast], 4), set([slow]))
    expect(audit.gaps).toContain('measured: 4 runs of this buyer on chain, the corpus names 3')
    expect(audit.passed).toBe(false)
  })

  it('fails when one measured run is slow', () => {
    expect(distributionVerdict(set([fast, slow, fast]), set([slow])).passed).toBe(false)
  })
})
