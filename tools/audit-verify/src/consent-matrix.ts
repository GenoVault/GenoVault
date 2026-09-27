/**
 * `SC-004` from the chain: the consent matrix, judged without our code.
 *
 * The driver (`tools/run-dispatcher sc004`) orders twenty scenarios and writes
 * down where it sent them. This file trusts that report for nothing but where
 * to look. Everything a verdict rests on is read from the chain and derived
 * here:
 *
 * - the run and dataset addresses — derived from the buyer, nonce, owners and
 *   ids, not copied from the report;
 * - that the transaction is this scenario's order — a `request_run` with this
 *   nonce, this use type and this category, over exactly this pool;
 * - the verdict — the transaction's error, the named constraint in its logs,
 *   whether the `Run` account exists, whether `open_run` went through, and
 *   whether the buyer's tokens moved;
 * - the clock — every deadline read from the consent accounts, compared with
 *   the block time of the order. A deadline scenario whose order was not
 *   provably on the right side of it proves nothing either way.
 *
 * The labels come from the fixture, written from the owner's intent in words.
 * The verifier checks the fixture's shape itself — twenty scenarios, ten and
 * ten — because a matrix of nineteen would still produce a verdict.
 *
 * The API layer is the one thing taken from the report: the API is not a
 * public record, and a verifier that logged in to it would be checking our
 * server with our credentials. It is reported next to the chain, never
 * instead of it.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import type { Connection, VersionedTransactionResponse } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import { Reader } from './borsh.ts'

export const MATRIX_SIZE = 20
export const PER_LABEL = 10

export const USE_TYPE_BITS: Readonly<Record<string, number>> = {
  oncology: 1 << 0,
  cardiology: 1 << 1,
  rareDisease: 1 << 2,
  populationGenetics: 1 << 3,
  pharmaCommercial: 1 << 4,
}

export const BUYER_CATEGORY_BITS: Readonly<Record<string, number>> = {
  academic: 1 << 0,
  nonProfit: 1 << 1,
  commercial: 1 << 2,
  government: 1 << 3,
}

/**
 * Named constraint in the program's log → the reason a label speaks.
 *
 * Written here, not imported, and compared with `packages/shared` by a test.
 * `AccountNotInitialized` stands for `no-consent` on purpose: `request_run`
 * loads the consent account before it looks at `consent_version`, so a
 * dataset with no consent is refused by Anchor's own check — the consent
 * account at version 1 does not exist.
 */
export const REASON_BY_ERROR: Readonly<Record<string, string>> = {
  ConsentMissing: 'no-consent',
  AccountNotInitialized: 'no-consent',
  ConsentIsRevoked: 'revoked',
  ConsentExpired: 'expired',
  UseTypeForbidden: 'use-forbidden',
  UseTypeNotAllowed: 'use-not-allowed',
  BuyerCategoryNotAllowed: 'category-not-allowed',
}

export type Verdict = 'allowed' | 'refused'

// ── Reading the inputs without trusting their shape ──────────────────────────

