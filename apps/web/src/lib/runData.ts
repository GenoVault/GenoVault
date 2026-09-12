import type {
  ApiError,
  DatasetCard,
  FrequenciesParams,
  QuoteLine,
  RunQuote,
  RunView,
} from '@genovault/shared'
import {
  datasetCardSchema,
  quoteLineSchema,
  runQuoteSchema,
  runViewSchema,
} from '@genovault/shared'
import { useCallback, useEffect, useState } from 'react'
import { getDatasets, getPlatform, getRun, HAS_API, postQuote, toApiError } from '@/lib/api'
import { ineligibleReason } from '@/lib/quote'
import {
  type BuyerCategory,
  DATASETS,
  type Dataset,
  datasetKey,
  LIMITS,
  type Run as MockRun,
  RUNS,
  STABLE_MINT,
  type UseType,
} from '@/mockData'

/**
 * Одне джерело даних для шляху покупця (`T029`).
 *
 * # Чому мок і API мають одну форму
 *
 * До `T029` екрани говорили формою `mockData`, а API — формою
 * `packages/shared`. Це два словники на одну річ, і перемикання між ними
 * означало б переписати екрани. Тепер обидва джерела віддають **однакові**
 * `RunQuote` і `RunView`, тобто ті самі схеми, якими відповідає сервер: мок
 * став фікстурою за контрактом, а не другим контрактом. Коли `T066` вимкне
 * мок, екранам не доведеться змінитись нічим.
 *
 * # Чому це не бібліотека даних
 *
 * `useState` і `useEffect`, без react-query. Запитів тут три, кожен веде свій
 * екран, і кеш між ними нічого не економить — а от невидиме перечитування
 * після фокуса вікна на екрані, де щойно підписали транзакцію, показало б
 * стан «до» як стан «після».
 */

export interface Loadable<T> {
  data: T | null
  loading: boolean
  /** Відмова у формі, яку вміє показати `ErrorBlock`. `null` — відмови не було. */
  error: ApiError['error'] | null
  /** `false` — дані з `mockData`, і екран мусить сказати це вголос. */
  live: boolean
}

/** Чи ходять екрани в справжній API. Та сама роль, що в `HAS_PRIVY` для входу. */
export const LIVE_DATA = HAS_API

// ── Мок як фікстура за контрактом ─────────────────────────────────────────────

/** Датасет прототипу у формі картки каталогу. */
export function mockCard(dataset: Dataset): DatasetCard {
  // Через схему, а не приведенням типу: фікстура, яку не приймає власний
  // контракт, — це не дані прототипу, а майбутня помилка на живому API.
  // Саме так знайшлися три адреси власників, яких у base58 не буває.
  return datasetCardSchema.parse({
    datasetId: dataset.datasetId,
    owner: dataset.owner,
    // PDA прототипу немає й бути не може: він деривується програмою. Адреса
    // власника тут стоїть як заповнювач, і жоден екран її не показує як PDA.
    datasetAddress: dataset.owner,
    title: dataset.title,
    description: dataset.description,
    recordCount: dataset.records,
    markerCount: dataset.markers,
    source: dataset.source,
    pricePer1k: String(dataset.pricePer1k),
    createdAt: `${dataset.collectedFrom}T00:00:00.000Z`,
    updatedAt: `${dataset.updatedAt}T00:00:00.000Z`,
  })
}

function mockQuoteLine(
  dataset: Dataset,
  useType: UseType,
  buyerCategory: BuyerCategory,
): QuoteLine {
  const reason = ineligibleReason(dataset, useType, buyerCategory)
  const base = {
    owner: dataset.owner,
    datasetId: dataset.datasetId,
    datasetAddress: dataset.owner,
  }
  if (reason !== null) return quoteLineSchema.parse({ ...base, eligible: false, reason })

  const price = dataset.chain.state === 'registered' ? dataset.chain.pricePer1k : dataset.pricePer1k
  const records =
    dataset.chain.state === 'registered' ? dataset.chain.claimedRecords : dataset.records
  const thousands = Math.ceil(records / LIMITS.RECORDS_PER_PRICE_UNIT)

  return quoteLineSchema.parse({
    ...base,
    eligible: true,
    pricePer1k: String(price),
    recordCountClaimed: String(records),
    upperBound: String(price * thousands),
  })
}

/**
 * Квота прототипу — той самий контракт, що в `POST /runs/quote`.
 *
 * Арифметика тут навмисно проста й повторює `datasetUpperBound`: заокруглення
 * вгору на кожному датасеті окремо. Це не друга реалізація правила, а фікстура,
 * і `T066` викине її цілком.
 */
