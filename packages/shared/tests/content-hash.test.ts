import { describe, expect, it } from 'vitest'
import { contentHash } from '../src/index.ts'

/** sha-256 порожнього входу — контрольне значення зі стандарту, не з нашого коду. */
const SHA256_OF_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
/** sha-256 від ASCII 'abc' — друге контрольне значення звідти ж. */
const SHA256_OF_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('contentHash', () => {
  it('збігається з контрольними значеннями стандарту', async () => {
    expect(await contentHash(new Uint8Array(0))).toBe(SHA256_OF_EMPTY)
    expect(await contentHash(Uint8Array.from([0x61, 0x62, 0x63]))).toBe(SHA256_OF_ABC)
  })

  it('дає той самий відбиток на тих самих байтах', async () => {
    const bytes = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff)
    expect(await contentHash(bytes)).toBe(await contentHash(bytes))
  })

  it('змінюється від одного переверненого біта', async () => {
    // Це і є вся вимога FR-004: підмінений вміст не проходить під старим відбитком.
    const bytes = Uint8Array.from({ length: 512 }, (_, i) => i & 0xff)
    const tampered = Uint8Array.from(bytes, (byte, i) => (i === 256 ? byte ^ 0b1 : byte))

    expect(await contentHash(tampered)).not.toBe(await contentHash(bytes))
  })

  it('віддає 64 шістнадцяткові символи в нижньому регістрі', async () => {
    // Форма важлива, бо ончейн лежить [u8; 32], і саме цей рядок звіряється
    // з ним у каталозі й у незалежному звіряч (SC-008).
    expect(await contentHash(Uint8Array.from([0xff, 0x00]))).toMatch(/^[0-9a-f]{64}$/)
  })
})
