/**
 * `SC-006` read off the chain (`T050`): on every run of the corpus the
 * owners' shares plus the platform fee plus the difference returned to the
 * buyer equal the escrow, to the smallest unit.
 *
 * # Where each number comes from
 *
 * - **escrow** — what the vault received in the run's deposit transaction,
 *   read from the token balances of that transaction, not from `Run`;
 * - **refund** — what the vault paid back to the buyer, the same way;
 * - **shares and fee** — the `DatasetSettled` events of the run, accepted only
 *   when emitted while the program itself is executing: a line printed by any
 *   other program in the same transaction is not ours to count;
 * - and the events are held against state: every owner's `OwnerBalance` on
 *   chain must hold exactly the sum of that owner's `net` in the corpus.
 *
 * `Run` is read too, and only for cross-checks and for the count of what is
 * owed: the number of payouts a run must have is the number of datasets in
 * its pool, and the number of runs is the number of `Run` accounts of the
 * buyer. A run that is not examined is a discrepancy, not silence.
 *
 * # What this cannot see
 *
 * `SC-006` is conservation. A rule that paid the wrong owner — the surplus to
 * the clinic instead of the silent dataset — still adds up. Who gets what is
 * pinned by the program's unit tests with exact numbers; here it is only
 * printed.
 */

import type { Connection, VersionedTransactionResponse } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { stripDiscriminator } from './borsh.ts'
import type { Run } from './chain.ts'
import { decodeRun, RUN_DISCRIMINATOR } from './chain.ts'

export class SettlementError extends Error {
  override readonly name = 'SettlementError'
}

/** Discriminators from the IDL in the public repository. */
export const OWNER_BALANCE_DISCRIMINATOR = [126, 78, 65, 151, 163, 196, 116, 207] as const
export const DATASET_SETTLED_DISCRIMINATOR = [173, 151, 250, 76, 70, 145, 84, 202] as const
export const RUN_COMPLETED_DISCRIMINATOR = [233, 115, 120, 101, 166, 52, 138, 133] as const
export const RUN_REFUNDED_DISCRIMINATOR = [17, 239, 61, 160, 107, 19, 158, 4] as const

/** The recipe's thresholds, public numbers of the catalog. */
export const MIN_CONTRIBUTION = 10

export interface DatasetSettled {
  run: string
  dataset: string
  owner: string
  recordsIncluded: number
  runRecordsIncluded: number
  pricePer1k: bigint
  gross: bigint
  fee: bigint
  net: bigint
}

export interface RunClosed {
  run: string
  /** `finalize_run` or `refund_failed_run`. */
  via: 'completed' | 'refunded'
  refunded: bigint
}

export type SettlementEvent =
  | ({ kind: 'settled' } & DatasetSettled)
  | ({ kind: 'closed' } & RunClosed)

function base58(bytes: Uint8Array): string {
  return new PublicKey(bytes).toBase58()
}

function startsWith(data: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => data[index] === byte)
}

/** One `emit!` payload, or `null` when it is some other event of the program. */
export function decodeEvent(data: Uint8Array): SettlementEvent | null {
  if (startsWith(data, DATASET_SETTLED_DISCRIMINATOR)) {
    const reader = stripDiscriminator(data, DATASET_SETTLED_DISCRIMINATOR)
    const event: SettlementEvent = {
      kind: 'settled',
      run: base58(reader.pubkey()),
      dataset: base58(reader.pubkey()),
      owner: base58(reader.pubkey()),
      recordsIncluded: reader.u32(),
      runRecordsIncluded: reader.u32(),
      pricePer1k: reader.u64(),
      gross: reader.u64(),
      fee: reader.u64(),
      net: reader.u64(),
    }
    reader.assertConsumed()
    return event
  }
  if (startsWith(data, RUN_COMPLETED_DISCRIMINATOR)) {
    const reader = stripDiscriminator(data, RUN_COMPLETED_DISCRIMINATOR)
    const run = base58(reader.pubkey())
    reader.u64() // settled_amount: `Run` says the same, and the payouts say more
    const refunded = reader.u64()
    reader.assertConsumed()
    return { kind: 'closed', via: 'completed', run, refunded }
  }
  if (startsWith(data, RUN_REFUNDED_DISCRIMINATOR)) {
    const reader = stripDiscriminator(data, RUN_REFUNDED_DISCRIMINATOR)
    const run = base58(reader.pubkey())
    const refunded = reader.u64()
    reader.assertConsumed()
    return { kind: 'closed', via: 'refunded', run, refunded }
  }
  return null
}

