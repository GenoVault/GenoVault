const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

const INDEX: ReadonlyMap<string, number> = new Map(
  Array.from(ALPHABET, (char, i) => [char, i] as const),
)

/**
 * Повертає null замість викидання винятку на будь-якому непридатному вході.
 *
 * Це не стилістика: у Zod 4 перевірки не спиняються на першій невдалій, тому
 * `.refine()` після `.regex()` отримає рядок, який регекс уже відхилив. Функція,
 * що кидає, перетворила б валідаційну помилку 400 на необроблений виняток 500.
 */
export function decodeBase58(input: string): Uint8Array | null {
  if (input.length === 0) return null

  const bytes: number[] = []
  for (const char of input) {
    const value = INDEX.get(char)
    if (value === undefined) return null

    let carry = value
    for (let i = 0; i < bytes.length; i += 1) {
      // Кожна цифра base58 множить накопичене число на 58 і додає себе.
      const total = (bytes[i] ?? 0) * 58 + carry
      bytes[i] = total & 0xff
      carry = total >> 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  // Провідні '1' — це нульові байти, і їх не видно в арифметиці вище.
  let leadingZeros = 0
  for (const char of input) {
    if (char !== '1') break
    leadingZeros += 1
  }

  return Uint8Array.from([...new Array<number>(leadingZeros).fill(0), ...bytes.reverse()])
}
