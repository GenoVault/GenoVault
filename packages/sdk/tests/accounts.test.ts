import { BN } from '@anchor-lang/core'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import {
  decodeConsent,
  decodeDataset,
  decodePlatformConfig,
  decodeRun,
  decodeRunResult,
  fetchConsents,
  fetchDatasets,
} from '../src/accounts.ts'
import { bytesToHash, fromBnOption, hashToBytes, toBn, U64_MAX } from '../src/convert.ts'
import { createProgram } from '../src/program.ts'

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })
const OWNER = new PublicKey('7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2')
const DISPATCHER = new PublicKey('So11111111111111111111111111111111111111112')

/**
 * Акаунти тут проходять через справжній borsh-кодувальник програми.
 *
 * Об'єкт, зібраний руками, довів би лише, що наш нормалізатор перекладає
 * поля з одного літерала в інший. Прогін через `coder.accounts` перевіряє те,
 * що справді може розійтися: порядок і форму полів у бінарному поданні, з
 * яким ми зустрінемось у ланцюгу.
 */
async function roundTripDataset(fields: Record<string, unknown>) {
  const encoded = await program.coder.accounts.encode('dataset', fields)
  return program.coder.accounts.decode('dataset', encoded)
}

const DATASET_FIELDS = {
  owner: OWNER,
  datasetId: 'cohort-alpha',
  version: 3,
  contentHash: hashToBytes('7c'.repeat(32)),
  recordCountClaimed: toBn(10_000n),
  pricePer1k: toBn(250_000n),
  consentVersion: 2,
  status: { active: {} },
  verifiedBadge: null,
  bump: 254,
}

const CONSENT_FIELDS = {
  dataset: OWNER,
  version: 1,
  allowedUses: 0b0011,
  forbiddenUses: 0b0100,
  buyerCategories: 0b0001,
  expiresAt: null,
  revokedAt: null,
  prevVersion: null,
  bump: 253,
}

