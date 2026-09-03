import { x25519 } from '@arcium-hq/client'
import { contentHash } from '@genovault/shared'
import { describe, expect, it } from 'vitest'
import {
  DatasetEnvelopeError,
  type DatasetRecord,
  decryptDataset,
  encryptDataset,
  FORMAT_VERSION,
  HEADER_BYTES,
  LIMB_BYTES,
  NONCE_BYTES,
  parseEnvelope,
  SCALAR_FIELD_COUNT,
  sealDataset,
} from '../src/index.ts'

/** Кластер, який у тестах грає MXE: у проді цей ключ розділений між вузлами. */
function mxeKeypair() {
  const secretKey = x25519.utils.randomSecretKey()
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) }
}

const MARKERS = 4

function record(seed: number): DatasetRecord {
  return {
    sex: seed % 2 === 0 ? 0 : 1,
    age: 18 + (seed % 60),
    affected: seed % 3 === 0 ? 1 : 0,
    genotypes: Array.from({ length: MARKERS }, (_, i) => (seed + i) % 3),
  }
}

const RECORDS = Array.from({ length: 7 }, (_, i) => record(i))

const frameBytes = (markerCount: number) =>
  NONCE_BYTES + (SCALAR_FIELD_COUNT + markerCount) * LIMB_BYTES

describe('шифр → відбиток → дешифр', () => {
  it('повертає ті самі записи після повного кола', () => {
    const mxe = mxeKeypair()
    const { bytes } = encryptDataset(RECORDS, mxe.publicKey)

    expect(decryptDataset(bytes, mxe.secretKey)).toEqual(RECORDS)
  })

  it('відбиток запечатаного датасету — це sha-256 саме тих байтів, що йдуть у сховище', async () => {
    const mxe = mxeKeypair()
    const sealed = await sealDataset(RECORDS, mxe.publicKey)

    expect(sealed.contentHash).toBe(await contentHash(sealed.bytes))
    expect(sealed.recordCount).toBe(RECORDS.length)
    expect(sealed.markerCount).toBe(MARKERS)
  })

  it('тримає розмір, який обіцяє заголовок', () => {
    const mxe = mxeKeypair()
    const { bytes } = encryptDataset(RECORDS, mxe.publicKey)

    expect(bytes.length).toBe(HEADER_BYTES + RECORDS.length * frameBytes(MARKERS))
  })

  it('кладе в заголовок ефемерний ключ, яким кластер відновить спільний секрет', () => {
    const mxe = mxeKeypair()
    const encrypted = encryptDataset(RECORDS, mxe.publicKey)
    const { header } = parseEnvelope(encrypted.bytes)

    expect(header.ephemeralPublicKey).toEqual(encrypted.ephemeralPublicKey)
    expect(header.mxePublicKey).toEqual(mxe.publicKey)
    expect(header.fieldsPerRecord).toBe(SCALAR_FIELD_COUNT + MARKERS)
  })

  it('витримує датасет на один запис і на один маркер', () => {
    const mxe = mxeKeypair()
    const single: DatasetRecord[] = [{ sex: 1, age: 41, affected: 0, genotypes: [2] }]

    expect(decryptDataset(encryptDataset(single, mxe.publicKey).bytes, mxe.secretKey)).toEqual(
      single,
    )
  })
})

describe('ключ не покидає браузер', () => {
  it('не віддає нічого, з чого відновлюється ефемерний скаляр', () => {
    const mxe = mxeKeypair()
    const encrypted = encryptDataset(RECORDS, mxe.publicKey)

    // Публічний API — рівно ці чотири поля. Поява тут будь-чого схожого на
    // приватний ключ означала б, що ключ шифрування можна винести з браузера,
    // а це не оптимізація, а зміна продукту (FR-004a).
    expect(Object.keys(encrypted).sort()).toEqual([
      'bytes',
      'ephemeralPublicKey',
      'markerCount',
      'recordCount',
    ])
  })

  it('не піддається чужому ключу кластера', () => {
    const mxe = mxeKeypair()
    const stranger = mxeKeypair()
    const { bytes } = encryptDataset(RECORDS, mxe.publicKey)

    expect(() => decryptDataset(bytes, stranger.secretKey)).toThrow(DatasetEnvelopeError)
  })

  it('не лишає значень запису у відкритому вигляді в конверті', () => {
    const mxe = mxeKeypair()
    // Усі поля нульові: якби шифру не сталося, кадр був би суцільними нулями.
    const zeros: DatasetRecord[] = [{ sex: 0, age: 0, affected: 0, genotypes: [0, 0, 0, 0] }]
    const { frames } = parseEnvelope(encryptDataset(zeros, mxe.publicKey).bytes)

    for (const limb of frames[0]?.limbs ?? []) {
      expect(limb.every((byte) => byte === 0)).toBe(false)
    }
  })
})

