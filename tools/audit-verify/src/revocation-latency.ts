/**
 * `SC-005` from the chain: how long a revocation takes to close the gate.
 *
 * The driver (`tools/run-dispatcher sc005`) streams orders at each trial's
 * dataset and revokes in the middle of the stream. This file trusts its report
 * for where to look and for the API's answers — the API is not a public record
 * — and for nothing else:
 *
 * - **order of events** — by slot and by position inside the block
 *   (`getBlock`), so an order that landed in the revocation's own slot is put
 *   on the side of it where it actually executed;
 * - **the clock** — block times of the revocation and of the orders, and the
 *   slot length measured over this run's own blocks, not assumed;
 * - **the verdict of each order** — its error and the named constraint in its
 *   logs; the run account and the buyer's tokens have to agree with it;
 * - **how many orders there are** — from the chain, twice: every `Run` account
 *   of this buyer, and every transaction the buyer signed. An order the report
 *   left out, accepted after a revocation, would otherwise be invisible.
 *
 * Verdict (`SC-005` read with `FR-007`, customer's decision 2026-09-29):
 * on the chain, **no** order after the revocation is accepted, and the stream
 * is watched for longer than the budget; on the API, the lag until it answers
 * `revoked` is under the budget. An API that still built an order after the
 * revocation is reported, not failed: the chain is the gate and refuses it.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import type { Connection, VersionedTransactionResponse } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import {
  BUYER_CATEGORY_BITS,
  consentPda,
  consentTerms,
  datasetConsentVersion,
  datasetPda,
  errorNameFromLogs,
  REASON_BY_ERROR,
  RUN_ACCOUNT_DISCRIMINATOR,
  requestRunArgs,
  runPda,
  USE_TYPE_BITS,
  type Verdict,
} from './consent-matrix.ts'

export const REVOKE_CONSENT_DISCRIMINATOR = sha256(
  new TextEncoder().encode('global:revoke_consent'),
).slice(0, 8)

/** Offsets inside `Run`: discriminator, `buyer`, `dispatcher`, then `nonce`. */
const RUN_BUYER_OFFSET = 8
const RUN_NONCE_OFFSET = 8 + 32 + 32

// ── Reading the inputs without trusting their shape ──────────────────────────

