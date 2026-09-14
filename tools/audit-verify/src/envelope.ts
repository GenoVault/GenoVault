/**
 * Конверт `GVDS`, розібраний звірячем самостійно (`FR-025`).
 *
 * Формат публічний — він описаний у репозиторії й у ньому немає нічого, чого
 * не видно з файлу. Читач написаний тут заново, а не взятий із
 * `packages/shared`, з тієї ж причини, з якої тут свій Borsh: перевірка нашим
 * кодом нічого не доводить третій стороні.
 *
 * Шифротекст звіряч бачить і не розшифровує. Ключа MXE він не має й мати не
 * може — приватна половина розділена між вузлами, — тож усе, що тут
 * відбувається, це різання байтів на кадри.
 */

const MAGIC = [0x47, 0x56, 0x44, 0x53] as const
const FORMAT_VERSION = 1

export const NONCE_BYTES = 16
export const LIMB_BYTES = 32
/** `sex`, `age`, `affected` — і далі маркери. */
export const SCALAR_FIELD_COUNT = 3
export const HEADER_BYTES = 4 + 1 + 3 + 32 + 32 + 4 * 3

const OFFSET_VERSION = 4
const OFFSET_MXE_KEY = 8
const OFFSET_EPHEMERAL_KEY = OFFSET_MXE_KEY + 32
const OFFSET_RECORD_COUNT = OFFSET_EPHEMERAL_KEY + 32
const OFFSET_MARKER_COUNT = OFFSET_RECORD_COUNT + 4
const OFFSET_FIELDS_PER_RECORD = OFFSET_MARKER_COUNT + 4

export class EnvelopeError extends Error {
  override readonly name = 'EnvelopeError'
}

export interface EnvelopeHeader {
  mxePublicKey: Uint8Array
  /** Ефемерний ключ власника — він же спільний ключ кожного кадру в буфері. */
  ephemeralPublicKey: Uint8Array
  recordCount: number
  markerCount: number
  fieldsPerRecord: number
}

export function frameBytes(fieldsPerRecord: number): number {
  return NONCE_BYTES + fieldsPerRecord * LIMB_BYTES
}

export function readHeader(bytes: Uint8Array): EnvelopeHeader {
  if (bytes.length < HEADER_BYTES) {
    throw new EnvelopeError(`файл коротший за заголовок: ${bytes.length} < ${HEADER_BYTES}`)
  }
  for (const [index, byte] of MAGIC.entries()) {
    if (bytes[index] !== byte) throw new EnvelopeError('це не конверт датасету GenoVault')
  }
  if (bytes[OFFSET_VERSION] !== FORMAT_VERSION) {
    throw new EnvelopeError(
      `версія формату ${bytes[OFFSET_VERSION]}, читач розуміє ${FORMAT_VERSION}`,
    )
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header: EnvelopeHeader = {
    mxePublicKey: bytes.slice(OFFSET_MXE_KEY, OFFSET_MXE_KEY + 32),
    ephemeralPublicKey: bytes.slice(OFFSET_EPHEMERAL_KEY, OFFSET_EPHEMERAL_KEY + 32),
    recordCount: view.getUint32(OFFSET_RECORD_COUNT, true),
    markerCount: view.getUint32(OFFSET_MARKER_COUNT, true),
    fieldsPerRecord: view.getUint32(OFFSET_FIELDS_PER_RECORD, true),
  }

  if (header.fieldsPerRecord !== SCALAR_FIELD_COUNT + header.markerCount) {
    throw new EnvelopeError(
      `заголовок сам собі суперечить: ${header.fieldsPerRecord} полів при ${header.markerCount} маркерах`,
    )
  }
  const expected = HEADER_BYTES + header.recordCount * frameBytes(header.fieldsPerRecord)
  if (bytes.length !== expected) {
    throw new EnvelopeError(`очікувалось ${expected} байтів, у файлі ${bytes.length}`)
  }

  return header
}

/** Зсув кадру запису від початку файлу. */
export function frameAt(header: EnvelopeHeader, record: number): number {
  return HEADER_BYTES + record * frameBytes(header.fieldsPerRecord)
}