export function mockQuote(
  datasets: readonly Dataset[],
  useType: UseType,
  buyerCategory: BuyerCategory,
  params: FrequenciesParams,
  paused: boolean,
): RunQuote {
  const lines = datasets.map((dataset) => mockQuoteLine(dataset, useType, buyerCategory))
  const eligible = lines.filter((line) => line.eligible)
  const upperBound = eligible.reduce((sum, line) => sum + BigInt(line.upperBound), 0n)

  return runQuoteSchema.parse({
    recipeId: 1,
    recipe: 'frequencies',
    useType,
    buyerCategory,
    params: { ...params },
    upperBound: upperBound.toString(),
    feeBps: LIMITS.FEE_BPS,
    currency: STABLE_MINT.address,
    datasets: lines,
    eligibleCount: eligible.length,
    orderable: !paused && eligible.length > 0,
    blocker: paused ? 'platform-paused' : eligible.length === 0 ? 'no-eligible-datasets' : null,
  })
}

/** Прогін прототипу у формі `GET /runs/:buyer/:nonce`. */
export function mockRunView(run: MockRun): RunView {
  const owner = DATASETS[0]?.owner ?? STABLE_MINT.address
  return runViewSchema.parse({
    runAddress: owner,
    buyer: owner,
    nonce: '1',
    dispatcher: owner,
    status: run.status,
    recipeId: run.recipeId,
    recipe: 'frequencies',
    useType: run.useType,
    buyerCategory: run.buyerCategory,
    params: { ...run.filters },
    feeBps: run.feeBps,
    escrowAmount: String(run.upperBound),
    settledCount: run.settlement?.rows.length ?? 0,
    settledAmount: String(run.settlement?.totalToOwners ?? 0),
    refunded: run.settlement !== undefined,
    recordsIncluded: run.report?.cohortSize ?? 0,
    suppressed: false,
    datasetCursor: run.datasets.length,
    foldedBatches: run.progress?.batch ?? 0,
    foldedHash: 'a1'.repeat(32),
    resultHash: run.report === undefined ? null : '0f'.repeat(32),
    createdAt: '1757000000',
    datasets: run.datasets.map((entry, index) => ({
      datasetAddress: entry.owner,
      owner: entry.owner,
      datasetId: entry.datasetId,
      title: entry.ownerName,
      pricePer1k: String(run.settlement?.rows[index]?.charged ?? 0),
      recordsIncluded: run.settlement?.rows[index]?.recordsIncluded ?? 0,
      belowFloor: (run.settlement?.rows[index]?.recordsIncluded ?? 0) === 0,
      settled: run.settlement !== undefined,
    })),
    result: null,
  })
}

// ── Хуки ──────────────────────────────────────────────────────────────────────

/**
 * Датасети, з яких складається пул.
 *
 * У живому режимі — каталог із `GET /datasets`. Сторінка самого каталогу
 * (`CatalogPage`) поки лишається на моці — це `T066`, — тож у режимі з API два
 * екрани показують різні списки. Розбіжність названа вголос на екрані
 * замовлення, і це чесніше, ніж давати покупцю квотувати вигадані датасети
 * проти справжнього ланцюга: жоден із них не зареєстрований, і вся квота
 * складалася б із `unregistered`.
 */
