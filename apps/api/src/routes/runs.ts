import { U64_MAX } from '@genovault/sdk'
import type {
  BuyerCategoryName,
  DatasetId,
  FrequenciesParams,
  Recipe,
  RunView,
  SolanaAddress,
  UseTypeName,
} from '@genovault/shared'
import {
  buyerCategoryBit,
  checkConsent,
  datasetUpperBound,
  decodeFrequenciesParams,
  encodeFrequenciesParams,
  findRecipe,
  MAX_RUN_DATASETS,
  namedCategories,
  namedUses,
  poolUpperBound,
  type QuoteIneligibleReason,
  type QuoteLine,
  QuoteOverflowError,
  type RunDatasetRef,
  type RunOrder,
  type RunQuote,
  runOrderRequestSchema,
  runOrderSchema,
  runQuoteRequestSchema,
  runQuoteSchema,
  runViewSchema,
  solanaAddressSchema,
  type TokenAmount,
  u64StringSchema,
  useTypeBit,
} from '@genovault/shared'
import { Hono } from 'hono'
import { fail } from '../errors.ts'
import { type AuthVariables, requireAuth } from '../middleware/auth.ts'
import type { TokenVerifier } from '../services/auth.ts'
import type { CatalogStore, DatasetRecord } from '../services/catalog.ts'
import {
  ChainStateError,
  deriveDatasetAddress,
  type QuoteChainReader,
  type QuoteChainState,
  type QuoteDatasetState,
  type RunOrderBuilder,
  type RunReader,
} from '../services/chain.ts'

/**
 * Верхня оцінка вартості прогону (`FR-015a`) — `T023`.
 *
 * Маршрут нічого не змінює: ані в мережі, ані в каталозі. `POST`, а не `GET`,
 * бо склад пулу — це до п'ятдесяти пар «власник + датасет» плюс параметри
 * рецепта, і в рядку запиту таке не живе.
 *
 * # Звідки числа
 *
 * Ціна й заявлений обсяг беруться **з ланцюга**, не з каталогу (рішення
 * 2026-09-07). Дзеркало відстає після `set_dataset_price`, і квота з
 * нього була б числом, за яке ніхто не відповідає: депозит перевіряє програма
 * за ончейн-ціною, тож покупець побачив би `INSUFFICIENT_ESCROW` замість тієї
 * суми, яку щойно підтвердив. Ціна цього рішення названа: без RPC квоти немає
 * — на відміну від картки каталогу, яка відкривається й без мережі.
 *
 * # Чому тут перевіряється згода
 *
 * Квота без перевірки згоди — це ціна прогону, який буде відхилено (`FR-006`),
 * і покупець дізнався б про це, вже заблокувавши депозит. Тому кожен рядок
 * несе `eligible` і, якщо ні, названу причину (`FR-008`), а в суму йдуть лише
 * придатні. Вирішує все одно програма: ця перевірка нічого не дозволяє, вона
 * лише попереджає раніше (`SC-010`).
 *
 * Непридатний датасет **не** валить усю квоту. Покупець, який зібрав пул із
 * п'ятдесяти датасетів, інакше дізнавався б про проблеми по одній.
 */

export interface RunRoutesDeps {
  verify?: TokenVerifier | undefined
  catalog?: CatalogStore | undefined
  readQuoteChain?: QuoteChainReader | undefined
  buildRunOrder?: RunOrderBuilder | undefined
  readRun?: RunReader | undefined
  /**
   * Диспетчер, якого платформа підставляє за замовчуванням (`T029`).
   *
   * Необов'язковий: платформа без диспетчера законна, просто покупець мусить
   * назвати свого. `undefined` тут краще за підставлений нуль — останній був
   * би адресою, від якої прогін ніколи не зрушить, і покупець дізнався б про
   * це не з відмови, а з мовчання.
   */
  dispatcher?: SolanaAddress | undefined
}

interface RunServices {
  catalog: CatalogStore
  readQuoteChain: QuoteChainReader
  buildRunOrder?: RunOrderBuilder | undefined
  readRun?: RunReader | undefined
  dispatcher?: SolanaAddress | undefined
}

/**
 * Квота — єдине, без чого маршрутів немає взагалі.
 *
 * Складання замовлення й читання прогону перевіряються окремо, у своїх
 * обробниках: застосунок без RPC-збирача все одно мусить уміти назвати ціну,
 * а маршрут, який без нього не працює, має сказати це сам, а не зникнути
 * разом із квотою.
 */
