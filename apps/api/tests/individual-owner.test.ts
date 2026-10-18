import { Buffer } from 'node:buffer'
import { consentAddress, createProgram, datasetAddress } from '@genovault/sdk'
import {
  apiErrorSchema,
  BUYER_CATEGORIES,
  type ChainView,
  chainViewSchema,
  ciphertextUploadResponseSchema,
  consentTransactionSchema,
  contentHash,
  type DatasetId,
  datasetDetailSchema,
  datasetIdSchema,
  datasetListSchema,
  LIMB_BYTES,
  MAX_MARKERS,
  MIN_COHORT,
  NONCE_BYTES,
  type PricePer1k,
  pricePer1kSchema,
  type RunDatasetRef,
  registerDatasetResponseSchema,
  runOrderSchema,
  runQuoteSchema,
  SCALAR_FIELD_COUNT,
  type SolanaAddress,
  serializeEnvelope,
  solanaAddressSchema,
  USE_TYPES,
  X25519_KEY_BYTES,
} from '@genovault/shared'
import { Connection, PublicKey } from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.ts'
import { AuthError, type TokenVerifier } from '../src/services/auth.ts'
import { type CatalogStore, memoryCatalog } from '../src/services/catalog.ts'
import {
  type ConsentChainState,
  createConsentIxBuilder,
  createRegistrationBuilder,
  createRunOrderBuilder,
  deriveDatasetAddress,
  type QuoteChainState,
  type QuoteDatasetState,
} from '../src/services/chain.ts'
import type { StorageDriver } from '../src/services/storage.ts'

/**
 * `FR-009` / `T043`: an individual is a full data owner.
 *
 * One person registers a dataset of one record, uploads it, shows in the
 * catalog, sets and revokes consent, and is priced into a pool next to a
 * clinic — all through the same routes and the same checks as a clinic.
 * Nothing here is special-cased for the individual, and that is the claim:
 * the only difference the API makes is the `MIN_COHORT` rule, which keeps
 * aggregate statistics off a cohort that would describe a single person.
 *
 * The chain is faked exactly as in the neighbouring route tests (a live reader
 * would need a validator with the program deployed); the instruction builders
 * are the real ones and make no network call.
 */

const PERSON = solanaAddressSchema.parse('11111111111111111111111111111112')
const CLINIC = solanaAddressSchema.parse('SysvarRent111111111111111111111111111111111')
const MINT = solanaAddressSchema.parse('SysvarC1ock11111111111111111111111111111111')
const BUYER = solanaAddressSchema.parse('4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T')
const DISPATCHER = solanaAddressSchema.parse('So11111111111111111111111111111111111111112')
const PERSON_USER = 'did:privy:clx0000000000000000000000'
const CLINIC_USER = 'did:privy:clx2222222222222222222222'

const MY_GENOME = datasetIdSchema.parse('my-genome')
const CLINIC_COHORT = datasetIdSchema.parse('clinic-cohort')
const CLINIC_RECORDS = 12
// The recipe's own profile: any other marker count is `recipe-mismatch`.
const MARKERS = MAX_MARKERS
// Below one token unit per record: `floor(999 × 1 / 1000)` would be zero, and a
// zero line would let a buyer use the person's record for free.
const PERSON_PRICE = pricePer1kSchema.parse(999n)
const CLINIC_PRICE = pricePer1kSchema.parse(1_500_000n)
const NOW = 1_735_689_600n

/** Not present anywhere but in the person's single record frame. */
const SENTINEL_BYTE = 0xa7

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })

const verify: TokenVerifier = async (token) => {
  if (token === 'clinic') {
    return { userId: CLINIC_USER, sessionId: 'sid-2', expiresAt: new Date(Date.now() + 60_000) }
  }
  if (token !== 'person') throw new AuthError('wrong token')
  return { userId: PERSON_USER, sessionId: 'sid-1', expiresAt: new Date(Date.now() + 60_000) }
}

/**
 * An envelope built with `serializeEnvelope`, not a cipher, as in the other
 * route tests: `apps/api` has no cipher and must not need one (`FR-004a`).
 * One limb of the first record carries the sentinel when `marked` is set.
 */
