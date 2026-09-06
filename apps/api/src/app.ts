import { DatasetEnvelopeError } from '@genovault/shared'
import { Hono } from 'hono'
import { ZodError } from 'zod'
import { fail } from './errors.ts'
import type { AuthVariables } from './middleware/auth.ts'
import { datasetRoutes } from './routes/datasets.ts'
import { sessionRoutes } from './routes/session.ts'
import type { TokenVerifier } from './services/auth.ts'
import type { CatalogStore } from './services/catalog.ts'
import type { RegistrationBuilder } from './services/chain.ts'
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
  catalog?: CatalogStore
  storage?: StorageDriver
  buildRegistration?: RegistrationBuilder
  baseUrl?: string
  maxCiphertextBytes?: number
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.route('/', sessionRoutes(deps.verifyAccessToken))
  app.route(
    '/',
    datasetRoutes({
      verify: deps.verifyAccessToken,
      ...(deps.catalog === undefined ? {} : { catalog: deps.catalog }),
      ...(deps.storage === undefined ? {} : { storage: deps.storage }),
      ...(deps.buildRegistration === undefined
        ? {}
        : { buildRegistration: deps.buildRegistration }),
      ...(deps.baseUrl === undefined ? {} : { baseUrl: deps.baseUrl }),
      ...(deps.maxCiphertextBytes === undefined
        ? {}
        : { maxCiphertextBytes: deps.maxCiphertextBytes }),
    }),
  )

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
