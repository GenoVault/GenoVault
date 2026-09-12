import { z } from 'zod'
import { decodeBase58 } from './base58.ts'

declare const brand: unique symbol

type Brand<T, K extends string> = T & { readonly [brand]: K }

export const SOLANA_ADDRESS_BYTES = 32

/**
 * Адреса в мережі. Перевіряється довжина після декодування, а не лише алфавіт:
 * base58-рядок правильного вигляду може розкодуватись у 31 або 33 байти.
 *
 * Перевірки «чи лежить точка на кривій» тут немає навмисно. Адреси програм і
 * PDA поза кривою за побудовою, тож така перевірка має жити там, де очікується
 * саме гаманець користувача, а не в спільному примітиві.
 */
export const solanaAddressSchema = z
  .string()
  .min(32)
  .max(44)
  .refine((value) => decodeBase58(value)?.length === SOLANA_ADDRESS_BYTES, {
    message: 'очікувалась base58-адреса завдовжки 32 байти',
  })
  .transform((value) => value as SolanaAddress)

export type SolanaAddress = Brand<string, 'SolanaAddress'>

/**
 * Ідентифікатор датасету в межах одного власника.
 *
 * Межа 32 — не смак, а розмір seed у Solana: ідентифікатор іде в деривацію
 * PDA датасету як є, щоб адресу можна було відновити з URL каталогу без
 * жодного запиту. Довший ідентифікатор довелось би хешувати, і зв'язок
 * «адреса ↔ ідентифікатор» перестав би читатися оком в експлорері.
 */
export const DATASET_ID_MAX_LENGTH = 32

export const datasetIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{2,31}$/, 'дозволені малі літери, цифри й дефіс, 3–32 символи')
  .transform((value) => value as DatasetId)

export type DatasetId = Brand<string, 'DatasetId'>

export const runIdSchema = z.uuid().transform((value) => value as RunId)

export type RunId = Brand<string, 'RunId'>

/**
 * Сума в найменших одиницях розрахункового токена.
 *
 * bigint, а не number: залишки й нарахування рахуються в u64, а number втрачає
 * точність після 2^53. Помилка тут — це недоплата донору, яка не падає, а тихо
 * округлює.
 */
const amountBaseSchema = z
  .union([z.bigint(), z.string().regex(/^\d+$/), z.number().int().nonnegative()])
  .transform((value) => BigInt(value))
  .refine((value) => value >= 0n && value <= 0xffff_ffff_ffff_ffffn, {
    message: 'сума не вміщається в u64',
  })

export const tokenAmountSchema = amountBaseSchema.transform((value) => value as TokenAmount)

export type TokenAmount = Brand<bigint, 'TokenAmount'>

/** Кількість записів у датасеті або в прогоні. */
export const recordCountSchema = z
  .number()
  .int()
  .nonnegative()
  .transform((value) => value as RecordCount)

export type RecordCount = Brand<number, 'RecordCount'>

/**
 * Ціна власника за 1000 записів (FR-015).
 *
 * Окремий бренд від `TokenAmount` навмисно: ціна за тисячу і сума до сплати —
 * різні величини, і множення однієї на іншу без переходу через розрахунок
 * внеску є помилкою, яку має ловити компілятор, а не тест.
 */
export const pricePer1kSchema = amountBaseSchema.transform((value) => value as PricePer1k)

export type PricePer1k = Brand<bigint, 'PricePer1k'>

/** Комісія платформи в базисних пунктах: 700 = 7% (FR-019). */
export const bpsSchema = z
  .number()
  .int()
  .min(0)
  .max(10_000)
  .transform((value) => value as Bps)

export type Bps = Brand<number, 'Bps'>

export const BPS_DENOMINATOR = 10_000n

/** Відбиток вмісту датасету, за яким звіряють, по чому саме йшов прогін (FR-004). */
export const contentHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'очікувався sha-256 у нижньому регістрі, 64 шістнадцяткові символи')
  .transform((value) => value as ContentHash)

export type ContentHash = Brand<string, 'ContentHash'>

/**
 * Ціле u64 рядком — так суми переживають JSON.
 *
 * `JSON.parse` зводить числа до `double` і мовчки округлює все, що більше за
 * 2^53, а ціни й нарахування — це u64. Читач, який хоче арифметики, бере
 * `BigInt` від рядка; читач, який хоче показати, показує рядок.
 *
 * Схема живе тут, а не в модулі відповідей, бо стосується не каталогу і не
 * квоти, а того, як число взагалі перетинає межу.
 */
export const u64StringSchema = z.string().regex(/^\d+$/, 'очікувалось ціле число рядком')

/**
 * Ціле u128 рядком.
 *
 * Той самий регекс, що й у `u64StringSchema`, і окрема назва навмисно: ширина
 * тут не деталь. Нонс шифру звіту — u128, і читач, який побачить `u64` у
 * схемі, рано чи пізно проведе його через `Number()` або `toBn()`, а перше
 * округлить, друге відхилить. Обидва варіанти означають звіт, який більше
 * ніхто не розшифрує.
 */
export const u128StringSchema = z.string().regex(/^\d+$/, 'очікувалось ціле число рядком')