describe('декодування акаунтів', () => {
  it('датасет доїжджає з ланцюга без втрат', async () => {
    const account = decodeDataset(await roundTripDataset(DATASET_FIELDS))

    expect(account.owner.equals(OWNER)).toBe(true)
    expect(account.datasetId).toBe('cohort-alpha')
    expect(account.version).toBe(3)
    expect(account.contentHash).toBe('7c'.repeat(32))
    expect(account.recordCountClaimed).toBe(10_000n)
    expect(account.pricePer1k).toBe(250_000n)
    expect(account.consentVersion).toBe(2)
    expect(account.status).toBe('active')
    expect(account.verifiedBadge).toBeNull()
    // bigint, не BN: `BN`, що просочився далі, рано чи пізно пройде через
    // `Number()` і мовчки округлить нарахування.
    expect(typeof account.recordCountClaimed).toBe('bigint')
  })

  it('u64 на межі не округлюється дорогою', async () => {
    const account = decodeDataset(
      await roundTripDataset({ ...DATASET_FIELDS, pricePer1k: toBn(U64_MAX) }),
    )
    expect(account.pricePer1k).toBe(U64_MAX)
  })

  it('знятий датасет читається як retired, а позначка — як дані', async () => {
    const verifier = Keypair.generate().publicKey
    const account = decodeDataset(
      await roundTripDataset({
        ...DATASET_FIELDS,
        status: { retired: {} },
        verifiedBadge: { verifier, verifiedAt: toBn(1_700_000_000n) },
      }),
    )

    expect(account.status).toBe('retired')
    expect(account.verifiedBadge?.verifier.equals(verifier)).toBe(true)
    expect(account.verifiedBadge?.verifiedAt).toBe(1_700_000_000n)
  })

  it('невідомий статус падає тут, а не перетворюється на undefined', () => {
    expect(() => decodeDataset({ ...DATASET_FIELDS, status: { archived: {} } } as never)).toThrow(
      /невідомий статус/,
    )
  })

  it('ідентифікатор із ланцюга теж проходить схему', () => {
    // Акаунт міг створити не наш код. Довжина seed цього не звужує: 32 байти
    // seed вміщають і те, чого `datasetIdSchema` не приймає.
    expect(() => decodeDataset({ ...DATASET_FIELDS, datasetId: 'ВЕЛИКІ' } as never)).toThrow(
      ZodError,
    )
  })

  it('згода: чинна відрізняється від відкликаної, а «без строку» — від нуля', async () => {
    const dataset = Keypair.generate().publicKey
    const encode = (fields: Record<string, unknown>) =>
      program.coder.accounts
        .encode('consent', fields)
        .then((bytes) => program.coder.accounts.decode('consent', bytes))

    const base = {
      dataset,
      version: 1,
      allowedUses: 0b0011,
      forbiddenUses: 0b0100,
      buyerCategories: 0b0001,
      expiresAt: null,
      revokedAt: null,
      prevVersion: null,
      bump: 253,
    }

    const active = decodeConsent(await encode(base))
    expect(active.expiresAt).toBeNull()
    expect(active.revokedAt).toBeNull()
    expect(active.prevVersion).toBeNull()

    const revoked = decodeConsent(
      await encode({
        ...base,
        version: 2,
        expiresAt: toBn(1_900_000_000n),
        revokedAt: toBn(1_800_000_000n),
        prevVersion: dataset,
      }),
    )
    expect(revoked.expiresAt).toBe(1_900_000_000n)
    expect(revoked.revokedAt).toBe(1_800_000_000n)
    expect(revoked.prevVersion?.equals(dataset)).toBe(true)
  })

  it('конфігурація платформи читається як є', async () => {
    const authority = Keypair.generate().publicKey
    const mint = Keypair.generate().publicKey
    const encoded = await program.coder.accounts.encode('platformConfig', {
      authority,
      mint,
      feeBps: 250,
      paused: true,
      bump: 255,
    })

    const config = decodePlatformConfig(program.coder.accounts.decode('platformConfig', encoded))
    expect(config.authority.equals(authority)).toBe(true)
    expect(config.mint.equals(mint)).toBe(true)
    expect(config.feeBps).toBe(250)
    expect(config.paused).toBe(true)
  })
})

describe('перетворення на межі з Anchor', () => {
  it('відбиток ходить в обидва боки', () => {
    const hex = '0a1b'.repeat(16)
    expect(bytesToHash(hashToBytes(hex))).toBe(hex)
    expect(() => hashToBytes('коротко')).toThrow(ZodError)
    expect(() => bytesToHash([1, 2, 3])).toThrow(ZodError)
  })

  it('u64 не приймає від’ємного і завеликого', () => {
    expect(() => toBn(-1n)).toThrow(RangeError)
    expect(() => toBn(U64_MAX + 1n)).toThrow(RangeError)
    expect(toBn(U64_MAX).toString(10)).toBe(U64_MAX.toString(10))
  })

  it('Option<i64> не приймає чого завгодно замість BN', () => {
    // Згенерований тип IDL подає Option<i64> як `any` — тобто типом ця межа
    // не тримається взагалі, і перевірка мусить бути в рантаймі.
    expect(fromBnOption(null)).toBeNull()
    expect(fromBnOption(undefined)).toBeNull()
    expect(fromBnOption(new BN('1700000000'))).toBe(1_700_000_000n)
    expect(() => fromBnOption('1700000000')).toThrow(TypeError)
    expect(() => fromBnOption(1_700_000_000)).toThrow(TypeError)
  })
})

