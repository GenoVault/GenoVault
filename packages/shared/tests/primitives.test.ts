import { describe, expect, it } from 'vitest'
import { decodeBase58 } from '../src/base58.ts'
import {
  apiError,
  apiErrorSchema,
  bpsSchema,
  contentHashSchema,
  DATASET_ID_MAX_LENGTH,
  datasetIdSchema,
  recordCountSchema,
  solanaAddressSchema,
  tokenAmountSchema,
} from '../src/index.ts'

const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const VALID_ADDRESS = 'GenoVau1t1111111111111111111111111111111111'

describe('decodeBase58', () => {
  it('декодує провідні одиниці в нульові байти', () => {
    expect(decodeBase58('1')).toEqual(Uint8Array.from([0]))
    expect(decodeBase58('11')).toEqual(Uint8Array.from([0, 0]))
  })

  it('декодує адресу системної програми у 32 нульові байти', () => {
    expect(decodeBase58(SYSTEM_PROGRAM)?.length).toBe(32)
  })

  it('повертає null, а не кидає, на символах поза алфавітом', () => {
    // '0', 'O', 'I', 'l' виключені з base58 саме через схожість накреслення.
    expect(decodeBase58('0OIl')).toBeNull()
    expect(decodeBase58('')).toBeNull()
  })
})

describe('solanaAddressSchema', () => {
  it('приймає адресу правильної довжини', () => {
    expect(solanaAddressSchema.parse(VALID_ADDRESS)).toBe(VALID_ADDRESS)
  })

  it('відхиляє рядок, що декодується не в 32 байти', () => {
    // Довжина в символах у межах норми, але число замале — класичний випадок,
    // який ловить лише перевірка після декодування, а не регекс по алфавіту.
    expect(solanaAddressSchema.safeParse('1'.repeat(33)).success).toBe(false)
  })

  it('не кидає на символах поза алфавітом, а повертає помилку валідації', () => {
    // Zod 4 не спиняється на першій невдалій перевірці, тому refine отримує
    // рядок, який min/max уже відхилили. Виняток тут став би 500 замість 400.
    const result = solanaAddressSchema.safeParse('O0Il'.repeat(9))
    expect(result.success).toBe(false)
  })
})

describe('tokenAmountSchema', () => {
  it('приймає bigint, рядок і ціле число', () => {
    expect(tokenAmountSchema.parse(10n)).toBe(10n)
    expect(tokenAmountSchema.parse('10')).toBe(10n)
    expect(tokenAmountSchema.parse(10)).toBe(10n)
  })

  it('тримає верхню межу u64', () => {
    const max = 0xffff_ffff_ffff_ffffn
    expect(tokenAmountSchema.parse(max)).toBe(max)
    expect(tokenAmountSchema.safeParse(max + 1n).success).toBe(false)
  })

  it('відхиляє від’ємні суми й дробові числа', () => {
    expect(tokenAmountSchema.safeParse(-1n).success).toBe(false)
    expect(tokenAmountSchema.safeParse(1.5).success).toBe(false)
  })

  it('не приймає рядок із пробілами або знаком', () => {
    expect(tokenAmountSchema.safeParse(' 10').success).toBe(false)
    expect(tokenAmountSchema.safeParse('+10').success).toBe(false)
  })
})

describe('datasetIdSchema', () => {
  it('приймає малі літери, цифри й дефіс', () => {
    expect(datasetIdSchema.parse('exome-cohort-2026')).toBe('exome-cohort-2026')
  })

  it('відхиляє верхній регістр, дефіс на початку й закороткий ідентифікатор', () => {
    expect(datasetIdSchema.safeParse('Exome').success).toBe(false)
    expect(datasetIdSchema.safeParse('-exome').success).toBe(false)
    expect(datasetIdSchema.safeParse('ab').success).toBe(false)
  })

  it('тримається межі seed: 32 символи проходять, 33 — ні', () => {
    expect(datasetIdSchema.safeParse('a'.repeat(DATASET_ID_MAX_LENGTH)).success).toBe(true)
    expect(datasetIdSchema.safeParse('a'.repeat(DATASET_ID_MAX_LENGTH + 1)).success).toBe(false)
  })
})

describe('bpsSchema', () => {
  it('приймає межі діапазону', () => {
    expect(bpsSchema.parse(0)).toBe(0)
    expect(bpsSchema.parse(10_000)).toBe(10_000)
  })

  it('відхиляє комісію понад 100%', () => {
    expect(bpsSchema.safeParse(10_001).success).toBe(false)
  })
})

describe('recordCountSchema', () => {
  it('приймає нуль — датасет міг не дати жодного запису після фільтрів', () => {
    expect(recordCountSchema.parse(0)).toBe(0)
  })

  it('відхиляє від’ємну кількість', () => {
    expect(recordCountSchema.safeParse(-1).success).toBe(false)
  })
})

describe('contentHashSchema', () => {
  it('приймає sha-256 у нижньому регістрі', () => {
    expect(contentHashSchema.parse('a'.repeat(64))).toBe('a'.repeat(64))
  })

  it('відхиляє верхній регістр і неправильну довжину', () => {
    expect(contentHashSchema.safeParse('A'.repeat(64)).success).toBe(false)
    expect(contentHashSchema.safeParse('a'.repeat(63)).success).toBe(false)
  })
})

describe('apiError', () => {
  it('не додає details, коли їх немає', () => {
    const parsed = apiErrorSchema.parse(apiError('NOT_FOUND', 'датасет не знайдено'))
    expect(parsed.error).toEqual({ code: 'NOT_FOUND', message: 'датасет не знайдено' })
  })

  it('несе конкретне порушене обмеження для відмови за згодою', () => {
    const error = apiError('CONSENT_VIOLATION', 'тип використання не дозволений', {
      violatedRule: 'allowed_uses',
    })
    expect(apiErrorSchema.parse(error).error.details).toEqual({ violatedRule: 'allowed_uses' })
  })
})
