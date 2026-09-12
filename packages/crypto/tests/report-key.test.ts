import { describe, expect, it } from 'vitest'
import { deriveReportKey, reportKeyMessage, toHex } from '../src/report-key.ts'

/**
 * Ключ звіту (`T029`).
 *
 * Головна властивість — відновлюваність: покупець, який відкрив звіт із
 * іншого пристрою, мусить отримати ту саму пару. Друга — розділення: два
 * прогони не мають ділити ключ, інакше витік однієї приватної половини
 * відкриває всі звіти, які покупець колись замовляв.
 */

const BUYER = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T'
const SIGNATURE = Uint8Array.from({ length: 64 }, (_unused, i) => (i * 7) % 251)

describe('ключ для читання звіту', () => {
  it('той самий підпис дає ту саму пару', async () => {
    const first = await deriveReportKey(SIGNATURE)
    const second = await deriveReportKey(Uint8Array.from(SIGNATURE))

    expect(toHex(first.secretKey)).toBe(toHex(second.secretKey))
    expect(toHex(first.publicKey)).toBe(toHex(second.publicKey))
  })

  it('інший підпис дає інший ключ', async () => {
    const other = Uint8Array.from(SIGNATURE)
    other[0] = (other[0] ?? 0) ^ 1

    expect(toHex((await deriveReportKey(other)).publicKey)).not.toBe(
      toHex((await deriveReportKey(SIGNATURE)).publicKey),
    )
  })

  it('обидві половини — рівно 32 байти', async () => {
    const key = await deriveReportKey(SIGNATURE)

    expect(key.secretKey).toHaveLength(32)
    expect(key.publicKey).toHaveLength(32)
    // Саме в цій формі публічна половина їде в `POST /runs`.
    expect(toHex(key.publicKey)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('порожній підпис — це помилка, а не ключ із нулів', async () => {
    await expect(deriveReportKey(new Uint8Array(0))).rejects.toThrow(RangeError)
  })

  it('повідомлення прив’язане і до гаманця, і до прогону', () => {
    // Без нонса два прогони того самого покупця ділили б ключ; без адреси
    // підпис переносився б на інший гаманець.
    const message = reportKeyMessage(BUYER, 42n)

    expect(message).toContain('GenoVault')
    expect(message).toContain(BUYER)
    expect(message).toContain('42')
    expect(reportKeyMessage(BUYER, 43n)).not.toBe(message)
    expect(reportKeyMessage('11111111111111111111111111111112', 42n)).not.toBe(message)
  })
})
