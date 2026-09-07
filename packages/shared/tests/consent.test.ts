import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUYER_CATEGORIES,
  BUYER_CATEGORY_ALL,
  buyerCategoryBit,
  buyerCategorySchema,
  type ConsentState,
  checkConsent,
  effectiveUses,
  namedCategories,
  namedUses,
  USE_TYPE_ALL,
  USE_TYPES,
  useTypeBit,
  useTypeSchema,
} from '../src/consent.ts'

const consent = (patch: Partial<ConsentState> = {}): ConsentState => ({
  allowedUses: USE_TYPES.oncology | USE_TYPES.rareDisease,
  forbiddenUses: 0,
  buyerCategories: BUYER_CATEGORIES.academic | BUYER_CATEGORIES.nonProfit,
  expiresAt: null,
  revoked: false,
  ...patch,
})

const request = { useType: 'oncology', buyerCategory: 'academic', now: 1_000n } as const

describe('дзеркала констант згоди', () => {
  // Константи живуть у модулях програми, а не в полях акаунта, тож в IDL їх
  // немає — вивести їх звідти неможливо. Зсунутий на одиницю біт не падає
  // ніде: він тихо перетворює «онкологія» на «кардіологія» і віддає дані на
  // ціль, якої власник не дозволяв. Тому дзеркало звіряється з текстом.
  const state = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../programs/genovault/src/state/consent.rs',
    ),
    'utf8',
  )

  it.each([
    ['ONCOLOGY', USE_TYPES.oncology],
    ['CARDIOLOGY', USE_TYPES.cardiology],
    ['RARE_DISEASE', USE_TYPES.rareDisease],
    ['POPULATION_GENETICS', USE_TYPES.populationGenetics],
    ['PHARMA_COMMERCIAL', USE_TYPES.pharmaCommercial],
  ])('тип використання %s збігається з програмою', (name, bit) => {
    expect(state).toMatch(new RegExp(`${name}:\\s*u32\\s*=\\s*1\\s*<<\\s*${Math.log2(bit)};`))
  })

  it.each([
    ['ACADEMIC', BUYER_CATEGORIES.academic],
    ['NON_PROFIT', BUYER_CATEGORIES.nonProfit],
    ['COMMERCIAL', BUYER_CATEGORIES.commercial],
    ['GOVERNMENT', BUYER_CATEGORIES.government],
  ])('категорія покупця %s збігається з програмою', (name, bit) => {
    expect(state).toMatch(new RegExp(`${name}:\\s*u32\\s*=\\s*1\\s*<<\\s*${Math.log2(bit)};`))
  })

  it('у словнику рівно стільки типів, скільки в програмі', () => {
    // Кількість, а не лише значення: тип, доданий у програмі й забутий тут,
    // мовчки випав би зі словника, і власник не зміг би його вибрати.
    const declared = state.match(/pub const [A-Z_]+: u32 = 1 << \d+;/g) ?? []
    expect(declared).toHaveLength(
      Object.keys(USE_TYPES).length + Object.keys(BUYER_CATEGORIES).length,
    )
  })

  it('ALL збігається з об’єднанням бітів', () => {
    expect(USE_TYPE_ALL).toBe(0b11111)
    expect(BUYER_CATEGORY_ALL).toBe(0b1111)
  })
})

describe('назви на межі', () => {
  it('приймає лише відомі назви', () => {
    expect(useTypeSchema.parse('oncology')).toBe('oncology')
    expect(() => useTypeSchema.parse('genomics')).toThrow()
    expect(() => buyerCategorySchema.parse('startup')).toThrow()
  })

  it('перекладає назву в один біт', () => {
    expect(useTypeBit('pharmaCommercial')).toBe(1 << 4)
    expect(buyerCategoryBit('government')).toBe(1 << 3)
  })

  it('розкладає маску на назви', () => {
    expect(namedUses(USE_TYPES.oncology | USE_TYPES.rareDisease)).toEqual([
      'oncology',
      'rareDisease',
    ])
    expect(namedCategories(BUYER_CATEGORIES.commercial)).toEqual(['commercial'])
  })

  it('мовчки пропускає біт, якого немає у словнику', () => {
    // Такий біт приходить із новішої версії програми. Падати тут означало б
    // зробити каталог непрацездатним після кожного оновлення ончейн.
    expect(namedUses(USE_TYPES.oncology | (1 << 20))).toEqual(['oncology'])
  })
})

describe('перевірка згоди', () => {
  it('пропускає дозволене', () => {
    expect(checkConsent(consent(), request)).toBeNull()
  })

  it('відсутня згода — це названа причина, а не виняток', () => {
    expect(checkConsent(null, request)).toBe('no-consent')
  })

  it('відкликання названо раніше за все інше', () => {
    // Порядок важливий саме тут: на відкликаній згоді покупець інакше читав би
    // «тип не дозволений» і шукав би проблему не там.
    const revoked = consent({ revoked: true, allowedUses: 0, buyerCategories: 0 })
    expect(checkConsent(revoked, request)).toBe('revoked')
  })

  it('строк перевіряється переданим часом і включає момент спливу', () => {
    expect(checkConsent(consent({ expiresAt: 1_001n }), request)).toBeNull()
    expect(checkConsent(consent({ expiresAt: 1_000n }), request)).toBe('expired')
    expect(checkConsent(consent({ expiresAt: 999n }), request)).toBe('expired')
  })

  it('строк називається раніше за тип, але пізніше за відкликання', () => {
    const both = consent({ revoked: true, expiresAt: 1n })
    expect(checkConsent(both, request)).toBe('revoked')
    expect(checkConsent(consent({ expiresAt: 1n, allowedUses: 0 }), request)).toBe('expired')
  })

  it('розрізняє «прямо заборонено» і «не дозволено»', () => {
    // Це різні рішення власника: перше він ухвалив свідомо, друге просто не
    // ухвалював — і власник має право знати, яке з них спрацювало.
    const forbidden = consent({
      allowedUses: USE_TYPES.oncology,
      forbiddenUses: USE_TYPES.oncology,
    })
    expect(checkConsent(forbidden, request)).toBe('use-forbidden')
    expect(checkConsent(consent({ allowedUses: USE_TYPES.cardiology }), request)).toBe(
      'use-not-allowed',
    )
  })

  it('категорія покупця перевіряється останньою', () => {
    const state = consent({ buyerCategories: BUYER_CATEGORIES.commercial })
    expect(checkConsent(state, request)).toBe('category-not-allowed')
  })

  it('effectiveUses знімає заборонене з дозволеного', () => {
    const state = consent({
      allowedUses: USE_TYPES.oncology | USE_TYPES.cardiology,
      forbiddenUses: USE_TYPES.cardiology,
    })
    expect(effectiveUses(state)).toBe(USE_TYPES.oncology)
  })
})
