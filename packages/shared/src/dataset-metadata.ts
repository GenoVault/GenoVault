import { z } from 'zod'
import {
  contentHashSchema,
  datasetIdSchema,
  pricePer1kSchema,
  recordCountSchema,
  solanaAddressSchema,
} from './primitives.ts'

/**
 * Опис датасету для каталогу (`FR-001`, `FR-002`).
 *
 * Тут немає жодного поля, з якого можна дістати окремий запис, і це головна
 * властивість модуля, а не побічна. Каталог показує форму датасету — які поля
 * в ньому є, скільки записів, звідки вони й що дають у сумі. Усе, що описує
 * конкретну людину, живе в шифротексті, ключа від якого не має ніхто, крім
 * MPC-кластера (`FR-004a`).
 *
 * Схеми лежать у `packages/shared`, бо ту саму форму заповнює браузер власника
 * і перевіряє `apps/api`. Двох описів одного об'єкта тут бути не може: розбіжні
 * межі означали б, що фронт приймає те, що API відкине, і власник дізнається
 * про це після десяти хвилин шифрування.
 */

/**
 * Мінімальний розмір когорти — **дзеркало** `MIN_COHORT` з `encrypted-ixs`.
 *
 * Число продубльоване свідомо, як `DATASET_ID_MAX_LEN`: Rust і TypeScript не
 * мають спільного місця для констант, а вивести його з IDL не можна — воно
 * живе в контурі, не в програмі. Розходження ловить тест, який звіряє це
 * значення з текстом рецепта.
 */
export const MIN_COHORT = 10

/**
 * Скільки маркерів приймає скомпільований рецепт — дзеркало `MARKERS`.
 *
 * Це межа контуру, а не смак: профіль зашитий у контур на етапі компіляції,
 * і датасет із 65 маркерами не має рецепта, яким його порахувати.
 */
export const MAX_MARKERS = 64

/**
 * Колонки запису, які не є маркерами: `subjectId`, `sex`, `age`, `affected`.
 *
 * Названі числом, а не переліком, бо схему описує власник, а не ми: назвати
 * колонки означало б вимагати саме ці імена. Але їхня кількість — межа, і без
 * неї межа схеми стояла на `MAX_MARKERS`, тобто повний профіль рецепта (64
 * маркери плюс ці чотири) не проходив власної перевірки. Знайдено на `T029`
 * тестом, який ганяє маніфест `tools/gen-dataset` через `datasetMetadataSchema`.
 */
export const FIXED_FIELDS = 4

/** Скільки рядків узагалі може мати опис схеми датасету. */
export const MAX_SCHEMA_FIELDS = MAX_MARKERS + FIXED_FIELDS

/**
 * Опис одного поля запису — те саме, що віддає `publicManifest` у `tools/gen-dataset`.
 *
 * Підкреслення в імені дозволене, і це рішення, а не послаблення. Генератор
 * фікстур називає маркери `marker_0001`, а коментар вище прямо каже, що це «те
 * саме, що віддає `publicManifest`» — тобто схема, яка їх не приймає, робить
 * власне твердження неправдою: маніфест власного генератора не проходить у
 * `POST /datasets`. Знайдено на `T028`, полагоджено на `T029`; тест нижче
 * ганяє справжній маніфест генератора через цю схему, щоб розходження більше
 * не жило непоміченим.
 *
 * Межа в 32 символи лишається: імена полів їдуть у маніфест кожного датасету,
 * і довші не додають змісту, лише байтів.
 */
export const datasetFieldSchema = z.strictObject({
  field: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9_]{0,31}$/, 'очікувалось ім’я поля з літери, далі букви, цифри або _'),
  type: z.enum(['integer', 'string']),
  description: z.string().min(1).max(200),
})

export type DatasetField = z.infer<typeof datasetFieldSchema>

/**
 * Агрегована статистика датасету.
 *
 * Приймається лише для датасетів від `MIN_COHORT` записів — див. перевірку в
 * `datasetMetadataSchema`. На меншій когорті ці числа перестають бути
 * агрегатом: частка уражених на одному записі — це діагноз конкретної людини,
 * а середній вік — її вік.
 */
export const datasetStatisticsSchema = z.strictObject({
  affectedRate: z.number().min(0).max(1),
  meanAge: z.number().min(0).max(130),
  /** По одному значенню на маркер, у тому самому порядку, що й лімби в конверті. */
  alleleFrequencies: z.array(z.number().min(0).max(1)).min(1).max(MAX_MARKERS),
})

export type DatasetStatistics = z.infer<typeof datasetStatisticsSchema>

