import { BN } from '@anchor-lang/core'
import { createProgram } from '@genovault/sdk'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import { BorshError, Reader, stripDiscriminator } from '../src/borsh.ts'
import { decodeRun, decodeRunResult, REPORT_CIPHERTEXTS, RUN_DISCRIMINATOR } from '../src/chain.ts'

/**
 * Звіряч читає ланцюг власним кодом; звірити цей код можна лише з тим, який
 * туди пише. Кодувальник Anchor тут — **еталон**, а не залежність звіряча:
 * він живе в `devDependencies` і в рантайм не потрапляє (`independence.test.ts`).
 *
 * Без цього тесту розбіжність вилізла б живим прогоном — і виглядала б як
 * «ланцюжок відбитків не зійшовся», тобто як підміна даних, а не як зсув на
 * один байт у читачі.
 */
const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })

function bytes(fill: number, length = 32): number[] {
  return Array.from({ length }, (_, index) => (fill + index) % 256)
}

const DATASETS = [Keypair.generate().publicKey, Keypair.generate().publicKey]

const rawRun = {
  buyer: Keypair.generate().publicKey,
  dispatcher: Keypair.generate().publicKey,
  nonce: new BN('18446744073709551615'),
  recipeId: 1,
  recipeParams: bytes(7),
  useType: 8,
  buyerCategory: 1,
  buyerX25519: bytes(33),
  datasets: [
    {
      dataset: DATASETS[0],
      pricePer1k: new BN(1_000),
      recordsIncluded: 64,
      belowFloor: false,
      settled: true,
    },
    {
      dataset: DATASETS[1],
      pricePer1k: new BN(2_000),
      recordsIncluded: 0,
      belowFloor: true,
      settled: false,
    },
  ],
  feeBps: 250,
  escrowAmount: new BN('9007199254740993'),
  settledCount: 1,
  settledAmount: new BN(128),
  refunded: false,
  status: { completed: {} },
  resultHash: bytes(200),
  recordsIncluded: 73,
  suppressed: false,
  datasetCursor: 2,
  foldedBatches: 5,
  foldedHash: bytes(99),
  createdAt: new BN(-17),
  bump: 254,
}

describe('прогін читається без нашого SDK', () => {
  it('дає ті самі поля, що записав кодувальник Anchor', async () => {
    const encoded = await program.coder.accounts.encode('run', rawRun)
    const run = decodeRun(Uint8Array.from(encoded))

    expect(new PublicKey(run.buyer).toBase58()).toBe(rawRun.buyer.toBase58())
    expect(new PublicKey(run.dispatcher).toBase58()).toBe(rawRun.dispatcher.toBase58())
    expect(run.nonce).toBe(18_446_744_073_709_551_615n)
    expect(run.recipeId).toBe(1)
    expect(Array.from(run.recipeParams)).toEqual(rawRun.recipeParams)
    expect(run.useType).toBe(8)
    expect(run.buyerCategory).toBe(1)
    expect(Array.from(run.buyerX25519)).toEqual(rawRun.buyerX25519)

    expect(run.datasets).toHaveLength(2)
    expect(new PublicKey(run.datasets[0]?.dataset ?? new Uint8Array(32)).toBase58()).toBe(
      DATASETS[0]?.toBase58(),
    )
    expect(run.datasets[0]?.pricePer1k).toBe(1_000n)
    expect(run.datasets[0]?.recordsIncluded).toBe(64)
    expect(run.datasets[0]?.belowFloor).toBe(false)
    expect(run.datasets[0]?.settled).toBe(true)
    expect(run.datasets[1]?.belowFloor).toBe(true)
    expect(run.datasets[1]?.settled).toBe(false)

    expect(run.feeBps).toBe(250)
    // 2^53 + 1: сума в базових одиницях виходить за точність `number` уже на
    // дев'яти мільярдах, і читач, який повернув би тут `number`, збрехав би.
    expect(run.escrowAmount).toBe(9_007_199_254_740_993n)
    expect(run.settledCount).toBe(1)
    expect(run.settledAmount).toBe(128n)
    expect(run.refunded).toBe(false)
    expect(run.status).toBe('completed')
    expect(Array.from(run.resultHash ?? [])).toEqual(rawRun.resultHash)
    expect(run.recordsIncluded).toBe(73)
    expect(run.suppressed).toBe(false)
    expect(run.datasetCursor).toBe(2)
    expect(run.foldedBatches).toBe(5)
    expect(Array.from(run.foldedHash)).toEqual(rawRun.foldedHash)
    expect(run.createdAt).toBe(-17n)
    expect(run.bump).toBe(254)
  })

  it('читає всі статуси так само, як їх пише програма', async () => {
    for (const [index, name] of [
      'accepted',
      'running',
      'completed',
      'rejected',
      'failed',
    ].entries()) {
      const encoded = await program.coder.accounts.encode('run', {
        ...rawRun,
        status: { [name]: {} },
      })
      expect(decodeRun(Uint8Array.from(encoded)).status).toBe(name)
      expect(index).toBeGreaterThanOrEqual(0)
    }
  })

  it('порожній `resultHash` лишається порожнім, а не нулями', async () => {
    const encoded = await program.coder.accounts.encode('run', { ...rawRun, resultHash: null })
    expect(decodeRun(Uint8Array.from(encoded)).resultHash).toBeNull()
  })

  it('відмовляє акаунту чужого типу', async () => {
    const encoded = await program.coder.accounts.encode('run', rawRun)
    const spoiled = Uint8Array.from(encoded)
    spoiled.set([0], 0)

    expect(() => decodeRun(spoiled)).toThrow(BorshError)
  })
})

