import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pricePer1kSchema, solanaAddressSchema } from '../src/primitives.ts'
import {
  datasetUpperBound,
  MAX_RUN_DATASETS,
  poolUpperBound,
  QUOTE_INELIGIBLE_REASONS,
  QuoteOverflowError,
  quoteLineSchema,
  RECORDS_PER_PRICE_UNIT,
  runQuoteRequestSchema,
} from '../src/quote.ts'

const price = (value: bigint) => pricePer1kSchema.parse(value)

const OWNER = solanaAddressSchema.parse('11111111111111111111111111111112')
const OTHER = solanaAddressSchema.parse('11111111111111111111111111111113')

describe('межа для одного датасету', () => {
  it('рахує ціну за тисячу записів', () => {
    expect(datasetUpperBound(price(1_500_000n), 2_000n)).toBe(3_000_000n)
  })

  it('заокруглює вгору, а не вниз', () => {
    // Неповна тисяча — звичайний випадок: датасет на 10 записів це 0,01
    // тисячі. Заокруглення вниз дало б нуль, тобто безкоштовний датасет.
    expect(datasetUpperBound(price(1_000n), 1n)).toBe(1n)
    expect(datasetUpperBound(price(1_000n), 999n)).toBe(999n)
    expect(datasetUpperBound(price(1n), 1n)).toBe(1n)
  })

  it('нуль записів коштує нуль', () => {
    expect(datasetUpperBound(price(1_000_000n), 0n)).toBe(0n)
  })

  it('безкоштовний датасет лишається безкоштовним', () => {
    expect(datasetUpperBound(price(0n), 10_000n)).toBe(0n)
  })

  it('не вміщається в u64 — це відмова, а не тиха обрізка', () => {
    // Депозит ончейн це u64. Обрізка тут дала б покупцю маленьке число, яке
    // він заблокував би, поки програма рахувала б своє.
    const huge = price(0xffff_ffff_ffff_ffffn)
    expect(() => datasetUpperBound(huge, 100_000n)).toThrow(QuoteOverflowError)
  })

  it('ціна за тисячу оголошена саме за тисячу', () => {
    expect(RECORDS_PER_PRICE_UNIT).toBe(1000n)
  })
})

describe('межа по пулу', () => {
  it('сумує доданки, а не записи', () => {
    // Спільного знаменника в датасетів немає: у кожного своя ціна.
    const lines = [datasetUpperBound(price(1_000n), 500n), datasetUpperBound(price(3_000n), 500n)]
    expect(poolUpperBound(lines)).toBe(500n + 1_500n)
  })

  it('порожній пул коштує нуль', () => {
    expect(poolUpperBound([])).toBe(0n)
  })

  it('переповнення суми — відмова', () => {
    const max = datasetUpperBound(price(0xffff_ffff_ffff_ffffn), 1_000n)
    expect(() => poolUpperBound([max, max])).toThrow(QuoteOverflowError)
  })

  it('MAX_RUN_DATASETS збігається з програмою', () => {
    const run = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../programs/genovault/src/state/run.rs'),
      'utf8',
    )
    expect(run).toMatch(new RegExp(`MAX_RUN_DATASETS:\\s*usize\\s*=\\s*${MAX_RUN_DATASETS};`))
  })
})

/**
 * `FR-015a`: рахунок після прогону не перевищує показану межу.
 *
 * Розрахунок тут — **модель** правила, за яким рахуватиме `T027`, а не його
 * реалізація: мета твердження в тому, що межа тримається арифметикою, а не
 * тим, як саме написано розрахунок. Правило (продуктове рішення 2026-09-07):
 * записи датасету, що не дотяг до `MIN_CONTRIBUTION`, оплачуються за
 * **найнижчою** ціною серед таких мовчазних датасетів, а гроші йдуть решті
 * власників пулу.
 */
const MIN_CONTRIBUTION = 10

function settle(pool: { price: bigint; claimed: bigint; included: bigint }[]): bigint {
  const silent = pool.filter((entry) => entry.included < BigInt(MIN_CONTRIBUTION))
  const disclosed = pool.filter((entry) => entry.included >= BigInt(MIN_CONTRIBUTION))

  const named = disclosed.reduce(
    (sum, entry) => sum + datasetUpperBound(price(entry.price), entry.included),
    0n,
  )

  if (silent.length === 0) return named

  const remainder = silent.reduce((sum, entry) => sum + entry.included, 0n)
  const lowest = silent.reduce(
    (min, entry) => (entry.price < min ? entry.price : min),
    silent[0]?.price ?? 0n,
  )
  return named + datasetUpperBound(price(lowest), remainder)
}

function bound(pool: { price: bigint; claimed: bigint }[]): bigint {
  return poolUpperBound(pool.map((entry) => datasetUpperBound(price(entry.price), entry.claimed)))
}

