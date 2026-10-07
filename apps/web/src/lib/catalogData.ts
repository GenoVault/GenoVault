import {
  type ApiError,
  buyerCategoryBit,
  type ChainView,
  type ConsentView,
  DATASET_LIST_LIMIT_DEFAULT,
  type DatasetCard,
  type DatasetDetail,
  type DatasetList,
  datasetDetailSchema,
  datasetListSchema,
  useTypeBit,
} from '@genovault/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getDatasetDetail, getDatasets, toApiError } from '@/lib/api'
import { dateToExpirySeconds } from '@/lib/consentTerms'
import { LIVE_DATA, type Loadable, mockCard } from '@/lib/runData'
import {
  BASE_RECORD_SCHEMA,
  type ChainStateKind,
  DATASETS,
  type Dataset,
  findDataset,
  markerFields,
} from '@/mockData'

/**
 * The catalog and the dataset card, one source for both modes (`T065`).
 *
 * The screens speak `DatasetList` and `DatasetDetail` — the very schemas
 * `GET /datasets` and `GET /datasets/:owner/:id` answer with. The prototype's
 * datasets reach them through those schemas too, so a fixture the contract
 * refuses fails here and in `tests/mock-fixtures.test.ts`, not on the live API.
 * The same move `T029` made for quotes and runs.
 */

/**
 * Who attests in the prototype. A placeholder, not an operator: the prototype
 * has no platform, and the screen never shows this address as anyone's.
 */
const MOCK_VERIFIER = '11111111111111111111111111111112'

/** A mock date (ISO, no time) → Unix seconds at its start, as a string. */
const dayStartSeconds = (date: string): string => String(Date.parse(`${date}T00:00:00Z`) / 1000)

function mockConsent(dataset: Dataset): ConsentView | null {
  const consent = dataset.consent
  if (consent === null) return null
  return {
    version: consent.version,
    allowedUses: consent.allowedUseTypes.reduce((mask, use) => mask | useTypeBit(use), 0),
    forbiddenUses: consent.forbiddenUseTypes.reduce((mask, use) => mask | useTypeBit(use), 0),
    buyerCategories: consent.buyerCategories.reduce(
      (mask, category) => mask | buyerCategoryBit(category),
      0,
    ),
    expiresAt: consent.expiresAt === null ? null : dateToExpirySeconds(consent.expiresAt),
    revoked: consent.revoked,
  }
}

function mockChain(dataset: Dataset, preview: ChainStateKind): unknown {
  const chain = dataset.chain
  if (preview !== 'registered' || chain.state !== 'registered') {
    return { state: preview === 'registered' ? chain.state : preview }
  }
  return {
    state: 'registered',
    status: chain.status,
    version: chain.version,
    contentHash: chain.contentHash,
    recordCountClaimed: String(chain.claimedRecords),
    pricePer1k: String(chain.pricePer1k),
    consent: mockConsent(dataset),
    verifiedBadge:
      dataset.attestation.attested && dataset.attestation.attestedAt !== null
        ? {
            verifier: MOCK_VERIFIER,
            verifiedAt: dayStartSeconds(dataset.attestation.attestedAt),
            kind: 'operator-attested',
          }
        : null,
  } satisfies Record<keyof Extract<ChainView, { state: 'registered' }>, unknown>
}

/**
 * A prototype dataset in the shape of `GET /datasets/:owner/:id`.
 *
 * `preview` lets the prototype show the two chain states a real card can be in
 * besides "registered" — the RPC did not answer, or the owner never signed.
 */
export function mockDetail(
  dataset: Dataset,
  preview: ChainStateKind = 'registered',
): DatasetDetail {
  const chain = dataset.chain
  return datasetDetailSchema.parse({
    ...mockCard(dataset),
    schema: [...BASE_RECORD_SCHEMA, ...markerFields(dataset.markers)].map((field) => ({
      field: field.name,
      type: field.type,
      description: field.description,
    })),
    statistics: {
      affectedRate: dataset.declaredStats.affectedRate,
      meanAge: dataset.declaredStats.meanAge,
      alleleFrequencies: dataset.declaredStats.alleleFrequencies,
      declaredBy: 'owner',
      verified: false,
    },
    provenance: {
      source: dataset.source,
      collectedFrom: dataset.collectedFrom,
      collectedTo: dataset.collectedTo,
    },
    // Every prototype dataset is registered, so the declared hash is the
    // chain's; a mismatch between the two would be a different screen.
    contentHash: chain.state === 'registered' ? chain.contentHash : '0'.repeat(64),
    ciphertextStored: dataset.ciphertextUploaded,
    chain: mockChain(dataset, preview),
  })
}

