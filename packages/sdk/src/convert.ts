import { BN } from '@anchor-lang/core'
import { type ContentHash, contentHashSchema } from '@genovault/shared'

/**
 * Перетворення на межі з Anchor.
 *
 * Anchor рахує u64 у `BN`, а весь наш код — у `bigint` (`packages/shared`,
 * `tokenAmountSchema`). Місце, де ці два подання зустрічаються, має бути
 * одне: `BN`, що просочився в `apps/api`, рано чи пізно пройде через
 * `Number()` і мовчки округлить нарахування донору.
 */

export const U64_MAX = 0xffff_ffff_ffff_ffffn

/** `bigint` → `BN` без проміжного `number`: 2^53 тут не межа, а помилка. */
export function toBn(value: bigint | number): BN {
  const big = typeof value === 'bigint' ? value : BigInt(value)
  if (big < 0n || big > U64_MAX) throw new RangeError(`значення не вміщається в u64: ${big}`)
  return new BN(big.toString(10), 10)
}

/** `BN` → `bigint`. Через десятковий рядок, а не `toNumber()`. */
export function fromBn(value: BN): bigint {
  return BigInt(value.toString(10))
}

/**
 * `Option<i64>` з ланцюга → `bigint | null`.
 *
 * Окрема функція, бо згенерований тип IDL подає `Option<i64>` як `any`:
 * `fromBn` прийняв би там будь-що й мовчки віддав би `NaN`-подібне сміття.
 * Тип із генератора — це така сама межа, як тіло запиту, і `any` на ній
 * перевіряється, а не приймається на віру.
 */
export function fromBnOption(value: unknown): bigint | null {
  if (value === null || value === undefined) return null
  if (!BN.isBN(value)) throw new TypeError(`очікувався BN або null, отримано ${typeof value}`)
  return fromBn(value)
}

/** Відбиток із `packages/shared` (64 hex) → масив байтів, як його чекає IDL. */
export function hashToBytes(hash: string): number[] {
  const hex = contentHashSchema.parse(hash)
  return Array.from({ length: 32 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

/** Масив байтів із ланцюга → відбиток у тій самій формі, що й у `shared`. */
export function bytesToHash(bytes: number[] | Uint8Array): ContentHash {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return contentHashSchema.parse(hex)
}
