import { z } from 'zod'
import { buyerCategorySchema, CONSENT_VIOLATIONS, useTypeSchema } from './consent.ts'
import {
  datasetIdSchema,
  type PricePer1k,
  solanaAddressSchema,
  type TokenAmount,
  tokenAmountSchema,
  u64StringSchema,
} from './primitives.ts'
import { recipeIdSchema } from './recipes.ts'

/**
 * Верхня оцінка вартості прогону (`FR-015`, `FR-015a`).
 *
 * Точна вартість відома лише всередині конфіденційного шару: скільки записів
 * пройде фільтри рецепта, рахує MPC разом із самим прогоном (`FR-018a`), і
 * дізнатися це наперед означало б уміти рахувати те саме зовні — тобто мати
 * дані. Тому до замовлення показується межа за **заявленими** обсягами, у
 * депозит блокується саме вона, а різниця повертається покупцю (`FR-016`).
 */

/** Ціна оголошується за 1000 записів (`FR-015`). */
export const RECORDS_PER_PRICE_UNIT = 1000n

const U64_MAX = 0xffff_ffff_ffff_ffffn

/**
 * Скільки датасетів вміщає один прогін — дзеркало `MAX_RUN_DATASETS` у
 * `programs/genovault/src/state/run.rs`, звірене тестом. Довший список програма
 * не прийме, і дізнатись про це після заповнення форми — гірше, ніж на межі.
 */
export const MAX_RUN_DATASETS = 50

/**
 * Квота, що не вміщається в `u64`.
 *
 * Депозит — це `u64` ончейн, тож пул, чия межа туди не влазить, замовити
 * неможливо. Тиха обрізка тут була б найгіршим варіантом: покупець побачив би
 * маленьке число й заблокував би його, а програма порахувала б своє.
 */
export class QuoteOverflowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QuoteOverflowError'
  }
}

/**
 * Межа для одного датасету — `ціна × заявлені записи / 1000`, **із заокругленням
 * угору**.
 *
 * Угору, бо це межа, і вона мусить лишатися межею після заокруглення в
 * розрахунку. Заокруглення вгору монотонне, тому для будь-якої фактичної
 * кількості `r ≤ claimed` виконується `ceil(p·r/1000) ≤ ceil(p·claimed/1000)` —
 * тобто `FR-015a` («не перевищує її після») тримається арифметикою, а не
 * домовленістю про те, як саме рахуватиме `T027`.
 */
export function datasetUpperBound(pricePer1k: PricePer1k, recordCount: bigint): TokenAmount {
  if (recordCount < 0n) throw new QuoteOverflowError('кількість записів не може бути від’ємною')

  const product = pricePer1k * recordCount
  const amount = (product + RECORDS_PER_PRICE_UNIT - 1n) / RECORDS_PER_PRICE_UNIT
  if (amount > U64_MAX) {
    throw new QuoteOverflowError('вартість датасету не вміщається в u64')
  }
  return tokenAmountSchema.parse(amount)
}

/**
 * Сума меж по пулу.
 *
 * Складається з **посумованих угору** доданків, а не рахується з посумованих
 * записів: датасети мають різні ціни, і спільного знаменника для них немає.
 *
 * # Чому цієї суми вистачає і на «мовчазні» датасети
 *
 * Рецепт придушує внесок датасету, що дав менше за `MIN_CONTRIBUTION` записів,
 * — але його записи лишаються в когорті покупця, і за них він платить
 * (див. `MIN_CONTRIBUTION` в `encrypted-ixs`). Ці записи рахуються **за
 * найнижчою ціною серед мовчазних датасетів** (продуктове рішення 2026-09-07),
 * і саме цей вибір лишає суму нижче межі:
 *
 * `ceil(p_min·D/1000) ≤ ceil(Σ p_min·c_i/1000) ≤ Σ ceil(p_i·c_i/1000)`,
 *
 * де `D ≤ Σ c_i` — залишок, а `p_min ≤ p_i` для кожного мовчазного датасету.
 * Із середньою ціною пулу нерівність не виконується: дешевий мовчазний датасет
 * поруч із дорогим гучним дав би рахунок понад квоту.
 */
export function poolUpperBound(lines: readonly TokenAmount[]): TokenAmount {
  const total = lines.reduce((sum: bigint, amount) => sum + amount, 0n)
  if (total > U64_MAX) throw new QuoteOverflowError('вартість прогону не вміщається в u64')
  return tokenAmountSchema.parse(total)
}

