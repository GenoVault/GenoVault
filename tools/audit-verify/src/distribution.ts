/**
 * `SC-007` read off the chain (`T051`): the distribution between 50 owners
 * in one run finishes in under 30 seconds.
 *
 * # What is timed
 *
 * From the transaction that carries `RunRevealed` — the reveal callback, after
 * which paying is possible — to the transaction that carries `RunCompleted`,
 * the `finalize_run` that returns the difference to the buyer. Everything in
 * between counts: the dispatcher noticing the report, 50 payouts, the refund.
 * The MPC rounds before the reveal are `SC-003` and do not count.
 *
 * # The clock is the chain
 *
 * Both ends are slots in the ledger, not our stopwatch. The length of a slot
 * is not assumed: it is measured over the whole run, the `blockTime` of its
 * first and last transactions divided by the slots between them. The second
 * clock is the `blockTime` of the two ends directly — whole seconds, so it can
 * overstate by up to one. The verdict takes the larger of the two.
 *
 * # What must be seen
 *
 * The count of what is owed comes from the chain, not from the corpus: a run
 * must have as many payouts as `Run.datasets` on chain, the pool must be the
 * full 50, and the payouts must go to 50 different owners with non-zero
 * amounts. The number of runs is the number of `Run` accounts of the buyer. A
 * run with less is a discrepancy, not a fast run.
 *
 * # It must be able to say no
 *
 * The corpus carries a control: a run whose dispatcher waited for `finalized`
 * on every payout. Its distribution is complete and slow, and the verdict
 * requires it to be over the budget. A clock that cannot see that cannot see
 * anything.
 */

import type { Connection, VersionedTransactionResponse } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { stripDiscriminator } from './borsh.ts'
import type { Run } from './chain.ts'
import { decodeRun } from './chain.ts'
import type { DatasetSettled, RunClosed } from './settlement.ts'
import { decodeEvent, programData, runsOfBuyer, signatures } from './settlement.ts'

export class DistributionError extends Error {
  override readonly name = 'DistributionError'
}

/** Owners in one run — the number in `SC-007`. */
export const SC007_OWNERS = 50

/** The budget of `SC-007`: "< 30 seconds" in the SPEC, strictly. */
export const SC007_BUDGET_SECONDS = 30

/** Measured runs the set must have: one run is weather, not a measurement. */
export const SC007_MIN_RUNS = 3

/** From the IDL in the public repository. */
export const RUN_REVEALED_DISCRIMINATOR = [190, 16, 32, 166, 94, 147, 248, 140] as const

export interface RunRevealed {
  run: string
  recordsIncluded: number
  suppressed: boolean
  resultHash: Uint8Array
}

function startsWith(data: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => data[index] === byte)
}

export function decodeRevealed(data: Uint8Array): RunRevealed | null {
  if (!startsWith(data, RUN_REVEALED_DISCRIMINATOR)) return null
  const reader = stripDiscriminator(data, RUN_REVEALED_DISCRIMINATOR)
  const event = {
    run: new PublicKey(reader.pubkey()).toBase58(),
    recordsIncluded: reader.u32(),
    suppressed: reader.bool(),
    resultHash: reader.bytesOf(32),
  }
  reader.assertConsumed()
  return event
}

/** Where a transaction sits on the chain's clock. */
export interface Stamp {
  signature: string
  slot: number
  blockTime: number | null
}

export interface RunTrace {
  /** The run's first and last successful transactions — the slot ruler. */
  first: Stamp | null
  last: Stamp | null
  revealed: Stamp[]
  settled: (Stamp & DatasetSettled)[]
  closed: (Stamp & RunClosed)[]
}

export interface TracedTransaction {
  signature: string
  tx: VersionedTransactionResponse
}

/**
 * The events of one run, each with its slot. Only lines printed while our
 * program executes count, and only events that name this run.
 */
export function traceOf(
  transactions: readonly TracedTransaction[],
  programId: string,
  run: string,
): RunTrace {
  const trace: RunTrace = { first: null, last: null, revealed: [], settled: [], closed: [] }
  for (const { signature, tx } of transactions) {
    if (tx.meta?.err != null) continue
    const stamp: Stamp = { signature, slot: tx.slot, blockTime: tx.blockTime ?? null }
    if (trace.first === null || stamp.slot < trace.first.slot) trace.first = stamp
    if (trace.last === null || stamp.slot > trace.last.slot) trace.last = stamp

    for (const data of programData(tx.meta?.logMessages ?? [], programId)) {
      const revealed = decodeRevealed(data)
      if (revealed !== null) {
        if (revealed.run === run) trace.revealed.push(stamp)
        continue
      }
      const event = decodeEvent(data)
      if (event === null || event.run !== run) continue
      if (event.kind === 'settled') trace.settled.push({ ...stamp, ...event })
      else trace.closed.push({ ...stamp, ...event })
    }
  }
  return trace
}

