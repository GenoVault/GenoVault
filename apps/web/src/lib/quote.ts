/**
 * Оцінка прогону на мок-даних. Порядок перевірок має значення:
 * спершу ланцюг і байти, потім згода, потім використання і категорія покупця.
 */

import {
  type BuyerCategory,
  type Dataset,
  datasetUpperBound,
  type IneligibleReason,
  LIMITS,
  type OrderBlocker,
  type Quote,
  type QuoteRow,
  type RunFilters,
  type UseType,
} from '@/mockData'

const TODAY = '2026-09-07'

export const ineligibleReason = (
  dataset: Dataset,
  useType: UseType,
  buyerCategory: BuyerCategory,
): IneligibleReason | null => {
  if (dataset.chain.state !== 'registered') return 'unregistered'
  if (dataset.chain.status === 'retired') return 'retired'
  if (!dataset.ciphertextUploaded) return 'ciphertext-missing'

  const consent = dataset.consent
  if (!consent) return 'no-consent'
  if (consent.revoked) return 'revoked'
  if (consent.expiresAt && consent.expiresAt < TODAY) return 'expired'
  if (consent.forbiddenUseTypes.includes(useType)) return 'use-forbidden'
  if (!consent.allowedUseTypes.includes(useType)) return 'use-not-allowed'
  if (!consent.buyerCategories.includes(buyerCategory)) return 'category-not-allowed'
  return null
}

export const buildQuote = (
  datasets: Dataset[],
  useType: UseType,
  buyerCategory: BuyerCategory,
  filters: RunFilters,
  platformPaused = false,
): Quote => {
  const rows: QuoteRow[] = datasets.map((d) => {
    const reason = ineligibleReason(d, useType, buyerCategory)
    if (reason) {
      return {
        datasetId: d.datasetId,
        owner: d.owner,
        ownerName: d.ownerName,
        title: d.title,
        eligible: false,
        reason,
      }
    }
    const claimedRecords = d.chain.state === 'registered' ? d.chain.claimedRecords : d.records
    const pricePer1k = d.chain.state === 'registered' ? d.chain.pricePer1k : d.pricePer1k
    return {
      datasetId: d.datasetId,
      owner: d.owner,
      ownerName: d.ownerName,
      title: d.title,
      eligible: true,
      pricePer1k,
      claimedRecords,
      upperBound: datasetUpperBound(pricePer1k, claimedRecords),
    }
  })

  const eligible = rows.filter((r) => r.eligible)
  const upperBound = eligible.reduce((sum, r) => sum + (r.upperBound ?? 0), 0)

  const blocker: OrderBlocker = platformPaused
    ? 'platform-paused'
    : eligible.length === 0
      ? 'no-eligible-datasets'
      : null

  return {
    recipeId: 1,
    useType,
    buyerCategory,
    filters,
    rows,
    eligibleCount: eligible.length,
    totalCount: rows.length,
    upperBound,
    feeBps: LIMITS.FEE_BPS,
    orderable: blocker === null,
    blocker,
  }
}