function configure(deps: RunRoutesDeps): RunServices | undefined {
  const { catalog, readQuoteChain } = deps
  if (catalog === undefined || readQuoteChain === undefined) return undefined
  return {
    catalog,
    readQuoteChain,
    buildRunOrder: deps.buildRunOrder,
    readRun: deps.readRun,
    dispatcher: deps.dispatcher,
  }
}

/**
 * Відмова, коли не відповіла мережа.
 *
 * Спільна для трьох маршрутів: текст помилки назовні не йде — він регулярно
 * містить адресу RPC, а це деталь розгортання.
 */
function chainFailure(c: Parameters<typeof fail>[0], error: unknown) {
  if (error instanceof ChainStateError) {
    return error.reason === 'unavailable'
      ? fail(c, 'UPSTREAM_UNAVAILABLE', 'мережа зараз не відповідає — спробуйте пізніше')
      : fail(c, 'INTERNAL', 'внутрішня помилка')
  }
  throw error
}

/** Параметри рецепта з акаунта прогону — назад у форму, яку показує екран. */
function decodeRecipeParams(recipe: Recipe | undefined, raw: Uint8Array): Record<string, unknown> {
  if (recipe?.name === 'frequencies') return { ...decodeFrequenciesParams(raw) }
  return {}
}

/**
 * Дублікат у складі прогону — не дрібниця форматування.
 *
 * Програма відхиляє його (`Run::validate_datasets`), бо він заплатив би одному
 * власнику двічі за той самий датасет і зламав би сходження сум (`SC-006`).
 * Квота ловить це на межі, щоб покупець не збирав форму заново після відмови
 * транзакції.
 */
function duplicateOf(refs: readonly RunDatasetRef[]): RunDatasetRef | undefined {
  const seen = new Set<string>()
  for (const ref of refs) {
    const key = `${ref.owner}/${ref.datasetId}`
    if (seen.has(key)) return ref
    seen.add(key)
  }
  return undefined
}

/**
 * Чому цей датасет не потрапляє в суму.
 *
 * Порядок перевірок — від стану датасету до згоди, і всередині згоди він
 * дзеркалить `Consent::check`. Саме порядок вирішує, яку причину побачить
 * покупець: на знятому датасеті «згоду відкликано» відправило б його
 * розбиратися не туди.
 */
function ineligibleReason(
  state: QuoteDatasetState,
  stored: boolean,
  request: { useType: UseTypeName; buyerCategory: BuyerCategoryName },
  now: bigint,
): QuoteIneligibleReason | null {
  if (state.dataset === null) return 'unregistered'
  if (state.dataset.status === 'retired') return 'retired'
  // Зареєстрований датасет без байтів у сховищі порахувати нічим: прогін по
  // ньому впаде на публікації в MPC, а не на перевірці згоди.
  if (!stored) return 'ciphertext-missing'
  return checkConsent(state.consent, { ...request, now })
}

/**
 * Параметри рецепта в розкладку, яку читає програма.
 *
 * Розгалуження за назвою рецепта, а не одна функція на всіх: розкладка —
 * властивість контуру, і рецепт із `T044` матиме свою. `never` у кінці
 * означає, що новий рядок каталогу без своєї розкладки не збереться, а не
 * поїде в мережу з чужими байтами.
 */
function encodeRecipeParams(recipe: Recipe, params: Record<string, unknown>): Uint8Array {
  if (recipe.name === 'frequencies') {
    return encodeFrequenciesParams(params as FrequenciesParams)
  }
  throw new Error(`розкладка параметрів рецепта ${recipe.name} не описана`)
}

/**
 * Назви датасетів для стану прогону.
 *
 * У `Run.datasets[]` лежать адреси PDA, а вони не обертаються: пара «власник +
 * ідентифікатор» дає адресу, але не навпаки. Зворотного індексу в каталозі
 * немає й заводити його зараз не варто — він був би третім місцем, де та сама
 * правда може розійтися з ланцюгом. Тому каталог перечитується цілком і
 * зіставляється деривацією: до `T004` це десятки рядків, і саме цю ціну
 * `fsCatalog` уже платить у `listDatasets`.
 *
 * Датасет, якого каталог не знає, лишається рядком без назви. Прогін
 * показується все одно: за нього вже заплачено, і рядок з адресою чесніший за
 * відсутній.
 */
