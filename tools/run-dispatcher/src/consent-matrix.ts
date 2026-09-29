/**
 * The consent matrix on a live validator (`T041`, `SC-004`).
 *
 * Twenty scenarios from `fixtures/consent-matrix.json`, each taken the whole
 * way a buyer takes it, and each measured on two layers:
 *
 * - **the API** — the quote and the order, from the real server process
 *   (`api-stand.ts`). This is where a buyer normally learns the answer;
 * - **the chain** — `request_run` submitted in any case. When the API builds
 *   the order, its unsigned instruction is signed and sent as is. When it
 *   refuses, the order goes in raw, built from `packages/sdk`, exactly as a
 *   buyer who goes around the API would build it. A refused scenario that only
 *   ever met the API would say nothing about the gate that decides (`FR-006`).
 *
 * After every order the dispatcher tries `open_run`: that is the first step of
 * the computation layer, and for a refused run it must have nothing to open.
 *
 * The owners' side goes through the API as well — `POST /datasets`, the
 * ciphertext upload, the signed registration — because a dataset the API does
 * not know is refused by the quote as `unregistered`, and that refusal would
 * have nothing to do with consent. Consents are written with the SDK, signed by
 * the owner, which is how the product writes them.
 *
 * This file only drives and records. The verdict belongs to
 * `tools/audit-verify` (`sc004`), which reads the chain itself and trusts this
 * report for nothing but where to look.
 */

import { sealDataset } from '@genovault/crypto'
import type { GenoVaultProgram } from '@genovault/sdk'
import {
  datasetAddress,
  fetchDataset,
  requestRunIx,
  revokeConsentIx,
  runAddress,
  setConsentIx,
} from '@genovault/sdk'
import type { BuyerCategoryName, UseTypeName } from '@genovault/shared'
import {
  BUYER_CATEGORIES,
  buyerCategoryBit,
  buyerCategorySchema,
  CONSENT_VIOLATIONS,
  encodeFrequenciesParams,
  FREQUENCIES_RECIPE_ID,
  frequenciesParamsSchema,
  USE_TYPES,
  useTypeBit,
  useTypeSchema,
} from '@genovault/shared'
import { x25519 } from '@noble/curves/ed25519'
import type { Connection, TransactionInstruction } from '@solana/web3.js'
import {
  TransactionInstruction as Instruction,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js'
import { z } from 'zod'
import type { ApiResponse, ApiStand } from './api-stand.ts'
import { bootstrapPlatform, fundBuyer } from './bootstrap.ts'
import { openRunIx } from './instructions.ts'
import { syntheticRecords } from './scenario.ts'

// ── The fixture ──────────────────────────────────────────────────────────────

/** `SC-004` names the set: twenty scenarios, ten on each side. */
export const MATRIX_SIZE = 20
export const PER_LABEL = 10

/**
 * Below `MIN_COHORT`: such a dataset registers without statistics, which keeps
 * the stand free of numbers nobody here measures. Consent does not care about
 * size, and the run is never folded.
 */
const RECORDS_PER_DATASET = 9
const PRICE_PER_1K = 1_000n

const consentSpecSchema = z.strictObject({
  allowed: z.array(useTypeSchema).min(1),
  forbidden: z.array(useTypeSchema),
  categories: z.array(buyerCategorySchema).min(1),
  expiresInSeconds: z.number().int().positive().optional(),
})

const stepSchema = z.union([
  z.strictObject({ consent: consentSpecSchema }),
  z.strictObject({ revoke: z.literal(true) }),
])

const poolEntrySchema = z.strictObject({
  /** Dataset id in the seeds: at most 32 bytes. */
  dataset: z.string().regex(/^[a-z0-9-]{1,32}$/),
  history: z.array(stepSchema),
})

const scenarioSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.enum(['allowed', 'refused']),
  reason: z.enum(CONSENT_VIOLATIONS).nullable(),
  intent: z.string().min(10),
  pool: z.array(poolEntrySchema).min(1),
  order: z.strictObject({
    useType: useTypeSchema,
    buyerCategory: buyerCategorySchema,
    orderAfterDeadline: z.boolean().prefault(false),
  }),
})

export type ConsentSpec = z.infer<typeof consentSpecSchema>
export type MatrixStep = z.infer<typeof stepSchema>
export type MatrixScenario = z.infer<typeof scenarioSchema>

/**
 * The structure `SC-004` depends on, checked before anything is sent.
 *
 * A matrix with eleven refusals or a label without its reason would still run
 * and still print a verdict; the verdict would just be about another set.
 */
