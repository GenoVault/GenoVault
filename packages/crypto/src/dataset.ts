import { RescueCipher, x25519 } from '@arcium-hq/client'
import {
  type ContentHash,
  contentHash,
  DatasetEnvelopeError,
  type EnvelopeHeader,
  type Frame,
  NONCE_BYTES,
  parseEnvelope,
  SCALAR_FIELD_COUNT,
  serializeEnvelope,
  X25519_KEY_BYTES,
} from '@genovault/shared'
import {
  type DatasetRecord,
  datasetRecordSchema,
  fromFieldElements,
  toFieldElements,
} from './record.ts'

export interface EncryptedDataset {
  /** Конверт цілком: заголовок і кадри. Саме ці байти йдуть у сховище. */
  bytes: Uint8Array
  /** Той самий ключ, що лежить у заголовку — повертається, щоб не розбирати конверт заново. */
  ephemeralPublicKey: Uint8Array
  recordCount: number
  markerCount: number
}

export interface SealedDataset extends EncryptedDataset {
  /** sha-256 конверта — те, що піде в `Dataset.content_hash` ончейн (`FR-004`). */
  contentHash: ContentHash
}

/**
 * Шифрує датасет одразу на публічний ключ MXE-кластера.
 *
 * **Ефемерний скаляр не покидає цю функцію і не повертається нікуди.** Він
 * створюється тут, дає спільний секрет і лишається сміттю збирача — тому
 * розшифрувати конверт не може ні власник, ні оператор, ні сховище, а лише
 * кластер, чий приватний ключ розділений між вузлами (`FR-004a`). Це і є
 * причина, чому в API немає функції «дай мені ключ цього датасету»: її
 * відсутність — властивість продукту, а не недогляд.
 *
 * **На кожен виклик — нова пара ключів, і це обов'язково.** Шифр Rescue працює
 * в режимі CTR: за того самого спільного секрету однакові nonce дають однакову
 * гаму. Nonce тут — номер запису, тобто на другій версії датасету він почався б
 * з нуля вдруге. Якби ключ при цьому лишився старим, різниця двох конвертів
 * видала б різницю відкритих записів без жодного ключа. Свіжа пара розриває цей
 * зв'язок: у нової версії інший секрет, і збіг номерів нічого не означає.
 */
export function encryptDataset(
  records: readonly DatasetRecord[],
  mxePublicKey: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): EncryptedDataset {
  if (mxePublicKey.length !== X25519_KEY_BYTES) {
    throw new RangeError(
      `the MXE public key must be ${X25519_KEY_BYTES} bytes, got ${mxePublicKey.length}`,
    )
  }
  if (records.length === 0)
    throw new RangeError('there is nothing to encrypt in a dataset without records')

  const markerCount = datasetRecordSchema.parse(records[0]).genotypes.length
  const plaintext = records.map((record, index) => {
    const parsed = datasetRecordSchema.parse(record)
    if (parsed.genotypes.length !== markerCount) {
      throw new RangeError(
        `record ${index} has ${parsed.genotypes.length} markers instead of ${markerCount}`,
      )
    }
    return toFieldElements(parsed)
  })

  const ephemeralSecretKey = x25519.utils.randomSecretKey()
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralSecretKey)
  const cipher = new RescueCipher(x25519.getSharedSecret(ephemeralSecretKey, mxePublicKey))

  // Progress in records, every 1%: ten thousand records are ~10 minutes of
  // CPU (`T014`), and the screen names the number instead of spinning.
  const step = Math.max(1, Math.floor(plaintext.length / 100))
  const frames: Frame[] = plaintext.map((elements, index) => {
    const nonce = nonceForRecord(index)
    const frame = { nonce, limbs: cipher.encrypt(elements, nonce) }
    if (onProgress !== undefined && ((index + 1) % step === 0 || index + 1 === plaintext.length)) {
      onProgress(index + 1, plaintext.length)
    }
    return frame
  })

  const header: EnvelopeHeader = {
    mxePublicKey,
    ephemeralPublicKey,
    recordCount: records.length,
    markerCount,
    fieldsPerRecord: SCALAR_FIELD_COUNT + markerCount,
  }

  return {
    bytes: serializeEnvelope(header, frames),
    ephemeralPublicKey,
    recordCount: header.recordCount,
    markerCount,
  }
}

/**
 * Шифрує датасет і одразу рахує відбиток — усе, що потрібно для завантаження.
 *
 * Один виклик замість двох саме тому, що відбиток не можна забути порахувати:
 * конверт без нього неможливо ні прив'язати до `Dataset` ончейн, ні перевірити
 * при прийомі у сховищі (`T015`).
 */
export async function sealDataset(
  records: readonly DatasetRecord[],
  mxePublicKey: Uint8Array,
  onProgress?: (done: number, total: number) => void,
): Promise<SealedDataset> {
  const encrypted = encryptDataset(records, mxePublicKey, onProgress)
  return { ...encrypted, contentHash: await contentHash(encrypted.bytes) }
}

/**
 * Зворотний шлях — те, що робить кластер, і те, чого не може зробити ніхто інший.
 *
 * У проді приватного ключа MXE не тримає жодна окрема сторона: він розділений
 * між вузлами, і «розшифрувати датасет» там не є операцією, яку хтось виконує
 * цілком. Функція існує з двох причин: вона робить перевірним сам шифр (TDD
 * `T014`: шифр → відбиток → дешифр) і є еталоном розкладки для рецепта мовою
 * Arcis (`T018`), який читає ті самі кадри всередині MPC. На локальному
 * кластері ключ наш, тож нею ж міряється звірка якості (`SC-002`).
 */
export function decryptDataset(bytes: Uint8Array, mxeSecretKey: Uint8Array): DatasetRecord[] {
  const { header, frames } = parseEnvelope(bytes)

  const derived = x25519.getPublicKey(mxeSecretKey)
  if (!derived.every((byte, index) => header.mxePublicKey[index] === byte)) {
    throw new DatasetEnvelopeError('the envelope is encrypted to another cluster')
  }

  const cipher = new RescueCipher(x25519.getSharedSecret(mxeSecretKey, header.ephemeralPublicKey))

  return frames.map((frame) => fromFieldElements(cipher.decrypt(frame.limbs, frame.nonce)))
}

/**
 * Nonce записи беруть із власного номера, а не з випадковості.
 *
 * У режимі CTR nonce має бути унікальним у межах ключа — випадковості він не
 * потребує. Номер дає унікальність за побудовою й дозволяє кластеру звернутись
 * до запису, не читаючи його кадр наперед. Секрету тут не витікає: порядковий
 * номер запису видно з довжини файлу й без нонсів.
 */
function nonceForRecord(index: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES)
  new DataView(nonce.buffer).setUint32(0, index, true)
  return nonce
}
