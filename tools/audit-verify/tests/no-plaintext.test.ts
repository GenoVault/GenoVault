import { x25519 } from '@arcium-hq/client'
import type { DatasetRecord } from '@genovault/crypto'
import { encryptDataset } from '@genovault/crypto'
import { transcodeDataset } from '@genovault/run-dispatcher'
import { IDL } from '@genovault/sdk'
import { Keypair } from '@solana/web3.js'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Run, RunResult } from '../src/chain.ts'
import { readHeader } from '../src/envelope.ts'
import { hex, WORD_BYTES } from '../src/fold-chain.ts'
import type { PlainRecord, Surface } from '../src/no-plaintext.ts'
import {
  collectProblems,
  envelopeWords,
  GENOTYPE_WINDOW,
  MIN_CONTRIBUTION,
  NoPlaintextError,
  readWriteBatch,
  recordNeedles,
  sweep,
  WRITE_BATCH_DISCRIMINATOR,
} from '../src/no-plaintext.ts'
import type { Report } from '../src/report.ts'

/**
 * `SC-001` тримається на двох властивостях, і обидві перевіряються тут з обох
 * боків: канарка мусить ловити підкладений відкритий запис і мусить мовчати на
 * шифротексті; структурна тотожність мусить пропускати слова конверта й
 * називати слово, якого в конверті немає.
 *
 * Тест, який перевіряв би лише «нічого не знайшлось», доводив би, що пошук не
 * працює, — рівно так само добре, як і те, що витоку немає.
 */

const MARKERS = 64
const TIMEOUT_MS = 120_000
const CANARY_RECORDS = 6

let envelope: Uint8Array
let canary: PlainRecord[]

/** Канарка: випадкові генотипи, унікальний вік — те саме, що робить драйвер. */
function canaryRecords(count: number): DatasetRecord[] {
  let state = 0x5ca1ab1e
  const next = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }
  return Array.from({ length: count }, (_, index) => ({
    sex: (next() % 2) as 0 | 1,
    age: 20 + index,
    affected: (next() % 2) as 0 | 1,
    genotypes: Array.from({ length: MARKERS }, () => next() % 3),
  }))
}

beforeAll(() => {
  const records = canaryRecords(CANARY_RECORDS)
  canary = records
  envelope = encryptDataset(records, x25519.getPublicKey(x25519.utils.randomSecretKey())).bytes
}, TIMEOUT_MS)

function surface(bytes: Uint8Array): Surface[] {
  return [{ id: 'проба', kind: 'акаунт', bytes }]
}

describe('канарка', () => {
  it('мовчить на шифротексті власного датасету', () => {
    expect(sweep(surface(envelope), recordNeedles(canary))).toEqual([])
  })

  it('мовчить на випадкових байтах', () => {
    const noise = new Uint8Array(256 * 1024)
    for (let at = 0; at < noise.length; at += 1) noise[at] = (at * 7919) % 256
    expect(sweep(surface(noise), recordNeedles(canary))).toEqual([])
  })

  it('ловить кожну форму підкладеного запису', () => {
    const record = canary[0]
    if (record === undefined) throw new Error('немає канаркового запису')
    const needles = recordNeedles([record])
    expect(needles.length).toBeGreaterThan(10)

    for (const needle of needles) {
      // Голку кладемо в середину сміття: витік, який лежить рівно на початку
      // акаунта, — найлегший випадок, і ловити тільки його немає сенсу.
      const haystack = new Uint8Array(needle.bytes.length + 2048)
      haystack.set(needle.bytes, 1024)
      const hits = sweep(surface(haystack), [needle])
      expect(hits).toHaveLength(1)
      expect(hits[0]?.offset).toBe(1024)
    }
  })

  it('ловить витік самих генотипів без решти запису', () => {
    const record = canary[1]
    if (record === undefined) throw new Error('немає канаркового запису')

    const leak = Uint8Array.from(record.genotypes)
    const hits = sweep(surface(leak), recordNeedles(canary))

    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((hit) => hit.needle.includes('запис 1'))).toBe(true)
  })

  it('не робить голок, коротших за вікно, і голок із самих нулів', () => {
    const flat: PlainRecord = { sex: 0, age: 0, affected: 0, genotypes: Array(MARKERS).fill(0) }
    for (const needle of recordNeedles([flat])) {
      expect(needle.bytes.length).toBeGreaterThanOrEqual(GENOTYPE_WINDOW)
      expect(needle.bytes.some((byte) => byte !== 0)).toBe(true)
    }
  })
})

