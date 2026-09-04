import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { apiErrorSchema } from '@genovault/shared'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.ts'
import {
  type AuthConfig,
  AuthError,
  authConfigFromEnv,
  authConfigSchema,
  createTokenVerifier,
  jwksUrlForApp,
  PRIVY_ISSUER,
  pemToDer,
} from '../src/services/auth.ts'

const APP_ID = 'cm9genovault0000test'
const USER = 'did:privy:clzabc123XYZ'
const SESSION = 'session-7f3a'

/**
 * Токени тут підписуються локально згенерованою парою P-256.
 *
 * Живого `PRIVY_APP_ID` у проекті ще немає, але для цієї задачі він і не
 * потрібен: перевіряється не те, що Privy видає токени, а те, що ми приймаємо
 * рівно ті, які підписані очікуваним ключем, і відхиляємо решту. Форма токена
 * (ES256, `iss=privy.io`, `aud=<app id>`, `sub=did:privy:…`, `sid`) — контракт
 * провайдера; де ми на нього спираємось, там і стоїть тест.
 */
/** `CryptoKeyPair` немає серед глобальних типів Node — тут потрібні лише два поля. */
interface KeyPair {
  privateKey: CryptoKey
  publicKey: CryptoKey
}

let keys: KeyPair
let otherKeys: KeyPair

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

beforeAll(async () => {
  keys = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
  otherKeys = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify'])
})

function b64url(bytes: Uint8Array | ArrayBuffer): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString(
    'base64url',
  )
}

function segment(value: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)))
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  return {
    iss: PRIVY_ISSUER,
    aud: APP_ID,
    sub: USER,
    sid: SESSION,
    iat: nowSeconds - 5,
    exp: nowSeconds + 3600,
    ...overrides,
  }
}

async function signWith(
  key: CryptoKey,
  header: Record<string, unknown>,
  body: Record<string, unknown>,
): Promise<string> {
  const signed = `${segment(header)}.${segment(body)}`
  const signature = await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(signed))
  return `${signed}.${b64url(signature)}`
}

function token(
  body: Record<string, unknown> = claims(),
  header: Record<string, unknown> = { alg: 'ES256', typ: 'JWT' },
): Promise<string> {
  return signWith(keys.privateKey, header, body)
}

