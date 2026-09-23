import type { ConsentViolation } from './consent.ts'
import { PROGRAM_ADDRESS, PROGRAM_ERRORS } from './program-errors.generated.ts'

/**
 * Відмова ланцюга, названа своїм ім'ям (`FR-008`, `T038`).
 *
 * # Що тут вирішується
 *
 * Програма відмовляє типізовано: кожна перевірка має власний варіант
 * `GenoVaultError`, і це доведено на стенді (`each_refusal_names_its_own_constraint`).
 * До покупця ця відмова доходить **числом**: гаманець показує
 * `custom program error: 0x177c`, і далі вона йшла в екран як `INTERNAL` із
 * сирим текстом. Тобто обмеження називала програма, а не продукт, і з боку
 * покупця `FR-008` не виконувався зовсім.
 *
 * # Чому розбір не довіряється тексту
 *
 * Текст помилки складає той, хто її несе — RPC, `@solana/kit`, обгортка
 * гаманця, — і в різних збірках він різний: production-збірка `@solana/errors`
 * лишає від повідомлення номер. Тому спершу читається **структура**
 * (`context.__code` + `context.code` у `SolanaError`), потім сира відмова RPC
 * (`{ InstructionError: [0, { Custom: N }] }`), потім логи симуляції, і лише
 * після всього — текст. Кожен наступний спосіб слабший за попередній, і
 * порядок саме такий, щоб слабкий не перебивав сильного.
 *
 * # Межа, яку треба знати
 *
 * Код `Custom(N)` не несе в собі програми, яка його повернула. Коли в логах є
 * рядок `Program <адреса> failed:`, ми звіряємо адресу з нашою; коли логів
 * немає — покладаємось на те, що транзакція замовлення несе **рівно одну**
 * інструкцію в нашу програму (`buildTransaction`). Якщо колись у транзакцію
 * додасться чужа інструкція, цей розбір почне називати чужі коди нашими
 * іменами — і тоді сюди має приїхати індекс інструкції, а не нове ім'я.
 *
 * Коду, якого немає в таблиці, ми імені не вигадуємо: `programRefusal` віддає
 * `null`, і покупець бачить число, а не здогадку.
 */

/** Ім'я варіанта помилки з IDL — літерали, а не `string`. */
export type ProgramErrorName = (typeof PROGRAM_ERRORS)[number]['name']

export interface ProgramRefusal {
  /** Код, як його повертає ланцюг: 6000 + порядковий номер варіанта. */
  code: number
  /** Ім'я варіанта з IDL — `consentIsRevoked`. */
  name: ProgramErrorName
  /** Повідомлення самої програми (`#[msg]`). */
  msg: string
  /** Порушене обмеження згоди, якщо відмова саме за згодою. */
  violation: ConsentViolation | null
}

/**
 * Помилки згоди → словник причин, яким говорить решта продукту.
 *
 * Ключі перевіряє компілятор: `ProgramErrorName` — об'єднання літералів із
 * згенерованої таблиці, тож варіант, перейменований у програмі, валить збірку,
 * а не мовчки випадає зі словника. Що кожна причина з `CONSENT_VIOLATIONS`
 * тут названа рівно раз — тримає тест: компілятор цього не бачить.
 *
 * `useTypeForbidden` і `useTypeNotAllowed` лишаються різними причинами й тут:
 * це два різні рішення власника (`packages/shared/src/consent.ts`).
 */
const CONSENT_VIOLATION_BY_ERROR = {
  consentMissing: 'no-consent',
  consentIsRevoked: 'revoked',
  consentExpired: 'expired',
  useTypeForbidden: 'use-forbidden',
  useTypeNotAllowed: 'use-not-allowed',
  buyerCategoryNotAllowed: 'category-not-allowed',
} satisfies Partial<Record<ProgramErrorName, ConsentViolation>>

const BY_CODE = new Map<number, ProgramRefusal>(
  PROGRAM_ERRORS.map((entry) => [
    entry.code,
    {
      code: entry.code,
      name: entry.name,
      msg: entry.msg,
      violation: violationOf(entry.name),
    },
  ]),
)

function violationOf(name: ProgramErrorName): ConsentViolation | null {
  const table: Partial<Record<string, ConsentViolation>> = CONSENT_VIOLATION_BY_ERROR
  return table[name] ?? null
}

/** Відмова за кодом. `null` — коду немає в таблиці програми (чужа програма, Anchor, SPL). */
export function programErrorByCode(code: number): ProgramRefusal | null {
  return BY_CODE.get(code) ?? null
}

/** Порушене обмеження згоди за іменем помилки. `null` — помилка не про згоду. */
export function consentViolationOf(name: string): ConsentViolation | null {
  const table: Partial<Record<string, ConsentViolation>> = CONSENT_VIOLATION_BY_ERROR
  return table[name] ?? null
}

/**
 * `SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM` з `@solana/errors`.
 *
 * Літерал, а не імпорт: `packages/shared` не залежить від `@solana/kit` і не
 * має залежати — його читає і сервер, і браузер. Значення однакове в 2.3, 5.5 і
 * 8.2, а тест будує справжню помилку тим самим `kit`, яким її отримає гаманець,
 * тож розходження проявиться падінням тесту, а не мовчазним `INTERNAL`.
 */
