/**
 * Звіт прогону: розшифрування ключем покупця й розпакування (`T030`).
 *
 * # Чому розкладка береться в компілятора, а не в нас
 *
 * `Pack<Report>` пакує 76 чисел у 13 шифротекстів, і як саме — вирішує
 * компілятор Arcis, а не ми. Написати розпакування «за здоровим глуздом»
 * означало б показати покупцю числа, походження яких ніхто не перевіряв, — і
 * саме тому на екрані прогону їх досі немає (`T029`).
 *
 * Тому розкладка береться з `build/circuits.ts` — файлу, який породжує
 * `arcium build` разом із самим контуром, — а сам алгоритм пакування з
 * `createPacker` бібліотеки Arcium. Жодне з двох не є нашим твердженням: якщо
 * компілятор змінить порядок полів або їхню ширину, розпакування зміниться
 * разом із ним.
 *
 * Файл **читається як текст**, а не імпортується. Дві причини, і обидві
 * практичні: `build/` не лежить у git (артефакти відновлює
 * `scripts/wsl-build-circuits.sh`), тож статичний імпорт зробив би звіряча
 * таким, що не збирається на чистому клоні; а динамічний `import()` не
 * резолвиться, бо `build/` лежить у корені репозиторію, де немає
 * `node_modules` з залежностями цього файлу.
 */

import { readFile } from 'node:fs/promises'
import { RescueCipher, x25519 } from '@arcium-hq/client'
import { REPORT_CIPHERTEXTS } from './chain.ts'

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
  /**
   * Σ копій мінорного алеля по когорті на кожен маркер.
   *
   * Розподіл генотипів {0, 1, 2} з нього не відновлюється: для цього потрібна
   * друга достатня статистика `Σg²`, і її прибрано з рецепта (`T030`) — вивід
   * MPC мусить вміщатись в одну транзакцію. Покупець отримує середнє, і на
   * екрані це має бути сказано, а не подано як розподіл.
   */
  alleleSum: bigint[]
}

/** Розкладка звіту, прочитана у виводі компілятора: імена полів і ширина. */
export interface ReportLayout {
  names: string[]
  /** Ширина кожного поля в бітах. Однакова для всіх — інакше розбір відмовляє. */
  width: number
}

/** Одне поле у виводі компілятора: ім'я й ширина цілого. */
interface CompilerField {
  name: string
  signed: boolean
  width: number
}

/**
 * Дістає розкладку `Report` із виводу компілятора.
 *
 * Розбір текстовий, і кожен рядок мусить збігтися повністю: поле, форму якого
 * читач не впізнав, — це нова форма звіту, і мовчки пропустити його означало б
 * зсунути всі наступні числа на одне. Тому невпізнане валить розбір.
 */
export async function loadReportLayout(circuitsModulePath: string): Promise<ReportLayout> {
  const text = await readFile(circuitsModulePath, 'utf8')

  const block = /Report:\s*createPacker<[^>]*>\(\s*\[([\s\S]*?)\]\s*as const,\s*'Report'\s*\)/.exec(
    text,
  )
  if (block === null) {
    throw new ReportError(
      `у ${circuitsModulePath} немає розкладки Report — це не вивід arcium build`,
    )
  }
  const body = block[1] ?? ''

  const entry =
    /\{\s*name:\s*'([^']+)',\s*type:\s*\{\s*Integer:\s*\{\s*signed:\s*(true|false),\s*width:\s*(\d+)\s*\}\s*\}\s*\}/g
  const fields: CompilerField[] = [...body.matchAll(entry)].map((match) => ({
    name: match[1] ?? '',
    signed: match[2] === 'true',
    width: Number(match[3]),
  }))

  // Скільки полів оголошено взагалі — рахуємо окремо від того, скільки з них
  // розібрано: поле іншої форми має бути названою відмовою, а не тихим зсувом.
  const declared = (body.match(/name:/g) ?? []).length
  if (fields.length !== declared) {
    throw new ReportError(
      `у розкладці Report ${declared} полів, а знайомої форми лише ${fields.length}`,
    )
  }
  if (fields.length === 0) throw new ReportError('розкладка Report порожня')

  const width = fields[0]?.width ?? 0
  if (fields.some((field) => field.width !== width || field.signed)) {
    throw new ReportError('розкладка Report змішує ширини або знакові поля — читач цього не вміє')
  }

  return { names: fields.map((field) => field.name), width }
}

