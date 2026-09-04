import type { MiddlewareHandler } from 'hono'
import { fail } from '../errors.ts'
import { type Actor, AuthError, type TokenVerifier } from '../services/auth.ts'

/**
 * Автентифікація як передумова маршруту (`FR-023`).
 *
 * Токен береться лише із заголовка `Authorization`, не з cookie. Причина не в
 * смаку: API живе на іншому походженні, ніж `apps/web`, тож cookie Privy сюди
 * і не дійшла б, а перевіряч, що читає два джерела, — це два шляхи до однієї
 * дії, з яких CSRF стосується лише одного. Фронт бере токен через
 * `getAccessToken()` і кладе його в заголовок сам.
 */

export interface AuthVariables {
  actor: Actor
}

const BEARER = /^Bearer (?<token>[^\s]+)$/

export function requireAuth(
  verify: TokenVerifier | undefined,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    if (verify === undefined) {
      // Ненастроєна автентифікація — це збій сервера, а не поганий токен.
      // 401 тут був би брехнею: він каже клієнту виправити те, що ціле.
      return fail(c, 'INTERNAL', 'внутрішня помилка')
    }

    const match = BEARER.exec(c.req.header('authorization') ?? '')
    const token = match?.groups?.token
    if (token === undefined) {
      return fail(c, 'UNAUTHORIZED', 'потрібен сесійний токен у заголовку Authorization')
    }

    let actor: Actor
    try {
      actor = await verify(token)
    } catch (error) {
      if (error instanceof AuthError) return fail(c, 'UNAUTHORIZED', error.reason)
      throw error
    }

    c.set('actor', actor)
    await next()
  }
}
