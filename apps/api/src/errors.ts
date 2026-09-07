import { type ApiErrorCode, apiError } from '@genovault/shared'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

const STATUS_BY_CODE: Record<ApiErrorCode, ContentfulStatusCode> = {
  INVALID_INPUT: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  // Відмова за згодою — це не помилка запиту, а правило, що спрацювало.
  // 403 відрізняє «тобі не можна» від «запит поламаний» (FR-008).
  CONSENT_VIOLATION: 403,
  INSUFFICIENT_ESCROW: 409,
  // 503, а не 500: відповідь залежить від чужого вузла, а не від нашого коду.
  // Клієнт має право повторити запит, і саме це каже 503.
  UPSTREAM_UNAVAILABLE: 503,
}

export function fail(
  c: Context,
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
) {
  return c.json(apiError(code, message, details), STATUS_BY_CODE[code])
}