describe('структурна тотожність', () => {
  it('кожне слово батча знайшлось у конверті', () => {
    const known = new Set(envelopeWords(envelope))
    const batches = transcodeDataset(envelope)
    expect(batches.length).toBeGreaterThan(0)

    for (const batch of batches) {
      for (let at = 0; at < batch.payload.length; at += WORD_BYTES) {
        expect(known.has(hex(batch.payload.subarray(at, at + WORD_BYTES)))).toBe(true)
      }
    }
  })

  it('чуже слово в батчі не знаходиться в конверті', () => {
    const known = new Set(envelopeWords(envelope))
    const batch = transcodeDataset(envelope)[0]
    if (batch === undefined) throw new Error('конверт не дав жодного батча')

    const forged = Uint8Array.from(batch.payload)
    // Підміна одного байта в лімбі: слово перестає бути словом конверта, і
    // саме це має бути видно.
    forged.set([(forged.at(64) ?? 0) ^ 1], 64)

    expect(known.has(hex(forged.subarray(64, 64 + WORD_BYTES)))).toBe(false)
  })

  it('слово ключа виводиться з ефемерного ключа конверта', () => {
    const header = readHeader(envelope)
    const words = envelopeWords(envelope)
    // Перше слово — ключ, далі по кадру: нонс і лімби кожного поля.
    expect(words).toHaveLength(1 + header.recordCount * (1 + header.fieldsPerRecord))
  })
})

describe('розбір `write_batch`', () => {
  it('дискримінатор той самий, що в IDL', () => {
    // IDL лежить у публічному репозиторії — звіряч бере число звідти, а тест
    // стежить, щоб воно не розійшлось із програмою після наступної збірки.
    const found = IDL.instructions.find((entry) => entry.name === 'writeBatch')
    expect(found?.discriminator).toEqual([...WRITE_BATCH_DISCRIMINATOR])
  })

  it('читає зсув і ріже вантаж на слова', () => {
    const payload = new Uint8Array(2 * WORD_BYTES)
    payload.fill(7)
    const data = new Uint8Array(16 + payload.length)
    data.set(WRITE_BATCH_DISCRIMINATOR, 0)
    new DataView(data.buffer).setUint32(8, 896, true)
    new DataView(data.buffer).setUint32(12, payload.length, true)
    data.set(payload, 16)

    const parsed = readWriteBatch(data)
    expect(parsed?.offset).toBe(896)
    expect(parsed?.words).toHaveLength(2)
    expect(parsed?.unaligned).toBe(0)
  })

  it('чужа інструкція — не помилка, а `null`', () => {
    const data = new Uint8Array(32)
    data.set([1, 2, 3, 4, 5, 6, 7, 8], 0)
    expect(readWriteBatch(data)).toBeNull()
  })

  it('розбіжність довжини валить розбір, а не пропускається', () => {
    const data = new Uint8Array(16 + 32)
    data.set(WRITE_BATCH_DISCRIMINATOR, 0)
    new DataView(data.buffer).setUint32(12, 64, true)
    expect(() => readWriteBatch(data)).toThrow(NoPlaintextError)
  })

  it('вантаж повз межу слова лишається непоясненим', () => {
    const data = new Uint8Array(16 + 17)
    data.set(WRITE_BATCH_DISCRIMINATOR, 0)
    new DataView(data.buffer).setUint32(12, 17, true)

    const parsed = readWriteBatch(data)
    expect(parsed?.words).toEqual([])
    expect(parsed?.unaligned).toBe(17)
  })
})

/**
 * Огляд, у якому звіряч побачив усе, що зобов'язує ланцюг.
 *
 * Нуль згорток і нуль слів — законна пара: тести семантики не про транзакції.
 * Тест на неповний огляд задає покриття явно, і саме він стереже головне: без
 * цієї перевірки звіряч, якому RPC не віддав жодної транзакції, друкує
 * найзеленіший можливий вердикт.
 */
const FULL_COVERAGE = { expectedWords: 0, seenWords: 0, transactions: 0 }

/** Порожні заготовки, у яких тест міняє рівно те поле, про яке він. */
function runAccount(overrides: Partial<Run>): Run {
  return {
    buyer: new Uint8Array(32),
    dispatcher: new Uint8Array(32),
    nonce: 0n,
    recipeId: 1,
    recipeParams: new Uint8Array(32),
    useType: 1,
    buyerCategory: 1,
    buyerX25519: new Uint8Array(32),
    datasets: [],
    feeBps: 250,
    escrowAmount: 0n,
    settledCount: 0,
    settledAmount: 0n,
    refunded: false,
    status: 'completed',
    resultHash: null,
    recordsIncluded: 0,
    suppressed: false,
    datasetCursor: 0,
    foldedBatches: 0,
    foldedHash: new Uint8Array(32),
    createdAt: 0n,
    bump: 255,
    ...overrides,
  }
}

