import { Hono } from 'hono'
import { type AuthVariables, requireAuth } from '../middleware/auth.ts'
import type { TokenVerifier } from '../services/auth.ts'

/**
 * Хто зайшов (`FR-023`).
 *
 * Цей маршрут — єдине місце, де сесія видно назовні, і віддає він рівно три
 * поля. Ключового матеріалу серед них немає й не може бути: ключ шифрування
 * датасету деривується в браузері й на сервер не потрапляє взагалі (`FR-023a`,
 * `FR-004a`). Фронт користується цим маршрутом як перевіркою «токен ще
 * чинний», а не як профілем: профіль живе в Privy.
 */
export function sessionRoutes(verify: TokenVerifier | undefined) {
  const routes = new Hono<{ Variables: AuthVariables }>()

  routes.get('/me', requireAuth(verify), (c) => {
    const actor = c.get('actor')
    return c.json({
      userId: actor.userId,
      sessionId: actor.sessionId,
      expiresAt: actor.expiresAt.toISOString(),
    })
  })

  return routes
}
