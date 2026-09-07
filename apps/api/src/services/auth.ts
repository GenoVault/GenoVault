import { Buffer } from 'node:buffer'
import { z } from 'zod'

/**
 * Перевірка сесійного токена Privy (`FR-023`).
 *
 * Що цей модуль знає про користувача: його ідентифікатор у провайдері входу,
 * ідентифікатор сесії і момент, коли токен протухне. Більше — нічого, і це
 * не економія, а `FR-023a`: ключ входу і ключ даних не перетинаються ніде.
 * Токен Privy взагалі не несе ключового матеріалу, але претензії на межу
 * недостатньо — тому розібрані claims не подорожують далі за цей файл, а
 * назовні йде вузький `Actor` (це перевіряє тест).
 *
 * Підпис звіряється самотужки через WebCrypto, без `@privy-io/server-auth`.
 * Причина та сама, що й у драйвера `supabase`: єдине, що тут потрібно, — це
 * ES256 над двома відрізками рядка, а нова залежність в API коштує рівно те,
 * що ми тут захищаємо, — розмір графа залежностей.
 */

/** Емітент у токені Privy — константа провайдера, не наше налаштування. */
export const PRIVY_ISSUER = 'privy.io'

/** Тільки ES256 (P-256 + SHA-256): саме ним Privy підписує access-токен. */
const ALGORITHM = 'ES256'

/** Довжина підпису JWS ES256 — сира пара `r‖s`, по 32 байти. */
const SIGNATURE_BYTES = 64

/**
 * Відмова в автентифікації.
 *
 * `reason` навмисно віддається клієнту: він описує форму токена або claim, що
 * не зійшовся, і не містить ані самого токена, ані нічого з тіла запиту.
 * «Токен прострочений» і «токен для іншого застосунку» — різні дії на боці
 * фронта, і плутати їх в одне «unauthorized» означає ганяти користувача по колу.
 */
export class AuthError extends Error {
  override readonly name = 'AuthError'
  readonly reason: string

  // Поле присвоюється в тілі, а не оголошується параметром-властивістю:
  // `node --experimental-strip-types` знімає типи, але коду не породжує, тож
  // `constructor(readonly reason: string)` валить процес ще на завантаженні
  // модуля — а саме так запускаються `dev` і `start`. Ані vitest, ані `tsc`
  // цього не бачать: обидва такий синтаксис розуміють.
  constructor(reason: string) {
    super(reason)
    this.reason = reason
  }
}

/** Ідентифікатор користувача в Privy — DID виду `did:privy:<id>`. */
export const privyUserIdSchema = z
  .string()
  .regex(/^did:privy:[A-Za-z0-9]{1,64}$/, 'очікувався ідентифікатор виду did:privy:<id>')

export interface Actor {
  /** Хто — у провайдері входу. Ключа даних за цим ідентифікатором не існує. */
  readonly userId: string
  /** Яка сесія — щоб відкликання сесії було видно в журналі (`FR-025`). */
  readonly sessionId: string
  readonly expiresAt: Date
}

export type TokenVerifier = (token: string) => Promise<Actor>

// ── Налаштування ──────────────────────────────────────────────────────────────

const DEFAULT_CLOCK_SKEW_SECONDS = 30
const DEFAULT_JWKS_TTL_SECONDS = 300

/**
 * Публічний ключ береться або з панелі Privy (PEM), або з JWKS-точки.
 *
 * PEM — це піни на конкретний ключ: ротація на боці провайдера ламає вхід,
 * поки змінну не оновлять. JWKS переживає ротацію сам, але додає мережевий
 * виклик на холодному старті. Тому союз, а не одне: у розробці зручний PEM,
 * у розгортанні — JWKS.
 */
export const authConfigSchema = z.discriminatedUnion('keySource', [
  z.strictObject({
    keySource: z.literal('pem'),
    appId: z.string().min(1),
    publicKeyPem: z.string().min(1),
    clockSkewSeconds: z.number().int().nonnegative().prefault(DEFAULT_CLOCK_SKEW_SECONDS),
  }),
  z.strictObject({
    keySource: z.literal('jwks'),
    appId: z.string().min(1),
    jwksUrl: z.url(),
    clockSkewSeconds: z.number().int().nonnegative().prefault(DEFAULT_CLOCK_SKEW_SECONDS),
    jwksTtlSeconds: z.number().int().positive().prefault(DEFAULT_JWKS_TTL_SECONDS),
  }),
])

export type AuthConfig = z.infer<typeof authConfigSchema>

export function jwksUrlForApp(appId: string): string {
  return `https://auth.privy.io/api/v1/apps/${encodeURIComponent(appId)}/jwks.json`
}

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
  const appId = env.PRIVY_APP_ID
  const pem = env.PRIVY_VERIFICATION_KEY

  // Порожній рядок у `.env` — це «не налаштовано», а не «ключ довжиною нуль».
  return authConfigSchema.parse(
    pem !== undefined && pem.trim() !== ''
      ? { keySource: 'pem', appId, publicKeyPem: pem }
      : { keySource: 'jwks', appId, jwksUrl: env.PRIVY_JWKS_URL ?? jwksUrlForApp(appId ?? '') },
  )
}