export const consentMatrixSchema = z
  .strictObject({
    criterion: z.literal('SC-004'),
    note: z.string(),
    scenarios: z.array(scenarioSchema),
  })
  .superRefine((matrix, ctx) => {
    const { scenarios } = matrix
    if (scenarios.length !== MATRIX_SIZE) {
      ctx.addIssue({
        code: 'custom',
        message: `SC-004 names ${MATRIX_SIZE} scenarios, the fixture has ${scenarios.length}`,
      })
    }
    for (const label of ['allowed', 'refused'] as const) {
      const count = scenarios.filter((scenario) => scenario.label === label).length
      if (count !== PER_LABEL) {
        ctx.addIssue({
          code: 'custom',
          message: `SC-004 names ${PER_LABEL} ${label} scenarios, the fixture has ${count}`,
        })
      }
    }

    const ids = new Set<string>()
    const datasets = new Set<string>()
    for (const [index, scenario] of scenarios.entries()) {
      const at = (message: string) =>
        ctx.addIssue({ code: 'custom', path: ['scenarios', index], message })

      if (ids.has(scenario.id)) at(`scenario id ${scenario.id} appears twice`)
      ids.add(scenario.id)

      // A refusal without its reason cannot be checked against FR-008, and an
      // allowed scenario with a reason is a label that contradicts itself.
      if (scenario.label === 'refused' && scenario.reason === null) {
        at(`${scenario.id}: a refused scenario must name its reason`)
      }
      if (scenario.label === 'allowed' && scenario.reason !== null) {
        at(`${scenario.id}: an allowed scenario has no reason`)
      }

      let deadlines = 0
      for (const entry of scenario.pool) {
        // Shared datasets would let one scenario pass on another's consent.
        if (datasets.has(entry.dataset)) at(`dataset ${entry.dataset} is used twice`)
        datasets.add(entry.dataset)

        let consented = false
        for (const step of entry.history) {
          if ('revoke' in step) {
            if (!consented) at(`${entry.dataset}: revocation with no consent in force`)
            consented = false
          } else {
            consented = true
            if (step.consent.expiresInSeconds !== undefined) deadlines += 1
          }
        }
      }
      if (scenario.order.orderAfterDeadline && deadlines === 0) {
        at(`${scenario.id}: orders after a deadline, but no deadline is written`)
      }
    }
  })

export type ConsentMatrix = z.infer<typeof consentMatrixSchema>

function mask(names: readonly UseTypeName[]): number {
  return names.reduce((bits, name) => bits | USE_TYPES[name], 0)
}

function categories(names: readonly BuyerCategoryName[]): number {
  return names.reduce((bits, name) => bits | BUYER_CATEGORIES[name], 0)
}

// ── The report ───────────────────────────────────────────────────────────────

export interface MatrixDatasetEntry {
  datasetId: string
  owner: string
  address: string
  /** Consent version in force when the order was sent; 0 — none was ever given. */
  consentVersion: number
  /** Every deadline written for this dataset, in Unix seconds, oldest first. */
  deadlines: number[]
}

export interface MatrixApiLayer {
  quoteStatus: number
  /** Per dataset: `null` when the quote counted it, otherwise its reason. */
  quoteReasons: (string | null)[]
  orderStatus: number
  orderCode: string | null
  /** Reasons the order route named, one per refused dataset. */
  orderReasons: string[]
}

export interface MatrixChainLayer {
  /** `api` — the API's unsigned instruction; `raw` — built around the API. */
  path: 'api' | 'raw'
  run: string
  requestSignature: string
  openSignature: string
}

export interface MatrixScenarioReport {
  id: string
  nonce: string
  datasets: MatrixDatasetEntry[]
  api: MatrixApiLayer
  chain: MatrixChainLayer
}

export interface MatrixReport {
  criterion: 'SC-004'
  programId: string
  buyer: string
  dispatcher: string
  mint: string
  startedAt: string
  scenarios: MatrixScenarioReport[]
}

// ── The run ──────────────────────────────────────────────────────────────────

export class ConsentMatrixError extends Error {
  override readonly name = 'ConsentMatrixError'
}

export interface ConsentMatrixOptions {
  connection: Connection
  program: GenoVaultProgram
  api: ApiStand
  matrix: ConsentMatrix
  /** Platform authority on a fresh ledger; airdropped here. */
  authority: Keypair
  onProgress?(note: string): void
}

/** What `seedDataset` needs of the stand: the chain, the program and the API. */
export type MatrixStand = Pick<ConsentMatrixOptions, 'connection' | 'program' | 'api'>

export interface SendResult {
  signature: string
  failed: boolean
}