export class MatrixInputError extends Error {
  override readonly name = 'MatrixInputError'
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MatrixInputError(`${what} is not an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw new MatrixInputError(`${what} is not text`)
  return value
}

function list(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new MatrixInputError(`${what} is not a list`)
  return value
}

export interface FixtureScenario {
  id: string
  label: Verdict
  reason: string | null
  datasets: string[]
  useType: string
  buyerCategory: string
  orderAfterDeadline: boolean
}

export function readFixture(raw: unknown): FixtureScenario[] {
  const root = record(raw, 'fixture')
  const scenarios = list(root.scenarios, 'fixture.scenarios').map((item, index) => {
    const at = `scenario ${index}`
    const scenario = record(item, at)
    const label = text(scenario.label, `${at}.label`)
    if (label !== 'allowed' && label !== 'refused') {
      throw new MatrixInputError(`${at}.label is ${label}`)
    }
    const order = record(scenario.order, `${at}.order`)
    const useType = text(order.useType, `${at}.order.useType`)
    const buyerCategory = text(order.buyerCategory, `${at}.order.buyerCategory`)
    if (USE_TYPE_BITS[useType] === undefined) throw new MatrixInputError(`${at}: use ${useType}`)
    if (BUYER_CATEGORY_BITS[buyerCategory] === undefined) {
      throw new MatrixInputError(`${at}: category ${buyerCategory}`)
    }
    return {
      id: text(scenario.id, `${at}.id`),
      label,
      reason: scenario.reason === null ? null : text(scenario.reason, `${at}.reason`),
      datasets: list(scenario.pool, `${at}.pool`).map((entry, slot) =>
        text(record(entry, `${at}.pool.${slot}`).dataset, `${at}.pool.${slot}.dataset`),
      ),
      useType,
      buyerCategory,
      orderAfterDeadline: order.orderAfterDeadline === true,
    } satisfies FixtureScenario
  })

  // The shape SC-004 names, checked here rather than believed.
  if (scenarios.length !== MATRIX_SIZE) {
    throw new MatrixInputError(
      `SC-004 names ${MATRIX_SIZE} scenarios, fixture has ${scenarios.length}`,
    )
  }
  for (const label of ['allowed', 'refused'] as const) {
    const count = scenarios.filter((scenario) => scenario.label === label).length
    if (count !== PER_LABEL) {
      throw new MatrixInputError(`SC-004 names ${PER_LABEL} ${label}, fixture has ${count}`)
    }
  }
  const ids = new Set(scenarios.map((scenario) => scenario.id))
  if (ids.size !== scenarios.length) throw new MatrixInputError('fixture repeats a scenario id')
  return scenarios
}

export interface ReportScenario {
  id: string
  nonce: bigint
  owners: string[]
  datasetIds: string[]
  apiOrderStatus: number
  apiReasons: string[]
  requestSignature: string
  openSignature: string
}

export interface MatrixReportInput {
  programId: string
  buyer: string
  dispatcher: string
  scenarios: ReportScenario[]
}

export function readReport(raw: unknown): MatrixReportInput {
  const root = record(raw, 'report')
  return {
    programId: text(root.programId, 'report.programId'),
    buyer: text(root.buyer, 'report.buyer'),
    dispatcher: text(root.dispatcher, 'report.dispatcher'),
    scenarios: list(root.scenarios, 'report.scenarios').map((item, index) => {
      const at = `report scenario ${index}`
      const scenario = record(item, at)
      const datasets = list(scenario.datasets, `${at}.datasets`).map((entry, slot) =>
        record(entry, `${at}.datasets.${slot}`),
      )
      const api = record(scenario.api, `${at}.api`)
      const chain = record(scenario.chain, `${at}.chain`)
      const status = api.orderStatus
      if (typeof status !== 'number') throw new MatrixInputError(`${at}.api.orderStatus`)
      return {
        id: text(scenario.id, `${at}.id`),
        nonce: BigInt(text(scenario.nonce, `${at}.nonce`)),
        owners: datasets.map((entry, slot) => text(entry.owner, `${at}.datasets.${slot}.owner`)),
        datasetIds: datasets.map((entry, slot) =>
          text(entry.datasetId, `${at}.datasets.${slot}.datasetId`),
        ),
        apiOrderStatus: status,
        apiReasons: list(api.orderReasons, `${at}.api.orderReasons`).map((reason, slot) =>
          text(reason, `${at}.api.orderReasons.${slot}`),
        ),
        requestSignature: text(chain.requestSignature, `${at}.chain.requestSignature`),
        openSignature: text(chain.openSignature, `${at}.chain.openSignature`),
      }
    }),
  }
}

// ── Anchor conventions, reproduced ───────────────────────────────────────────

function discriminator(preimage: string): Uint8Array {
  return sha256(new TextEncoder().encode(preimage)).slice(0, 8)
}

export const REQUEST_RUN_DISCRIMINATOR = discriminator('global:request_run')
export const DATASET_DISCRIMINATOR = discriminator('account:Dataset')
export const CONSENT_DISCRIMINATOR = discriminator('account:Consent')
export const RUN_ACCOUNT_DISCRIMINATOR = discriminator('account:Run')

function startsWith(data: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => data[index] === byte)
}

function u64le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  return bytes
}

function u32le(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, true)
  return bytes
}

export function runPda(programId: PublicKey, buyer: PublicKey, nonce: bigint): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('run'), buyer.toBytes(), u64le(nonce)],
    programId,
  )[0]
}

export function datasetPda(programId: PublicKey, owner: PublicKey, datasetId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('dataset'), owner.toBytes(), new TextEncoder().encode(datasetId)],
    programId,
  )[0]
}

export function consentPda(programId: PublicKey, dataset: PublicKey, version: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode('consent'), dataset.toBytes(), u32le(version)],
    programId,
  )[0]
}

/** `consent_version` of a `Dataset`: the only field the verdict needs. */
export function datasetConsentVersion(data: Uint8Array): number {
  if (!startsWith(data, DATASET_DISCRIMINATOR)) throw new MatrixInputError('not a Dataset')
  const reader = new Reader(data.subarray(8))
  reader.pubkey() // owner
  reader.bytesOf(reader.u32()) // dataset_id
  reader.u32() // version
  reader.bytesOf(32) // content_hash
  reader.u64() // record_count_claimed
  reader.u64() // price_per_1k
  return reader.u32()
}

export interface ConsentTerms {
  expiresAt: bigint | null
  revokedAt: bigint | null
}

export function consentTerms(data: Uint8Array): ConsentTerms {
  if (!startsWith(data, CONSENT_DISCRIMINATOR)) throw new MatrixInputError('not a Consent')
  const reader = new Reader(data.subarray(8))
  reader.pubkey() // dataset
  reader.u32() // version
  reader.u32() // allowed_uses
  reader.u32() // forbidden_uses
  reader.u32() // buyer_categories
  const expiresAt = reader.bool() ? reader.i64() : null
  const revokedAt = reader.bool() ? reader.i64() : null
  return { expiresAt, revokedAt }
}

export interface RequestArgs {
  nonce: bigint
  useType: number
  buyerCategory: number
}

/** The head of `RequestRunArgs`: nonce, recipe, use, category. */
export function requestRunArgs(data: Uint8Array): RequestArgs | null {
  if (data.length < 8 + 18 || !startsWith(data, REQUEST_RUN_DISCRIMINATOR)) return null
  const reader = new Reader(data.subarray(8))
  const nonce = reader.u64()
  reader.u16() // recipe_id
  return { nonce, useType: reader.u32(), buyerCategory: reader.u32() }
}

export function errorNameFromLogs(logs: readonly string[]): string | null {
  for (const line of logs) {
    const match = /Error Code: (\w+)\./.exec(line)
    if (match?.[1] !== undefined) return match[1]
  }
  return null
}

// ── Evidence and judgement ───────────────────────────────────────────────────

/** Everything the chain says about one scenario — or why it could not say. */
export interface ChainEvidence {
  /** Problems that make the scenario unexamined: its evidence is not whole. */
  gaps: string[]
  verdict: Verdict | null
  errorName: string | null
  runExists: boolean
  opened: boolean
  buyerTokenDelta: bigint | null
  blockTime: number | null
  /** Every deadline written for the pool, from the consent accounts. */
  deadlines: bigint[]
  /** Deadline of the version in force when the order was judged, per dataset. */
  currentDeadlines: (bigint | null)[]
}

export interface ScenarioJudgement {
  id: string
  label: Verdict
  expectedReason: string | null
  examined: boolean
  gaps: string[]
  chain: Verdict | null
  chainReason: string | null
  api: Verdict
  apiReasons: string[]
  falsePass: boolean
  falseRefusal: boolean
  wrongReason: boolean
  apiFalsePass: boolean
  apiFalseRefusal: boolean
  apiWrongReason: boolean
}

export function judge(
  scenario: FixtureScenario,
  evidence: ChainEvidence,
  api: { orderStatus: number; reasons: string[] },
  orderedAfterDeadline: boolean,
): ScenarioJudgement {
  const gaps = [...evidence.gaps]

  // The chain's own story has to hang together: an accepted order leaves a run
  // that opens and costs the buyer; a refused one leaves none of the three.
  if (evidence.verdict !== null) {
    const accepted = evidence.verdict === 'allowed'
    if (evidence.runExists !== accepted) {
      gaps.push(
        `run account ${evidence.runExists ? 'exists' : 'missing'} after ${evidence.verdict}`,
      )
    }
    if (evidence.opened !== accepted) {
      gaps.push(`open_run ${evidence.opened ? 'succeeded' : 'failed'} after ${evidence.verdict}`)
    }
    if (evidence.buyerTokenDelta !== null) {
      const paid = evidence.buyerTokenDelta < 0n
      if (paid !== accepted) gaps.push(`buyer tokens moved by ${evidence.buyerTokenDelta}`)
    } else {
      gaps.push('buyer token balances not in the transaction')
    }
  }

  // The clock: a deadline scenario is only evidence if the order sits on the
  // side of the deadline the scenario is about.
  if (evidence.blockTime !== null) {
    const time = BigInt(evidence.blockTime)
    if (orderedAfterDeadline) {
      if (evidence.deadlines.length === 0) gaps.push('ordered after a deadline, none on chain')
      for (const deadline of evidence.deadlines) {
        if (time < deadline) gaps.push(`ordered at ${time}, before the deadline ${deadline}`)
      }
    } else {
      for (const deadline of evidence.currentDeadlines) {
        if (deadline !== null && time >= deadline) {
          gaps.push(`ordered at ${time}, after the deadline ${deadline} in force`)
        }
      }
    }
  }

  const examined = gaps.length === 0 && evidence.verdict !== null
  const chain = examined ? evidence.verdict : null
  const chainReason =
    evidence.errorName === null ? null : (REASON_BY_ERROR[evidence.errorName] ?? evidence.errorName)
  const apiVerdict: Verdict =
    api.orderStatus >= 200 && api.orderStatus < 300 ? 'allowed' : 'refused'

  return {
    id: scenario.id,
    label: scenario.label,
    expectedReason: scenario.reason,
    examined,
    gaps,
    chain,
    chainReason,
    api: apiVerdict,
    apiReasons: api.reasons,
    falsePass: chain === 'allowed' && scenario.label === 'refused',
    falseRefusal: chain === 'refused' && scenario.label === 'allowed',
    wrongReason:
      chain === 'refused' && scenario.label === 'refused' && chainReason !== scenario.reason,
    apiFalsePass: apiVerdict === 'allowed' && scenario.label === 'refused',
    apiFalseRefusal: apiVerdict === 'refused' && scenario.label === 'allowed',
    apiWrongReason:
      apiVerdict === 'refused' &&
      scenario.label === 'refused' &&
      (scenario.reason === null || !api.reasons.includes(scenario.reason)),
  }
}

export interface MatrixAudit {
  expected: number
  examined: number
  judgements: ScenarioJudgement[]
  chain: { falsePasses: number; falseRefusals: number; wrongReasons: number }
  api: { falsePasses: number; falseRefusals: number; wrongReasons: number }
  passed: boolean
}

export function summarize(judgements: ScenarioJudgement[], expected: number): MatrixAudit {
  const count = (predicate: (judgement: ScenarioJudgement) => boolean) =>
    judgements.filter(predicate).length
  const examined = count((judgement) => judgement.examined)
  const chain = {
    falsePasses: count((judgement) => judgement.falsePass),
    falseRefusals: count((judgement) => judgement.falseRefusal),
    wrongReasons: count((judgement) => judgement.wrongReason),
  }
  const api = {
    falsePasses: count((judgement) => judgement.apiFalsePass),
    falseRefusals: count((judgement) => judgement.apiFalseRefusal),
    wrongReasons: count((judgement) => judgement.apiWrongReason),
  }
  // An incomplete examination is a discrepancy, not silence: zero false
  // passes over twelve scenarios reads exactly like zero over twenty.
  const passed =
    judgements.length === expected &&
    examined === expected &&
    Object.values(chain).every((value) => value === 0) &&
    Object.values(api).every((value) => value === 0)
  return { expected, examined, judgements, chain, api, passed }
}

// ── Collecting the evidence ──────────────────────────────────────────────────

async function transaction(
  connection: Connection,
  signature: string,
): Promise<VersionedTransactionResponse | null> {
  return connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
}

function accountKeys(tx: VersionedTransactionResponse): PublicKey[] {
  return tx.transaction.message.staticAccountKeys
}

function tokenDelta(tx: VersionedTransactionResponse, owner: string): bigint | null {
  const pre = tx.meta?.preTokenBalances?.find((balance) => balance.owner === owner)
  const post = tx.meta?.postTokenBalances?.find((balance) => balance.owner === owner)
  if (pre === undefined || post === undefined) return null
  return BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount)
}

export async function collectEvidence(
  connection: Connection,
  programId: PublicKey,
  buyer: PublicKey,
  scenario: FixtureScenario,
  entry: ReportScenario,
): Promise<ChainEvidence> {
  const evidence: ChainEvidence = {
    gaps: [],
    verdict: null,
    errorName: null,
    runExists: false,
    opened: false,
    buyerTokenDelta: null,
    blockTime: null,
    deadlines: [],
    currentDeadlines: [],
  }

  if (entry.datasetIds.join('|') !== scenario.datasets.join('|')) {
    evidence.gaps.push(`report pool ${entry.datasetIds.join(',')} is not the fixture's pool`)
    return evidence
  }
  const run = runPda(programId, buyer, entry.nonce)
  const datasets = entry.datasetIds.map((id, slot) =>
    datasetPda(programId, new PublicKey(entry.owners[slot] ?? ''), id),
  )

