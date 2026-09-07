import {
  apiErrorSchema,
  type ChainView,
  chainViewSchema,
  contentHash,
  DATASET_LIST_LIMIT_MAX,
  type DatasetId,
  datasetDetailSchema,
  datasetIdSchema,
  datasetListSchema,
  LIMB_BYTES,
  NONCE_BYTES,
  SCALAR_FIELD_COUNT,
  type SolanaAddress,
  serializeEnvelope,
  solanaAddressSchema,
  X25519_KEY_BYTES,
} from '@genovault/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createApp } from '../src/app.ts'
import { AuthError, type TokenVerifier } from '../src/services/auth.ts'
import { type CatalogStore, memoryCatalog } from '../src/services/catalog.ts'
import { createRegistrationBuilder } from '../src/services/chain.ts'
import type { StorageDriver } from '../src/services/storage.ts'

const OWNER = solanaAddressSchema.parse('11111111111111111111111111111112')
const OTHER_OWNER = solanaAddressSchema.parse('SysvarC1ock11111111111111111111111111111111')
const USER = 'did:privy:clx0000000000000000000000'
const OTHER_USER = 'did:privy:clx1111111111111111111111'
const DATASET_ID = datasetIdSchema.parse('cohort-alpha')
const MARKERS = 4
const RECORDS = 12

/**
 * Відповіді розбираються схемою, а не читаються як `unknown`.
 *
 * Тест, який дописує тип касту, перевіряє власне припущення про відповідь;
 * тест, який її розбирає, перевіряє саму відповідь — і падає, коли з неї
 * зникне поле, на яке спирається фронт.
 */
const registrationSchema = z.object({
  datasetId: z.string(),
  owner: z.string(),
  datasetAddress: z.string(),
  contentHash: z.string(),
  status: z.string(),
  uploadUrl: z.string(),
  registration: z.object({
    signAfter: z.string(),
    instruction: z.object({
      programId: z.string(),
      accounts: z.array(
        z.object({ pubkey: z.string(), isSigner: z.boolean(), isWritable: z.boolean() }),
      ),
      data: z.string(),
    }),
  }),
})

const uploadSchema = z.object({
  storedHash: z.string(),
  recordCount: z.number(),
  markerCount: z.number(),
  byteLength: z.number(),
  status: z.string(),
})

async function registered(response: Response) {
  return registrationSchema.parse(await response.json())
}

async function uploaded(response: Response) {
  return uploadSchema.parse(await response.json())
}

async function failure(response: Response) {
  return apiErrorSchema.parse(await response.json()).error
}

/**
 * Конверт збирається `serializeEnvelope`, а не шифром — як і в тестах сховища.
 *
 * Це сама перевірювана властивість: `apps/api` не залежить від
 * `@genovault/crypto` і відрізнити справжній шифротекст від байтів правильної
 * форми не може (`FR-004a`). Тест, якому знадобився б шифр, доводив би, що ця
 * межа не тримається.
 */