export class RevocationInputError extends Error {
  override readonly name = 'RevocationInputError'
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RevocationInputError(`${what} is not an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new RevocationInputError(`${what} is not text`)
  }
  return value
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RevocationInputError(`${what} is not a non-negative number`)
  }
  return value
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new RevocationInputError(`${what} is not a list`)
  return value
}

export interface PlanInput {
  trials: number
  budgetSeconds: number
  afterSeconds: number
  maxGapSeconds: number
  useType: number
  buyerCategory: number
}

export function readPlan(raw: unknown): PlanInput {
  const root = record(raw, 'plan')
  if (root.criterion !== 'SC-005') throw new RevocationInputError('the plan is not for SC-005')
  const order = record(root.order, 'plan.order')
  const useType = USE_TYPE_BITS[text(order.useType, 'plan.order.useType')]
  const buyerCategory = BUYER_CATEGORY_BITS[text(order.buyerCategory, 'plan.order.buyerCategory')]
  if (useType === undefined || buyerCategory === undefined) {
    throw new RevocationInputError('the plan orders a use or category outside the dictionary')
  }
  const plan = {
    trials: count(root.trials, 'plan.trials'),
    budgetSeconds: count(root.budgetSeconds, 'plan.budgetSeconds'),
    afterSeconds: count(root.afterSeconds, 'plan.afterSeconds'),
    maxGapSeconds: count(root.maxGapSeconds, 'plan.maxGapSeconds'),
    useType,
    buyerCategory,
  }
  if (!Number.isInteger(plan.trials) || plan.trials === 0) {
    throw new RevocationInputError('the plan names no trials')
  }
  // A stream that stops before the budget could not show a 61-second lag.
  if (plan.afterSeconds <= plan.budgetSeconds) {
    throw new RevocationInputError('the plan watches for less time than the budget')
  }
  return plan
}

export interface ApiAnswer {
  slotBefore: number
  slotAfter: number
  status: number
  reasons: string[]
}

export interface ReportOrder {
  nonce: bigint
  kind: 'trial' | 'witness'
  trial: number | null
  signature: string | null
  landed: boolean
  api: ApiAnswer
}

export interface ReportTrial {
  index: number
  datasetId: string
  owner: string
  revokeSignature: string
  opened: { nonce: bigint; signature: string } | null
}

export interface RevocationReportInput {
  programId: string
  buyer: string
  dispatcher: string
  witness: { datasetId: string; owner: string }
  trials: ReportTrial[]
  orders: ReportOrder[]
}

export function readRevocationReport(raw: unknown): RevocationReportInput {
  const root = record(raw, 'report')
  if (root.criterion !== 'SC-005') throw new RevocationInputError('the report is not for SC-005')
  const witness = record(root.witness, 'report.witness')
  return {
    programId: text(root.programId, 'report.programId'),
    buyer: text(root.buyer, 'report.buyer'),
    dispatcher: text(root.dispatcher, 'report.dispatcher'),
    witness: {
      datasetId: text(witness.datasetId, 'report.witness.datasetId'),
      owner: text(witness.owner, 'report.witness.owner'),
    },
    trials: list(root.trials, 'report.trials').map((item, at) => {
      const trial = record(item, `trial ${at}`)
      const opened = trial.opened === null ? null : record(trial.opened, `trial ${at}.opened`)
      return {
        index: count(trial.index, `trial ${at}.index`),
        datasetId: text(trial.datasetId, `trial ${at}.datasetId`),
        owner: text(trial.owner, `trial ${at}.owner`),
        revokeSignature: text(trial.revokeSignature, `trial ${at}.revokeSignature`),
        opened:
          opened === null
            ? null
            : {
                nonce: BigInt(text(opened.nonce, `trial ${at}.opened.nonce`)),
                signature: text(opened.signature, `trial ${at}.opened.signature`),
              },
      }
    }),
    orders: list(root.probes, 'report.probes').map((item, at) => {
      const order = record(item, `order ${at}`)
      const api = record(order.api, `order ${at}.api`)
      const chain = record(order.chain, `order ${at}.chain`)
      const kind = order.kind
      if (kind !== 'trial' && kind !== 'witness') {
        throw new RevocationInputError(`order ${at}.kind is ${String(kind)}`)
      }
      return {
        nonce: BigInt(text(order.nonce, `order ${at}.nonce`)),
        kind,
        trial: order.trial === null ? null : count(order.trial, `order ${at}.trial`),
        signature:
          chain.signature === null ? null : text(chain.signature, `order ${at}.chain.signature`),
        landed: chain.landed === true,
        api: {
          slotBefore: count(api.slotBefore, `order ${at}.api.slotBefore`),
          slotAfter: count(api.slotAfter, `order ${at}.api.slotAfter`),
          status: count(api.status, `order ${at}.api.status`),
          reasons: list(api.reasons, `order ${at}.api.reasons`).map((reason, slot) =>
            text(reason, `order ${at}.api.reasons.${slot}`),
          ),
        },
      }
    }),
  }
}

// ── Where an event sits on the chain ─────────────────────────────────────────

/** Slot, then position in the block: the order in which transactions executed. */
export interface Position {
  slot: number
  index: number
}

export function isBefore(a: Position, b: Position): boolean {
  return a.slot < b.slot || (a.slot === b.slot && a.index < b.index)
}

/**
 * Slot length over this run's own blocks.
 *
 * Block times are whole seconds; over a couple of minutes of slots the error
 * is a fraction of a percent. `null` when the span is too short to say.
 */
export function measureSlotSeconds(
  points: readonly { slot: number; blockTime: number }[],
): number | null {
  if (points.length < 2) return null
  let first = points[0]
  let last = points[0]
  for (const point of points) {
    if (first === undefined || point.slot < first.slot) first = point
    if (last === undefined || point.slot > last.slot) last = point
  }
  if (first === undefined || last === undefined) return null
  const slots = last.slot - first.slot
  const seconds = last.blockTime - first.blockTime
  if (slots < 50 || seconds <= 0) return null
  return seconds / slots
}

// ── Evidence and judgement ───────────────────────────────────────────────────

export interface OrderEvidence {
  nonce: bigint
  kind: 'trial' | 'witness'
  trial: number | null
  /** Problems that make this order's chain evidence incomplete. */
  gaps: string[]
  /** Found on chain as this order: a `request_run` with this nonce and pool. */
  found: boolean
  landedPerReport: boolean
  position: Position | null
  blockTime: number | null
  verdict: Verdict | null
  errorName: string | null
  api: ApiAnswer
}

export interface RevocationEvidence {
  gaps: string[]
  position: Position | null
  blockTime: number | null
  /** `revoked_at` the program wrote: its own clock at the revocation. */
  revokedAt: bigint | null
}

export interface OpenEvidence {
  gaps: string[]
  nonce: bigint
  ok: boolean
  position: Position | null
}

export interface ApiLayer {
  /** The API built an order for this dataset before the revocation. */
  openBefore: boolean
  /** Slots from the revocation to the first `revoked` answer — an upper bound. */
  lagSlots: number | null
  /** Most slots past the revocation at which the API still built an order. */
  staleSlots: number
  /** Orders built again after the API had once answered `revoked`. */
  flaps: number
  /** Refusals after the revocation that named something other than `revoked`. */
  wrongReasons: number
}

export interface TrialJudgement {
  index: number
  examined: boolean
  gaps: string[]
  revocationSlot: number | null
  before: number
  acceptedBefore: number
  after: number
  /** `FR-007`: orders that executed after the revocation and were accepted. */
  acceptedAfter: number
  wrongReasons: number
  /** Orders that sat in the revocation's own block, ahead of it. */
  sameBlockBefore: number
  /** Slots from the revocation to the first order after it. */
  nearestAfterSlots: number | null
  /** Seconds from the revocation to the last order accepted after it; 0 if none. */
  chainLatencySeconds: number
  /** Seconds the stream was watched after the revocation, by block time. */
  coverageSeconds: number
  /** Longest stretch after the revocation with no order, in seconds. */
  maxGapSeconds: number
  dropped: number
  api: ApiLayer
  apiLagSeconds: number | null
  witnessAccepted: number
  witnessRefused: number
  opened: boolean
  passed: boolean
}

export interface TrialInput {
  index: number
  plan: PlanInput
  slotSeconds: number
  revocation: RevocationEvidence
  orders: OrderEvidence[]
  witnesses: OrderEvidence[]
  opened: OpenEvidence | null
}

function judgeApi(orders: readonly OrderEvidence[], revocationSlot: number): ApiLayer {
  const answers = [...orders].sort((a, b) => (a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0))
  const built = (answer: ApiAnswer) => answer.status >= 200 && answer.status < 300
  const revoked = (answer: ApiAnswer) => !built(answer) && answer.reasons.includes('revoked')

  let lagSlots: number | null = null
  let staleSlots = 0
  let flaps = 0
  let wrongReasons = 0
  let openBefore = false
  for (const { api } of answers) {
    if (built(api) && api.slotAfter < revocationSlot) openBefore = true
    if (lagSlots === null) {
      if (revoked(api)) lagSlots = Math.max(0, api.slotAfter - revocationSlot)
      else if (built(api) && api.slotBefore >= revocationSlot) {
        staleSlots = Math.max(staleSlots, api.slotBefore - revocationSlot)
      }
    } else if (built(api)) flaps += 1
    if (!built(api) && api.slotBefore >= revocationSlot && !revoked(api)) wrongReasons += 1
  }
  return { openBefore, lagSlots, staleSlots, flaps, wrongReasons }
}

export function judgeTrial(input: TrialInput): TrialJudgement {
  const { plan, revocation, slotSeconds } = input
  const gaps = [...revocation.gaps]
  const empty: TrialJudgement = {
    index: input.index,
    examined: false,
    gaps,
    revocationSlot: null,
    before: 0,
    acceptedBefore: 0,
    after: 0,
    acceptedAfter: 0,
    wrongReasons: 0,
    sameBlockBefore: 0,
    nearestAfterSlots: null,
    chainLatencySeconds: 0,
    coverageSeconds: 0,
    maxGapSeconds: 0,
    dropped: 0,
    api: { openBefore: false, lagSlots: null, staleSlots: 0, flaps: 0, wrongReasons: 0 },
    apiLagSeconds: null,
    witnessAccepted: 0,
    witnessRefused: 0,
    opened: false,
    passed: false,
  }
  const origin = revocation.position
  const originTime = revocation.blockTime
  if (origin === null || originTime === null) {
    if (gaps.length === 0) gaps.push('the revocation has no place on the chain')
    return empty
  }

  // The program's own clock at the revocation against the block's: if they
  // disagree, the block time is not the moment the gate closed.
  if (revocation.revokedAt === null) gaps.push('the consent is not revoked on chain')
  else if (Math.abs(Number(revocation.revokedAt) - originTime) > 1) {
    gaps.push(`revoked_at ${revocation.revokedAt} ≠ block time ${originTime}`)
  }

  const onChain: (OrderEvidence & { position: Position; blockTime: number })[] = []
  let dropped = 0
  for (const order of input.orders) {
    gaps.push(...order.gaps)
    if (!order.found || order.position === null || order.blockTime === null) {
      // An order that never landed is a missing sample, not a verdict. One the
      // driver says landed but the chain does not have is a hole in the record.
      if (order.landedPerReport) gaps.push(`order ${order.nonce} reported landed, not on chain`)
      else dropped += 1
      continue
    }
    onChain.push({ ...order, position: order.position, blockTime: order.blockTime })
  }

  const beforeOrders = onChain.filter((order) => isBefore(order.position, origin))
  const afterOrders = onChain
    .filter((order) => isBefore(origin, order.position))
    .sort((a, b) => a.position.slot - b.position.slot || a.position.index - b.position.index)

  const acceptedBefore = beforeOrders.filter((order) => order.verdict === 'allowed').length
  const refusedBefore = beforeOrders.length - acceptedBefore
  // While the consent was in force, a refusal is a false refusal — the gate
  // was not open, and nothing after the revocation would mean anything.
  if (refusedBefore > 0) gaps.push(`${refusedBefore} orders refused before the revocation`)
  if (acceptedBefore === 0)
    gaps.push('no order accepted before the revocation: the gate never shown open')

  const acceptedAfter = afterOrders.filter((order) => order.verdict === 'allowed')
  const wrongReasons = afterOrders.filter(
    (order) =>
      order.verdict === 'refused' &&
      (order.errorName === null || REASON_BY_ERROR[order.errorName] !== 'revoked'),
  ).length
  const chainLatencySeconds = acceptedAfter.reduce(
    (latest, order) => Math.max(latest, order.blockTime - originTime),
    0,
  )

  const lastAfter = afterOrders.at(-1)
  const coverageSeconds = lastAfter === undefined ? 0 : lastAfter.blockTime - originTime
  let maxGapSlots = 0
  let previous = origin.slot
  for (const order of afterOrders) {
    maxGapSlots = Math.max(maxGapSlots, order.position.slot - previous)
    previous = order.position.slot
  }
  if (afterOrders.length === 0) gaps.push('no order after the revocation')

  // The witness, over the stretch this trial was refused: its orders passing
  // is what tells a closed gate from a stand that stopped accepting anything.
  const inRange = input.witnesses.filter(
    (witness) =>
      witness.found &&
      witness.position !== null &&
      isBefore(origin, witness.position) &&
      lastAfter !== undefined &&
      isBefore(witness.position, lastAfter.position),
  )
  const witnessAccepted = inRange.filter((witness) => witness.verdict === 'allowed').length
  const witnessRefused = inRange.length - witnessAccepted

  // FR-007's other half: a run ordered before the revocation is left alone.
  let opened = false
  if (input.opened === null) gaps.push('no run accepted before the revocation was opened after it')
  else {
    gaps.push(...input.opened.gaps)
    const run = beforeOrders.find((order) => order.nonce === input.opened?.nonce)
    if (run === undefined || run.verdict !== 'allowed') {
      gaps.push(`opened run ${input.opened.nonce} was not accepted before the revocation`)
    } else if (input.opened.position === null || !isBefore(origin, input.opened.position)) {
      gaps.push('the run was not opened after the revocation')
    } else opened = input.opened.ok
  }

  const api = judgeApi(input.orders, origin.slot)
  if (!api.openBefore) gaps.push('the API never built an order before the revocation')
  if (api.lagSlots === null) gaps.push('the API never answered revoked')
  const apiLagSeconds = api.lagSlots === null ? null : api.lagSlots * slotSeconds

  const examined = gaps.length === 0
  const passed =
    examined &&
    acceptedAfter.length === 0 &&
    wrongReasons === 0 &&
    chainLatencySeconds < plan.budgetSeconds &&
    coverageSeconds >= plan.budgetSeconds &&
    maxGapSlots * slotSeconds <= plan.maxGapSeconds &&
    apiLagSeconds !== null &&
    apiLagSeconds < plan.budgetSeconds &&
    api.flaps === 0 &&
    api.wrongReasons === 0 &&
    witnessAccepted > 0 &&
    witnessRefused === 0 &&
    opened

  const first = afterOrders[0]
  return {
    ...empty,
    examined,
    gaps,
    revocationSlot: origin.slot,
    before: beforeOrders.length,
    acceptedBefore,
    after: afterOrders.length,
    acceptedAfter: acceptedAfter.length,
    wrongReasons,
    sameBlockBefore: beforeOrders.filter((order) => order.position.slot === origin.slot).length,
    nearestAfterSlots: first === undefined ? null : first.position.slot - origin.slot,
    chainLatencySeconds,
    coverageSeconds,
    maxGapSeconds: maxGapSlots * slotSeconds,
    dropped,
    api,
    apiLagSeconds,
    witnessAccepted,
    witnessRefused,
    opened,
    passed,
  }
}

export interface RevocationAudit {
  expected: number
  examined: number
  slotSeconds: number | null
  /** Discrepancies that belong to no single trial: the census of orders. */
  gaps: string[]
  census: { runAccounts: number; acceptedOrders: number; buyerTransactions: number }
  judgements: TrialJudgement[]
  passed: boolean
}

export function summarize(
  judgements: TrialJudgement[],
  expected: number,
  gaps: string[],
  slotSeconds: number | null,
  census: RevocationAudit['census'],
): RevocationAudit {
  const examined = judgements.filter((judgement) => judgement.examined).length
  // Nine trials out of ten read exactly like ten: the count is part of the verdict.
  const passed =
    gaps.length === 0 &&
    slotSeconds !== null &&
    judgements.length === expected &&
    examined === expected &&
    judgements.every((judgement) => judgement.passed)
  return { expected, examined, slotSeconds, gaps, census, judgements, passed }
}

// ── Collecting the evidence ──────────────────────────────────────────────────

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => data[index] === byte)
}

async function transaction(
  connection: Connection,
  signature: string,
): Promise<VersionedTransactionResponse | null> {
  return connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
}

/** Positions inside blocks, one `getBlock` per slot. */
class BlockOrder {
  private readonly blocks = new Map<number, string[]>()
  private readonly connection: Connection
  constructor(connection: Connection) {
    this.connection = connection
  }

  async position(slot: number, signature: string): Promise<Position | null> {
    let signatures = this.blocks.get(slot)
    if (signatures === undefined) {
      const block = await this.connection.getBlock(slot, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
        rewards: false,
      })
      signatures = (block?.transactions ?? []).map((entry) => entry.transaction.signatures[0] ?? '')
      this.blocks.set(slot, signatures)
    }
    const index = signatures.indexOf(signature)
    return index < 0 ? null : { slot, index }
  }
}

function tokenDelta(tx: VersionedTransactionResponse, owner: string): bigint | null {
  const pre = tx.meta?.preTokenBalances?.find((balance) => balance.owner === owner)
  const post = tx.meta?.postTokenBalances?.find((balance) => balance.owner === owner)
  if (pre === undefined || post === undefined) return null
  return BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount)
}

interface Context {
  connection: Connection
  programId: PublicKey
  buyer: PublicKey
  plan: PlanInput
  blocks: BlockOrder
  /** Nonces of every `Run` account of this buyer on chain. */
  runs: Set<bigint>
}

async function collectOrder(
  ctx: Context,
  order: ReportOrder,
  dataset: PublicKey,
): Promise<OrderEvidence> {
  const evidence: OrderEvidence = {
    nonce: order.nonce,
    kind: order.kind,
    trial: order.trial,
    gaps: [],
    found: false,
    landedPerReport: order.landed,
    position: null,
    blockTime: null,
    verdict: null,
    errorName: null,
    api: order.api,
  }
  if (order.signature === null) return evidence
  const tx = await transaction(ctx.connection, order.signature)
  if (tx === null || tx.meta === null) return evidence

  const keys = tx.transaction.message.staticAccountKeys
  const has = (key: PublicKey) => keys.some((candidate) => candidate.equals(key))
  const programIndex = keys.findIndex((key) => key.equals(ctx.programId))
  const instruction = tx.transaction.message.compiledInstructions.find(
    (candidate) => candidate.programIdIndex === programIndex,
  )
  const args = instruction === undefined ? null : requestRunArgs(instruction.data)
  const at = `order ${order.nonce}`
  if (args === null) evidence.gaps.push(`${at}: not a request_run of this program`)
  else {
    if (args.nonce !== order.nonce) evidence.gaps.push(`${at}: carries nonce ${args.nonce}`)
    if (args.useType !== ctx.plan.useType) evidence.gaps.push(`${at}: ordered use ${args.useType}`)
    if (args.buyerCategory !== ctx.plan.buyerCategory) {
      evidence.gaps.push(`${at}: ordered category ${args.buyerCategory}`)
    }
  }
  if (!has(runPda(ctx.programId, ctx.buyer, order.nonce))) {
    evidence.gaps.push(`${at}: does not touch the derived run address`)
  }
  if (!has(dataset)) evidence.gaps.push(`${at}: does not carry dataset ${dataset.toBase58()}`)

  evidence.found = true
  evidence.verdict = tx.meta.err === null ? 'allowed' : 'refused'
  evidence.errorName = errorNameFromLogs(tx.meta.logMessages ?? [])
  evidence.blockTime = tx.blockTime ?? null
  if (evidence.blockTime === null) evidence.gaps.push(`${at}: no block time`)
  evidence.position = await ctx.blocks.position(tx.slot, order.signature)
  if (evidence.position === null) evidence.gaps.push(`${at}: not in its block's signatures`)

  // The chain's own story has to hang together: an accepted order leaves a run
  // and costs the buyer; a refused one does neither.
  const accepted = evidence.verdict === 'allowed'
  if (ctx.runs.has(order.nonce) !== accepted) {
    evidence.gaps.push(
      `${at}: run account ${accepted ? 'missing' : 'exists'} after ${evidence.verdict}`,
    )
  }
  const delta = tokenDelta(tx, ctx.buyer.toBase58())
  if (delta === null) evidence.gaps.push(`${at}: buyer token balances not in the transaction`)
  else if (delta < 0n !== accepted) evidence.gaps.push(`${at}: buyer tokens moved by ${delta}`)
  return evidence
}

async function collectRevocation(
  ctx: Context,
  dataset: PublicKey,
  signature: string,
): Promise<RevocationEvidence> {
  const evidence: RevocationEvidence = {
    gaps: [],
    position: null,
    blockTime: null,
    revokedAt: null,
  }
  const tx = await transaction(ctx.connection, signature)
  if (tx === null || tx.meta === null) {
    evidence.gaps.push('the revocation is not on chain')
    return evidence
  }
  if (tx.meta.err !== null) evidence.gaps.push('the revocation failed')

  const account = await ctx.connection.getAccountInfo(dataset, 'confirmed')
  if (account === null || !account.owner.equals(ctx.programId)) {
    evidence.gaps.push(`dataset ${dataset.toBase58()} is not on chain`)
    return evidence
  }
  // Revocation adds no version: the consent revoked is the one in force.
  const consent = consentPda(ctx.programId, dataset, datasetConsentVersion(account.data))

  const keys = tx.transaction.message.staticAccountKeys
  const programIndex = keys.findIndex((key) => key.equals(ctx.programId))
  const instruction = tx.transaction.message.compiledInstructions.find(
    (candidate) => candidate.programIdIndex === programIndex,
  )
  if (instruction === undefined || !startsWith(instruction.data, REVOKE_CONSENT_DISCRIMINATOR)) {
    evidence.gaps.push('the transaction is not a revoke_consent of this program')
  }
  if (!keys.some((key) => key.equals(consent))) {
    evidence.gaps.push('the revocation does not touch the consent in force')
  }

  evidence.blockTime = tx.blockTime ?? null
  if (evidence.blockTime === null) evidence.gaps.push('the revocation has no block time')
  evidence.position = await ctx.blocks.position(tx.slot, signature)
  if (evidence.position === null) evidence.gaps.push('the revocation is not in its block')

  const consentAccount = await ctx.connection.getAccountInfo(consent, 'confirmed')
  if (consentAccount === null) evidence.gaps.push('the consent in force is missing')
  else evidence.revokedAt = consentTerms(consentAccount.data).revokedAt
  return evidence
}

async function collectOpen(
  ctx: Context,
  opened: { nonce: bigint; signature: string },
): Promise<OpenEvidence> {
  const evidence: OpenEvidence = { gaps: [], nonce: opened.nonce, ok: false, position: null }
  const tx = await transaction(ctx.connection, opened.signature)
  if (tx === null || tx.meta === null) {
    evidence.gaps.push('open_run is not on chain')
    return evidence
  }
  const run = runPda(ctx.programId, ctx.buyer, opened.nonce)
  if (!tx.transaction.message.staticAccountKeys.some((key) => key.equals(run))) {
    evidence.gaps.push('open_run does not touch the derived run address')
  }
  evidence.ok = tx.meta.err === null
  evidence.position = await ctx.blocks.position(tx.slot, opened.signature)
  return evidence
}

/** Every `Run` account of this buyer, by nonce — the census of accepted orders. */
async function runCensus(
  connection: Connection,
  programId: PublicKey,
  buyer: PublicKey,
): Promise<Set<bigint>> {
  const accounts = await connection.getProgramAccounts(programId, {
    commitment: 'confirmed',
    dataSlice: { offset: RUN_NONCE_OFFSET, length: 8 },
    filters: [
      {
        memcmp: {
          offset: 0,
          encoding: 'base64',
          bytes: Buffer.from(RUN_ACCOUNT_DISCRIMINATOR).toString('base64'),
        },
      },
      { memcmp: { offset: RUN_BUYER_OFFSET, bytes: buyer.toBase58() } },
    ],
  })
  return new Set(
    accounts.map(({ account }) =>
      new DataView(account.data.buffer, account.data.byteOffset, 8).getBigUint64(0, true),
    ),
  )
}

/** Every signature the buyer's key appears in, oldest page last. */
async function buyerSignatures(connection: Connection, buyer: PublicKey): Promise<string[]> {
  const all: string[] = []
  let before: string | undefined
  for (;;) {
    const page = await connection.getSignaturesForAddress(
      buyer,
      { limit: 1000, ...(before === undefined ? {} : { before }) },
      'confirmed',
    )
    all.push(...page.map((entry) => entry.signature))
    if (page.length < 1000) return all
    before = page.at(-1)?.signature
  }
}

async function inBatches<T, R>(items: readonly T[], size: number, map: (item: T) => Promise<R>) {
  const results: R[] = []
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(map))))
  }
  return results
}

