/**
 * Ключ x25519 у тій формі, в якій його читає черга обчислень (`T030`).
 *
 * # Чому це не просто «покласти 32 байти ключа»
 *
 * У зрізі акаунта слово, оголошене в контурі як `arcis_x25519_pubkey`, вузол
 * розбирає як **стиснену точку Едвардса**. Публічний ключ x25519 — це
 * u-координата Монтгомері, і як стиснений Едвардс вона валідна приблизно в
 * половині випадків: виміряно на 200 ключах — 101 розібрався, 99 ні.
 *
 * Саме так це й виглядало на живому кластері: один датасет пулу згортався
 * нормально, наступний валив прогін у `failed`, а вузол писав
 * `DeserializationFailed("Invalid point encoding")`. Ланцюг при цьому не казав
 * нічого — обчислення просто не поверталось.
 *
 * Тому в буфер лягає біраціональний образ: `y = (u − 1) / (u + 1)`, старший біт
 * (знак `x`) нульовий. Спільний секрет від цього не міняється — Діффі-Гелман на
 * x25519 користується лише u-координатою, а знак `x` у ній не бере участі.
 *
 * Інлайн-аргументи цього перетворення не потребують: там тип поля відомий
 * черзі, і `ArgBuilder::x25519_pubkey` бере сирі байти. Розходження між двома
 * шляхами — не наше рішення, а властивість тулчейну, і саме тому воно тут
 * записане, а не вгадується вдруге.
 */

import { ed25519, RistrettoPoint } from '@noble/curves/ed25519'

/** Просте число поля Curve25519. */
const P = 2n ** 255n - 19n

function fromLittleEndian(bytes: Uint8Array): bigint {
  let value = 0n
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0)
  }
  return value
}

function toLittleEndian(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let rest = value
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return bytes
}

/**
 * Обернення в полі за малою теоремою Ферма.
 *
 * Розширений Евклід був би швидшим, але тут це виклик **раз на датасет** —
 * ключ у конверта один, — і 254 піднесення до квадрата коштують мікросекунди
 * проти хвилин шифрування.
 */
function invert(value: bigint): bigint {
  let result = 1n
  let base = ((value % P) + P) % P
  let exponent = P - 2n
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % P
    base = (base * base) % P
    exponent >>= 1n
  }
  return result
}

/**
 * u-координата Монтгомері → стиснена точка Едвардса.
 *
 * Знак `x` беремо нульовим: у публічному ключі x25519 його немає взагалі, а на
 * спільний секрет він не впливає.
 */
export function montgomeryToEdwards(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 32) {
    throw new RangeError(`ключ x25519 має бути 32 байти, отримано ${publicKey.length}`)
  }

  const u = fromLittleEndian(publicKey) % P
  if (u === P - 1n) {
    // u = −1 дає нуль у знаменнику: точка порядку 2, якої в жодному чесному
    // ключі не буває. Мовчазний нуль тут став би валідною, але чужою точкою.
    throw new RangeError('ключ x25519 вироджений: u = −1 не має образу в Едвардсі')
  }

  const y = (((u - 1n + P) % P) * invert((u + 1n) % P)) % P
  const compressed = toLittleEndian(y, 32)

  // Точка кривої в Arcium — Ristretto (`Point25519Ristretto = RistrettoPoint`),
  // тож слово зрізу несе ристретто-кодування, а не стиснений Едвардс. Ключ
  // x25519 лежить у підгрупі простого порядку — скаляр при обчисленні
  // публічного ключа затиснутий і кратний восьми, — тож кручення тривіальне і
  // кодування однозначне.
  const point = ed25519.Point.fromBytes(compressed)
  return new (
    RistrettoPoint as unknown as new (
      inner: unknown,
    ) => {
      toBytes(): Uint8Array
    }
  )(point).toBytes()
}