/**
 * Походження даних (`FR-001`).
 *
 * `synthetic` — не формальність. Фікстури проекту вигадані, і датасет, який
 * мовчить про це в каталозі, читається покупцем як справжня когорта.
 */
export const DATASET_SOURCES = ['clinic', 'biobank', 'individual', 'synthetic'] as const

export const datasetProvenanceSchema = z.strictObject({
  source: z.enum(DATASET_SOURCES),
  /** Вікно збору, дати за ISO. Без часу: точніше — це вже подія про людину. */
  collectedFrom: z.iso.date(),
  collectedTo: z.iso.date(),
  note: z.string().max(500).optional(),
})

export type DatasetProvenance = z.infer<typeof datasetProvenanceSchema>

const baseMetadataSchema = z.strictObject({
  title: z.string().min(3).max(120),
  description: z.string().min(1).max(2000),
  schema: z.array(datasetFieldSchema).min(1).max(MAX_SCHEMA_FIELDS),
  recordCount: recordCountSchema,
  markerCount: z.number().int().min(1).max(MAX_MARKERS),
  statistics: datasetStatisticsSchema.optional(),
  provenance: datasetProvenanceSchema,
})

/**
 * Перевірки, які стосуються кількох полів одразу.
 *
 * Написані оборонно — з явними перевірками типу перед порівнянням. Zod 4 не
 * спиняється на першій невдалій перевірці: якщо `markerCount` не пройшов
 * власну, сюди все одно зайдуть, і звернення до поля як до числа перетворило б
 * помилку валідації (400) на виняток (500).
 */
export const datasetMetadataSchema = baseMetadataSchema.superRefine((value, ctx) => {
  const markerCount: unknown = value.markerCount
  const frequencies: unknown = value.statistics?.alleleFrequencies

  if (
    typeof markerCount === 'number' &&
    Array.isArray(frequencies) &&
    frequencies.length !== markerCount
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['statistics', 'alleleFrequencies'],
      message: `очікувалось ${markerCount} частот — по одній на маркер, отримано ${frequencies.length}`,
    })
  }

  const recordCount: unknown = value.recordCount
  if (typeof recordCount === 'number') {
    // Нижче `MIN_COHORT` агрегат перестає бути агрегатом, тому статистики там
    // не буває. Реєструвати сам датасет це не заважає: окрема особа —
    // повноцінний власник зі своїм датасетом на один запис (`FR-009`).
    if (recordCount < MIN_COHORT && value.statistics !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['statistics'],
        message: `статистика приймається від ${MIN_COHORT} записів: на меншій когорті вона описує окрему людину`,
      })
    }
    if (recordCount >= MIN_COHORT && value.statistics === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['statistics'],
        message: 'датасет від MIN_COHORT записів має нести агрегований опис',
      })
    }
  }

  const from: unknown = value.provenance?.collectedFrom
  const to: unknown = value.provenance?.collectedTo
  if (typeof from === 'string' && typeof to === 'string' && from > to) {
    ctx.addIssue({
      code: 'custom',
      path: ['provenance', 'collectedTo'],
      message: 'вікно збору закінчується раніше, ніж починається',
    })
  }
})

export type DatasetMetadata = z.infer<typeof datasetMetadataSchema>

/**
 * Тіло `POST /datasets` (`FR-001`).
 *
 * `contentHash` приходить від власника, а не рахується сервером: байти на цей
 * момент ще в браузері. Сервер звіряє його з фактичним відбитком завантаженого
 * шифротексту (`PUT /datasets/:id/ciphertext`) і відмовляє при розходженні —
 * тому заявити один вміст, а покласти інший неможливо.
 *
 * `recordCountClaimed` окремим полем немає навмисно: заявлена кількість — це
 * `metadata.recordCount`, і два числа про одне давали б змогу написати в
 * каталозі одне, а в ланцюг відправити інше.
 */
export const registerDatasetRequestSchema = z.strictObject({
  datasetId: datasetIdSchema,
  /**
   * Адреса власника в мережі. Її ж вимагає підпис `register_dataset`, тож
   * підмінити її в тілі запиту нічого не дає ончейн — але дає перекрутити
   * рядок каталогу, і саме тому вона прив'язується до сесії при першій
   * реєстрації й далі мусить збігатися.
   */
  owner: solanaAddressSchema,
  contentHash: contentHashSchema,
  pricePer1k: pricePer1kSchema,
  metadata: datasetMetadataSchema,
})

export type RegisterDatasetRequest = z.infer<typeof registerDatasetRequestSchema>