/**
 * Розкладає польові елементи у числа звіту.
 *
 * # Чому не `createPacker` з клієнта Arcium
 *
 * Бо він цієї форми не відтворює. Виміряно на `T030`: `createPacker` з
 * `@arcium-hq/client` 0.14.1 на 76 полях пакує **два** елементи замість
 * тринадцяти — перший збігається з виводом контуру байт у байт, а весь хвіст
 * зліплюється в одне число завширшки в тисячі біт. Розпакування дзеркально
 * віддає нулі з тринадцятого поля й далі, і робить це мовчки.
 *
 * Тому розкладка тут рахується з чисел, яких ми не вигадували: ширина поля
 * оголошена у виводі компілятора, а скільки полів лягає в один елемент —
 * виводиться з того, скільки елементів контур насправді повернув. Виведення
 * **строге**: якщо під кількість елементів підходить більш ніж одне число смуг,
 * розбір відмовляє замість того, щоб вибрати навмання. Для звіту з 76 полів у
 * 13 елементах розв'язок один — шість.
 */
export function unpackReport(packed: readonly bigint[], layout: ReportLayout): bigint[] {
  const lanes = lanesPerElement(layout.names.length, packed.length, layout.width)

  const mask = (1n << BigInt(layout.width)) - 1n
  const values: bigint[] = []
  for (const element of packed) {
    for (let lane = 0; lane < lanes && values.length < layout.names.length; lane += 1) {
      values.push((element >> BigInt(lane * layout.width)) & mask)
    }
  }

  if (values.length !== layout.names.length) {
    throw new ReportError(
      `${packed.length} елементів дають ${values.length} чисел, а полів ${layout.names.length}`,
    )
  }
  return values
}

/**
 * Скільки полів лежить в одному польовому елементі.
 *
 * Перебираємо всі значення, які вміщаються в елемент, і лишаємо ті, за яких
 * задана кількість полів дає рівно ту кількість елементів, яку повернув контур.
 * Один розв'язок — беремо; кілька або жодного — відмовляємо. Здогадка тут
 * коштувала б звіту, в якому числа стоять не на своїх місцях і виглядають
 * правдоподібно.
 */
function lanesPerElement(fields: number, elements: number, width: number): number {
  const limit = Math.floor(255 / width)
  const candidates: number[] = []
  for (let lanes = 1; lanes <= limit; lanes += 1) {
    if (Math.ceil(fields / lanes) === elements) candidates.push(lanes)
  }

  const only = candidates.at(0)
  if (candidates.length !== 1 || only === undefined) {
    throw new ReportError(
      `${fields} полів у ${elements} елементах: ширина смуги не визначається однозначно ` +
        `(підходять ${candidates.length === 0 ? 'жодне' : candidates.join(', ')})`,
    )
  }
  return only
}

export interface DecryptOptions {
  /** Приватна половина ключа покупця — виведена з підпису гаманця (`T029`). */
  buyerSecretKey: Uint8Array
  /**
   * Публічний ключ x25519 MXE-кластера, прочитаний з мережі.
   *
   * Саме він, а не `RunResult.encryption_key`: `Enc<Shared, _>` шифрує на
   * секрет між кластером і названим ключем читача, тож читач рахує той самий
   * секрет зі свого приватного ключа й ключа кластера. У полі
   * `encryption_key` лежить **ключ самого покупця** — воно каже, кому
   * адресований звіт, а не чим його відкривати.
   */
  mxePublicKey: Uint8Array
  nonce: bigint
  /** Шифротексти з `RunResult`. */
  ciphertexts: readonly Uint8Array[]
  layout: ReportLayout
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
  if (options.ciphertexts.length !== REPORT_CIPHERTEXTS) {
    throw new ReportError(
      `звіт має ${REPORT_CIPHERTEXTS} шифротекстів, отримано ${options.ciphertexts.length}`,
    )
  }

  const cipher = new RescueCipher(
    x25519.getSharedSecret(options.buyerSecretKey, options.mxePublicKey),
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

  const values = unpackReport(packed, options.layout)
  const named: Record<string, unknown> = {}
  for (const [index, name] of options.layout.names.entries()) {
    // Імена масивів приходять як `allele_sum[7]` — саме так їх пише компілятор.
    const array = /^(.+)\[(\d+)\]$/.exec(name)
    if (array === null) {
      named[name] = values[index]
      continue
    }
    const base = array[1] ?? ''
    const slot = Number(array[2])
    if (named[base] === undefined) named[base] = []
    const list = named[base] as bigint[]
    list[slot] = values[index] ?? 0n
  }
  return toReport(named)
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
