import { apiErrorSchema } from '@genovault/shared'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'

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