/**
 * Sends and waits for the slot to confirm, **without preflight**.
 *
 * A refused order must land: a transaction stopped by simulation never reaches
 * the ledger, and the verifier, which reads only the ledger, would find
 * nothing to judge. Failed transactions land with their error and their logs.
 */
export async function send(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  signers: Keypair[] = [],
): Promise<SendResult> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message()
  const transaction = new VersionedTransaction(message)
  transaction.sign([payer, ...signers])

  const signature = await connection.sendTransaction(transaction, {
    skipPreflight: true,
    maxRetries: 3,
  })
  const status = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  )
  return { signature, failed: status.value.err !== null }
}

export async function sendOrThrow(
  connection: Connection,
  payer: Keypair,
  instructions: TransactionInstruction[],
  what: string,
): Promise<string> {
  const result = await send(connection, payer, instructions)
  if (result.failed) throw new ConsentMatrixError(`${what}: ${result.signature} failed`)
  return result.signature
}

export async function airdrop(connection: Connection, to: PublicKey, sol: number): Promise<void> {
  const signature = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL)
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
}

/** The chain's clock, not ours: deadlines are judged by it (`FR-005`). */
export async function chainNow(connection: Connection): Promise<number> {
  const slot = await connection.getSlot('confirmed')
  const time = await connection.getBlockTime(slot)
  if (time === null) throw new ConsentMatrixError(`slot ${slot} has no block time`)
  return time
}

export function expect2xx(response: ApiResponse, what: string): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300 || typeof response.body !== 'object') {
    throw new ConsentMatrixError(
      `${what}: HTTP ${response.status} ${JSON.stringify(response.body)}`,
    )
  }
  return response.body as Record<string, unknown>
}

const wireInstructionSchema = z.strictObject({
  programId: z.string(),
  accounts: z.array(
    z.strictObject({ pubkey: z.string(), isSigner: z.boolean(), isWritable: z.boolean() }),
  ),
  data: z.string(),
})

export function fromWire(raw: unknown): TransactionInstruction {
  const wire = wireInstructionSchema.parse(raw)
  return new Instruction({
    programId: new PublicKey(wire.programId),
    keys: wire.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(wire.data, 'base64'),
  })
}

export function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex')
}

export interface SeededDataset {
  owner: Keypair
  datasetId: string
  address: PublicKey
  consentVersion: number
  deadlines: number[]
}

export async function seedDataset(
  options: MatrixStand,
  entry: MatrixScenario['pool'][number],
  ordinal: number,
): Promise<SeededDataset> {
  const { connection, program, api } = options
  const owner = Keypair.generate()
  await airdrop(connection, owner.publicKey, 2)
  const session = await api.session(`owner${ordinal}`)

  // The stand has no MXE; any valid x25519 key gives an envelope of the right
  // shape and hash, which is all the upload route checks. Nobody decrypts it.
  const sealed = await sealDataset(
    syntheticRecords(RECORDS_PER_DATASET, ordinal + 1),
    x25519.getPublicKey(x25519.utils.randomSecretKey()),
  )

  const registered = expect2xx(
    await api.request('POST', '/datasets', session, {
      datasetId: entry.dataset,
      owner: owner.publicKey.toBase58(),
      contentHash: sealed.contentHash,
      pricePer1k: PRICE_PER_1K.toString(),
      metadata: {
        title: `Consent matrix ${entry.dataset}`,
        description: 'Synthetic records for the SC-004 consent matrix.',
        schema: [{ field: 'age', type: 'integer', description: 'Age in full years' }],
        recordCount: RECORDS_PER_DATASET,
        markerCount: sealed.markerCount,
        provenance: {
          source: 'synthetic',
          collectedFrom: '2024-01-01',
          collectedTo: '2024-06-30',
        },
      },
    }),
    `register ${entry.dataset}`,
  )
  // Upload before signing, as the route asks: a registration signed first
  // would put a hash on the chain that points at no bytes.
  expect2xx(
    await api.request('PUT', `/datasets/${entry.dataset}/ciphertext`, session, sealed.bytes),
    `upload ${entry.dataset}`,
  )
  const registration = registered.registration as { instruction: unknown } | undefined
  await sendOrThrow(
    connection,
    owner,
    [fromWire(registration?.instruction)],
    `registration of ${entry.dataset}`,
  )

  let version = 0
  const deadlines: number[] = []
  for (const step of entry.history) {
    if ('revoke' in step) {
      await sendOrThrow(
        connection,
        owner,
        [
          await revokeConsentIx(program, {
            owner: owner.publicKey,
            datasetId: entry.dataset,
            currentVersion: version,
          }),
        ],
        `revocation on ${entry.dataset}`,
      )
      continue
    }
    const { consent } = step
    const expiresAt =
      consent.expiresInSeconds === undefined
        ? null
        : (await chainNow(connection)) + consent.expiresInSeconds
    if (expiresAt !== null) deadlines.push(expiresAt)
    await sendOrThrow(
      connection,
      owner,
      [
        await setConsentIx(program, {
          owner: owner.publicKey,
          datasetId: entry.dataset,
          currentVersion: version,
          allowedUses: mask(consent.allowed),
          forbiddenUses: mask(consent.forbidden),
          buyerCategories: categories(consent.categories),
          expiresAt,
        }),
      ],
      `consent v${version + 1} on ${entry.dataset}`,
    )
    version += 1
  }

  return {
    owner,
    datasetId: entry.dataset,
    address: datasetAddress(owner.publicKey, entry.dataset, program.programId).address,
    consentVersion: version,
    deadlines,
  }
}