export interface RunTiming {
  label: string
  run: string
  status: string
  /** `Run.datasets` on chain — what the run owes. */
  datasets: number
  payouts: number
  /** Different owners with a non-zero payout. */
  owners: number
  /** Slots from the reveal to `finalize_run`. */
  slots: number | null
  msPerSlot: number | null
  secondsBySlots: number | null
  secondsByBlockTime: number | null
  /** The larger of the two clocks. */
  seconds: number | null
  problems: string[]
  /** Everything owed was seen and the clock could be read. */
  complete: boolean
  withinBudget: boolean
}

export function judgeTiming(label: string, address: string, run: Run, trace: RunTrace): RunTiming {
  const problems: string[] = []
  if (run.status !== 'completed') problems.push(`status ${run.status}, not completed`)
  if (run.datasets.length !== SC007_OWNERS) {
    problems.push(`a pool of ${run.datasets.length}, SC-007 is about ${SC007_OWNERS}`)
  }

  const owed = new Set(run.datasets.map((entry) => new PublicKey(entry.dataset).toBase58()))
  if (trace.settled.length !== run.datasets.length) {
    problems.push(`${trace.settled.length} payouts, the run owes ${run.datasets.length}`)
  }
  const paid = new Set(trace.settled.map((event) => event.dataset))
  if (paid.size !== trace.settled.length) problems.push('a dataset was paid twice')
  for (const dataset of paid) {
    if (!owed.has(dataset)) problems.push(`payout to ${dataset}, which is not in the run`)
  }
  const owners = new Set(
    trace.settled.filter((event) => event.net > 0n).map((event) => event.owner),
  )
  if (owners.size < SC007_OWNERS) {
    problems.push(`${owners.size} different owners paid, SC-007 is about ${SC007_OWNERS}`)
  }

  const revealed = trace.revealed.length === 1 ? trace.revealed[0] : undefined
  if (revealed === undefined) problems.push(`${trace.revealed.length} reveal events, not one`)
  const closed = trace.closed.length === 1 ? trace.closed[0] : undefined
  if (closed === undefined) problems.push(`${trace.closed.length} closing events, not one`)
  else if (closed.via !== 'completed') problems.push(`closed by ${closed.via}, not finalize_run`)

  if (revealed !== undefined && closed !== undefined) {
    const outside = trace.settled.filter(
      (event) => event.slot < revealed.slot || event.slot > closed.slot,
    ).length
    if (outside > 0) problems.push(`${outside} payouts outside the reveal → finalize interval`)
  }

  let msPerSlot: number | null = null
  const { first, last } = trace
  if (first === null || last === null || first.blockTime === null || last.blockTime === null) {
    problems.push('no block time on the run: the slot length cannot be measured')
  } else if (last.slot <= first.slot) {
    problems.push('the run spans one slot: the slot length cannot be measured')
  } else {
    msPerSlot = ((last.blockTime - first.blockTime) * 1000) / (last.slot - first.slot)
  }

  const slots = revealed !== undefined && closed !== undefined ? closed.slot - revealed.slot : null
  const secondsBySlots = slots !== null && msPerSlot !== null ? (slots * msPerSlot) / 1000 : null
  const secondsByBlockTime =
    revealed?.blockTime != null && closed?.blockTime != null
      ? closed.blockTime - revealed.blockTime
      : null
  if (revealed !== undefined && closed !== undefined && secondsByBlockTime === null) {
    problems.push('no block time on the reveal or on finalize_run')
  }
  const seconds =
    secondsBySlots !== null && secondsByBlockTime !== null
      ? Math.max(secondsBySlots, secondsByBlockTime)
      : null

  const complete = problems.length === 0 && seconds !== null
  return {
    label,
    run: address,
    status: run.status,
    datasets: run.datasets.length,
    payouts: trace.settled.length,
    owners: owners.size,
    slots,
    msPerSlot,
    secondsBySlots,
    secondsByBlockTime,
    seconds,
    problems,
    complete,
    withinBudget: complete && seconds !== null && seconds < SC007_BUDGET_SECONDS,
  }
}

