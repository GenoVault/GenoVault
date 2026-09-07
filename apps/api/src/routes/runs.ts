import type { BuyerCategoryName, UseTypeName } from '@genovault/shared'
import {
  checkConsent,
  datasetUpperBound,
  findRecipe,
  poolUpperBound,
  type QuoteIneligibleReason,
  type QuoteLine,
  QuoteOverflowError,
  type RunDatasetRef,
  type RunQuote,
  runQuoteRequestSchema,
  runQuoteSchema,
  type TokenAmount,
} from '@genovault/shared'
import { Hono } from 'hono'
import { fail } from '../errors.ts'
import { type AuthVariables, requireAuth } from '../middleware/auth.ts'
import type { TokenVerifier } from '../services/auth.ts'
import type { CatalogStore } from '../services/catalog.ts'
import {
  ChainStateError,
  type QuoteChainReader,
  type QuoteDatasetState,
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
}

interface RunServices {
  catalog: CatalogStore
  readQuoteChain: QuoteChainReader
}

function configure(deps: RunRoutesDeps): RunServices | undefined {
  const { catalog, readQuoteChain } = deps
  if (catalog === undefined || readQuoteChain === undefined) return undefined
  return { catalog, readQuoteChain }
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

    let chain: Awaited<ReturnType<QuoteChainReader>>
    try {
      chain = await services.readQuoteChain(request.datasets)
    } catch (error) {
      if (error instanceof ChainStateError) {
        return error.reason === 'unavailable'
          ? fail(c, 'UPSTREAM_UNAVAILABLE', 'мережа зараз не відповідає — вартість не порахувати')
          : fail(c, 'INTERNAL', 'внутрішня помилка')
      }
      throw error
    }

    // Каталог питається пачкою з тієї ж причини, що й ланцюг: п'ятдесят
    // послідовних читань сховища на одну відповідь — це вартість, помітна в
    // `SC-010`, і жодне з них не залежить від інших.
    const records = await Promise.all(
      request.datasets.map((ref) => services.catalog.getDataset(ref.owner, ref.datasetId)),
    )

    const lines: QuoteLine[] = []
    const amounts: TokenAmount[] = []

    for (const [index, ref] of request.datasets.entries()) {
      const state = chain.datasets[index]
      if (state === undefined) {
        // Читач повертає рядок на кожен запит; коротша відповідь означала б, що
        // ціни поїхали не тим датасетам.
        return fail(c, 'INTERNAL', 'внутрішня помилка')
      }

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
          return fail(c, 'INVALID_INPUT', error.message, { datasetId: ref.datasetId })
        }
        throw error
      }

      amounts.push(amount)
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

    let upperBound: TokenAmount
    try {
      upperBound = poolUpperBound(amounts)
    } catch (error) {
      if (error instanceof QuoteOverflowError) return fail(c, 'INVALID_INPUT', error.message)
      throw error
    }

    // Ціна порахована, але замовити можна не завжди — і це окреме твердження.
    // Відповідати помилкою тут було б неправдою: питання «скільки коштує» має
    // відповідь, і покупець має її бачити разом із причиною, чому саме зараз ні.
    const eligibleCount = amounts.length
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
      datasets: lines,
      eligibleCount,
      orderable: blocker === null,
      blocker,
    })

    return c.json(quote)
  })

  return routes
}