async function resolvePoolNames(
  catalog: CatalogStore,
  addresses: readonly SolanaAddress[],
): Promise<Map<string, DatasetRecord>> {
  const wanted = new Set(addresses)
  const byAddress = new Map<string, DatasetRecord>()
  if (wanted.size === 0) return byAddress

  const page = await catalog.listDatasets({
    includePending: true,
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
  })

  for (const record of page.items) {
    const address = deriveDatasetAddress(record.owner, record.datasetId)
    if (wanted.has(address)) byAddress.set(address, record)
  }

  return byAddress
}

/** Байти з ланцюга → 32 байти шістнадцятково, як їх приймає схема відповіді. */
function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/**
 * Переоцінка на одному датасеті, яка не влізла в u64.
 *
 * Обгортка над `QuoteOverflowError` існує заради одного поля: покупець має
 * побачити, **який** датасет зламав арифметику. Без нього відповідь каже «сума
 * не вміщається» на пулі з п'ятдесяти рядків, і шукати доводиться перебором.
 */
class PoolOverflowError extends Error {
  override readonly name = 'PoolOverflowError'
  readonly datasetId: DatasetId

  constructor(datasetId: DatasetId, message: string) {
    super(message)
    this.datasetId = datasetId
  }
}

interface PoolEvaluation {
  lines: QuoteLine[]
  amounts: TokenAmount[]
  /** Чинна версія згоди по кожному придатному датасету, за його порядком у пулі. */
  consentVersions: Map<number, number>
}

/**
 * Оцінка складу пулу — спільна для квоти й замовлення.
 *
 * Обидва маршрути мусять відповідати однаково: покупець підписує рівно те, за
 * що йому назвали ціну, і друга реалізація тих самих перевірок розійшлася б із
 * першою на першій же зміні порядку причин. `undefined` означає, що читач
 * повернув коротшу відповідь, ніж запит, — це наша помилка, а не покупця.
 */
async function evaluatePool(
  services: RunServices,
  request: {
    datasets: readonly RunDatasetRef[]
    useType: UseTypeName
    buyerCategory: BuyerCategoryName
  },
  chain: QuoteChainState,
): Promise<PoolEvaluation | undefined> {
  // Каталог питається пачкою з тієї ж причини, що й ланцюг: п'ятдесят
  // послідовних читань сховища на одну відповідь — це вартість, помітна в
  // `SC-010`, і жодне з них не залежить від інших.
  const records = await Promise.all(
    request.datasets.map((ref) => services.catalog.getDataset(ref.owner, ref.datasetId)),
  )

  const lines: QuoteLine[] = []
  const amounts: TokenAmount[] = []
  const consentVersions = new Map<number, number>()

  for (const [index, ref] of request.datasets.entries()) {
    const state = chain.datasets[index]
    if (state === undefined) return undefined

    const reason = ineligibleReason(
      state,
      records[index]?.status === 'stored',
      { useType: request.useType, buyerCategory: request.buyerCategory },
      chain.now,
    )

    const dataset = state.dataset
    if (reason !== null || dataset === null) {
      lines.push({
        owner: ref.owner,
        datasetId: ref.datasetId,
        datasetAddress: state.datasetAddress,
        eligible: false,
        reason: reason ?? 'unregistered',
      })
      continue
    }

    let amount: TokenAmount
    try {
      amount = datasetUpperBound(dataset.pricePer1k, dataset.recordCountClaimed)
    } catch (error) {
      if (error instanceof QuoteOverflowError) {
        throw new PoolOverflowError(ref.datasetId, error.message)
      }
      throw error
    }

    amounts.push(amount)
    consentVersions.set(index, dataset.consentVersion)
    lines.push({
      owner: ref.owner,
      datasetId: ref.datasetId,
      datasetAddress: state.datasetAddress,
      eligible: true,
      pricePer1k: dataset.pricePer1k.toString(),
      recordCountClaimed: dataset.recordCountClaimed.toString(),
      upperBound: amount.toString(),
    })
  }

  return { lines, amounts, consentVersions }
}

