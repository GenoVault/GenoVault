import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  datasetMetadataSchema,
  MAX_MARKERS,
  MIN_COHORT,
  registerDatasetRequestSchema,
} from '../src/dataset-metadata.ts'

const MARKERS = 4

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Когорта альфа',
    description: 'Синтетична когорта для перевірок.',
    schema: [
      { field: 'sex', type: 'integer', description: '0 — жіноча, 1 — чоловіча' },
      { field: 'age', type: 'integer', description: 'Повних років' },
      { field: 'affected', type: 'integer', description: 'Наявність фенотипу' },
    ],
    recordCount: 120,
    markerCount: MARKERS,
    statistics: {
      affectedRate: 0.24,
      meanAge: 47.5,
      alleleFrequencies: [0.25, 0.31, 0.12, 0.4],
    },
    provenance: {
      source: 'synthetic',
      collectedFrom: '2024-01-01',
      collectedTo: '2024-06-30',
    },
    ...overrides,
  }
}

describe('datasetMetadataSchema', () => {
  it('приймає повний опис', () => {
    const parsed = datasetMetadataSchema.parse(metadata())
    expect(parsed.markerCount).toBe(MARKERS)
    expect(parsed.statistics?.alleleFrequencies).toHaveLength(MARKERS)
  })

  it('відхиляє поле, якого немає у схемі', () => {
    // strictObject, а не passthrough: зайве поле в описі каталогу — це або
    // друкарська помилка, або спроба провезти щось, чого схема не називає.
    expect(() => datasetMetadataSchema.parse(metadata({ subjectIds: ['a', 'b'] }))).toThrow()
  })

  it('вимагає по одній частоті на маркер', () => {
    const broken = metadata({
      statistics: { affectedRate: 0.2, meanAge: 40, alleleFrequencies: [0.1, 0.2] },
    })
    expect(() => datasetMetadataSchema.parse(broken)).toThrow(/по одній на маркер/)
  })

  it('не приймає більше маркерів, ніж уміє рецепт', () => {
    const tooMany = metadata({
      markerCount: MAX_MARKERS + 1,
      statistics: {
        affectedRate: 0.2,
        meanAge: 40,
        alleleFrequencies: Array.from({ length: MAX_MARKERS + 1 }, () => 0.2),
      },
    })
    expect(() => datasetMetadataSchema.parse(tooMany)).toThrow()
  })

  describe('поріг когорти для статистики', () => {
    it('відхиляє статистику на когорті, меншій за MIN_COHORT', () => {
      // На одному записі «частка уражених» — це діагноз конкретної людини, а
      // «середній вік» — її вік. Агрегатом вони бути перестають.
      const single = metadata({ recordCount: 1 })
      expect(() => datasetMetadataSchema.parse(single)).toThrow(/описує окрему людину/)
    })

    it('приймає датасет на один запис без статистики', () => {
      // `FR-009`: окрема особа — повноцінний власник зі своїм датасетом на
      // одну людину. Поріг когорти закриває статистику, а не реєстрацію.
      const { statistics: _dropped, ...rest } = metadata({ recordCount: 1 })
      expect(datasetMetadataSchema.parse(rest).recordCount).toBe(1)
    })

    it('вимагає статистику від MIN_COHORT записів', () => {
      const { statistics: _dropped, ...rest } = metadata({ recordCount: MIN_COHORT })
      expect(() => datasetMetadataSchema.parse(rest)).toThrow(/агрегований опис/)
    })
  })

  it('відхиляє вікно збору, що закінчується раніше початку', () => {
    const backwards = metadata({
      provenance: { source: 'biobank', collectedFrom: '2024-06-30', collectedTo: '2024-01-01' },
    })
    expect(() => datasetMetadataSchema.parse(backwards)).toThrow(/закінчується раніше/)
  })

  it('не падає винятком, коли зламано і поле, і крос-перевірка', () => {
    // Zod 4 проганяє всі перевірки після невдалої, тому крос-перевірки
    // отримують значення, які не пройшли власних. Тут має бути помилка
    // валідації, а не TypeError десь усередині.
    const broken = metadata({ markerCount: 'чотири', recordCount: -1 })
    const result = datasetMetadataSchema.safeParse(broken)
    expect(result.success).toBe(false)
  })
})

describe('registerDatasetRequestSchema', () => {
  const request = {
    datasetId: 'cohort-alpha',
    owner: '11111111111111111111111111111112',
    contentHash: 'a'.repeat(64),
    pricePer1k: '1500000',
    metadata: metadata(),
  }

  it('приймає заявку власника і зводить ціну до bigint', () => {
    const parsed = registerDatasetRequestSchema.parse(request)
    expect(parsed.pricePer1k).toBe(1_500_000n)
    expect(parsed.datasetId).toBe('cohort-alpha')
  })

  it('не має окремої заявленої кількості записів', () => {
    // Два числа про одне давали б змогу написати в каталозі одне, а в ланцюг
    // відправити інше — саме тому `recordCountClaimed` тут немає.
    expect(() =>
      registerDatasetRequestSchema.parse({ ...request, recordCountClaimed: 999 }),
    ).toThrow()
  })

  it('відхиляє адресу, що декодується не в 32 байти', () => {
    expect(() => registerDatasetRequestSchema.parse({ ...request, owner: 'abc' })).toThrow()
  })
})

describe('дзеркала констант рецепта', () => {
  const circuit = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../encrypted-ixs/src/lib.rs'),
    'utf8',
  )

  it('MIN_COHORT збігається з контуром', () => {
    // Rust і TypeScript не мають спільного місця для констант, а вивести їх з
    // IDL не можна — вони живуть у контурі, не в програмі. Тому дзеркало
    // звіряється з текстом рецепта, а не тримається на уважності.
    expect(circuit).toMatch(new RegExp(`MIN_COHORT:\\s*u32\\s*=\\s*${MIN_COHORT};`))
  })

  it('MAX_MARKERS збігається з профілем контуру', () => {
    expect(circuit).toMatch(new RegExp(`MARKERS:\\s*usize\\s*=\\s*${MAX_MARKERS};`))
  })
})