describe('результат прогону читається без нашого SDK', () => {
  it('віддає всі шифротексти звіту й нонс, ширший за u64', async () => {
    const raw = {
      run: Keypair.generate().publicKey,
      encryptionKey: bytes(5),
      nonce: new BN('340282366920938463463374607431768211455'),
      ciphertexts: Array.from({ length: REPORT_CIPHERTEXTS }, (_, index) => bytes(index)),
      recordsIncluded: 73,
      suppressed: false,
      bump: 253,
    }

    const encoded = await program.coder.accounts.encode('runResult', raw)
    const result = decodeRunResult(Uint8Array.from(encoded))

    expect(new PublicKey(result.run).toBase58()).toBe(raw.run.toBase58())
    expect(Array.from(result.encryptionKey)).toEqual(raw.encryptionKey)
    expect(result.nonce).toBe(340_282_366_920_938_463_463_374_607_431_768_211_455n)
    expect(result.ciphertexts).toHaveLength(REPORT_CIPHERTEXTS)
    expect(Array.from(result.ciphertexts[REPORT_CIPHERTEXTS - 1] ?? [])).toEqual(
      bytes(REPORT_CIPHERTEXTS - 1),
    )
    expect(result.recordsIncluded).toBe(73)
    expect(result.suppressed).toBe(false)
    expect(result.bump).toBe(253)
  })
})

describe('читач не виходить за межі буфера', () => {
  it('обрізаний акаунт — це відмова, а не нулі', () => {
    const short = new Uint8Array([...RUN_DISCRIMINATOR, 1, 2, 3])
    expect(() => decodeRun(short)).toThrow(BorshError)
  })

  it('вектор не вірить власній довжині', () => {
    const reader = new Reader(Uint8Array.from([0xff, 0xff, 0xff, 0xff, 1, 2, 3]))
    expect(() => reader.vec((inner) => inner.u8())).toThrow(BorshError)
  })

  it('`bool` поза 0 і 1 — це не `true`', () => {
    expect(() => new Reader(Uint8Array.from([2])).bool()).toThrow(BorshError)
  })

  it('дискримінатор коротшого за вісім байтів акаунта', () => {
    expect(() => stripDiscriminator(new Uint8Array(4), RUN_DISCRIMINATOR)).toThrow(BorshError)
  })
})