describe('читання пачкою', () => {
  /**
   * Мережа тут підставна, і перевіряється не вона.
   *
   * Пакетне читання може зіпсувати рівно дві речі, і обидві мовчазні: збити
   * порядок і загубити `null`. Перше віддало б ціни не тим датасетам, друге
   * перетворило б незареєстрований датасет на сусідній.
   */
  it('зберігає порядок і `null` на місці відсутнього акаунта', async () => {
    const encoded = await program.coder.accounts.encode('dataset', DATASET_FIELDS)
    const decoded = program.coder.accounts.decode('dataset', encoded)

    const fetchMultiple = vi
      .spyOn(program.account.dataset, 'fetchMultiple')
      .mockResolvedValue([decoded, null, decoded])

    const accounts = await fetchDatasets(program, [OWNER, OWNER, OWNER])

    expect(accounts).toHaveLength(3)
    expect(accounts[0]?.datasetId).toBe('cohort-alpha')
    expect(accounts[1]).toBeNull()
    expect(accounts[2]?.pricePer1k).toBe(250_000n)
    // Один обхід мережі на будь-який розмір пулу — заради цього все й робилось.
    expect(fetchMultiple).toHaveBeenCalledTimes(1)

    fetchMultiple.mockRestore()
  })

  it('порожній список не звертається до мережі даремно', async () => {
    const fetchMultiple = vi.spyOn(program.account.consent, 'fetchMultiple').mockResolvedValue([])

    expect(await fetchConsents(program, [])).toEqual([])
    fetchMultiple.mockRestore()
  })

  it('згоди декодуються так само, як поодинці', async () => {
    const encoded = await program.coder.accounts.encode('consent', CONSENT_FIELDS)
    const decoded = program.coder.accounts.decode('consent', encoded)

    const fetchMultiple = vi
      .spyOn(program.account.consent, 'fetchMultiple')
      .mockResolvedValue([decoded])

    const [consent] = await fetchConsents(program, [OWNER])

    expect(consent).toEqual(decodeConsent(decoded))
    fetchMultiple.mockRestore()
  })
})

/**
 * Прогін і його звіт (`T029`).
 *
 * Той самий прогін через кодувальник: `Run` — найбільший акаунт програми, і
 * помилка в порядку полів тут проявилась би не винятком, а числом внеску,
 * зчитаним із поля комісії.
 */
const RUN_FIELDS = {
  buyer: OWNER,
  dispatcher: DISPATCHER,
  nonce: toBn(42n),
  recipeId: 1,
  recipeParams: Array.from({ length: 32 }, (_, i) => (i < 4 ? [40, 70, 2, 2][i] : 0)),
  useType: 0b0010,
  buyerCategory: 0b0001,
  buyerX25519: Array.from({ length: 32 }, (_, i) => i + 1),
  datasets: [
    {
      dataset: OWNER,
      pricePer1k: toBn(250_000n),
      recordsIncluded: 8_120,
      belowFloor: false,
      settled: true,
    },
    {
      dataset: DISPATCHER,
      pricePer1k: toBn(1n),
      recordsIncluded: 0,
      belowFloor: true,
      settled: false,
    },
  ],
  feeBps: 700,
  escrowAmount: toBn(88_200n),
  settledCount: 1,
  settledAmount: toBn(49_440n),
  refunded: false,
  status: { running: {} },
  resultHash: null,
  recordsIncluded: 8_120,
  suppressed: false,
  datasetCursor: 1,
  foldedBatches: 254,
  foldedHash: hashToBytes('a1'.repeat(32)),
  createdAt: toBn(1_757_000_000n),
  bump: 252,
}

const RESULT_FIELDS = {
  run: OWNER,
  encryptionKey: Array.from({ length: 32 }, () => 0x5c),
  // u128, а не u64: нонс шифру ширший за все інше в програмі, і `toBn` сюди
  // не годиться — він відхиляє все, що не вміщається в u64.
  nonce: new BN((1n << 100n).toString(10), 10),
  // Тринадцять, а не двадцять чотири: вивід MPC повертається однією
  // транзакцією, і `T030` зрізав звіт до 76 польових елементів.
  ciphertexts: Array.from({ length: 13 }, (_, i) => Array.from({ length: 32 }, () => i)),
  recordsIncluded: 8_120,
  suppressed: false,
  bump: 251,
}