  const request = await transaction(connection, entry.requestSignature)
  if (request === null || request.meta === null) {
    evidence.gaps.push('order transaction not found on chain')
    return evidence
  }
  const keys = accountKeys(request)
  const has = (key: PublicKey) => keys.some((candidate) => candidate.equals(key))

  // Is this transaction this scenario's order? Program, run, pool and the
  // arguments that carry the buyer's intent.
  const programIndex = keys.findIndex((key) => key.equals(programId))
  const instruction = request.transaction.message.compiledInstructions.find(
    (candidate) => candidate.programIdIndex === programIndex,
  )
  const args = instruction === undefined ? null : requestRunArgs(instruction.data)
  if (args === null) evidence.gaps.push('the transaction is not a request_run of this program')
  else {
    if (args.nonce !== entry.nonce) evidence.gaps.push(`nonce ${args.nonce} ≠ ${entry.nonce}`)
    if (args.useType !== USE_TYPE_BITS[scenario.useType]) {
      evidence.gaps.push(`ordered use ${args.useType}, scenario asks ${scenario.useType}`)
    }
    if (args.buyerCategory !== BUYER_CATEGORY_BITS[scenario.buyerCategory]) {
      evidence.gaps.push(
        `ordered category ${args.buyerCategory}, scenario asks ${scenario.buyerCategory}`,
      )
    }
  }
  if (!has(run)) evidence.gaps.push('the transaction does not touch the derived run address')
  for (const dataset of datasets) {
    if (!has(dataset))
      evidence.gaps.push(`the transaction does not carry dataset ${dataset.toBase58()}`)
  }

