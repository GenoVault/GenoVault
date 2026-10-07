import {
  type BuyerCategoryName,
  type ConsentView,
  namedCategories,
  namedUses,
  type UseTypeName,
} from '@genovault/shared'

/**
 * A consent the way a person reads it: names, not bit masks (`T065`).
 *
 * The chain stores masks and the API hands them over as they are
 * (`consentViewSchema`); the screens read names. The translation lives in one
 * place so the catalog card, the registration preview and the owner's consent
 * form all say the same thing about the same consent.
 */
export interface ConsentTerms {
  allowedUses: UseTypeName[]
  forbiddenUses: UseTypeName[]
  buyerCategories: BuyerCategoryName[]
  /** ISO date; `null` — no expiry. */
  expiresAt: string | null
  revoked: boolean
}

/**
 * Expiry in Unix seconds → the last ISO date on which the consent still holds.
 *
 * The inverse of `dateToExpirySeconds`: the second **before** expiry decides
 * the day, so an owner who chose "until 31 December" reads 31 December back.
 */
export function expiryToDate(seconds: string): string {
  return new Date((Number(seconds) - 1) * 1000).toISOString().slice(0, 10)
}

/**
 * An ISO date → Unix seconds at the **end** of that day, UTC.
 *
 * The end and not the start: an owner who picks "until 31 December" means the
 * 31st is still inside. The program compares `now < expires_at`, so the first
 * second of the next day is the first moment the consent no longer holds.
 */
export function dateToExpirySeconds(date: string): string {
  return String(Date.parse(`${date}T00:00:00Z`) / 1000 + 86_400)
}

export function termsFromView(view: ConsentView): ConsentTerms {
  return {
    allowedUses: namedUses(view.allowedUses),
    forbiddenUses: namedUses(view.forbiddenUses),
    buyerCategories: namedCategories(view.buyerCategories),
    expiresAt: view.expiresAt === null ? null : expiryToDate(view.expiresAt),
    revoked: view.revoked,
  }
}