export function runRoutes(deps: RunRoutesDeps) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  const services = configure(deps)

  routes.post('/runs/quote', requireAuth(deps.verify), async (c) => {
    if (services === undefined) return fail(c, 'INTERNAL', 'внутрішня помилка')

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return fail(c, 'INVALID_INPUT', 'тіло запиту не є JSON')
    }

    const request = runQuoteRequestSchema.parse(raw)

    const recipe = findRecipe(request.recipeId)
    if (recipe === undefined) {
      // Каталог рецептів фіксований (`FR-011a`), і невідомий номер — це не
      // «поки не реалізовано», а «такого рецепта не буде без нашої зміни».
      return fail(c, 'INVALID_INPUT', `рецепта ${request.recipeId} немає в каталозі`)
    }

    // Параметри розбирає рецепт: їхню форму оголошує він, і підставлені
    // значення повертаються покупцю, щоб він бачив, за що саме йому назвали ціну.
    const params = recipe.params.parse(request.params) as Record<string, unknown>

    const duplicate = duplicateOf(request.datasets)
    if (duplicate !== undefined) {
      return fail(c, 'INVALID_INPUT', `датасет ${duplicate.datasetId} названо двічі`, {
        owner: duplicate.owner,
        datasetId: duplicate.datasetId,
      })
    }

    let chain: QuoteChainState
    try {
      chain = await services.readQuoteChain(request.datasets)
    } catch (error) {
      return chainFailure(c, error)
    }

    let evaluation: PoolEvaluation | undefined
    try {
      evaluation = await evaluatePool(services, request, chain)
    } catch (error) {
      if (error instanceof PoolOverflowError) {
        return fail(c, 'INVALID_INPUT', error.message, { datasetId: error.datasetId })
      }
      throw error
    }
    if (evaluation === undefined) {
      // Читач повертає рядок на кожен запит; коротша відповідь означала б, що
      // ціни поїхали не тим датасетам.
      return fail(c, 'INTERNAL', 'внутрішня помилка')
    }

    let upperBound: TokenAmount
    try {
      upperBound = poolUpperBound(evaluation.amounts)
    } catch (error) {
      if (error instanceof QuoteOverflowError) return fail(c, 'INVALID_INPUT', error.message)
      throw error
    }

    // Ціна порахована, але замовити можна не завжди — і це окреме твердження.
    // Відповідати помилкою тут було б неправдою: питання «скільки коштує» має
    // відповідь, і покупець має її бачити разом із причиною, чому саме зараз ні.
    const eligibleCount = evaluation.amounts.length
    const blocker = chain.paused
      ? 'platform-paused'
      : eligibleCount === 0
        ? 'no-eligible-datasets'
        : null

    const quote: RunQuote = runQuoteSchema.parse({
      recipeId: recipe.id,
      recipe: recipe.name,
      useType: request.useType,
      buyerCategory: request.buyerCategory,
      params,
      upperBound: upperBound.toString(),
      feeBps: chain.feeBps,
      currency: chain.mint,
      datasets: evaluation.lines,
      eligibleCount,
      orderable: blocker === null,
      blocker,
    })

    return c.json(quote)
  })

  /**
   * Замовлення прогону (`FR-013`, `FR-015a`) — `T029`.
   *
   * Віддає **неспідписану інструкцію**, а не транзакцію й не підпис. Гроші
   * рухає покупець; усе, що робить API, — складає байти з тих самих ончейн-цін,
   * з яких щойно назвав ціну.
   *
   * # Чому перевірки повторюються тут
   *
   * Вирішує все одно програма: вона перевірить згоду кожного датасету сама й
   * відхилить транзакцію, хай що відповість цей маршрут (`FR-006`). Перевірка
   * тут потрібна для іншого — щоб покупець дізнався про відкликану згоду до
   * підпису, а не з `0x1771` у гаманці.
   *
   * # Чого тут немає
   *
   * Прив'язки «сесія ↔ адреса покупця». Інструкція неспідписана, і зібрати її
   * на чужу адресу означає віддати байти, які може виконати лише власник тієї
   * адреси. Вимагати прив'язки означало б не пускати покупця, який нічого не
   * реєстрував, — а таких більшість.
   */
  routes.post('/runs', requireAuth(deps.verify), async (c) => {
    if (services === undefined || services.buildRunOrder === undefined) {
      return fail(c, 'INTERNAL', 'внутрішня помилка')
    }

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return fail(c, 'INVALID_INPUT', 'тіло запиту не є JSON')
    }

    const request = runOrderRequestSchema.parse(raw)

    const recipe = findRecipe(request.recipeId)
    if (recipe === undefined) {
      return fail(c, 'INVALID_INPUT', `рецепта ${request.recipeId} немає в каталозі`)
    }
    const params = recipe.params.parse(request.params) as Record<string, unknown>

    if (request.datasets.length > MAX_RUN_DATASETS) {
      return fail(
        c,
        'INVALID_INPUT',
        `прогін вміщає до ${MAX_RUN_DATASETS} датасетів, отримано ${request.datasets.length}`,
      )
    }

    const duplicate = duplicateOf(request.datasets)
    if (duplicate !== undefined) {
      return fail(c, 'INVALID_INPUT', `датасет ${duplicate.datasetId} названо двічі`, {
        owner: duplicate.owner,
        datasetId: duplicate.datasetId,
      })
    }

    const dispatcher = request.dispatcher ?? services.dispatcher
    if (dispatcher === undefined) {
      // Платформа без диспетчера — законна; прогін без нього — ні. Публікацію
      // в MPC мусить хтось довести до кінця, і мовчазна підстановка нашого
      // ключа була б повноваженням, узятим без спитку.
      return fail(
        c,
        'INVALID_INPUT',
        'диспетчера не названо, а платформа свого не публікує — назвіть його явно',
      )
    }

    let chain: QuoteChainState
    try {
      chain = await services.readQuoteChain(request.datasets)
    } catch (error) {
      return chainFailure(c, error)
    }

    if (chain.paused) {
      return fail(c, 'PLATFORM_PAUSED', 'платформа зупинила прийом нових прогонів', {
        refusal: 'platform-paused',
      })
    }

    let evaluation: PoolEvaluation | undefined
    try {
      evaluation = await evaluatePool(services, request, chain)
    } catch (error) {
      if (error instanceof PoolOverflowError) {
        return fail(c, 'INVALID_INPUT', error.message, { datasetId: error.datasetId })
      }
      throw error
    }
    if (evaluation === undefined) return fail(c, 'INTERNAL', 'внутрішня помилка')

    const ineligible = evaluation.lines.flatMap((line) =>
      line.eligible ? [] : [{ owner: line.owner, datasetId: line.datasetId, reason: line.reason }],
    )
    if (ineligible.length > 0) {
      // Усі одразу, а не перша: покупець із пулом на п'ятдесят датасетів інакше
      // дізнавався б про проблеми по одній.
      return fail(c, 'CONSENT_VIOLATION', 'прогін не складається з цим складом пулу', {
        refusal: 'datasets-ineligible',
        ineligible,
      })
    }

    let escrow: TokenAmount
    try {
      escrow = poolUpperBound(evaluation.amounts)
    } catch (error) {
      if (error instanceof QuoteOverflowError) return fail(c, 'INVALID_INPUT', error.message)
      throw error
    }

    const maxEscrow = BigInt(request.maxEscrow)
    if (maxEscrow < escrow) {
      // Стеля нижча за ціну — це не помилка запиту, а розбіжність із тим, що
      // покупець бачив: власник підняв ціну між квотою й підписом.
      return fail(c, 'INSUFFICIENT_ESCROW', 'стеля покупця нижча за вартість прогону', {
        refusal: 'escrow-below-price',
        escrow: escrow.toString(),
      })
    }

    const pool = request.datasets.map((ref, index) => ({
      ref,
      consentVersion: evaluation.consentVersions.get(index) ?? 0,
    }))

    const built = await services.buildRunOrder({
      buyer: request.buyer,
      mint: chain.mint,
      nonce: BigInt(request.nonce),
      recipeId: recipe.id,
      useType: useTypeBit(request.useType),
      buyerCategory: buyerCategoryBit(request.buyerCategory),
      maxEscrow,
      buyerX25519: request.buyerX25519,
      dispatcher,
      recipeParams: encodeRecipeParams(recipe, params),
      datasets: pool.map((entry) => ({
        owner: entry.ref.owner,
        datasetId: entry.ref.datasetId,
        consentVersion: entry.consentVersion,
      })),
    })

    const order: RunOrder = runOrderSchema.parse({
      runAddress: built.runAddress,
      buyer: request.buyer,
      nonce: request.nonce,
      dispatcher,
      escrow: escrow.toString(),
      maxEscrow: request.maxEscrow,
      feeBps: chain.feeBps,
      currency: chain.mint,
      datasets: evaluation.lines.map((line, index) => ({
        owner: line.owner,
        datasetId: line.datasetId,
        datasetAddress: line.datasetAddress,
        consentVersion: evaluation.consentVersions.get(index) ?? 0,
        pricePer1k: line.eligible ? line.pricePer1k : '0',
        recordCountClaimed: line.eligible ? line.recordCountClaimed : '0',
      })),
      instruction: built.instruction,
    })

    return c.json(order, 201)
  })

  /**
   * Стан прогону (`FR-013`, `FR-018b`) — `T029`.
   *
   * Шлях із покупцем і нонсом, а не з адресою прогону: саме ці два числа знає
   * той, хто щойно підписав замовлення, і саме з них деривується адреса. URL,
   * який вимагає адресу, змусив би клієнта тримати ще одне поле, обчислюване
   * з двох інших.
   *
   * Без автентифікації навмисно. Обидва акаунти публічні в мережі, і `FR-025`
   * прямо вимагає, щоб журнал звіряла третя сторона. Замок тут не додав би
   * приватності — лише зробив би нашу відповідь менш доступною за ланцюг.
   */
  routes.get('/runs/:buyer/:nonce', async (c) => {
    if (services === undefined || services.readRun === undefined) {
      return fail(c, 'INTERNAL', 'внутрішня помилка')
    }

    const buyer = solanaAddressSchema.parse(c.req.param('buyer'))
    const nonceRaw = u64StringSchema.parse(c.req.param('nonce'))
    const nonce = BigInt(nonceRaw)
    if (nonce > U64_MAX) return fail(c, 'INVALID_INPUT', 'нонс прогону не вміщається в u64')

    let state: Awaited<ReturnType<RunReader>>
    try {
      state = await services.readRun(buyer, nonce)
    } catch (error) {
      return chainFailure(c, error)
    }

    const run = state.run
    if (run === null) return fail(c, 'NOT_FOUND', 'прогону не знайдено')

    const recipe = findRecipe(run.recipeId)
    const addresses = run.datasets.map((entry) =>
      solanaAddressSchema.parse(entry.dataset.toBase58()),
    )
    const known = await resolvePoolNames(services.catalog, addresses)

    const view: RunView = runViewSchema.parse({
      runAddress: state.runAddress,
      buyer: solanaAddressSchema.parse(run.buyer.toBase58()),
      nonce: run.nonce.toString(),
      dispatcher: solanaAddressSchema.parse(run.dispatcher.toBase58()),
      status: run.status,
      recipeId: run.recipeId,
      // Номер без назви — це те, що читач мусив би розшифровувати сам; рецепта
      // поза каталогом програма не приймає, тож сюди він потрапити не може.
      recipe: recipe?.name ?? String(run.recipeId),
      useType: namedUses(run.useType)[0] ?? 'oncology',
      buyerCategory: namedCategories(run.buyerCategory)[0] ?? 'academic',
      params: decodeRecipeParams(recipe, run.recipeParams),
      feeBps: run.feeBps,
      escrowAmount: run.escrowAmount.toString(),
      settledCount: run.settledCount,
      settledAmount: run.settledAmount.toString(),
      refunded: run.refunded,
      recordsIncluded: run.recordsIncluded,
      suppressed: run.suppressed,
      datasetCursor: run.datasetCursor,
      foldedBatches: run.foldedBatches,
      foldedHash: run.foldedHash,
      resultHash: run.resultHash,
      createdAt: run.createdAt.toString(),
      datasets: run.datasets.map((entry, index) => {
        const address = addresses[index] as SolanaAddress
        const record = known.get(address)
        return {
          datasetAddress: address,
          ...(record === undefined
            ? {}
            : {
                owner: record.owner,
                datasetId: record.datasetId,
                title: record.metadata.title,
              }),
          pricePer1k: entry.pricePer1k.toString(),
          recordsIncluded: entry.recordsIncluded,
          belowFloor: entry.belowFloor,
          settled: entry.settled,
        }
      }),
      result:
        state.result === null
          ? null
          : {
              encryptionKey: toHex(state.result.encryptionKey),
              nonce: state.result.nonce.toString(),
              ciphertexts: state.result.ciphertexts.map(toHex),
              recordsIncluded: state.result.recordsIncluded,
              suppressed: state.result.suppressed,
            },
    })

    return c.json(view)
  })

  return routes
}
