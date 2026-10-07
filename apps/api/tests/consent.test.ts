import { Buffer } from 'node:buffer'
import { consentAddress, createProgram, datasetAddress } from '@genovault/sdk'
import {
  apiErrorSchema,
  BUYER_CATEGORIES,
  consentTransactionSchema,
  datasetIdSchema,
  PROGRAM_ADDRESS,
  solanaAddressSchema,
  USE_TYPES,
} from '@genovault/shared'
import { Connection, PublicKey } from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { AuthError, type TokenVerifier } from '../src/services/auth.ts'
import { type CatalogStore, datasetRecordSchema, memoryCatalog } from '../src/services/catalog.ts'
import {
  ChainStateError,
  type ConsentChainState,
  createConsentIxBuilder,
} from '../src/services/chain.ts'

/**
 * `POST` / `DELETE /datasets/:id/consent` (`T066a`).
 *
 * The chain state is faked — the routes' job is to refuse what the program
 * would refuse and to build the rest — but the instruction builder is the real
 * one: building with every account given makes no network call, and the bytes
 * it returns are decoded back here with the program's own coder.
 */

const OWNER = solanaAddressSchema.parse('11111111111111111111111111111112')
const OTHER_OWNER = solanaAddressSchema.parse('SysvarC1ock11111111111111111111111111111111')
const USER = 'did:privy:clx0000000000000000000000'
const OTHER_USER = 'did:privy:clx1111111111111111111111'
const DATASET_ID = datasetIdSchema.parse('cohort-alpha')
const NOW = 1_800_000_000n

const verify: TokenVerifier = async (token) => {
  if (token === 'other') {
    return { userId: OTHER_USER, sessionId: 'sid-2', expiresAt: new Date(Date.now() + 60_000) }
  }
  if (token !== 'good') throw new AuthError('wrong token')
  return { userId: USER, sessionId: 'sid-1', expiresAt: new Date(Date.now() + 60_000) }
}

const ACTIVE: ConsentChainState = {
  status: 'active',
  consentVersion: 2,
  currentRevoked: false,
  now: NOW,
}

const readConsentChain = vi.fn(async (): Promise<ConsentChainState | null> => ACTIVE)

const instructionCoder = createProgram({ connection: new Connection('http://127.0.0.1:8899') })
  .coder.instruction

/**
 * The program's own decoder. Anchor's `InstructionCoder` interface omits
 * `decode`, though its Borsh coder has it; read it off the object, checked.
 */
function decodeInstruction(data: string): { name: string; data: unknown } | null {
  const decode: unknown = Reflect.get(instructionCoder, 'decode')
  if (typeof decode !== 'function') throw new Error('the Anchor coder has no decode')
  const decoded: unknown = decode.call(instructionCoder, Buffer.from(data, 'base64'))
  if (decoded === null) return null
  if (typeof decoded !== 'object' || !('name' in decoded) || typeof decoded.name !== 'string') {
    throw new Error('the Anchor coder returned an unexpected shape')
  }
  return { name: decoded.name, data: 'data' in decoded ? decoded.data : undefined }
}

let catalog: CatalogStore
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  catalog = memoryCatalog()
  readConsentChain.mockReset()
  readConsentChain.mockImplementation(async () => ACTIVE)
  app = createApp({
    verifyAccessToken: verify,
    catalog,
    readConsentChain,
    buildConsentIx: createConsentIxBuilder('http://127.0.0.1:8899'),
  })

  await catalog.bindOwner(USER, OWNER)
  await catalog.bindOwner(OTHER_USER, OTHER_OWNER)
  await catalog.putDataset(
    datasetRecordSchema.parse({
      datasetId: DATASET_ID,
      owner: OWNER,
      registeredBy: USER,
      contentHash: 'a'.repeat(64),
      pricePer1k: '1500000',
      metadata: {
        title: 'Cohort alpha',
        description: 'Synthetic cohort for checks.',
        schema: [{ field: 'age', type: 'integer', description: 'Years' }],
        recordCount: 12,
        markerCount: 4,
        statistics: { affectedRate: 0.25, meanAge: 44, alleleFrequencies: [0.2, 0.3, 0.25, 0.4] },
        provenance: { source: 'synthetic', collectedFrom: '2024-01-01', collectedTo: '2024-06-30' },
      },
      status: 'stored',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
    }),
  )
})

