import { Buffer } from 'node:buffer'
import type { RunAccount, RunResultAccount } from '@genovault/sdk'
import {
  BUYER_CATEGORIES,
  contentHash,
  datasetIdSchema,
  LIMB_BYTES,
  NONCE_BYTES,
  pricePer1kSchema,
  SCALAR_FIELD_COUNT,
  serializeEnvelope,
  solanaAddressSchema,
  USE_TYPES,
  X25519_KEY_BYTES,
} from '@genovault/shared'
import { PublicKey } from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { AuthError, type TokenVerifier } from '../src/services/auth.ts'
import { memoryCatalog } from '../src/services/catalog.ts'
import {
  createRegistrationBuilder,
  createRunOrderBuilder,
  deriveDatasetAddress,
} from '../src/services/chain.ts'
import type { StorageDriver } from '../src/services/storage.ts'

/**
 * Гард `FR-002`: жодна відповідь API не містить сирих записів.
 *
 * Це не перевірка окремого маршруту, а твердження про **весь** застосунок, і
 * тримається воно на двох речах.
 *
 * Перша — реєстр. Тест перелічує маршрути, які застосунок насправді
 * зареєстрував, і вимагає, щоб кожен був тут проб'ятий. Новий маршрут валить
 * цей файл доти, доки автор не додасть до нього запит; гард, який перевіряє
 * список, складений уручну, застаріває на першій же задачі й нічого не
 * доводить.
 *
 * Друга — мітки. Датасет збирається так, щоб окремий запис мав упізнаваний
 * байтовий слід, і жодна відповідь не сміє його містити — ані як байти, ані
 * base64, ані шістнадцятково. Плюс структурна перевірка: масиву завдовжки в
 * кількість записів у відповіді бути не може, хай навіть чисел у ньому ніхто
 * не впізнає.
 *
 * Чого тут немає навмисно: перевірки, що `apps/api` не залежить від
 * `@genovault/crypto`. Вона живе в `tests/storage.test.ts` і дивиться на
 * маніфест — це твердження про граф залежностей, а не про відповіді, і
 * дублювати його тут означало б мати два місця, які розійдуться.
 */

const OWNER = solanaAddressSchema.parse('11111111111111111111111111111112')
const USER = 'did:privy:clx0000000000000000000000'
const DATASET_ID = datasetIdSchema.parse('cohort-alpha')

/**
 * 13, а не 12: число має бути впізнаваним.
 *
 * Структурна перевірка нижче шукає масив завдовжки `RECORDS`, і чим менше це
 * число схоже на будь-яку іншу довжину у відповіді — кількість маркерів, полів
 * схеми, рядків сторінки — тим менше в неї шансів спрацювати даремно.
 */
const RECORDS = 13
const MARKERS = 4

/** Байт, якого немає ніде, крім кадру одного запису. */
const SENTINEL_BYTE = 0xa7

/**
 * Конверт із упізнаваним кадром.
 *
 * Збирається `serializeEnvelope`, а не шифром: `apps/api` шифру не має, і
 * тест, якому він знадобився б, доводив би, що межа з `FR-004a` не тримається.
 */
