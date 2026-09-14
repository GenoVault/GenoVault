/**
 * Читач Borsh — рівно стільки, скільки потрібно, щоб прочитати два акаунти.
 *
 * # Чому не `@coral-xyz/anchor` і не `packages/sdk`
 *
 * Це модуль звіряча, а звіряч, який читає ланцюг нашим кодом, доводить
 * властивості нашого коду (`FR-025`). Розкладка акаунтів — публічна: вона
 * оголошена в IDL, який лежить у публічному репозиторії, і третя сторона
 * відтворює її сама. Саме це тут і зроблено — по байту, без жодного нашого
 * пакета в графі залежностей.
 *
 * Довжина читання перевіряється на кожному кроці. Borsh не має ні маркерів
 * кінця, ні контрольних сум: читач, який зайшов за межу буфера, мовчки віддав
 * би нулі, і акаунт із нульовим `folded_hash` виглядав би як прогін, у якому
 * нічого не згортали.
 */

/** Байти скінчились або не склались у те, що обіцяв IDL. */
export class BorshError extends Error {
  override readonly name = 'BorshError'
}

export class Reader {
  private at = 0
  // Поле оголошене явно, а не параметром конструктора: `node
  // --experimental-strip-types` знімає типи, але коду не породжує, і
  // параметр-властивість валить процес на завантаженні модуля. Гейт це ловить
  // (`scripts/check-strip-types.mjs`), tsc і vitest — ні.
  private readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get offset(): number {
    return this.at
  }

  get remaining(): number {
    return this.bytes.length - this.at
  }

  private take(count: number): Uint8Array {
    if (this.at + count > this.bytes.length) {
      throw new BorshError(
        `потрібно ${count} байтів на зсуві ${this.at}, а в акаунті лишилось ${this.remaining}`,
      )
    }
    const slice = this.bytes.subarray(this.at, this.at + count)
    this.at += count
    return slice
  }

  /** Копія, а не зріз: повернути вікно у чужий буфер означає віддати його змінюваним. */
  bytesOf(count: number): Uint8Array {
    return Uint8Array.from(this.take(count))
  }

  u8(): number {
    const [value] = this.take(1)
    if (value === undefined) throw new BorshError('порожній байт')
    return value
  }

  bool(): boolean {
    const value = this.u8()
    if (value > 1) throw new BorshError(`bool має бути 0 або 1, прочитано ${value}`)
    return value === 1
  }

  u16(): number {
    return this.view(2).getUint16(0, true)
  }

  u32(): number {
    return this.view(4).getUint32(0, true)
  }

  u64(): bigint {
    return this.view(8).getBigUint64(0, true)
  }

  i64(): bigint {
    return this.view(8).getBigInt64(0, true)
  }

  /** `u128` little-endian. Нонс шифру ширший за `u64`, і `BigInt` тут не зручність. */
  u128(): bigint {
    const bytes = this.take(16)
    let value = 0n
    for (let index = 15; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(bytes[index] ?? 0)
    }
    return value
  }

  /** 32 байти адреси. Base58 тут не робиться — звіряч порівнює байти. */
  pubkey(): Uint8Array {
    return this.bytesOf(32)
  }

  option<T>(read: (reader: Reader) => T): T | null {
    const tag = this.u8()
    if (tag === 0) return null
    if (tag !== 1) throw new BorshError(`тег Option має бути 0 або 1, прочитано ${tag}`)
    return read(this)
  }

  vec<T>(read: (reader: Reader) => T): T[] {
    const length = this.u32()
    // Довжина йде з акаунта, тобто з мережі. Мільйон елементів по 46 байтів —
    // це спроба змусити звіряча виділити 46 МБ на акаунті, якого не буває.
    if (length > this.remaining) {
      throw new BorshError(
        `вектор оголосив ${length} елементів, а байтів лишилось ${this.remaining}`,
      )
    }
    return Array.from({ length }, () => read(this))
  }

  /** Варіант перелічення без полів — саме такі всі наші. */
  enumIndex(variants: number): number {
    const index = this.u8()
    if (index >= variants) {
      throw new BorshError(`варіант ${index} поза переліченням із ${variants}`)
    }
    return index
  }

  /** Нічого не лишилось? Хвіст, який ніхто не прочитав, — це розбіжність із IDL. */
  assertConsumed(): void {
    if (this.remaining !== 0) {
      throw new BorshError(`після розбору лишилось ${this.remaining} непрочитаних байтів`)
    }
  }

  private view(count: number): DataView {
    const slice = this.take(count)
    return new DataView(slice.buffer, slice.byteOffset, slice.byteLength)
  }
}

/**
 * Знімає дискримінатор акаунта.
 *
 * Вісім байтів попереду — це те, чим Anchor відрізняє типи акаунтів. Звіряч
 * перевіряє їх сам: без цього `Run` за адресою `RunResult` розібрався б у щось
 * схоже на прогін, і жодне поле не виглядало б підозріло.
 */
export function stripDiscriminator(data: Uint8Array, expected: readonly number[]): Reader {
  if (data.length < 8) throw new BorshError(`акаунт коротший за дискримінатор: ${data.length}`)
  for (const [index, byte] of expected.entries()) {
    if (data[index] !== byte) {
      throw new BorshError(`не той тип акаунта: очікувався дискримінатор [${expected.join(', ')}]`)
    }
  }
  return new Reader(data.subarray(8))
}
