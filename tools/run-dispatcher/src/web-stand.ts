import { sealDataset } from '@genovault/crypto'
import { generateDataset, publicManifest } from '@genovault/gen-dataset'
import type { GenoVaultProgram } from '@genovault/sdk'
import { revokeConsentIx, setConsentIx } from '@genovault/sdk'
import {
  BUYER_CATEGORIES,
  type BuyerCategoryName,
  USE_TYPES,
  type UseTypeName,
} from '@genovault/shared'
import { x25519 } from '@noble/curves/ed25519'
import { type Connection, Keypair } from '@solana/web3.js'
import type { ApiStand } from './api-stand.ts'
import { bootstrapPlatform } from './bootstrap.ts'
import { airdrop, chainNow, expect2xx, fromWire, sendOrThrow } from './consent-matrix.ts'

/**
 * A world for the web app to open onto (`T066`).
 *
 * The bare validator starts empty; the web app on it would show an empty
 * catalog and nothing to quote. This seeds the platform and three synthetic
 * datasets through the same API routes and the same instructions a person
 * would use, into a catalog directory the real API then serves (`CATALOG_FS_ROOT`
 * and `STORAGE_FS_ROOT` pointed at `workDir`).
 *
 * Stand only: nothing here is product. Owners are throwaway keypairs, and the
 * ciphertext is sealed to a random x25519 key — the bare stand has no MXE, so
 * nobody can compute over these bytes, and the catalog says nothing to the
 * contrary: runs need `localnet.sh`.
 */

interface StandDataset {
  datasetId: string
  title: string
  description: string
  records: number
  seed: number
  pricePer1k: bigint
  consent: {
    allowed: UseTypeName[]
    forbidden: UseTypeName[]
    categories: BuyerCategoryName[]
    expiresInDays: number | null
  } | null
  revoked: boolean
}

const MARKERS = 50

const PLAN: StandDataset[] = [
  {
    datasetId: 'stand-cardio-01',
    title: 'Stand cardiology cohort — 01',
    description:
      'Synthetic cardiology cohort generated for the local stand. Open to academic and non-profit buyers.',
    records: 600,
    seed: 11,
    pricePer1k: 2_500_000n,
    consent: {
      allowed: ['cardiology', 'populationGenetics'],
      forbidden: ['pharmaCommercial'],
      categories: ['academic', 'nonProfit'],
      expiresInDays: 365,
    },
    revoked: false,
  },
  {
    datasetId: 'stand-rare-02',
    title: 'Stand rare-disease set — 02',
    description: 'Small synthetic rare-disease set for the local stand, with no expiry on consent.',
    records: 240,
    seed: 23,
    pricePer1k: 6_000_000n,
    consent: {
      allowed: ['rareDisease', 'cardiology'],
      forbidden: [],
      categories: ['academic', 'nonProfit', 'commercial'],
      expiresInDays: null,
    },
    revoked: false,
  },
  {
    datasetId: 'stand-pop-03',
    title: 'Stand population panel — 03',
    description: 'Synthetic population-genetics panel whose owner revoked consent on the stand.',
    records: 400,
    seed: 37,
    pricePer1k: 1_000_000n,
    consent: {
      allowed: ['populationGenetics'],
      forbidden: [],
      categories: ['academic'],
      expiresInDays: null,
    },
    revoked: true,
  },
]

export interface WebStandOptions {
  connection: Connection
  program: GenoVaultProgram
  api: ApiStand
  /**
   * Platform authority and mint authority of the settlement token. Kept by
   * the caller across runs: the same key later funds a buyer for the demo.
   */
  authority: Keypair
  onProgress?(note: string): void
}

export interface WebStandReport {
  mint: string
  datasets: { datasetId: string; owner: string; consentVersion: number; revoked: boolean }[]
}

const mask = <T extends string>(names: readonly T[], bits: Record<T, number>): number =>
  names.reduce((value, name) => value | bits[name], 0)

export async function seedWebStand(options: WebStandOptions): Promise<WebStandReport> {
  const { connection, program, api } = options
  const note = options.onProgress ?? (() => {})

  const { authority } = options
  await airdrop(connection, authority.publicKey, 100)
  const platform = await bootstrapPlatform({
    connection,
    program,
    authority,
    mint: Keypair.generate(),
    feeBps: 700,
  })
  note(`platform up, mint ${platform.mint.toBase58()}`)

  const datasets: WebStandReport['datasets'] = []
  for (const [ordinal, plan] of PLAN.entries()) {
    const owner = Keypair.generate()
    await airdrop(connection, owner.publicKey, 2)
    const session = await api.session(`standowner${ordinal}`)

    const { manifest, records } = generateDataset({
      records: plan.records,
      markers: MARKERS,
      causalMarkers: 5,
      seed: plan.seed,
    })
    const sealed = await sealDataset(
      records.map(({ sex, age, affected, genotypes }) => ({ sex, age, affected, genotypes })),
      x25519.getPublicKey(x25519.utils.randomSecretKey()),
    )
    const shown = publicManifest(manifest)

    const registered = expect2xx(
      await api.request('POST', '/datasets', session, {
        datasetId: plan.datasetId,
        owner: owner.publicKey.toBase58(),
        contentHash: sealed.contentHash,
        pricePer1k: plan.pricePer1k.toString(),
        metadata: {
          title: plan.title,
          description: plan.description,
          schema: shown.schema,
          recordCount: shown.recordCount,
          markerCount: shown.markerCount,
          statistics: shown.statistics,
          provenance: {
            source: 'synthetic',
            collectedFrom: '2025-01-01',
            collectedTo: '2025-12-31',
          },
        },
      }),
      `register ${plan.datasetId}`,
    )
    expect2xx(
      await api.request('PUT', `/datasets/${plan.datasetId}/ciphertext`, session, sealed.bytes),
      `upload ${plan.datasetId}`,
    )
    const registration = registered.registration as { instruction: unknown } | undefined
    await sendOrThrow(
      connection,
      owner,
      [fromWire(registration?.instruction)],
      `registration of ${plan.datasetId}`,
    )

    let version = 0
    if (plan.consent !== null) {
      const expiresAt =
        plan.consent.expiresInDays === null
          ? null
          : (await chainNow(connection)) + plan.consent.expiresInDays * 86_400
      await sendOrThrow(
        connection,
        owner,
        [
          await setConsentIx(program, {
            owner: owner.publicKey,
            datasetId: plan.datasetId,
            currentVersion: 0,
            allowedUses: mask(plan.consent.allowed, USE_TYPES),
            forbiddenUses: mask(plan.consent.forbidden, USE_TYPES),
            buyerCategories: mask(plan.consent.categories, BUYER_CATEGORIES),
            expiresAt,
          }),
        ],
        `consent on ${plan.datasetId}`,
      )
      version = 1
    }
    if (plan.revoked) {
      await sendOrThrow(
        connection,
        owner,
        [
          await revokeConsentIx(program, {
            owner: owner.publicKey,
            datasetId: plan.datasetId,
            currentVersion: version,
          }),
        ],
        `revocation on ${plan.datasetId}`,
      )
    }

    datasets.push({
      datasetId: plan.datasetId,
      owner: owner.publicKey.toBase58(),
      consentVersion: version,
      revoked: plan.revoked,
    })
    note(
      `${plan.datasetId}: ${plan.records} records, consent v${version}${plan.revoked ? ', revoked' : ''}`,
    )
  }

  return { mint: platform.mint.toBase58(), datasets }
}
