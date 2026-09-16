/**
 * Звіт «розшифрування не було» (`T031`, `SC-001`).
 *
 * # Що саме доводиться
 *
 * `SC-001` каже: жоден сирий запис не з'являється у відкритому вигляді за весь
 * життєвий цикл прогону, і перевірка виконується **без доступу до вихідного
 * коду**. Тут це розкладено на два незалежні твердження, бо жодне з них поодинці
 * не закриває критерій.
 *
 * **Перше — канарка.** Звіряч виступає власником датасету: свої записи він знає
 * у відкритому вигляді, бо сам їх і здав. Кожен запис розгортається в набір
 * голок — сирі байти, слова по 32 байти (та сама форма, в якій поле лягає в
 * шифр), `u32`/`u64` little-endian, десяткові рядки, hex, base64 — і кожна
 * голка шукається в **кожному** байті, який прогін лишив у ланцюгу й у сховищі.
 * Влучання означає, що десь відкритий запис таки з'явився.
 *
 * Канарковий датасет навмисно високоентропійний: рядок генотипів у ньому
 * випадковий, а не породжений формулою. Без цього голка з трьох різних значень
 * ловила б шум: байт `1` є в будь-якому шифротексті, а `(base + 31·marker) % 3`
 * повторюється з періодом три й дає ту саму послідовність у чужому датасеті.
 * Вікно з 24 генотипів має 3²⁴ ≈ 2,8·10¹¹ станів, тож випадковий збіг на
 * кількох мегабайтах — це 10⁻⁵ подій.
 *
 * **Друге — структурна тотожність.** Канарка ловить те, що вже спливло, але
 * мовчить про поле, чиї три можливі значення не можна відрізнити від шуму.
 * Тому окремо доводиться, що **місця** для відкритого запису в ланцюгу немає:
 * кожне 32-байтове слово, яке диспетчер записав у буфер батча, мусить
 * знайтися серед публічних слів конверта — шифротекст поля, нонс кадру або
 * ключ, виведений із ефемерного ключа власника. Слово, якого в конверті немає,
 * — це байт, що з'явився дорогою, і звіряч називає його транзакцією й зсувом.
 *
 * **Третє — семантика.** Агрегат по когорті з одного запису **і є** той запис.
 * Тому звіряч перевіряє й пороги: звіт із когортою меншою за `MIN_COHORT` мусить
 * бути придушений і складатись із нулів, а внесок датасету не має права
 * опинитись у діапазоні 1…`MIN_CONTRIBUTION`−1 — саме таке число сказало б, що
 * конкретні записи конкретного власника потрапили в когорту.
 *
 * # Межа твердження
 *
 * Звіряч дивиться на **ланцюг і сховище** — рівно те, до чого дотягнеться будь-яка
 * третя сторона з RPC й посиланням на шифротекст (продуктове рішення 2026-09-14).
 * Він **не** дивиться на HTTP-відповіді API (це `T022`, і воно доводиться
 * зсередини), на логи ARX-вузлів і на вкладку браузера. Він також нічого не
 * каже про те, що відбувається **всередині** MPC: там дані розшифровуються за
 * побудовою, і твердження там — це припущення про поріг Arcium, а не наш вимір.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Connection, VersionedTransactionResponse } from '@solana/web3.js'
import { PublicKey } from '@solana/web3.js'
import type { Run, RunResult } from './chain.ts'
import { decodeRun, decodeRunResult, fetchAccount } from './chain.ts'
import { sharedKeyWord } from './curve.ts'
import { frameAt, LIMB_BYTES, NONCE_BYTES, readHeader } from './envelope.ts'
import { BATCH_PAYLOAD_BYTES, hex, WORD_BYTES } from './fold-chain.ts'
import type { Report, ReportLayout } from './report.ts'
import { decryptReport } from './report.ts'

export class NoPlaintextError extends Error {
  override readonly name = 'NoPlaintextError'
}

/**
 * Найменша когорта, про яку рецепт погоджується говорити.
 *
 * Число публічне: воно оголошене в каталозі рецептів разом із самим рецептом,
 * і покупець бачить його до замовлення. Звіряч бере його звідти, а не з нашого
 * коду, — інакше він перевіряв би нашу константу проти неї самої.
 */
