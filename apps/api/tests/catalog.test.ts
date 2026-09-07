import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { contentHashSchema, datasetIdSchema, solanaAddressSchema } from '@genovault/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import {
  CatalogError,
  type CatalogStore,
  catalogConfigFromEnv,
  createCatalog,
  type DatasetRecord,
  fsCatalog,
  memoryCatalog,
  now,
  selectDatasets,
} from '../src/services/catalog.ts'

// Бренди, а не рядки: те саме звуження, крізь яке значення проходять у бою.
const OWNER = solanaAddressSchema.parse('11111111111111111111111111111112')
const OTHER_OWNER = solanaAddressSchema.parse('SysvarC1ock11111111111111111111111111111111')
const DATASET_ID = datasetIdSchema.parse('cohort-alpha')
const USER = 'did:privy:clx0000000000000000000000'

function record(overrides: Partial<DatasetRecord> = {}): DatasetRecord {
  const timestamp = now()
  return {
    datasetId: DATASET_ID,
    owner: OWNER,
    registeredBy: USER,
    contentHash: contentHashSchema.parse('a'.repeat(64)),
    pricePer1k: 1_500_000n,
    metadata: {
      title: 'Когорта альфа',
      description: 'Синтетична когорта для перевірок.',
      schema: [{ field: 'age', type: 'integer', description: 'Повних років' }],
      recordCount: 120,
      markerCount: 2,
      statistics: { affectedRate: 0.2, meanAge: 44, alleleFrequencies: [0.25, 0.3] },
      provenance: { source: 'synthetic', collectedFrom: '2024-01-01', collectedTo: '2024-06-30' },
    },
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  } as DatasetRecord
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'genovault-catalog-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/**
 * Обидва драйвери перевіряються тими самими твердженнями.
 *
 * Різні набори тестів на драйвери одного інтерфейсу — це найкоротший шлях до
 * розбіжної поведінки: `memory` живе в тестах, `fs` — у розробці, і помітити
 * різницю нічим. Коли з'явиться драйвер `postgres` (`T004`), він стане третім
 * рядком цього ж списку.
 */
describe.each([
  ['memory', () => memoryCatalog()],
  ['fs', () => fsCatalog(root)],
] as const)('драйвер каталогу %s', (_kind, make) => {
  let store: CatalogStore

  beforeEach(() => {
    store = make()
  })

  it('віддає нічого про невідому сесію й невідомий датасет', async () => {
    expect(await store.ownerOf(USER)).toBeUndefined()
    expect(await store.getDataset(OWNER, DATASET_ID)).toBeUndefined()
  })

  it('прив’язує сесію до адреси при першій реєстрації', async () => {
    expect(await store.bindOwner(USER, OWNER)).toBe(OWNER)
    expect(await store.ownerOf(USER)).toBe(OWNER)
  })

  it('на другій адресі повертає першу, а не переприв’язує', async () => {
    await store.bindOwner(USER, OWNER)
    expect(await store.bindOwner(USER, OTHER_OWNER)).toBe(OWNER)
    expect(await store.ownerOf(USER)).toBe(OWNER)
  })

  it('повтор тієї самої прив’язки не є подією', async () => {
    await store.bindOwner(USER, OWNER)
    expect(await store.bindOwner(USER, OWNER)).toBe(OWNER)
  })

  it('кладе й віддає рядок каталогу без втрати точності ціни', async () => {
    // u64 близько до межі: `number` тут округлив би, і це була б недоплата
    // власнику, яка не падає.
    const huge = record({ pricePer1k: 18_446_744_073_709_551_615n as DatasetRecord['pricePer1k'] })
    await store.putDataset(huge)

    const loaded = await store.getDataset(OWNER, DATASET_ID)
    expect(loaded?.pricePer1k).toBe(18_446_744_073_709_551_615n)
    expect(loaded?.metadata.title).toBe('Когорта альфа')
  })

  it('розводить датасети з однаковим ідентифікатором у різних власників', async () => {
    // Ідентифікатор унікальний у межах власника, бо таким його робить PDA:
    // seeds — `["dataset", owner, dataset_id]`.
    await store.putDataset(record())
    await store.putDataset(
      record({ owner: OTHER_OWNER, contentHash: contentHashSchema.parse('b'.repeat(64)) }),
    )

    expect((await store.getDataset(OWNER, DATASET_ID))?.contentHash).toBe('a'.repeat(64))
    expect((await store.getDataset(OTHER_OWNER, DATASET_ID))?.contentHash).toBe('b'.repeat(64))
  })

  it('не приймає рядок, що не проходить власну схему', async () => {
    await expect(
      store.putDataset(record({ contentHash: 'коротко' as DatasetRecord['contentHash'] })),
    ).rejects.toThrow(ZodError)
  })
  it('перелічує покладене й фільтрує за власником', async () => {
    // Перелік у fs-драйвері обходить теки на диску, у memory — Map. Обидва
    // мають дати те саме, інакше `T021` поводиться по-різному в тестах і в
    // розробці, а помітити це нічим.
    await store.putDataset(record())
    await store.putDataset(
      record({ owner: OTHER_OWNER, datasetId: datasetIdSchema.parse('cohort-beta') }),
    )

    const all = await store.listDatasets({ includePending: true, limit: 10, offset: 0 })
    expect(all.total).toBe(2)

    const mine = await store.listDatasets({
      owner: OWNER,
      includePending: true,
      limit: 10,
      offset: 0,
    })
    expect(mine.items.map((item) => item.datasetId)).toEqual(['cohort-alpha'])
  })

  it('віддає порожній перелік, поки нічого не покладено', async () => {
    // У fs-драйвері теки просто немає — це не збій, а перший запуск.
    expect(await store.listDatasets({ includePending: true, limit: 10, offset: 0 })).toEqual({
      items: [],
      total: 0,
    })
  })
})

describe('fsCatalog', () => {
  it('не пише прив’язку в ім’я файлу з двокрапками', async () => {
    // DID виду `did:privy:<id>` містить двокрапки, а вони заборонені в іменах
    // файлів на Windows — розробка тут іде саме на ньому.
    const store = fsCatalog(root)
    await store.bindOwner(USER, OWNER)

    const path = join(root, 'owners', 'clx0000000000000000000000.json')
    expect(JSON.parse(await readFile(path, 'utf8')).owner).toBe(OWNER)
  })

  it('перевіряє рядок із диска так само, як рядок із мережі', async () => {
    // Файл могли покласти міграцією або відновленням із копії. Довіряти диску
    // більше, ніж мережі, підстав немає.
    const store = fsCatalog(root)
    await store.putDataset(record())
    await writeFile(
      join(root, 'datasets', OWNER, 'cohort-alpha.json'),
      JSON.stringify({ datasetId: 'cohort-alpha', owner: OWNER }),
    )

    await expect(store.getDataset(OWNER, DATASET_ID)).rejects.toThrow(CatalogError)
  })

  it('відхиляє ідентифікатор, що веде за межі кореня', async () => {
    const store = fsCatalog(root)
    await expect(
      store.getDataset(OWNER, '../../etc/passwd' as DatasetRecord['datasetId']),
    ).rejects.toThrow(CatalogError)
  })
})

describe('catalogConfigFromEnv', () => {
  it('типово бере fs і вимагає кореня', () => {
    expect(catalogConfigFromEnv({ CATALOG_FS_ROOT: './var/catalog' })).toEqual({
      driver: 'fs',
      root: './var/catalog',
    })
    expect(() => catalogConfigFromEnv({})).toThrow(ZodError)
  })

  it('бере memory на явну вимогу', () => {
    expect(createCatalog(catalogConfigFromEnv({ CATALOG_DRIVER: 'memory' })).kind).toBe('memory')
  })
})

/**
 * Порядок і посторінковість перевіряються тут, а не крізь HTTP.
 *
 * `createdAt` має роздільність у мілісекунду, і три послідовні реєстрації
 * через маршрут регулярно потрапляють в одну й ту саму мітку. Тест, який
 * покладається на те, що не потрапили, зеленіє випадково.
 */
describe('selectDatasets', () => {
  const base = { includePending: true, limit: 10, offset: 0 }

  function at(datasetId: string, createdAt: string, over: Partial<DatasetRecord> = {}) {
    return record({
      datasetId: datasetIdSchema.parse(datasetId),
      createdAt,
      updatedAt: createdAt,
      ...over,
    })
  }

  it('віддає найновіші першими', () => {
    const page = selectDatasets(
      [
        at('cohort-alpha', '2026-09-01T00:00:00.000Z'),
        at('cohort-gamma', '2026-09-03T00:00:00.000Z'),
        at('cohort-beta', '2026-09-02T00:00:00.000Z'),
      ],
      base,
    )
    expect(page.items.map((item) => item.datasetId)).toEqual([
      'cohort-gamma',
      'cohort-beta',
      'cohort-alpha',
    ])
  })

  it('за однакової мітки часу впорядковує за ідентифікатором', () => {
    // Без другого ключа порядок залежить від драйвера, і посторінковість
    // починає губити або двоїти рядки між сусідніми сторінками.
    const same = '2026-09-07T12:00:00.000Z'
    const page = selectDatasets([at('cohort-beta', same), at('cohort-alpha', same)], base)
    expect(page.items.map((item) => item.datasetId)).toEqual(['cohort-alpha', 'cohort-beta'])
  })

  it('ріже сторінку, але рахує total до різання', () => {
    const records = ['a', 'b', 'c', 'd'].map((letter, index) =>
      at(`cohort-${letter}${letter}${letter}`, `2026-09-0${index + 1}T00:00:00.000Z`),
    )
    const page = selectDatasets(records, { ...base, limit: 2, offset: 1 })

    expect(page.total).toBe(4)
    expect(page.items.map((item) => item.datasetId)).toEqual(['cohort-ccc', 'cohort-bbb'])
  })

  it('без includePending лишає тільки залиті', () => {
    const records = [
      at('cohort-alpha', '2026-09-01T00:00:00.000Z', { status: 'stored' }),
      at('cohort-beta', '2026-09-02T00:00:00.000Z', { status: 'pending' }),
    ]
    const page = selectDatasets(records, { ...base, includePending: false })
    expect(page.items.map((item) => item.datasetId)).toEqual(['cohort-alpha'])
  })

  it('стеля ціни включна', () => {
    const records = [
      at('cohort-alpha', '2026-09-01T00:00:00.000Z', {
        pricePer1k: 1_000n as DatasetRecord['pricePer1k'],
      }),
      at('cohort-beta', '2026-09-02T00:00:00.000Z', {
        pricePer1k: 1_001n as DatasetRecord['pricePer1k'],
      }),
    ]
    const page = selectDatasets(records, {
      ...base,
      maxPricePer1k: 1_000n,
    })
    expect(page.items.map((item) => item.datasetId)).toEqual(['cohort-alpha'])
  })

  it('пошук іде і назвою, і описом', () => {
    const records = [
      at('cohort-alpha', '2026-09-01T00:00:00.000Z'),
      at('cohort-beta', '2026-09-02T00:00:00.000Z', {
        metadata: { ...record().metadata, description: 'Рідкісні хвороби, дитяча вибірка.' },
      }),
    ]
    expect(selectDatasets(records, { ...base, q: 'рідкісні' }).items).toHaveLength(1)
    expect(selectDatasets(records, { ...base, q: 'когорта альфа' }).items).toHaveLength(2)
  })
})