// ── Розбір токена ─────────────────────────────────────────────────────────────

const BASE64URL = /^[A-Za-z0-9_-]+$/

function decodeSegment(segment: string, what: string): Uint8Array<ArrayBuffer> {
  // `Buffer` мовчки ковтає сторонні символи, тому алфавіт перевіряється до
  // нього: інакше підроблений заголовок із крапкою всередині розбереться в
  // щось валідне, а підпис рахувався б над іншим рядком.
  if (segment === '' || !BASE64URL.test(segment)) {
    throw new AuthError(`${what} токена не є base64url`)
  }
  return new Uint8Array(Buffer.from(segment, 'base64url'))
}

function decodeJson(segment: string, what: string): unknown {
  try {
    return JSON.parse(Buffer.from(decodeSegment(segment, what)).toString('utf8'))
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError(`${what} токена не є JSON`)
  }
}

/**
 * Заголовок звужено до одного алгоритму навмисно.
 *
 * `alg` у JWT обирає **перевіряч**, а не токен: варіант із `none` або з HS256
 * поверх публічного ключа — це класична підміна, коли підпис «перевіряється»
 * тим самим значенням, яке зловмисник і надіслав.
 */
const headerSchema = z.object({
  alg: z.literal(ALGORITHM, `підтримується лише ${ALGORITHM}`),
  typ: z.literal('JWT').optional(),
  kid: z.string().min(1).optional(),
})

const claimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string()).min(1)]),
  sub: privyUserIdSchema,
  sid: z.string().min(1),
  iat: z.number().int().optional(),
  nbf: z.number().int().optional(),
  exp: z.number().int(),
})

function parseSchema<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    // Назовні йде перше зауваження без шляху до значення: клієнту треба знати,
    // що саме не так із токеном, а не отримати назад його ж вміст.
    throw new AuthError(`${what}: ${result.error.issues[0]?.message ?? 'непридатна форма'}`)
  }
  return result.data
}

// ── Ключі ─────────────────────────────────────────────────────────────────────

const ecdsaParams = { name: 'ECDSA', namedCurve: 'P-256' } as const

function importSpki(der: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('spki', der, ecdsaParams, false, ['verify'])
}

export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/, '')
    .replace(/-----END [A-Z ]+-----/, '')
    .replace(/\s+/g, '')
  if (body === '') throw new AuthError('порожній ключ перевірки')
  return new Uint8Array(Buffer.from(body, 'base64'))
}

const jwkSchema = z.object({
  kty: z.string(),
  crv: z.string().optional(),
  kid: z.string().optional(),
  alg: z.string().optional(),
  x: z.string().optional(),
  y: z.string().optional(),
})

const jwksSchema = z.object({ keys: z.array(jwkSchema) })

/**
 * Джерело публічних ключів.
 *
 * `keys(kid)` віддає список кандидатів, а не один ключ: у JWKS без `kid` у
 * токені кандидатів може бути кілька, і тоді перевіряються всі. `refresh()`
 * викликається один раз на невідомий `kid` — ротація ключа не має чекати на
 * спливання TTL, але й не має відкривати шлях «невідомий kid → запит назовні»
 * на кожен запит.
 */
interface KeySource {
  keys(kid: string | undefined): Promise<CryptoKey[]>
  refresh(): Promise<boolean>
}

function pemKeySource(pem: string): KeySource {
  let cached: Promise<CryptoKey> | undefined

  return {
    async keys() {
      cached ??= importSpki(pemToDer(pem)).catch((error: unknown) => {
        cached = undefined
        throw new AuthError(`ключ перевірки непридатний: ${describe(error)}`)
      })
      return [await cached]
    },
    async refresh() {
      // Пін на конкретний ключ оновлювати нізвідки: PEM приходить зі змінної.
      return false
    },
  }
}

interface JwksEntry {
  kid: string | undefined
  key: CryptoKey
}