export const MIN_COHORT = 10

/**
 * Найменший внесок датасету, який оголошується числом.
 *
 * Те саме значення й навмисно окрема константа: `MIN_COHORT` захищає звіт
 * покупця, `MIN_CONTRIBUTION` — рядок розрахунку, де внесок «3 записи» сказав
 * би про власника більше, ніж уся решта звіту.
 */
export const MIN_CONTRIBUTION = MIN_COHORT

/** Дискримінатор `write_batch` з IDL, який лежить у публічному репозиторії. */
export const WRITE_BATCH_DISCRIMINATOR = [241, 101, 221, 8, 160, 229, 116, 203] as const

/** Скільки генотипів бере вікно голки й через скільки вікна йдуть. */
export const GENOTYPE_WINDOW = 24
export const GENOTYPE_STRIDE = 4

const ACCUMULATOR_SEED = new TextEncoder().encode('acc')
const BATCH_BUFFER_SEED = new TextEncoder().encode('batch')
const RESULT_SEED = new TextEncoder().encode('result')

/** Скільки транзакцій просимо в RPC однією пачкою. */
const TRANSACTION_BATCH = 100

/** Запис у тому вигляді, в якому його знає власник. */
export interface PlainRecord {
  sex: number
  age: number
  affected: number
  genotypes: readonly number[]
}

/** Одна форма запису, яку шукаємо в байтах. */
export interface Needle {
  label: string
  bytes: Uint8Array
}

export type SurfaceKind = 'акаунт' | 'транзакція' | 'логи' | 'сховище'

/** Байти, які прогін лишив по собі, з іменем, за яким їх можна знайти знову. */
export interface Surface {
  id: string
  kind: SurfaceKind
  bytes: Uint8Array
}

/** Влучання канарки: де саме знайшовся відкритий запис. */
export interface Hit {
  surface: string
  kind: SurfaceKind
  needle: string
  offset: number
}

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function fieldsOf(record: PlainRecord): number[] {
  return [record.sex, record.age, record.affected, ...record.genotypes]
}

/** Поля, розкладені по 32-байтових словах — та форма, в якій вони йдуть у шифр. */
function limbs(fields: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(fields.length * WORD_BYTES)
  for (const [index, value] of fields.entries()) {
    // Молодший байт першим: поле — це ціле в little-endian, і саме нульовий
    // байт слова відрізняє значення 0, 1 і 2 одне від одного.
    bytes[index * WORD_BYTES] = value & 0xff
  }
  return bytes
}

/** Поля, розширені до `width` байтів кожне — так число лягає в масив `u32` чи `u64`. */
function widened(fields: readonly number[], width: number): Uint8Array {
  const bytes = new Uint8Array(fields.length * width)
  for (const [index, value] of fields.entries()) bytes[index * width] = value & 0xff
  return bytes
}

function isAllZero(bytes: Uint8Array): boolean {
  return bytes.every((byte) => byte === 0)
}

/**
 * Розгортає відомі власнику записи в набір голок.
 *
 * Форм навмисно багато: витік не зобов'язаний виглядати як наш формат. Запис
 * може спливти сирим байтом, розширеним до `u64`, надрукованим десятковим
 * рядком у логу або покладеним у base64 в чиємусь полі. Голка, коротша за
 * `GENOTYPE_WINDOW`, сюди не потрапляє взагалі: на трьох можливих значеннях
 * коротка послідовність збігається випадково, і звіт із таким влучанням
 * доводив би тільки те, що байти бувають.
 */