/** Датасет у складі прогону. Шлях із власником — ідентифікатор унікальний лише в його межах. */
export const runDatasetRefSchema = z.strictObject({
  owner: solanaAddressSchema,
  datasetId: datasetIdSchema,
})

export type RunDatasetRef = z.infer<typeof runDatasetRefSchema>

/**
 * Тіло `POST /runs/quote`.
 *
 * `useType` і `buyerCategory` тут обов'язкові, хоча ціни не змінюють: без них
 * не перевірити згоду, а квота без перевірки згоди — це ціна прогону, який
 * буде відхилено (`FR-006`). Ті самі два поля лягають у `Run` ончейн, і саме
 * проти них перевірятиметься кожна згода при замовленні.
 *
 * `params` тут `unknown`: їхню форму оголошує рецепт, і розбирає їх той, хто
 * знає, який саме рецепт замовлено.
 */
export const runQuoteRequestSchema = z.strictObject({
  recipeId: recipeIdSchema,
  useType: useTypeSchema,
  buyerCategory: buyerCategorySchema,
  datasets: z.array(runDatasetRefSchema).min(1).max(MAX_RUN_DATASETS),
  params: z.unknown(),
})

export type RunQuoteRequest = z.infer<typeof runQuoteRequestSchema>

/**
 * Чому датасет не потрапив у суму.
 *
 * Причини згоди — ті самі, що розрізняє програма (`FR-008`); три перші
 * стосуються стану датасету, а не згоди. `ciphertext-missing` є тут, бо
 * зареєстрований датасет без байтів у сховищі неможливо порахувати: прогін по
 * ньому відхилиться на публікації в MPC, а не на перевірці згоди.
 */
export const QUOTE_INELIGIBLE_REASONS = [
  'unregistered',
  'retired',
  'ciphertext-missing',
  ...CONSENT_VIOLATIONS,
] as const

export type QuoteIneligibleReason = (typeof QUOTE_INELIGIBLE_REASONS)[number]

const quoteLineBase = {
  owner: solanaAddressSchema,
  datasetId: datasetIdSchema,
  datasetAddress: solanaAddressSchema,
}

/**
 * Рядок квоти — союз, а не поле з `null`.
 *
 * Придатний рядок несе числа й не несе причини; непридатний — навпаки. Спільна
 * форма з обома полями дозволила б відповідь «непридатний, але ось вартість»,
 * якої не буває, і фронту довелось би розбиратися, чому в сумі не сходиться.
 */
export const quoteLineSchema = z.discriminatedUnion('eligible', [
  z.strictObject({
    ...quoteLineBase,
    eligible: z.literal(true),
    pricePer1k: u64StringSchema,
    recordCountClaimed: u64StringSchema,
    upperBound: u64StringSchema,
  }),
  z.strictObject({
    ...quoteLineBase,
    eligible: z.literal(false),
    reason: z.enum(QUOTE_INELIGIBLE_REASONS),
  }),
])

export type QuoteLine = z.infer<typeof quoteLineSchema>

/** Чому замовити не вийде, навіть якщо ціна порахована. */
export const QUOTE_BLOCKERS = ['platform-paused', 'no-eligible-datasets'] as const

export type QuoteBlocker = (typeof QUOTE_BLOCKERS)[number]

/**
 * Відповідь `POST /runs/quote`.
 *
 * `feeBps` тут не додається до `upperBound` і не віднімається від неї.
 * Комісія береться з нарахування власника (`FR-018b`), тобто покупець платить
 * рівно `ціна × записи`, а ділиться ця сума вже після прогону. Поле стоїть у
 * відповіді, бо `FR-019` вимагає, щоб розмір комісії був публічним **на момент
 * замовлення**: покупець бачить, скільки з його грошей піде не власникам.
 */
export const runQuoteSchema = z.strictObject({
  recipeId: recipeIdSchema,
  recipe: z.string(),
  useType: useTypeSchema,
  buyerCategory: buyerCategorySchema,
  /** Параметри після нормалізації рецептом — з підставленими значеннями. */
  params: z.record(z.string(), z.unknown()),
  /** Сума меж придатних датасетів; саме вона блокується в депозиті. */
  upperBound: u64StringSchema,
  feeBps: z.number().int().min(0).max(10_000),
  /** Мінт, у якому виражені всі суми відповіді. */
  currency: solanaAddressSchema,
  datasets: z.array(quoteLineSchema),
  eligibleCount: z.number().int().nonnegative(),
  orderable: z.boolean(),
  blocker: z.enum(QUOTE_BLOCKERS).nullable(),
})

export type RunQuote = z.infer<typeof runQuoteSchema>