export function reasonsOf(body: unknown): string[] {
  const details = (body as { error?: { details?: { ineligible?: unknown } } } | null)?.error
    ?.details
  if (!Array.isArray(details?.ineligible)) return []
  return details.ineligible.flatMap((entry: unknown) => {
    const reason = (entry as { reason?: unknown }).reason
    return typeof reason === 'string' ? [reason] : []
  })
}

export function codeOf(body: unknown): string | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code
  return typeof code === 'string' ? code : null
}

/**
 * A validator that has just answered /health still drops the first
 * transactions while its fees settle; wait until it has finalized a slot.
 */
export async function waitForFinalizedSlot(connection: Connection): Promise<void> {
  const warmUp = Date.now() + 120_000
  while ((await connection.getSlot('finalized')) < 1) {
    if (Date.now() > warmUp) throw new ConsentMatrixError('the validator never finalized a slot')
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
}

export async function runConsentMatrix(options: ConsentMatrixOptions): Promise<MatrixReport> {
  const { connection, program, api, matrix } = options
  const progress = options.onProgress ?? (() => {})
  const startedAt = new Date().toISOString()

  await waitForFinalizedSlot(connection)

  await airdrop(connection, options.authority.publicKey, 100)
  const platform = await bootstrapPlatform({
    connection,
    program,
    authority: options.authority,
    mint: Keypair.generate(),
    feeBps: 250,
  })

  const buyer = Keypair.generate()
  const dispatcher = Keypair.generate()
  await airdrop(connection, buyer.publicKey, 10)
  await airdrop(connection, dispatcher.publicKey, 10)
  await fundBuyer(connection, options.authority, platform.mint, buyer.publicKey, 10n ** 15n)
  const buyerSession = await api.session('buyer')
  const buyerX25519 = x25519.getPublicKey(x25519.utils.randomSecretKey())
  const params = frequenciesParamsSchema.parse({})
  progress(`platform ${platform.config.toBase58()}, buyer ${buyer.publicKey.toBase58()}`)

  // Each scenario is ordered the moment its last consent write is confirmed —
  // the freshest state there is, and so the worst case for a reader that lags
  // the chain. Seeding everything first and ordering a minute later measured
  // the API only after its lag had run out (`T041`: 13 s at `finalized`).
  //
  // The two exceptions have to wait anyway: scenarios that order after a
  // deadline are seeded first, so their deadlines run out while the rest of
  // the matrix is ordered, and ordered last. Datasets are never shared, so
  // the order of the file decides nothing else.
  const late = matrix.scenarios.filter((scenario) => scenario.order.orderAfterDeadline)
  const early = matrix.scenarios.filter((scenario) => !scenario.order.orderAfterDeadline)

  const seeded = new Map<string, SeededDataset[]>()
  let ordinal = 0
  const seed = async (scenario: MatrixScenario): Promise<SeededDataset[]> => {
    const pool: SeededDataset[] = []
    for (const entry of scenario.pool) {
      pool.push(await seedDataset(options, entry, ordinal))
      ordinal += 1
    }
    seeded.set(scenario.id, pool)
    progress(`seeded ${scenario.id}`)
    return pool
  }
  for (const scenario of late) await seed(scenario)

  const reports: MatrixScenarioReport[] = []
  for (const scenario of [...early, ...late]) {
    const pool = seeded.get(scenario.id) ?? (await seed(scenario))
    const nonce = BigInt(matrix.scenarios.indexOf(scenario) + 1)

    if (scenario.order.orderAfterDeadline) {
      const last = Math.max(...pool.flatMap((dataset) => dataset.deadlines))
      while ((await chainNow(connection)) <= last) {
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    }

    const refs = pool.map((dataset) => ({
      owner: dataset.owner.publicKey.toBase58(),
      datasetId: dataset.datasetId,
    }))
    const request = {
      recipeId: FREQUENCIES_RECIPE_ID,
      useType: scenario.order.useType,
      buyerCategory: scenario.order.buyerCategory,
      datasets: refs,
      params: {},
    }

    const quote = await api.request('POST', '/runs/quote', buyerSession, request)
    const quoteLines = (quote.body as { datasets?: unknown } | null)?.datasets
    const quoteReasons = Array.isArray(quoteLines)
      ? quoteLines.map((line: unknown) => {
          const { eligible, reason } = line as { eligible?: unknown; reason?: unknown }
          return eligible === true ? null : typeof reason === 'string' ? reason : 'unknown'
        })
      : []

    const order = await api.request('POST', '/runs', buyerSession, {
      ...request,
      buyer: buyer.publicKey.toBase58(),
      nonce: nonce.toString(),
      maxEscrow: (10n ** 14n).toString(),
      buyerX25519: toHex(buyerX25519),
      dispatcher: dispatcher.publicKey.toBase58(),
    })

    let path: MatrixChainLayer['path']
    let instruction: TransactionInstruction
    if (order.status >= 200 && order.status < 300) {
      path = 'api'
      instruction = fromWire((order.body as { instruction?: unknown }).instruction)
    } else {
      path = 'raw'
      const entries = []
      for (const dataset of pool) {
        const account = await fetchDataset(program, dataset.address)
        entries.push({
          owner: dataset.owner.publicKey,
          datasetId: dataset.datasetId,
          // No consent at all: the address of the first version, which does not
          // exist — the account a buyer would have to pass.
          consentVersion: Math.max(account?.consentVersion ?? 0, 1),
        })
      }
      instruction = await requestRunIx(program, {
        buyer: buyer.publicKey,
        mint: platform.mint,
        nonce,
        recipeId: FREQUENCIES_RECIPE_ID,
        useType: useTypeBit(scenario.order.useType),
        buyerCategory: buyerCategoryBit(scenario.order.buyerCategory),
        maxEscrow: 10n ** 14n,
        buyerX25519,
        dispatcher: dispatcher.publicKey,
        recipeParams: encodeFrequenciesParams(params),
        datasets: entries,
      })
    }

    const requested = await send(connection, buyer, [instruction])
    const run = runAddress(buyer.publicKey, nonce, program.programId).address
    const opened = await send(connection, dispatcher, [
      await openRunIx({ program, dispatcher: dispatcher.publicKey, run }),
    ])

    const datasets: MatrixDatasetEntry[] = []
    for (const dataset of pool) {
      const account = await fetchDataset(program, dataset.address)
      datasets.push({
        datasetId: dataset.datasetId,
        owner: dataset.owner.publicKey.toBase58(),
        address: dataset.address.toBase58(),
        consentVersion: account?.consentVersion ?? 0,
        deadlines: dataset.deadlines,
      })
    }

    reports.push({
      id: scenario.id,
      nonce: nonce.toString(),
      datasets,
      api: {
        quoteStatus: quote.status,
        quoteReasons,
        orderStatus: order.status,
        orderCode: order.status >= 200 && order.status < 300 ? null : codeOf(order.body),
        orderReasons: reasonsOf(order.body),
      },
      chain: {
        path,
        run: run.toBase58(),
        requestSignature: requested.signature,
        openSignature: opened.signature,
      },
    })
    progress(
      `${scenario.id}: API ${order.status}, chain ${requested.failed ? 'refused' : 'accepted'} ` +
        `(${path}), open ${opened.failed ? 'refused' : 'ok'}`,
    )
  }

  // The report follows the fixture's order, not the order of sending.
  const byId = new Map(reports.map((entry) => [entry.id, entry]))
  return {
    criterion: 'SC-004',
    programId: program.programId.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    dispatcher: dispatcher.publicKey.toBase58(),
    mint: platform.mint.toBase58(),
    startedAt,
    scenarios: matrix.scenarios.flatMap((scenario) => {
      const entry = byId.get(scenario.id)
      return entry === undefined ? [] : [entry]
    }),
  }
}

/** The API's verdict on a scenario, as the buyer would read it. */
export function apiVerdict(layer: MatrixApiLayer): 'allowed' | 'refused' {
  return layer.orderStatus >= 200 && layer.orderStatus < 300 ? 'allowed' : 'refused'
}
