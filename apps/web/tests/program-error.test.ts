import { getSolanaErrorFromJsonRpcError } from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { ApiRequestError, toApiError } from '../src/lib/api.ts'

/**
 * Відмова ланцюга на екрані покупця (`T038`, `FR-008`).
 *
 * Помилка тут **не вигадана**: вона будується тим самим `@solana/kit`, яким її
 * отримає гаманець, із тієї самої відповіді RPC, яку повертає симуляція. Це
 * єдине місце, де перевіряється число `4615026` — код `InstructionError::Custom`
 * у `@solana/errors`, записане в `packages/shared` літералом, бо тягнути `kit`
 * у пакет, спільний із сервером, задля однієї константи не можна. Змінять код у
 * бібліотеці — впаде цей тест, а не мовчазний `INTERNAL` на екрані.
 */

const PROGRAM = '9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb'

/** Відповідь RPC на `sendTransaction`, коли симуляція впала на нашій відмові. */
function preflightFailure(code: number, logs: string[]): unknown {
  return getSolanaErrorFromJsonRpcError({
    code: -32002,
    message: 'Transaction simulation failed',
    data: {
      accounts: null,
      err: { InstructionError: [0, { Custom: code }] },
      logs,
      unitsConsumed: 14203,
    },
  })
}

/**
 * Те саме, але зібране так, як його побачить браузер після `vite build`.
 *
 * `@solana/errors` дивиться на `process.env.NODE_ENV` у момент створення
 * помилки, і в production пише замість тексту номер із контекстом у base64.
 */
function productionBuild<T>(build: () => T): T {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    return build()
  } finally {
    process.env.NODE_ENV = previous
  }
}

const REVOKED_LOGS = [
  `Program ${PROGRAM} invoke [1]`,
  'Program log: AnchorError occurred. Error Code: ConsentIsRevoked. Error Number: 6012. Error Message: Згоду відкликано.',
  `Program ${PROGRAM} consumed 14203 of 200000 compute units`,
  `Program ${PROGRAM} failed: custom program error: 0x177c`,
]

describe('відмова ланцюга доходить до екрана названою', () => {
  it('називає порушене обмеження, а не код', () => {
    const shown = toApiError(preflightFailure(6012, REVOKED_LOGS))

    expect(shown.code).toBe('CONSENT_VIOLATION')
    expect(shown.message).toBe('The chain refused the order. Consent was revoked.')
    expect(shown.details).toMatchObject({
      refusal: 'program-error',
      code: '0x177c',
      name: 'consentIsRevoked',
      constraint: 'revoked',
    })
  })

  it('обходиться без логів і без тексту — код лежить у структурі помилки', () => {
    // Найважливіший випадок, і саме він ледве не пройшов «сам по собі».
    //
    // У dev-збірці `@solana/errors` причина несе текст `custom program error:
    // #6012`, тож розбір знайшов би код навіть із неправильною константою — і
    // тест був би зелений ні від чого. У production-збірці (а `vite build`
    // ставить саме її) від повідомлення лишається `Solana error #4615026;
    // Decode this error by running …` з контекстом у base64, тобто коду в
    // тексті немає взагалі. Разом із `skipSimulation`, який прибирає логи,
    // структура лишається єдиним джерелом.
    const bare = productionBuild(() => preflightFailure(6012, []))

    expect(bare).toBeInstanceOf(Error)
    expect((bare as Error).message).not.toMatch(/6012|0x177c/)
    expect(((bare as Error).cause as Error).message).not.toMatch(/6012|0x177c/)
    expect(toApiError(bare).details).toMatchObject({ name: 'consentIsRevoked' })
  })

  it('дістається крізь обгортку гаманця', () => {
    // Privy загортає причину у власну помилку, коли показує своє вікно підпису.
    const wrapped = new Error('Failed to connect to wallet', {
      cause: preflightFailure(6012, REVOKED_LOGS),
    })
    expect(toApiError(wrapped).code).toBe('CONSENT_VIOLATION')
  })

  it('на паузі платформи каже про паузу', () => {
    const paused = preflightFailure(6033, [
      `Program ${PROGRAM} failed: custom program error: 0x1791`,
    ])
    const shown = toApiError(paused)

    expect(shown.code).toBe('PLATFORM_PAUSED')
    expect(shown.message).toBe('The platform is paused.')
    expect(shown.details).toMatchObject({ name: 'platformPaused' })
  })

  it('відмову не про згоду теж називає іменем', () => {
    // `runEscrowAboveMax` — ціна зросла понад названу покупцем межу. Екран не
    // вміє її пояснити, але назвати мусить: без імені це «internal error».
    const shown = toApiError(preflightFailure(6040, []))

    expect(shown.code).toBe('INTERNAL')
    expect(shown.message).toBe('The chain refused the transaction: runEscrowAboveMax.')
    expect(shown.details).toMatchObject({ name: 'runEscrowAboveMax' })
    // Обмеження згоди тут немає — і ключа теж немає, а не порожній.
    expect(shown.details && 'constraint' in shown.details).toBe(false)
  })

  it('не вигадує імені чужому коду', () => {
    // `Custom(1)` Token-2022 — «недостатньо коштів». Своєї таблиці в нас на нього
    // немає, і назвати його нашим обмеженням було б гірше, ніж не називати.
    const foreign = preflightFailure(1, [
      'Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x1',
    ])
    expect(toApiError(foreign).code).toBe('INTERNAL')
    expect(toApiError(foreign).details).toBeUndefined()
  })

  it('не чіпає того, що відмовою програми не є', () => {
    // Відповідь API вже несе власний код — розбір ланцюга не має його перебивати.
    const fromApi = new ApiRequestError(403, 'CONSENT_VIOLATION', 'прогін не складається', {
      refusal: 'datasets-ineligible',
    })
    expect(toApiError(fromApi)).toEqual({
      code: 'CONSENT_VIOLATION',
      message: 'прогін не складається',
      details: { refusal: 'datasets-ineligible' },
    })

    expect(toApiError(new Error('User rejected the request'))).toEqual({
      code: 'INTERNAL',
      message: 'User rejected the request',
    })
  })
})
