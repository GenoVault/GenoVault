import {
  type ApiError,
  apiErrorSchema,
  type CiphertextUploadResponse,
  type ConsentTransaction,
  ciphertextUploadResponseSchema,
  consentTransactionSchema,
  type DatasetDetail,
  type DatasetList,
  datasetDetailSchema,
  datasetListSchema,
  type PlatformView,
  type ProgramRefusal,
  platformViewSchema,
  programRefusal,
  type RegisterDatasetResponse,
  type RunOrder,
  type RunQuote,
  type RunView,
  registerDatasetResponseSchema,
  runOrderSchema,
  runQuoteSchema,
  runViewSchema,
  type SetConsentRequest,
} from '@genovault/shared'
import type { z } from 'zod'
import { BLOCKER_TEXT, REASON_TEXT } from '@/lib/format'

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
    throw new ApiRequestError(0, 'UNKNOWN', 'VITE_API_URL is not set — the API is unavailable')
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
    throw new ApiRequestError(response.status, 'UNKNOWN', 'the response is not JSON')
  }

  const parsed = schema.safeParse(payload)
  if (!parsed.success) {
    // Контракт розійшовся. Це наша помилка, і мовчати про неї не можна:
    // мовчазне `undefined` далі виглядало б як порожній прогін.
    throw new ApiRequestError(
      response.status,
      'UNKNOWN',
      'the API response does not pass its own schema',
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
  return new ApiRequestError(status, 'UNKNOWN', `the server answered ${status}`)
}

function describeNetwork(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError')
    return 'the request was cancelled'
  return 'could not connect to the API'
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
 * The dataset catalog (`GET /datasets`).
 *
 * `query` is the filters as `datasetQuerySchema` reads them — strings, as a
 * query string carries them. The order screen asks with none; the catalog
 * screen with what the person typed (`T066`).
 */
export async function getDatasets(
  options: ApiOptions & { query?: Record<string, string> } = {},
): Promise<DatasetList> {
  const { query, ...rest } = options
  const search = query === undefined ? '' : new URLSearchParams(query).toString()
  return call(search === '' ? '/datasets' : `/datasets?${search}`, datasetListSchema, rest)
}

/** One dataset card with its chain state (`GET /datasets/:owner/:id`). */
export async function getDatasetDetail(
  owner: string,
  datasetId: string,
  options: ApiOptions = {},
): Promise<DatasetDetail> {
  return call(
    `/datasets/${encodeURIComponent(owner)}/${encodeURIComponent(datasetId)}`,
    datasetDetailSchema,
    options,
  )
}

/**
 * `POST /datasets` — the declaration before the bytes (`FR-001`).
 *
 * The body is plain JSON, typed here by hand rather than by
 * `RegisterDatasetRequest`: that type is the schema's **output**, with branded
 * strings and a `bigint` price, and the wire carries the input.
 */
export interface DatasetDeclaration {
  datasetId: string
  owner: string
  contentHash: string
  /** Base units of the mint, as a decimal string. */
  pricePer1k: string
  metadata: Record<string, unknown>
}

export async function postDataset(
  declaration: DatasetDeclaration,
  options: ApiOptions = {},
): Promise<RegisterDatasetResponse> {
  return call('/datasets', registerDatasetResponseSchema, {
    ...options,
    method: 'POST',
    body: JSON.stringify(declaration),
  })
}

/**
 * `PUT /datasets/:id/ciphertext` with upload progress.
 *
 * `XMLHttpRequest`, not `fetch`: `fetch` reports no upload progress, and the
 * envelope of ten thousand records is ~21 MB — minutes on a slow uplink that
 * the screen should count, not spin through.
 */
export function putCiphertext(
  datasetId: string,
  bytes: Uint8Array,
  options: ApiOptions & { onProgress?: (sent: number, total: number) => void } = {},
): Promise<CiphertextUploadResponse> {
  const url = `${base()}/datasets/${encodeURIComponent(datasetId)}/ciphertext`
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    if (options.token !== undefined && options.token !== null) {
      xhr.setRequestHeader('authorization', `Bearer ${options.token}`)
    }
    xhr.setRequestHeader('content-type', 'application/octet-stream')
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded, event.total)
    }
    xhr.onerror = () => reject(new ApiRequestError(0, 'UNKNOWN', 'could not reach the API'))
    xhr.onabort = () => reject(new ApiRequestError(0, 'UNKNOWN', 'request cancelled'))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(toError(xhr.status, xhr.responseText))
        return
      }
      let payload: unknown
      try {
        payload = JSON.parse(xhr.responseText)
      } catch {
        reject(new ApiRequestError(xhr.status, 'UNKNOWN', 'the response is not JSON'))
        return
      }
      const parsed = ciphertextUploadResponseSchema.safeParse(payload)
      if (parsed.success) resolve(parsed.data)
      else {
        reject(
          new ApiRequestError(
            xhr.status,
            'UNKNOWN',
            'the API response does not pass its own schema',
            {
              issues: parsed.error.issues,
            },
          ),
        )
      }
    }
    options.signal?.addEventListener('abort', () => xhr.abort())
    // A copy into a buffer of exactly the envelope's size: `send` takes the
    // whole underlying buffer of a view.
    xhr.send(bytes.slice().buffer)
  })
}