/**
 * `Program data:` lines printed while `programId` was the executing program.
 *
 * The invoke stack is followed line by line: a CPI into the token program
 * and back is common in these transactions, and the same prefix printed from
 * inside another program must not count as ours.
 */
export function programData(logs: readonly string[], programId: string): Uint8Array[] {
  const stack: string[] = []
  const found: Uint8Array[] = []
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[\d+\]$/.exec(line)
    if (invoke?.[1] !== undefined) {
      stack.push(invoke[1])
      continue
    }
    if (/^Program \w+ (success|failed)/.test(line)) {
      stack.pop()
      continue
    }
    const data = /^Program data: (\S+)$/.exec(line)
    if (data?.[1] !== undefined && stack.at(-1) === programId) {
      found.push(Uint8Array.from(Buffer.from(data[1], 'base64')))
    }
  }
  return found
}

/** What one transaction of a run did to the money. */
export interface MoneyMove {
  signature: string
  slot: number
  /** Change of the vault's token balance; `null` when the vault was not touched. */
  vault: bigint | null
  /** Change of the buyer's token balance in the same mint. */
  buyer: bigint | null
  events: SettlementEvent[]
}

function keysOf(tx: VersionedTransactionResponse): string[] {
  const message = tx.transaction.message
  const loaded = tx.meta?.loadedAddresses
  return [
    ...message.staticAccountKeys,
    ...(loaded?.writable ?? []),
    ...(loaded?.readonly ?? []),
  ].map((key) => key.toBase58())
}

type TokenBalances = NonNullable<
  NonNullable<VersionedTransactionResponse['meta']>['preTokenBalances']
>

/**
 * Change of one token account's balance in a transaction. An account absent
 * before (created by it) counts from zero.
 */
function balanceDelta(
  tx: VersionedTransactionResponse,
  match: (key: string, owner: string | undefined) => boolean,
): bigint | null {
  const keys = keysOf(tx)
  const amount = (balances: TokenBalances) => {
    const entry = balances.find((balance) => match(keys[balance.accountIndex] ?? '', balance.owner))
    return entry === undefined ? null : BigInt(entry.uiTokenAmount.amount)
  }
  const pre = amount(tx.meta?.preTokenBalances ?? [])
  const post = amount(tx.meta?.postTokenBalances ?? [])
  if (pre === null && post === null) return null
  return (post ?? 0n) - (pre ?? 0n)
}

export function moneyMove(
  tx: VersionedTransactionResponse,
  signature: string,
  programId: string,
  vault: string,
  buyer: string,
): MoneyMove {
  const vaultDelta = balanceDelta(tx, (key) => key === vault)
  const buyerDelta = balanceDelta(tx, (key, owner) => key !== vault && owner === buyer)
  const events = programData(tx.meta?.logMessages ?? [], programId)
    .map(decodeEvent)
    .filter((event): event is SettlementEvent => event !== null)
  return {
    signature,
    slot: tx.slot,
    vault: vaultDelta === 0n ? null : vaultDelta,
    buyer: buyerDelta === 0n ? null : buyerDelta,
    events,
  }
}

export type Shape =
  | 'exact'
  | 'surplus'
  | 'ceiling'
  | 'escrow-split'
  | 'silent'
  | 'suppressed'
  | 'failed'
  | 'open'

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return numerator === 0n ? 0n : (numerator - 1n) / denominator + 1n
}

