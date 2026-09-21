import { z } from 'zod'
import {
  BUYER_CATEGORY_NAMES,
  buyerCategorySchema,
  CONSENT_VIOLATIONS,
  USE_TYPE_NAMES,
  useTypeSchema,
} from './consent.ts'
import { MAX_MARKERS, MIN_COHORT } from './dataset-metadata.ts'

/**
 * Каталог рецептів (`FR-011`, `FR-011a`).
 *
 * Довільного коду покупця тут немає й не буде: покупець вибирає рядок цього
 * каталогу і задає параметри, які рецепт оголосив. Розширення каталогу — новий
 * контур і новий `comp_def` на нашому боці, а не можливість користувача.
 *
 * **У каталозі рівно те, що вміє рахувати конфіденційний шар.** SPEC називає
 * чотири рецепти першої версії, реалізований поки один — `frequencies`
 * (`T018`). Записати сюди решту наперед означало б віддавати покупцю квоту на
 * прогін, який ніхто не виконає: `POST /runs/quote` рахує ціну, а `T025`
 * публікує обчислення, і розійтись цим двом спискам ніде.
 */

/**
 * Значення фільтра «будь-яке» — дзеркало `FILTER_ANY` з контуру.
 *
 * 2, а не окремий прапорець: `sex` і `affected` це 0 або 1, тож третє значення
 * вільне. Дзеркало звіряється з текстом рецепта тестом.
 */
export const FILTER_ANY = 2

/** Межі вікового вікна — `age` у записі це `u8`. */
export const AGE_MIN = 0
export const AGE_MAX = 255

const ageSchema = z.number().int().min(AGE_MIN).max(AGE_MAX)

/**
 * Параметри рецепта «частоти й розподіли».
 *
 * Це рівно ті фільтри, які контур застосовує до кожного запису
 * (`frequencies_fold`): вікове вікно включно з обома краями, стать і статус
 * ураження. Нічого, чого контур не вміє, тут бути не може — параметр без
 * реалізації віддав би покупцю ціну за фільтр, який мовчки не спрацює.
 */
export const frequenciesParamsSchema = z
  .strictObject({
    minAge: ageSchema.prefault(AGE_MIN),
    maxAge: ageSchema.prefault(AGE_MAX),
    sex: z.enum(['female', 'male', 'any']).prefault('any'),
    affected: z.enum(['affected', 'unaffected', 'any']).prefault('any'),
  })
  .refine((value) => value.minAge <= value.maxAge, {
    message: 'нижня межа віку не може бути більшою за верхню',
    path: ['minAge'],
  })

export type FrequenciesParams = z.infer<typeof frequenciesParamsSchema>

/** Кодування фільтрів у те, що приймає контур: 0, 1 або `FILTER_ANY`. */
export function encodeFrequenciesFilters(params: FrequenciesParams): {
  minAge: number
  maxAge: number
  sexFilter: number
  affectedFilter: number
} {
  return {
    minAge: params.minAge,
    maxAge: params.maxAge,
    // `male` у накопичувачі це `Σ sex`, тобто 1 — чоловік, 0 — жінка.
    sexFilter: params.sex === 'any' ? FILTER_ANY : params.sex === 'male' ? 1 : 0,
    affectedFilter: params.affected === 'any' ? FILTER_ANY : params.affected === 'affected' ? 1 : 0,
  }
}

/**
 * Рядок каталогу.
 *
 * `id` — те саме `u16`, що лягає в `Run.recipe_id` ончейн. Номер, а не назва,
 * бо рядок в акаунті коштував би місця на кожному прогоні, а перекласти номер
 * у назву вміє цей файл.
 */
export interface Recipe {
  id: number
  name: string
  title: string
  description: string
  /** Скільки маркерів вміщає профіль контуру. */
  markers: number
  /** Найменша когорта, про яку рецепт погоджується говорити (`FR-012`). */
  minCohort: number
  params: z.ZodType
}

export const FREQUENCIES_RECIPE_ID = 1

export const RECIPES: readonly Recipe[] = [
  {
    id: FREQUENCIES_RECIPE_ID,
    name: 'frequencies',
    title: 'Частоти й розподіли',
    description:
      'Частоти алелів по маркерах, розподіл за статтю, віком і статусом ураження ' +
      'на когорті, зібраній фільтрами. Результат — агрегати, не вибірка записів.',
    markers: MAX_MARKERS,
    minCohort: MIN_COHORT,
    params: frequenciesParamsSchema,
  },
]

export function findRecipe(id: number): Recipe | undefined {
  return RECIPES.find((recipe) => recipe.id === id)
}

export const recipeIdSchema = z.number().int().min(0).max(0xffff)

/**
 * Довжина `Run.recipe_params` — дзеркало `RECIPE_PARAMS_LEN` у програмі.
 *
 * Поле фіксованої довжини на всі рецепти, а не по полю на кожен: акаунт прогону
 * має однаковий розмір незалежно від того, що замовили, і додати рецепт зі
 * своїми параметрами не означає міняти розкладку вже замовлених прогонів.
 */
export const RECIPE_PARAMS_LEN = 32

