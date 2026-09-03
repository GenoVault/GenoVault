import { describe, expect, it } from 'vitest'
import {
  DatasetEnvelopeError,
  FORMAT_VERSION,
  HEADER_BYTES,
  inspectEnvelope,
  LIMB_BYTES,
  NONCE_BYTES,
  parseEnvelope,
  SCALAR_FIELD_COUNT,
  serializeEnvelope,
  X25519_KEY_BYTES,
} from '../src/index.ts'

// Конверт тут збирається руками, без шифру: формат має перевірятись сам по
// собі. Гейт сховища (T015) працює саме так — він бачить байти й не має ключа.
const RECORDS = 3
const MARKERS = 4
const FIELDS = SCALAR_FIELD_COUNT + MARKERS
const FRAME = NONCE_BYTES + FIELDS * LIMB_BYTES

const key = (fill: number) => Uint8Array.from({ length: X25519_KEY_BYTES }, () => fill)

function nonce(index: number): Uint8Array {
  const bytes = new Uint8Array(NONCE_BYTES)
  new DataView(bytes.buffer).setUint32(0, index, true)
  return bytes
}

function frames(count = RECORDS) {
  return Array.from({ length: count }, (_, record) => ({
    nonce: nonce(record),
    limbs: Array.from({ length: FIELDS }, (_, field) =>
      Array.from({ length: LIMB_BYTES }, (_, byte) => (record + field + byte) % 256),
    ),
  }))
}

const header = (over: Partial<{ recordCount: number; markerCount: number }> = {}) => ({
  mxePublicKey: key(0x11),
  ephemeralPublicKey: key(0x22),
  recordCount: over.recordCount ?? RECORDS,
  markerCount: over.markerCount ?? MARKERS,
  fieldsPerRecord: SCALAR_FIELD_COUNT + (over.markerCount ?? MARKERS),
})

const valid = () => serializeEnvelope(header(), frames())

describe('serializeEnvelope / parseEnvelope', () => {
  it('повертає той самий заголовок і ті самі кадри', () => {
    const parsed = parseEnvelope(valid())

    expect(parsed.header).toEqual(header())
    expect(parsed.frames).toEqual(frames())
  })

  it('тримає обіцяну довжину', () => {
    expect(valid().length).toBe(HEADER_BYTES + RECORDS * FRAME)
  })

  it('inspectEnvelope дає той самий заголовок, не збираючи кадрів', () => {
    expect(inspectEnvelope(valid())).toEqual(parseEnvelope(valid()).header)
  })
})

describe('конверт відмовляє, а не вгадує', () => {
  it('на чужому magic', () => {
    const bytes = valid()
    bytes[0] = 0x00
    expect(() => inspectEnvelope(bytes)).toThrow(/не конверт датасету/)
  })

  it('на незнайомій версії формату', () => {
    const bytes = valid()
    bytes[4] = FORMAT_VERSION + 1
    expect(() => inspectEnvelope(bytes)).toThrow(/версія формату/)
  })

  it('на ненульовому резерві — щоб майбутній прапорець не знехтували мовчки', () => {
    const bytes = valid()
    bytes[6] = 0b1
    expect(() => inspectEnvelope(bytes)).toThrow(/резервні байти/)
  })

  it('на коротшому за заголовок і на обрізаному файлі', () => {
    expect(() => inspectEnvelope(new Uint8Array(10))).toThrow(/коротший за заголовок/)
    expect(() => inspectEnvelope(valid().slice(0, HEADER_BYTES + 10))).toThrow(
      /очікувалось \d+ байт/,
    )
  })

  it('на порожньому датасеті й датасеті без маркерів', () => {
    // Обидва проходять серіалізацію — заборона живе саме в читачі, бо саме він
    // стоїть на межі, куди приходять чужі байти.
    expect(() => inspectEnvelope(serializeEnvelope(header({ recordCount: 0 }), []))).toThrow(
      /без записів/,
    )
    expect(() => inspectEnvelope(serializeEnvelope(header({ markerCount: 0 }), frames(0)))).toThrow(
      /без маркерів/,
    )
  })

  it('на заголовку, що суперечить сам собі', () => {
    const bytes = valid()
    new DataView(bytes.buffer).setUint32(76, MARKERS + 1, true)
    expect(() => inspectEnvelope(bytes)).toThrow(/сам собі суперечить/)
  })

  it('на повтореному nonce — це вже скомпрометована гама, а не дрібна вада', () => {
    const bytes = valid()
    bytes.set(bytes.subarray(HEADER_BYTES, HEADER_BYTES + NONCE_BYTES), HEADER_BYTES + FRAME)

    expect(() => inspectEnvelope(bytes)).toThrow(/nonce повторюється/)
  })

  it('відмовляє власним типом помилки, а не будь-якою', () => {
    // Сховище розрізняє «це не шифротекст» і «диск не відповів» саме за типом.
    expect(() => inspectEnvelope(new Uint8Array(HEADER_BYTES))).toThrow(DatasetEnvelopeError)
  })
})