/** Which branch of the settlement the run went through, from its state. */
export function shapeOf(run: Run): Shape {
  if (run.status === 'failed') return 'failed'
  if (run.status !== 'completed') return 'open'
  const records = BigInt(run.recordsIncluded)
  if (records === 0n) return 'suppressed'
  const contributed = run.datasets.reduce((total, d) => total + BigInt(d.recordsIncluded), 0n)
  if (contributed === 0n) return 'silent'
  const earned = run.datasets.reduce(
    (total, d) => total + ceilDiv(d.pricePer1k * BigInt(d.recordsIncluded), 1000n),
    0n,
  )
  if (earned > run.escrowAmount) return 'escrow-split'
  const bill = run.datasets.reduce(
    (total, d) =>
      total + ceilDiv(d.pricePer1k * BigInt(d.recordsIncluded) * records, contributed * 1000n),
    0n,
  )
  if (bill > run.escrowAmount) return 'ceiling'
  return records > contributed ? 'surplus' : 'exact'
}

export interface RunJudgement {
  run: string
  label: string
  shape: Shape
  datasets: number
  belowFloor: number
  deposit: bigint
  refund: bigint
  owners: bigint
  fees: bigint
  /** `owners + fees + refund − deposit`; zero is the criterion. */
  difference: bigint
  settled: DatasetSettled[]
  problems: string[]
  passed: boolean
}

/**
 * The verdict on one run, from its transactions and its state. Pure: the
 * tests feed it hand-made moves to show it can say no.
 */
export function judgeRun(
  label: string,
  address: string,
  run: Run,
  moves: readonly MoneyMove[],
): RunJudgement {
  const problems: string[] = []

  const deposits = moves.filter((move) => (move.vault ?? 0n) > 0n)
  const payouts = moves.filter((move) => (move.vault ?? 0n) < 0n)
  if (deposits.length !== 1) problems.push(`${deposits.length} deposits into the vault, expected 1`)
  for (const move of [...deposits, ...payouts]) {
    if ((move.buyer ?? 0n) !== -(move.vault ?? 0n)) {
      problems.push(
        `${move.signature}: vault ${move.vault}, buyer ${move.buyer ?? 0n} — the money went elsewhere`,
      )
    }
  }
  const deposit = deposits.reduce((total, move) => total + (move.vault ?? 0n), 0n)
  const refund = -payouts.reduce((total, move) => total + (move.vault ?? 0n), 0n)

  const events = moves.flatMap((move) => move.events).filter((event) => event.run === address)
  const settled = events.filter(
    (e): e is { kind: 'settled' } & DatasetSettled => e.kind === 'settled',
  )
  const closed = events.filter((e): e is { kind: 'closed' } & RunClosed => e.kind === 'closed')

  // What is owed: one payout per dataset of a completed run, none for a
  // failed one. The count comes from the chain, not from the corpus.
  const owed = run.status === 'completed' ? run.datasets.length : 0
  if (settled.length !== owed) problems.push(`${settled.length} payouts, the run owes ${owed}`)
  const paid = new Set(settled.map((event) => event.dataset))
  if (paid.size !== settled.length) problems.push('a dataset was paid twice')
  for (const entry of run.status === 'completed' ? run.datasets : []) {
    if (!paid.has(base58(entry.dataset)))
      problems.push(`dataset ${base58(entry.dataset)} was not paid`)
  }
  for (const event of settled) {
    if (event.fee + event.net !== event.gross) {
      problems.push(`${event.dataset}: fee ${event.fee} + net ${event.net} ≠ gross ${event.gross}`)
    }
  }

  if (closed.length !== 1) problems.push(`${closed.length} closing events, expected 1`)
  else if (closed[0]?.refunded !== refund) {
    problems.push(
      `the closing event says ${closed[0]?.refunded} returned, the vault paid ${refund}`,
    )
  }

  const owners = settled.reduce((total, event) => total + event.net, 0n)
  const fees = settled.reduce((total, event) => total + event.fee, 0n)
  const difference = owners + fees + refund - deposit
  if (difference !== 0n) {
    problems.push(
      `owners ${owners} + fee ${fees} + refund ${refund} = ${owners + fees + refund}, escrow ${deposit}`,
    )
  }

  // Cross-checks against state: they cannot make a run pass, only fail.
  if (deposit !== run.escrowAmount)
    problems.push(`deposit ${deposit}, Run.escrow_amount ${run.escrowAmount}`)
  const gross = settled.reduce((total, event) => total + event.gross, 0n)
  if (gross !== run.settledAmount)
    problems.push(`payouts ${gross}, Run.settled_amount ${run.settledAmount}`)
  if (!run.refunded) problems.push('Run.refunded is not set')
  if (run.status !== 'completed' && run.status !== 'failed') problems.push(`status ${run.status}`)

  return {
    run: address,
    label,
    shape: shapeOf(run),
    datasets: run.datasets.length,
    belowFloor: run.datasets.filter((entry) => entry.belowFloor).length,
    deposit,
    refund,
    owners,
    fees,
    difference,
    settled,
    problems,
    passed: problems.length === 0,
  }
}

