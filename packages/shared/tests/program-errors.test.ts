import { describe, expect, it } from 'vitest'
import { CONSENT_VIOLATIONS } from '../src/consent.ts'
import { PROGRAM_ADDRESS, PROGRAM_ERRORS } from '../src/program-errors.generated.ts'
import {
  consentViolationOf,
  customProgramErrorCode,
  programErrorByCode,
  programRefusal,
} from '../src/program-errors.ts'

/**
 * Розбір відмови ланцюга (`T038`, `FR-008`).
 *
 * Перевіряється не «функція повернула число», а те, що **кожна** причина
 * згоди має ім'я на ланцюгу, і що ім'я не вигадується там, де код чужий.
 * Друге важливіше за перше: розбір, який називає чужу відмову нашим
 * обмеженням, гірший за розбір, який мовчить.
 */

const REVOKED = 6012 // `consentIsRevoked`, вона ж `0x177c`
const TOKEN_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'

describe('таблиця помилок програми', () => {
  it('нумерується підряд від 6000 і має унікальні імена', () => {
    // Розрив у нумерації означав би, що дзеркало зібране не з IDL: коди в
    // Anchor — це порядок варіантів, і дірок у ньому не буває.
    expect(PROGRAM_ERRORS.map((entry) => entry.code)).toEqual(
      PROGRAM_ERRORS.map((_, index) => 6000 + index),
    )
    expect(new Set(PROGRAM_ERRORS.map((entry) => entry.name)).size).toBe(PROGRAM_ERRORS.length)
  })

  it('називає код і не вигадує імені чужому', () => {
    expect(programErrorByCode(REVOKED)).toMatchObject({
      name: 'consentIsRevoked',
      msg: 'Згоду відкликано',
      violation: 'revoked',
    })
    // 1 — це `InsufficientFunds` Token-2022, 2000-ні — рамка Anchor, 6065 —
    // варіант, якого в нашій програмі ще немає.
    expect(programErrorByCode(1)).toBeNull()
    expect(programErrorByCode(2003)).toBeNull()
    expect(programErrorByCode(6000 + PROGRAM_ERRORS.length)).toBeNull()
  })
})

describe('словник порушених обмежень', () => {
  it('покриває кожну причину зі словника згоди рівно одним іменем', () => {
    // Причина без імені на ланцюгу означає відмову, яку покупець побачить
    // числом; ім'я без причини — рядок, якого не покаже жоден екран.
    const named = PROGRAM_ERRORS.flatMap((entry) => {
      const violation = consentViolationOf(entry.name)
      return violation === null ? [] : [violation]
    })
    expect([...named].sort()).toEqual([...CONSENT_VIOLATIONS].sort())
  })

  it('не називає обмеженням згоди те, що нею не є', () => {
    expect(consentViolationOf('platformPaused')).toBeNull()
    expect(consentViolationOf('consentAlreadyRevoked')).toBeNull()
    expect(consentViolationOf('вигадане')).toBeNull()
  })
})

describe('код відмови з того, що кинув гаманець', () => {
  it('читається зі структури `SolanaError`, а не з тексту', () => {
    // Форма з `@solana/kit`: preflight-помилка несе логи, а причина лежить
    // окремою помилкою в `cause`. Тексту в production-збірці може не бути
    // взагалі — тому спершу структура.
    const error = {
      name: 'SolanaError',
      message: 'Solana error #-32002',
      context: { __code: -32002, logs: [] },
      cause: { name: 'SolanaError', context: { __code: 4615026, code: REVOKED, index: 0 } },
    }
    expect(customProgramErrorCode(error)).toBe(REVOKED)
  })

  it('дістається крізь обгортку гаманця', () => {
    // Privy загортає причину в `PrivyClientError`, коли показує власне вікно.
    const wrapped = new Error('Failed to connect to wallet', {
      cause: new Error('send failed', {
        cause: { context: { __code: 4615026, code: REVOKED, index: 0 } },
      }),
    })
    expect(programRefusal(wrapped)?.violation).toBe('revoked')
  })

  it('читається з сирої відмови RPC', () => {
    expect(customProgramErrorCode({ err: { InstructionError: [0, { Custom: REVOKED }] } })).toBe(
      REVOKED,
    )
  })

  it('читається з логів симуляції', () => {
    const logs = [
      `Program ${PROGRAM_ADDRESS} invoke [1]`,
      'Program log: AnchorError occurred. Error Code: ConsentIsRevoked. Error Number: 6012. Error Message: Згоду відкликано.',
      `Program ${PROGRAM_ADDRESS} consumed 14203 of 200000 compute units`,
      `Program ${PROGRAM_ADDRESS} failed: custom program error: 0x177c`,
    ]
    expect(customProgramErrorCode({ context: { __code: -32002, logs } })).toBe(REVOKED)
  })

  it('не бере коду з рядка про чужу програму', () => {
    // Негативний контроль. `Custom(1)` Token-2022 — це «недостатньо коштів», а
    // 1 у нашій таблиці немає взагалі; але якби чужий код збігся з нашим, ми
    // назвали б покупцю обмеження, якого ніхто не порушував.
    const foreign = [
      `Program ${TOKEN_PROGRAM} invoke [2]`,
      `Program ${TOKEN_PROGRAM} failed: custom program error: 0x177c`,
    ]
    expect(customProgramErrorCode({ context: { __code: -32002, logs: foreign } })).toBeNull()
  })

  it('серед чужих рядків бере наш', () => {
    const mixed = [
      `Program ${TOKEN_PROGRAM} failed: custom program error: 0x1`,
      `Program ${PROGRAM_ADDRESS} failed: custom program error: 0x177c`,
    ]
    expect(customProgramErrorCode({ logs: mixed })).toBe(REVOKED)
  })

  it('читається з тексту, коли більше нічого немає', () => {
    // Саме цей вигляд і доходив до екрана до `T038`.
    const message =
      'Transaction simulation failed: Error processing Instruction 0: custom program error: 0x177c'
    expect(programRefusal(new Error(message))?.name).toBe('consentIsRevoked')
    expect(customProgramErrorCode('custom program error: 24')).toBe(24)
  })

  it('мовчить там, де відмови програми не було', () => {
    expect(customProgramErrorCode(new TypeError('Failed to fetch'))).toBeNull()
    expect(customProgramErrorCode(new Error('User rejected the request'))).toBeNull()
    expect(customProgramErrorCode({ err: 'BlockhashNotFound' })).toBeNull()
    expect(customProgramErrorCode(null)).toBeNull()
    expect(customProgramErrorCode(undefined)).toBeNull()
  })

  it('не зациклюється на помилці, яка вказує сама на себе', () => {
    const loop: Record<string, unknown> = { message: 'обгортка' }
    loop.cause = loop
    expect(customProgramErrorCode(loop)).toBeNull()
  })

  it('не називає нашим обмеженням код, якого в таблиці немає', () => {
    expect(customProgramErrorCode('custom program error: 0x1')).toBe(1)
    expect(programRefusal('custom program error: 0x1')).toBeNull()
  })
})
