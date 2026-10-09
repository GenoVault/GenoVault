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
  /**
   * Who is looking, on routes where looking needs no sign-in (`optionalAuth`).
   * `null` — nobody signed in. Separate from `actor` so that a route which
   * requires a session can never read an anonymous visitor as one.
   */
  viewer: Actor | null
}

const BEARER = /^Bearer (?<token>[^\s]+)$/

export function requireAuth(
  verify: TokenVerifier | undefined,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    if (verify === undefined) {
      // Ненастроєна автентифікація — це збій сервера, а не поганий токен.
      // 401 тут був би брехнею: він каже клієнту виправити те, що ціле.
      return fail(c, 'INTERNAL', 'internal error')
    }

    const match = BEARER.exec(c.req.header('authorization') ?? '')
    const token = match?.groups?.token
    if (token === undefined) {
      return fail(c, 'UNAUTHORIZED', 'a session token is required in the Authorization header')
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

/**
 * A session if there is one (`FR-023`, decision 2026-10-07).
 *
 * The catalog and the dataset card are open without sign-in — the spec asks
 * for authentication before registering a dataset or ordering a run, not
 * before reading what is on offer. A session still changes what is seen: the
 * owner sees their own datasets whose bytes are not uploaded yet.
 *
 * No header — an anonymous viewer. A header with a bad token — 401, not an
 * anonymous viewer: a client that thinks it is signed in and silently is not
 * would show an owner a catalog without their drafts and call it complete.
 */
export function optionalAuth(
  verify: TokenVerifier | undefined,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header('authorization')
    if (header === undefined) {
      c.set('viewer', null)
      await next()
      return
    }
    if (verify === undefined) return fail(c, 'INTERNAL', 'internal error')

    const token = BEARER.exec(header)?.groups?.token
    if (token === undefined) {
      return fail(c, 'UNAUTHORIZED', 'a session token is expected in the Authorization header')
    }
    try {
      c.set('viewer', await verify(token))
    } catch (error) {
      if (error instanceof AuthError) return fail(c, 'UNAUTHORIZED', error.reason)
      throw error
    }
    await next()
  }
}
