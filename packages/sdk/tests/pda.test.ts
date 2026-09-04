import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { registerDatasetIx, setConsentIx } from '../src/instructions.ts'
import { consentAddress, datasetAddress, platformConfigAddress } from '../src/pda.ts'
import { createProgram, PROGRAM_ID } from '../src/program.ts'

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })
const OWNER = new PublicKey('7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2')

describe('деривація адрес', () => {
  it('дає той самий результат на тих самих входах', () => {
    const first = datasetAddress(OWNER, 'cohort-alpha')
    const second = datasetAddress(OWNER, 'cohort-alpha')

    expect(first.address.equals(second.address)).toBe(true)
    expect(first.bump).toBe(second.bump)
    // PDA поза кривою за побудовою — інакше в нього був би приватний ключ.
    expect(PublicKey.isOnCurve(first.address.toBytes())).toBe(false)
  })

  it('розрізняє власників і ідентифікатори', () => {
    const other = Keypair.generate().publicKey

    expect(datasetAddress(OWNER, 'cohort-alpha').address.toBase58()).not.toBe(
      datasetAddress(other, 'cohort-alpha').address.toBase58(),
    )
    expect(datasetAddress(OWNER, 'cohort-alpha').address.toBase58()).not.toBe(
      datasetAddress(OWNER, 'cohort-beta').address.toBase58(),
    )
  })

  it('збігається з тим, що виводить сам Anchor із seeds в IDL', async () => {
    // Це головна перевірка файлу. Наша деривація і seeds у вендореному IDL —
    // два описи однієї адреси, і розійтися вони можуть тихо: інструкція
    // просто піде на акаунт, якого програма не чекає. Тут вони звіряються.
    const ix = await registerDatasetIx(program, {
      owner: OWNER,
      datasetId: 'cohort-alpha',
      contentHash: 'a'.repeat(64),
      recordCountClaimed: 1000n,
      pricePer1k: 250n,
    })

    const resolved = ix.keys.find(
      (key) => !key.isSigner && !key.pubkey.equals(PublicKey.default),
    )?.pubkey

    expect(resolved?.toBase58()).toBe(datasetAddress(OWNER, 'cohort-alpha').address.toBase58())
  })

  it('відхиляє ідентифікатор, довший за seed', () => {
    // 32 символи — межа seed у Solana. Довший рядок дав би не помилку
    // валідації, а помилку деривації десь у надрах web3.js.
    expect(() => datasetAddress(OWNER, 'a'.repeat(33))).toThrow(ZodError)
    expect(() => datasetAddress(OWNER, 'ВЕЛИКІ')).toThrow(ZodError)
    expect(() => datasetAddress(OWNER, 'ab')).toThrow(ZodError)
    expect(datasetAddress(OWNER, 'a'.repeat(32)).address).toBeInstanceOf(PublicKey)
  })

  it('версія згоди — u32 у little-endian', () => {
    const dataset = datasetAddress(OWNER, 'cohort-alpha').address

    expect(consentAddress(dataset, 1).address.toBase58()).not.toBe(
      consentAddress(dataset, 2).address.toBase58(),
    )
    expect(() => consentAddress(dataset, -1)).toThrow(RangeError)
    expect(() => consentAddress(dataset, 1.5)).toThrow(RangeError)
    expect(() => consentAddress(dataset, 0x1_0000_0000)).toThrow(RangeError)
  })

  it('конфігурація платформи одна на програму', () => {
    const config = platformConfigAddress()
    expect(config.address.equals(platformConfigAddress(PROGRAM_ID).address)).toBe(true)
  })

  it('нова версія згоди деривується нами, а не резолвером', async () => {
    // У програмі seeds нової згоди — це `consent_version.saturating_add(1)`.
    // Резолвер Anchor виразів не обчислює, тож якби адреса не підставлялась
    // тут, інструкція йшла б на акаунт, якого програма не шукає.
    const dataset = datasetAddress(OWNER, 'cohort-alpha').address
    const ix = await setConsentIx(program, {
      owner: OWNER,
      datasetId: 'cohort-alpha',
      currentVersion: 3,
      allowedUses: 0b0001,
      forbiddenUses: 0,
      buyerCategories: 0b0001,
      expiresAt: null,
    })

    const addresses = ix.keys.map((key) => key.pubkey.toBase58())
    expect(addresses).toContain(consentAddress(dataset, 4).address.toBase58())
    expect(addresses).toContain(consentAddress(dataset, 3).address.toBase58())
  })
})
