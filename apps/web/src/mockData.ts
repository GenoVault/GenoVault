/**
 * M0 прототип: усі дані в одному файлі.
 * Типи звідси у T065 стають Zod-схемами в packages/shared,
 * тому форма об'єктів важливіша за елегантність коду.
 *
 * Жодної реальної організації: усі власники — вигадані назви,
 * усі датасети мають provenance `synthetic`.
 */

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

export type DatasetSource = 'clinic' | 'biobank' | 'individual' | 'synthetic'

export type UseType =
  | 'oncology'
  | 'cardiology'
  | 'rareDisease'
  | 'populationGenetics'
  | 'pharmaCommercial'

export type BuyerCategory = 'academic' | 'nonProfit' | 'commercial' | 'government'

export type IneligibleReason =
  | 'unregistered'
  | 'retired'
  | 'ciphertext-missing'
  | 'no-consent'
  | 'revoked'
  | 'expired'
  | 'use-forbidden'
  | 'use-not-allowed'
  | 'category-not-allowed'

export type OrderBlocker = 'platform-paused' | 'no-eligible-datasets' | null

export type ChainStateKind = 'unavailable' | 'unregistered' | 'registered'

export type ChainStatus = 'active' | 'retired'

export type RunStatus = 'accepted' | 'running' | 'completed' | 'rejected' | 'failed'

export type ApiErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'CONSENT_VIOLATION'
  | 'NOT_FOUND'
  | 'INSUFFICIENT_ESCROW'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'UPSTREAM_UNAVAILABLE'

export type SexFilter = 'female' | 'male' | 'any'
export type AffectedFilter = 'affected' | 'unaffected' | 'any'

export const DATASET_SOURCES: DatasetSource[] = ['clinic', 'biobank', 'individual', 'synthetic']

export const USE_TYPES: UseType[] = [
  'oncology',
  'cardiology',
  'rareDisease',
  'populationGenetics',
  'pharmaCommercial',
]

export const BUYER_CATEGORIES: BuyerCategory[] = [
  'academic',
  'nonProfit',
  'commercial',
  'government',
]

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  CONSENT_VIOLATION: 403,
  NOT_FOUND: 404,
  INSUFFICIENT_ESCROW: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 503,
}

