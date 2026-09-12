import { Buffer } from 'node:buffer'
import {
  consentAddress,
  createProgram,
  datasetAddress,
  type RunAccount,
  type RunResultAccount,
} from '@genovault/sdk'
import {
  apiErrorSchema,
  BUYER_CATEGORIES,
  contentHash,
  type DatasetId,
  datasetIdSchema,
  LIMB_BYTES,
  NONCE_BYTES,
  platformViewSchema,
  pricePer1kSchema,
  runOrderSchema,
  runViewSchema,
  SCALAR_FIELD_COUNT,
  serializeEnvelope,
  solanaAddressSchema,
  USE_TYPES,
  X25519_KEY_BYTES,
} from '@genovault/shared'
import { Connection, PublicKey } from '@solana/web3.js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { AuthError, type TokenVerifier } from '../src/services/auth.ts'
import { type CatalogStore, memoryCatalog } from '../src/services/catalog.ts'
import {
  ChainStateError,
  createRegistrationBuilder,
  createRunOrderBuilder,
  deriveDatasetAddress,
  type QuoteChainState,
  type QuoteDatasetState,
} from '../src/services/chain.ts'
import type { StorageDriver } from '../src/services/storage.ts'

/**
 * `POST /runs`, `GET /runs/:buyer/:nonce`, `GET /platform` — `T029`.
 *
 * Збирач інструкції тут **справжній**: він не ходить у мережу (усе, що йому
 * потрібно, маршрут уже прочитав), тож підставляти його немає причин — а
 * підставлений він доводив би лише те, що маршрут викликає мок. Замість цього
 * інструкція розбирається назад кодувальником програми: саме там видно, що
 * стеля, ключ покупця й диспетчер доїхали тими полями, якими треба.
 *
 * Стан ланцюга й стан прогону підставні з тієї ж причини, що й у квоті: живі
 * читачі вимагали б піднятого валідатора з розгорнутою програмою.
 */

const OWNER = solanaAddressSchema.parse('11111111111111111111111111111112')
const MINT = solanaAddressSchema.parse('SysvarC1ock11111111111111111111111111111111')
const BUYER = solanaAddressSchema.parse('4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T')
const DISPATCHER = solanaAddressSchema.parse('So11111111111111111111111111111111111111112')
const OTHER_DISPATCHER = solanaAddressSchema.parse('7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2')
const USER = 'did:privy:clx0000000000000000000000'
const ALPHA = datasetIdSchema.parse('cohort-alpha')
const BETA = datasetIdSchema.parse('cohort-beta')
const RECORDS = 12
const MARKERS = 4
const PRICE = pricePer1kSchema.parse(1_500_000n)
const NOW = 1_735_689_600n
const CONSENT_VERSION = 3

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })

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
      limbs: Array.from({ length: fieldsPerRecord }, () => new Array<number>(LIMB_BYTES).fill(1)),
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

const CONSENT = {
  allowedUses: USE_TYPES.oncology,
  forbiddenUses: 0,
  buyerCategories: BUYER_CATEGORIES.academic,
  expiresAt: null,
  revoked: false,
} as const

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

function runAccount(patch: Partial<RunAccount> = {}): RunAccount {
  return {
    buyer: new PublicKey(BUYER),
    dispatcher: new PublicKey(DISPATCHER),
    nonce: 42n,
    recipeId: 1,
    // Вікно 40…70, стать «жіноча», ураженість «будь-яка».
    recipeParams: Uint8Array.from([40, 70, 0, 2, ...new Array<number>(28).fill(0)]),
    useType: USE_TYPES.oncology,
    buyerCategory: BUYER_CATEGORIES.academic,
    buyerX25519: new Uint8Array(32).fill(0x11),
    datasets: [
      {
        dataset: new PublicKey(deriveDatasetAddress(OWNER, ALPHA)),
        pricePer1k: PRICE,
        recordsIncluded: RECORDS,
        belowFloor: false,
        settled: true,
      },
      {
        // Датасету, якого каталог не знає: рядок мусить лишитися без назви.
        dataset: new PublicKey(deriveDatasetAddress(OWNER, BETA)),
        pricePer1k: 1n,
        recordsIncluded: 0,
        belowFloor: true,
        settled: false,
      },
    ],
    feeBps: 700,
    escrowAmount: 1_500_000n,
    settledCount: 1,
    settledAmount: 1_395_000n,
    refunded: false,
    status: 'running',
    resultHash: null,
    recordsIncluded: RECORDS,
    suppressed: false,
    datasetCursor: 1,
    foldedBatches: 3,
    foldedHash: 'a1'.repeat(32) as never,
    createdAt: NOW,
    bump: 254,
    ...patch,
  }
}