export interface TimedSet {
  /** `Run` accounts of the set's buyer on chain. */
  onChain: number
  /** Runs the corpus names for this set. */
  named: number
  timings: RunTiming[]
}

export interface DistributionAudit {
  measured: TimedSet
  control: TimedSet
  /** The slowest measured run, when every measured run was complete. */
  worst: RunTiming | null
  gaps: string[]
  passed: boolean
}

function coverage(name: string, set: TimedSet, gaps: string[]): void {
  if (set.onChain !== set.named) {
    gaps.push(`${name}: ${set.onChain} runs of this buyer on chain, the corpus names ${set.named}`)
  }
  if (set.timings.length !== set.onChain) {
    gaps.push(`${name}: ${set.timings.length} of ${set.onChain} runs examined`)
  }
}

export function distributionVerdict(measured: TimedSet, control: TimedSet): DistributionAudit {
  const gaps: string[] = []
  coverage('measured', measured, gaps)
  coverage('control', control, gaps)

  if (measured.timings.length < SC007_MIN_RUNS) {
    gaps.push(`${measured.timings.length} measured runs, the set needs ${SC007_MIN_RUNS}`)
  }

  if (control.timings.length === 0) {
    gaps.push('no control run: nothing shows that the clock sees a slow distribution')
  }
  for (const timing of control.timings) {
    if (!timing.complete) gaps.push(`control "${timing.label}" is incomplete and proves nothing`)
    else if (timing.withinBudget) {
      gaps.push(
        `control "${timing.label}" met the budget at ${timing.seconds?.toFixed(1)} s: ` +
          'the clock does not see a slow distribution',
      )
    }
  }

  const worst = measured.timings.every((timing) => timing.complete)
    ? (measured.timings.reduce<RunTiming | null>(
        (slowest, timing) =>
          slowest === null || (timing.seconds ?? 0) > (slowest.seconds ?? 0) ? timing : slowest,
        null,
      ) ?? null)
    : null

  const passed =
    gaps.length === 0 &&
    measured.timings.length > 0 &&
    measured.timings.every((timing) => timing.withinBudget)
  return { measured, control, worst, gaps, passed }
}

export interface DistributionCorpusFile {
  rpc: string
  programId: string
  measured: { buyer: string; runs: { label: string; run: string }[] }
  control: { buyer: string; runs: { label: string; run: string }[] }
}

export async function collectTrace(
  connection: Connection,
  programId: PublicKey,
  run: PublicKey,
): Promise<RunTrace> {
  const list = await signatures(connection, run)
  const transactions: TracedTransaction[] = []
  for (let at = 0; at < list.length; at += 100) {
    const chunk = list.slice(at, at + 100)
    const responses = await connection.getTransactions(chunk, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    for (const [index, tx] of responses.entries()) {
      const signature = chunk[index]
      if (signature === undefined) continue
      if (tx === null) throw new DistributionError(`transaction ${signature} is not available`)
      transactions.push({ signature, tx })
    }
  }
  return traceOf(transactions, programId.toBase58(), run.toBase58())
}

async function timeSet(
  connection: Connection,
  programId: PublicKey,
  set: DistributionCorpusFile['measured'],
): Promise<TimedSet> {
  const accounts = await runsOfBuyer(connection, programId, new PublicKey(set.buyer))
  const timings: RunTiming[] = []
  for (const entry of set.runs) {
    const address = new PublicKey(entry.run)
    const account = accounts.find((candidate) => candidate.pubkey.equals(address))
    if (account === undefined) continue
    const run = decodeRun(Uint8Array.from(account.account.data))
    const trace = await collectTrace(connection, programId, address)
    timings.push(judgeTiming(entry.label, entry.run, run, trace))
  }
  return { onChain: accounts.length, named: set.runs.length, timings }
}

export async function auditDistribution(
  connection: Connection,
  corpus: DistributionCorpusFile,
): Promise<DistributionAudit> {
  const programId = new PublicKey(corpus.programId)
  if (corpus.measured.buyer === corpus.control.buyer) {
    throw new DistributionError(
      'the control has the buyer of the measured set: they cannot be counted apart',
    )
  }
  const measured = await timeSet(connection, programId, corpus.measured)
  const control = await timeSet(connection, programId, corpus.control)
  return distributionVerdict(measured, control)
}
