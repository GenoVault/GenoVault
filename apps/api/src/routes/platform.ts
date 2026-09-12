import type { PlatformView, SolanaAddress } from '@genovault/shared'
import { platformViewSchema } from '@genovault/shared'
import { Hono } from 'hono'
import { fail } from '../errors.ts'
import { ChainStateError, type PlatformReader } from '../services/chain.ts'

/**
 * Стан платформи, який покупець мусить бачити до замовлення (`FR-019`) — `T029`.
 *
 * # Чому без автентифікації
 *
 * `FR-019` вимагає, щоб розмір комісії був публічним. Усе інше тут теж лежить
 * у мережі відкрито: адреса програми, мінт, пауза. Замок на цьому маршруті не
 * додав би приватності — лише зробив би нашу відповідь менш доступною за
 * ланцюг, з якого вона й прочитана.
 *
 * # Чому диспетчер публікується
 *
 * `Run.dispatcher` — повноваження: той, кого назве покупець, доводить прогін
 * до кінця, і він єдиний, хто може подавати шифротекст і ставити обчислення в
 * чергу. Платформа тримає свого, бо 313 згорток і ~23 500 транзакцій запису у
 * вкладці браузера підписати неможливо. Але тримати — не означає підставляти
 * мовчки: адреса називається вголос, покупець бачить, кому дає повноваження, і
 * може назвати іншого. Те, чого диспетчер **не** може, — рухати гроші, міняти
 * склад прогону й параметри рецепта, обходити згоду.
 */
export interface PlatformRoutesDeps {
  readPlatform?: PlatformReader | undefined
  dispatcher?: SolanaAddress | undefined
}

export function platformRoutes(deps: PlatformRoutesDeps) {
  const routes = new Hono()

  routes.get('/platform', async (c) => {
    if (deps.readPlatform === undefined) return fail(c, 'INTERNAL', 'внутрішня помилка')

    let state: Awaited<ReturnType<PlatformReader>>
    try {
      state = await deps.readPlatform()
    } catch (error) {
      if (error instanceof ChainStateError) {
        return error.reason === 'unavailable'
          ? fail(c, 'UPSTREAM_UNAVAILABLE', 'мережа зараз не відповідає — спробуйте пізніше')
          : fail(c, 'INTERNAL', 'платформу ще не розгорнуто в цій мережі')
      }
      throw error
    }

    const view: PlatformView = platformViewSchema.parse({
      programId: state.programId,
      mint: state.mint,
      feeBps: state.feeBps,
      paused: state.paused,
      dispatcher: deps.dispatcher ?? null,
    })

    return c.json(view)
  })

  return routes
}