export async function auditRevocationLatency(
  connection: Connection,
  plan: PlanInput,
  report: RevocationReportInput,
): Promise<RevocationAudit> {
  const programId = new PublicKey(report.programId)
  const buyer = new PublicKey(report.buyer)
  const runs = await runCensus(connection, programId, buyer)
  const ctx: Context = {
    connection,
    programId,
    buyer,
    plan,
    blocks: new BlockOrder(connection),
    runs,
  }
  const gaps: string[] = []

  const witnessDataset = datasetPda(
    programId,
    new PublicKey(report.witness.owner),
    report.witness.datasetId,
  )
  const trialDataset = new Map(
    report.trials.map((trial) => [
      trial.index,
      datasetPda(programId, new PublicKey(trial.owner), trial.datasetId),
    ]),
  )

  const evidence = await inBatches(report.orders, 16, (order) => {
    const dataset = order.kind === 'witness' ? witnessDataset : trialDataset.get(order.trial ?? -1)
    if (dataset === undefined) {
      return Promise.resolve<OrderEvidence>({
        nonce: order.nonce,
        kind: order.kind,
        trial: order.trial,
        gaps: [`order ${order.nonce} belongs to trial ${order.trial}, which the report lacks`],
        found: false,
        landedPerReport: order.landed,
        position: null,
        blockTime: null,
        verdict: null,
        errorName: null,
        api: order.api,
      })
    }
    return collectOrder(ctx, order, dataset)
  })

  // The census, from the chain: every run of this buyer is an accepted order
  // in the report, and every order the buyer signed is in the report.
  const accepted = new Set(
    evidence.filter((order) => order.verdict === 'allowed').map((order) => order.nonce),
  )
  for (const nonce of runs) {
    if (!accepted.has(nonce))
      gaps.push(`run ${nonce} is on chain but not an accepted order of the report`)
  }
  const reported = new Set(
    report.orders.flatMap((order) => (order.signature === null ? [] : [order.signature])),
  )
  const signatures = await buyerSignatures(connection, buyer)
  const unreported = signatures.filter((signature) => !reported.has(signature))
  for (const signature of unreported) {
    const tx = await transaction(connection, signature)
    if (tx === null) continue
    const keys = tx.transaction.message.staticAccountKeys
    const programIndex = keys.findIndex((key) => key.equals(programId))
    const orderLike = tx.transaction.message.compiledInstructions.some(
      (candidate) =>
        candidate.programIdIndex === programIndex && requestRunArgs(candidate.data) !== null,
    )
    if (orderLike) gaps.push(`order ${signature} was signed by the buyer but is not in the report`)
  }

  const slotSeconds = measureSlotSeconds(
    evidence.flatMap((order) =>
      order.position === null || order.blockTime === null
        ? []
        : [{ slot: order.position.slot, blockTime: order.blockTime }],
    ),
  )
  if (slotSeconds === null) gaps.push('too few blocks to measure the slot length')

  const indices = new Set(report.trials.map((trial) => trial.index))
  for (let index = 0; index < plan.trials; index += 1) {
    if (!indices.has(index)) gaps.push(`trial ${index} is missing from the report`)
  }
  if (report.trials.length !== indices.size) gaps.push('the report repeats a trial')

  const witnesses = evidence.filter((order) => order.kind === 'witness')
  const judgements: TrialJudgement[] = []
  for (const trial of report.trials) {
    const dataset = trialDataset.get(trial.index)
    if (dataset === undefined) continue
    judgements.push(
      judgeTrial({
        index: trial.index,
        plan,
        slotSeconds: slotSeconds ?? 0,
        revocation: await collectRevocation(ctx, dataset, trial.revokeSignature),
        orders: evidence.filter((order) => order.kind === 'trial' && order.trial === trial.index),
        witnesses,
        opened: trial.opened === null ? null : await collectOpen(ctx, trial.opened),
      }),
    )
  }

  // A witness refused anywhere means the stand refused an order nobody revoked.
  const refusedWitness = witnesses.filter((witness) => witness.verdict === 'refused').length
  if (refusedWitness > 0) gaps.push(`${refusedWitness} witness orders refused`)
  gaps.push(...witnesses.flatMap((witness) => witness.gaps))

  return summarize(judgements, plan.trials, gaps, slotSeconds, {
    runAccounts: runs.size,
    acceptedOrders: accepted.size,
    buyerTransactions: signatures.length,
  })
}
