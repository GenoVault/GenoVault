/**
 * Revocation latency on a live validator (`T042`, `SC-005`).
 *
 * `SC-005`: a revocation takes effect on the next ordered run within 60 s of
 * being confirmed. `FR-007` says more: it takes effect on **every** run ordered
 * after it. Both are measured here the same way — by ordering, all the time,
 * and letting the owner revoke in the middle.
 *
 * One trial is one dataset with a consent in force and a stream of orders
 * against it, one every `probeIntervalMs`. Each order is taken the way a buyer
 * takes it, on two layers, exactly as in `T041`:
 *
 * - **the API** — `POST /runs` on the real server process. The confirmed slot
 *   is read right before and right after the request, so the verifier can put
 *   the API's answer between two points of the chain's clock without the API
 *   reporting anything about itself;
 * - **the chain** — `request_run` submitted in any case: the API's unsigned
 *   instruction when it builds one, a raw one from `packages/sdk` when it
 *   refuses. A stream that stopped at the API's first refusal would say
 *   nothing about the gate that decides.
 *
 * `beforeSeconds` into the stream the owner revokes (with the SDK — the API
 * has no consent routes yet, and the measurement starts at the confirmation,
 * which the builder does not touch). Orders keep going the whole time the
 * revocation is in flight, and until the chain's clock is `afterSeconds` past
 * the revocation's block: "within 60 s" is then observed, not assumed.
 *
 * Two witnesses on the same stand:
 * - a dataset nobody revokes, ordered once a `witnessIntervalMs` across the
 *   whole run. Its orders keep passing while the trials are refused — that
 *   is what tells a closed gate from a stand that stopped accepting anything;
 * - after the stream, the dispatcher opens the last run each trial had
 *   accepted **before** the revocation: `FR-007` leaves runs ordered before
 *   it alone, and this is the live half of `T036`.
 *
 * Trials run side by side, `staggerSeconds` apart, so ten of them fit in about
 * two minutes. Every dataset is its own; the buyer and the dispatcher are
 * shared, and every order has its own nonce.
 *
 * This file only drives and records. The verdict is `tools/audit-verify sc005`,
 * which reads the chain itself and orders events by slot **and position in the
 * block**, not by anything written here.
 */

import { utils } from '@anchor-lang/core'
import type { GenoVaultProgram } from '@genovault/sdk'
import { requestRunIx, revokeConsentIx, runAddress } from '@genovault/sdk'
import {
  buyerCategoryBit,
  buyerCategorySchema,
  encodeFrequenciesParams,
  FREQUENCIES_RECIPE_ID,
  frequenciesParamsSchema,
  useTypeBit,
  useTypeSchema,
} from '@genovault/shared'
import { x25519 } from '@noble/curves/ed25519'
import type { Connection, TransactionInstruction } from '@solana/web3.js'
import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { z } from 'zod'
import type { ApiStand } from './api-stand.ts'
import { bootstrapPlatform, fundBuyer } from './bootstrap.ts'
import type { SeededDataset } from './consent-matrix.ts'
import {
  airdrop,
  codeOf,
  fromWire,
  reasonsOf,
  seedDataset,
  send,
  sendOrThrow,
  toHex,
  waitForFinalizedSlot,
} from './consent-matrix.ts'
import { openRunIx } from './instructions.ts'

// ── The plan ─────────────────────────────────────────────────────────────────

/**
 * The measurement's parameters, checked before anything is sent.
 *
 * The rules are the ones the verdict leans on: a stream that stops before the
 * budget runs out could not show a revocation that took 61 s, and a stream
 * with no orders before the revocation could not show the gate was open.
 */
