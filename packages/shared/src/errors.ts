import { z } from 'zod'

export const API_ERROR_CODES = [
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'INTERNAL',
  /** Прогін вийшов за межі згоди — причина називає конкретне обмеження (FR-008). */
  'CONSENT_VIOLATION',
  /** Заблокованого депозиту не вистачає на фактичну вартість прогону (FR-016). */
  'INSUFFICIENT_ESCROW',
  /**
   * Платформа на паузі: нових прогонів не приймають (`T024`).
   *
   * Окремо від `INVALID_INPUT` навмисно: запит покупця бездоганний, і
   * виправляти йому нічого. Окремо від `UPSTREAM_UNAVAILABLE` теж — це не
   * «спробуй за секунду», а рішення платформи, яке триває, доки його не
   * скасують. Пауза не чіпає вже прийнятих прогонів: інакше вона стала б
   * способом не платити власникам за виконану роботу.
   */
  'PLATFORM_PAUSED',
  /**
   * Не відповідає те, від чого відповідь залежить цілком, — зараз це RPC.
   *
   * Окремо від `INTERNAL` навмисно: 500 каже «ми зламались», і клієнт із таким
   * кодом не повторює запит. Недоступний вузол мережі — це «спробуй пізніше»,
   * і сплутати ці дві відповіді означає або ганяти даремні повтори, або не
   * зробити жодного там, де другий запит спрацював би.
   */
  'UPSTREAM_UNAVAILABLE',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(API_ERROR_CODES),
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
})

export type ApiError = z.infer<typeof apiErrorSchema>

export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ApiError {
  return { error: details === undefined ? { code, message } : { code, message, details } }
}
