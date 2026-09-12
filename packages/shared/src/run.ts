import { z } from 'zod'
import { buyerCategorySchema, useTypeSchema } from './consent.ts'
import {
  contentHashSchema,
  datasetIdSchema,
  solanaAddressSchema,
  u64StringSchema,
  u128StringSchema,
} from './primitives.ts'
import { QUOTE_INELIGIBLE_REASONS, runDatasetRefSchema } from './quote.ts'
import { recipeIdSchema } from './recipes.ts'

/**
 * Замовлення прогону і його стан (`T029`).
 *
 * # Чому API віддає інструкцію, а не транзакцію
 *
 * Той самий порядок, що й у реєстрації датасету (`T020`): гроші рухає підпис
 * покупця, і зібрати транзакцію без нього ми не можемо навіть технічно —
 * `recentBlockhash` живе близько хвилини, а покупець ще читатиме, за що
 * платить. Хеш блоку бере той, хто підписує, у момент підпису.
 *
 * # Чому стан прогону читається з ланцюга, а не з дзеркала
 *
 * Дзеркала прогонів немає й не буде до `T004`, але річ не в цьому. Прогін —
 * це те, за що заплачено, і рядок у нашій базі був би другим твердженням про
 * ті самі гроші. `FR-025` вимагає, щоб третя сторона звіряла журнал із
 * мережею; API, який показує покупцю власну копію, показував би не те, що
 * звірятиме звіряч.
 */

/** Акаунт в інструкції, яку підписуватиме клієнт. */
export const unsignedAccountSchema = z.strictObject({
  pubkey: solanaAddressSchema,
  isSigner: z.boolean(),
  isWritable: z.boolean(),
})

/**
 * Інструкція у вигляді, який переживає JSON: адреси base58, дані base64.
 *
 * Схема живе тут, а не в `apps/api`, бо це межа: її розбирає той, хто
 * підписує. До `T029` те саме подання було інтерфейсом на боці сервера, і
 * клієнт вірив йому на слово.
 */
export const unsignedInstructionSchema = z.strictObject({
  programId: solanaAddressSchema,
  accounts: z.array(unsignedAccountSchema).min(1),
  data: z.string().min(1),
})

export type UnsignedAccount = z.infer<typeof unsignedAccountSchema>
export type UnsignedInstruction = z.infer<typeof unsignedInstructionSchema>

/** Публічний x25519 покупця — 32 байти шістнадцятково, як `contentHash`. */
export const x25519PublicKeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'очікувалось 32 байти шістнадцятково в нижньому регістрі')

/**
 * Тіло `POST /runs`.
 *
 * Склад пулу, рецепт і параметри — те саме, що в квоті, і навмисно: покупець
 * підписує рівно те, за що йому назвали ціну. Три поля, яких у квоті немає:
 *
 * - `buyer` — адреса гаманця, що підписуватиме. Береться з запиту, а не з
 *   сесії: сесія Privy знає `did:privy:…`, а платить ключ, і зв'язок між ними
 *   TOFU-шний (`T020`). Маршрут звіряє одне з одним.
 * - `nonce` — його обирає покупець, і саме він розрізняє два прогони з тим
 *   самим складом пулу. Обирає клієнт, бо seeds прогону мусять бути відомі
 *   до підпису.
 * - `buyerX25519` — ключ, на який MPC зашифрує звіт. Приходить від покупця й
 *   ні від кого іншого: якби його називала публікація, диспетчер підставив би
 *   свій і прочитав звіт, за який заплатив хтось інший.
 *
 * `maxEscrow` — стеля, а не сума. Вартість рахує програма з ончейн-цін, і
 * підняття ціни між квотою й підписом має валити транзакцію, а не мовчки
 * списувати більше, ніж покупець бачив.
 *
 * `dispatcher` необов'язковий: пропущений означає «той, якого публікує
 * платформа» (`GET /platform`). Це зручність, а не повноваження — поле
 * лишається в руках покупця, і в `Run` лягає рівно те, що він підписав.
 */