export function useCatalog(token: string | null): Loadable<DatasetCard[]> {
  const [state, setState] = useState<Loadable<DatasetCard[]>>(() =>
    LIVE_DATA
      ? { data: null, loading: true, error: null, live: true }
      : { data: DATASETS.map(mockCard), loading: false, error: null, live: false },
  )

  useEffect(() => {
    if (!LIVE_DATA) return
    let alive = true
    const controller = new AbortController()

    getDatasets({ token, signal: controller.signal })
      .then((list) => {
        if (alive) setState({ data: list.items, loading: false, error: null, live: true })
      })
      .catch((error: unknown) => {
        if (alive) setState({ data: null, loading: false, error: toApiError(error), live: true })
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [token])

  return state
}

export interface QuoteRequest {
  datasets: { owner: string; datasetId: string }[]
  useType: UseType
  buyerCategory: BuyerCategory
  params: FrequenciesParams
}

/**
 * Квота на прогін.
 *
 * Порожній пул не йде в мережу зовсім: `POST /runs/quote` вимагає хоча б один
 * датасет, і запит, який гарантовано впаде на валідації, — це помилка на
 * екрані замість порожнього столу.
 */
export function useQuote(
  request: QuoteRequest,
  token: string | null,
  mockPaused: boolean,
): Loadable<RunQuote> {
  const [state, setState] = useState<Loadable<RunQuote>>({
    data: null,
    loading: LIVE_DATA,
    error: null,
    live: LIVE_DATA,
  })

  useEffect(() => {
    if (!LIVE_DATA) {
      const chosen = DATASETS.filter((dataset) =>
        request.datasets.some((ref) => datasetKey(dataset) === `${ref.owner}/${ref.datasetId}`),
      )
      setState({
        data: mockQuote(chosen, request.useType, request.buyerCategory, request.params, mockPaused),
        loading: false,
        error: null,
        live: false,
      })
      return
    }

    if (request.datasets.length === 0) {
      setState({ data: null, loading: false, error: null, live: true })
      return
    }

    let alive = true
    const controller = new AbortController()
    setState((prev) => ({ ...prev, loading: true }))

    postQuote(
      {
        recipeId: 1,
        useType: request.useType,
        buyerCategory: request.buyerCategory,
        datasets: request.datasets,
        params: { ...request.params },
      },
      { token, signal: controller.signal },
    )
      .then((quote) => {
        if (alive) setState({ data: quote, loading: false, error: null, live: true })
      })
      .catch((error: unknown) => {
        if (alive) setState({ data: null, loading: false, error: toApiError(error), live: true })
      })

    return () => {
      alive = false
      controller.abort()
    }
    // `request` приходить із `useMemo` викликача: об'єкт, зібраний у рендері,
    // давав би новий запит на кожен рендер.
  }, [token, mockPaused, request])

  return state
}

/**
 * Стан прогону.
 *
 * `refresh` — руками, без інтервалу. Прогін на 10 000 записів іде хвилинами
 * (`SC-003`), і опитування щосекунди дало б сотні читань ланцюга заради
 * незміненого статусу. Автоматичне оновлення з'явиться тоді, коли буде що
 * оновлювати, — після `T030`.
 */
export function useRunView(
  buyer: string | null,
  nonce: string | null,
): Loadable<RunView> & { refresh: () => void } {
  const [state, setState] = useState<Loadable<RunView>>({
    data: null,
    loading: LIVE_DATA,
    error: null,
    live: LIVE_DATA,
  })

  /**
   * Читання винесене з ефекту, щоб `refresh` кликало рівно те саме.
   *
   * Лічильник-тригер у списку залежностей ефекту працював би так само, але
   * читався б як «оновити, коли зміниться число», а насправді означає «оновити
   * зараз». Одна функція на два виклики не лишає місця для цієї різниці.
   */
  const load = useCallback(
    (signal?: AbortSignal) => {
      if (!LIVE_DATA) {
        // У моці «прогін» обирається статусом із URL: інших прогонів немає.
        const run = RUNS[(nonce ?? 'completed') as keyof typeof RUNS] ?? RUNS.completed
        setState({ data: mockRunView(run), loading: false, error: null, live: false })
        return
      }
      if (buyer === null || nonce === null) {
        setState({ data: null, loading: false, error: null, live: true })
        return
      }

      setState((prev) => ({ ...prev, loading: true }))
      getRun(buyer, nonce, signal === undefined ? {} : { signal })
        .then((run) => {
          if (signal?.aborted !== true) {
            setState({ data: run, loading: false, error: null, live: true })
          }
        })
        .catch((error: unknown) => {
          if (signal?.aborted !== true) {
            setState({ data: null, loading: false, error: toApiError(error), live: true })
          }
        })
    },
    [buyer, nonce],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  return { ...state, refresh: useCallback(() => load(), [load]) }
}

/**
 * Диспетчер, якого публікує платформа, і її комісія.
 *
 * У моці диспетчера немає: показувати вигадану адресу як «кому ви даєте
 * повноваження» — саме те хибне відчуття доведеності, від якого застерігає
 * визначення `M0`.
 */
export function usePlatform(): Loadable<{ dispatcher: string | null; feeBps: number }> {
  const [state, setState] = useState<Loadable<{ dispatcher: string | null; feeBps: number }>>(() =>
    LIVE_DATA
      ? { data: null, loading: true, error: null, live: true }
      : {
          data: { dispatcher: null, feeBps: LIMITS.FEE_BPS },
          loading: false,
          error: null,
          live: false,
        },
  )

  useEffect(() => {
    if (!LIVE_DATA) return
    let alive = true
    const controller = new AbortController()

    getPlatform({ signal: controller.signal })
      .then((platform) => {
        if (alive) {
          setState({
            data: { dispatcher: platform.dispatcher, feeBps: platform.feeBps },
            loading: false,
            error: null,
            live: true,
          })
        }
      })
      .catch((error: unknown) => {
        if (alive) setState({ data: null, loading: false, error: toApiError(error), live: true })
      })

    return () => {
      alive = false
      controller.abort()
    }
  }, [])

  return state
}
