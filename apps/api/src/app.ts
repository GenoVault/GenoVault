import { DatasetEnvelopeError } from '@genovault/shared'
import { Hono } from 'hono'
import { ZodError } from 'zod'
import { fail } from './errors.ts'
import type { AuthVariables } from './middleware/auth.ts'
import { sessionRoutes } from './routes/session.ts'
import type { TokenVerifier } from './services/auth.ts'

export interface AppDeps {
  /**
   * Перевіряч сесійного токена. Збирається в `server.ts` із змінних оточення,
   * щоб ненастроєна автентифікація падала на старті, а не на першому запиті;
   * у тестах підставляється напряму, без мережі й без ключів Privy.
   */
  verifyAccessToken?: TokenVerifier
}

export function createApp(deps: AppDeps = {}) {
  const app = new Hono<{ Variables: AuthVariables }>()

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.route('/', sessionRoutes(deps.verifyAccessToken))

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
