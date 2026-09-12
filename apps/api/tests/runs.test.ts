import {
  apiErrorSchema,
  BUYER_CATEGORIES,
  contentHash,
  type DatasetId,
  datasetIdSchema,
  LIMB_BYTES,
  MAX_RUN_DATASETS,
  NONCE_BYTES,
  pricePer1kSchema,
  runQuoteSchema,
  SCALAR_FIELD_COUNT,
  serializeEnvelope,
  solanaAddressSchema,
  USE_TYPES,
  X25519_KEY_BYTES,
} from '@genovault/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { AuthError, type TokenVerifier } from '../src/services/auth.ts'
import { type CatalogStore, memoryCatalog } from '../src/services/catalog.ts'
import {
  ChainStateError,
  createRegistrationBuilder,
  deriveDatasetAddress,
  type QuoteChainState,
  type QuoteDatasetState,
} from '../src/services/chain.ts'
import type { StorageDriver } from '../src/services/storage.ts'

/**
 * `POST /runs/quote` — верхня оцінка вартості (`T023`, `FR-015a`).
 *
 * Стан ланцюга тут підставний з тієї ж причини, що й у тестах каталогу: живий
 * читач вимагав би піднятого валідатора з розгорнутою програмою, тобто
 * перетворив би юніт-тест маршруту на інтеграційний, який мовчки зеленіє, коли
 * валідатора немає. Те, що читач справді читає з мережі, доводить не цей файл.
 */

const OWNER = solanaAddressSchema.parse('11111111111111111111111111111112')
const MINT = solanaAddressSchema.parse('SysvarC1ock11111111111111111111111111111111')
const USER = 'did:privy:clx0000000000000000000000'
const ALPHA = datasetIdSchema.parse('cohort-alpha')
const BETA = datasetIdSchema.parse('cohort-beta')
const RECORDS = 12
const MARKERS = 4
const PRICE = pricePer1kSchema.parse(1_500_000n)
const NOW = 1_735_689_600n

const verify: TokenVerifier = async (token) => {
  if (token !== 'good') throw new AuthError('токен не той')
  return { userId: USER, sessionId: 'sid-1', expiresAt: new Date(Date.now() + 60_000) }
}

const auth = { authorization: 'Bearer good' }

function envelope(records = RECORDS, markers = MARKERS): Uint8Array {
  const fieldsPerRecord = SCALAR_FIELD_COUNT + markers
  const frames = Array.from({ length: records }, (_unused, index) => {
    const nonce = new Uint8Array(NONCE_BYTES)
    new DataView(nonce.buffer).setUint32(0, index + 1, true)
    return {
      nonce,
      limbs: Array.from({ length: fieldsPerRecord }, (_ignored, field) => {
        const limb = new Array<number>(LIMB_BYTES).fill(0)
        limb[0] = (field + index) % 251
        return limb
      }),
    }
  })

  return serializeEnvelope(
    {
      mxePublicKey: new Uint8Array(X25519_KEY_BYTES).fill(7),
      ephemeralPublicKey: new Uint8Array(X25519_KEY_BYTES).fill(9),
      recordCount: records,
      markerCount: markers,
      fieldsPerRecord,
    },
    frames,
  )
}

function memoryStorage(): StorageDriver {
  const objects = new Map<string, Uint8Array>()
  return {
    kind: 'fs',
    async put(key, bytes) {
      objects.set(key, bytes)
    },
    async get(key) {
      const bytes = objects.get(key)
      if (bytes === undefined) throw new Error(`немає ${key}`)
      return bytes
    },
    async exists(key) {
      return objects.has(key)
    },
  }
}

/** Згода за замовчуванням — щоб не тягнути `!` там, де вона точно є. */
const CONSENT = {
  allowedUses: USE_TYPES.oncology | USE_TYPES.rareDisease,
  forbiddenUses: 0,
  buyerCategories: BUYER_CATEGORIES.academic,
  expiresAt: null,
  revoked: false,
} as const