function envelope(): { bytes: Uint8Array; frame: Uint8Array } {
  const fieldsPerRecord = SCALAR_FIELD_COUNT + MARKERS
  const marked = new Array<number>(LIMB_BYTES).fill(SENTINEL_BYTE)

  const frames = Array.from({ length: RECORDS }, (_, index) => {
    const nonce = new Uint8Array(NONCE_BYTES)
    new DataView(nonce.buffer).setUint32(0, index, true)
    return {
      nonce,
      limbs: Array.from({ length: fieldsPerRecord }, (_unused, field) =>
        // Рівно один лімб одного запису несе мітку: якщо вона спливе у
        // відповіді, це шлях від відповіді до конкретного рядка датасету.
        index === 7 && field === SCALAR_FIELD_COUNT
          ? marked
          : new Array<number>(LIMB_BYTES).fill(1),
      ),
    }
  })

  return {
    bytes: serializeEnvelope(
      {
        mxePublicKey: new Uint8Array(X25519_KEY_BYTES).fill(7),
        ephemeralPublicKey: new Uint8Array(X25519_KEY_BYTES).fill(9),
        recordCount: RECORDS,
        markerCount: MARKERS,
        fieldsPerRecord,
      },
      frames,
    ),
    frame: Uint8Array.from(marked),
  }
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

const verify: TokenVerifier = async (token) => {
  if (token !== 'good') throw new AuthError('токен не той')
  return { userId: USER, sessionId: 'sid-1', expiresAt: new Date(Date.now() + 60_000) }
}

const auth = { authorization: 'Bearer good' }

const BUYER = solanaAddressSchema.parse('4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T')
const DISPATCHER = solanaAddressSchema.parse('So11111111111111111111111111111111111111112')

/**
 * Замовлення прогону, яке має пройти.
 *
 * Стеля свідомо з запасом: ця проба перевіряє не арифметику, а те, що
 * успішний шлях `POST /runs` не несе у відповіді нічого з записів. Відмову
 * перевіряє сусідня проба, у якої стеля одиниця.
 */
const ORDER_BODY = {
  buyer: BUYER,
  recipeId: 1,
  useType: 'oncology',
  buyerCategory: 'academic',
  datasets: [{ owner: OWNER, datasetId: DATASET_ID }],
  params: {},
  nonce: '42',
  maxEscrow: '999999999999',
  buyerX25519: '11'.repeat(32),
}

/**
 * Прогін, який уже дорахувався, разом зі звітом.
 *
 * Саме цей стан найнебезпечніший для `FR-002`: у ньому є і склад пулу, і
 * шифротексти звіту, і кількість записів у когорті. Проба стоїть тут, щоб
 * будь-яке майбутнє «покажемо покупцю трохи більше» валило гард.
 */
function completedRun(): RunAccount {
  return {
    buyer: new PublicKey(BUYER),
    dispatcher: new PublicKey(DISPATCHER),
    nonce: 42n,
    recipeId: 1,
    recipeParams: new Uint8Array(32),
    useType: USE_TYPES.oncology,
    buyerCategory: BUYER_CATEGORIES.academic,
    buyerX25519: new Uint8Array(32).fill(0x11),
    datasets: [
      {
        dataset: new PublicKey(deriveDatasetAddress(OWNER, DATASET_ID)),
        pricePer1k: 1_500_000n,
        recordsIncluded: RECORDS,
        belowFloor: false,
        settled: true,
      },
    ],
    feeBps: 700,
    escrowAmount: 1_500_000n,
    settledCount: 1,
    settledAmount: 1_395_000n,
    refunded: true,
    status: 'completed',
    resultHash: '0f'.repeat(32) as never,
    recordsIncluded: RECORDS,
    suppressed: false,
    datasetCursor: 1,
    foldedBatches: 1,
    foldedHash: 'a1'.repeat(32) as never,
    createdAt: 1_735_689_600n,
    bump: 254,
  }
}

function completedResult(): RunResultAccount {
  return {
    run: new PublicKey(BUYER),
    encryptionKey: new Uint8Array(32).fill(0x5c),
    nonce: 1n << 100n,
    ciphertexts: Array.from({ length: 24 }, () => new Uint8Array(32).fill(0x33)),
    recordsIncluded: RECORDS,
    suppressed: false,
    bump: 253,
  }
}

let app: ReturnType<typeof createApp>
let ciphertext: Uint8Array
let frame: Uint8Array

beforeEach(async () => {
  const built = envelope()
  ciphertext = built.bytes
  frame = built.frame

  app = createApp({
    verifyAccessToken: verify,
    catalog: memoryCatalog(),
    storage: memoryStorage(),
    buildRegistration: createRegistrationBuilder('http://127.0.0.1:8899'),
    readChain: vi.fn(async () => ({ state: 'unregistered' }) as const),
    readQuoteChain: vi.fn(async (refs: readonly { datasetId: string }[]) => ({
      feeBps: 700,
      mint: solanaAddressSchema.parse('SysvarC1ock11111111111111111111111111111111'),
      paused: false,
      now: 1_735_689_600n,
      datasets: refs.map(() => ({
        datasetAddress: OWNER,
        dataset: {
          status: 'active' as const,
          recordCountClaimed: BigInt(RECORDS),
          pricePer1k: pricePer1kSchema.parse(1_500_000n),
          consentVersion: 1,
        },
        consent: {
          allowedUses: USE_TYPES.oncology,
          forbiddenUses: 0,
          buyerCategories: BUYER_CATEGORIES.academic,
          expiresAt: null,
          revoked: false,
        },
      })),
    })),
    buildRunOrder: createRunOrderBuilder('http://127.0.0.1:8899'),
    readRun: vi.fn(async (_buyer: unknown, nonce: bigint) => ({
      runAddress: BUYER,
      run: nonce === 42n ? completedRun() : null,
      result: nonce === 42n ? completedResult() : null,
    })),
    readPlatform: vi.fn(async () => ({
      programId: solanaAddressSchema.parse('11111111111111111111111111111112'),
      mint: solanaAddressSchema.parse('SysvarC1ock11111111111111111111111111111111'),
      feeBps: 700,
      paused: false,
    })),
    dispatcher: DISPATCHER,
    baseUrl: 'http://127.0.0.1:8879',
  })

  await app.request('/datasets', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      datasetId: DATASET_ID,
      owner: OWNER,
      contentHash: await contentHash(ciphertext),
      pricePer1k: '1500000',
      metadata: {
        title: 'Когорта альфа',
        description: 'Синтетична когорта для перевірок.',
        schema: [{ field: 'age', type: 'integer', description: 'Повних років' }],
        recordCount: RECORDS,
        markerCount: MARKERS,
        statistics: { affectedRate: 0.25, meanAge: 44, alleleFrequencies: [0.2, 0.3, 0.25, 0.4] },
        provenance: {
          source: 'synthetic',
          collectedFrom: '2024-01-01',
          collectedTo: '2024-06-30',
        },
      },
    }),
  })

  await app.request(`/datasets/${DATASET_ID}/ciphertext`, {
    method: 'PUT',
    headers: auth,
    body: ciphertext,
  })
})

