import { Hono } from 'hono'
import { ZodError } from 'zod'
import { fail } from './errors.ts'

export function createApp() {
  const app = new Hono()

  app.get('/health', (c) => c.json({ status: 'ok' }))

  app.notFound((c) => fail(c, 'NOT_FOUND', 'маршрут не знайдено'))

  app.onError((error, c) => {
    if (error instanceof ZodError) {
      // Валідація на межі — це 400, а не 500. Zod 4 проганяє всі перевірки,
      // тому issues може містити кілька зауважень до одного поля.
      return fail(c, 'INVALID_INPUT', 'запит не пройшов валідацію', { issues: error.issues })
    }
    // Текст внутрішньої помилки назовні не йде: він регулярно містить фрагменти
    // запиту, а тут через запити проходять медичні дані.
    return fail(c, 'INTERNAL', 'внутрішня помилка')
  })

  return app
}
