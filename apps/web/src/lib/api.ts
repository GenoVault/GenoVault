import {
  type ApiError,
  apiErrorSchema,
  type DatasetList,
  datasetListSchema,
  type PlatformView,
  platformViewSchema,
  type RunOrder,
  type RunQuote,
  type RunView,
  runOrderSchema,
  runQuoteSchema,
  runViewSchema,
} from '@genovault/shared'
import type { z } from 'zod'

/**
 * Клієнт `apps/api` (`T029`).
 *
 * # Чому мок не зник
 *
 * `VITE_API_URL` порожній — застосунок працює на `mockData`, як його зробила
 * `M0`, і каже про це вголос. Той самий патерн, що й у входу (`HAS_PRIVY`):
 * вибір робиться модульною константою, а не в рендері. Прототип, який мовчки
 * показує вигадані числа як справжні, — це не зручність, а хибне твердження
 * про доведеність.
 *
 * # Чому кожна відповідь розбирається схемою
 *
 * Схеми ті самі, що ними ж відповідає сервер (`packages/shared`), і це не
 * подвійна робота: без розбору тут `RunView` був би обіцянкою типу, а не
 * перевіркою, і перша ж розбіжність контрактів проявилась би не помилкою, а
 * порожнім місцем на екрані. Ціна відома — зайвий прохід по відповіді.
 */

const raw: unknown = import.meta.env.VITE_API_URL

/** Адреса API або `null`, якщо змінної немає чи вона порожня. */
export const API_URL: string | null =
  typeof raw === 'string' && raw.trim() !== '' ? raw.trim().replace(/\/+$/, '') : null

/** Чи ходить застосунок у справжній API. */
export const HAS_API: boolean = API_URL !== null

/**
 * Відмова API у формі, яку екран уміє показати.
 *
 * Код і деталі несуться окремо від тексту: `CONSENT_VIOLATION` з переліком
 * непридатних датасетів екран показує списком, а не абзацом, і розбирати для
 * цього повідомлення було б розбором чужої мови.
 */
export class ApiRequestError extends Error {
  override readonly name = 'ApiRequestError'
  readonly status: number
  readonly code: ApiError['error']['code'] | 'UNKNOWN'
  readonly details: Record<string, unknown> | undefined

  constructor(
    status: number,
    code: ApiError['error']['code'] | 'UNKNOWN',
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface ApiOptions {
  /** Сесійний токен Privy. `null` — маршрут публічний або сесії ще немає. */
  token?: string | null
  signal?: AbortSignal
}

function base(): string {
  if (API_URL === null) {
    // Викликач мусив спитати `HAS_API` раніше. Кидаємо тут, а не повертаємо
    // порожню відповідь: мовчазний `null` виглядав би як «сервер відповів».
    throw new ApiRequestError(0, 'UNKNOWN', 'VITE_API_URL не заданий — API недоступний')
  }
  return API_URL
}

async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit & ApiOptions = {},
): Promise<T> {
  const { token, signal, ...rest } = init
  const headers = new Headers(rest.headers)
  if (token !== undefined && token !== null) headers.set('authorization', `Bearer ${token}`)
  if (rest.body !== undefined) headers.set('content-type', 'application/json')

  let response: Response
  try {
    response = await fetch(`${base()}${path}`, {
      ...rest,
      headers,
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    // Мережі немає взагалі — це не відповідь сервера, і плутати ці два випадки
    // означає показувати «внутрішня помилка» там, де вимкнений Wi-Fi.
    throw new ApiRequestError(0, 'UNKNOWN', describeNetwork(error))
  }

  const text = await response.text()
  if (!response.ok) throw toError(response.status, text)

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new ApiRequestError(response.status, 'UNKNOWN', 'відповідь не є JSON')
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    // Контракт розійшовся. Це наша помилка, і мовчати про неї не можна:
    // мовчазне `undefined` далі виглядало б як порожній прогін.
    throw new ApiRequestError(
      response.status,
      'UNKNOWN',
      'відповідь API не проходить власну схему',
      { issues: parsed.error.issues },
    )
  }
  return parsed.data
}

function toError(status: number, text: string): ApiRequestError {
  try {
    const parsed = apiErrorSchema.safeParse(JSON.parse(text))
    if (parsed.success) {
      const { code, message, details } = parsed.data.error
      return new ApiRequestError(status, code, message, details)
    }
  } catch {
    // Тіло не JSON — нижче.
  }
  return new ApiRequestError(status, 'UNKNOWN', `сервер відповів ${status}`)
}

function describeNetwork(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'запит скасовано'
  return 'не вдалося з’єднатися з API'
}

/** Стан платформи: комісія, мінт, пауза, диспетчер. Без токена. */
export async function getPlatform(options: ApiOptions = {}): Promise<PlatformView> {
  return call('/platform', platformViewSchema, options)
}

export interface QuoteInput {
  recipeId: number
  useType: string
  buyerCategory: string
  datasets: { owner: string; datasetId: string }[]
  params: Record<string, unknown>
}

/** Верхня оцінка вартості прогону (`FR-015a`). */
export async function postQuote(input: QuoteInput, options: ApiOptions = {}): Promise<RunQuote> {
  return call('/runs/quote', runQuoteSchema, {
    ...options,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export interface OrderInput extends QuoteInput {
  buyer: string
  nonce: string
  maxEscrow: string
  buyerX25519: string
  dispatcher?: string
}

/** Замовлення прогону. Повертає **неспідписану** інструкцію — підписує гаманець. */
export async function postOrder(input: OrderInput, options: ApiOptions = {}): Promise<RunOrder> {
  return call('/runs', runOrderSchema, {
    ...options,
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Стан прогону з ланцюга. Без токена — обидва акаунти публічні (`FR-025`). */
export async function getRun(
  buyer: string,
  nonce: string,
  options: ApiOptions = {},
): Promise<RunView> {
  return call(`/runs/${buyer}/${nonce}`, runViewSchema, options)
}

/**
 * Каталог датасетів.
 *
 * Живе тут, а не в окремому клієнті каталогу: `T029` кличе його рівно для
 * одного — щоб пул прогону складався з датасетів, які справді є в мережі.
 * Сторінка каталогу переїде на нього в `T066`.
 */
export async function getDatasets(options: ApiOptions = {}): Promise<DatasetList> {
  return call('/datasets', datasetListSchema, options)
}

/**
 * Будь-яка невдача → форма, яку вміє показати `ErrorBlock`.
 *
 * Екрани показують помилки одним компонентом, і він розрізняє коди: на
 * `UPSTREAM_UNAVAILABLE` пропонує повтор, на `CONSENT_VIOLATION` — ні. Тому
 * назовні з клієнта йде не рядок, а код із повідомленням: рядок змусив би
 * екран вгадувати, що саме сталося, за текстом.
 */
export function toApiError(error: unknown): ApiError['error'] {
  if (error instanceof ApiRequestError) {
    const code = error.code === 'UNKNOWN' ? 'INTERNAL' : error.code
    return error.details === undefined
      ? { code, message: error.message }
      : { code, message: error.message, details: error.details }
  }
  return {
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : 'невідома помилка',
  }
}