export const revocationPlanSchema = z
  .strictObject({
    criterion: z.literal('SC-005'),
    note: z.string(),
    trials: z.number().int().positive(),
    budgetSeconds: z.number().positive(),
    beforeSeconds: z.number().positive(),
    afterSeconds: z.number().positive(),
    probeIntervalMs: z.number().int().positive(),
    witnessIntervalMs: z.number().int().positive(),
    staggerSeconds: z.number().nonnegative(),
    maxGapSeconds: z.number().positive(),
    consent: z.strictObject({
      allowed: z.array(useTypeSchema).min(1),
      forbidden: z.array(useTypeSchema),
      categories: z.array(buyerCategorySchema).min(1),
    }),
    order: z.strictObject({ useType: useTypeSchema, buyerCategory: buyerCategorySchema }),
  })
  .superRefine((plan, ctx) => {
    if (plan.afterSeconds <= plan.budgetSeconds) {
      ctx.addIssue({
        code: 'custom',
        message: `the stream must outlast the budget: ${plan.afterSeconds} s after, budget ${plan.budgetSeconds} s`,
      })
    }
    // Two orders per gap at least, or the gap rule measures the cadence.
    if (plan.probeIntervalMs * 2 > plan.maxGapSeconds * 1000) {
      ctx.addIssue({
        code: 'custom',
        message: `orders every ${plan.probeIntervalMs} ms cannot keep gaps under ${plan.maxGapSeconds} s`,
      })
    }
    if (plan.beforeSeconds * 1000 < plan.probeIntervalMs * 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'fewer than two orders fit before the revocation',
      })
    }
    // The order has to be one the consent allows, or the stream is refused
    // before any revocation and the trial measures nothing.
    const effective = plan.consent.allowed.filter((use) => !plan.consent.forbidden.includes(use))
    if (!effective.includes(plan.order.useType)) {
      ctx.addIssue({ code: 'custom', message: `the consent does not allow ${plan.order.useType}` })
    }
    if (!plan.consent.categories.includes(plan.order.buyerCategory)) {
      ctx.addIssue({
        code: 'custom',
        message: `the consent does not allow ${plan.order.buyerCategory}`,
      })
    }
  })

export type RevocationPlan = z.infer<typeof revocationPlanSchema>

// ── The report ───────────────────────────────────────────────────────────────

export interface ProbeReport {
  nonce: string
  /** `trial` — an order on a trial's dataset; `witness` — on the one nobody revokes. */
  kind: 'trial' | 'witness'
  trial: number | null
  api: {
    /** Confirmed slot read right before the request… */
    slotBefore: number
    /** …and right after the answer. */
    slotAfter: number
    status: number
    code: string | null
    reasons: string[]
  }
  chain: {
    path: 'api' | 'raw'
    /** `null` — the transaction was never signed. */
    signature: string | null
    /**
     * The driver saw it confirmed. `false` is not "it did not land": under
     * load the confirmation can time out while the transaction executes, and
     * the verifier looks every signature up regardless (`T042`: 46 of 1841).
     */
    landed: boolean
  }
}

export interface TrialReport {
  index: number
  datasetId: string
  owner: string
  revokeSignature: string
  /** The run accepted before the revocation that the dispatcher opened after it. */
  opened: { nonce: string; signature: string } | null
}

export interface RevocationReport {
  criterion: 'SC-005'
  programId: string
  buyer: string
  dispatcher: string
  mint: string
  startedAt: string
  witness: { datasetId: string; owner: string }
  trials: TrialReport[]
  probes: ProbeReport[]
}

// ── The run ──────────────────────────────────────────────────────────────────

export class RevocationLatencyError extends Error {
  override readonly name = 'RevocationLatencyError'
}