export function recordNeedles(records: readonly PlainRecord[]): Needle[] {
  const needles: Needle[] = []

  for (const [index, record] of records.entries()) {
    const fields = fieldsOf(record)
    const raw = Uint8Array.from(fields)
    const tag = (form: string): string => `запис ${index} · ${form}`

    const forms: Needle[] = [
      { label: tag('сирі байти'), bytes: raw },
      { label: tag('слова по 32 байти'), bytes: limbs(fields) },
      { label: tag('u32 LE'), bytes: widened(fields, 4) },
      { label: tag('u64 LE'), bytes: widened(fields, 8) },
      { label: tag('десяткові через кому'), bytes: ascii(fields.join(',')) },
      { label: tag('десяткові через пробіл'), bytes: ascii(fields.join(' ')) },
      { label: tag('hex'), bytes: ascii(hex(raw)) },
      { label: tag('base64'), bytes: ascii(Buffer.from(raw).toString('base64')) },
    ]

    const genotypes = Uint8Array.from(record.genotypes)
    const digits = ascii(record.genotypes.join(''))
    for (let at = 0; at + GENOTYPE_WINDOW <= genotypes.length; at += GENOTYPE_STRIDE) {
      const span = `[${at}, ${at + GENOTYPE_WINDOW})`
      forms.push({
        label: tag(`генотипи ${span} байтами`),
        bytes: genotypes.slice(at, at + GENOTYPE_WINDOW),
      })
      forms.push({
        label: tag(`генотипи ${span} цифрами`),
        bytes: digits.slice(at, at + GENOTYPE_WINDOW),
      })
    }

    for (const form of forms) {
      // Голка з самих нулів збігається з будь-яким невикористаним хвостом
      // акаунта. Такого запису в канарці не буває, але мовчазне влучання коштує
      // дорожче за перевірку.
      if (form.bytes.length >= GENOTYPE_WINDOW && !isAllZero(form.bytes)) needles.push(form)
    }
  }

  return needles
}