/**
 * Запити, якими простукується застосунок.
 *
 * У кожного маршруту тут і успішний шлях, і шлях відмови: текст помилки
 * протікає не рідше за тіло відповіді, а через цей API проходять медичні дані.
 */
function probes(): { label: string; route: string; run: () => Promise<Response> }[] {
  return [
    {
      label: 'здоров’я',
      route: 'GET /health',
      run: async () => app.request('/health'),
    },
    {
      label: 'сесія',
      route: 'GET /me',
      run: async () => app.request('/me', { headers: auth }),
    },
    {
      label: 'сесія без токена',
      route: 'GET /me',
      run: async () => app.request('/me'),
    },
    {
      label: 'перелік каталогу',
      route: 'GET /datasets',
      run: async () => app.request('/datasets', { headers: auth }),
    },
    {
      label: 'перелік своїх',
      route: 'GET /datasets',
      run: async () => app.request('/datasets?owner=me', { headers: auth }),
    },
    {
      label: 'картка датасету',
      route: 'GET /datasets/:owner/:id',
      run: async () => app.request(`/datasets/${OWNER}/${DATASET_ID}`, { headers: auth }),
    },
    {
      label: 'картка неіснуючого',
      route: 'GET /datasets/:owner/:id',
      run: async () => app.request(`/datasets/${OWNER}/cohort-missing`, { headers: auth }),
    },
    {
      label: 'повторна реєстрація',
      route: 'POST /datasets',
      run: async () =>
        app.request('/datasets', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ datasetId: DATASET_ID, owner: OWNER }),
        }),
    },
    {
      label: 'повторне завантаження',
      route: 'PUT /datasets/:id/ciphertext',
      run: async () =>
        app.request(`/datasets/${DATASET_ID}/ciphertext`, {
          method: 'PUT',
          headers: auth,
          body: ciphertext,
        }),
    },
    {
      label: 'завантаження не конверта',
      route: 'PUT /datasets/:id/ciphertext',
      run: async () =>
        app.request(`/datasets/${DATASET_ID}/ciphertext`, {
          method: 'PUT',
          headers: auth,
          body: ciphertext.slice(0, 40),
        }),
    },
    {
      label: 'квота на прогін',
      route: 'POST /runs/quote',
      run: async () =>
        app.request('/runs/quote', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            recipeId: 1,
            useType: 'oncology',
            buyerCategory: 'academic',
            datasets: [{ owner: OWNER, datasetId: DATASET_ID }],
            params: {},
          }),
        }),
    },
    {
      label: 'квота з невідомим рецептом',
      route: 'POST /runs/quote',
      run: async () =>
        app.request('/runs/quote', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({
            recipeId: 7,
            useType: 'oncology',
            buyerCategory: 'academic',
            datasets: [{ owner: OWNER, datasetId: DATASET_ID }],
            params: {},
          }),
        }),
    },
    {
      label: 'стан платформи',
      route: 'GET /platform',
      run: async () => app.request('/platform'),
    },
    {
      label: 'замовлення прогону',
      route: 'POST /runs',
      run: async () =>
        app.request('/runs', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify(ORDER_BODY),
        }),
    },
    {
      label: 'замовлення зі стелею нижче ціни',
      route: 'POST /runs',
      run: async () =>
        app.request('/runs', {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ ...ORDER_BODY, maxEscrow: '1' }),
        }),
    },
    {
      label: 'стан прогону',
      route: 'GET /runs/:buyer/:nonce',
      run: async () => app.request(`/runs/${BUYER}/42`),
    },
    {
      label: 'стан неіснуючого прогону',
      route: 'GET /runs/:buyer/:nonce',
      run: async () => app.request(`/runs/${BUYER}/43`),
    },
    {
      label: 'невідомий маршрут',
      route: 'GET /health',
      run: async () => app.request('/no-such-route'),
    },
  ]
}