describe('рахунок ніколи не перевищує межу', () => {
  it('коли всі датасети оголосили внесок', () => {
    const pool = [
      { price: 1_000n, claimed: 5_000n, included: 4_000n },
      { price: 9_000n, claimed: 1_000n, included: 1_000n },
    ]
    expect(settle(pool)).toBeLessThanOrEqual(bound(pool))
  })

  it('коли дешевий датасет мовчить поруч із дорогим', () => {
    // Саме цей випадок ламає «середню ціну пулу»: за середньою залишок
    // мовчазного датасету коштував би 9 одиниць проти 0,009 у межі.
    const pool = [
      { price: 1n, claimed: 9n, included: 9n },
      { price: 1_000_000n, claimed: 1_000n, included: 1_000n },
    ]
    expect(settle(pool)).toBeLessThanOrEqual(bound(pool))
  })

  it('коли мовчать кілька датасетів із різними цінами', () => {
    const pool = [
      { price: 1n, claimed: 1_000n, included: 9n },
      { price: 1_000_000n, claimed: 9n, included: 9n },
      { price: 5_000n, claimed: 500n, included: 500n },
    ]
    expect(settle(pool)).toBeLessThanOrEqual(bound(pool))
  })

  it('коли мовчать усі — пул із п’ятдесяти по дев’ять записів', () => {
    // Той самий пул, яким покупець отримав би 450 записів безкоштовно, якби за
    // придушений внесок ніхто не платив.
    const pool = Array.from({ length: MAX_RUN_DATASETS }, (_unused, index) => ({
      price: BigInt(1_000 + index * 37),
      claimed: 9n,
      included: 9n,
    }))
    const cost = settle(pool)
    expect(cost).toBeGreaterThan(0n)
    expect(cost).toBeLessThanOrEqual(bound(pool))
  })

  it('на випадкових пулах', () => {
    // Детермінований генератор: тест, що падає раз на сто прогонів, не
    // доводить нічого й не відтворюється.
    let seed = 0x5eed
    const next = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff
      return seed % limit
    }

    for (let trial = 0; trial < 500; trial += 1) {
      const pool = Array.from({ length: 1 + next(MAX_RUN_DATASETS) }, () => {
        const claimed = BigInt(next(2_000))
        return {
          price: BigInt(next(2_000_000)),
          claimed,
          included: claimed === 0n ? 0n : BigInt(next(Number(claimed) + 1)),
        }
      })
      expect(settle(pool)).toBeLessThanOrEqual(bound(pool))
    }
  })
})

describe('форма запиту квоти', () => {
  const request = {
    recipeId: 1,
    useType: 'oncology',
    buyerCategory: 'academic',
    datasets: [{ owner: OWNER, datasetId: 'cohort-alpha' }],
    params: {},
  }

  it('приймає повний запит', () => {
    expect(runQuoteRequestSchema.parse(request).datasets).toHaveLength(1)
  })

  it('вимагає щонайменше один датасет', () => {
    expect(() => runQuoteRequestSchema.parse({ ...request, datasets: [] })).toThrow()
  })

  it('відхиляє пул, довший за той, що приймає програма', () => {
    const datasets = Array.from({ length: MAX_RUN_DATASETS + 1 }, (_unused, index) => ({
      owner: OWNER,
      datasetId: `cohort-${index.toString().padStart(3, '0')}`,
    }))
    expect(() => runQuoteRequestSchema.parse({ ...request, datasets })).toThrow()
  })

  it('вимагає тип використання й категорію покупця', () => {
    // Без них не перевірити згоду, а квота без перевірки згоди — це ціна
    // прогону, який буде відхилено.
    const { useType: _unused, ...withoutUse } = request
    expect(() => runQuoteRequestSchema.parse(withoutUse)).toThrow()
    expect(() => runQuoteRequestSchema.parse({ ...request, buyerCategory: 'startup' })).toThrow()
  })

  it('відхиляє поле, якого в запиті не буває', () => {
    expect(() => runQuoteRequestSchema.parse({ ...request, escrow: '1' })).toThrow()
  })
})

describe('рядок квоти', () => {
  const identity = {
    owner: OWNER,
    datasetId: 'cohort-alpha',
    datasetAddress: OTHER,
  }

  it('придатний рядок несе числа', () => {
    const line = quoteLineSchema.parse({
      ...identity,
      eligible: true,
      pricePer1k: '1500000',
      recordCountClaimed: '10000',
      upperBound: '15000000',
    })
    expect(line.eligible).toBe(true)
  })

  it('непридатний рядок несе причину і не несе цін', () => {
    // Форма з обома полями дозволила б відповідь «непридатний, але ось
    // вартість», якої не буває, і в сумі перестало б сходитись.
    expect(() =>
      quoteLineSchema.parse({ ...identity, eligible: false, reason: 'revoked', upperBound: '1' }),
    ).toThrow()
    expect(() =>
      quoteLineSchema.parse({ ...identity, eligible: true, reason: 'revoked' }),
    ).toThrow()
  })

  it('причини перелічені, а не довільний текст', () => {
    expect(() =>
      quoteLineSchema.parse({ ...identity, eligible: false, reason: 'щось пішло не так' }),
    ).toThrow()
    expect(QUOTE_INELIGIBLE_REASONS).toContain('ciphertext-missing')
    expect(QUOTE_INELIGIBLE_REASONS).toContain('use-forbidden')
  })

  it('суми їдуть рядками, не числами', () => {
    // u64 через `JSON.parse` як число мовчки округлюється після 2^53.
    expect(() =>
      quoteLineSchema.parse({
        ...identity,
        eligible: true,
        pricePer1k: 1_500_000,
        recordCountClaimed: '10000',
        upperBound: '15000000',
      }),
    ).toThrow()
  })
})
