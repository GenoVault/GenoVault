/**
 * Оцінка прогону на мок-даних. Порядок перевірок має значення:
 * спершу ланцюг і байти, потім згода, потім використання і категорія покупця.
 */

import type { BuyerCategory, Dataset, IneligibleReason, UseType } from '@/mockData'

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
