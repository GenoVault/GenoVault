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
/**
 * Скільки записів приймає одна згортка. Дзеркало `BATCH`.
 *
 * Чотири, і це межа тулчейну, а не смак: Arcium відхиляє визначення обчислення
 * важче за 5 000 000 000 ACU, а `frequencies_fold` важить
 * `0,861 + 0,522 × BATCH` мільярда — при 32 це 17,6 млрд, при 8 — 5,04 млрд,
 * при 4 — 2,95 млрд (виміряно збіркою контуру).
 */
export const RECIPE_BATCH = 4

/** Ширина слова, яким черга обчислень ріже зріз акаунта. */
export const WORD_BYTES = 32

/**
 * Скільки 32-байтових слів займає один запис: ключ, нонс і 67 шифротекстів.
 *
 * 67 — це `SCALAR_FIELD_COUNT + MARKERS`, тобто `sex`, `age`, `affected` і
 * маркери. Розійтися з конвертом їм не дасть `assertEnvelopeFitsRecipe`.
 */
export const RECORD_WORDS = 2 + 3 + RECIPE_MARKERS

/** Скільки байтів займає батч: 4 × 69 × 32 = 8 832. */
export const BATCH_PAYLOAD_BYTES = RECIPE_BATCH * RECORD_WORDS * WORD_BYTES

/** Заголовок буфера: мітка, прогін, bump і вирівнювання до 64. */
export const BATCH_BUFFER_HEADER_BYTES = 64
export const BATCH_BUFFER_BYTES = BATCH_BUFFER_HEADER_BYTES + BATCH_PAYLOAD_BYTES

/**
 * Скільки байтів акаунта створює `open_run`.
 *
 * Акаунт, створений через CPI, не буває більшим за межу приросту за одну
 * інструкцію. При `RECIPE_BATCH = 4` буфер у неї вміщається цілком, тож
 * `growSteps()` віддає нуль і `grow_batch_buffer` не кличеться жодного разу.
 */
export const MAX_PERMITTED_DATA_INCREASE = 10 * 1024
export const BATCH_BUFFER_INITIAL_BYTES = Math.min(BATCH_BUFFER_BYTES, MAX_PERMITTED_DATA_INCREASE)

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