const KIT_INSTRUCTION_ERROR_CUSTOM = 4615026

/** Глибина обходу `cause`: реальні ланцюги коротші, а цикл обривається `seen`. */
const MAX_DEPTH = 8

const NESTED_KEYS = ['context', 'cause', 'err', 'error', 'data', 'transactionError'] as const

// `#` — форма самого `@solana/kit` (`custom program error: #6012`), `0x` — форма
// логів валідатора. Обидві трапляються в тому самому ланцюгу помилок.
const CUSTOM_IN_TEXT = /custom program error:\s*#?(0x[0-9a-f]+|\d+)/i
const PROGRAM_FAILED_IN_LOG = /^Program (\S+) failed: custom program error:\s*#?(0x[0-9a-f]+|\d+)/i
const ANCHOR_NUMBER_IN_TEXT = /Error Number:\s*(\d+)/

/**
 * Код `Custom(N)`, витягнутий із чого завгодно, що кинув гаманець чи RPC.
 *
 * `null` означає «це не відмова програми», а не «відмова без коду»: мережа,
 * скасований підпис і прострочений хеш блоку сюди не потрапляють.
 */
export function customProgramErrorCode(error: unknown): number | null {
  return fromValue(error, new Set(), 0)
}

/** Названа відмова програми. `null` — або не відмова, або код не наш. */
export function programRefusal(error: unknown): ProgramRefusal | null {
  const code = customProgramErrorCode(error)
  return code === null ? null : programErrorByCode(code)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function fromValue(value: unknown, seen: Set<object>, depth: number): number | null {
  if (typeof value === 'string') return fromText(value)
  if (!isRecord(value) || depth > MAX_DEPTH || seen.has(value)) return null
  seen.add(value)

  // 1. `SolanaError` від `@solana/kit`: код лежить у контексті числом.
  const context = value.context
  if (isRecord(context) && context.__code === KIT_INSTRUCTION_ERROR_CUSTOM) {
    const code = context.code
    if (typeof code === 'number') return code
  }

  // 2. Сира відмова RPC — та сама форма, що в `meta.err` підтвердженої транзакції.
  const instruction = fromInstructionError(value.InstructionError)
  if (instruction !== null) return instruction

  // 3. Логи симуляції. Вони єдині називають програму, тож ідуть попереду тексту.
  const logs = value.logs ?? (isRecord(context) ? context.logs : undefined)
  const logged = fromLogs(logs)
  if (logged !== null) return logged

  for (const key of NESTED_KEYS) {
    const nested = fromValue(value[key], seen, depth + 1)
    if (nested !== null) return nested
  }

  // 4. Текст — останнє, бо його складає той, хто несе помилку, а не програма.
  const message = value.message
  if (typeof message === 'string') {
    const parsed = fromText(message)
    if (parsed !== null) return parsed
  }

  return null
}

function fromInstructionError(value: unknown): number | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const detail = value[1]
  if (!isRecord(detail)) return null
  const custom = detail.Custom
  return typeof custom === 'number' ? custom : null
}

/**
 * Код із логів симуляції.
 *
 * Три джерела, від сильного до слабкого: рядок `Program <наша адреса> failed:`
 * (єдиний, що звіряє програму), `AnchorError … Error Number: N` (його пише сам
 * Anchor у нашій програмі) і будь-який `custom program error:`. Рядок, що
 * називає **чужу** програму, пропускається: у ньому код чужої таблиці.
 */
function fromLogs(value: unknown): number | null {
  if (!Array.isArray(value)) return null
  const lines = value.filter((line): line is string => typeof line === 'string')

  let anchor: number | null = null
  let bare: number | null = null

  for (const line of lines) {
    const failure = PROGRAM_FAILED_IN_LOG.exec(line)
    if (failure !== null) {
      if (failure[1] === PROGRAM_ADDRESS) return parseCode(failure[2])
      continue
    }
    if (anchor === null && line.includes('AnchorError')) {
      const numbered = ANCHOR_NUMBER_IN_TEXT.exec(line)
      if (numbered !== null) anchor = parseCode(numbered[1])
    }
    if (bare === null) {
      const custom = CUSTOM_IN_TEXT.exec(line)
      if (custom !== null) bare = parseCode(custom[1])
    }
  }

  return anchor ?? bare
}

function fromText(text: string): number | null {
  const custom = CUSTOM_IN_TEXT.exec(text)
  if (custom !== null) return parseCode(custom[1])
  const numbered = ANCHOR_NUMBER_IN_TEXT.exec(text)
  return numbered === null ? null : parseCode(numbered[1])
}

function parseCode(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const value = raw.toLowerCase().startsWith('0x')
    ? Number.parseInt(raw, 16)
    : Number.parseInt(raw, 10)
  return Number.isSafeInteger(value) ? value : null
}

/** Таблиця помилок програми — згенероване дзеркало IDL. */
export { PROGRAM_ADDRESS, PROGRAM_ERRORS } from './program-errors.generated.ts'