function envelope(records: number, marked: boolean): Uint8Array {
  const fieldsPerRecord = SCALAR_FIELD_COUNT + MARKERS
  const frames = Array.from({ length: records }, (_unused, index) => {
    const nonce = new Uint8Array(NONCE_BYTES)
    new DataView(nonce.buffer).setUint32(0, index + 1, true)
    return {
      nonce,
      limbs: Array.from({ length: fieldsPerRecord }, (_field, field) =>
        new Array<number>(LIMB_BYTES).fill(
          marked && index === 0 && field === SCALAR_FIELD_COUNT ? SENTINEL_BYTE : 1,
        ),
      ),
    }
  })

  return serializeEnvelope(
    {
      mxePublicKey: new Uint8Array(X25519_KEY_BYTES).fill(7),
      ephemeralPublicKey: new Uint8Array(X25519_KEY_BYTES).fill(9),
      recordCount: records,
      markerCount: MARKERS,
      fieldsPerRecord,
    },
    frames,
  )
}

function memoryStorage(): StorageDriver {
  const objects = new Map<string, Uint8Array>()
  return {
    kind: 'fs',
    async put(key, bytes) {
      objects.set(key, bytes)
    },
    async get(key) {
      const bytes = objects.get(key)
      if (bytes === undefined) throw new Error(`no object ${key}`)
      return bytes
    },
    async exists(key) {
      return objects.has(key)
    },
    async remove(key) {
      objects.delete(key)
    },
  }
}

const SCHEMA = [
  { field: 'age', type: 'integer', description: 'Age in full years' },
  { field: 'affected', type: 'integer', description: 'Phenotype flag' },
]

function personMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'My genome',
    description: 'One person, one record, shared on my own terms.',
    schema: SCHEMA,
    recordCount: 1,
    markerCount: MARKERS,
    provenance: { source: 'individual', collectedFrom: '2025-03-01', collectedTo: '2025-03-01' },
    ...overrides,
  }
}

function clinicMetadata(): Record<string, unknown> {
  return {
    title: 'Clinic cohort',
    description: 'Synthetic clinic cohort for checks.',
    schema: SCHEMA,
    recordCount: CLINIC_RECORDS,
    markerCount: MARKERS,
    statistics: {
      affectedRate: 0.25,
      meanAge: 44,
      alleleFrequencies: Array.from({ length: MARKERS }, () => 0.25),
    },
    provenance: { source: 'clinic', collectedFrom: '2024-01-01', collectedTo: '2024-06-30' },
  }
}

/** What the chain says about each dataset once its owner signed `register_dataset`. */
function chainView(datasetId: DatasetId): ChainView {
  const person = datasetId === MY_GENOME
  return chainViewSchema.parse({
    state: 'registered',
    status: 'active',
    version: 1,
    contentHash: 'a'.repeat(64),
    recordCountClaimed: person ? '1' : String(CLINIC_RECORDS),
    pricePer1k: (person ? PERSON_PRICE : CLINIC_PRICE).toString(),
    consent: null,
    verifiedBadge: null,
  })
}

const CONSENT = {
  allowedUses: USE_TYPES.oncology,
  forbiddenUses: 0,
  buyerCategories: BUYER_CATEGORIES.academic,
  expiresAt: null,
  revoked: false,
} as const

/** Per-owner consent state on chain; tests flip it to model a revocation. */
let personConsentRevoked = false

function quoteDataset(ref: RunDatasetRef): QuoteDatasetState {
  const person = ref.datasetId === MY_GENOME
  return {
    datasetAddress: deriveDatasetAddress(ref.owner, ref.datasetId),
    dataset: {
      status: 'active',
      recordCountClaimed: person ? 1n : BigInt(CLINIC_RECORDS),
      pricePer1k: (person ? PERSON_PRICE : CLINIC_PRICE) as PricePer1k,
      consentVersion: 1,
    },
    consent: { ...CONSENT, revoked: person && personConsentRevoked },
  }
}

const readChain = vi.fn(async (_owner: SolanaAddress, datasetId: DatasetId) => chainView(datasetId))
const checkRegistered = vi.fn(
  async (addresses: readonly SolanaAddress[]) => new Map(addresses.map((a) => [a, true])),
)
const readQuoteChain = vi.fn(
  async (refs: readonly RunDatasetRef[]): Promise<QuoteChainState> => ({
    feeBps: 700,
    mint: MINT,
    paused: false,
    now: NOW,
    datasets: refs.map(quoteDataset),
  }),
)
const readConsentChain = vi.fn(
  async (): Promise<ConsentChainState | null> => ({
    status: 'active',
    consentVersion: 0,
    currentRevoked: null,
    now: NOW,
  }),
)

let catalog: CatalogStore
let app: ReturnType<typeof createApp>
/** Every response body this file saw, for the raw-record sweep at the end. */
let seen: string[]
let personBytes: Uint8Array

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await app.request(path, init)
  seen.push(await response.clone().text())
  return response
}