/** The filters `GET /datasets` takes, as the catalog screen holds them. */
export interface CatalogFilters {
  q: string
  source: DatasetCard['source'] | null
  minRecords: number | null
  /** Base units of the settlement mint, as a decimal string. */
  maxPricePer1k: string | null
}

export function catalogQuery(filters: CatalogFilters): Record<string, string> {
  const query: Record<string, string> = {}
  if (filters.q.trim() !== '') query.q = filters.q.trim()
  if (filters.source !== null) query.source = filters.source
  if (filters.minRecords !== null) query.minRecords = String(filters.minRecords)
  if (filters.maxPricePer1k !== null) query.maxPricePer1k = filters.maxPricePer1k
  return query
}

/**
 * The prototype's catalog, filtered the way the API filters it.
 *
 * Substring in title or description, case-insensitive; provenance; records at
 * least; price per thousand at most. First page only, like the screen asks.
 */
export function mockDatasetList(filters: CatalogFilters): DatasetList {
  const needle = filters.q.trim().toLowerCase()
  const items = DATASETS.map(mockCard).filter(
    (card) =>
      (needle === '' ||
        card.title.toLowerCase().includes(needle) ||
        card.description.toLowerCase().includes(needle)) &&
      (filters.source === null || card.source === filters.source) &&
      (filters.minRecords === null || card.recordCount >= filters.minRecords) &&
      (filters.maxPricePer1k === null || BigInt(card.pricePer1k) <= BigInt(filters.maxPricePer1k)),
  )
  return datasetListSchema.parse({
    items: items.slice(0, DATASET_LIST_LIMIT_DEFAULT),
    total: items.length,
    limit: DATASET_LIST_LIMIT_DEFAULT,
    offset: 0,
  })
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * The catalog page (`T066`).
 *
 * The token is optional: the catalog opens without sign-in (decision 2026-10-07,
 * `FR-023`), and a session only adds the owner's own drafts. So
 * the request does not wait for Privy — the first screen of `SC-011` never
 * depends on the 2.7 MB sign-in bundle being ready.
 */
export function useDatasetList(
  filters: CatalogFilters,
  token: string | null,
): Loadable<DatasetList> {
  const [state, setState] = useState<Loadable<DatasetList>>({
    data: null,
    loading: true,
    error: null,
    live: LIVE_DATA,
  })

  useEffect(() => {
    if (!LIVE_DATA) {
      setState({ data: mockDatasetList(filters), loading: false, error: null, live: false })
      return
    }

    let alive = true
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true }))

    getDatasets({ token, signal: controller.signal, query: catalogQuery(filters) })
      .then((list) => {
        if (alive) setState({ data: list, loading: false, error: null, live: true })
      })
      .catch((error: unknown) => {
        if (alive) setState({ data: null, loading: false, error: toApiError(error), live: true })
      })

    return () => {
      alive = false
      controller.abort()
    }
    // `filters` comes from the caller's `useMemo`.
  }, [filters, token])

  return state
}

/**
 * One dataset card. `refresh` re-reads it — after the owner signs a consent
 * change the card has to show what the chain now holds, not what it held.
 */
export function useDatasetDetail(
  owner: string,
  datasetId: string,
  preview: ChainStateKind,
  token: string | null,
): Loadable<DatasetDetail> & { refresh: () => void } {
  const [state, setState] = useState<Loadable<DatasetDetail>>({
    data: null,
    loading: true,
    error: null,
    live: LIVE_DATA,
  })
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    if (!LIVE_DATA) {
      const dataset = findDataset(owner, datasetId)
      const error: ApiError['error'] | null =
        dataset === undefined ? { code: 'NOT_FOUND', message: 'No such dataset.' } : null
      setState({
        data: dataset === undefined ? null : mockDetail(dataset, preview),
        loading: false,
        error,
        live: false,
      })
      return
    }

    inFlight.current?.abort()
    const next = new AbortController()
    inFlight.current = next
    setState((prev) => ({ ...prev, loading: true }))

    getDatasetDetail(owner, datasetId, { token, signal: next.signal })
      .then((detail) => {
        if (!next.signal.aborted) {
          setState({ data: detail, loading: false, error: null, live: true })
        }
      })
      .catch((error: unknown) => {
        if (!next.signal.aborted) {
          setState({ data: null, loading: false, error: toApiError(error), live: true })
        }
      })
  }, [owner, datasetId, preview, token])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => () => inFlight.current?.abort(), [])

  return { ...state, refresh: load }
}
