import type { SolanaAddress } from '@genovault/shared'
import { DatasetEnvelopeError } from '@genovault/shared'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import { fail } from './errors.ts'
import type { AuthVariables } from './middleware/auth.ts'
import { consentRoutes } from './routes/consent.ts'
import { datasetRoutes } from './routes/datasets.ts'
import { platformRoutes } from './routes/platform.ts'
import { recipeRoutes } from './routes/recipes.ts'
import { runRoutes } from './routes/runs.ts'
import { sessionRoutes } from './routes/session.ts'
import type { TokenVerifier } from './services/auth.ts'
import type { CatalogStore } from './services/catalog.ts'
import type {
  ChainReader,
  ConsentChainReader,
  ConsentIxBuilder,
  PlatformReader,
  QuoteChainReader,
  RegistrationBuilder,
  RegistrationChecker,
  RunOrderBuilder,
  RunReader,
} from './services/chain.ts'
import type { StorageDriver } from './services/storage.ts'

export interface AppDeps {
  /**
   * Перевіряч сесійного токена. Збирається в `server.ts` із змінних оточення,
   * щоб ненастроєна автентифікація падала на старті, а не на першому запиті;
   * у тестах підставляється напряму, без мережі й без ключів Privy.
   */
  verifyAccessToken?: TokenVerifier
  /**
   * Сервіси маршрутів датасету. Необов'язкові з тієї ж причини, що й
   * перевіряч: `createApp()` без них лишається валідним застосунком —
   * `/health` і 404 від них не залежать, — а маршрут, якому нікуди писати,
   * відповідає 500, а не вдає, що працює.
   */
  catalog?: CatalogStore | undefined
  storage?: StorageDriver | undefined
  buildRegistration?: RegistrationBuilder | undefined
  readChain?: ChainReader | undefined
  /** Which datasets are on chain, for the catalog list (decision 2026-10-07). */
  checkRegistered?: RegistrationChecker | undefined
  /**
   * Пакетний читач для квоти. Окремо від `readChain`, бо це інша форма
   * питання: картка питає про один датасет і переживає відсутню мережу,
   * квота питає про пул і без мережі не існує (`T023`).
   */
  readQuoteChain?: QuoteChainReader | undefined
  /** Збирач інструкції замовлення прогону (`T029`). Без нього `POST /runs` — 500. */
  buildRunOrder?: RunOrderBuilder | undefined
  /** Читач стану прогону з ланцюга. Дзеркала прогонів немає й не буде. */
  readRun?: RunReader | undefined
  readPlatform?: PlatformReader | undefined
  /** The consent routes' chain read and instruction builder (`T066a`). */
  readConsentChain?: ConsentChainReader | undefined
  buildConsentIx?: ConsentIxBuilder | undefined
  /**
   * Адреса диспетчера платформи (`Run.dispatcher` за замовчуванням).
   *
   * Необов'язкова: платформа без диспетчера законна. Тоді покупець мусить
   * назвати свого, і `POST /runs` без нього відмовляє явно.
   */
  dispatcher?: SolanaAddress | undefined
  baseUrl?: string | undefined
  maxCiphertextBytes?: number | undefined
  /**
   * Browser origins allowed to call the API (`T066`), exactly as the browser
   * sends them: `http://localhost:5173`, no path, no trailing slash.
   *
   * An explicit list and never `*`: every route but three takes a session
   * token, and a wildcard would let any page a signed-in owner visits read
   * their catalog with it. Empty — no CORS headers at all, and a browser on
   * another origin gets nothing; the CLI tools and tests do not care.
   */
  webOrigins?: readonly string[] | undefined
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<{ Variables: AuthVariables }>()

  const origins = deps.webOrigins ?? []
  if (origins.length > 0) {
    app.use(
      '*',
      cors({
        origin: [...origins],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: 600,
      }),
    )
  }

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.route('/', sessionRoutes(deps.verifyAccessToken))
  app.route(
    '/',
    datasetRoutes({
      verify: deps.verifyAccessToken,
      catalog: deps.catalog,
      storage: deps.storage,
      buildRegistration: deps.buildRegistration,
      readChain: deps.readChain,
      checkRegistered: deps.checkRegistered,
      baseUrl: deps.baseUrl,
      maxCiphertextBytes: deps.maxCiphertextBytes,
    }),
  )
  app.route(
    '/',
    consentRoutes({
      verify: deps.verifyAccessToken,
      catalog: deps.catalog,
      readConsentChain: deps.readConsentChain,
      buildConsentIx: deps.buildConsentIx,
    }),
  )
  app.route(
    '/',
    runRoutes({
      verify: deps.verifyAccessToken,
      catalog: deps.catalog,
      readQuoteChain: deps.readQuoteChain,
      buildRunOrder: deps.buildRunOrder,
      readRun: deps.readRun,
      dispatcher: deps.dispatcher,
    }),
  )
  app.route('/', platformRoutes({ readPlatform: deps.readPlatform, dispatcher: deps.dispatcher }))
  app.route('/', recipeRoutes())

  app.notFound((c) => fail(c, 'NOT_FOUND', 'маршрут не знайдено'))

  app.onError((error, c) => {
    if (error instanceof ZodError) {
      // Валідація на межі — це 400, а не 500. Zod 4 проганяє всі перевірки,
      // тому issues може містити кілька зауважень до одного поля.
      return fail(c, 'INVALID_INPUT', 'запит не пройшов валідацію', { issues: error.issues })
    }
    if (error instanceof DatasetEnvelopeError) {
      // Не шифротекст — це поламаний запит, а не збій сервера. Текст віддаємо
      // як є: він описує форму файлу й не містить нічого з його вмісту.
      return fail(c, 'INVALID_INPUT', error.message)
    }
    // Текст внутрішньої помилки назовні не йде: він регулярно містить фрагменти
    // запиту, а тут через запити проходять медичні дані.
    return fail(c, 'INTERNAL', 'внутрішня помилка')
  })

  return app
}

/**
 * `WEB_ORIGINS` — a comma-separated list of origins. Each one must be an origin
 * and nothing more: `http://localhost:5173/` with a slash never matches what a
 * browser sends, and the failure would look like a network error on the page.
 */
export function webOriginsFromEnv(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  return raw.split(',').map((entry) => {
    const value = entry.trim()
    let origin: string
    try {
      origin = new URL(value).origin
    } catch {
      throw new Error(`WEB_ORIGINS: "${value}" is not a URL`)
    }
    if (origin !== value) {
      throw new Error(`WEB_ORIGINS: "${value}" is not an origin — expected "${origin}"`)
    }
    return value
  })
}
