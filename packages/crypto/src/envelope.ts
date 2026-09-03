import { SCALAR_FIELD_COUNT } from './record.ts'

/** `GVDS` — GenoVault DataSet. */
export const MAGIC = Uint8Array.from([0x47, 0x56, 0x44, 0x53])

/** Версія формату файлу, а не версія датасету: остання живе ончейн у `Dataset`. */
export const FORMAT_VERSION = 1

export const X25519_KEY_BYTES = 32
/** Rescue у режимі CTR приймає рівно 16 байтів nonce. */
export const NONCE_BYTES = 16
/** Кожен елемент поля Curve25519 серіалізується у 32 байти little-endian. */
export const LIMB_BYTES = 32

const RESERVED_BYTES = 3
export const HEADER_BYTES = 4 + 1 + RESERVED_BYTES + X25519_KEY_BYTES * 2 + 4 * 3

const OFFSET_VERSION = 4
const OFFSET_RESERVED = 5
const OFFSET_MXE_KEY = 8
const OFFSET_EPHEMERAL_KEY = OFFSET_MXE_KEY + X25519_KEY_BYTES
const OFFSET_RECORD_COUNT = OFFSET_EPHEMERAL_KEY + X25519_KEY_BYTES
const OFFSET_MARKER_COUNT = OFFSET_RECORD_COUNT + 4
const OFFSET_FIELDS_PER_RECORD = OFFSET_MARKER_COUNT + 4

/** Помилка розбору конверта — окремий тип, щоб сховище відрізняло її від збою вводу-виводу. */
export class DatasetEnvelopeError extends Error {
  override readonly name = 'DatasetEnvelopeError'
}

export interface EnvelopeHeader {
  /** Публічний ключ MXE-кластера, на який шифрували. */
  mxePublicKey: Uint8Array
  /**
   * Ефемерний публічний ключ власника. Кластер відновлює з нього той самий
   * спільний секрет; відповідного скаляра не існує ніде — його викинули в
   * браузері одразу після шифрування (`FR-004a`).
   */
  ephemeralPublicKey: Uint8Array
  recordCount: number
  markerCount: number
  /** `SCALAR_FIELD_COUNT + markerCount`; лежить у файлі явно, щоб читач не вгадував розкладку. */
  fieldsPerRecord: number
}

export interface Frame {
  nonce: Uint8Array
  /** `fieldsPerRecord` лімбів по 32 байти — рівно те, що повертає `RescueCipher.encrypt`. */
  limbs: number[][]
}

export function frameBytes(fieldsPerRecord: number): number {
  return NONCE_BYTES + fieldsPerRecord * LIMB_BYTES
}

export function envelopeBytes(header: Pick<EnvelopeHeader, 'recordCount' | 'fieldsPerRecord'>) {
  return HEADER_BYTES + header.recordCount * frameBytes(header.fieldsPerRecord)
}

export function serialize(header: EnvelopeHeader, frames: readonly Frame[]): Uint8Array {
  const bytes = new Uint8Array(envelopeBytes(header))
  const view = new DataView(bytes.buffer)

  bytes.set(MAGIC, 0)
  bytes[OFFSET_VERSION] = FORMAT_VERSION
  bytes.set(header.mxePublicKey, OFFSET_MXE_KEY)
  bytes.set(header.ephemeralPublicKey, OFFSET_EPHEMERAL_KEY)
  view.setUint32(OFFSET_RECORD_COUNT, header.recordCount, true)
  view.setUint32(OFFSET_MARKER_COUNT, header.markerCount, true)
  view.setUint32(OFFSET_FIELDS_PER_RECORD, header.fieldsPerRecord, true)

  let offset = HEADER_BYTES
  for (const frame of frames) {
    bytes.set(frame.nonce, offset)
    offset += NONCE_BYTES
    for (const limb of frame.limbs) {
      bytes.set(limb, offset)
      offset += LIMB_BYTES
    }
  }

  return bytes
}

export function parse(bytes: Uint8Array): { header: EnvelopeHeader; frames: Frame[] } {
  if (bytes.length < HEADER_BYTES) {
    throw new DatasetEnvelopeError(`файл коротший за заголовок: ${bytes.length} < ${HEADER_BYTES}`)
  }
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) {
    throw new DatasetEnvelopeError('це не конверт датасету GenoVault')
  }
  if (bytes[OFFSET_VERSION] !== FORMAT_VERSION) {
    throw new DatasetEnvelopeError(
      `версія формату ${bytes[OFFSET_VERSION]}, читач розуміє ${FORMAT_VERSION}`,
    )
  }

  // Резерв читається, а не пропускається: коли він колись стане полем прапорців,
  // цей рядок змусить старого читача відмовити, а не тихо знехтувати прапорцем.
  for (let i = OFFSET_RESERVED; i < OFFSET_RESERVED + RESERVED_BYTES; i += 1) {
    if (bytes[i] !== 0) throw new DatasetEnvelopeError('резервні байти заголовка не нульові')
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header: EnvelopeHeader = {
    mxePublicKey: bytes.slice(OFFSET_MXE_KEY, OFFSET_MXE_KEY + X25519_KEY_BYTES),
    ephemeralPublicKey: bytes.slice(OFFSET_EPHEMERAL_KEY, OFFSET_EPHEMERAL_KEY + X25519_KEY_BYTES),
    recordCount: view.getUint32(OFFSET_RECORD_COUNT, true),
    markerCount: view.getUint32(OFFSET_MARKER_COUNT, true),
    fieldsPerRecord: view.getUint32(OFFSET_FIELDS_PER_RECORD, true),
  }

  if (header.recordCount === 0) throw new DatasetEnvelopeError('датасет без записів')
  if (header.fieldsPerRecord !== SCALAR_FIELD_COUNT + header.markerCount) {
    throw new DatasetEnvelopeError(
      `заголовок сам собі суперечить: ${header.fieldsPerRecord} полів на запис ` +
        `при ${header.markerCount} маркерах`,
    )
  }

  const expected = envelopeBytes(header)
  if (bytes.length !== expected) {
    throw new DatasetEnvelopeError(`очікувалось ${expected} байтів, у файлі ${bytes.length}`)
  }

  const frames: Frame[] = []
  const seenNonces = new Set<string>()
  let offset = HEADER_BYTES

  for (let record = 0; record < header.recordCount; record += 1) {
    const nonce = bytes.slice(offset, offset + NONCE_BYTES)
    offset += NONCE_BYTES

    // Повторений nonce за спільного ключа означає повторену гаму, а різниця двох
    // таких кадрів — це різниця відкритих записів без жодного ключа. Читач має
    // відмовити, а не розшифрувати те, що вже скомпрометоване.
    const seen = nonce.join(',')
    if (seenNonces.has(seen)) {
      throw new DatasetEnvelopeError(`nonce повторюється на записі ${record}`)
    }
    seenNonces.add(seen)

    const limbs: number[][] = []
    for (let field = 0; field < header.fieldsPerRecord; field += 1) {
      limbs.push(Array.from(bytes.subarray(offset, offset + LIMB_BYTES)))
      offset += LIMB_BYTES
    }

    frames.push({ nonce, limbs })
  }

  return { header, frames }
}