function json(token: string, method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function register(
  token: string,
  owner: SolanaAddress,
  datasetId: DatasetId,
  bytes: Uint8Array,
  pricePer1k: PricePer1k,
  metadata: Record<string, unknown>,
): Promise<Response> {
  return call(
    '/datasets',
    json(token, 'POST', {
      datasetId,
      owner,
      contentHash: await contentHash(bytes),
      pricePer1k: pricePer1k.toString(),
      metadata,
    }),
  )
}

async function upload(token: string, datasetId: DatasetId, bytes: Uint8Array): Promise<Response> {
  return call(`/datasets/${datasetId}/ciphertext`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: bytes,
  })
}

/** The person's full owner path up to "stored", asserted at each step. */
async function personStores(): Promise<void> {
  const registered = await register(
    'person',
    PERSON,
    MY_GENOME,
    personBytes,
    PERSON_PRICE,
    personMetadata(),
  )
  expect(registered.status).toBe(201)
  registerDatasetResponseSchema.parse(await registered.json())

  const stored = await upload('person', MY_GENOME, personBytes)
  expect(stored.status).toBe(200)
}

async function clinicStores(): Promise<void> {
  const bytes = envelope(CLINIC_RECORDS, false)
  const registered = await register(
    'clinic',
    CLINIC,
    CLINIC_COHORT,
    bytes,
    CLINIC_PRICE,
    clinicMetadata(),
  )
  expect(registered.status).toBe(201)
  expect((await upload('clinic', CLINIC_COHORT, bytes)).status).toBe(200)
}

beforeEach(() => {
  seen = []
  personConsentRevoked = false
  personBytes = envelope(1, true)
  readChain.mockClear()
  readQuoteChain.mockClear()
  readConsentChain.mockReset()
  readConsentChain.mockImplementation(async () => ({
    status: 'active',
    consentVersion: 0,
    currentRevoked: null,
    now: NOW,
  }))
  catalog = memoryCatalog()
  app = createApp({
    verifyAccessToken: verify,
    catalog,
    storage: memoryStorage(),
    buildRegistration: createRegistrationBuilder('http://127.0.0.1:8899'),
    readChain,
    checkRegistered,
    readQuoteChain,
    buildRunOrder: createRunOrderBuilder('http://127.0.0.1:8899'),
    readConsentChain,
    buildConsentIx: createConsentIxBuilder('http://127.0.0.1:8899'),
    dispatcher: DISPATCHER,
    baseUrl: 'http://127.0.0.1:8879',
  })
})

describe('an individual registers a one-record dataset (FR-009)', () => {
  it('accepts one record without statistics, with the same registration a clinic gets', async () => {
    const response = await register(
      'person',
      PERSON,
      MY_GENOME,
      personBytes,
      PERSON_PRICE,
      personMetadata(),
    )

    expect(response.status).toBe(201)
    const body = registerDatasetResponseSchema.parse(await response.json())
    expect(body).toMatchObject({ datasetId: MY_GENOME, owner: PERSON, status: 'pending' })
    // The unsigned `register_dataset` is signed by the person alone.
    expect(
      body.registration.instruction.accounts.filter((a) => a.isSigner).map((a) => a.pubkey),
    ).toEqual([PERSON])
  })

  it(`refuses statistics below MIN_COHORT (${MIN_COHORT}) and names the field`, async () => {
    const response = await register(
      'person',
      PERSON,
      MY_GENOME,
      personBytes,
      PERSON_PRICE,
      personMetadata({
        statistics: {
          affectedRate: 1,
          meanAge: 37,
          alleleFrequencies: Array.from({ length: MARKERS }, () => 0.5),
        },
      }),
    )

    expect(response.status).toBe(400)
    const error = apiErrorSchema.parse(await response.json()).error
    expect(error.code).toBe('INVALID_INPUT')
    const { issues } = z
      .object({ issues: z.array(z.object({ path: z.array(z.unknown()) })) })
      .parse(error.details)
    expect(issues.map((issue) => issue.path)).toContainEqual(['metadata', 'statistics'])
    // Nothing was written: the refused declaration does not hold the id.
    expect(await catalog.getDataset(PERSON, MY_GENOME)).toBeUndefined()
  })

  it('stores a one-record envelope and reports exactly one record', async () => {
    await register('person', PERSON, MY_GENOME, personBytes, PERSON_PRICE, personMetadata())
    const response = await upload('person', MY_GENOME, personBytes)

    expect(response.status).toBe(200)
    const body = ciphertextUploadResponseSchema.parse(await response.json())
    expect(body).toMatchObject({ status: 'stored', recordCount: 1, markerCount: MARKERS })
    expect(body.storedHash).toBe(await contentHash(personBytes))
  })

  it('refuses an envelope whose record count is not the declared one', async () => {
    // The same check a clinic meets: one declared, two uploaded is refused.
    const two = envelope(2, true)
    await register('person', PERSON, MY_GENOME, two, PERSON_PRICE, personMetadata())
    const response = await upload('person', MY_GENOME, two)
    expect(response.status).toBe(400)
  })
})

