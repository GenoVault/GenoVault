import type { BorshInstructionCoder } from '@anchor-lang/core'
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { fromBn, U64_MAX } from '../src/convert.ts'
import {
  initializeIx,
  registerDatasetIx,
  retireDatasetIx,
  revokeConsentIx,
  setConsentIx,
  setDatasetPriceIx,
  updateDatasetContentIx,
} from '../src/instructions.ts'
import { consentAddress, datasetAddress } from '../src/pda.ts'
import { createProgram, PROGRAM_ID } from '../src/program.ts'

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })
const OWNER = new PublicKey('7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2')
const HASH = '3b'.repeat(32)

/**
 * Кожен білдер тут проганяється через `decode` власного кодувальника.
 *
 * Не формальність: кодувальник Anchor на відсутнє поле пише нуль і не падає.
 * Ціна `0` за тисячу записів або `expires_at = 0` замість «без строку» — це
 * не виняток на етапі збирання транзакції, а тихо неправильний акаунт у
 * ланцюгу. Round-trip ловить це там, де воно ще нічого не коштує.
 */
async function roundTrip(ix: Awaited<ReturnType<typeof registerDatasetIx>>) {
  // Інтерфейс `InstructionCoder` оголошує лише `encode`, хоча borsh-кодувальник
  // Anchor уміє й `decode`. Звуження типу, а не `any`: беремо ту реалізацію,
  // яку `Program` там і тримає.
  const coder = program.coder.instruction as BorshInstructionCoder
  const decoded = coder.decode(ix.data)
  expect(decoded).not.toBeNull()
  return decoded as NonNullable<typeof decoded>
}

