import { z } from 'zod'

/**
 * Словник типів використання і категорій покупця (`FR-005`, `FR-008`).
 *
 * Числа тут — **дзеркало** `programs/genovault/src/state/consent.rs`, і воно
 * звіряється з текстом програми тестом, а не уважністю. Вивести їх з IDL не
 * можна: це константи модуля, а не поля акаунта, тож в IDL їх немає.
 *
 * Розходження цих двох місць коштувало б дорожче за звичайну помилку. Згода
 * зберігається ончейн бітмаскою, і зсунутий на одиницю біт не падає ніде: він
 * тихо перетворює «онкологія» на «кардіологія» і віддає дані на ціль, якої
 * власник не дозволяв.
 *
 * Чому взагалі бітмаска, а не перелік рядків: перевірка згоди виконується
 * усередині програми (`Consent::check`), де є `u32` і немає ані рядків, ані
 * купи. Назви живуть тут, на межі з людиною.
 */

/** Тип використання — те, **навіщо** покупець рахує (`use_type::*`). */
export const USE_TYPES = {
  oncology: 1 << 0,
  cardiology: 1 << 1,
  rareDisease: 1 << 2,
  populationGenetics: 1 << 3,
  pharmaCommercial: 1 << 4,
} as const

export type UseTypeName = keyof typeof USE_TYPES

export const USE_TYPE_NAMES = Object.keys(USE_TYPES) as [UseTypeName, ...UseTypeName[]]

/** Категорія покупця — **хто** рахує (`buyer_category::*`). */
export const BUYER_CATEGORIES = {
  academic: 1 << 0,
  nonProfit: 1 << 1,
  commercial: 1 << 2,
  government: 1 << 3,
} as const

export type BuyerCategoryName = keyof typeof BUYER_CATEGORIES

export const BUYER_CATEGORY_NAMES = Object.keys(BUYER_CATEGORIES) as [
  BuyerCategoryName,
  ...BuyerCategoryName[],
]

/** Об'єднання всіх відомих бітів — те саме, що `use_type::ALL` у програмі. */
export const USE_TYPE_ALL = Object.values(USE_TYPES).reduce((mask, bit) => mask | bit, 0)

export const BUYER_CATEGORY_ALL = Object.values(BUYER_CATEGORIES).reduce(
  (mask, bit) => mask | bit,
  0,
)

/**
 * На межі API їздить **назва**, а не бітмаска.
 *
 * Програма приймає `u32` з рівно одним встановленим бітом (`count_ones() == 1`),
 * і назва — єдиний спосіб не дати клієнту надіслати два біти або біт, якого
 * немає в словнику. Переклад в один бік робить `useTypeBit`; зворотного тут
 * немає навмисно: маска згоди має кілька бітів і читається `namedUses`.
 */
export const useTypeSchema = z.enum(USE_TYPE_NAMES)

export const buyerCategorySchema = z.enum(BUYER_CATEGORY_NAMES)

export function useTypeBit(name: UseTypeName): number {
  return USE_TYPES[name]
}

export function buyerCategoryBit(name: BuyerCategoryName): number {
  return BUYER_CATEGORIES[name]
}

/** Розкладає маску згоди на назви. Невідомі біти пропускаються мовчки — вони
 *  з новішої версії програми, і назви для них у цієї збірки немає. */
export function namedUses(mask: number): UseTypeName[] {
  return USE_TYPE_NAMES.filter((name) => (mask & USE_TYPES[name]) !== 0)
}

export function namedCategories(mask: number): BuyerCategoryName[] {
  return BUYER_CATEGORY_NAMES.filter((name) => (mask & BUYER_CATEGORIES[name]) !== 0)
}

/**
 * Причини відмови — рівно ті, що розрізняє програма (`FR-008`).
 *
 * «Прямо заборонено» і «не дозволено» — різні рядки, бо це різні рішення
 * власника: перше він ухвалив свідомо, друге просто не ухвалював. Власник має
 * право знати, яке з них спрацювало, і покупець теж — інакше він пише листа не
 * про те.
 */
export const CONSENT_VIOLATIONS = [
  'no-consent',
  'revoked',
  'expired',
  'use-forbidden',
  'use-not-allowed',
  'category-not-allowed',
] as const

export type ConsentViolation = (typeof CONSENT_VIOLATIONS)[number]

export interface ConsentState {
  allowedUses: number
  forbiddenUses: number
  buyerCategories: number
  /** Секунди Unix; `null` — без строку. */
  expiresAt: bigint | null
  revoked: boolean
}

export interface ConsentRequest {
  useType: UseTypeName
  buyerCategory: BuyerCategoryName
  /** Секунди Unix. Час ланцюга, не годинник сервера — див. коментар нижче. */
  now: bigint
}

/**
 * Перевірка згоди — дзеркало `Consent::check`, у тому самому порядку.
 *
 * Порядок визначає, яку саме причину побачить покупець, і тому він не
 * випадковий: спершу те, що стосується згоди цілком (відкликання, строк),
 * потім те, що стосується конкретного замовлення. На відкликаній згоді
 * покупець інакше читав би «тип не дозволений» і шукав би проблему не там.
 *
 * **Ця функція нічого не вирішує.** Вирішує програма — і саме вона поставить
 * `Run` у `rejected`, хай що відповість API (`FR-006`). Тут вона потрібна, щоб
 * покупець дізнався про відмову до того, як заблокує депозит, а не після
 * (`SC-010`). Розбіжність двох відповідей можлива й нормальна: `now` тут — час,
 * який передав викликач, а програма бере час ланцюга.
 */
export function checkConsent(
  consent: ConsentState | null,
  request: ConsentRequest,
): ConsentViolation | null {
  if (consent === null) return 'no-consent'
  if (consent.revoked) return 'revoked'
  if (consent.expiresAt !== null && request.now >= consent.expiresAt) return 'expired'

  const use = USE_TYPES[request.useType]
  const category = BUYER_CATEGORIES[request.buyerCategory]

  if ((consent.forbiddenUses & use) !== 0) return 'use-forbidden'
  if ((consent.allowedUses & use) === 0) return 'use-not-allowed'
  if ((consent.buyerCategories & category) === 0) return 'category-not-allowed'
  return null
}

/** Що насправді дозволено після врахування заборон — `Consent::effective_uses`. */
export function effectiveUses(consent: ConsentState): number {
  return consent.allowedUses & ~consent.forbiddenUses
}