export const runOrderRequestSchema = z.strictObject({
  buyer: solanaAddressSchema,
  recipeId: recipeIdSchema,
  useType: useTypeSchema,
  buyerCategory: buyerCategorySchema,
  datasets: z.array(runDatasetRefSchema).min(1),
  params: z.unknown(),
  nonce: u64StringSchema,
  maxEscrow: u64StringSchema,
  buyerX25519: x25519PublicKeySchema,
  dispatcher: solanaAddressSchema.optional(),
})

export type RunOrderRequest = z.infer<typeof runOrderRequestSchema>

/**
 * Рядок складу в замовленні.
 *
 * Несе `consentVersion` тому, що саме ця версія поїхала в інструкцію: програма
 * вимагає чинну, і покупець, який побачить у відповіді іншу, дізнається про
 * зміну умов до підпису, а не з відмови транзакції.
 */
export const runOrderDatasetSchema = z.strictObject({
  owner: solanaAddressSchema,
  datasetId: datasetIdSchema,
  datasetAddress: solanaAddressSchema,
  consentVersion: z.number().int().positive(),
  pricePer1k: u64StringSchema,
  recordCountClaimed: u64StringSchema,
})

/**
 * Відповідь `POST /runs`.
 *
 * `escrow` тут — та сама верхня оцінка, що й у квоті, порахована з тих самих
 * ончейн-цін у тому ж запиті. Вона повторюється в замовленні не заради
 * зручності: між квотою і замовленням минає час, і покупець мусить бачити
 * число, проти якого він **зараз** ставить стелю.
 */
export const runOrderSchema = z.strictObject({
  runAddress: solanaAddressSchema,
  buyer: solanaAddressSchema,
  nonce: u64StringSchema,
  dispatcher: solanaAddressSchema,
  escrow: u64StringSchema,
  maxEscrow: u64StringSchema,
  feeBps: z.number().int().min(0).max(10_000),
  currency: solanaAddressSchema,
  datasets: z.array(runOrderDatasetSchema).min(1),
  instruction: unsignedInstructionSchema,
})

export type RunOrder = z.infer<typeof runOrderSchema>

/**
 * Чому замовлення не складається.
 *
 * Окремо від причин квоти (`QUOTE_INELIGIBLE_REASONS`) стоять дві, яких там
 * бути не може: платформа на паузі й стеля покупця нижча за ціну. Обидві —
 * про замовлення, а не про датасет, і плутати їх із «згоду відкликано»
 * означало б відправляти покупця виправляти не те.
 */
export const RUN_ORDER_REFUSALS = ['platform-paused', 'escrow-below-price'] as const

export type RunOrderRefusal = (typeof RUN_ORDER_REFUSALS)[number]

/** Деталі відмови: що саме не пройшло і по яких датасетах. */
export const runOrderRefusalSchema = z.strictObject({
  refusal: z.enum([...RUN_ORDER_REFUSALS, 'datasets-ineligible']),
  escrow: u64StringSchema.optional(),
  ineligible: z
    .array(
      z.strictObject({
        owner: solanaAddressSchema,
        datasetId: datasetIdSchema,
        reason: z.enum(QUOTE_INELIGIBLE_REASONS),
      }),
    )
    .optional(),
})

/** П'ять станів прогону — дзеркало `RunStatus` у програмі. */
export const RUN_STATUSES = ['accepted', 'running', 'completed', 'rejected', 'failed'] as const

export type RunStatusName = (typeof RUN_STATUSES)[number]

/**
 * Рядок складу в стані прогону.
 *
 * `owner`, `datasetId` і `title` необов'язкові, і це не недбалість. У
 * `Run.datasets[]` лежить **адреса** PDA, а вона не обертається назад: пара
 * «власник + ідентифікатор» дає адресу, але не навпаки. Назву підставляє
 * каталог, коли знає цю адресу; коли не знає — прогін усе одно показується,
 * бо гроші за нього вже заплачені, а рядок без назви чесніший за відсутній.
 */
