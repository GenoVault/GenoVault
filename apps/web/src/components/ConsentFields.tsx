import type { BuyerCategoryName, SetConsentRequest, UseTypeName } from '@genovault/shared'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { type ConsentTerms, dateToExpirySeconds } from '@/lib/consentTerms'
import { BUYER_CATEGORY_LABEL, consentSentence, USE_TYPE_LABEL } from '@/lib/format'
import { BUYER_CATEGORIES, USE_TYPES } from '@/mockData'

/**
 * The consent an owner is about to sign — one form for registration and for a
 * new version on the dataset card (`T066a`), so both say the same thing and
 * refuse the same mistakes.
 */
export interface ConsentDraft {
  allowedUses: UseTypeName[]
  forbiddenUses: UseTypeName[]
  buyerCategories: BuyerCategoryName[]
  noExpiry: boolean
  /** ISO date, as the date input holds it. */
  expiresAt: string
}

export const EMPTY_CONSENT: ConsentDraft = {
  allowedUses: [],
  forbiddenUses: [],
  buyerCategories: [],
  noExpiry: false,
  expiresAt: '',
}

/** A draft that starts from the consent in force — the owner changes, not retypes. */
export function draftFromTerms(terms: ConsentTerms): ConsentDraft {
  return {
    allowedUses: [...terms.allowedUses],
    forbiddenUses: [...terms.forbiddenUses],
    buyerCategories: [...terms.buyerCategories],
    noExpiry: terms.expiresAt === null,
    expiresAt: terms.expiresAt ?? '',
  }
}

export type ConsentDraftErrors = Partial<Record<keyof ConsentDraft, string>>

/**
 * Stricter than the program on purpose in one place: a use both allowed and
 * forbidden is refused here, while the program only refuses a consent that
 * ends up allowing nothing. The owner who ticks both has made a mistake, not a
 * choice.
 */
export function consentDraftErrors(draft: ConsentDraft, today: string): ConsentDraftErrors {
  const e: ConsentDraftErrors = {}
  if (draft.allowedUses.length === 0)
    e.allowedUses = 'Pick at least one, or the dataset can never enter a run.'
  if (draft.buyerCategories.length === 0) e.buyerCategories = 'Pick at least one buyer category.'
  if (!draft.noExpiry && draft.expiresAt === '') e.expiresAt = 'A date, or tick “no expiry”.'
  else if (!draft.noExpiry && draft.expiresAt < today)
    e.expiresAt = 'The expiry is already in the past.'
  const overlap = draft.allowedUses.filter((u) => draft.forbiddenUses.includes(u))
  if (overlap.length > 0)
    e.forbiddenUses = `${overlap
      .map((u) => USE_TYPE_LABEL[u])
      .join(', ')} cannot be allowed and forbidden at once.`
  return e
}

export function draftToTerms(draft: ConsentDraft): ConsentTerms {
  return {
    allowedUses: draft.allowedUses,
    forbiddenUses: draft.forbiddenUses,
    buyerCategories: draft.buyerCategories,
    expiresAt: draft.noExpiry ? null : draft.expiresAt || null,
    revoked: false,
  }
}

/** The body of `POST /datasets/:id/consent`: names, expiry at the end of the chosen day. */
export function draftToRequest(draft: ConsentDraft): SetConsentRequest {
  return {
    allowedUses: draft.allowedUses,
    forbiddenUses: draft.forbiddenUses,
    buyerCategories: draft.buyerCategories,
    expiresAt:
      draft.noExpiry || draft.expiresAt === '' ? null : dateToExpirySeconds(draft.expiresAt),
  }
}

export const FieldError = ({ children }: { children?: string | undefined }) =>
  children ? <p className="mt-1 text-[12px] text-destructive">{children}</p> : null

export const CheckList = <T extends string>({
  options,
  value,
  onChange,
  label: labelOf,
  idPrefix,
}: {
  options: readonly T[]
  value: T[]
  onChange: (next: T[]) => void
  label: (v: T) => string
  idPrefix: string
}) => (
  <div className="flex flex-col gap-2">
    {options.map((opt) => {
      const id = `${idPrefix}-${opt}`
      const checked = value.includes(opt)
      return (
        <label key={opt} htmlFor={id} className="flex items-center gap-2 text-[13.5px]">
          <Checkbox
            id={id}
            checked={checked}
            onCheckedChange={() =>
              onChange(checked ? value.filter((v) => v !== opt) : [...value, opt])
            }
          />
          {labelOf(opt)}
        </label>
      )
    })}
  </div>
)

export const ConsentFields = ({
  draft,
  onChange,
  errors,
  idPrefix,
}: {
  draft: ConsentDraft
  onChange: (next: ConsentDraft) => void
  /** `undefined` — errors are not shown yet. */
  errors: ConsentDraftErrors | undefined
  idPrefix: string
}) => {
  const set = <K extends keyof ConsentDraft>(key: K, value: ConsentDraft[K]) =>
    onChange({ ...draft, [key]: value })

  return (
    <>
      <div className="grid gap-6 md:grid-cols-3">
        <div>
          <span className="label-tiny mb-2 block">Allowed use types</span>
          <CheckList
            idPrefix={`${idPrefix}-allow`}
            options={USE_TYPES}
            value={draft.allowedUses}
            onChange={(v) => set('allowedUses', v)}
            label={(u) => USE_TYPE_LABEL[u]}
          />
          <FieldError>{errors?.allowedUses}</FieldError>
        </div>
        <div>
          <span className="label-tiny mb-2 block">Forbidden purposes</span>
          <CheckList
            idPrefix={`${idPrefix}-forbid`}
            options={USE_TYPES}
            value={draft.forbiddenUses}
            onChange={(v) => set('forbiddenUses', v)}
            label={(u) => USE_TYPE_LABEL[u]}
          />
          <FieldError>{errors?.forbiddenUses}</FieldError>
        </div>
        <div>
          <span className="label-tiny mb-2 block">Buyer categories</span>
          <CheckList
            idPrefix={`${idPrefix}-buyer`}
            options={BUYER_CATEGORIES}
            value={draft.buyerCategories}
            onChange={(v) => set('buyerCategories', v)}
            label={(c) => BUYER_CATEGORY_LABEL[c]}
          />
          <FieldError>{errors?.buyerCategories}</FieldError>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={`${idPrefix}-expiry`} className="label-tiny mb-1 block">
            Expiry
          </label>
          <Input
            id={`${idPrefix}-expiry`}
            type="date"
            value={draft.expiresAt}
            disabled={draft.noExpiry}
            onChange={(e) => set('expiresAt', e.target.value)}
            className="num w-48"
          />
        </div>
        <label
          htmlFor={`${idPrefix}-noExpiry`}
          className="flex items-center gap-2 pb-2.5 text-[13.5px]"
        >
          <Checkbox
            id={`${idPrefix}-noExpiry`}
            checked={draft.noExpiry}
            onCheckedChange={(v) => set('noExpiry', Boolean(v))}
          />
          No expiry
        </label>
      </div>
      <FieldError>{errors?.expiresAt}</FieldError>

      <p className="mt-5 rounded border border-border bg-surface-sunken/60 p-3 text-[13.5px] leading-6">
        {consentSentence(draftToTerms(draft))}
      </p>
    </>
  )
}
