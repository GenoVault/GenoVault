/**
 * Звіт прогону: розшифрування ключем покупця й розпакування (`T030`).
 *
 * # Чому розкладка береться в компілятора, а не в нас
 *
 * `Pack<Report>` пакує 140 чисел у 24 польові елементи, і як саме — вирішує
 * компілятор Arcis, а не ми. Написати розпакування «за здоровим глуздом»
 * означало б показати покупцю числа, походження яких ніхто не перевіряв, — і
 * саме тому на екрані прогону їх досі немає (`T029`).
 *
 * Тому пакувальник читається з `build/circuits.ts` — файлу, який породжує
 * `arcium build` разом із самим контуром. Це не наш код і не наше твердження:
 * якщо компілятор змінить пакування, розпакування зміниться разом із ним, а не
 * розійдеться мовчки.
 *
 * Файл підвантажується **динамічно**, за шляхом: `build/` не лежить у git
 * (артефакти відновлюються `scripts/wsl-build-circuits.sh`), і статичний імпорт
 * зробив би звіряча таким, що не збирається на чистому клоні.
 */

import { RescueCipher, x25519 } from '@arcium-hq/client'

export class ReportError extends Error {
  override readonly name = 'ReportError'
}

/** Те, що бачить покупець. Дзеркало `Report` у рецепті. */
export interface Report {
  included: bigint
  /** 1 — когорту придушено як меншу за `MIN_COHORT`, і решта полів нулі. */
  suppressed: bigint
  male: bigint
  affected: bigint
  ageAtLeast: bigint[]
  alleleSum: bigint[]
  alleleSquareSum: bigint[]
}

interface Unpacker {
  unpack(packed: bigint[]): Record<string, unknown>
}

/**
 * Дістає пакувальник `Report` із виводу компілятора.
 *
 * Перевірки тут не формальність: файл приходить із файлової системи за шляхом
 * з командного рядка, і «модуль без потрібного експорту» має бути названою
 * відмовою, а не `undefined is not a function` посеред розбору звіту.
 */
export async function loadReportUnpacker(circuitsModulePath: string): Promise<Unpacker> {
  const module: unknown = await import(circuitsModulePath)
  if (typeof module !== 'object' || module === null || !('circuits' in module)) {
    throw new ReportError(`${circuitsModulePath} не експортує circuits — це не вивід arcium build`)
  }

  const circuits = (module as { circuits: unknown }).circuits
  if (typeof circuits !== 'object' || circuits === null || !('Report' in circuits)) {
    throw new ReportError(`у ${circuitsModulePath} немає пакувальника Report`)
  }

  const packer = (circuits as { Report: unknown }).Report
  if (typeof packer !== 'object' || packer === null || !('unpack' in packer)) {
    throw new ReportError('пакувальник Report не вміє unpack')
  }

  return packer as Unpacker
}

export interface DecryptOptions {
  /** Приватна половина ключа покупця — виведена з підпису гаманця (`T029`). */
  buyerSecretKey: Uint8Array
  /** Ключ, яким MXE зашифрував звіт; лежить у `RunResult`. */
  encryptionKey: Uint8Array
  nonce: bigint
  /** 24 польові елементи з `RunResult`. */
  ciphertexts: readonly Uint8Array[]
  unpacker: Unpacker
}

/**
 * Розшифровує звіт і розкладає його в числа.
 *
 * Крива й шифр беруться з клієнта Arcium — тобто в тієї ж сторони, що й
 * шифрувала. Це не порушує незалежності звіряча: незалежність тут про **наш**
 * код, а не про криптографію взагалі; звіряч, який писав би власний Rescue,
 * доводив би властивості власного Rescue.
 */
export function decryptReport(options: DecryptOptions): Report {
  if (options.ciphertexts.length !== 24) {
    throw new ReportError(`звіт має 24 шифротексти, отримано ${options.ciphertexts.length}`)
  }

  const cipher = new RescueCipher(
    x25519.getSharedSecret(options.buyerSecretKey, options.encryptionKey),
  )
  const nonce = new Uint8Array(16)
  let value = options.nonce
  for (let index = 0; index < 16; index += 1) {
    nonce[index] = Number(value & 0xffn)
    value >>= 8n
  }

  const packed = cipher.decrypt(
    options.ciphertexts.map((ciphertext) => Array.from(ciphertext)),
    nonce,
  )
  return toReport(options.unpacker.unpack(packed))
}

/**
 * Вивід пакувальника — це `Record<string, unknown>` із іменами полів рецепта.
 *
 * Перекладається сюди явно, з перевіркою кожного поля. Мовчазний `as Report`
 * зробив би відсутнє поле нулем у звіті, за який заплачено.
 */
function toReport(raw: Record<string, unknown>): Report {
  return {
    included: scalar(raw, 'included'),
    suppressed: scalar(raw, 'suppressed'),
    male: scalar(raw, 'male'),
    affected: scalar(raw, 'affected'),
    ageAtLeast: vector(raw, 'age_at_least', 8),
    alleleSum: vector(raw, 'allele_sum', 64),
    alleleSquareSum: vector(raw, 'allele_square_sum', 64),
  }
}

function scalar(raw: Record<string, unknown>, name: string): bigint {
  const value = raw[name]
  if (typeof value !== 'bigint') {
    throw new ReportError(`поле ${name} звіту не число: ${typeof value}`)
  }
  return value
}

function vector(raw: Record<string, unknown>, name: string, length: number): bigint[] {
  const value = raw[name]
  if (!Array.isArray(value) || value.length !== length) {
    throw new ReportError(`поле ${name} звіту має бути масивом на ${length} елементів`)
  }
  return value.map((item, index) => {
    if (typeof item !== 'bigint') {
      throw new ReportError(`${name}[${index}] не число: ${typeof item}`)
    }
    return item
  })
}