/** Кожен масив у відповіді, на будь-якій глибині. */
function arrays(value: unknown, found: unknown[][] = []): unknown[][] {
  if (Array.isArray(value)) {
    found.push(value)
    for (const item of value) arrays(item, found)
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) arrays(item, found)
  }
  return found
}

describe('жодна відповідь API не містить сирих записів', () => {
  it('простукує кожен зареєстрований маршрут', () => {
    // Хендлер і мідлвар потрапляють у таблицю окремими рядками — звідси
    // дедуплікація. Новий маршрут без проби валить саме цей тест, і це
    // єдина причина, з якої решта файлу щось доводить.
    const registered = new Set(app.routes.map((route) => `${route.method} ${route.path}`))
    const probed = new Set(probes().map((probe) => probe.route))

    expect([...registered].sort()).toEqual([...probed].sort())
  })

  it.each(probes())('$label не віддає кадру запису', async ({ run }) => {
    const response = await run()
    const text = await response.text()

    const hex = Buffer.from(frame).toString('hex')
    const base64 = Buffer.from(frame).toString('base64')

    expect(text).not.toContain(hex)
    expect(text).not.toContain(base64)
    // Латинська однобайтова інтерпретація ловить випадок, коли байти просто
    // потрапили в тіло як текст, без жодного кодування.
    expect(text).not.toContain(Buffer.from(frame).toString('latin1'))
  })

  it.each(probes())('$label не віддає шифротексту цілком', async ({ run }) => {
    // Шифротекст — не сирі записи, але відповідь, що його несе, робить сховище
    // зайвим: далі потрібен лише ключ, а він у власника (`FR-004a`).
    const response = await run()
    const text = await response.text()
    expect(text).not.toContain(Buffer.from(ciphertext).toString('base64'))
  })

  it.each(probes())('$label не віддає нічого завдовжки в кількість записів', async ({ run }) => {
    // Структурна перевірка на випадок, коли значення записів проїдуть у формі,
    // якої мітки не ловлять, — перерахованими, перекодованими, усередненими.
    const response = await run()
    const body: unknown = await response.json().catch(() => null)

    for (const array of arrays(body)) {
      expect(array).not.toHaveLength(RECORDS)
    }
  })
})
