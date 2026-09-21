import { recipeCatalog, recipeCatalogSchema, USE_TYPE_NAMES } from '@genovault/shared'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.ts'

/**
 * `GET /recipes` — `T035`. Маршрут без залежностей і без сесії: застосунок,
 * зібраний узагалі без сервісів, мусить його віддавати.
 */
describe('GET /recipes', () => {
  const app = createApp()

  it('віддає каталог без токена й без жодного сервісу', async () => {
    const response = await app.request('/recipes')

    expect(response.status).toBe(200)
    expect(recipeCatalogSchema.parse(await response.json())).toEqual(recipeCatalog())
  })

  it('словник типів використання — той самий, що приймає квота', async () => {
    const catalog = recipeCatalogSchema.parse(await (await app.request('/recipes')).json())

    expect(catalog.useTypes).toEqual(USE_TYPE_NAMES)
  })

  it('після серіалізації в JSON схема параметрів лишається схемою', async () => {
    // `z.toJSONSchema` віддає звичайний об’єкт, але шлях через `c.json` —
    // єдине місце, де щось могло б загубитись (наприклад, `undefined`).
    const catalog = recipeCatalogSchema.parse(await (await app.request('/recipes')).json())
    const params = catalog.recipes[0]?.params as { properties?: Record<string, unknown> }

    expect(Object.keys(params.properties ?? {})).toEqual(['minAge', 'maxAge', 'sex', 'affected'])
  })
})