function runResult(): RunResultAccount {
  return {
    run: new PublicKey(BUYER),
    encryptionKey: new Uint8Array(32).fill(0x5c),
    nonce: 1n << 100n,
    ciphertexts: Array.from({ length: 24 }, (_unused, i) => new Uint8Array(32).fill(i)),
    recordsIncluded: RECORDS,
    suppressed: false,
    bump: 253,
  }
}

const readQuoteChain = vi.fn(
  async (_refs: unknown): Promise<QuoteChainState> => chainState([chainDataset(ALPHA)]),
)
const readRun = vi.fn(async (_buyer: unknown, nonce: bigint) => ({
  runAddress: BUYER,
  run: nonce === 42n ? runAccount() : null,
  result: null as RunResultAccount | null,
}))
const readPlatform = vi.fn(async () => ({
  programId: solanaAddressSchema.parse(program.programId.toBase58()),
  mint: MINT,
  feeBps: 700,
  paused: false,
}))

let catalog: CatalogStore
let app: ReturnType<typeof createApp>

/**
 * Застосунок із диспетчером або без нього.
 *
 * Параметр без значення за замовчуванням навмисно: `build(undefined)` із
 * дефолтом підставив би той самий диспетчер, і тест «платформа без
 * диспетчера» зеленів би на застосунку, у якого він є.
 */
function build(dispatcher: typeof DISPATCHER | null) {
  catalog = memoryCatalog()
  return createApp({
    verifyAccessToken: verify,
    catalog,
    storage: memoryStorage(),
    buildRegistration: createRegistrationBuilder('http://127.0.0.1:8899'),
    readChain: vi.fn(async () => ({ state: 'unregistered' }) as const),
    readQuoteChain,
    buildRunOrder: createRunOrderBuilder('http://127.0.0.1:8899'),
    readRun,
    readPlatform,
    ...(dispatcher === null ? {} : { dispatcher }),
    baseUrl: 'http://127.0.0.1:8879',
  })
}

beforeEach(() => {
  readQuoteChain.mockReset()
  readQuoteChain.mockImplementation(async () => chainState([chainDataset(ALPHA)]))
  readRun.mockReset()
  readRun.mockImplementation(async (_buyer: unknown, nonce: bigint) => ({
    runAddress: BUYER,
    run: nonce === 42n ? runAccount() : null,
    result: null,
  }))
  readPlatform.mockReset()
  readPlatform.mockImplementation(async () => ({
    programId: solanaAddressSchema.parse(program.programId.toBase58()),
    mint: MINT,
    feeBps: 700,
    paused: false,
  }))
  app = build(DISPATCHER)
})