export function jwksKeySource(
  url: string,
  ttlSeconds: number,
  fetchImpl: typeof fetch = fetch,
  now: () => number = Date.now,
): KeySource {
  let entries: JwksEntry[] = []
  let fetchedAt = Number.NEGATIVE_INFINITY
  let inflight: Promise<void> | undefined

  const load = async (): Promise<void> => {
    let response: Response
    try {
      response = await fetchImpl(url, { headers: { accept: 'application/json' } })
    } catch (error) {
      throw new AuthError(`не вдалося отримати ключі перевірки: ${describe(error)}`)
    }
    if (!response.ok) {
      throw new AuthError(`джерело ключів відповіло ${response.status}`)
    }

    const jwks = parseSchema(jwksSchema, await response.json(), 'набір ключів')
    // `flatMap`, а не `filter` + `map`: перевірка полів має ще й звужувати
    // тип, інакше `x`/`y` доїжджають до імпорту як `string | undefined`.
    const usable = jwks.keys.flatMap((key) =>
      key.kty === 'EC' &&
      key.crv === 'P-256' &&
      key.x !== undefined &&
      key.y !== undefined &&
      (key.alg === undefined || key.alg === ALGORITHM)
        ? [{ kid: key.kid, x: key.x, y: key.y }]
        : [],
    )

    const imported = await Promise.all(
      usable.map(async (key) => ({
        kid: key.kid,
        key: await crypto.subtle.importKey(
          'jwk',
          { kty: 'EC', crv: 'P-256', x: key.x, y: key.y, ext: true },
          ecdsaParams,
          false,
          ['verify'],
        ),
      })),
    )

    if (imported.length === 0) throw new AuthError('джерело ключів не містить придатних ключів')

    entries = imported
    fetchedAt = now()
  }

  // Паралельні запити на холодному старті мають дати один похід у мережу, а не
  // стільки, скільки їх прийшло. Помилка не кешується: наступний запит пробує знову.
  const loadOnce = (): Promise<void> => {
    inflight ??= load().finally(() => {
      inflight = undefined
    })
    return inflight
  }

  return {
    async keys(kid) {
      if (entries.length === 0 || now() - fetchedAt > ttlSeconds * 1000) await loadOnce()
      return (kid === undefined ? entries : entries.filter((entry) => entry.kid === kid)).map(
        (entry) => entry.key,
      )
    },
    async refresh() {
      await loadOnce()
      return true
    },
  }
}

// ── Перевіряч ─────────────────────────────────────────────────────────────────

export interface VerifierOptions {
  fetch?: typeof fetch
  now?: () => number
}

/**
 * Збирає перевіряч токена з налаштування.
 *
 * Порядок перевірок тут має значення: підпис звіряється **до** claims. Claims
 * непідписаного токена — це просто рядок від клієнта, і вирішувати за ним
 * «прострочений чи ні» означає вирішувати за даними, які підсунули.
 */
export function createTokenVerifier(
  config: AuthConfig,
  options: VerifierOptions = {},
): TokenVerifier {
  const now = options.now ?? Date.now
  const source =
    config.keySource === 'pem'
      ? pemKeySource(config.publicKeyPem)
      : jwksKeySource(config.jwksUrl, config.jwksTtlSeconds, options.fetch ?? fetch, now)

  const skewMs = config.clockSkewSeconds * 1000

  return async (token: string): Promise<Actor> => {
    const parts = token.split('.')
    if (parts.length !== 3) throw new AuthError('токен не є JWT із трьох частин')
    const [rawHeader = '', rawClaims = '', rawSignature = ''] = parts

    const header = parseSchema(headerSchema, decodeJson(rawHeader, 'заголовок'), 'заголовок')

    const signature = decodeSegment(rawSignature, 'підпис')
    if (signature.length !== SIGNATURE_BYTES) {
      throw new AuthError('підпис не має довжини ES256')
    }

    const signed = new TextEncoder().encode(`${rawHeader}.${rawClaims}`)
    if (!(await verifyAgainst(source, header.kid, signature, signed))) {
      throw new AuthError('підпис токена не збігається')
    }

    const claims = parseSchema(claimsSchema, decodeJson(rawClaims, 'тіло'), 'тіло')

    if (claims.iss !== PRIVY_ISSUER) throw new AuthError('токен виданий іншим емітентом')

    const audience = typeof claims.aud === 'string' ? [claims.aud] : claims.aud
    if (!audience.includes(config.appId)) throw new AuthError('токен виданий іншому застосунку')

    const current = now()
    if (claims.exp * 1000 + skewMs <= current) throw new AuthError('токен прострочений')
    if (claims.nbf !== undefined && claims.nbf * 1000 - skewMs > current) {
      throw new AuthError('токен ще не чинний')
    }
    if (claims.iat !== undefined && claims.iat * 1000 - skewMs > current) {
      throw new AuthError('токен виданий у майбутньому')
    }

    // Проєкція, а не `...claims`: усе, чого немає в `Actor`, лишається тут.
    return { userId: claims.sub, sessionId: claims.sid, expiresAt: new Date(claims.exp * 1000) }
  }
}

async function verifyAgainst(
  source: KeySource,
  kid: string | undefined,
  signature: Uint8Array<ArrayBuffer>,
  signed: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  const attempt = async (keys: CryptoKey[]): Promise<boolean> => {
    for (const key of keys) {
      if (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, signed)) {
        return true
      }
    }
    return false
  }

  if (await attempt(await source.keys(kid))) return true

  // Один повтор після оновлення джерела — рівно на випадок ротації ключа.
  // Далі не пробуємо: невідомий `kid` не має ставати важелем на джерело ключів.
  return (await source.refresh()) && attempt(await source.keys(kid))
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