describe('the one-record dataset in the catalog', () => {
  beforeEach(async () => {
    await personStores()
    await clinicStores()
  })

  it('is listed to an anonymous buyer next to the clinic, once on chain', async () => {
    const page = datasetListSchema.parse(await (await call('/datasets')).json())

    expect(page.total).toBe(2)
    const person = page.items.find((item) => item.datasetId === MY_GENOME)
    const clinic = page.items.find((item) => item.datasetId === CLINIC_COHORT)
    expect(person).toMatchObject({
      owner: PERSON,
      recordCount: 1,
      source: 'individual',
      pricePer1k: PERSON_PRICE.toString(),
      onChain: true,
    })
    // The same card shape for both: no field exists for one and not the other.
    expect(Object.keys(person ?? {}).sort()).toEqual(Object.keys(clinic ?? {}).sort())
  })

  it('is hidden from buyers while not on chain, exactly like a clinic dataset', async () => {
    checkRegistered.mockImplementationOnce(
      async (addresses) => new Map(addresses.map((a) => [a, false])),
    )
    const page = datasetListSchema.parse(await (await call('/datasets')).json())
    expect(page).toMatchObject({ items: [], total: 0 })
  })

  it('opens as a card without statistics, with the chain state', async () => {
    const response = await call(`/datasets/${PERSON}/${MY_GENOME}`)
    expect(response.status).toBe(200)
    const detail = datasetDetailSchema.parse(await response.json())

    expect(detail).toMatchObject({
      datasetId: MY_GENOME,
      recordCount: 1,
      source: 'individual',
      ciphertextStored: true,
      statistics: null,
    })
    expect(detail.chain).toMatchObject({ state: 'registered', recordCountClaimed: '1' })

    const clinic = datasetDetailSchema.parse(
      await (await call(`/datasets/${CLINIC}/${CLINIC_COHORT}`)).json(),
    )
    expect(clinic.statistics).not.toBeNull()
  })
})

describe('the individual sets and revokes consent', () => {
  beforeEach(async () => {
    await personStores()
  })

  it('gets an unsigned set_consent with the person as the only signer', async () => {
    const response = await call(
      `/datasets/${MY_GENOME}/consent`,
      json('person', 'POST', {
        allowedUses: ['oncology'],
        forbiddenUses: ['pharmaCommercial'],
        buyerCategories: ['academic'],
        expiresAt: null,
      }),
    )

    expect(response.status).toBe(200)
    const tx = consentTransactionSchema.parse(await response.json())
    const dataset = datasetAddress(new PublicKey(PERSON), MY_GENOME).address
    expect(tx).toMatchObject({ action: 'set', datasetId: MY_GENOME, owner: PERSON, version: 1 })
    expect(tx.consentAddress).toBe(consentAddress(dataset, 1).address.toBase58())
    expect(tx.instruction.accounts.filter((a) => a.isSigner).map((a) => a.pubkey)).toEqual([PERSON])
  })

  it('gets an unsigned revoke_consent for the current version', async () => {
    readConsentChain.mockResolvedValueOnce({
      status: 'active',
      consentVersion: 1,
      currentRevoked: false,
      now: NOW,
    })
    const response = await call(`/datasets/${MY_GENOME}/consent`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer person' },
    })

    expect(response.status).toBe(200)
    const tx = consentTransactionSchema.parse(await response.json())
    expect(tx).toMatchObject({ action: 'revoke', owner: PERSON, version: 1 })
    expect(tx.instruction.accounts.filter((a) => a.isSigner).map((a) => a.pubkey)).toEqual([PERSON])
  })

  it('cannot be driven by another session — the clinic gets "not found"', async () => {
    const response = await call(`/datasets/${MY_GENOME}/consent`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer clinic' },
    })
    expect(response.status).toBe(404)
  })
})