/** Голки, підготовані до пошуку: `Buffer.indexOf` шукає нативно, і це видно на мегабайтах. */
function compile(needles: readonly Needle[]): { label: string; bytes: Buffer }[] {
  return needles.map((needle) => ({ label: needle.label, bytes: Buffer.from(needle.bytes) }))
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * Шукає кожну голку в кожній поверхні.
 *
 * Перше влучання на поверхню й голку, а не всі: звіт має назвати місце, а не
 * порахувати, скільки разів воно повторюється. Нуль влучань — і є `SC-001`.
 */
export function sweep(surfaces: readonly Surface[], needles: readonly Needle[]): Hit[] {
  const compiled = compile(needles)
  const hits: Hit[] = []

  for (const surface of surfaces) {
    const haystack = asBuffer(surface.bytes)
    for (const needle of compiled) {
      const at = haystack.indexOf(needle.bytes)
      if (at >= 0) {
        hits.push({ surface: surface.id, kind: surface.kind, needle: needle.label, offset: at })
      }
    }
  }

  return hits
}

/**
 * Усі 32-байтові слова, які публічно видно в конверті.
 *
 * Це і є словник «звідки взявся байт»: шифротекст кожного поля, нонс кадру
 * (розширений до слова нулями — саме так його читає черга обчислень) і слово
 * ключа, виведене з ефемерного ключа власника. Диспетчер, який поклав би в
 * буфер щось інше, покладе слово, якого тут немає.
 */
export function envelopeWords(envelope: Uint8Array): string[] {
  const header = readHeader(envelope)
  const words: string[] = [hex(sharedKeyWord(header.ephemeralPublicKey))]

  for (let record = 0; record < header.recordCount; record += 1) {
    const frame = frameAt(header, record)

    const nonce = new Uint8Array(WORD_BYTES)
    nonce.set(envelope.subarray(frame, frame + NONCE_BYTES))
    words.push(hex(nonce))

    for (let field = 0; field < header.fieldsPerRecord; field += 1) {
      const at = frame + NONCE_BYTES + field * LIMB_BYTES
      words.push(hex(envelope.subarray(at, at + LIMB_BYTES)))
    }
  }

  return words
}

/** Вантаж однієї інструкції `write_batch`, розібраний за розкладкою з IDL. */
export interface WriteBatchPayload {
  offset: number
  /** Слова вантажу в шістнадцятковому вигляді. Порожні, якщо вантаж не ліг на слово. */
  words: string[]
  /** Скільки байтів не склалось у цілі слова — кожен із них лишається непоясненим. */
  unaligned: number
}

/**
 * Читає `write_batch(offset: u32, bytes: Vec<u8>)`.
 *
 * `null` — це «не та інструкція», і воно нормальне: у прогоні є ще десяток
 * інших. Розбіжність довжини — не `null`, а помилка: інструкція з тим самим
 * дискримінатором і чужою довжиною означає, що розкладка з IDL більше не та,
 * і мовчки пропустити її означало б не перевірити нічого.
 */
export function readWriteBatch(data: Uint8Array): WriteBatchPayload | null {
  if (data.length < 16) return null
  for (const [index, byte] of WRITE_BATCH_DISCRIMINATOR.entries()) {
    if (data[index] !== byte) return null
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const offset = view.getUint32(8, true)
  const length = view.getUint32(12, true)
  if (16 + length !== data.length) {
    throw new NoPlaintextError(
      `write_batch оголосив ${length} байтів вантажу, а в інструкції ${data.length - 16}`,
    )
  }

  if (offset % WORD_BYTES !== 0 || length % WORD_BYTES !== 0) {
    return { offset, words: [], unaligned: length }
  }

  const words: string[] = []
  for (let at = 16; at < data.length; at += WORD_BYTES) {
    words.push(hex(data.subarray(at, at + WORD_BYTES)))
  }
  return { offset, words, unaligned: 0 }
}

/** Слово, яке поїхало в ланцюг, але якого немає в публічному шифротексті. */
export interface UnexplainedWord {
  signature: string
  /** Зсув слова від початку вантажу батча. */
  offset: number
  word: string
}

/** Скільки байтів прогін лишив по собі й де саме. */
export interface SurfaceCensus {
  accounts: number
  accountBytes: number
  transactions: number
  transactionBytes: number
  envelopes: number
  envelopeBytes: number
}

export interface RunSweep {
  run: string
  label: string
  status: string
  /** Скільки записів увійшло в когорту за звітом ланцюга. */
  cohort: number
  suppressed: boolean
  folds: number
  census: SurfaceCensus
  /** Влучання канарки. Порожньо — і є «розшифрування не було». */
  hits: Hit[]
  batchWrites: number
  batchWords: number
  /** Скільки слів мало поїхати в буфер за кількістю згорток, яку назвав ланцюг. */
  expectedWords: number
  unexplained: UnexplainedWord[]
  /** Скільки відкритих чисел прогін опублікував узагалі. */
  clearNumbers: number
  problems: string[]
}

export interface NoPlaintextOptions {
  connection: Connection
  programId: PublicKey
  run: PublicKey
  /** Людська назва прогону — вона й стоїть у рядку звіту. */
  label: string
  storageDir: string
  /** Приватна половина ключа звіту: без неї звіт не розкладається в числа. */
  buyerSecretKey: Uint8Array
  mxePublicKey: Uint8Array
  layout: ReportLayout
  /** Відкриті записи, які власник канаркового датасету знає про себе. */
  canary: readonly PlainRecord[]
}

/** `["acc" | "batch" | "result", run]` — seeds публічні, адреси виводяться самі. */
function derive(seed: Uint8Array, run: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([seed, run.toBuffer()], programId)[0]
}

/**
 * Проходить прогін і не знаходить у ньому відкритого запису — або знаходить.
 *
 * Порядок кроків не випадковий: спочатку збираються **всі** байти, які прогін
 * лишив по собі, і аж потім вони проглядаються. Звіряч, який перевіряв би
 * поверхню одразу після читання, показав би на першому влучанні й не сказав би,
 * скільки всього подивився, — а `SC-001` це саме про повноту огляду.
 */
export async function auditNoPlaintext(options: NoPlaintextOptions): Promise<RunSweep> {
  const run = decodeRun(await fetchAccount(options.connection, options.run, 'прогін'))

  const resultAddress = derive(RESULT_SEED, options.run, options.programId)
  const accumulator = derive(ACCUMULATOR_SEED, options.run, options.programId)
  const buffer = derive(BATCH_BUFFER_SEED, options.run, options.programId)
  const datasets = run.datasets.map((entry) => new PublicKey(entry.dataset))

  const surfaces: Surface[] = []
  const census: SurfaceCensus = {
    accounts: 0,
    accountBytes: 0,
    transactions: 0,
    transactionBytes: 0,
    envelopes: 0,
    envelopeBytes: 0,
  }

  // ── акаунти прогону ─────────────────────────────────────────────────────
  const addresses = [options.run, resultAddress, accumulator, buffer, ...datasets]
  const infos = await options.connection.getMultipleAccountsInfo(addresses, 'confirmed')
  for (const [index, info] of infos.entries()) {
    // Буфер батча закривається наприкінці прогону, і його відсутність — не
    // прогалина: усе, що в ньому лежало, поїхало туди транзакціями, а вони
    // нікуди не діваються.
    if (info === null) continue
    const address = addresses[index]
    if (address === undefined) continue
    const bytes = Uint8Array.from(info.data)
    surfaces.push({ id: `акаунт ${address.toBase58()}`, kind: 'акаунт', bytes })
    census.accounts += 1
    census.accountBytes += bytes.length
  }

  // ── конверти пулу ───────────────────────────────────────────────────────
  const envelopes: Uint8Array[] = []
  for (const dataset of datasets) {
    const bytes = Uint8Array.from(
      await readFile(join(options.storageDir, `${dataset.toBase58()}.gvds`)),
    )
    envelopes.push(bytes)
    surfaces.push({ id: `конверт ${dataset.toBase58()}`, kind: 'сховище', bytes })
    census.envelopes += 1
    census.envelopeBytes += bytes.length
  }

  // ── транзакції прогону ──────────────────────────────────────────────────
  const transactions = await fetchTransactions(options.connection, addresses)
  for (const [signature, transaction] of transactions) {
    const message = Uint8Array.from(transaction.transaction.message.serialize())
    surfaces.push({ id: `транзакція ${signature}`, kind: 'транзакція', bytes: message })
    census.transactions += 1
    census.transactionBytes += message.length

    const logs = transaction.meta?.logMessages ?? []
    if (logs.length > 0) {
      surfaces.push({ id: `логи ${signature}`, kind: 'логи', bytes: ascii(logs.join('\n')) })
    }
  }

  const hits = sweep(surfaces, recordNeedles(options.canary))

  // ── структурна тотожність ───────────────────────────────────────────────
  const known = new Set(envelopes.flatMap((envelope) => envelopeWords(envelope)))
  const unexplained: UnexplainedWord[] = []
  let batchWrites = 0
  let batchWords = 0

  for (const [signature, transaction] of transactions) {
    for (const data of programInstructions(transaction, options.programId)) {
      const payload = readWriteBatch(data)
      if (payload === null) continue
      batchWrites += 1

      if (payload.unaligned > 0) {
        unexplained.push({
          signature,
          offset: payload.offset,
          word: `${payload.unaligned} байтів повз межу слова`,
        })
        continue
      }

      for (const [index, word] of payload.words.entries()) {
        batchWords += 1
        if (!known.has(word)) {
          unexplained.push({ signature, offset: payload.offset + index * WORD_BYTES, word })
        }
      }
    }
  }

  // ── семантика: пороги когорти й внеску ──────────────────────────────────
  const resultInfo = await options.connection.getAccountInfo(resultAddress, 'confirmed')
  const result = resultInfo === null ? null : decodeRunResult(Uint8Array.from(resultInfo.data))
  const report =
    result === null
      ? null
      : decryptReport({
          buyerSecretKey: options.buyerSecretKey,
          mxePublicKey: options.mxePublicKey,
          nonce: result.nonce,
          ciphertexts: result.ciphertexts,
          layout: options.layout,
        })

  // Скільки слів **мусило** поїхати в буфер: кількість згорток каже сам
  // ланцюг, а розмір батча публічний. Це число й перетворює «нічого не
  // знайшли» на твердження: без нього звіряч, якому RPC не віддав жодної
  // транзакції, друкував би найзеленіший можливий вердикт.
  const expectedWords = run.foldedBatches * (BATCH_PAYLOAD_BYTES / WORD_BYTES)
  const problems = collectProblems(run, result, report, hits, unexplained, {
    expectedWords,
    seenWords: batchWords,
    transactions: transactions.length,
  })

  return {
    run: options.run.toBase58(),
    label: options.label,
    status: run.status,
    cohort: run.recordsIncluded,
    suppressed: run.suppressed,
    folds: run.foldedBatches,
    census,
    hits,
    batchWrites,
    batchWords,
    expectedWords,
    unexplained,
    clearNumbers: (report === null ? 0 : options.layout.names.length) + run.datasets.length,
    problems,
  }
}

/**
 * Усі транзакції, що торкнулись адрес прогону.
 *
 * Пачками, а не по одній: прогін на дев'ять згорток — це під сотню транзакцій
 * запису, і десять прогонів по одному виклику RPC на транзакцію перетворили б
 * перевірку на найдовшу частину `T031`.
 */
async function fetchTransactions(
  connection: Connection,
  addresses: readonly PublicKey[],
): Promise<[string, VersionedTransactionResponse][]> {
  const signatures = new Set<string>()
  for (const address of addresses) {
    for (const entry of await connection.getSignaturesForAddress(
      address,
      { limit: 1000 },
      'confirmed',
    )) {
      signatures.add(entry.signature)
    }
  }

  const wanted = [...signatures]
  const found: [string, VersionedTransactionResponse][] = []
  for (let at = 0; at < wanted.length; at += TRANSACTION_BATCH) {
    const chunk = wanted.slice(at, at + TRANSACTION_BATCH)
    const responses = await connection.getTransactions(chunk, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    for (const [index, response] of responses.entries()) {
      const signature = chunk[index]
      // RPC має право не віддати транзакцію, якої вже немає в його історії.
      // Пропустити її мовчки не можна — але й помилкою це не є, тож вона
      // просто не потрапляє в огляд, а число оглянутих стоїть у звіті.
      if (response === null || signature === undefined) continue
      found.push([signature, response])
    }
  }

  return found
}

/** Дані інструкцій, адресованих нашій програмі, — верхнього рівня й вкладених. */
function programInstructions(
  transaction: VersionedTransactionResponse,
  programId: PublicKey,
): Uint8Array[] {
  const keys = transaction.transaction.message.getAccountKeys({
    accountKeysFromLookups: transaction.meta?.loadedAddresses ?? null,
  })

  const found: Uint8Array[] = []
  for (const instruction of transaction.transaction.message.compiledInstructions) {
    const program = keys.get(instruction.programIdIndex)
    if (program?.equals(programId) === true) found.push(Uint8Array.from(instruction.data))
  }
  return found
}

/**
 * Розбіжності, кожна окремим реченням.
 *
 * Список, а не перша знайдена: звіт `SC-001` мусить показати все, що з прогоном
 * не так, — інакше друга проблема виявиться аж після виправлення першої.
 */
export interface Coverage {
  /** Скільки слів мало поїхати в буфер за кількістю згорток із ланцюга. */
  expectedWords: number
  /** Скільки слів звіряч насправді побачив у транзакціях. */
  seenWords: number
  transactions: number
}

export function collectProblems(
  run: Run,
  result: RunResult | null,
  report: Report | null,
  hits: readonly Hit[],
  unexplained: readonly UnexplainedWord[],
  coverage: Coverage,
): string[] {
  const problems: string[] = []

  // Неповний огляд — це розбіжність, а не тиша.
  //
  // Звіряч, який не дістав транзакцій, не знайде в них і відкритого запису, і
  // «влучань 0» у такому звіті означає рівно нуль інформації. Тому кількість
  // слів звіряється з тією, яку зобов'язує ланцюг: `folded_batches` він каже
  // сам, а розмір батча публічний. Найчастіша причина розбіжності — обрізаний
  // ледер: локальний валідатор тримає останні кількасот слотів, і історія
  // згорток зникає раніше, ніж по неї приходять.
  if (coverage.seenWords < coverage.expectedWords) {
    problems.push(
      `огляд неповний: у транзакціях видно ${coverage.seenWords} слів батчів із ` +
        `${coverage.expectedWords}, які зобов'язує ланцюг (${coverage.transactions} транзакцій ` +
        'віддав RPC) — найімовірніше обрізаний ледер',
    )
  }

  for (const hit of hits) {
    problems.push(`відкритий запис у ${hit.surface} на зсуві ${hit.offset}: ${hit.needle}`)
  }
  for (const word of unexplained) {
    problems.push(
      `слово, якого немає в конверті: ${word.word} на зсуві ${word.offset} (${word.signature})`,
    )
  }

  // Внесок у діапазоні 1…MIN_CONTRIBUTION−1 сказав би, що саме ці кілька
  // записів увійшли в когорту, — тобто був би твердженням про конкретних людей.
  for (const entry of run.datasets) {
    const address = new PublicKey(entry.dataset).toBase58()
    if (entry.belowFloor && entry.recordsIncluded !== 0) {
      problems.push(
        `датасет ${address} нижче порога, але його внесок оголошено як ${entry.recordsIncluded}`,
      )
    }
    if (!entry.belowFloor && entry.recordsIncluded < MIN_CONTRIBUTION) {
      problems.push(
        `внесок датасету ${address} — ${entry.recordsIncluded}, тобто менший за поріг ${MIN_CONTRIBUTION}`,
      )
    }
  }

  if (result === null || report === null) {
    // Прогін без результату — це прогін, який не дійшов до звіту. Він законний
    // (невдале обчислення повертає депозит), і сказати про це треба, бо решта
    // перевірок звіту в ньому не робилась.
    if (run.status !== 'failed') {
      problems.push(`прогін у статусі ${run.status}, але результату в мережі немає`)
    }
    return problems
  }

  const suppressed = report.suppressed === 1n
  if (Number(report.included) < MIN_COHORT && !suppressed) {
    problems.push(
      `когорта ${report.included} менша за ${MIN_COHORT}, а звіт не придушено — ` +
        'це агрегат по кількох записах, тобто самі записи',
    )
  }
  if (Number(report.included) >= MIN_COHORT && suppressed) {
    problems.push(`когорта ${report.included} не менша за ${MIN_COHORT}, а звіт придушено`)
  }

  if (suppressed) {
    const leaked = [report.male, report.affected, ...report.ageAtLeast, ...report.alleleSum].filter(
      (value) => value !== 0n,
    )
    if (leaked.length > 0) {
      problems.push(`придушений звіт несе ${leaked.length} ненульових чисел замість самих нулів`)
    }
  }

  if (result.suppressed !== suppressed) {
    problems.push(`придушення: звіт каже ${suppressed}, акаунт результату — ${result.suppressed}`)
  }

  return problems
}

/**
 * Проглядає **всі** акаунти програми, а не тільки ті, що належать прогону.
 *
 * Робиться раз на корпус: акаунт, у який відкритий запис потрапив би повз
 * прогін — згода, каталожний рядок, конфігурація платформи, — від номера
 * прогону не залежить, а десять однакових проходів коштували б десяти
 * `getProgramAccounts` на кілька мегабайтів кожен.
 */
export async function sweepProgramAccounts(
  connection: Connection,
  programId: PublicKey,
  canary: readonly PlainRecord[],
): Promise<{ accounts: number; bytes: number; hits: Hit[] }> {
  const accounts = await connection.getProgramAccounts(programId, { commitment: 'confirmed' })

  const surfaces = accounts.map((entry): Surface => {
    return {
      id: `акаунт ${entry.pubkey.toBase58()}`,
      kind: 'акаунт',
      bytes: Uint8Array.from(entry.account.data),
    }
  })

  return {
    accounts: surfaces.length,
    bytes: surfaces.reduce((total, surface) => total + surface.bytes.length, 0),
    hits: sweep(surfaces, recordNeedles(canary)),
  }
}