/** Чинна версія згоди у фікстурах. Ненульова: нуль означав би «згоди немає». */
const CONSENT_VERSION = 2

/** Датасет у мережі: активний, зі згодою на онкологію для академічного покупця. */
function chainDataset(
  datasetId: DatasetId,
  patch: Partial<QuoteDatasetState> = {},
): QuoteDatasetState {
  return {
    datasetAddress: deriveDatasetAddress(OWNER, datasetId),
    dataset: {
      status: 'active',
      recordCountClaimed: BigInt(RECORDS),
      pricePer1k: PRICE,
      consentVersion: CONSENT_VERSION,
    },
    consent: { ...CONSENT },
    ...patch,
  }
}

function chainState(datasets: QuoteDatasetState[], patch: Partial<QuoteChainState> = {}) {
  return { feeBps: 700, mint: MINT, paused: false, now: NOW, datasets, ...patch }
}

const readQuoteChain = vi.fn(
  async (_refs: unknown): Promise<QuoteChainState> => chainState([chainDataset(ALPHA)]),
)

let catalog: CatalogStore
let app: ReturnType<typeof createApp>

beforeEach(() => {
  catalog = memoryCatalog()
  readQuoteChain.mockReset()
  readQuoteChain.mockImplementation(async () => chainState([chainDataset(ALPHA)]))
  app = createApp({
    verifyAccessToken: verify,
    catalog,
    storage: memoryStorage(),
    buildRegistration: createRegistrationBuilder('http://127.0.0.1:8899'),
    readChain: vi.fn(async () => ({ state: 'unregistered' }) as const),
    readQuoteChain,
    baseUrl: 'http://127.0.0.1:8879',
  })
})

/** Заводить датасет так, як це робить власник: метадані, потім байти. */
async function store(datasetId: DatasetId, records = RECORDS): Promise<void> {
  const bytes = envelope(records)
  await app.request('/datasets', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      datasetId,
      owner: OWNER,
      contentHash: await contentHash(bytes),
      pricePer1k: PRICE.toString(),
      metadata: {
        title: 'Когорта',
        description: 'Синтетична когорта для перевірок.',
        schema: [{ field: 'age', type: 'integer', description: 'Повних років' }],
        recordCount: records,
        markerCount: MARKERS,
        statistics: { affectedRate: 0.25, meanAge: 44, alleleFrequencies: [0.2, 0.3, 0.25, 0.4] },
        provenance: { source: 'synthetic', collectedFrom: '2024-01-01', collectedTo: '2024-06-30' },
      },
    }),
  })
  await app.request(`/datasets/${datasetId}/ciphertext`, {
    method: 'PUT',
    headers: auth,
    body: bytes,
  })
}