export function decodeOwnerBalance(data: Uint8Array): {
  owner: string
  accrued: bigint
  withdrawn: bigint
} {
  const reader = stripDiscriminator(data, OWNER_BALANCE_DISCRIMINATOR)
  const balance = { owner: base58(reader.pubkey()), accrued: reader.u64(), withdrawn: reader.u64() }
  reader.u8()
  reader.assertConsumed()
  return balance
}

export interface SettlementCorpusFile {
  rpc: string
  programId: string
  buyer: string
  runs: { label: string; run: string }[]
}

export interface OwnerCheck {
  owner: string
  events: bigint
  accrued: bigint | null
  withdrawn: bigint | null
}

export interface SettlementAudit {
  /** `Run` accounts of the buyer on chain — what the corpus must cover. */
  onChain: number
  examined: number
  judgements: RunJudgement[]
  owners: OwnerCheck[]
  shapes: Map<Shape, number>
  /** A run with at least five payouts, all different (`T046`). */
  fiveDifferent: RunJudgement | null
  gaps: string[]
  passed: boolean
}

/** Shapes the live set must contain, or it says nothing about them. */
export const REQUIRED_SHAPES: readonly Shape[] = [
  'exact',
  'surplus',
  'silent',
  'suppressed',
  'ceiling',
]

/** Successful signatures of an address, oldest first. */
export async function signatures(connection: Connection, address: PublicKey): Promise<string[]> {
  const found: string[] = []
  let before: string | undefined
  for (;;) {
    const page = await connection.getSignaturesForAddress(
      address,
      before === undefined ? { limit: 1000 } : { limit: 1000, before },
      'confirmed',
    )
    for (const entry of page) if (entry.err === null) found.push(entry.signature)
    before = page.at(-1)?.signature
    if (page.length < 1000 || before === undefined) break
  }
  return found.reverse()
}

/** Every `Run` account of the buyer on chain. */
export async function runsOfBuyer(
  connection: Connection,
  programId: PublicKey,
  buyer: PublicKey,
): ReturnType<Connection['getProgramAccounts']> {
  return connection.getProgramAccounts(programId, {
    commitment: 'confirmed',
    filters: [
      {
        memcmp: {
          offset: 0,
          encoding: 'base64',
          bytes: Buffer.from(RUN_DISCRIMINATOR).toString('base64'),
        },
      },
      // `Run.buyer` is the first field after the discriminator.
      { memcmp: { offset: 8, bytes: buyer.toBase58() } },
    ],
  })
}