/**
 * A new consent version, by name (`T066a`). Answers with an **unsigned**
 * `set_consent`; the owner's wallet signs it.
 */
export async function postConsent(
  datasetId: string,
  request: SetConsentRequest,
  options: ApiOptions = {},
): Promise<ConsentTransaction> {
  return call(`/datasets/${encodeURIComponent(datasetId)}/consent`, consentTransactionSchema, {
    ...options,
    method: 'POST',
    body: JSON.stringify(request),
  })
}

/** Revocation of the current consent (`T066a`). Unsigned, like everything here. */
export async function deleteConsent(
  datasetId: string,
  options: ApiOptions = {},
): Promise<ConsentTransaction> {
  return call(`/datasets/${encodeURIComponent(datasetId)}/consent`, consentTransactionSchema, {
    ...options,
    method: 'DELETE',
  })
}

/**
 * Відмова самого ланцюга — названим обмеженням, а не кодом (`FR-008`, `T038`).
 *
 * Гаманець кидає `custom program error: 0x177c`, і до `T038` це доходило до
 * екрана як `INTERNAL` із сирим текстом: обмеження називала програма, а продукт
 * — ні. Ім'я береться з таблиці IDL (`programRefusal`), текст — із того самого
 * словника причин, яким квота пояснює непридатний датасет. Другого словника тут
 * навмисно немає: покупець має читати про відкликану згоду однаково і до
 * підпису, і після.
 *
 * Код відповіді вибирається лише заради поведінки екрана — `ErrorBlock`
 * пропонує повтор на одних кодах і не пропонує на інших. Відмова програми не
 * лікується повтором **жодна**, тож усе, що не `CONSENT_VIOLATION` і не
 * `PLATFORM_PAUSED`, лишається `INTERNAL`: вигадувати під кожен варіант окремий
 * код означало б обіцяти екрану розрізнення, якого в ньому немає.
 */
function fromRefusal(refusal: ProgramRefusal): ApiError['error'] {
  const details: Record<string, unknown> = {
    refusal: 'program-error',
    code: `0x${refusal.code.toString(16)}`,
    name: refusal.name,
    // Повідомлення самої програми — те, що покаже й експлорер.
    msg: refusal.msg,
  }

  if (refusal.violation !== null) {
    details.constraint = refusal.violation
    return {
      code: 'CONSENT_VIOLATION',
      message: `The chain refused the order. ${REASON_TEXT[refusal.violation]}.`,
      details,
    }
  }

  if (refusal.name === 'platformPaused') {
    return { code: 'PLATFORM_PAUSED', message: `${BLOCKER_TEXT['platform-paused']}.`, details }
  }

  return {
    code: 'INTERNAL',
    message: `The chain refused the transaction: ${refusal.name}.`,
    details,
  }
}

/**
 * Будь-яка невдача → форма, яку вміє показати `ErrorBlock`.
 *
 * Екрани показують помилки одним компонентом, і він розрізняє коди: на
 * `UPSTREAM_UNAVAILABLE` пропонує повтор, на `CONSENT_VIOLATION` — ні. Тому
 * назовні з клієнта йде не рядок, а код із повідомленням: рядок змусив би
 * екран вгадувати, що саме сталося, за текстом.
 *
 * Порядок розбору: спершу відповідь API (вона вже несе код), потім відмова
 * ланцюга, і лише потім усе інше. Навпаки не можна — `ApiRequestError` теж
 * буває з текстом, у якому трапляється код програми, і розбір ланцюга затер би
 * код, який сервер уже назвав.
 */
export function toApiError(error: unknown): ApiError['error'] {
  if (error instanceof ApiRequestError) {
    const code = error.code === 'UNKNOWN' ? 'INTERNAL' : error.code
    return error.details === undefined
      ? { code, message: error.message }
      : { code, message: error.message, details: error.details }
  }

  const refusal = programRefusal(error)
  if (refusal !== null) return fromRefusal(refusal)

  return {
    code: 'INTERNAL',
    message: error instanceof Error ? error.message : 'unknown error',
  }
}
