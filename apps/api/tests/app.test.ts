import { apiErrorSchema } from '@genovault/shared'
import { describe, expect, it } from 'vitest'
import { createApp, webOriginsFromEnv } from '../src/app.ts'

const app = createApp()

describe('/health', () => {
  it('відповідає ok', async () => {
    const response = await app.request('/health')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })
})

describe('невідомий маршрут', () => {
  it('віддає 404 у стандартному форматі помилки', async () => {
    const response = await app.request('/no-such-route')
    expect(response.status).toBe(404)
    const parsed = apiErrorSchema.parse(await response.json())
    expect(parsed.error.code).toBe('NOT_FOUND')
  })
})

describe('внутрішня помилка', () => {
  it('не віддає назовні текст винятку', async () => {
    // Через цей API проходять медичні дані, і повідомлення винятків регулярно
    // містять фрагменти запиту. Назовні має йти рівно код і нейтральний текст.
    const leaky = createApp()
    leaky.get('/boom', () => {
      throw new Error('SELECT * FROM patients WHERE ssn = 123-45-6789')
    })

    const response = await leaky.request('/boom')
    expect(response.status).toBe(500)

    const body = await response.text()
    expect(body).not.toContain('ssn')
    expect(body).not.toContain('patients')
    expect(apiErrorSchema.parse(JSON.parse(body)).error.code).toBe('INTERNAL')
  })
})

describe('CORS (T066)', () => {
  const WEB = 'http://localhost:5173'
  const withCors = createApp({ webOrigins: [WEB] })

  const preflight = (target: ReturnType<typeof createApp>, origin: string) =>
    target.request('/datasets', {
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    })

  it('lets the listed origin send a session token', async () => {
    const response = await preflight(withCors, WEB)
    expect(response.headers.get('access-control-allow-origin')).toBe(WEB)
    expect(response.headers.get('access-control-allow-headers')).toContain('authorization')
    expect(response.headers.get('access-control-allow-methods')).toContain('DELETE')
  })

  it('says nothing to any other origin', async () => {
    const response = await preflight(withCors, 'https://evil.example')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('sends no CORS headers at all when no origin is configured', async () => {
    const response = await preflight(app, WEB)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('takes WEB_ORIGINS as origins only', () => {
    expect(webOriginsFromEnv(undefined)).toEqual([])
    expect(webOriginsFromEnv(' ')).toEqual([])
    expect(webOriginsFromEnv(`${WEB}, https://genovault.github.io`)).toEqual([
      WEB,
      'https://genovault.github.io',
    ])
    // A trailing slash or a path never matches what a browser sends.
    expect(() => webOriginsFromEnv(`${WEB}/`)).toThrow(/not an origin/)
    expect(() => webOriginsFromEnv('https://genovault.github.io/GenoVault')).toThrow(
      /not an origin/,
    )
    expect(() => webOriginsFromEnv('localhost:5173')).toThrow()
  })
})