describe('свіжа пара ключів на кожне шифрування', () => {
  it('дає різний шифротекст для того самого вмісту', () => {
    const mxe = mxeKeypair()
    const first = encryptDataset(RECORDS, mxe.publicKey)
    const second = encryptDataset(RECORDS, mxe.publicKey)

    // Це не про приховування того, що версія не змінилась, — версію однаково
    // видно ончейн. Це про режим CTR: за спільного ключа однакові nonce дали б
    // однакову гаму, і різниця двох конвертів видала б різницю записів.
    expect(first.ephemeralPublicKey).not.toEqual(second.ephemeralPublicKey)
    expect(first.bytes).not.toEqual(second.bytes)
    expect(decryptDataset(second.bytes, mxe.secretKey)).toEqual(
      decryptDataset(first.bytes, mxe.secretKey),
    )
  })

  it('не повторює nonce між кадрами', () => {
    const mxe = mxeKeypair()
    const { frames } = parseEnvelope(encryptDataset(RECORDS, mxe.publicKey).bytes)
    const nonces = new Set(frames.map((frame) => frame.nonce.join(',')))

    expect(nonces.size).toBe(RECORDS.length)
  })
})

describe('конверт відмовляє, а не вгадує', () => {
  const mxe = mxeKeypair()
  const valid = () => encryptDataset(RECORDS, mxe.publicKey).bytes

  it('на чужому magic', () => {
    const bytes = valid()
    bytes[0] = 0x00
    expect(() => parseEnvelope(bytes)).toThrow(/не конверт датасету/)
  })

  it('на незнайомій версії формату', () => {
    const bytes = valid()
    bytes[4] = FORMAT_VERSION + 1
    expect(() => parseEnvelope(bytes)).toThrow(/версія формату/)
  })

  it('на ненульовому резерві — щоб майбутній прапорець не знехтували мовчки', () => {
    const bytes = valid()
    bytes[6] = 0b1
    expect(() => parseEnvelope(bytes)).toThrow(/резервні байти/)
  })

  it('на обрізаному файлі', () => {
    expect(() => parseEnvelope(valid().slice(0, HEADER_BYTES + 10))).toThrow(/очікувалось \d+ байт/)
    expect(() => parseEnvelope(new Uint8Array(10))).toThrow(/коротший за заголовок/)
  })

  it('на заголовку, що суперечить сам собі', () => {
    const bytes = valid()
    // markerCount на одиницю більший за той, під який нарізані кадри.
    new DataView(bytes.buffer).setUint32(76, MARKERS + 1, true)
    expect(() => parseEnvelope(bytes)).toThrow(/сам собі суперечить/)
  })

  it('на повтореному nonce — це вже скомпрометована гама, а не дрібна вада', () => {
    const bytes = valid()
    const second = HEADER_BYTES + frameBytes(MARKERS)
    bytes.set(bytes.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES), second)

    expect(() => parseEnvelope(bytes)).toThrow(/nonce повторюється/)
  })

  it('на підміненому шифротексті — бо цілісність тут тримає відбиток, не шифр', () => {
    // Rescue у режимі CTR не автентифікований: підміна байта не «не сходиться»,
    // а дає інший відкритий текст. Ловить її sha-256 ончейн (FR-004); тут
    // видно лише другий, слабший бар'єр — значення поза межами схеми.
    const bytes = valid()
    const firstLimb = HEADER_BYTES + NONCE_BYTES
    bytes.set([0xff, 0xff, 0xff, 0xff], firstLimb)

    expect(() => decryptDataset(bytes, mxe.secretKey)).toThrow(RangeError)
  })
})

describe('вхід перевіряється до шифру', () => {
  const mxe = mxeKeypair()

  it('відхиляє записи з різною кількістю маркерів', () => {
    const ragged: DatasetRecord[] = [record(0), { ...record(1), genotypes: [0, 1] }]
    expect(() => encryptDataset(ragged, mxe.publicKey)).toThrow(/маркерів замість/)
  })

  it('відхиляє генотип поза 0..2', () => {
    const broken: DatasetRecord[] = [{ sex: 0, age: 30, affected: 0, genotypes: [3, 0, 0, 0] }]
    expect(() => encryptDataset(broken, mxe.publicKey)).toThrow()
  })

  it('відхиляє порожній датасет і ключ кластера не тієї довжини', () => {
    expect(() => encryptDataset([], mxe.publicKey)).toThrow(/без записів/)
    expect(() => encryptDataset(RECORDS, mxe.publicKey.slice(0, 31))).toThrow(/32 байт/)
  })
})