async function quote(body: Record<string, unknown>): Promise<Response> {
  return app.request('/runs/quote', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function request(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recipeId: 1,
    useType: 'oncology',
    buyerCategory: 'academic',
    datasets: [{ owner: OWNER, datasetId: ALPHA }],
    params: {},
    ...overrides,
  }
}

async function failure(response: Response) {
  return apiErrorSchema.parse(await response.json()).error
}

describe('квота рахує вартість', () => {
  beforeEach(async () => {
    await store(ALPHA)
  })

  it('віддає межу за заявленим обсягом і ончейн-ціною', async () => {
    const response = await quote(request())
    expect(response.status).toBe(200)

    const body = runQuoteSchema.parse(await response.json())
    // 12 записів × 1 500 000 за тисячу = 18 000 із заокругленням угору.
    expect(body.upperBound).toBe('18000')
    expect(body.eligibleCount).toBe(1)
    expect(body.orderable).toBe(true)
    expect(body.blocker).toBeNull()
  })

  it('називає рецепт, комісію і валюту', async () => {
    // `FR-019`: розмір комісії публічний і фіксований на момент замовлення.
    const body = runQuoteSchema.parse(await (await quote(request())).json())
    expect(body.recipe).toBe('frequencies')
    expect(body.feeBps).toBe(700)
    expect(body.currency).toBe(MINT)
  })

  it('повертає параметри після нормалізації рецептом', async () => {
    // Покупець має бачити, за що саме йому назвали ціну: незадані фільтри
    // означають найширшу когорту, і це має бути видно у відповіді.
    const body = runQuoteSchema.parse(await (await quote(request())).json())
    expect(body.params).toEqual({ minAge: 0, maxAge: 255, sex: 'any', affected: 'any' })
  })

  it('сумує пул із різними цінами', async () => {
    await store(BETA)
    readQuoteChain.mockImplementation(async () =>
      chainState([
        chainDataset(ALPHA),
        {
          ...chainDataset(BETA),
          dataset: {
            status: 'active',
            recordCountClaimed: 1_000n,
            pricePer1k: pricePer1kSchema.parse(2_000n),
            consentVersion: CONSENT_VERSION,
          },
        },
      ]),
    )

    const body = runQuoteSchema.parse(
      await (
        await quote(
          request({
            datasets: [
              { owner: OWNER, datasetId: ALPHA },
              { owner: OWNER, datasetId: BETA },
            ],
          }),
        )
      ).json(),
    )

    expect(body.upperBound).toBe(String(18_000 + 2_000))
    expect(body.eligibleCount).toBe(2)
  })

  it('заокруглює вгору на кожному датасеті окремо', async () => {
    // Неповна тисяча в кожного датасету своя, і сумувати записи перед діленням
    // означало б їх взаємно погасити.
    await store(BETA)
    readQuoteChain.mockImplementation(async () =>
      chainState([
        {
          ...chainDataset(ALPHA),
          dataset: {
            status: 'active',
            recordCountClaimed: 1n,
            pricePer1k: pricePer1kSchema.parse(1_000n),
            consentVersion: CONSENT_VERSION,
          },
        },
        {
          ...chainDataset(BETA),
          dataset: {
            status: 'active',
            recordCountClaimed: 1n,
            pricePer1k: pricePer1kSchema.parse(1_000n),
            consentVersion: CONSENT_VERSION,
          },
        },
      ]),
    )

    const body = runQuoteSchema.parse(
      await (
        await quote(
          request({
            datasets: [
              { owner: OWNER, datasetId: ALPHA },
              { owner: OWNER, datasetId: BETA },
            ],
          }),
        )
      ).json(),
    )

    expect(body.upperBound).toBe('2')
  })

  it('передає читачу рівно той склад, що просили', async () => {
    await quote(request())
    expect(readQuoteChain).toHaveBeenCalledWith([{ owner: OWNER, datasetId: ALPHA }])
  })
})

describe('непридатний датасет позначається, а не валить квоту', () => {
  beforeEach(async () => {
    await store(ALPHA)
    await store(BETA)
  })

  async function withBeta(beta: QuoteDatasetState) {
    readQuoteChain.mockImplementation(async () => chainState([chainDataset(ALPHA), beta]))
    const response = await quote(
      request({
        datasets: [
          { owner: OWNER, datasetId: ALPHA },
          { owner: OWNER, datasetId: BETA },
        ],
      }),
    )
    return runQuoteSchema.parse(await response.json())
  }

  it('решта пулу лишається порахованою', async () => {
    const body = await withBeta({ ...chainDataset(BETA), dataset: null })

    expect(body.upperBound).toBe('18000')
    expect(body.eligibleCount).toBe(1)
    expect(body.orderable).toBe(true)
    expect(body.datasets).toHaveLength(2)
  })

  it.each([
    [
      'незареєстрований',
      { ...chainDataset(BETA), dataset: null } as QuoteDatasetState,
      'unregistered',
    ],
    [
      'знятий',
      {
        ...chainDataset(BETA),
        dataset: {
          status: 'retired' as const,
          recordCountClaimed: 12n,
          pricePer1k: PRICE,
          consentVersion: CONSENT_VERSION,
        },
      },
      'retired',
    ],
    ['без згоди', { ...chainDataset(BETA), consent: null }, 'no-consent'],
    [
      'із відкликаною згодою',
      {
        ...chainDataset(BETA),
        consent: { ...CONSENT, revoked: true },
      },
      'revoked',
    ],
    [
      'зі спливлим строком',
      {
        ...chainDataset(BETA),
        consent: { ...CONSENT, expiresAt: NOW - 1n },
      },
      'expired',
    ],
    [
      'із прямою забороною',
      {
        ...chainDataset(BETA),
        consent: { ...CONSENT, forbiddenUses: USE_TYPES.oncology },
      },
      'use-forbidden',
    ],
    [
      'без дозволу на цей тип',
      {
        ...chainDataset(BETA),
        consent: { ...CONSENT, allowedUses: USE_TYPES.cardiology },
      },
      'use-not-allowed',
    ],
    [
      'без дозволу цій категорії',
      {
        ...chainDataset(BETA),
        consent: { ...CONSENT, buyerCategories: BUYER_CATEGORIES.commercial },
      },
      'category-not-allowed',
    ],
  ])('датасет %s названо причиною «%s»', async (_label, beta, reason) => {
    const body = await withBeta(beta)
    const line = body.datasets[1]

    expect(line?.eligible).toBe(false)
    expect(line?.eligible === false ? line.reason : undefined).toBe(reason)
  })

  it('зареєстрований датасет без байтів не рахується', async () => {
    // Прогін по ньому впав би на публікації в MPC, а не на перевірці згоди.
    readQuoteChain.mockImplementation(async () =>
      chainState([chainDataset(ALPHA), chainDataset(datasetIdSchema.parse('cohort-gamma'))]),
    )

    const response = await quote(
      request({
        datasets: [
          { owner: OWNER, datasetId: ALPHA },
          { owner: OWNER, datasetId: 'cohort-gamma' },
        ],
      }),
    )
    const body = runQuoteSchema.parse(await response.json())
    const line = body.datasets[1]

    expect(line?.eligible === false ? line.reason : undefined).toBe('ciphertext-missing')
  })

  it('стан датасету називається раніше за згоду', async () => {
    // На знятому датасеті «згоду відкликано» відправило б покупця розбиратися
    // не туди.
    const body = await withBeta({
      ...chainDataset(BETA),
      dataset: {
        status: 'retired',
        recordCountClaimed: 12n,
        pricePer1k: PRICE,
        consentVersion: CONSENT_VERSION,
      },
      consent: { ...CONSENT, revoked: true },
    })
    const line = body.datasets[1]

    expect(line?.eligible === false ? line.reason : undefined).toBe('retired')
  })

  it('непридатний рядок не несе цін', async () => {
    const body = await withBeta({ ...chainDataset(BETA), consent: null })
    expect(body.datasets[1]).not.toHaveProperty('upperBound')
    expect(body.datasets[1]).not.toHaveProperty('pricePer1k')
  })
})

describe('коли замовити не можна', () => {
  beforeEach(async () => {
    await store(ALPHA)
  })

  it('пул без жодного придатного датасету віддає ціну нуль і причину', async () => {
    // Питання «скільки коштує» має відповідь, і покупець має бачити її разом
    // із тим, чому саме зараз замовити не вийде.
    readQuoteChain.mockImplementation(async () =>
      chainState([{ ...chainDataset(ALPHA), consent: null }]),
    )

    const response = await quote(request())
    expect(response.status).toBe(200)

    const body = runQuoteSchema.parse(await response.json())
    expect(body.upperBound).toBe('0')
    expect(body.orderable).toBe(false)
    expect(body.blocker).toBe('no-eligible-datasets')
  })

  it('пауза платформи не ховає ціни', async () => {
    readQuoteChain.mockImplementation(async () =>
      chainState([chainDataset(ALPHA)], { paused: true }),
    )

    const body = runQuoteSchema.parse(await (await quote(request())).json())
    expect(body.upperBound).toBe('18000')
    expect(body.orderable).toBe(false)
    expect(body.blocker).toBe('platform-paused')
  })
})

describe('квота відмовляє зрозуміло', () => {
  beforeEach(async () => {
    await store(ALPHA)
  })

  it('без токена — 401', async () => {
    const response = await app.request('/runs/quote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request()),
    })
    expect(response.status).toBe(401)
  })

  it('поламаний JSON — 400, а не 500', async () => {
    const response = await app.request('/runs/quote', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{',
    })
    expect(response.status).toBe(400)
    expect((await failure(response)).code).toBe('INVALID_INPUT')
  })

  it('невідомий рецепт — 400 із номером', async () => {
    const response = await quote(request({ recipeId: 7 }))
    expect(response.status).toBe(400)
    expect((await failure(response)).message).toContain('7')
  })

  it('параметр, якого рецепт не оголошував, — 400', async () => {
    const response = await quote(request({ params: { ancestry: 'eu' } }))
    expect(response.status).toBe(400)
  })

  it('перевернуте вікове вікно — 400', async () => {
    const response = await quote(request({ params: { minAge: 60, maxAge: 40 } }))
    expect(response.status).toBe(400)
  })

  it('дублікат у складі прогону — 400 до звернення в мережу', async () => {
    // Програма відхиляє дублікат (`Run::validate_datasets`): він заплатив би
    // одному власнику двічі й зламав би сходження сум (`SC-006`).
    const response = await quote(
      request({
        datasets: [
          { owner: OWNER, datasetId: ALPHA },
          { owner: OWNER, datasetId: ALPHA },
        ],
      }),
    )
    expect(response.status).toBe(400)
    expect(readQuoteChain).not.toHaveBeenCalled()
  })

  it('пул, довший за той, що приймає програма, — 400', async () => {
    const datasets = Array.from({ length: MAX_RUN_DATASETS + 1 }, (_unused, index) => ({
      owner: OWNER,
      datasetId: `cohort-${index.toString().padStart(3, '0')}`,
    }))
    expect((await quote(request({ datasets }))).status).toBe(400)
  })

  it('порожній пул — 400', async () => {
    expect((await quote(request({ datasets: [] }))).status).toBe(400)
  })

  it('недоступний вузол — 503, а не 500', async () => {
    // 500 сказало б «ми зламались», і клієнт не повторив би запит. Тут
    // повторити варто.
    readQuoteChain.mockImplementation(async () => {
      throw new ChainStateError('unavailable', 'вузол мережі не відповів')
    })

    const response = await quote(request())
    expect(response.status).toBe(503)
    expect((await failure(response)).code).toBe('UPSTREAM_UNAVAILABLE')
  })

  it('нерозгорнута конфігурація платформи — 500, бо це наше', async () => {
    readQuoteChain.mockImplementation(async () => {
      throw new ChainStateError('not-initialized', 'конфігурації платформи немає в мережі')
    })

    const response = await quote(request())
    expect(response.status).toBe(500)
    expect((await failure(response)).code).toBe('INTERNAL')
  })

  it('жодна відмова не переказує адреси вузла', async () => {
    readQuoteChain.mockImplementation(async () => {
      throw new ChainStateError('unavailable', 'вузол мережі не відповів')
    })

    const text = await (await quote(request())).text()
    expect(text).not.toContain('127.0.0.1')
    expect(text).not.toContain('http')
  })

  it('ненастроєні сервіси — 500, а не «не знайдено»', async () => {
    const bare = createApp({ verifyAccessToken: verify })
    const response = await bare.request('/runs/quote', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify(request()),
    })

    expect(response.status).toBe(500)
  })
})