/**
 * Параметри «частот» у розкладці, яку читає програма (`FrequenciesParams::decode`).
 *
 * Перші чотири байти — вікове вікно і два фільтри, решта нулі, і саме нулі
 * програма перевіряє: непорожній хвіст означає, що клієнт поклав туди щось,
 * чого рецепт не читає, і мовчки проігнорувати це — значить пообіцяти покупцю
 * фільтр, якого не буде.
 *
 * Порядок байтів дублює сигнатуру `frequencies_fold`: зсув на одиницю поміняв
 * би фільтр статі на фільтр ураженості, нічого не зламавши.
 */
export function encodeFrequenciesParams(params: FrequenciesParams): Uint8Array {
  const filters = encodeFrequenciesFilters(params)
  const raw = new Uint8Array(RECIPE_PARAMS_LEN)
  raw[0] = filters.minAge
  raw[1] = filters.maxAge
  raw[2] = filters.sexFilter
  raw[3] = filters.affectedFilter
  return raw
}

/**
 * Зворотне до `encodeFrequenciesParams` — щоб показати умови вже замовленого
 * прогону.
 *
 * Читає рівно чотири байти й нічого не перевіряє понад словник: акаунт прогону
 * уже пройшов `FrequenciesParams::decode` у програмі, і друга валідація тут
 * означала б, що ми не віримо ланцюгу. Невідоме значення фільтра все ж стає
 * `'any'`, а не падає: екран, який не відкривається через байт, гірший за
 * екран, який показує ширший фільтр, ніж був.
 */
export function decodeFrequenciesParams(raw: Uint8Array): FrequenciesParams {
  const sex = raw[2]
  const affected = raw[3]
  return {
    minAge: raw[0] ?? AGE_MIN,
    maxAge: raw[1] ?? AGE_MAX,
    sex: sex === 0 ? 'female' : sex === 1 ? 'male' : 'any',
    affected: affected === 0 ? 'unaffected' : affected === 1 ? 'affected' : 'any',
  }
}

/**
 * Каталог, яким рецепти й словники згоди їдуть клієнту — `GET /recipes`
 * (`T035`, `FR-005`, `FR-011`).
 *
 * # Чому словники згоди лежать поруч із рецептами
 *
 * Форма замовлення й форма згоди складаються з тих самих трьох списків: що
 * рахувати, навіщо і хто. Без цього маршруту клієнт тримав би копію словника в
 * собі — і саме так живе `apps/web` на моках, де `USE_TYPES` переписані
 * вручну. Копія розходиться з програмою не тоді, коли її пишуть, а тоді, коли
 * в програму додають тип: власник у застарілому клієнті не зможе його
 * дозволити, а покупець — замовити. Один маршрут, одне джерело.
 *
 * # Чому назви, а не біти
 *
 * На межі API їздить назва, не бітмаска (див. `useTypeSchema`), і каталог
 * тримається того самого правила: біт — деталь розкладки акаунта, і клієнту
 * він не потрібен ні для згоди, ні для замовлення. Хто читає ланцюг напряму,
 * бере біти з `USE_TYPES`, а не з відповіді сервера.
 *
 * # Параметри рецепта — JSON Schema у формі **вводу**
 *
 * Клієнту потрібно побудувати форму, а не перевірити відповідь, тож схема
 * віддається з `default` і без `required`: поле, якого не прислали, підставить
 * `prefault` на сервері. Що в цій формі **не** видно — перехресні правила на
 * кшталт «нижня межа віку ≤ верхньої»: JSON Schema їх не виражає, і
 * `z.toJSONSchema` мовчки їх опускає. Їх перевіряє `POST /runs/quote` і
 * називає в `400`; каталог цього не обіцяє, і тест нижче тримає, що опущено
 * рівно це, а не якесь поле.
 */
export const recipeViewSchema = z.strictObject({
  id: recipeIdSchema,
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  markers: z.number().int().positive(),
  minCohort: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()),
})

export type RecipeView = z.infer<typeof recipeViewSchema>

export const recipeCatalogSchema = z.strictObject({
  recipes: z.array(recipeViewSchema).min(1),
  useTypes: z.array(useTypeSchema).min(1),
  buyerCategories: z.array(buyerCategorySchema).min(1),
  consentViolations: z.array(z.enum(CONSENT_VIOLATIONS)).min(1),
})

export type RecipeCatalog = z.infer<typeof recipeCatalogSchema>

export function recipeView(recipe: Recipe): RecipeView {
  return {
    id: recipe.id,
    name: recipe.name,
    title: recipe.title,
    description: recipe.description,
    markers: recipe.markers,
    minCohort: recipe.minCohort,
    params: z.toJSONSchema(recipe.params, { io: 'input' }),
  }
}

/**
 * Каталог складається з констант і не залежить ані від мережі, ані від часу,
 * тож рахується один раз. `parse` тут — не перестраховка: він тримає, що те,
 * що ми віддаємо, проходить ту саму схему, якою клієнт це читатиме.
 */
let cached: RecipeCatalog | undefined

export function recipeCatalog(): RecipeCatalog {
  cached ??= recipeCatalogSchema.parse({
    recipes: RECIPES.map(recipeView),
    useTypes: [...USE_TYPE_NAMES],
    buyerCategories: [...BUYER_CATEGORY_NAMES],
    consentViolations: [...CONSENT_VIOLATIONS],
  })
  return cached
}