export const runViewDatasetSchema = z.strictObject({
  datasetAddress: solanaAddressSchema,
  owner: solanaAddressSchema.optional(),
  datasetId: datasetIdSchema.optional(),
  title: z.string().optional(),
  pricePer1k: u64StringSchema,
  recordsIncluded: z.number().int().nonnegative(),
  /** Внесок нижчий за `MIN_CONTRIBUTION` і тому оголошений нулем (`T019`). */
  belowFloor: z.boolean(),
  settled: z.boolean(),
})

/**
 * Звіт під ключем покупця.
 *
 * Шифротексти публічні — вони лежать в акаунті мережі, і будь-хто може їх
 * прочитати рівно так само, як ми. Прочитати **звіт** може лише той, у кого
 * приватна половина `Run.buyerX25519`, і в неї немає жодного шляху ні на
 * сервер, ні в цю відповідь.
 */
export const runResultViewSchema = z.strictObject({
  encryptionKey: x25519PublicKeySchema,
  nonce: u128StringSchema,
  ciphertexts: z.array(contentHashSchema),
  recordsIncluded: z.number().int().nonnegative(),
  /** Когорта менша за `MIN_COHORT`: звіт складається з нулів (`FR-012`). */
  suppressed: z.boolean(),
})

/**
 * Відповідь `GET /runs/:buyer/:nonce`.
 *
 * Усе тут прочитане з ланцюга в момент запиту. Полів, яких немає в акаунтах,
 * тут лише два: `recipe` — назва за номером із каталогу рецептів, і `title`
 * рядків складу — з каталогу датасетів.
 */
export const runViewSchema = z.strictObject({
  runAddress: solanaAddressSchema,
  buyer: solanaAddressSchema,
  nonce: u64StringSchema,
  dispatcher: solanaAddressSchema,
  status: z.enum(RUN_STATUSES),
  recipeId: recipeIdSchema,
  recipe: z.string(),
  useType: useTypeSchema,
  buyerCategory: buyerCategorySchema,
  /** Параметри, розібрані рецептом із `Run.recipe_params`. */
  params: z.record(z.string(), z.unknown()),
  feeBps: z.number().int().min(0).max(10_000),
  escrowAmount: u64StringSchema,
  settledCount: z.number().int().nonnegative(),
  settledAmount: u64StringSchema,
  /** Різницю депозиту вже повернуто покупцю — обома шляхами, якими вона йде. */
  refunded: z.boolean(),
  recordsIncluded: z.number().int().nonnegative(),
  suppressed: z.boolean(),
  /** Скільки датасетів пулу вже згорнуто; рухає його лише MPC. */
  datasetCursor: z.number().int().nonnegative(),
  foldedBatches: z.number().int().nonnegative(),
  /** Ланцюжок відбитків усього, що пішло в MPC (`FR-025`). */
  foldedHash: contentHashSchema,
  resultHash: contentHashSchema.nullable(),
  createdAt: u64StringSchema,
  datasets: z.array(runViewDatasetSchema),
  /** `null` — розкриття ще не відбулося; на екрані це «ще рахують». */
  result: runResultViewSchema.nullable(),
})

export type RunView = z.infer<typeof runViewSchema>
export type RunViewDataset = z.infer<typeof runViewDatasetSchema>
export type RunResultView = z.infer<typeof runResultViewSchema>

/**
 * Стан платформи, потрібний покупцю до замовлення (`GET /platform`).
 *
 * `dispatcher` тут — адреса, яку платформа готова підставити в `Run.dispatcher`
 * за замовчуванням. Публікується саме тому, що це повноваження: покупець мусить
 * бачити, кому він його дає, і мати змогу назвати іншого. Диспетчер не рухає
 * грошей, не міняє складу прогону й параметрів рецепта і не обходить згоду —
 * усе, що він може, це довести прогін до кінця або не довести.
 *
 * `null` означає, що платформа диспетчера не тримає, і покупець мусить назвати
 * свого. Це не помилка розгортання: платформа без диспетчера — законна.
 */
export const platformViewSchema = z.strictObject({
  programId: solanaAddressSchema,
  mint: solanaAddressSchema,
  feeBps: z.number().int().min(0).max(10_000),
  paused: z.boolean(),
  dispatcher: solanaAddressSchema.nullable(),
})

export type PlatformView = z.infer<typeof platformViewSchema>
