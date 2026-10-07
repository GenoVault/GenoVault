import {
  datasetCardSchema,
  datasetDetailSchema,
  datasetListSchema,
  runQuoteSchema,
  runViewSchema,
} from '@genovault/shared'
import { describe, expect, it } from 'vitest'
import { type CatalogFilters, mockDatasetList, mockDetail } from '../src/lib/catalogData.ts'
import { dateToExpirySeconds, expiryToDate, termsFromView } from '../src/lib/consentTerms.ts'
import { mockCard, mockQuote, mockRunView } from '../src/lib/runData.ts'
import { BASE_RECORD_SCHEMA, DATASETS, RUN_STATUS_ORDER, RUNS } from '../src/mockData.ts'

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

describe('dataset cards of the prototype (T065)', () => {
  it('every dataset passes the `GET /datasets/:owner/:id` schema in each chain state', () => {
    for (const dataset of DATASETS) {
      for (const preview of ['registered', 'unregistered', 'unavailable'] as const) {
        const detail = mockDetail(dataset, preview)
        expect(datasetDetailSchema.safeParse(detail).success).toBe(true)
        expect(detail.chain.state).toBe(preview)
      }
    }
  })

  it('the schema lists every field, markers last', () => {
    for (const dataset of DATASETS) {
      const detail = mockDetail(dataset)
      expect(detail.schema).toHaveLength(BASE_RECORD_SCHEMA.length + dataset.markers)
      expect(detail.schema.at(-1)?.field).toBe(`marker${String(dataset.markers).padStart(4, '0')}`)
    }
  })

  it('consent survives the trip to bit masks and back by name', () => {
    for (const dataset of DATASETS) {
      const chain = mockDetail(dataset).chain
      if (chain.state !== 'registered' || chain.consent === null || dataset.consent === null) {
        continue
      }
      const terms = termsFromView(chain.consent)
      expect(terms.allowedUses.toSorted()).toEqual(dataset.consent.allowedUseTypes.toSorted())
      expect(terms.forbiddenUses.toSorted()).toEqual(dataset.consent.forbiddenUseTypes.toSorted())
      expect(terms.buyerCategories.toSorted()).toEqual(dataset.consent.buyerCategories.toSorted())
      // The owner chose "until this day" and reads the same day back.
      expect(terms.expiresAt).toBe(dataset.consent.expiresAt)
      expect(terms.revoked).toBe(dataset.consent.revoked)
    }
  })

  it('an expiry date means the whole of that day', () => {
    const seconds = Number(dateToExpirySeconds('2027-12-31'))
    expect(new Date((seconds - 1) * 1000).toISOString()).toBe('2027-12-31T23:59:59.000Z')
    expect(new Date(seconds * 1000).toISOString()).toBe('2028-01-01T00:00:00.000Z')
    expect(expiryToDate(String(seconds))).toBe('2027-12-31')
  })

  it('no owner name reaches a card — an owner is an address', () => {
    for (const dataset of DATASETS) {
      expect(Object.keys(mockDetail(dataset))).not.toContain('ownerName')
    }
  })
})

describe('catalog of the prototype (T065)', () => {
  const ALL: CatalogFilters = { q: '', source: null, minRecords: null, maxPricePer1k: null }

  it('passes the `GET /datasets` schema and counts everything it filtered', () => {
    const list = mockDatasetList(ALL)
    expect(datasetListSchema.safeParse(list).success).toBe(true)
    expect(list.total).toBe(DATASETS.length)
  })

  it('filters as the API does', () => {
    // Case-insensitive, over the title and the description both.
    expect(mockDatasetList({ ...ALL, q: 'CARDIO' }).items.map((d) => d.datasetId)).toEqual([
      'meridian-cardio-04',
      'sundry-onco-11',
    ])
    expect(mockDatasetList({ ...ALL, minRecords: 12_000 }).items.map((d) => d.datasetId)).toEqual([
      'nordveil-exome-01',
      'keldan-pop-07',
    ])
    // 4.00 stable units per thousand, in base units: the bound is inclusive.
    const cheap = mockDatasetList({ ...ALL, maxPricePer1k: '4000000' }).items
    expect(cheap.every((d) => BigInt(d.pricePer1k) <= 4_000_000n)).toBe(true)
    expect(cheap.map((d) => d.datasetId)).toContain('nordveil-exome-01')
    expect(mockDatasetList({ ...ALL, source: 'clinic' }).total).toBe(0)
  })
})