export interface RevocationLatencyOptions {
  connection: Connection
  program: GenoVaultProgram
  api: ApiStand
  plan: RevocationPlan
  authority: Keypair
  onProgress?(note: string): void
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * Sends without preflight and without waiting in the caller's loop.
 *
 * A refused order has to land for the verifier to judge it, and the stream
 * cannot pause for each confirmation: that pause is exactly the time a
 * revocation needs to slip through unobserved.
 */
async function sendDetached(
  connection: Connection,
  payer: Keypair,
  instruction: TransactionInstruction,
): Promise<{ signature: string | null; landed: boolean }> {
  let signature: string | null = null
  try {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    const transaction = new VersionedTransaction(
      new TransactionMessage({
        payerKey: payer.publicKey,
        recentBlockhash: blockhash,
        instructions: [instruction],
      }).compileToV0Message(),
    )
    transaction.sign([payer])
    const first = transaction.signatures[0]
    signature = first === undefined ? null : utils.bytes.bs58.encode(first)
    await connection.sendTransaction(transaction, { skipPreflight: true, maxRetries: 5 })
    await connection.confirmTransaction(
      { signature: signature ?? '', blockhash, lastValidBlockHeight },
      'confirmed',
    )
    return { signature, landed: true }
  } catch {
    return { signature, landed: false }
  }
}

export async function runRevocationLatency(
  options: RevocationLatencyOptions,
): Promise<RevocationReport> {
  const { connection, program, api, plan } = options
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
  await airdrop(connection, buyer.publicKey, 50)
  await airdrop(connection, dispatcher.publicKey, 10)
  await fundBuyer(connection, options.authority, platform.mint, buyer.publicKey, 10n ** 15n)
  const buyerSession = await api.session('buyer')
  const buyerX25519 = x25519.getPublicKey(x25519.utils.randomSecretKey())
  const recipeParams = encodeFrequenciesParams(frequenciesParamsSchema.parse({}))
  const stand = { connection, program, api }

  // Datasets first, all of them: the trials then start from a consent that
  // has been in force for a while, which is the ordinary case.
  const consentStep = {
    consent: {
      allowed: plan.consent.allowed,
      forbidden: plan.consent.forbidden,
      categories: plan.consent.categories,
    },
  }
  const witness = await seedDataset(stand, { dataset: 'sc005-witness', history: [consentStep] }, 0)
  const trialDatasets: SeededDataset[] = []
  for (let index = 0; index < plan.trials; index += 1) {
    trialDatasets.push(
      await seedDataset(
        stand,
        { dataset: `sc005-trial-${index}`, history: [consentStep] },
        index + 1,
      ),
    )
  }
  progress(`seeded ${plan.trials} trial datasets and the witness`)

  let nextNonce = 1n
  const probes: ProbeReport[] = []
  const inFlight: Promise<void>[] = []

  const order = async (
    dataset: SeededDataset,
    kind: ProbeReport['kind'],
    trial: number | null,
  ): Promise<ProbeReport> => {
    const nonce = nextNonce
    nextNonce += 1n
    const refs = [{ owner: dataset.owner.publicKey.toBase58(), datasetId: dataset.datasetId }]

    const slotBefore = await connection.getSlot('confirmed')
    const response = await api.request('POST', '/runs', buyerSession, {
      recipeId: FREQUENCIES_RECIPE_ID,
      useType: plan.order.useType,
      buyerCategory: plan.order.buyerCategory,
      datasets: refs,
      params: {},
      buyer: buyer.publicKey.toBase58(),
      nonce: nonce.toString(),
      maxEscrow: (10n ** 14n).toString(),
      buyerX25519: toHex(buyerX25519),
      dispatcher: dispatcher.publicKey.toBase58(),
    })
    const slotAfter = await connection.getSlot('confirmed')

    const accepted = response.status >= 200 && response.status < 300
    const instruction = accepted
      ? fromWire((response.body as { instruction?: unknown }).instruction)
      : await requestRunIx(program, {
          buyer: buyer.publicKey,
          mint: platform.mint,
          nonce,
          recipeId: FREQUENCIES_RECIPE_ID,
          useType: useTypeBit(plan.order.useType),
          buyerCategory: buyerCategoryBit(plan.order.buyerCategory),
          maxEscrow: 10n ** 14n,
          buyerX25519,
          dispatcher: dispatcher.publicKey,
          recipeParams,
          // Revocation does not add a version: the order names version 1, the
          // one in force, and the chain finds it revoked.
          datasets: [
            { owner: dataset.owner.publicKey, datasetId: dataset.datasetId, consentVersion: 1 },
          ],
        })

    const report: ProbeReport = {
      nonce: nonce.toString(),
      kind,
      trial,
      api: {
        slotBefore,
        slotAfter,
        status: response.status,
        code: accepted ? null : codeOf(response.body),
        reasons: reasonsOf(response.body),
      },
      chain: { path: accepted ? 'api' : 'raw', signature: null, landed: false },
    }
    probes.push(report)
    inFlight.push(
      sendDetached(connection, buyer, instruction).then((result) => {
        report.chain.signature = result.signature
        report.chain.landed = result.landed
      }),
    )
    return report
  }

  const revokedAt: (number | null)[] = trialDatasets.map(() => null)
  const trialReports: TrialReport[] = []

  const runTrial = async (index: number): Promise<void> => {
    const dataset = trialDatasets[index]
    if (dataset === undefined) throw new RevocationLatencyError(`no dataset for trial ${index}`)
    await sleep(index * plan.staggerSeconds * 1000)

    const tick = async (): Promise<void> => {
      const started = Date.now()
      await order(dataset, 'trial', index)
      await sleep(plan.probeIntervalMs - (Date.now() - started))
    }

    // Before: the gate is open, and the stream shows it.
    const revokeAt = Date.now() + plan.beforeSeconds * 1000
    while (Date.now() < revokeAt) await tick()

    // The revocation goes out while the stream keeps running.
    let settled = false
    const revoking = sendOrThrow(
      connection,
      dataset.owner,
      [
        await revokeConsentIx(program, {
          owner: dataset.owner.publicKey,
          datasetId: dataset.datasetId,
          currentVersion: 1,
        }),
      ],
      `revocation on ${dataset.datasetId}`,
    ).finally(() => {
      settled = true
    })
    // Handled here so a failed revocation does not crash the process as an
    // unhandled rejection while the stream is still ticking; awaited below.
    revoking.catch(() => {})
    while (!settled) await tick()
    const revokeSignature = await revoking

    // After: until the chain's clock — not ours — is past the budget. The
    // revocation's own block time is the origin.
    const revocation = await connection.getTransaction(revokeSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    const origin = revocation?.blockTime
    if (origin === null || origin === undefined) {
      throw new RevocationLatencyError(`revocation ${revokeSignature} has no block time`)
    }
    revokedAt[index] = origin
    progress(`trial ${index}: revoked in slot ${revocation?.slot}`)

    const until = origin + plan.afterSeconds
    let lastSeen = origin
    while (lastSeen <= until) {
      await tick()
      const slot = await connection.getSlot('confirmed')
      lastSeen = (await connection.getBlockTime(slot)) ?? lastSeen
    }

    trialReports.push({
      index,
      datasetId: dataset.datasetId,
      owner: dataset.owner.publicKey.toBase58(),
      revokeSignature,
      opened: null,
    })
    progress(`trial ${index}: stream done`)
  }

  let trialsDone = false
  const witnessStream = (async () => {
    while (!trialsDone) {
      const started = Date.now()
      await order(witness, 'witness', null)
      await sleep(plan.witnessIntervalMs - (Date.now() - started))
    }
  })()

  try {
    await Promise.all(trialDatasets.map((_, index) => runTrial(index)))
  } finally {
    trialsDone = true
    await witnessStream
    await Promise.all(inFlight)
  }

  // The live half of T036: a run accepted before the revocation is still the
  // dispatcher's to open after it. Chosen by where it landed, not by when we
  // sent it — the chain decides which side of the revocation it is on.
  for (const trial of trialReports) {
    const revocation = await connection.getTransaction(trial.revokeSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    const revokeSlot = revocation?.slot ?? 0
    const candidates = probes.filter(
      (probe) => probe.trial === trial.index && probe.chain.landed && probe.chain.signature,
    )
    const statuses = await connection.getSignatureStatuses(
      candidates.map((probe) => probe.chain.signature ?? ''),
      { searchTransactionHistory: true },
    )
    let chosen: ProbeReport | null = null
    for (const [at, probe] of candidates.entries()) {
      const status = statuses.value[at]
      if (status === null || status === undefined || status.err !== null) continue
      if (status.slot < revokeSlot) chosen = probe
    }
    if (chosen === null) continue
    const run = runAddress(buyer.publicKey, BigInt(chosen.nonce), program.programId).address
    const opened = await send(connection, dispatcher, [
      await openRunIx({ program, dispatcher: dispatcher.publicKey, run }),
    ])
    trial.opened = { nonce: chosen.nonce, signature: opened.signature }
    progress(`trial ${trial.index}: run ${chosen.nonce} opened ${opened.failed ? 'FAILED' : 'ok'}`)
  }

  trialReports.sort((a, b) => a.index - b.index)
  return {
    criterion: 'SC-005',
    programId: program.programId.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    dispatcher: dispatcher.publicKey.toBase58(),
    mint: platform.mint.toBase58(),
    startedAt,
    witness: { datasetId: witness.datasetId, owner: witness.owner.publicKey.toBase58() },
    trials: trialReports,
    probes: probes.sort((a, b) => Number(BigInt(a.nonce) - BigInt(b.nonce))),
  }
}