/** Заводить датасет так, як це робить власник: метадані, потім байти. */
async function store(datasetId: DatasetId): Promise<void> {
  const bytes = envelope()
  await app.request('/datasets', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify({
      datasetId,
      owner: OWNER,
      contentHash: await contentHash(bytes),
      pricePer1k: PRICE.toString(),
      metadata: {
        title: 'Когорта альфа',
        description: 'Синтетична когорта для перевірок.',
        schema: [{ field: 'age', type: 'integer', description: 'Повних років' }],
        recordCount: RECORDS,
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

function order(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    buyer: BUYER,
    recipeId: 1,
    useType: 'oncology',
    buyerCategory: 'academic',
    datasets: [{ owner: OWNER, datasetId: ALPHA }],
    params: { minAge: 40, maxAge: 70 },
    nonce: '42',
    maxEscrow: '18000',
    buyerX25519: '11'.repeat(32),
    ...overrides,
  }
}

async function post(body: Record<string, unknown>): Promise<Response> {
  return app.request('/runs', {
    method: 'POST',
    headers: { ...auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Інструкція з відповіді — назад через кодувальник програми.
 *
 * Тип кодувальника описаний тут структурно, а не взятий із `@anchor-lang/core`:
 * `apps/api` цього пакета не залежить і не має починати залежати заради одного
 * приведення в тесті. Оголошений `InstructionCoder` уміє лише `encode`, хоча
 * borsh-кодувальник Anchor, який `Program` там і тримає, уміє й `decode`.
 */
interface Decoder {
  decode(data: Buffer): { name: string; data: unknown } | null
}

function decodeOrder(instruction: { data: string; accounts: { pubkey: string }[] }) {
  const coder = program.coder.instruction as unknown as Decoder
  const decoded = coder.decode(Buffer.from(instruction.data, 'base64'))
  expect(decoded).not.toBeNull()
  return (decoded as NonNullable<typeof decoded>).data as { args: Record<string, unknown> }
}

describe('POST /runs', () => {
  it('віддає неспідписану інструкцію, у якій підписант лише покупець', async () => {
    await store(ALPHA)
    const response = await post(order())

    expect(response.status).toBe(201)
    const body = runOrderSchema.parse(await response.json())

    // Правило репозиторію: API не підписує транзакцій. Тут воно перевіряється
    // не коментарем, а складом акаунтів.
    const signers = body.instruction.accounts.filter((a) => a.isSigner)
    expect(signers.map((a) => a.pubkey)).toEqual([BUYER])
    expect(body.instruction.programId).toBe(program.programId.toBase58())
    // Готової транзакції немає: `recentBlockhash` бере той, хто підписує.
    expect(Object.keys(body.instruction).sort()).toEqual(['accounts', 'data', 'programId'])
  })

  it('аргументи доїжджають до кодувальника тими полями, якими треба', async () => {
    await store(ALPHA)
    const body = runOrderSchema.parse(await (await post(order())).json())
    const args = decodeOrder(body.instruction).args

    expect(String(args.nonce)).toBe('42')
    expect(String(args.maxEscrow)).toBe('18000')
    expect((args.dispatcher as PublicKey).toBase58()).toBe(DISPATCHER)
    expect(Array.from(args.buyerX25519 as number[])).toEqual(new Array(32).fill(0x11))
    // Вікові межі з параметрів рецепта, далі два «будь-який» і нулі.
    expect(Array.from(args.recipeParams as number[]).slice(0, 4)).toEqual([40, 70, 2, 2])
  })

  it('склад пулу їде парами «датасет + чинна згода»', async () => {
    // Версія береться з ланцюга, а не «остання, яку бачив клієнт»: програма
    // вимагає чинну, і стара пройшла б перевірку API, але не мережі.
    await store(ALPHA)
    const body = runOrderSchema.parse(await (await post(order())).json())

    const dataset = datasetAddress(new PublicKey(OWNER), ALPHA, program.programId).address
    const consent = consentAddress(dataset, CONSENT_VERSION, program.programId).address
    const tail = body.instruction.accounts.slice(8).map((a) => a.pubkey)

    expect(tail).toEqual([dataset.toBase58(), consent.toBase58()])
    expect(body.datasets[0]?.consentVersion).toBe(CONSENT_VERSION)
  })

  it('називає ту саму суму, що й квота, і повертає її разом зі стелею', async () => {
    await store(ALPHA)
    const body = runOrderSchema.parse(await (await post(order())).json())

    // 12 записів за ціною 1 500 000 за тисячу — округлення вгору до однієї тисячі.
    expect(body.escrow).toBe('18000')
    expect(body.maxEscrow).toBe('18000')
    expect(body.feeBps).toBe(700)
    expect(body.currency).toBe(MINT)
  })

  it('диспетчер платформи підставляється, але покупець може назвати свого', async () => {
    await store(ALPHA)

    const byDefault = runOrderSchema.parse(await (await post(order())).json())
    expect(byDefault.dispatcher).toBe(DISPATCHER)

    const named = runOrderSchema.parse(
      await (await post(order({ dispatcher: OTHER_DISPATCHER }))).json(),
    )
    expect(named.dispatcher).toBe(OTHER_DISPATCHER)
    expect((decodeOrder(named.instruction).args.dispatcher as PublicKey).toBase58()).toBe(
      OTHER_DISPATCHER,
    )
  })

  it('без диспетчера взагалі — відмова, а не мовчазна підстановка', async () => {
    // Платформа без диспетчера законна; прогін без нього — ні. Мовчазний
    // нуль дав би прогін, якого ніхто не зрушить, і виявилось би це після оплати.
    app = build(null)
    await store(ALPHA)

    const response = await post(order())
    expect(response.status).toBe(400)
    expect(apiErrorSchema.parse(await response.json()).error.message).toContain('диспетчера')
  })

  it('непридатний датасет відмовляє названою причиною, і всі одразу', async () => {
    await store(ALPHA)
    readQuoteChain.mockImplementation(async () =>
      chainState([
        chainDataset(ALPHA, { consent: { ...CONSENT, revoked: true } }),
        chainDataset(BETA, { dataset: null }),
      ]),
    )

    const response = await post(
      order({
        datasets: [
          { owner: OWNER, datasetId: ALPHA },
          { owner: OWNER, datasetId: BETA },
        ],
      }),
    )

    expect(response.status).toBe(403)
    const error = apiErrorSchema.parse(await response.json()).error
    expect(error.code).toBe('CONSENT_VIOLATION')
    expect(error.details?.ineligible).toEqual([
      { owner: OWNER, datasetId: ALPHA, reason: 'revoked' },
      { owner: OWNER, datasetId: BETA, reason: 'unregistered' },
    ])
  })

  it('стеля нижча за ціну — 409, і в деталях сама ціна', async () => {
    await store(ALPHA)
    const response = await post(order({ maxEscrow: '17999' }))

    expect(response.status).toBe(409)
    const error = apiErrorSchema.parse(await response.json()).error
    expect(error.code).toBe('INSUFFICIENT_ESCROW')
    expect(error.details).toMatchObject({ refusal: 'escrow-below-price', escrow: '18000' })
  })

  it('пауза платформи — окремий код, а не «поламаний запит»', async () => {
    await store(ALPHA)
    readQuoteChain.mockImplementation(async () =>
      chainState([chainDataset(ALPHA)], { paused: true }),
    )

    const response = await post(order())
    expect(response.status).toBe(409)
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('PLATFORM_PAUSED')
  })

  it('дублікат у складі відхиляється тут, а не транзакцією', async () => {
    // Програма його теж відхилить (`Run::validate_datasets`), але покупець
    // дізнався б про це, вже зібравши форму й підписавши.
    await store(ALPHA)
    const response = await post(
      order({
        datasets: [
          { owner: OWNER, datasetId: ALPHA },
          { owner: OWNER, datasetId: ALPHA },
        ],
      }),
    )

    expect(response.status).toBe(400)
    expect(apiErrorSchema.parse(await response.json()).error.message).toContain('двічі')
  })

  it('невідомий рецепт і поламані параметри не доходять до мережі', async () => {
    await store(ALPHA)

    expect((await post(order({ recipeId: 7 }))).status).toBe(400)
    // Перевернуте вікове вікно дає когорту з нуля записів; програма це теж
    // відхиляє, але вже після того, як покупець підписав.
    expect((await post(order({ params: { minAge: 70, maxAge: 40 } }))).status).toBe(400)
  })

  it('без мережі замовлення немає — 503, а не 500', async () => {
    await store(ALPHA)
    readQuoteChain.mockImplementation(async () => {
      throw new ChainStateError('unavailable', 'вузол мережі не відповів')
    })

    const response = await post(order())
    expect(response.status).toBe(503)
    expect(apiErrorSchema.parse(await response.json()).error.code).toBe('UPSTREAM_UNAVAILABLE')
  })

  it('без токена — 401', async () => {
    const response = await app.request('/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(order()),
    })

    expect(response.status).toBe(401)
  })
})

describe('GET /runs/:buyer/:nonce', () => {
  it('віддає стан прогону з ланцюга, з назвами з каталогу', async () => {
    await store(ALPHA)
    const response = await app.request(`/runs/${BUYER}/42`)

    expect(response.status).toBe(200)
    const view = runViewSchema.parse(await response.json())

    expect(view.status).toBe('running')
    expect(view.buyer).toBe(BUYER)
    expect(view.nonce).toBe('42')
    expect(view.dispatcher).toBe(DISPATCHER)
    expect(view.recipe).toBe('frequencies')
    expect(view.params).toMatchObject({ minAge: 40, maxAge: 70, sex: 'female', affected: 'any' })
    expect(view.escrowAmount).toBe('1500000')
    expect(view.foldedBatches).toBe(3)
    expect(view.datasets[0]).toMatchObject({ title: 'Когорта альфа', datasetId: ALPHA })
  })

  it('датасет, якого каталог не знає, лишається рядком без назви', async () => {
    // За нього вже заплачено; рядок з адресою чесніший за відсутній.
    await store(ALPHA)
    const view = runViewSchema.parse(await (await app.request(`/runs/${BUYER}/42`)).json())
    const second = view.datasets[1]

    expect(second?.title).toBeUndefined()
    expect(second?.datasetAddress).toBe(deriveDatasetAddress(OWNER, BETA))
    // Внесок нижче порога видно окремо від нульового внеску (`T019`).
    expect(second).toMatchObject({ recordsIncluded: 0, belowFloor: true, settled: false })
  })

  it('доки розкриття не було, звіт це `null`, а не помилка', async () => {
    const view = runViewSchema.parse(await (await app.request(`/runs/${BUYER}/42`)).json())
    expect(view.result).toBeNull()
    expect(view.resultHash).toBeNull()
  })

  it('після розкриття віддає шифротексти звіту й ключ MXE', async () => {
    readRun.mockImplementation(async () => ({
      runAddress: BUYER,
      run: runAccount({ status: 'completed', resultHash: '0f'.repeat(32) as never }),
      result: runResult(),
    }))

    const view = runViewSchema.parse(await (await app.request(`/runs/${BUYER}/42`)).json())

    expect(view.status).toBe('completed')
    expect(view.result?.ciphertexts).toHaveLength(24)
    expect(view.result?.encryptionKey).toBe('5c'.repeat(32))
    // Нонс ширший за u64 — рядком, інакше його не відновити.
    expect(view.result?.nonce).toBe((1n << 100n).toString())
  })

  it('прогону немає — 404; нонс не число — 400', async () => {
    expect((await app.request(`/runs/${BUYER}/43`)).status).toBe(404)
    expect((await app.request(`/runs/${BUYER}/abc`)).status).toBe(400)
  })

  it('відкривається без токена', async () => {
    // Обидва акаунти публічні в мережі, і `FR-025` вимагає незалежної звірки.
    const response = await app.request(`/runs/${BUYER}/42`)
    expect(response.status).toBe(200)
  })
})

describe('GET /platform', () => {
  it('називає комісію, мінт і диспетчера — без токена', async () => {
    const response = await app.request('/platform')

    expect(response.status).toBe(200)
    const view = platformViewSchema.parse(await response.json())

    expect(view.feeBps).toBe(700)
    expect(view.mint).toBe(MINT)
    expect(view.paused).toBe(false)
    expect(view.dispatcher).toBe(DISPATCHER)
  })

  it('платформа без диспетчера каже про це `null`, а не мовчить', async () => {
    app = build(null)
    const view = platformViewSchema.parse(await (await app.request('/platform')).json())

    expect(view.dispatcher).toBeNull()
  })

  it('нерозгорнута платформа — не 200 з нулями', async () => {
    readPlatform.mockImplementation(async () => {
      throw new ChainStateError('not-initialized', 'конфігурації платформи немає в мережі')
    })

    expect((await app.request('/platform')).status).toBe(500)
  })
})