describe('інструкції', () => {
  it('усі повертаються неспідписаними і підписантом стоїть лише власник', async () => {
    // Правило репозиторію: API не підписує транзакцій. Тому білдер віддає
    // рівно інструкцію, а єдиний підписант у ній — той, чиї це дані.
    const ix = await registerDatasetIx(program, {
      owner: OWNER,
      datasetId: 'cohort-alpha',
      contentHash: HASH,
      recordCountClaimed: 10_000n,
      pricePer1k: 250_000n,
    })

    expect(ix.programId.equals(PROGRAM_ID)).toBe(true)
    expect(ix.keys.filter((key) => key.isSigner).map((key) => key.pubkey.toBase58())).toEqual([
      OWNER.toBase58(),
    ])
    expect(ix.keys.map((key) => key.pubkey.toBase58())).toContain(
      SystemProgram.programId.toBase58(),
    )
  })

  it('registerDataset доїжджає до кодувальника без втрат', async () => {
    const decoded = await roundTrip(
      await registerDatasetIx(program, {
        owner: OWNER,
        datasetId: 'cohort-alpha',
        contentHash: HASH,
        recordCountClaimed: 10_000n,
        pricePer1k: 250_000n,
      }),
    )

    const args = (decoded.data as { args: Record<string, unknown> }).args
    expect(args.datasetId).toBe('cohort-alpha')
    expect(fromBn(args.recordCountClaimed as never)).toBe(10_000n)
    expect(fromBn(args.pricePer1k as never)).toBe(250_000n)
    expect(Array.from(args.contentHash as number[])).toEqual(Array.from({ length: 32 }, () => 0x3b))
  })

  it('u64 переживає межу без округлення', async () => {
    // 2^53 тут не межа, а помилка: `number` втратив би точність мовчки, і
    // втратив би її саме на сумі до сплати.
    const decoded = await roundTrip(
      await setDatasetPriceIx(program, {
        owner: OWNER,
        datasetId: 'cohort-alpha',
        pricePer1k: U64_MAX,
      }),
    )

    expect(fromBn((decoded.data as { pricePer1k: never }).pricePer1k)).toBe(U64_MAX)
    await expect(
      setDatasetPriceIx(program, {
        owner: OWNER,
        datasetId: 'cohort-alpha',
        pricePer1k: U64_MAX + 1n,
      }),
    ).rejects.toThrow(RangeError)
  })

  it('updateDatasetContent несе обидва аргументи', async () => {
    const decoded = await roundTrip(
      await updateDatasetContentIx(program, {
        owner: OWNER,
        datasetId: 'cohort-alpha',
        contentHash: 'ff'.repeat(32),
        recordCountClaimed: 12_500n,
      }),
    )

    const data = decoded.data as { contentHash: number[]; recordCountClaimed: never }
    expect(Array.from(data.contentHash)).toEqual(Array.from({ length: 32 }, () => 0xff))
    expect(fromBn(data.recordCountClaimed)).toBe(12_500n)
  })

  it('retireDataset і revokeConsent не мають аргументів, але мають правильні акаунти', async () => {
    const dataset = datasetAddress(OWNER, 'cohort-alpha').address

    const retire = await retireDatasetIx(program, { owner: OWNER, datasetId: 'cohort-alpha' })
    expect((await roundTrip(retire)).name).toBe('retireDataset')
    expect(retire.keys.map((key) => key.pubkey.toBase58())).toContain(dataset.toBase58())

    const revoke = await revokeConsentIx(program, {
      owner: OWNER,
      datasetId: 'cohort-alpha',
      currentVersion: 2,
    })
    expect((await roundTrip(revoke)).name).toBe('revokeConsent')
    expect(revoke.keys.map((key) => key.pubkey.toBase58())).toContain(
      consentAddress(dataset, 2).address.toBase58(),
    )
  })

  it('перша згода йде без попередньої версії', async () => {
    const dataset = datasetAddress(OWNER, 'cohort-alpha').address
    const ix = await setConsentIx(program, {
      owner: OWNER,
      datasetId: 'cohort-alpha',
      currentVersion: 0,
      allowedUses: 0b0011,
      forbiddenUses: 0b0100,
      buyerCategories: 0b0001,
      expiresAt: null,
    })

    const addresses = ix.keys.map((key) => key.pubkey.toBase58())
    expect(addresses).toContain(consentAddress(dataset, 1).address.toBase58())
    // Попередньої немає — Anchor кладе на її місце саму програму, а не
    // «якийсь акаунт»: версії 0 у ланцюгу не існує.
    expect(addresses).not.toContain(consentAddress(dataset, 0).address.toBase58())

    const decoded = await roundTrip(ix)
    const args = (decoded.data as { args: Record<string, unknown> }).args
    expect(args.allowedUses).toBe(0b0011)
    expect(args.forbiddenUses).toBe(0b0100)
    expect(args.buyerCategories).toBe(0b0001)
    // `null`, а не 0: «без строку» і «спливла 1 січня 1970» — різні згоди.
    expect(args.expiresAt).toBeNull()
  })

  it('строк згоди доїжджає значенням, а не нулем', async () => {
    const decoded = await roundTrip(
      await setConsentIx(program, {
        owner: OWNER,
        datasetId: 'cohort-alpha',
        currentVersion: 1,
        allowedUses: 1,
        forbiddenUses: 0,
        buyerCategories: 1,
        expiresAt: 1_800_000_000n,
      }),
    )

    const args = (decoded.data as { args: { expiresAt: never } }).args
    expect(fromBn(args.expiresAt)).toBe(1_800_000_000n)
  })

  it('initialize перевіряє межу u16 для комісії', async () => {
    const decoded = await roundTrip(
      await initializeIx(program, {
        authority: OWNER,
        mint: Keypair.generate().publicKey,
        feeBps: 250,
      }),
    )
    expect((decoded.data as { feeBps: number }).feeBps).toBe(250)

    await expect(
      initializeIx(program, {
        authority: OWNER,
        mint: Keypair.generate().publicKey,
        feeBps: 70_000,
      }),
    ).rejects.toThrow(RangeError)
  })

  it('непридатний відбиток не доходить до ланцюга', async () => {
    await expect(
      registerDatasetIx(program, {
        owner: OWNER,
        datasetId: 'cohort-alpha',
        contentHash: 'не hex',
        recordCountClaimed: 1n,
        pricePer1k: 1n,
      }),
    ).rejects.toThrow(ZodError)
  })
})
