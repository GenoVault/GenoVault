import { BN } from '@anchor-lang/core'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import {
  decodeConsent,
  decodeDataset,
  decodePlatformConfig,
  fetchConsents,
  fetchDatasets,
} from '../src/accounts.ts'
import { bytesToHash, fromBnOption, hashToBytes, toBn, U64_MAX } from '../src/convert.ts'
import { createProgram } from '../src/program.ts'

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })
const OWNER = new PublicKey('7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2')

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
