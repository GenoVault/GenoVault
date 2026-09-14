/**
 * Конверт `GVDS` → розкладка буфера, яку читає черга обчислень (`T030`).
 *
 * Це єдине місце, де форма файлу зустрічається з формою контуру, і обидві
 * задані не нами: перша — `packages/shared/src/envelope.ts`, друга —
 * `build/frequencies_fold.idarc`. Помилка тут не падає ніде: черга ділить
 * довжину зрізу на 32 і типів не звіряє, тож зсув на одне слово дає
 * результат, який виглядає як результат.
 */

import {
  type EnvelopeHeader,
  frameBytes,
  HEADER_BYTES,
  inspectEnvelope,
  LIMB_BYTES,
  NONCE_BYTES,
  SCALAR_FIELD_COUNT,
} from '@genovault/shared'
import {
  BATCH_PAYLOAD_BYTES,
  RECIPE_BATCH,
  RECIPE_MARKERS,
  RECORD_WORDS,
  WORD_BYTES,
} from './layout.ts'

/** Розбіжність між конвертом і рецептом — окремий тип, щоб не зливалася з вводом-виводом. */
export class TranscodeError extends Error {
  override readonly name = 'TranscodeError'
}

export interface Batch {
  /** Порядковий номер батча в межах датасету. */
  index: number
  /** Номер першого запису датасету, що потрапив у цей батч. */
  firstRecord: number
  /**
   * Скільки слотів батча несуть справжні записи — те саме число, що йде
   * аргументом `live` у `dispatch_fold`.
   */
  live: number
  /** Рівно `BATCH_PAYLOAD_BYTES` у розкладці черги обчислень. */
  payload: Uint8Array
}

/**
 * Чи описує конверт той самий запис, що чекає контур.
 *
 * Перевіряється до першого байта в ланцюг. Датасет із 50 маркерами (типовий
 * вивід `gen-dataset` за замовчуванням) заповнив би буфер на три чверті, і
 * прогін пішов би в MPC із хвостом чужих байтів замість шифротексту.
 */
export function assertEnvelopeFitsRecipe(header: EnvelopeHeader): void {
  if (header.markerCount !== RECIPE_MARKERS) {
    throw new TranscodeError(
      `рецепт приймає рівно ${RECIPE_MARKERS} маркерів, у конверті ${header.markerCount}`,
    )
  }
  if (header.fieldsPerRecord !== RECORD_WORDS - 2) {
    throw new TranscodeError(
      `запис контуру — ${RECORD_WORDS - 2} польових елементів, у конверті ${header.fieldsPerRecord}`,
    )
  }
}

/** Скільки згорток потрібно датасету такої довжини. */
export function batchCount(recordCount: number): number {
  if (!Number.isInteger(recordCount) || recordCount < 1) {
    throw new TranscodeError(`записів у датасеті має бути щонайменше 1, отримано ${recordCount}`)
  }
  return Math.ceil(recordCount / RECIPE_BATCH)
}

/**
 * Збирає один батч у байти буфера.
 *
 * # Чому хвіст батча — це повтор першого запису, а не нулі
 *
 * Контур розшифровує **всі** 32 слоти й лише потім відкидає зайві прапорцем
 * `present = slot < live`. Нулі на місці шифротексту розшифрувались би в
 * довільні польові елементи, які контур читає як `u8`: `age`, `sex`,
 * `affected`, генотипи. Значення поза діапазоном `u8` — це не «нуль у
 * підсумку», а невизначена поведінка всередині MPC, і побачили б ми її як
 * обчислення, що не повернулось.
 *
 * Повтор справжнього кадру гарантує коректні `u8` за побудовою й нічого не
 * додає до підрахунку: `live` відсікає ці слоти до арифметики. Ціна названа —
 * шифротекст одного запису їде в ланцюг двічі, — але шифротекст і так
 * публічний, а нонс у повторі той самий, тобто нової гами не з'являється.
 */
export function transcodeBatch(bytes: Uint8Array, index: number): Batch {
  const header = inspectEnvelope(bytes)
  assertEnvelopeFitsRecipe(header)

  const total = batchCount(header.recordCount)
  if (!Number.isInteger(index) || index < 0 || index >= total) {
    throw new TranscodeError(`батч ${index} поза межами: у датасеті їх ${total}`)
  }

  const firstRecord = index * RECIPE_BATCH
  const live = Math.min(RECIPE_BATCH, header.recordCount - firstRecord)
  const payload = new Uint8Array(BATCH_PAYLOAD_BYTES)

  for (let slot = 0; slot < RECIPE_BATCH; slot += 1) {
    // Слоти за межею `live` повторюють перший справжній запис батча — див.
    // коментар вище. Саме перший, а не останній: так батч не залежить від
    // того, скільки записів у ньому виявилось живими, і два прогони над тим
    // самим датасетом дають однакові байти.
    const record = slot < live ? firstRecord + slot : firstRecord
    writeRecord(payload, slot, bytes, header, record)
  }

  return { index, firstRecord, live, payload }
}

/** Усі батчі датасету по порядку. Зручність для драйвера, не окрема логіка. */
export function transcodeDataset(bytes: Uint8Array): Batch[] {
  const header = inspectEnvelope(bytes)
  return Array.from({ length: batchCount(header.recordCount) }, (_, index) =>
    transcodeBatch(bytes, index),
  )
}

/**
 * Кладе один кадр конверта у слот батча.
 *
 * Порядок слів — з `.idarc`, не з полів структури: ключ, нонс, шифротексти.
 */
function writeRecord(
  payload: Uint8Array,
  slot: number,
  bytes: Uint8Array,
  header: EnvelopeHeader,
  record: number,
): void {
  const at = slot * RECORD_WORDS * WORD_BYTES
  const frame = HEADER_BYTES + record * frameBytes(header.fieldsPerRecord)

  // Слово 0 — спільний ключ. Один на весь датасет: секрет виводиться з пари
  // «ефемерний ключ власника × ключ MXE», і контур відновлює його сам.
  payload.set(header.ephemeralPublicKey, at)

  // Слово 1 — нонс кадру як `u128` little-endian у повному слові. Шістнадцять
  // байтів нонса лягають на початок, решта лишається нулями: рівно те, що дає
  // `serializeLE(deserializeLE(nonce), 32)` у клієнті Arcium.
  payload.set(bytes.subarray(frame, frame + NONCE_BYTES), at + WORD_BYTES)

  // Слова 2… — шифротексти, по одному лімбу на польовий елемент, у тому
  // самому порядку, в якому їх записав `RescueCipher.encrypt`.
  const limbs = frame + NONCE_BYTES
  payload.set(
    bytes.subarray(limbs, limbs + header.fieldsPerRecord * LIMB_BYTES),
    at + 2 * WORD_BYTES,
  )
}

/** Скільки польових елементів несе запис. Експортується заради тестів дзеркала. */
export const FIELDS_PER_RECORD = SCALAR_FIELD_COUNT + RECIPE_MARKERS