function envelope(records = RECORDS, markers = MARKERS, seed = 1): Uint8Array {
  const fieldsPerRecord = SCALAR_FIELD_COUNT + markers
  const frames = Array.from({ length: records }, (_, index) => {
    const nonce = new Uint8Array(NONCE_BYTES)
    new DataView(nonce.buffer).setUint32(0, index + seed, true)
    return {
      nonce,
      limbs: Array.from({ length: fieldsPerRecord }, (_unused, field) => {
        const limb = new Array<number>(LIMB_BYTES).fill(0)
        limb[0] = (field + index + seed) % 251
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

/** Драйвер сховища в пам'яті — тест не має писати на диск, щоб довести маршрут. */
function memoryStorage(): StorageDriver & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>()
  return {
    kind: 'fs',
    objects,
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

const verify: TokenVerifier = async (token) => {
  if (token === 'other') {
    return { userId: OTHER_USER, sessionId: 'sid-2', expiresAt: new Date(Date.now() + 60_000) }
  }
  if (token !== 'good') throw new AuthError('токен не той')
  return { userId: USER, sessionId: 'sid-1', expiresAt: new Date(Date.now() + 60_000) }
}

/**
 * Стан ланцюга підставний, і це єдиний спосіб перевірити картку тут.
 *
 * Живий `createChainReader` вимагав би піднятого валідатора з розгорнутою
 * програмою — тобто перетворив би юніт-тест маршруту на інтеграційний, який
 * мовчки зеленіє через `state: 'unavailable'`, коли валідатора немає. Що
 * читач справді читає з мережі, доводить не цей файл.
 */
const CHAIN_REGISTERED = {
  state: 'registered',
  status: 'active',
  version: 1,
  contentHash: 'a'.repeat(64),
  recordCountClaimed: String(RECORDS),
  pricePer1k: '1500000',
  consent: {
    version: 1,
    allowedUses: 3,
    forbiddenUses: 0,
    buyerCategories: 1,
    expiresAt: null,
    revoked: false,
  },
  verifiedBadge: {
    verifier: OWNER,
    verifiedAt: '1735689600',
    kind: 'operator-attested',
  },
}

const readChain = vi.fn(
  async (_owner: SolanaAddress, _datasetId: DatasetId): Promise<ChainView> =>
    chainViewSchema.parse(CHAIN_REGISTERED),
)

let catalog: CatalogStore
let storage: ReturnType<typeof memoryStorage>
let app: ReturnType<typeof createApp>

beforeEach(() => {
  catalog = memoryCatalog()
  storage = memoryStorage()
  // `mockReset`, не `mockClear`: черга `mockResolvedValueOnce` переживає
  // `clear` і протікає в наступний тест.
  readChain.mockReset()
  readChain.mockImplementation(async () => chainViewSchema.parse(CHAIN_REGISTERED))
  app = createApp({
    verifyAccessToken: verify,
    catalog,
    storage,
    // Справжній збирач, а не заглушка: побудова інструкції з повністю заданими
    // акаунтами не робить мережевих викликів, і саме це тут варто довести.
    buildRegistration: createRegistrationBuilder('http://127.0.0.1:8899'),
    readChain,
    baseUrl: 'http://127.0.0.1:8879',
  })
})

function metadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: 'Когорта альфа',
    description: 'Синтетична когорта для перевірок.',
    schema: [{ field: 'age', type: 'integer', description: 'Повних років' }],
    recordCount: RECORDS,
    markerCount: MARKERS,
    statistics: {
      affectedRate: 0.25,
      meanAge: 44,
      alleleFrequencies: [0.2, 0.3, 0.25, 0.4],
    },
    provenance: { source: 'synthetic', collectedFrom: '2024-01-01', collectedTo: '2024-06-30' },
    ...overrides,
  }
}

async function body(bytes: Uint8Array): Promise<Record<string, unknown>> {
  return {
    datasetId: DATASET_ID,
    owner: OWNER,
    contentHash: await contentHash(bytes),
    pricePer1k: '1500000',
    metadata: metadata(),
  }
}

async function post(payload: unknown, token = 'good'): Promise<Response> {
  return app.request('/datasets', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function put(bytes: Uint8Array, token = 'good', id = DATASET_ID): Promise<Response> {
  return app.request(`/datasets/${id}/ciphertext`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
    body: bytes,
  })
}

async function list(query = '', token = 'good'): Promise<Response> {
  return app.request(`/datasets${query}`, { headers: { authorization: `Bearer ${token}` } })
}

async function detailOf(owner = OWNER, id = DATASET_ID, token = 'good'): Promise<Response> {
  return app.request(`/datasets/${owner}/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  })
}

describe('POST /datasets', () => {
  it('вимагає сесії', async () => {
    const response = await app.request('/datasets', { method: 'POST', body: '{}' })
    expect(response.status).toBe(401)
  })

  it('реєструє датасет і віддає адресу завантаження та неспідписану інструкцію', async () => {
    const bytes = envelope()
    const response = await post(await body(bytes))
    expect(response.status).toBe(201)

    const json = await registered(response)
    expect(json.datasetId).toBe(DATASET_ID)
    expect(json.status).toBe('pending')
    expect(json.uploadUrl).toBe(`http://127.0.0.1:8879/datasets/${DATASET_ID}/ciphertext`)
    expect(json.registration.signAfter).toBe('ciphertext-upload')
    expect(json.datasetAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
  })

  it('не віддає нічого підписаного', async () => {
    // Правило репозиторію: API складає байти дії, підписує власник. Якби у
    // відповіді був підпис, це означало б, що ключ власника тут є.
    const response = await post(await body(envelope()))
    const text = await response.text()
    expect(text).not.toContain('signature')
    expect(text).not.toContain('secretKey')

    // Власник — єдиний підписант інструкції, і ним він лишається.
    const { registration } = registrationSchema.parse(JSON.parse(text))
    const signers = registration.instruction.accounts.filter((account) => account.isSigner)
    expect(signers).toEqual([{ pubkey: OWNER, isSigner: true, isWritable: true }])
  })

  it('відхиляє опис, який не проходить схему', async () => {
    const payload = await body(envelope())
    const response = await post({ ...payload, metadata: metadata({ recordCount: 1 }) })
    expect(response.status).toBe(400)
    expect((await failure(response)).code).toBe('INVALID_INPUT')
  })

  it('відхиляє поламаний JSON як 400, а не 500', async () => {
    const response = await app.request('/datasets', {
      method: 'POST',
      headers: { authorization: 'Bearer good', 'content-type': 'application/json' },
      body: '{ це не json',
    })
    expect(response.status).toBe(400)
  })

  describe("прив'язка сесії до адреси", () => {
    it('прив’язує на першій реєстрації', async () => {
      await post(await body(envelope()))
      expect(await catalog.ownerOf(USER)).toBe(OWNER)
    })

    it('відхиляє другу адресу під тією самою сесією', async () => {
      await post(await body(envelope()))
      const response = await post({ ...(await body(envelope())), owner: OTHER_OWNER })

      expect(response.status).toBe(400)
      expect((await failure(response)).message).toContain(OWNER)
      expect(await catalog.getDataset(OTHER_OWNER, DATASET_ID)).toBeUndefined()
    })
  })

  describe('повтор запиту', () => {
    it('той самий вміст удруге — не конфлікт', async () => {
      const payload = await body(envelope())
      const first = await post(payload)
      const second = await post(payload)

      expect(first.status).toBe(201)
      expect(second.status).toBe(200)
      expect((await registered(first)).datasetAddress).toBe(
        (await registered(second)).datasetAddress,
      )
    })

    it('інший вміст під тим самим ідентифікатором — відмова', async () => {
      // Нова версія вмісту — це `update_dataset_content` (`FR-003`), а не
      // повторна реєстрація: тихий перезапис відв’язав би завершені прогони
      // від того, по чому вони насправді йшли.
      await post(await body(envelope()))
      const response = await post(await body(envelope(RECORDS, MARKERS, 99)))

      expect(response.status).toBe(400)
      expect((await failure(response)).message).toContain('іншим відбитком')
    })

    it('повтор реєстрації після завантаження не скидає стан на pending', async () => {
      const payload = await body(envelope())
      await post(payload)
      await put(envelope())

      const response = await post(payload)
      expect((await registered(response)).status).toBe('stored')
    })
  })
})

describe('PUT /datasets/:id/ciphertext', () => {
  beforeEach(async () => {
    await post(await body(envelope()))
  })

  it('вимагає сесії', async () => {
    const response = await app.request(`/datasets/${DATASET_ID}/ciphertext`, { method: 'PUT' })
    expect(response.status).toBe(401)
  })

  it('кладе шифротекст і переводить рядок каталогу в stored', async () => {
    const bytes = envelope()
    const response = await put(bytes)
    expect(response.status).toBe(200)

    const json = await uploaded(response)
    expect(json.storedHash).toBe(await contentHash(bytes))
    expect(json.recordCount).toBe(RECORDS)
    expect(json.markerCount).toBe(MARKERS)
    expect(json.byteLength).toBe(bytes.length)

    const record = await catalog.getDataset(OWNER, DATASET_ID)
    expect(record?.status).toBe('stored')
    expect(record?.byteLength).toBe(bytes.length)
  })

  it('адресує об’єкт його ж відбитком', async () => {
    const bytes = envelope()
    await put(bytes)
    expect([...storage.objects.keys()]).toEqual([
      `datasets/${DATASET_ID}/${await contentHash(bytes)}.gvds`,
    ])
  })

  it('не приймає байтів, що не є конвертом', async () => {
    const response = await put(new Uint8Array([1, 2, 3, 4, 5]))
    expect(response.status).toBe(400)
    expect(storage.objects.size).toBe(0)
  })

  it('відхиляє вміст, відбиток якого не збігається із заявленим', async () => {
    const response = await put(envelope(RECORDS, MARKERS, 42))
    expect(response.status).toBe(400)
    expect((await failure(response)).message).toContain('не збігається')
  })

  it('не кладе в сховище нічого, що не пройшло перевірок', async () => {
    // Інакше будь-яка сесія клала б туди будь-який правильний за формою
    // конверт під власним ідентифікатором і платила за це нічим.
    await put(envelope(RECORDS, MARKERS, 42))
    expect(storage.objects.size).toBe(0)
  })

  it('відхиляє конверт, у якому не стільки записів, скільки заявлено', async () => {
    const bytes = envelope(RECORDS + 1)
    const payload = { ...(await body(bytes)), datasetId: 'cohort-beta' }
    await post(payload)

    // Той самий відбиток, але метадані заявляють іншу кількість.
    const mismatched = await post({
      ...payload,
      datasetId: 'cohort-gamma',
      metadata: metadata({ recordCount: RECORDS }),
    })
    expect(mismatched.status).toBe(201)

    const response = await put(bytes, 'good', datasetIdSchema.parse('cohort-gamma'))
    expect(response.status).toBe(400)
    expect((await failure(response)).message).toContain('записів')
  })

  it('відхиляє тіло, більше за межу', async () => {
    const small = createApp({
      verifyAccessToken: verify,
      catalog,
      storage,
      buildRegistration: createRegistrationBuilder('http://127.0.0.1:8899'),
      readChain,
      maxCiphertextBytes: 16,
    })

    const response = await small.request(`/datasets/${DATASET_ID}/ciphertext`, {
      method: 'PUT',
      headers: { authorization: 'Bearer good' },
      body: envelope(),
    })
    expect(response.status).toBe(400)
    expect((await failure(response)).message).toContain('більший за межу')
  })

  describe('чужий датасет', () => {
    it('віддає «не знайдено», а не «не твій»', async () => {
      // Різні коди сказали б, які ідентифікатори зайняті в чужих власників.
      // `cohort-alpha` належить USER — інша сесія має побачити те саме, що й
      // на ідентифікаторі, якого не існує взагалі.
      await post(
        {
          ...(await body(envelope(RECORDS, MARKERS, 5))),
          datasetId: 'cohort-beta',
          owner: OTHER_OWNER,
        },
        'other',
      )

      const response = await put(envelope(), 'other')
      expect(response.status).toBe(404)
      expect(storage.objects.size).toBe(0)
    })

    it('сесія без прив’язаної адреси нічим не володіє', async () => {
      const response = await put(envelope(), 'other')
      expect(response.status).toBe(404)
    })
  })

  it('відхиляє ідентифікатор, що не проходить схему', async () => {
    const response = await put(envelope(), 'good', 'ID_З_ВЕЛИКИХ' as typeof DATASET_ID)
    expect(response.status).toBe(400)
  })
})

describe('GET /datasets', () => {
  /** Три датасети двох власників: два залиті, один без байтів. */
  async function seed(): Promise<void> {
    const alpha = envelope()
    await post(await body(alpha))
    await put(alpha)

    const beta = envelope(40, MARKERS, 3)
    await post({
      ...(await body(beta)),
      datasetId: 'cohort-beta',
      pricePer1k: '9000000',
      metadata: metadata({
        title: 'Когорта бета',
        description: 'Біобанк, старша вибірка.',
        recordCount: 40,
        provenance: { source: 'biobank', collectedFrom: '2023-01-01', collectedTo: '2023-12-31' },
      }),
    })
    await put(beta, 'good', datasetIdSchema.parse('cohort-beta'))

    // Без `put`: заявлений, але байтів немає.
    await post({ ...(await body(envelope(20, MARKERS, 7))), datasetId: 'cohort-draft' })
  }

  it('вимагає сесії', async () => {
    expect((await app.request('/datasets')).status).toBe(401)
  })

  it('віддає лише залиті датасети', async () => {
    await seed()
    const page = datasetListSchema.parse(await (await list()).json())

    expect(page.total).toBe(2)
    expect(page.items.map((item) => item.datasetId).sort()).toEqual([DATASET_ID, 'cohort-beta'])
  })

  it('ховає чужі незавантажені датасети від покупця', async () => {
    // Картка з `content_hash`, за яким нічого не лежить, — це обіцянка вмісту,
    // а не вміст: покупець, що замовить по ній прогін, отримає відмову вже
    // після оплати.
    await seed()
    const page = datasetListSchema.parse(await (await list('', 'other')).json())
    expect(page.items.map((item) => item.datasetId)).not.toContain('cohort-draft')
  })

  it('показує власнику його ж незавантажені через owner=me', async () => {
    // Інакше власник не дізнається, що аплоад обірвався.
    await seed()
    const page = datasetListSchema.parse(await (await list('?owner=me')).json())
    expect(page.items.map((item) => item.datasetId)).toContain('cohort-draft')
  })

  it('віддає порожньо на owner=me для сесії без прив’язаної адреси', async () => {
    await seed()
    const page = datasetListSchema.parse(await (await list('?owner=me', 'other')).json())
    expect(page).toMatchObject({ items: [], total: 0 })
  })

  it('не показує чужих незавантажених навіть на прямий запит адреси', async () => {
    await seed()
    const page = datasetListSchema.parse(await (await list(`?owner=${OWNER}`, 'other')).json())
    expect(page.items.map((item) => item.datasetId).sort()).toEqual([DATASET_ID, 'cohort-beta'])
  })

  describe('відбір', () => {
    beforeEach(seed)

    it('за походженням', async () => {
      const page = datasetListSchema.parse(await (await list('?source=biobank')).json())
      expect(page.items.map((item) => item.datasetId)).toEqual(['cohort-beta'])
    })

    it('за мінімальною кількістю записів', async () => {
      const page = datasetListSchema.parse(await (await list('?minRecords=20')).json())
      expect(page.items.map((item) => item.datasetId)).toEqual(['cohort-beta'])
    })

    it('за стелею ціни', async () => {
      const page = datasetListSchema.parse(await (await list('?maxPricePer1k=2000000')).json())
      expect(page.items.map((item) => item.datasetId)).toEqual([DATASET_ID])
    })

    it('за підрядком без урахування регістру', async () => {
      const page = datasetListSchema.parse(await (await list('?q=БІОБАНК')).json())
      expect(page.items.map((item) => item.datasetId)).toEqual(['cohort-beta'])
    })

    it('відхиляє невідомий параметр', async () => {
      // strictObject: параметр, якого схема не називає, — це або друкарська
      // помилка, або спроба намацати відбір, якого немає.
      expect((await list('?secret=1')).status).toBe(400)
    })

    it('відхиляє межу, більшу за стелю', async () => {
      expect((await list(`?limit=${DATASET_LIST_LIMIT_MAX + 1}`)).status).toBe(400)
    })
  })

  it('гортає сторінками, не гублячи й не двоячи рядків', async () => {
    await seed()
    const first = datasetListSchema.parse(await (await list('?limit=1&offset=0')).json())
    const second = datasetListSchema.parse(await (await list('?limit=1&offset=1')).json())

    expect(first.total).toBe(2)
    expect(first.items).toHaveLength(1)
    expect(first.items[0]?.datasetId).not.toBe(second.items[0]?.datasetId)
  })

  it('не несе в картці ані схеми, ані статистики, ані стану ланцюга', async () => {
    // Перелік читається пачками, і читання мережі на кожен рядок зробило б
    // `SC-011` недосяжним за побудовою.
    await seed()
    const page = datasetListSchema.parse(await (await list()).json())
    expect(page.items[0]).not.toHaveProperty('statistics')
    expect(page.items[0]).not.toHaveProperty('chain')
    expect(readChain).not.toHaveBeenCalled()
  })

  it('віддає ціну рядком, а не числом', async () => {
    // u64 не вміщається в `double`, а `JSON.parse` округлює мовчки.
    await seed()
    const raw: unknown = JSON.parse(await (await list()).text())
    const items = z.object({ items: z.array(z.object({ pricePer1k: z.unknown() })) }).parse(raw)
    expect(typeof items.items[0]?.pricePer1k).toBe('string')
  })
})

describe('GET /datasets/:owner/:id', () => {
  beforeEach(async () => {
    const bytes = envelope()
    await post(await body(bytes))
    await put(bytes)
  })

  it('вимагає сесії', async () => {
    expect((await app.request(`/datasets/${OWNER}/${DATASET_ID}`)).status).toBe(401)
  })

  it('віддає опис, схему, статистику й стан ланцюга', async () => {
    const detail = datasetDetailSchema.parse(await (await detailOf()).json())

    expect(detail.datasetId).toBe(DATASET_ID)
    expect(detail.schema).toHaveLength(1)
    expect(detail.ciphertextStored).toBe(true)
    expect(detail.chain.state).toBe('registered')
  })

  it('позначає статистику як заявлену власником і неперевірену', async () => {
    // Покупець, що читає `alleleFrequencies` як факт про когорту, помиляється,
    // і зрозуміти це він має з картки, а не постфактум (`FR-024a` за духом).
    const detail = datasetDetailSchema.parse(await (await detailOf()).json())
    expect(detail.statistics).toMatchObject({ declaredBy: 'owner', verified: false })
  })

  it('називає бейдж тим, чим він є', async () => {
    const detail = datasetDetailSchema.parse(await (await detailOf()).json())
    if (detail.chain.state !== 'registered') throw new Error('очікувався зареєстрований датасет')
    expect(detail.chain.verifiedBadge?.kind).toBe('operator-attested')
  })

  it('віддає картку й тоді, коли RPC недоступний', async () => {
    // Каталог має відкритися без мережі — просто без тієї частини, яку без неї
    // не дізнатись. 500 тут сказав би «датасету немає».
    readChain.mockResolvedValueOnce({ state: 'unavailable' })
    const detail = datasetDetailSchema.parse(await (await detailOf()).json())
    expect(detail.chain.state).toBe('unavailable')
    expect(detail.title).toBe('Когорта альфа')
  })

  it('розрізняє «RPC мовчить» і «датасет не зареєстровано»', async () => {
    readChain.mockResolvedValueOnce({ state: 'unregistered' })
    const detail = datasetDetailSchema.parse(await (await detailOf()).json())
    expect(detail.chain.state).toBe('unregistered')
  })

  it('віддає «не знайдено» на невідомий датасет', async () => {
    const response = await app.request(`/datasets/${OWNER}/cohort-missing`, {
      headers: { authorization: 'Bearer good' },
    })
    expect(response.status).toBe(404)
  })

  it('ховає чужий незавантажений датасет тією ж відповіддю, що й неіснуючий', async () => {
    // Інакше 404 і 403 разом дають перелік чужих чернеток.
    await post({ ...(await body(envelope(20, MARKERS, 7))), datasetId: 'cohort-draft' })

    const asOwner = await app.request(`/datasets/${OWNER}/cohort-draft`, {
      headers: { authorization: 'Bearer good' },
    })
    const asStranger = await app.request(`/datasets/${OWNER}/cohort-draft`, {
      headers: { authorization: 'Bearer other' },
    })

    expect(asOwner.status).toBe(200)
    expect(asStranger.status).toBe(404)
  })

  it('відхиляє адресу власника, що декодується не в 32 байти', async () => {
    const response = await app.request(`/datasets/abc/${DATASET_ID}`, {
      headers: { authorization: 'Bearer good' },
    })
    expect(response.status).toBe(400)
  })

  it('не плутається з маршрутом завантаження', async () => {
    // `PUT /datasets/:id/ciphertext` і `GET /datasets/:owner/:id` — обидва на
    // трьох сегментах. Розводить їх метод, і це варто тримати перевіреним.
    const bytes = envelope()
    expect((await put(bytes)).status).toBe(200)
    expect((await detailOf()).status).toBe(200)
  })
})