function resultAccount(overrides: Partial<RunResult>): RunResult {
  return {
    run: new Uint8Array(32),
    encryptionKey: new Uint8Array(32),
    nonce: 0n,
    ciphertexts: [],
    recordsIncluded: 0,
    suppressed: false,
    bump: 255,
    ...overrides,
  }
}

function report(overrides: Partial<Report>): Report {
  return {
    included: 0n,
    suppressed: 0n,
    male: 0n,
    affected: 0n,
    ageAtLeast: Array(8).fill(0n),
    alleleSum: Array(MARKERS).fill(0n),
    ...overrides,
  }
}

describe('семантика: пороги когорти й внеску', () => {
  it('когорта з одного запису без придушення — розбіжність', () => {
    const problems = collectProblems(
      runAccount({ recordsIncluded: 1 }),
      resultAccount({ recordsIncluded: 1 }),
      report({ included: 1n, male: 1n }),
      [],
      [],
      FULL_COVERAGE,
    )
    expect(problems.some((line) => line.includes('менша за'))).toBe(true)
  })

  it('придушена когорта з одного запису розбіжностей не дає', () => {
    const problems = collectProblems(
      runAccount({ recordsIncluded: 1, suppressed: true }),
      resultAccount({ recordsIncluded: 1, suppressed: true }),
      report({ included: 1n, suppressed: 1n }),
      [],
      [],
      FULL_COVERAGE,
    )
    expect(problems).toEqual([])
  })

  it('придушений звіт із ненульовим числом — розбіжність', () => {
    const problems = collectProblems(
      runAccount({ recordsIncluded: 4, suppressed: true }),
      resultAccount({ recordsIncluded: 4, suppressed: true }),
      report({ included: 4n, suppressed: 1n, male: 3n }),
      [],
      [],
      FULL_COVERAGE,
    )
    expect(problems.some((line) => line.includes('ненульових'))).toBe(true)
  })

  it('внесок у 1…9 записів називає конкретних людей і тому є розбіжністю', () => {
    const dataset = Uint8Array.from(Keypair.generate().publicKey.toBytes())
    const problems = collectProblems(
      runAccount({
        recordsIncluded: 30,
        datasets: [
          { dataset, pricePer1k: 1_000n, recordsIncluded: 3, belowFloor: false, settled: true },
        ],
      }),
      resultAccount({ recordsIncluded: 30 }),
      report({ included: 30n }),
      [],
      [],
      FULL_COVERAGE,
    )
    expect(problems.some((line) => line.includes(`менший за поріг ${MIN_CONTRIBUTION}`))).toBe(true)
  })

  it('мовчазний датасет із нульовим внеском розбіжності не дає', () => {
    const dataset = Uint8Array.from(Keypair.generate().publicKey.toBytes())
    const problems = collectProblems(
      runAccount({
        recordsIncluded: 30,
        datasets: [
          { dataset, pricePer1k: 1_000n, recordsIncluded: 0, belowFloor: true, settled: true },
        ],
      }),
      resultAccount({ recordsIncluded: 30 }),
      report({ included: 30n }),
      [],
      [],
      FULL_COVERAGE,
    )
    expect(problems).toEqual([])
  })

  it('влучання канарки й непояснене слово потрапляють у розбіжності', () => {
    const problems = collectProblems(
      runAccount({ recordsIncluded: 30 }),
      resultAccount({ recordsIncluded: 30 }),
      report({ included: 30n }),
      [{ surface: 'акаунт X', kind: 'акаунт', needle: 'запис 0 · сирі байти', offset: 42 }],
      [{ signature: 'sig', offset: 64, word: 'ff'.repeat(32) }],
      FULL_COVERAGE,
    )
    expect(problems).toHaveLength(2)
    expect(problems[0]).toContain('відкритий запис')
    expect(problems[1]).toContain('немає в конверті')
  })
})

describe('повнота огляду', () => {
  it("огляд, у якому видно менше слів, ніж зобов'язує ланцюг, — розбіжність", () => {
    const problems = collectProblems(
      runAccount({ recordsIncluded: 30, foldedBatches: 9 }),
      resultAccount({ recordsIncluded: 30 }),
      report({ included: 30n }),
      [],
      [],
      { expectedWords: 2484, seenWords: 0, transactions: 2 },
    )
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('огляд неповний')
    expect(problems[0]).toContain('2484')
  })

  it('повний огляд розбіжності не дає', () => {
    const problems = collectProblems(
      runAccount({ recordsIncluded: 30, foldedBatches: 9 }),
      resultAccount({ recordsIncluded: 30 }),
      report({ included: 30n }),
      [],
      [],
      { expectedWords: 2484, seenWords: 2484, transactions: 97 },
    )
    expect(problems).toEqual([])
  })
})
