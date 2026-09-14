/**
 * Як батч на 70 656 байтів роз'їжджається по транзакціях (`T030`).
 *
 * Транзакція Solana — 1232 байти на все: підписи, ключі акаунтів, хеш блоку,
 * інструкції. Інших транзакцій не буває, і збільшити цю межу неможливо, тож
 * один батч це десятки викликів `write_batch`. Порядок між ними довільний:
 * кожен несе власний зсув і сусіднього шматка не чіпає.
 */

import { BATCH_PAYLOAD_BYTES, WORD_BYTES } from './layout.ts'

/**
 * Скільки байтів вантажу вміщає одна транзакція `write_batch`.
 *
 * Рахунок для транзакції версії 0 з п'ятьма адресами (диспетчер, прогін,
 * накопичувач, буфер, програма) і порожнім списком таблиць пошуку:
 *
 * ```
 *   1 + 64  підпис диспетчера
 *   1       мітка версії
 *   3       заголовок повідомлення
 *   1 + 160 п'ять ключів акаунтів
 *   32      хеш блоку
 *   1       кількість інструкцій
 *   1       індекс програми
 *   1 + 4   індекси акаунтів інструкції
 *   2       довжина даних інструкції
 *   8       дискримінатор
 *   4       offset: u32
 *   4       довжина Vec<u8>
 *   1       порожній список таблиць пошуку
 *   ────
 *   288     і 944 байти лишається на вантаж
 * ```
 *
 * Беремо 896 — на 48 байтів нижче стелі й рівно 28 слів по 32 байти. Кратність
 * слову не потрібна черзі обчислень (вона читає весь зріз одразу), але робить
 * зсув у транзакції читабельним, а межу шматка — межею запису, а не серединою
 * шифротексту. Запас у 48 байтів не косметика: `ComputeBudget` чи ще один
 * підпис колись з'являться, і тоді впертись має тест, а не мережа.
 */
export const WRITE_CHUNK_BYTES = 28 * WORD_BYTES

/** Стеля транзакції Solana. Тут — щоб тест мав із чим звіряти. */
export const MAX_TRANSACTION_BYTES = 1232

export interface WriteChunk {
  /** Зсув від початку вантажу буфера, не від початку акаунта. */
  offset: number
  bytes: Uint8Array
}

/**
 * Ріже вантаж батча на шматки під транзакцію.
 *
 * Останній шматок коротший за решту — вирівнювати його добиванням нулів було б
 * записом у чужу частину буфера, якби вантаж колись перестав ділитись націло.
 */
export function planWrites(
  payload: Uint8Array,
  chunkBytes: number = WRITE_CHUNK_BYTES,
): WriteChunk[] {
  if (payload.length !== BATCH_PAYLOAD_BYTES) {
    throw new RangeError(`вантаж батча — ${BATCH_PAYLOAD_BYTES} байтів, отримано ${payload.length}`)
  }
  if (!Number.isInteger(chunkBytes) || chunkBytes < 1) {
    throw new RangeError(`розмір шматка має бути додатним цілим, отримано ${chunkBytes}`)
  }

  const chunks: WriteChunk[] = []
  for (let offset = 0; offset < payload.length; offset += chunkBytes) {
    chunks.push({
      offset,
      bytes: payload.subarray(offset, Math.min(offset + chunkBytes, payload.length)),
    })
  }
  return chunks
}

/** Скільки транзакцій запису коштує один батч. */
export function writesPerBatch(chunkBytes: number = WRITE_CHUNK_BYTES): number {
  return Math.ceil(BATCH_PAYLOAD_BYTES / chunkBytes)
}
