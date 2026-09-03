import { type ContentHash, contentHashSchema } from './primitives.ts'

const HEX_BY_BYTE = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'))

/**
 * Відбиток вмісту датасету — sha-256 **шифротексту** (`FR-004`).
 *
 * Хешується саме шифротекст, а не сирі записи, і це не деталь реалізації.
 * Відбиток має перевіряти той, хто записів не бачить: сховище при прийомі
 * (`T015`), покупець перед замовленням прогону і незалежний звіряч (`SC-008`).
 * Відбиток відкритого вмісту не перевірив би ніхто з них, зате дав би
 * оператору оракул на підбір записів.
 *
 * Функція живе в `packages/shared`, а не поруч із шифруванням, саме тому, що
 * ключів вона не торкається: `apps/api` потребує її і не має права тягнути в
 * свій граф залежностей бібліотеку, якою можна розшифрувати (`FR-004a`).
 *
 * Асинхронна, бо WebCrypto в браузері синхронного дайджесту не має, а
 * реалізація тут одна на браузер і на Node — розходження між ними означало б,
 * що власник і сховище рахують відбиток різним кодом.
 */
export async function contentHash(ciphertext: Uint8Array): Promise<ContentHash> {
  // WebCrypto не працює з поданням над SharedArrayBuffer, і тип це відображає.
  // Звичайний випадок проходить без копії; копія лишається платою рівно за той
  // вхід, який інакше не хешується взагалі.
  const source =
    ciphertext.buffer instanceof ArrayBuffer
      ? new Uint8Array(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength)
      : Uint8Array.from(ciphertext)

  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', source))

  let hex = ''
  for (const byte of digest) hex += HEX_BY_BYTE[byte]

  return contentHashSchema.parse(hex)
}
