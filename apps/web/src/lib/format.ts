/** Форматування та людські підписи для словників. Жодного числа без походження. */

import type {
  BuyerCategory,
  Consent,
  DatasetSource,
  IneligibleReason,
  OrderBlocker,
  RunStatus,
  UseType,
} from '@/mockData'
import { ENCRYPTION, STABLE_MINT } from '@/mockData'

/* --- addresses / hashes --- */

export const truncateMiddle = (value: string, head = 4, tail = 4): string =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`

export const MINT_SHORT = truncateMiddle(STABLE_MINT.address, 3, 4)

/* --- numbers --- */

export const formatInt = (value: number): string => value.toLocaleString('en-US')

/** Базові одиниці → два знаки після коми, з округленням угору від .005. */
export const formatAmount = (baseUnits: number): string => {
  const cents = Math.round(baseUnits / 10 ** (STABLE_MINT.decimals - 2))
  return (cents / 100).toFixed(2)
}

/** Повне значення — у тултипі, щоб на екрані не було «загубленої» дрібнички. */
export const amountTitle = (baseUnits: number): string =>
  `${formatInt(baseUnits)} base units · ${STABLE_MINT.decimals} decimals · mint ${STABLE_MINT.address}`

export const formatBps = (bps: number): string => `${(bps / 100).toFixed(2)}%`

export const formatRate = (rate: number): string => `${(rate * 100).toFixed(1)}%`

export const formatBytes = (bytes: number): string => {
  const mib = bytes / (1024 * 1024)
  if (mib >= 1) return `${mib.toFixed(1)} MiB`
  return `${Math.max(1, Math.round(bytes / 1024))} KiB`
}

export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  const rest = s % 60
  if (m === 0) return `${rest} s`
  return `${m} min ${String(rest).padStart(2, '0')} s`
}

export const formatDate = (iso: string | null): string => {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

export const formatDateTime = (iso: string): string => iso.replace('T', ' ').replace('Z', ' UTC')

/* --- vocabularies --- */

export const SOURCE_LABEL: Record<DatasetSource, string> = {
  clinic: 'Clinic',
  biobank: 'Biobank',
  individual: 'Individual',
  synthetic: 'Synthetic',
}

export const USE_TYPE_LABEL: Record<UseType, string> = {
  oncology: 'Oncology',
  cardiology: 'Cardiology',
  rareDisease: 'Rare disease',
  populationGenetics: 'Population genetics',
  pharmaCommercial: 'Pharma, commercial',
}

export const BUYER_CATEGORY_LABEL: Record<BuyerCategory, string> = {
  academic: 'Academic',
  nonProfit: 'Non-profit',
  commercial: 'Commercial',
  government: 'Government',
}

export const REASON_TEXT: Record<IneligibleReason, string> = {
  unregistered: 'Not registered on-chain yet',
  retired: 'Retired by its owner',
  'ciphertext-missing': 'Encrypted data has not been uploaded',
  'no-consent': 'No consent has been set',
  revoked: 'Consent was revoked',
  expired: 'Consent expired',
  'use-forbidden': 'The owner explicitly forbids this use type',
  'use-not-allowed': 'This use type is not among the allowed ones',
  'category-not-allowed': 'This buyer category is not allowed',
}

export const BLOCKER_TEXT: Record<Exclude<OrderBlocker, null>, string> = {
  'platform-paused': 'The platform is paused',
  'no-eligible-datasets': 'No dataset in this pool can be computed',
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  accepted: 'Accepted',
  running: 'Running',
  completed: 'Completed',
  rejected: 'Rejected',
  failed: 'Failed',
}

/* --- consent in plain language --- */

const joinNames = (names: string[]): string => {
  const last = names[names.length - 1]
  if (last === undefined) return 'no one'
  if (names.length === 1) return last
  return `${names.slice(0, -1).join(', ')} or ${last}`
}

/** Власник має прочитати те, що підписує, а не бітову маску. */
export const consentSentence = (consent: Consent | null): string => {
  if (!consent) return 'No consent has been set, so this dataset cannot enter any run.'
  if (consent.revoked) {
    return `Consent was revoked on ${formatDate(consent.revokedAt)}. No run can include this dataset.`
  }
  const buyers = joinNames(
    consent.buyerCategories.map((c) => BUYER_CATEGORY_LABEL[c].toLowerCase()),
  )
  const uses = joinNames(consent.allowedUseTypes.map((u) => USE_TYPE_LABEL[u].toLowerCase()))
  const until = consent.expiresAt ? `until ${formatDate(consent.expiresAt)}` : 'with no expiry'
  const forbidden =
    consent.forbiddenUseTypes.length > 0
      ? ` ${joinNames(
          consent.forbiddenUseTypes.map((u) => USE_TYPE_LABEL[u]),
        )} is explicitly forbidden.`
      : ''
  return `Any ${buyers} buyer may run ${uses} computations on this dataset ${until}.${forbidden}`
}

/* --- encryption estimate (measured: 1183 µs per field element) --- */

export interface EncryptionEstimate {
  elements: number
  seconds: number
  bytes: number
}

export const estimateEncryption = (
  records: number,
  fieldsPerRecord: number,
): EncryptionEstimate => {
  const elements = Math.max(0, Math.round(records * fieldsPerRecord))
  return {
    elements,
    seconds: (elements * ENCRYPTION.microsecondsPerElement) / 1_000_000,
    bytes: elements * ENCRYPTION.bytesPerElement,
  }
}
