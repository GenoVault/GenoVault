import {
  BUYER_CATEGORIES,
  type ConsentTransaction,
  datasetIdSchema,
  setConsentRequestSchema,
  USE_TYPES,
} from '@genovault/shared'
import { Hono } from 'hono'
import { fail } from '../errors.ts'
import { type AuthVariables, requireAuth } from '../middleware/auth.ts'
import type { TokenVerifier } from '../services/auth.ts'
import type { CatalogStore } from '../services/catalog.ts'
import {
  ChainStateError,
  type ConsentChainReader,
  type ConsentIxBuilder,
} from '../services/chain.ts'
import { resolveOwnDataset } from './datasets.ts'

/**
 * The owner's consent from the interface (`T066a`, `FR-005`, `FR-007`, `FR-009`).
 *
 * `POST /datasets/:id/consent` sets a new version; `DELETE` revokes the current
 * one. Both answer with an **unsigned** instruction: the owner signs it in
 * their wallet, and the API holds no key that could sign it instead (hard rule
 * of the repository, `FR-022`). Until `T066a` consents were written by the SDK
 * only — the measurements of `T041`/`T042` did exactly that.
 *
 * The dataset is the session's own: the owner is the address the session is
 * bound to (`POST /datasets` binds it), and "not yours" answers exactly like
 * "does not exist", as on the ciphertext upload.
 *
 * Every refusal below mirrors one of the program's, read at `confirmed`
 * (`T041`), so the owner learns it before signing rather than from a program
 * error in the wallet. The program still decides; these checks only warn.
 */

export interface ConsentRoutesDeps {
  verify?: TokenVerifier | undefined
  catalog?: CatalogStore | undefined
  readConsentChain?: ConsentChainReader | undefined
  buildConsentIx?: ConsentIxBuilder | undefined
}

/** Why the API will not build the instruction — named, as `details.reason`. */
export type ConsentRefusal =
  | 'unregistered'
  | 'retired'
  | 'expiry-in-past'
  | 'no-consent'
  | 'already-revoked'

const maskOf = <T extends string>(names: readonly T[], bits: Record<T, number>): number =>
  names.reduce((mask, name) => mask | bits[name], 0)

export function consentRoutes(deps: ConsentRoutesDeps) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  const { catalog, readConsentChain, buildConsentIx } = deps

  routes.post('/datasets/:id/consent', requireAuth(deps.verify), async (c) => {
    if (catalog === undefined || readConsentChain === undefined || buildConsentIx === undefined) {
      return fail(c, 'INTERNAL', 'internal error')
    }

    const datasetId = datasetIdSchema.parse(c.req.param('id'))
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return fail(c, 'INVALID_INPUT', 'request body is not JSON')
    }
    const request = setConsentRequestSchema.parse(raw)

    const record = await resolveOwnDataset(catalog, c.get('actor').userId, datasetId)
    if (record === undefined) return fail(c, 'NOT_FOUND', 'dataset not found')

    let state: Awaited<ReturnType<ConsentChainReader>>
    try {
      state = await readConsentChain(record.owner, record.datasetId)
    } catch (error) {
      return chainFailure(c, error)
    }

    if (state === null) {
      return refuse(
        c,
        'unregistered',
        'the dataset is not registered on chain — sign its registration first',
      )
    }
    if (state.status !== 'active') {
      return refuse(c, 'retired', 'a retired dataset takes no new consent')
    }
    const expiresAt = request.expiresAt === null ? null : BigInt(request.expiresAt)
    if (expiresAt !== null && expiresAt <= state.now) {
      // Judged by the chain's clock, not ours: the program compares with
      // `Clock::get()`, and a server clock running a minute fast would refuse
      // an expiry the chain accepts (`T039`).
      return refuse(c, 'expiry-in-past', 'the expiry is not in the future by the chain clock', {
        now: state.now.toString(),
      })
    }

    const build = await buildConsentIx({
      action: 'set',
      owner: record.owner,
      datasetId: record.datasetId,
      currentVersion: state.consentVersion,
      allowedUses: maskOf(request.allowedUses, USE_TYPES),
      forbiddenUses: maskOf(request.forbiddenUses, USE_TYPES),
      buyerCategories: maskOf(request.buyerCategories, BUYER_CATEGORIES),
      expiresAt,
    })

    return c.json({
      action: 'set',
      datasetId: record.datasetId,
      owner: record.owner,
      ...build,
    } satisfies Record<keyof ConsentTransaction, unknown>)
  })

  routes.delete('/datasets/:id/consent', requireAuth(deps.verify), async (c) => {
    if (catalog === undefined || readConsentChain === undefined || buildConsentIx === undefined) {
      return fail(c, 'INTERNAL', 'internal error')
    }

    const datasetId = datasetIdSchema.parse(c.req.param('id'))
    const record = await resolveOwnDataset(catalog, c.get('actor').userId, datasetId)
    if (record === undefined) return fail(c, 'NOT_FOUND', 'dataset not found')

    let state: Awaited<ReturnType<ConsentChainReader>>
    try {
      state = await readConsentChain(record.owner, record.datasetId)
    } catch (error) {
      return chainFailure(c, error)
    }

    if (state === null) {
      return refuse(c, 'unregistered', 'the dataset is not registered on chain')
    }
    if (state.consentVersion === 0 || state.currentRevoked === null) {
      return refuse(c, 'no-consent', 'there is no consent to revoke')
    }
    if (state.currentRevoked) {
      // `ConsentAlreadyRevoked`: a second revocation would move the date and
      // rewrite when the gate closed.
      return refuse(c, 'already-revoked', 'the current consent is already revoked')
    }

    const build = await buildConsentIx({
      action: 'revoke',
      owner: record.owner,
      datasetId: record.datasetId,
      currentVersion: state.consentVersion,
    })

    return c.json({
      action: 'revoke',
      datasetId: record.datasetId,
      owner: record.owner,
      ...build,
    } satisfies Record<keyof ConsentTransaction, unknown>)
  })

  return routes
}

function refuse(
  c: Parameters<typeof fail>[0],
  reason: ConsentRefusal,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return fail(c, 'INVALID_INPUT', message, { reason, ...extra })
}

function chainFailure(c: Parameters<typeof fail>[0], error: unknown) {
  if (error instanceof ChainStateError) {
    return error.reason === 'unavailable'
      ? fail(c, 'UPSTREAM_UNAVAILABLE', 'the network is not answering right now — try again later')
      : fail(c, 'INTERNAL', 'internal error')
  }
  throw error
}
