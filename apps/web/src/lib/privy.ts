/**
 * Налаштування Privy (`FR-023`) і чесна відповідь на питання «а він узагалі є».
 *
 * `PrivyProvider` без `appId` не піднімається, а живого застосунку Privy у
 * проекті ще немає — `VITE_PRIVY_APP_ID` порожній. Тому вхід має два втілення
 * за одним інтерфейсом: справжній, коли змінна задана, і мок-вхід прототипу,
 * коли ні. Вибір робиться **один раз на рівні модуля**, а не в рендері: інакше
 * два різні набори хуків міняли б місцями порядок виклику.
 *
 * Мок при цьому ніде не видає себе за справжній вхід — екран входу каже
 * прямо, що застосунок Privy не налаштований (`SignInGate`).
 */

const raw: unknown = import.meta.env.VITE_PRIVY_APP_ID

/** Ідентифікатор застосунку або `null`, якщо змінної немає чи вона порожня. */
export const PRIVY_APP_ID: string | null =
  typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null

/** Чи ходить вхід у справжній Privy. */
export const HAS_PRIVY: boolean = PRIVY_APP_ID !== null

/**
 * Способи входу — рівно два, як каже `FR-023`: наявний гаманець або пошта.
 *
 * Соціальних провайдерів тут немає навмисно. Кожен доданий спосіб — це ще одна
 * сторона, яка знає, хто заходив у маркетплейс геномних даних, а продукт від
 * цього не отримує нічого: після входу обидва шляхи не відрізняються нічим.
 */
export const LOGIN_METHODS = ['wallet', 'email'] as const

/**
 * How a restored session signed in. `login()` in this tab knows the method it
 * was asked for; a session Privy restores after a reload does not, and the
 * header would read "signed in ·" with nothing after it. Email sign-in links an
 * email account to the user, and the wallet path links none — so the account
 * answers the question. `null` while there is no user.
 */
export const signInMethodOf = (
  user: { email?: unknown } | null | undefined,
): (typeof LOGIN_METHODS)[number] | null => {
  if (user === null || user === undefined) return null
  return user.email === undefined || user.email === null ? 'wallet' : 'email'
}