describe('the one-record dataset enters a pool like any other', () => {
  const pool = [
    { owner: CLINIC, datasetId: CLINIC_COHORT },
    { owner: PERSON, datasetId: MY_GENOME },
  ]
  const quoteBody = {
    recipeId: 1,
    useType: 'oncology',
    buyerCategory: 'academic',
    datasets: pool,
    params: {},
  }
  const clinicBound = (CLINIC_PRICE * BigInt(CLINIC_RECORDS) + 999n) / 1000n
  // ceil(999 × 1 / 1000) = 1, not floor's 0.
  const personBound = (PERSON_PRICE * 1n + 999n) / 1000n

  function order(maxEscrow: bigint): Record<string, unknown> {
    return {
      ...quoteBody,
      buyer: BUYER,
      nonce: '42',
      maxEscrow: maxEscrow.toString(),
      buyerX25519: '11'.repeat(32),
    }
  }

  beforeEach(async () => {
    await personStores()
    await clinicStores()
  })

  it('is quoted with a rounded-up, non-zero upper bound', async () => {
    const response = await call('/runs/quote', json('person', 'POST', quoteBody))
    expect(response.status).toBe(200)
    const quote = runQuoteSchema.parse(await response.json())

    expect(personBound).toBe(1n)
    expect(quote.eligibleCount).toBe(2)
    expect(quote.orderable).toBe(true)
    const person = quote.datasets.find((line) => line.datasetId === MY_GENOME)
    expect(person).toMatchObject({
      eligible: true,
      recordCountClaimed: '1',
      upperBound: personBound.toString(),
    })
    expect(quote.upperBound).toBe((clinicBound + personBound).toString())
  })

  it('is ordered with the clinic, and its share is part of the escrow', async () => {
    const response = await call('/runs', json('person', 'POST', order(clinicBound + personBound)))
    expect(response.status).toBe(201)
    const body = runOrderSchema.parse(await response.json())

    expect(body.escrow).toBe((clinicBound + personBound).toString())
    expect(body.datasets.map((d) => d.datasetId)).toEqual([CLINIC_COHORT, MY_GENOME])
    // The pool rides as "dataset + current consent" pairs, the person's included.
    const personDataset = datasetAddress(
      new PublicKey(PERSON),
      MY_GENOME,
      program.programId,
    ).address
    const tail = body.instruction.accounts.slice(8).map((a) => a.pubkey)
    expect(tail.slice(2)).toEqual([
      personDataset.toBase58(),
      consentAddress(personDataset, 1, program.programId).address.toBase58(),
    ])
    expect(body.instruction.accounts.filter((a) => a.isSigner).map((a) => a.pubkey)).toEqual([
      BUYER,
    ])
  })

  it('a ceiling that covers only the clinic is refused — the person is not free', async () => {
    const response = await call('/runs', json('person', 'POST', order(clinicBound)))
    expect(response.status).toBe(409)
    const error = apiErrorSchema.parse(await response.json()).error
    expect(error.details).toMatchObject({
      refusal: 'escrow-below-price',
      escrow: (clinicBound + personBound).toString(),
    })
  })

  it('after revocation it leaves the pool by the same rule as a clinic dataset', async () => {
    personConsentRevoked = true
    const quote = runQuoteSchema.parse(
      await (await call('/runs/quote', json('person', 'POST', quoteBody))).json(),
    )
    expect(quote.datasets.find((line) => line.datasetId === MY_GENOME)).toMatchObject({
      eligible: false,
      reason: 'revoked',
    })
    expect(quote.upperBound).toBe(clinicBound.toString())

    const response = await call('/runs', json('person', 'POST', order(clinicBound + personBound)))
    expect(response.status).toBe(403)
    expect(apiErrorSchema.parse(await response.json()).error.details?.ineligible).toEqual([
      { owner: PERSON, datasetId: MY_GENOME, reason: 'revoked' },
    ])
  })

  it('no response on the whole path carries the record or its ciphertext', async () => {
    // Every route the path touched, re-run here so the sweep has bodies to read.
    await call('/datasets')
    await call('/datasets?owner=me', { headers: { authorization: 'Bearer person' } })
    await call(`/datasets/${PERSON}/${MY_GENOME}`)
    await call('/runs/quote', json('person', 'POST', quoteBody))
    await call('/runs', json('person', 'POST', order(clinicBound + personBound)))

    const frame = Buffer.from(new Array<number>(LIMB_BYTES).fill(SENTINEL_BYTE))
    const ciphertext = Buffer.from(personBytes)
    expect(seen.length).toBeGreaterThan(5)
    for (const text of seen) {
      expect(text).not.toContain(frame.toString('hex'))
      expect(text).not.toContain(frame.toString('base64'))
      expect(text).not.toContain(frame.toString('latin1'))
      expect(text).not.toContain(ciphertext.toString('base64'))
    }
  })
})