const TERMS = {
  allowedUses: ['cardiology', 'populationGenetics'],
  forbiddenUses: ['pharmaCommercial'],
  buyerCategories: ['academic', 'nonProfit'],
  expiresAt: String(NOW + 86_400n),
}

function setConsent(body: unknown, token = 'good', id: string = DATASET_ID) {
  return app.request(`/datasets/${id}/consent`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function revoke(token = 'good', id: string = DATASET_ID) {
  return app.request(`/datasets/${id}/consent`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
}

async function refusal(response: Response) {
  return apiErrorSchema.parse(await response.json()).error
}

const datasetPda = datasetAddress(new PublicKey(OWNER), DATASET_ID).address

describe('POST /datasets/:id/consent', () => {
  it('requires a session', async () => {
    const response = await app.request(`/datasets/${DATASET_ID}/consent`, {
      method: 'POST',
      body: JSON.stringify(TERMS),
    })
    expect(response.status).toBe(401)
  })

  it('builds an unsigned set_consent for the next version, with the owner the only signer', async () => {
    const response = await setConsent(TERMS)
    expect(response.status).toBe(200)
    const tx = consentTransactionSchema.parse(await response.json())

    expect(tx).toMatchObject({ action: 'set', datasetId: DATASET_ID, owner: OWNER, version: 3 })
    expect(tx.instruction.programId).toBe(PROGRAM_ADDRESS)
    expect(tx.datasetAddress).toBe(datasetPda.toBase58())
    expect(tx.consentAddress).toBe(consentAddress(datasetPda, 3).address.toBase58())

    // The API signs nothing: the owner is the one and only signer.
    expect(tx.instruction.accounts.filter((account) => account.isSigner)).toEqual([
      { pubkey: OWNER, isSigner: true, isWritable: true },
    ])
    // The previous version is passed, so the chain of versions holds (`FR-005`).
    expect(tx.instruction.accounts.map((account) => account.pubkey)).toContain(
      consentAddress(datasetPda, 2).address.toBase58(),
    )
  })

  it('turns names into the very bits the program checks', async () => {
    const tx = consentTransactionSchema.parse(await (await setConsent(TERMS)).json())
    const decoded = decodeInstruction(tx.instruction.data)
    if (decoded === null) throw new Error('the instruction does not decode as GenoVault')
    expect(decoded.name).toBe('setConsent')

    const args = (decoded.data as { args: Record<string, unknown> }).args
    expect(args.allowedUses).toBe(USE_TYPES.cardiology | USE_TYPES.populationGenetics)
    expect(args.forbiddenUses).toBe(USE_TYPES.pharmaCommercial)
    expect(args.buyerCategories).toBe(BUYER_CATEGORIES.academic | BUYER_CATEGORIES.nonProfit)
    expect(String(args.expiresAt)).toBe(TERMS.expiresAt)
  })

  it('passes no previous consent for the first version', async () => {
    readConsentChain.mockResolvedValueOnce({ ...ACTIVE, consentVersion: 0, currentRevoked: null })
    const tx = consentTransactionSchema.parse(await (await setConsent(TERMS)).json())
    expect(tx.version).toBe(1)
    expect(tx.instruction.accounts.map((account) => account.pubkey)).not.toContain(
      consentAddress(datasetPda, 0).address.toBase58(),
    )
  })

  it('accepts a consent with no expiry', async () => {
    const response = await setConsent({ ...TERMS, expiresAt: null })
    expect(response.status).toBe(200)
  })

  it('refuses an expiry that is not in the future by the chain clock', async () => {
    // Exactly `now` is already too late: the program wants `expires_at > now`.
    const response = await setConsent({ ...TERMS, expiresAt: String(NOW) })
    expect(response.status).toBe(400)
    expect(await refusal(response)).toMatchObject({
      details: { reason: 'expiry-in-past', now: String(NOW) },
    })
    expect((await setConsent({ ...TERMS, expiresAt: String(NOW + 1n) })).status).toBe(200)
  })

  it('refuses a dataset that is not on chain yet', async () => {
    readConsentChain.mockResolvedValueOnce(null)
    const response = await setConsent(TERMS)
    expect(response.status).toBe(400)
    expect((await refusal(response)).details).toEqual({ reason: 'unregistered' })
  })

  it('refuses a retired dataset', async () => {
    readConsentChain.mockResolvedValueOnce({ ...ACTIVE, status: 'retired' })
    expect((await refusal(await setConsent(TERMS))).details).toEqual({ reason: 'retired' })
  })

  it('refuses names outside the dictionary as invalid input, before reading the chain', async () => {
    const response = await setConsent({ ...TERMS, allowedUses: ['marketing'] })
    expect(response.status).toBe(400)
    expect(readConsentChain).not.toHaveBeenCalled()
  })

  it('refuses broken JSON as 400, not 500', async () => {
    expect((await setConsent('{')).status).toBe(400)
  })

  it('answers "not found" for another owner’s dataset, exactly as for a missing one', async () => {
    const foreign = await setConsent(TERMS, 'other')
    const missing = await setConsent(TERMS, 'good', 'cohort-none')
    expect(foreign.status).toBe(404)
    expect(await foreign.json()).toEqual(await missing.json())
    expect(readConsentChain).not.toHaveBeenCalled()
  })

  it('answers 503 when the chain does not answer', async () => {
    readConsentChain.mockRejectedValueOnce(new ChainStateError('unavailable', 'down'))
    expect((await setConsent(TERMS)).status).toBe(503)
  })
})

describe('DELETE /datasets/:id/consent', () => {
  it('requires a session', async () => {
    const response = await app.request(`/datasets/${DATASET_ID}/consent`, { method: 'DELETE' })
    expect(response.status).toBe(401)
  })

  it('builds an unsigned revoke_consent for the current version', async () => {
    const response = await revoke()
    expect(response.status).toBe(200)
    const tx = consentTransactionSchema.parse(await response.json())

    expect(tx).toMatchObject({ action: 'revoke', version: 2 })
    expect(tx.consentAddress).toBe(consentAddress(datasetPda, 2).address.toBase58())
    expect(decodeInstruction(tx.instruction.data)?.name).toBe('revokeConsent')
    // Revocation pays for no account, so the owner signs read-only.
    expect(
      tx.instruction.accounts.filter((account) => account.isSigner).map((a) => a.pubkey),
    ).toEqual([OWNER])
  })

  it('refuses when there is no consent to revoke', async () => {
    readConsentChain.mockResolvedValueOnce({ ...ACTIVE, consentVersion: 0, currentRevoked: null })
    expect((await refusal(await revoke())).details).toEqual({ reason: 'no-consent' })
  })

  it('refuses a second revocation — it would move the date the gate closed', async () => {
    readConsentChain.mockResolvedValueOnce({ ...ACTIVE, currentRevoked: true })
    expect((await refusal(await revoke())).details).toEqual({ reason: 'already-revoked' })
  })

  it('refuses a dataset that is not on chain', async () => {
    readConsentChain.mockResolvedValueOnce(null)
    expect((await refusal(await revoke())).details).toEqual({ reason: 'unregistered' })
  })

  it('answers "not found" for another owner’s dataset', async () => {
    expect((await revoke('other')).status).toBe(404)
  })
})