export async function collectMoves(
  connection: Connection,
  programId: PublicKey,
  run: PublicKey,
  buyer: string,
): Promise<MoneyMove[]> {
  const vault = PublicKey.findProgramAddressSync([Buffer.from('vault')], programId)[0].toBase58()
  const list = await signatures(connection, run)
  const moves: MoneyMove[] = []
  for (let at = 0; at < list.length; at += 100) {
    const chunk = list.slice(at, at + 100)
    const responses = await connection.getTransactions(chunk, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    for (const [index, tx] of responses.entries()) {
      const signature = chunk[index]
      if (signature === undefined) continue
      if (tx === null) throw new SettlementError(`transaction ${signature} is not available`)
      if (tx.meta?.err != null) continue
      moves.push(moneyMove(tx, signature, programId.toBase58(), vault, buyer))
    }
  }
  return moves
}

export function sameOwnerHolds(
  judgements: readonly RunJudgement[],
  balances: ReadonlyMap<string, { accrued: bigint; withdrawn: bigint } | null>,
): OwnerCheck[] {
  const sums = new Map<string, bigint>()
  for (const judgement of judgements) {
    for (const event of judgement.settled)
      sums.set(event.owner, (sums.get(event.owner) ?? 0n) + event.net)
  }
  return [...sums.entries()].map(([owner, events]) => {
    const balance = balances.get(owner) ?? null
    return {
      owner,
      events,
      accrued: balance?.accrued ?? null,
      withdrawn: balance?.withdrawn ?? null,
    }
  })
}

export function verdict(
  onChain: number,
  corpusRuns: number,
  judgements: RunJudgement[],
  owners: OwnerCheck[],
): SettlementAudit {
  const gaps: string[] = []
  if (onChain !== corpusRuns) {
    gaps.push(`${onChain} runs of this buyer on chain, the corpus names ${corpusRuns}`)
  }
  if (judgements.length !== onChain) gaps.push(`${judgements.length} of ${onChain} runs examined`)

  const shapes = new Map<Shape, number>()
  for (const judgement of judgements)
    shapes.set(judgement.shape, (shapes.get(judgement.shape) ?? 0) + 1)
  for (const shape of REQUIRED_SHAPES) {
    if ((shapes.get(shape) ?? 0) === 0)
      gaps.push(`no run of shape "${shape}": the set says nothing about it`)
  }

  for (const owner of owners) {
    // An owner whose balance is the sum of exactly this corpus's events: the
    // corpus uses fresh owners, so any other number is unexplained money.
    if (owner.accrued !== owner.events) {
      gaps.push(
        `owner ${owner.owner}: events credit ${owner.events}, the balance holds ${owner.accrued ?? 'nothing'}`,
      )
    }
  }

  const fiveDifferent =
    judgements.find(
      (judgement) =>
        judgement.passed &&
        judgement.settled.length >= 5 &&
        new Set(judgement.settled.map((event) => event.net)).size === judgement.settled.length &&
        judgement.settled.every((event) => event.net > 0n),
    ) ?? null
  if (fiveDifferent === null) gaps.push('no run pays five owners different amounts (T046)')

  const passed = gaps.length === 0 && judgements.every((judgement) => judgement.passed)
  return {
    onChain,
    examined: judgements.length,
    judgements,
    owners,
    shapes,
    fiveDifferent,
    gaps,
    passed,
  }
}

export async function auditSettlement(
  connection: Connection,
  corpus: SettlementCorpusFile,
): Promise<SettlementAudit> {
  const programId = new PublicKey(corpus.programId)

  // The count of what must be examined, from the chain: every `Run` the buyer
  // has. A corpus file that lost a run would otherwise pass on fewer.
  const accounts = await runsOfBuyer(connection, programId, new PublicKey(corpus.buyer))

  const judgements: RunJudgement[] = []
  for (const entry of corpus.runs) {
    const address = new PublicKey(entry.run)
    const account = accounts.find((candidate) => candidate.pubkey.equals(address))
    if (account === undefined) continue
    const run = decodeRun(Uint8Array.from(account.account.data))
    const moves = await collectMoves(connection, programId, address, corpus.buyer)
    judgements.push(judgeRun(entry.label, entry.run, run, moves))
  }

  const owners = new Set(
    judgements.flatMap((judgement) => judgement.settled.map((event) => event.owner)),
  )
  const balances = new Map<string, { accrued: bigint; withdrawn: bigint } | null>()
  for (const owner of owners) {
    const address = PublicKey.findProgramAddressSync(
      [Buffer.from('balance'), new PublicKey(owner).toBytes()],
      programId,
    )[0]
    const info = await connection.getAccountInfo(address, 'confirmed')
    balances.set(owner, info === null ? null : decodeOwnerBalance(Uint8Array.from(info.data)))
  }

  return verdict(
    accounts.length,
    corpus.runs.length,
    judgements,
    sameOwnerHolds(judgements, balances),
  )
}