async function pem(): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))
  const body = Buffer.from(der)
    .toString('base64')
    .replace(/(.{64})/g, '$1\n')
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`
}

async function pemConfig(overrides: Partial<AuthConfig> = {}): Promise<AuthConfig> {
  return authConfigSchema.parse({
    keySource: 'pem',
    appId: APP_ID,
    publicKeyPem: await pem(),
    ...overrides,
  })
}

async function verifier() {
  return createTokenVerifier(await pemConfig())
}

async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError)
    return (error as AuthError).reason
  }
  throw new Error('очікувалась відмова')
}

describe('перевірка токена', () => {
  it('приймає токен, підписаний очікуваним ключем', async () => {
    const actor = await (await verifier())(await token())

    expect(actor.userId).toBe(USER)
    expect(actor.sessionId).toBe(SESSION)
    expect(actor.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('не переносить у сесію нічого, крім трьох полів', async () => {
    // FR-023a: ключ входу і ключ даних не перетинаються. Ключа даних у токені
    // немає й бути не може, але межа тримається проєкцією, а не цим фактом:
    // будь-який зайвий claim (сьогодні — гаманець, завтра — що завгодно)
    // лишається в перевірячі й далі не їде.
    const actor = await (await verifier())(
      await token(
        claims({
          wallet: { address: 'FakeWa11et', chainType: 'solana' },
          linked_accounts: [{ type: 'email', address: 'donor@example.org' }],
          secret_key: 'ніколи',
        }),
      ),
    )

    expect(Object.keys(actor).sort()).toEqual(['expiresAt', 'sessionId', 'userId'])
    expect(JSON.stringify(actor)).not.toContain('donor@example.org')
    expect(JSON.stringify(actor)).not.toContain('ніколи')
  })

  it('відхиляє alg, якого не обирали', async () => {
    // Алгоритм обирає перевіряч, а не токен: `none` і симетричний HS256 поверх
    // публічного ключа — класична підміна, коли підпис звіряють тим самим,
    // що й надіслали.
    const none = `${segment({ alg: 'none' })}.${segment(claims())}.`
    expect(await reasonOf((await verifier())(none))).toContain('ES256')

    const hs = await token(claims(), { alg: 'HS256', typ: 'JWT' })
    expect(await reasonOf((await verifier())(hs))).toContain('ES256')
  })

  it('відхиляє підпис чужим ключем', async () => {
    const foreign = await signWith(otherKeys.privateKey, { alg: 'ES256' }, claims())
    expect(await reasonOf((await verifier())(foreign))).toContain('підпис')
  })

  it('відхиляє підмінене тіло при цілому підписі', async () => {
    const original = await token()
    const [header = '', , signature = ''] = original.split('.')
    const tampered = `${header}.${segment(claims({ sub: 'did:privy:attacker' }))}.${signature}`

    expect(await reasonOf((await verifier())(tampered))).toContain('підпис')
  })

  it('звіряє підпис до claims, а не після', async () => {
    // Прострочений токен із чужим підписом має падати на підписі: рішення
    // «прострочений чи ні» за непідписаними даними — це рішення за тим, що
    // підсунули.
    const expired = await signWith(
      otherKeys.privateKey,
      { alg: 'ES256' },
      claims({ exp: Math.floor(Date.now() / 1000) - 10_000 }),
    )

    expect(await reasonOf((await verifier())(expired))).toContain('підпис')
  })

  it('відхиляє чужого емітента і чужий застосунок', async () => {
    const verify = await verifier()

    expect(await reasonOf(verify(await token(claims({ iss: 'auth.example.com' }))))).toContain(
      'емітентом',
    )
    expect(await reasonOf(verify(await token(claims({ aud: 'someone-else' }))))).toContain(
      'застосунку',
    )
  })

  it('приймає aud списком, якщо наш застосунок у ньому є', async () => {
    const actor = await (await verifier())(await token(claims({ aud: ['other', APP_ID] })))
    expect(actor.userId).toBe(USER)
  })

  it('відхиляє прострочений токен і терпить розбіжність годинників', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const verify = createTokenVerifier(await pemConfig({ clockSkewSeconds: 30 }))

    expect(await reasonOf(verify(await token(claims({ exp: nowSeconds - 60 }))))).toContain(
      'прострочений',
    )
    // Протух десять секунд тому — у межах допуску на розбіжність годинників.
    const actor = await verify(await token(claims({ exp: nowSeconds - 10 })))
    expect(actor.userId).toBe(USER)
  })

  it('відхиляє токен із майбутнього', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const verify = await verifier()

    expect(await reasonOf(verify(await token(claims({ iat: nowSeconds + 600 }))))).toContain(
      'майбутньому',
    )
    expect(await reasonOf(verify(await token(claims({ nbf: nowSeconds + 600 }))))).toContain(
      'не чинний',
    )
  })

  it('відхиляє токен без обов’язкових claims', async () => {
    const verify = await verifier()

    const noSid = claims()
    delete noSid.sid
    expect(await reasonOf(verify(await token(noSid)))).toContain('тіло')

    expect(await reasonOf(verify(await token(claims({ sub: 'user_42' }))))).toContain('did:privy')
  })

  it('відхиляє те, що взагалі не є JWT', async () => {
    const verify = await verifier()

    expect(await reasonOf(verify('не.jwt'))).toContain('трьох частин')
    expect(await reasonOf(verify('a.b.c.d'))).toContain('трьох частин')
    // Крапка й плюс поза алфавітом base64url: `Buffer` ковтнув би їх мовчки, і
    // підпис рахувався б над іншим рядком, ніж прийшов.
    expect(await reasonOf(verify('e+J9.e30.AAAA'))).toContain('base64url')
    expect(await reasonOf(verify(`${b64url(new TextEncoder().encode('{'))}.e30.AAAA`))).toContain(
      'JSON',
    )
  })

  it('відхиляє підпис неправильної довжини', async () => {
    const [header = '', body = ''] = (await token()).split('.')
    const short = `${header}.${body}.${b64url(new Uint8Array(32))}`

    expect(await reasonOf((await verifier())(short))).toContain('довжини ES256')
  })
})

describe('джерело ключів', () => {
  async function jwk(pair: KeyPair, kid: string): Promise<Record<string, unknown>> {
    const exported = await crypto.subtle.exportKey('jwk', pair.publicKey)
    return { kty: exported.kty, crv: exported.crv, x: exported.x, y: exported.y, alg: 'ES256', kid }
  }

  function jwksResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  function jwksConfig(): AuthConfig {
    return authConfigSchema.parse({
      keySource: 'jwks',
      appId: APP_ID,
      jwksUrl: jwksUrlForApp(APP_ID),
      jwksTtlSeconds: 300,
    })
  }

  it('бере ключ за kid і кешує набір', async () => {
    const fetchMock = vi.fn(async () => jwksResponse({ keys: [await jwk(keys, 'k1')] }))
    const verify = createTokenVerifier(jwksConfig(), {
      fetch: fetchMock as unknown as typeof fetch,
    })

    const first = await verify(await token(claims(), { alg: 'ES256', kid: 'k1' }))
    const second = await verify(await token(claims(), { alg: 'ES256', kid: 'k1' }))

    expect(first.userId).toBe(USER)
    expect(second.userId).toBe(USER)
    // Два запити — один похід у мережу: ключі провайдера не змінюються між
    // сусідніми запитами, а JWKS на кожен запит — це відмова сервісу, щойно
    // джерело сповільниться.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('переживає ротацію ключа одним оновленням', async () => {
    let current = 'k1'
    const fetchMock = vi.fn(async () =>
      jwksResponse({ keys: [await jwk(current === 'k1' ? otherKeys : keys, current)] }),
    )
    const verify = createTokenVerifier(jwksConfig(), {
      fetch: fetchMock as unknown as typeof fetch,
    })

    await verify(await token(claims(), { alg: 'ES256', kid: 'k1' })).catch(() => undefined)
    current = 'k2'

    const actor = await verify(await token(claims(), { alg: 'ES256', kid: 'k2' }))
    expect(actor.userId).toBe(USER)
  })

  it('не ходить у мережу більше одного разу на невідомий kid', async () => {
    const fetchMock = vi.fn(async () => jwksResponse({ keys: [await jwk(keys, 'k1')] }))
    const verify = createTokenVerifier(jwksConfig(), {
      fetch: fetchMock as unknown as typeof fetch,
    })

    // Невідомий `kid` приходить від клієнта, тож він не має ставати важелем на
    // джерело ключів: один похід на спробу, а не цикл.
    await reasonOf(verify(await token(claims(), { alg: 'ES256', kid: 'unknown' })))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('перечитує набір після спливання TTL', async () => {
    const fetchMock = vi.fn(async () => jwksResponse({ keys: [await jwk(keys, 'k1')] }))
    let clock = 1_000_000
    const verify = createTokenVerifier(
      authConfigSchema.parse({ ...jwksConfig(), jwksTtlSeconds: 60 }),
      { fetch: fetchMock as unknown as typeof fetch, now: () => clock },
    )

    const fresh = () => claims({ exp: Math.floor(clock / 1000) + 3600, iat: undefined })

    await verify(await token(fresh(), { alg: 'ES256', kid: 'k1' }))
    clock += 61_000
    await verify(await token(fresh(), { alg: 'ES256', kid: 'k1' }))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('називає збій джерела ключів, а не мовчить', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 503 }))
    const verify = createTokenVerifier(jwksConfig(), { fetch: failing as unknown as typeof fetch })

    expect(await reasonOf(verify(await token()))).toContain('503')

    const unusable = vi.fn(async () => jwksResponse({ keys: [{ kty: 'RSA', kid: 'r1' }] }))
    const rsaOnly = createTokenVerifier(jwksConfig(), {
      fetch: unusable as unknown as typeof fetch,
    })
    expect(await reasonOf(rsaOnly(await token()))).toContain('придатних ключів')
  })

  it('читає PEM зі змінної як SPKI', async () => {
    expect(pemToDer(await pem()).length).toBeGreaterThan(64)
    expect(() => pemToDer('-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----')).toThrow(
      AuthError,
    )
  })
})

describe('налаштування з оточення', () => {
  it('бере PEM, коли він заданий, і JWTS-точку застосунку інакше', async () => {
    const withPem = authConfigFromEnv({ PRIVY_APP_ID: APP_ID, PRIVY_VERIFICATION_KEY: await pem() })
    expect(withPem.keySource).toBe('pem')

    const withoutPem = authConfigFromEnv({ PRIVY_APP_ID: APP_ID })
    expect(withoutPem).toMatchObject({ keySource: 'jwks', jwksUrl: jwksUrlForApp(APP_ID) })

    // Порожній рядок у `.env` — «не налаштовано», а не ключ довжиною нуль.
    expect(
      authConfigFromEnv({ PRIVY_APP_ID: APP_ID, PRIVY_VERIFICATION_KEY: '  ' }).keySource,
    ).toBe('jwks')
  })

  it('падає без PRIVY_APP_ID', () => {
    // Без ідентифікатора застосунку `aud` нема з чим звіряти, тобто приймався б
    // будь-який токен Privy — у тому числі виданий іншому застосунку.
    expect(() => authConfigFromEnv({})).toThrow()
  })
})

describe('GET /me', () => {
  it('віддає сесію за дійсним токеном', async () => {
    const app = createApp({ verifyAccessToken: await verifier() })
    const response = await app.request('/me', {
      headers: { authorization: `Bearer ${await token()}` },
    })

    expect(response.status).toBe(200)
    const body = z
      .strictObject({ userId: z.string(), sessionId: z.string(), expiresAt: z.iso.datetime() })
      .parse(await response.json())
    expect(body.userId).toBe(USER)
  })

  it('вимагає заголовок і не приймає токен у запиті чи cookie', async () => {
    const app = createApp({ verifyAccessToken: await verifier() })
    const bearer = await token()

    for (const init of [
      undefined,
      { headers: { cookie: `privy-token=${bearer}` } },
      { headers: { authorization: bearer } },
      { headers: { authorization: `Basic ${bearer}` } },
    ]) {
      const response = await app.request('/me', init)
      expect(response.status).toBe(401)
      expect(apiErrorSchema.parse(await response.json()).error.code).toBe('UNAUTHORIZED')
    }
  })

  it('називає причину відмови, не повертаючи токен', async () => {
    const app = createApp({ verifyAccessToken: await verifier() })
    const stale = await token(claims({ exp: Math.floor(Date.now() / 1000) - 10_000 }))

    const response = await app.request('/me', { headers: { authorization: `Bearer ${stale}` } })
    const text = await response.text()

    expect(response.status).toBe(401)
    expect(apiErrorSchema.parse(JSON.parse(text)).error.message).toContain('прострочений')
    expect(text).not.toContain(stale)
    expect(text).not.toContain(SESSION)
  })

  it('ненастроєна автентифікація — це 500, а не 401', async () => {
    // 401 сказав би клієнту виправити токен, який цілий. Такий стан не має
    // бути досяжним у розгортанні: `server.ts` розбирає налаштування на старті.
    const response = await createApp().request('/me', {
      headers: { authorization: 'Bearer x.y.z' },
    })

    expect(response.status).toBe(500)
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('INTERNAL')
  })
})

describe('межа з FR-023a', () => {
  it('API не тягне ані шифру, ані SDK провайдера входу', async () => {
    const manifestSchema = z.object({
      dependencies: z.record(z.string(), z.string()).prefault({}),
      devDependencies: z.record(z.string(), z.string()).prefault({}),
    })
    const raw: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    )
    const manifest = manifestSchema.parse(raw)
    const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })

    // `@privy-io/server-auth` умів би не лише звіряти підпис, а й ходити в
    // Privy по користувача з його гаманцями. Тут потрібне рівно перше, і
    // відсутність другого — це те, що доводить межу, а не коментар про неї.
    expect(deps.filter((name) => name.startsWith('@privy-io/'))).toEqual([])
    expect(deps).not.toContain('@genovault/crypto')
  })
})
