import {
  apiErrorSchema,
  contentHash,
  datasetIdSchema,
  LIMB_BYTES,
  NONCE_BYTES,
  SCALAR_FIELD_COUNT,
  serializeEnvelope,
  solanaAddressSchema,
  X25519_KEY_BYTES,
} from '@genovault/shared'
import { beforeEach, describe, expect, it } from 'vitest'
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

let catalog: CatalogStore
let storage: ReturnType<typeof memoryStorage>
let app: ReturnType<typeof createApp>

beforeEach(() => {
  catalog = memoryCatalog()
  storage = memoryStorage()
  app = createApp({
    verifyAccessToken: verify,
    catalog,
    storage,
    // Справжній збирач, а не заглушка: побудова інструкції з повністю заданими
    // акаунтами не робить мережевих викликів, і саме це тут варто довести.
    buildRegistration: createRegistrationBuilder('http://127.0.0.1:8899'),
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
