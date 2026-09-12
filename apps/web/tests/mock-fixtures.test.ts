import { datasetCardSchema, runQuoteSchema, runViewSchema } from '@genovault/shared'
import { describe, expect, it } from 'vitest'
import { mockCard, mockQuote, mockRunView } from '../src/lib/runData.ts'
import { DATASETS, RUN_STATUS_ORDER, RUNS } from '../src/mockData.ts'

/**
 * Мок як фікстура за контрактом (`T029`).
 *
 * До `T029` `mockData` був другим словником: екрани говорили його формою, API —
 * формою `packages/shared`, і розійтись їм було ніде, бо вони ніде не
 * зустрічались. Тепер мок проходить **ті самі схеми**, якими відповідає сервер,
 * і цей файл — місце, де розбіжність падає.
 *
 * Так знайшлися три адреси власників прототипу, яких у base58 не буває: два
 * рядки мали символи поза алфавітом (`I`, `l`), третій декодувався в 31 байт.
 * На екрані вони виглядали як адреси й ніде не заважали — доти, доки не
 * поїхали б у `POST /runs/quote`.
 */

describe('датасети прототипу', () => {
  it('кожен проходить схему картки каталогу', () => {
    for (const dataset of DATASETS) {
      expect(datasetCardSchema.safeParse(mockCard(dataset)).success).toBe(true)
    }
  })

  it('адреса кожного власника — справжня адреса Solana', () => {
    // Не формальність: саме ця перевірка й спіймала три неможливі адреси.
    for (const dataset of DATASETS) {
      expect(mockCard(dataset).owner).toBe(dataset.owner)
    }
  })
})

describe('квота прототипу', () => {
  it('проходить схему `POST /runs/quote`', () => {
    const quote = mockQuote(
      DATASETS,
      'oncology',
      'academic',
      { minAge: 40, maxAge: 70, sex: 'any', affected: 'any' },
      false,
    )

    expect(runQuoteSchema.safeParse(quote).success).toBe(true)
    expect(quote.datasets).toHaveLength(DATASETS.length)
  })

  it('непридатний рядок не несе жодного числа', () => {
    // Спільна форма дозволяла б відповідь «непридатний, але ось вартість»,
    // якої не буває.
    const quote = mockQuote(
      DATASETS,
      'pharmaCommercial',
      'commercial',
      { minAge: 0, maxAge: 255, sex: 'any', affected: 'any' },
      false,
    )

    for (const line of quote.datasets) {
      if (line.eligible) expect(line.upperBound).toMatch(/^\d+$/)
      else expect(Object.keys(line)).not.toContain('upperBound')
    }
  })

  it('сума — це сума придатних рядків, і нічого більше', () => {
    const quote = mockQuote(
      DATASETS,
      'oncology',
      'academic',
      { minAge: 0, maxAge: 255, sex: 'any', affected: 'any' },
      false,
    )
    const sum = quote.datasets.reduce(
      (total, line) => (line.eligible ? total + BigInt(line.upperBound) : total),
      0n,
    )

    expect(quote.upperBound).toBe(sum.toString())
    expect(quote.eligibleCount).toBe(quote.datasets.filter((line) => line.eligible).length)
  })

  it('пауза платформи знімає замовлення, не ламаючи ціну', () => {
    // Питання «скільки коштує» має відповідь навіть тоді, коли замовити не можна.
    const paused = mockQuote(
      DATASETS,
      'oncology',
      'academic',
      { minAge: 0, maxAge: 255, sex: 'any', affected: 'any' },
      true,
    )

    expect(paused.orderable).toBe(false)
    expect(paused.blocker).toBe('platform-paused')
    expect(BigInt(paused.upperBound)).toBeGreaterThan(0n)
  })
})

describe('прогони прототипу', () => {
  it('усі п’ять станів проходять схему `GET /runs/:buyer/:nonce`', () => {
    for (const status of RUN_STATUS_ORDER) {
      const view = mockRunView(RUNS[status])
      expect(runViewSchema.safeParse(view).success).toBe(true)
      expect(view.status).toBe(status)
    }
  })

  it('доки звіту немає, його немає і у відповіді', () => {
    expect(mockRunView(RUNS.accepted).resultHash).toBeNull()
    expect(mockRunView(RUNS.completed).resultHash).not.toBeNull()
  })
})