  evidence.verdict = request.meta.err === null ? 'allowed' : 'refused'
  evidence.errorName = errorNameFromLogs(request.meta.logMessages ?? [])
  evidence.blockTime = request.blockTime ?? null
  if (evidence.blockTime === null) evidence.gaps.push('the order has no block time')
  evidence.buyerTokenDelta = tokenDelta(request, buyer.toBase58())

  const runAccount = await connection.getAccountInfo(run, 'confirmed')
  evidence.runExists =
    runAccount?.owner.equals(programId) === true &&
    startsWith(runAccount.data, RUN_ACCOUNT_DISCRIMINATOR)

  const open = await transaction(connection, entry.openSignature)
  if (open === null || open.meta === null) evidence.gaps.push('open_run transaction not found')
  else {
    if (!accountKeys(open).some((key) => key.equals(run))) {
      evidence.gaps.push('open_run does not touch the derived run address')
    }
    evidence.opened = open.meta.err === null
  }

  for (const dataset of datasets) {
    const account = await connection.getAccountInfo(dataset, 'confirmed')
    if (account === null || !account.owner.equals(programId)) {
      evidence.gaps.push(`dataset ${dataset.toBase58()} is not on chain`)
      evidence.currentDeadlines.push(null)
      continue
    }
    const current = datasetConsentVersion(account.data)
    let currentDeadline: bigint | null = null
    for (let version = 1; version <= current; version += 1) {
      const consent = await connection.getAccountInfo(
        consentPda(programId, dataset, version),
        'confirmed',
      )
      if (consent === null) {
        evidence.gaps.push(`consent v${version} of ${dataset.toBase58()} is missing`)
        continue
      }
      const terms = consentTerms(consent.data)
      if (terms.expiresAt !== null) evidence.deadlines.push(terms.expiresAt)
      if (version === current) currentDeadline = terms.expiresAt
    }
    evidence.currentDeadlines.push(currentDeadline)
  }

  return evidence
}

export async function auditConsentMatrix(
  connection: Connection,
  fixture: FixtureScenario[],
  report: MatrixReportInput,
): Promise<MatrixAudit> {
  const programId = new PublicKey(report.programId)
  const buyer = new PublicKey(report.buyer)
  const byId = new Map(report.scenarios.map((entry) => [entry.id, entry]))

  const judgements: ScenarioJudgement[] = []
  for (const scenario of fixture) {
    const entry = byId.get(scenario.id)
    const evidence: ChainEvidence =
      entry === undefined
        ? {
            gaps: ['scenario missing from the report'],
            verdict: null,
            errorName: null,
            runExists: false,
            opened: false,
            buyerTokenDelta: null,
            blockTime: null,
            deadlines: [],
            currentDeadlines: [],
          }
        : await collectEvidence(connection, programId, buyer, scenario, entry)
    judgements.push(
      judge(
        scenario,
        evidence,
        { orderStatus: entry?.apiOrderStatus ?? 0, reasons: entry?.apiReasons ?? [] },
        scenario.orderAfterDeadline,
      ),
    )
  }
  return summarize(judgements, fixture.length)
}
