/**
 * Розкладка батча в буферному акаунті — дзеркало `state/dispatch.rs` (`T030`).
 *
 * Черга обчислень Arcium бере вхід рівно з двох джерел, і для батча з 32
 * записів доступне тільки друге — зріз Solana-акаунта. `ArgBuilder::account`
 * покриває `length / 32` параметрів контуру поспіль, перевіряючи **лише
 * кратність 32**: типи в акаунт-аргументі не звіряються взагалі. Помилка на
 * одне слово не падає ні при збірці, ні в транзакції — контур мовчки читає
 * ключ як шифротекст і повертає число, яке виглядає як результат.
 *
 * Тому числа тут не рахуються з полів структури, а взяті з
 * `build/frequencies_fold.idarc`: на кожен запис контур чекає
 * `arcis_x25519_pubkey · u128 · ciphertext × 67`, і нонс `u128` займає **повне
 * 32-байтове слово**, а не свої 16 байтів.
 */

/** Скільки маркерів у рецепті. Дзеркало `MARKERS` в `encrypted-ixs/src/lib.rs`. */
export const RECIPE_MARKERS = 64
/** Скільки записів приймає одна згортка. Дзеркало `BATCH`. */
export const RECIPE_BATCH = 32

/** Ширина слова, яким черга обчислень ріже зріз акаунта. */
export const WORD_BYTES = 32

/**
 * Скільки 32-байтових слів займає один запис: ключ, нонс і 67 шифротекстів.
 *
 * 67 — це `SCALAR_FIELD_COUNT + MARKERS`, тобто `sex`, `age`, `affected` і
 * маркери. Розійтися з конвертом їм не дасть `assertEnvelopeFitsRecipe`.
 */
export const RECORD_WORDS = 2 + 3 + RECIPE_MARKERS

/** Скільки байтів займає батч: 32 × 69 × 32. */
export const BATCH_PAYLOAD_BYTES = RECIPE_BATCH * RECORD_WORDS * WORD_BYTES

/** Заголовок буфера: мітка, прогін, bump і вирівнювання до 64. */
export const BATCH_BUFFER_HEADER_BYTES = 64
export const BATCH_BUFFER_BYTES = BATCH_BUFFER_HEADER_BYTES + BATCH_PAYLOAD_BYTES

/** Скільки байтів акаунта створює `open_run` — межа приросту за одну інструкцію. */
export const BATCH_BUFFER_INITIAL_BYTES = 10 * 1024
export const MAX_PERMITTED_DATA_INCREASE = 10 * 1024

/**
 * Скільки разів треба покликати `grow_batch_buffer`, щоб буфер доріс до батча.
 *
 * Число рахується, а не пишеться: воно вилізе з-під пальців при зміні
 * `MARKERS`, і диспетчер, який покликав би на раз менше, дізнався б про це з
 * `BatchBufferTooSmall` посеред прогону.
 */
export function growSteps(): number {
  let length = BATCH_BUFFER_INITIAL_BYTES
  let steps = 0
  while (length < BATCH_BUFFER_BYTES) {
    length = Math.min(length + MAX_PERMITTED_DATA_INCREASE, BATCH_BUFFER_BYTES)
    steps += 1
  }
  return steps
}