export interface ApiError {
  error: {
    code: ApiErrorCode
    message: string
    details?: Record<string, unknown>
  }
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const LIMITS = {
  MIN_COHORT: 10,
  MIN_CONTRIBUTION: 10,
  MAX_MARKERS: 64,
  MAX_RUN_DATASETS: 50,
  RECORDS_PER_PRICE_UNIT: 1000,
  DATASET_ID_MAX_LENGTH: 32,
  DATASET_LIST_LIMIT_DEFAULT: 20,
  FEE_BPS: 700,
  FEE_BPS_MAX: 1000,
  AGE_MIN: 0,
  AGE_MAX: 255,
} as const

/** Стейблкоїн-мінт: 6 знаків після коми, без символу валюти. */
export const STABLE_MINT = {
  address: 'Gv7QsPq8fJ3mNz1yTwHb5rXk9uDaLc4EvSg2ThRnk2Qa',
  decimals: 6,
  unitLabel: 'stable unit',
} as const

/** Виміряна вартість шифрування: 1183 µs на елемент поля, лінійно. */
export const ENCRYPTION = {
  microsecondsPerElement: 1183,
  bytesPerElement: 33,
  encryptedFieldsPerRecord: 53, // 50 маркерів + sex + age + affected
} as const

/* ------------------------------------------------------------------ */
/* Record schema                                                       */
/* ------------------------------------------------------------------ */

export interface SchemaField {
  name: string
  type: 'string' | 'integer'
  description: string
}

export const BASE_RECORD_SCHEMA: SchemaField[] = [
  {
    name: 'subjectId',
    type: 'string',
    description: 'Pseudonymous record key, unique within the dataset',
  },
  { name: 'sex', type: 'integer', description: '0 — female, 1 — male' },
  { name: 'age', type: 'integer', description: 'Age in years at collection (0–255)' },
  {
    name: 'affected',
    type: 'integer',
    description: 'Phenotype label: 0 — unaffected, 1 — affected',
  },
]

export const markerFieldName = (index: number): string =>
  `marker${String(index + 1).padStart(4, '0')}`

export const markerFields = (count: number): SchemaField[] =>
  Array.from({ length: count }, (_, i) => ({
    name: markerFieldName(i),
    type: 'integer' as const,
    description: 'Minor-allele copies (0, 1, 2)',
  }))

export const markerSummaryRow = (count: number) => ({
  label: `${markerFieldName(0)}…${markerFieldName(count - 1)}`,
  count,
  type: 'integer' as const,
  description: 'Minor-allele copies (0, 1, 2)',
})

/* ------------------------------------------------------------------ */
/* Datasets                                                            */
/* ------------------------------------------------------------------ */

export interface DeclaredStats {
  declaredBy: 'owner'
  verified: false
  affectedRate: number
  meanAge: number
  /** Рівно стільки чисел, скільки маркерів. */
  alleleFrequencies: number[]
}

export interface Consent {
  version: number
  setAt: string
  allowedUseTypes: UseType[]
  forbiddenUseTypes: UseType[]
  buyerCategories: BuyerCategory[]
  /** `null` — без строку дії. */
  expiresAt: string | null
  revoked: boolean
  revokedAt: string | null
}

export type ChainRecord =
  | { state: 'unavailable' }
  | { state: 'unregistered' }
  | {
      state: 'registered'
      status: ChainStatus
      contentHash: string
      version: number
      claimedRecords: number
      pricePer1k: number
      registeredAt: string
    }

export interface Attestation {
  attested: boolean
  /** `operator-attested`: довіра до оператора платформи, не криптографічний доказ. */
  attestedAt: string | null
}

export interface Dataset {
  datasetId: string
  owner: string
  ownerName: string
  title: string
  description: string
  source: DatasetSource
  records: number
  markers: number
  pricePer1k: number
  updatedAt: string
  collectedFrom: string
  collectedTo: string
  attestation: Attestation
  declaredStats: DeclaredStats
  consent: Consent | null
  ciphertextUploaded: boolean
  chain: ChainRecord
}

/** Детермінований генератор частот, щоб мок не «дихав» між рендерами. */
const alleleFrequencies = (seed: number, count: number): number[] => {
  const out: number[] = []
  let s = seed
  for (let i = 0; i < count; i += 1) {
    s = (s * 1103515245 + 12345) % 2147483648
    out.push(Math.round((0.03 + (s / 2147483648) * 0.45) * 1000) / 1000)
  }
  return out
}

/** Верхня межа для одного датасету: ceil(pricePer1k × records / 1000). */
export const datasetUpperBound = (pricePer1k: number, records: number): number =>
  Math.ceil((pricePer1k * records) / LIMITS.RECORDS_PER_PRICE_UNIT)

/**
 * Датасети — іменовані константи, а не елементи масиву за індексом.
 *
 * `noUncheckedIndexedAccess` дає `Dataset | undefined` на кожному зверненні
 * за індексом, і посилання на власника довелось би підпирати `!`, який у цьому
 * репозиторії заборонений. Іменована константа знімає питання разом з індексом: у моці й
 * так рівно шість датасетів, і кожен із них має ім'я.
 */
const NORDVEIL: Dataset = {
  datasetId: 'nordveil-exome-01',
  owner: '7Ndv1QpXm4Rk8fJ2sTbW3yLcHu9aZe6gVqDh5PrKm1Ao',
  ownerName: 'Nordveil Genomic Trust',
  title: 'Nordveil exome panel — cohort 01',
  description:
    'Synthetic exome-derived marker panel with phenotype labels, generated from a published allele-frequency model.',
  source: 'synthetic',
  records: 12000,
  markers: 50,
  pricePer1k: 4000000,
  updatedAt: '2026-08-19',
  collectedFrom: '2024-03-01',
  collectedTo: '2026-06-30',
  attestation: { attested: true, attestedAt: '2026-07-04' },
  declaredStats: {
    declaredBy: 'owner',
    verified: false,
    affectedRate: 0.34,
    meanAge: 58.2,
    alleleFrequencies: alleleFrequencies(11, 50),
  },
  consent: {
    version: 3,
    setAt: '2026-07-01',
    allowedUseTypes: ['rareDisease', 'populationGenetics', 'cardiology'],
    forbiddenUseTypes: ['pharmaCommercial'],
    buyerCategories: ['academic', 'nonProfit'],
    expiresAt: '2027-12-31',
    revoked: false,
    revokedAt: null,
  },
  ciphertextUploaded: true,
  chain: {
    state: 'registered',
    status: 'active',
    contentHash: '9f2c41ab7d3e5068bc19a4f7d2e8b05c6314ae9f70d2b8c541a63fe7920d4b18',
    version: 3,
    claimedRecords: 12000,
    pricePer1k: 4000000,
    registeredAt: '2026-07-01',
  },
}

const MERIDIAN: Dataset = {
  datasetId: 'meridian-cardio-04',
  owner: '9Fq3LcW2mHt7bXk4yPsZ1dRvNu8aTe5gJqDh6ZrBn3Cd',
  ownerName: 'Meridian Cohort Registry',
  title: 'Meridian cardiology cohort — wave 04',
  description:
    'Synthetic cardiology cohort with the same 50-marker schema and an affected/unaffected label.',
  source: 'synthetic',
  records: 8400,
  markers: 50,
  pricePer1k: 2500000,
  updatedAt: '2026-08-27',
  collectedFrom: '2025-01-15',
  collectedTo: '2026-07-31',
  attestation: { attested: false, attestedAt: null },
  declaredStats: {
    declaredBy: 'owner',
    verified: false,
    affectedRate: 0.34,
    meanAge: 58.2,
    alleleFrequencies: alleleFrequencies(29, 50),
  },
  consent: {
    version: 2,
    setAt: '2026-06-12',
    allowedUseTypes: ['cardiology', 'rareDisease', 'populationGenetics'],
    forbiddenUseTypes: [],
    buyerCategories: ['academic', 'nonProfit', 'government'],
    expiresAt: null,
    revoked: false,
    revokedAt: null,
  },
  ciphertextUploaded: true,
  chain: {
    state: 'registered',
    status: 'active',
    contentHash: '2b7d90e4c165af38017d5b92e6c4830fa1d75be2904c6f38b5127dae60f39c4a',
    version: 2,
    claimedRecords: 8400,
    pricePer1k: 2500000,
    registeredAt: '2026-06-12',
  },
}

const HALVARD: Dataset = {
  datasetId: 'halvard-rare-02',
  owner: '4Kd8ZrVn2sHb6yLc1mQt9fXk3uPaTe7gJwDh5NrSm2Ef',
  ownerName: 'Halvard Rare Disease Archive',
  title: 'Halvard rare-disease archive — set 02',
  description:
    'Small synthetic rare-disease set: enriched affected fraction, identical 50-marker schema.',
  source: 'synthetic',
  records: 3200,
  markers: 50,
  pricePer1k: 6000000,
  updatedAt: '2026-09-02',
  collectedFrom: '2023-09-01',
  collectedTo: '2026-08-15',
  attestation: { attested: true, attestedAt: '2026-08-21' },
  declaredStats: {
    declaredBy: 'owner',
    verified: false,
    affectedRate: 0.34,
    meanAge: 58.2,
    alleleFrequencies: alleleFrequencies(47, 50),
  },
  consent: {
    version: 1,
    setAt: '2026-08-20',
    allowedUseTypes: ['rareDisease', 'oncology'],
    forbiddenUseTypes: ['pharmaCommercial'],
    buyerCategories: ['academic', 'nonProfit'],
    expiresAt: '2028-06-30',
    revoked: false,
    revokedAt: null,
  },
  ciphertextUploaded: true,
  chain: {
    state: 'registered',
    status: 'active',
    contentHash: 'c40518fa9b2d76e3105c8ba4f92d7e61403bc95a8d27fe10b634a09d5127ce8b',
    version: 1,
    claimedRecords: 3200,
    pricePer1k: 6000000,
    registeredAt: '2026-08-20',
  },
}

const KELDAN: Dataset = {
  datasetId: 'keldan-pop-07',
  owner: '2Rb5NmZq7sHc3yTd9fXk1uPaLe8gJwVh6ZrKn4Bt1Gh',
  ownerName: 'Keldan Population Study',
  title: 'Keldan population panel — release 07',
  description:
    'Synthetic population-genetics panel. Consent was revoked by its owner, so the dataset cannot enter a run.',
  source: 'synthetic',
  records: 21500,
  markers: 50,
  pricePer1k: 1800000,
  updatedAt: '2026-07-30',
  collectedFrom: '2024-06-01',
  collectedTo: '2026-05-31',
  attestation: { attested: false, attestedAt: null },
  declaredStats: {
    declaredBy: 'owner',
    verified: false,
    affectedRate: 0.34,
    meanAge: 58.2,
    alleleFrequencies: alleleFrequencies(83, 50),
  },
  consent: {
    version: 4,
    setAt: '2026-04-02',
    allowedUseTypes: ['populationGenetics', 'rareDisease'],
    forbiddenUseTypes: ['pharmaCommercial'],
    buyerCategories: ['academic', 'government'],
    expiresAt: '2027-04-02',
    revoked: true,
    revokedAt: '2026-07-28',
  },
  ciphertextUploaded: true,
  chain: {
    state: 'registered',
    status: 'active',
    contentHash: '68af10d3927cb45e0f1a7d2b53c9e806714fda2b9c05e738a641bd2f90e7c531',
    version: 4,
    claimedRecords: 21500,
    pricePer1k: 1800000,
    registeredAt: '2026-04-02',
  },
}

const SUNDRY: Dataset = {
  datasetId: 'sundry-onco-11',
  owner: '6Wc2WmZr8sHd4yTe1fXk5uPaLb9gJqVh7ZrNn3Ct2Ij',
  ownerName: 'Sundry Oncology Collective',
  title: 'Sundry oncology collective — batch 11',
  description:
    'Synthetic oncology-adjacent marker set. Its consent allows cardiology and population genetics only.',
  source: 'synthetic',
  records: 6100,
  markers: 50,
  pricePer1k: 5200000,
  updatedAt: '2026-08-11',
  collectedFrom: '2025-02-01',
  collectedTo: '2026-06-15',
  attestation: { attested: false, attestedAt: null },
  declaredStats: {
    declaredBy: 'owner',
    verified: false,
    affectedRate: 0.34,
    meanAge: 58.2,
    alleleFrequencies: alleleFrequencies(101, 50),
  },
  consent: {
    version: 1,
    setAt: '2026-05-18',
    allowedUseTypes: ['cardiology', 'populationGenetics'],
    forbiddenUseTypes: [],
    buyerCategories: ['academic', 'nonProfit', 'commercial'],
    expiresAt: '2027-05-18',
    revoked: false,
    revokedAt: null,
  },
  ciphertextUploaded: true,
  chain: {
    state: 'registered',
    status: 'active',
    contentHash: 'a1c73e0925df4b6108e5a7c3b21d9f4076e2ba5c8d310fe947b5620ac3d18f7e',
    version: 1,
    claimedRecords: 6100,
    pricePer1k: 5200000,
    registeredAt: '2026-05-18',
  },
}

const VARDE: Dataset = {
  datasetId: 'varde-pilot-03',
  owner: '3Pt9NmZs5sHe2yTf7fXk8uPaLc1gJwVh4ZrBn6Dt5Kl',
  ownerName: 'Varde Pilot Biobank',
  title: 'Varde pilot biobank — pilot 03',
  description:
    'Synthetic pilot set. Registered on-chain, but the encrypted records were never uploaded to storage.',
  source: 'synthetic',
  records: 4800,
  markers: 50,
  pricePer1k: 3100000,
  updatedAt: '2026-06-24',
  collectedFrom: '2025-11-01',
  collectedTo: '2026-05-20',
  attestation: { attested: false, attestedAt: null },
  declaredStats: {
    declaredBy: 'owner',
    verified: false,
    affectedRate: 0.34,
    meanAge: 58.2,
    alleleFrequencies: alleleFrequencies(157, 50),
  },
  consent: {
    version: 1,
    setAt: '2026-06-20',
    allowedUseTypes: ['rareDisease', 'populationGenetics'],
    forbiddenUseTypes: ['pharmaCommercial'],
    buyerCategories: ['academic', 'nonProfit'],
    expiresAt: '2027-06-20',
    revoked: false,
    revokedAt: null,
  },
  ciphertextUploaded: false,
  chain: {
    state: 'registered',
    status: 'active',
    contentHash: '5d90ba173e2c48f6017ac5b29d3e6841079fbc25ad13e068b472a1c95d3f08e6',
    version: 1,
    claimedRecords: 4800,
    pricePer1k: 3100000,
    registeredAt: '2026-06-20',
  },
}

export const DATASETS: Dataset[] = [NORDVEIL, MERIDIAN, HALVARD, KELDAN, SUNDRY, VARDE]

export const findDataset = (owner: string, datasetId: string): Dataset | undefined =>
  DATASETS.find((d) => d.owner === owner && d.datasetId === datasetId)

export const datasetKey = (d: Pick<Dataset, 'owner' | 'datasetId'>): string =>
  `${d.owner}/${d.datasetId}`

/* ------------------------------------------------------------------ */
/* Recipes                                                             */
/* ------------------------------------------------------------------ */

export interface Recipe {
  id: number
  key: 'frequencies'
  name: string
  description: string
  maxMarkers: number
  minCohort: number
}

/** Рівно один рецепт: показувати нереалізовані — це ціна за прогін, якого не буде. */
export const FREQUENCIES_RECIPE: Recipe = {
  id: 1,
  key: 'frequencies',
  name: 'Allele frequencies and distributions',
  description:
    'Per-marker allele frequencies, sex split, an age histogram and the affected rate over the filtered cohort.',
  maxMarkers: 64,
  minCohort: 10,
}

export const RECIPES: Recipe[] = [FREQUENCIES_RECIPE]

/* ------------------------------------------------------------------ */
/* Run filters, quote                                                  */
/* ------------------------------------------------------------------ */

export interface RunFilters {
  minAge: number
  maxAge: number
  sex: SexFilter
  affected: AffectedFilter
}

interface QuoteRowBase {
  datasetId: string
  owner: string
  ownerName: string
  title: string
}

/**
 * Рядок квоти — союз, а не поле з `undefined`, як і `quoteLineSchema` у
 * `packages/shared`. Спільна форма з обома половинами дозволила б відповідь
 * «непридатний, але ось вартість», якої не буває, і екран мусив би підпирати
 * читання причини знаком оклику.
 */
export type QuoteRow =
  | (QuoteRowBase & {
      eligible: true
      pricePer1k: number
      claimedRecords: number
      upperBound: number
    })
  | (QuoteRowBase & { eligible: false; reason: IneligibleReason })

export interface Quote {
  recipeId: number
  useType: UseType
  buyerCategory: BuyerCategory
  filters: RunFilters
  rows: QuoteRow[]
  eligibleCount: number
  totalCount: number
  upperBound: number
  feeBps: number
  orderable: boolean
  blocker: OrderBlocker
}

export const MOCK_QUOTE_FILTERS: RunFilters = {
  minAge: 40,
  maxAge: 75,
  sex: 'any',
  affected: 'any',
}

export const MOCK_QUOTE: Quote = {
  recipeId: 1,
  useType: 'rareDisease',
  buyerCategory: 'academic',
  filters: MOCK_QUOTE_FILTERS,
  rows: [
    {
      datasetId: 'nordveil-exome-01',
      owner: NORDVEIL.owner,
      ownerName: 'Nordveil Genomic Trust',
      title: NORDVEIL.title,
      eligible: true,
      pricePer1k: 4000000,
      claimedRecords: 12000,
      upperBound: 48000000,
    },
    {
      datasetId: 'meridian-cardio-04',
      owner: MERIDIAN.owner,
      ownerName: 'Meridian Cohort Registry',
      title: MERIDIAN.title,
      eligible: true,
      pricePer1k: 2500000,
      claimedRecords: 8400,
      upperBound: 21000000,
    },
    {
      datasetId: 'halvard-rare-02',
      owner: HALVARD.owner,
      ownerName: 'Halvard Rare Disease Archive',
      title: HALVARD.title,
      eligible: true,
      pricePer1k: 6000000,
      claimedRecords: 3200,
      upperBound: 19200000,
    },
    {
      datasetId: 'keldan-pop-07',
      owner: KELDAN.owner,
      ownerName: 'Keldan Population Study',
      title: KELDAN.title,
      eligible: false,
      reason: 'revoked',
    },
    {
      datasetId: 'sundry-onco-11',
      owner: SUNDRY.owner,
      ownerName: 'Sundry Oncology Collective',
      title: SUNDRY.title,
      eligible: false,
      reason: 'use-not-allowed',
    },
    {
      datasetId: 'varde-pilot-03',
      owner: VARDE.owner,
      ownerName: 'Varde Pilot Biobank',
      title: VARDE.title,
      eligible: false,
      reason: 'ciphertext-missing',
    },
  ],
  eligibleCount: 3,
  totalCount: 6,
  upperBound: 88200000,
  feeBps: 700,
  orderable: true,
  blocker: null,
}

/* ------------------------------------------------------------------ */
/* Runs                                                               */
/* ------------------------------------------------------------------ */

export interface AgeBucket {
  from: number
  to: number
  count: number
}

/** Звіт — це агрегати. Жодного subjectId. */
export interface RunReport {
  cohortSize: number
  alleleFrequencies: number[]
  sexDistribution: { female: number; male: number }
  ageHistogram: AgeBucket[]
  affectedRate: number
}

export interface SettlementRow {
  datasetId: string
  owner: string
  ownerName: string
  recordsIncluded: number
  charged: number
  fee: number
  toOwner: number
}

export interface Settlement {
  cohortSize: number
  rows: SettlementRow[]
  totalCharged: number
  totalFee: number
  totalToOwners: number
  refunded: number
}

export interface RunTransaction {
  label: string
  signature: string
}

export interface Run {
  runId: string
  status: RunStatus
  createdAt: string
  recipeId: number
  useType: UseType
  buyerCategory: BuyerCategory
  filters: RunFilters
  datasets: { datasetId: string; owner: string; ownerName: string }[]
  upperBound: number
  feeBps: number
  progress?: { batch: number; batches: number }
  report?: RunReport
  settlement?: Settlement
  failure?: ApiError['error']
  transactions: RunTransaction[]
}

const RUN_POOL = [
  { datasetId: 'nordveil-exome-01', owner: NORDVEIL.owner, ownerName: 'Nordveil Genomic Trust' },
  {
    datasetId: 'meridian-cardio-04',
    owner: MERIDIAN.owner,
    ownerName: 'Meridian Cohort Registry',
  },
  {
    datasetId: 'halvard-rare-02',
    owner: HALVARD.owner,
    ownerName: 'Halvard Rare Disease Archive',
  },
]

export const MOCK_RUN_REPORT: RunReport = {
  cohortSize: 14230,
  alleleFrequencies: alleleFrequencies(211, 50),
  sexDistribution: { female: 7412, male: 6818 },
  ageHistogram: [
    { from: 40, to: 45, count: 2105 },
    { from: 45, to: 50, count: 2470 },
    { from: 50, to: 55, count: 2398 },
    { from: 55, to: 60, count: 2251 },
    { from: 60, to: 65, count: 1988 },
    { from: 65, to: 70, count: 1624 },
    { from: 70, to: 75, count: 1394 },
  ],
  affectedRate: 0.31,
}

export const MOCK_SETTLEMENT: Settlement = {
  cohortSize: 14230,
  rows: [
    {
      datasetId: 'nordveil-exome-01',
      owner: NORDVEIL.owner,
      ownerName: 'Nordveil Genomic Trust',
      recordsIncluded: 7340,
      charged: 29360000,
      fee: 2055200,
      toOwner: 27304800,
    },
    {
      datasetId: 'meridian-cardio-04',
      owner: MERIDIAN.owner,
      ownerName: 'Meridian Cohort Registry',
      recordsIncluded: 5010,
      charged: 12525000,
      fee: 876750,
      toOwner: 11648250,
    },
    {
      datasetId: 'halvard-rare-02',
      owner: HALVARD.owner,
      ownerName: 'Halvard Rare Disease Archive',
      recordsIncluded: 1880,
      charged: 11280000,
      fee: 789600,
      toOwner: 10490400,
    },
  ],
  totalCharged: 53165000,
  totalFee: 3721550,
  totalToOwners: 49443450,
  refunded: 35035000,
}

const runBase = {
  createdAt: '2026-09-05T09:41:00Z',
  recipeId: 1,
  useType: 'rareDisease' as UseType,
  buyerCategory: 'academic' as BuyerCategory,
  filters: MOCK_QUOTE_FILTERS,
  datasets: RUN_POOL,
  upperBound: 88200000,
  feeBps: 700,
}

export const RUNS: Record<RunStatus, Run> = {
  accepted: {
    ...runBase,
    runId: 'run-4f81ca',
    status: 'accepted',
    transactions: [
      { label: 'Escrow locked', signature: '3kQ8bYr1t7fLm2Wd9ZpXaHc6uNvEjS4gTb5RyKn8DwQm' },
    ],
  },
  running: {
    ...runBase,
    runId: 'run-4f81ca',
    status: 'running',
    progress: { batch: 41, batches: 313 },
    transactions: [
      { label: 'Escrow locked', signature: '3kQ8bYr1t7fLm2Wd9ZpXaHc6uNvEjS4gTb5RyKn8DwQm' },
      { label: 'Computation published', signature: '8Rm3dLw5Zc2Xt9bKq1PaHn6uYvEjS7gTb4RyFn2DwPl' },
    ],
  },
  completed: {
    ...runBase,
    runId: 'run-4f81ca',
    status: 'completed',
    report: MOCK_RUN_REPORT,
    settlement: MOCK_SETTLEMENT,
    transactions: [
      { label: 'Escrow locked', signature: '3kQ8bYr1t7fLm2Wd9ZpXaHc6uNvEjS4gTb5RyKn8DwQm' },
      { label: 'Computation published', signature: '8Rm3dLw5Zc2Xt9bKq1PaHn6uYvEjS7gTb4RyFn2DwPl' },
      { label: 'Settlement', signature: '5Yt7nQc3Zb8Xm1dKw9PaLn2uRvEjS6gTb3RyHn4DwZk' },
    ],
  },
  rejected: {
    ...runBase,
    runId: 'run-90b2ef',
    status: 'rejected',
    failure: {
      code: 'CONSENT_VIOLATION',
      message: 'Consent for one dataset in the pool changed between the quote and the order.',
      details: { datasetId: 'keldan-pop-07', reason: 'revoked' },
    },
    transactions: [],
  },
  failed: {
    ...runBase,
    runId: 'run-27dd10',
    status: 'failed',
    failure: {
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'The MPC cluster stopped responding at batch 41 of 313. Nothing was computed.',
      details: { batch: 41, batches: 313 },
    },
    transactions: [
      { label: 'Escrow locked', signature: '3kQ8bYr1t7fLm2Wd9ZpXaHc6uNvEjS4gTb5RyKn8DwQm' },
      { label: 'Deposit returned', signature: '7Wp2cKq8Zn5Xt3dLm1PaHb6uYvEjS9gTb2RyFn7DwRj' },
    ],
  },
}

export const RUN_STATUS_ORDER: RunStatus[] = [
  'accepted',
  'running',
  'completed',
  'failed',
  'rejected',
]

/* ------------------------------------------------------------------ */
/* Balance and payouts (data-owner view: Nordveil Genomic Trust)        */
/* ------------------------------------------------------------------ */

export interface PayoutRow {
  runId: string
  date: string
  recipeId: number
  useType: UseType
  datasetId: string
  /** Обидва числа, з яких обчислена частка (FR-018). */
  recordsIncluded: number
  cohortSize: number
  pricePer1k: number
  /** Очікуване за правилом розподілу. */
  expectedGross: number
  /** Фактично нараховане: менше за очікуване, якщо стеля escrow. */
  paidGross: number
  fee: number
  net: number
  escrowCapped: boolean
  belowContributionFloor: boolean
}

export interface OwnerBalance {
  owner: string
  ownerName: string
  available: number
  totalEarned: number
  totalWithdrawn: number
  payouts: PayoutRow[]
}

export const OWNER_BALANCE: OwnerBalance = {
  owner: NORDVEIL.owner,
  ownerName: 'Nordveil Genomic Trust',
  available: 34717800,
  totalEarned: 49717800,
  totalWithdrawn: 15000000,
  payouts: [
    {
      runId: 'run-4f81ca',
      date: '2026-09-05',
      recipeId: 1,
      useType: 'rareDisease',
      datasetId: 'nordveil-exome-01',
      recordsIncluded: 7340,
      cohortSize: 14230,
      pricePer1k: 4000000,
      expectedGross: 29360000,
      paidGross: 29360000,
      fee: 2055200,
      net: 27304800,
      escrowCapped: false,
      belowContributionFloor: false,
    },
    {
      runId: 'run-1c77b0',
      date: '2026-08-22',
      recipeId: 1,
      useType: 'populationGenetics',
      datasetId: 'nordveil-exome-01',
      recordsIncluded: 7340,
      cohortSize: 15900,
      pricePer1k: 4000000,
      expectedGross: 29360000,
      paidGross: 24100000,
      fee: 1687000,
      net: 22413000,
      escrowCapped: true,
      belowContributionFloor: false,
    },
    {
      runId: 'run-0ab349',
      date: '2026-08-09',
      recipeId: 1,
      useType: 'cardiology',
      datasetId: 'nordveil-exome-01',
      recordsIncluded: 6,
      cohortSize: 11020,
      pricePer1k: 4000000,
      expectedGross: 0,
      paidGross: 0,
      fee: 0,
      net: 0,
      escrowCapped: false,
      belowContributionFloor: true,
    },
  ],
}

/** Порожній баланс: власник ще не брав участі в жодному прогоні. */
export const EMPTY_OWNER_BALANCE: OwnerBalance = {
  owner: NORDVEIL.owner,
  ownerName: 'Nordveil Genomic Trust',
  available: 0,
  totalEarned: 0,
  totalWithdrawn: 0,
  payouts: [],
}

/* ------------------------------------------------------------------ */
/* Mock session                                                        */
/* ------------------------------------------------------------------ */

export type Role = 'owner' | 'buyer'

export const MOCK_SESSION = {
  address: NORDVEIL.owner,
  email: 'lab@nordveil.example',
  method: 'wallet' as 'wallet' | 'email',
}
