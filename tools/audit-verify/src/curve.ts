/**
 * Ключ x25519 у формі, в якій його читає черга обчислень (`T030`, `FR-025`).
 *
 * Слово `arcis_x25519_pubkey` у зрізі акаунта — це **точка в кодуванні
 * Ristretto**, а не u-координата Монтгомері з конверта. Тип точки в Arcium так
 * і оголошений (`Point25519Ristretto = RistrettoPoint`), і різниця не
 * косметична: сирий ключ x25519 розбирається як Ristretto приблизно в одному
 * випадку з восьми, тож помилка тут проявляється як прогін, що падає на одному
 * датасеті пулу й проходить на іншому.
 *
 * Шлях цілком публічний — біраціональна відповідність між curve25519 і
 * ed25519, далі стандартне кодування Ristretto, — і звіряч проходить його сам.
 * Без цього ланцюжок відбитків не перерахувати: слово ключа входить у кожен
 * батч, а отже й у кожен відбиток.
 */

import { ed25519, RistrettoPoint } from '@noble/curves/ed25519'

const FIELD_MODULUS = 2n ** 255n - 19n

function littleEndianToBigInt(bytes: Uint8Array): bigint {
  let value = 0n
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0)
  }
  return value
}

function bigIntToLittleEndian(value: bigint): Uint8Array {
  const bytes = new Uint8Array(32)
  let rest = value
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return bytes
}

/** `a^(p−2) mod p` — обернене за малою теоремою Ферма. */
function fieldInverse(value: bigint): bigint {
  let result = 1n
  let base = ((value % FIELD_MODULUS) + FIELD_MODULUS) % FIELD_MODULUS
  let exponent = FIELD_MODULUS - 2n
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % FIELD_MODULUS
    base = (base * base) % FIELD_MODULUS
    exponent >>= 1n
  }
  return result
}

/** u-координата Монтгомері → `y = (u − 1)/(u + 1)` → точка → кодування Ristretto. */
export function sharedKeyWord(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) {
    throw new Error(`ключ x25519 має бути 32 байти, отримано ${publicKey.length}`)
  }
  const u = littleEndianToBigInt(publicKey) % FIELD_MODULUS
  if (u === FIELD_MODULUS - 1n) throw new Error('ключ x25519 вироджений: u = −1')

  const numerator = (u - 1n + FIELD_MODULUS) % FIELD_MODULUS
  const denominator = fieldInverse((u + 1n) % FIELD_MODULUS)
  const y = (numerator * denominator) % FIELD_MODULUS

  const point = ed25519.Point.fromBytes(bigIntToLittleEndian(y))
  return new (
    RistrettoPoint as unknown as new (
      inner: unknown,
    ) => {
      toBytes(): Uint8Array
    }
  )(point).toBytes()
}

/**
 * Зворотний шлях: точка з ланцюга → u-координата для Діффі-Гелмана.
 *
 * `RunResult.encryption_key` кладе туди MPC, і кладе в тій самій точковій
 * формі, в якій контур із ключами й працює. Щоб порахувати спільний секрет
 * стандартним x25519, потрібна u-координата: `u = (1 + y) / (1 − y)`.
 */
export function pointWordToX25519(word: Uint8Array): Uint8Array {
  if (word.length !== 32) throw new Error(`слово точки має бути 32 байти, отримано ${word.length}`)

  const point = RistrettoPoint.fromBytes(word)
  const { y } = point.toAffine()
  if (y === 1n) throw new Error('точка вироджена: y = 1 не має u-координати')

  const numerator = (1n + y) % FIELD_MODULUS
  const denominator = fieldInverse((1n - y + FIELD_MODULUS) % FIELD_MODULUS)
  return bigIntToLittleEndian((numerator * denominator) % FIELD_MODULUS)
}
