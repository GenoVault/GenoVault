import { z } from 'zod'
import {
  DATASET_SOURCES,
  datasetFieldSchema,
  datasetProvenanceSchema,
  datasetStatisticsSchema,
} from './dataset-metadata.ts'
import {
  contentHashSchema,
  datasetIdSchema,
  pricePer1kSchema,
  recordCountSchema,
  solanaAddressSchema,
} from './primitives.ts'

/**
 * Що каталог віддає назовні (`FR-002`).
 *
 * Модуль існує окремо від `dataset-metadata.ts`, бо описує інший бік межі: там
 * форма, яку власник **надсилає**, тут — форма, яку покупець **читає**. Вони
 * схожі й свідомо не однакові: у відповіді немає нічого, чого немає в описі
 * датасету, зате є походження самих чисел і стан ланцюга.
 *
 * Жодне поле тут не веде до окремого запису, і це перевіряє окремий тест
 * (`T022`). Найближче до записів підходить `alleleFrequencies` — але це
 * агрегат по датасету від `MIN_COHORT` записів, заявлений власником.
 */

/**
 * Ціни й кількості їдуть рядками, не числами.
 *
 * `pricePer1k` — u64, а `JSON.parse` зводить числа до `double` і мовчки
 * округлює все, що більше за 2^53. Читач, який хоче арифметики, бере `BigInt`
 * від рядка; читач, який хоче показати, показує рядок.
 */
const u64Schema = z.string().regex(/^\d+$/, 'очікувалось ціле число рядком')

/**
 * Картка датасету в переліку.
 *
 * Тут навмисно немає ані схеми полів, ані статистики, ані стану ланцюга:
 * перелік читається пачками по двадцять, і читання ланцюга на кожен рядок
 * зробило б `SC-011` («перший екран каталогу < 2 с») недосяжним за побудовою.
 * Усе це є в картці окремого датасету.
 */
export const datasetCardSchema = z.strictObject({
  datasetId: datasetIdSchema,
  owner: solanaAddressSchema,
  /** PDA датасету — те саме, що деривується з `owner` і `datasetId`. */
  datasetAddress: solanaAddressSchema,
  title: z.string(),
  description: z.string(),
  recordCount: recordCountSchema,
  markerCount: z.number().int(),
  source: z.enum(DATASET_SOURCES),
  pricePer1k: u64Schema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type DatasetCard = z.infer<typeof datasetCardSchema>

export const datasetListSchema = z.strictObject({
  items: z.array(datasetCardSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
})

export type DatasetList = z.infer<typeof datasetListSchema>

/**
 * Статистика з походженням, а не сама по собі.
 *
 * `declaredBy` і `verified` — константи, і це навмисно. Числа заявив власник,
 * і жодна перевірка їх не чіпала: MPC рахує інше (пул, вікові вікна, розклад
 * за ураженістю, внесок кожного власника) і рахує під гарантією. Покупець, що
 * читає `alleleFrequencies` як факт про когорту, помиляється — і зрозуміти це
 * він має з самої картки, а не постфактум, як і з бейджем (`FR-024a`).
 */
export const declaredStatisticsSchema = datasetStatisticsSchema.extend({
  declaredBy: z.literal('owner'),
  verified: z.literal(false),
})

export type DeclaredStatistics = z.infer<typeof declaredStatisticsSchema>

/**
 * Згода так, як вона лежить у ланцюзі.
 *
 * `expired` тут немає навмисно. Строк перевіряється **часом ланцюга** в момент
 * прогону (`FR-005`, `T039`), а не годинником нашого сервера; поле «прострочена»
 * у відповіді API було б відповіддю на питання, якого API не вирішує. Віддається
 * `expiresAt` як є — і `revoked`, бо ось це однозначне.
 */
export const consentViewSchema = z.strictObject({
  version: z.number().int().positive(),
  allowedUses: z.number().int().nonnegative(),
  forbiddenUses: z.number().int().nonnegative(),
  buyerCategories: z.number().int().nonnegative(),
  /** Секунди Unix рядком; `null` — без строку. */
  expiresAt: u64Schema.nullable(),
  revoked: z.boolean(),
})

export const verificationBadgeViewSchema = z.strictObject({
  verifier: solanaAddressSchema,
  verifiedAt: u64Schema,
  /**
   * `FR-024a`: позначка — це довіра до оператора платформи, а не
   * криптографічний доказ. Слово стоїть у відповіді, щоб фронт не міг
   * показати бейдж, не показавши, чим він є.
   */
  kind: z.literal('operator-attested'),
})

/**
 * Стан ланцюга для картки датасету.
 *
 * Союз, а не поле з `null`, бо «RPC недоступний» і «датасет ще не
 * зареєстровано» — різні відповіді, які фронт має показувати по-різному.
 * Перше означає «спробуй пізніше», друге — «власник заявив датасет, але не
 * підписав реєстрацію».
 */
export const chainViewSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('unavailable') }),
  z.strictObject({ state: z.literal('unregistered') }),
  z.strictObject({
    state: z.literal('registered'),
    status: z.enum(['active', 'retired']),
    version: z.number().int().positive(),
    contentHash: contentHashSchema,
    recordCountClaimed: u64Schema,
    pricePer1k: u64Schema,
    /** `null` — згоди ще немає, тобто прогін по цьому датасету неможливий. */
    consent: consentViewSchema.nullable(),
    verifiedBadge: verificationBadgeViewSchema.nullable(),
  }),
])

export type ChainView = z.infer<typeof chainViewSchema>

/**
 * Картка окремого датасету.
 *
 * `contentHash` тут є, а байтів немає й не буде: відбиток — це те, чим
 * покупець звіряє, по чому саме йшов прогін (`FR-004`), а вміст існує рівно в
 * одному вигляді, шифротекстом, ключа від якого не має ніхто, крім
 * MPC-кластера.
 */
export const datasetDetailSchema = datasetCardSchema.extend({
  schema: z.array(datasetFieldSchema),
  statistics: declaredStatisticsSchema.nullable(),
  provenance: datasetProvenanceSchema,
  contentHash: contentHashSchema,
  /** Чи лежить шифротекст у сховищі. Без нього прогін замовити нічим. */
  ciphertextStored: z.boolean(),
  chain: chainViewSchema,
})

export type DatasetDetail = z.infer<typeof datasetDetailSchema>

/**
 * Параметри `GET /datasets`.
 *
 * Усе приходить рядками з рядка запиту, тому числа зводяться явно. `owner`
 * приймає `me` — це не адреса, а «мої», і саме цей запит показує власнику його
 * ж датасети, які ще не мають байтів.
 */
export const DATASET_LIST_LIMIT_DEFAULT = 20
export const DATASET_LIST_LIMIT_MAX = 100

export const datasetQuerySchema = z.strictObject({
  source: z.enum(DATASET_SOURCES).optional(),
  minRecords: z.coerce.number().int().nonnegative().optional(),
  maxPricePer1k: pricePer1kSchema.optional(),
  /** Підрядок у назві або описі, без урахування регістру. */
  q: z.string().min(1).max(120).optional(),
  owner: z.union([z.literal('me'), solanaAddressSchema]).optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(DATASET_LIST_LIMIT_MAX)
    .prefault(DATASET_LIST_LIMIT_DEFAULT),
  offset: z.coerce.number().int().nonnegative().prefault(0),
})

export type DatasetQuery = z.infer<typeof datasetQuerySchema>