describe('декодування прогону', () => {
  it('прогін доїжджає з ланцюга без втрат', async () => {
    const encoded = await program.coder.accounts.encode('run', RUN_FIELDS)
    const run = decodeRun(program.coder.accounts.decode('run', encoded))

    expect(run.buyer.equals(OWNER)).toBe(true)
    expect(run.dispatcher.equals(DISPATCHER)).toBe(true)
    expect(run.nonce).toBe(42n)
    expect(run.status).toBe('running')
    expect(run.escrowAmount).toBe(88_200n)
    expect(run.settledAmount).toBe(49_440n)
    expect(run.feeBps).toBe(700)
    expect(run.resultHash).toBeNull()
    expect(run.foldedHash).toBe('a1'.repeat(32))
    expect(run.createdAt).toBe(1_757_000_000n)
    expect(Array.from(run.buyerX25519)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1))
    expect(Array.from(run.recipeParams.slice(0, 4))).toEqual([40, 70, 2, 2])
  })

  it('розрізняє «не дав записів» і «дав, але замало»', async () => {
    // Для гаманця це однакові нулі, для власника на екрані нарахувань — ні.
    const encoded = await program.coder.accounts.encode('run', RUN_FIELDS)
    const run = decodeRun(program.coder.accounts.decode('run', encoded))

    expect(run.datasets).toHaveLength(2)
    expect(run.datasets[0]).toMatchObject({
      pricePer1k: 250_000n,
      recordsIncluded: 8_120,
      belowFloor: false,
      settled: true,
    })
    expect(run.datasets[1]).toMatchObject({
      recordsIncluded: 0,
      belowFloor: true,
      settled: false,
    })
  })

  it("усі п'ять статусів мають ім'я, а шостого не буває", async () => {
    for (const [variant, name] of [
      ['accepted', 'accepted'],
      ['running', 'running'],
      ['completed', 'completed'],
      ['rejected', 'rejected'],
      ['failed', 'failed'],
    ] as const) {
      const encoded = await program.coder.accounts.encode('run', {
        ...RUN_FIELDS,
        status: { [variant]: {} },
      })
      expect(decodeRun(program.coder.accounts.decode('run', encoded)).status).toBe(name)
    }

    expect(() => decodeRun({ ...RUN_FIELDS, status: { settling: {} } } as never)).toThrow(
      /невідомий статус прогону/,
    )
  })

  it("відбиток результату з'являється разом із callback'ом", async () => {
    const encoded = await program.coder.accounts.encode('run', {
      ...RUN_FIELDS,
      status: { completed: {} },
      resultHash: hashToBytes('0f'.repeat(32)),
      refunded: true,
    })
    const run = decodeRun(program.coder.accounts.decode('run', encoded))

    expect(run.resultHash).toBe('0f'.repeat(32))
    expect(run.refunded).toBe(true)
  })

  it('звіт несе ключ, нонс u128 і всі шифротексти', async () => {
    const encoded = await program.coder.accounts.encode('runResult', RESULT_FIELDS)
    const result = decodeRunResult(program.coder.accounts.decode('runResult', encoded))

    expect(result.run.equals(OWNER)).toBe(true)
    // Нонс ширший за u64: через `Number()` тут утратилась би сама можливість
    // розшифрувати звіт.
    expect(result.nonce).toBe(1n << 100n)
    expect(result.ciphertexts).toHaveLength(13)
    expect(result.ciphertexts.every((c) => c.length === 32)).toBe(true)
    expect(Array.from(result.ciphertexts[12] as Uint8Array)).toEqual(
      Array.from({ length: 32 }, () => 12),
    )
    expect(Array.from(result.encryptionKey)).toEqual(Array.from({ length: 32 }, () => 0x5c))
    expect(result.recordsIncluded).toBe(8_120)
    expect(result.suppressed).toBe(false)
  })
})
