import { createProgram, runAddress } from '@genovault/sdk'
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { describe, expect, it } from 'vitest'
import {
  MAX_TRANSACTION_BYTES,
  planWrites,
  WRITE_CHUNK_BYTES,
  writesPerBatch,
} from '../src/chunks.ts'
import { writeBatchIx } from '../src/instructions.ts'
import { BATCH_PAYLOAD_BYTES } from '../src/layout.ts'

const program = createProgram({ connection: new Connection('http://127.0.0.1:8899') })
const DISPATCHER = new PublicKey('7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2')
const BUYER = new PublicKey('9G5ri75FHhrD5V4ujTwvmv5ULCSRTcu4x4mvzKk6tNEb')
const RUN = runAddress(BUYER, 7n, program.programId).address

/** Індекс без `!`: `noUncheckedIndexedAccess` вмикнений, а тихий `undefined` у тесті — це зелений тест ні про що. */
function at<T>(list: readonly T[], index: number): T {
  const item = list.at(index)
  if (item === undefined) throw new RangeError(`немає елемента ${index} серед ${list.length}`)
  return item
}

function payload(): Uint8Array {
  const bytes = new Uint8Array(BATCH_PAYLOAD_BYTES)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251
  return bytes
}

describe('нарізка батча на транзакції', () => {
  it('покриває вантаж без пропусків і без нахлесту', () => {
    const bytes = payload()
    const chunks = planWrites(bytes)

    expect(chunks).toHaveLength(writesPerBatch())
    expect(at(chunks, 0).offset).toBe(0)

    const rebuilt = new Uint8Array(BATCH_PAYLOAD_BYTES)
    let covered = 0
    for (const chunk of chunks) {
      expect(chunk.offset).toBe(covered)
      rebuilt.set(chunk.bytes, chunk.offset)
      covered += chunk.bytes.length
    }

    expect(covered).toBe(BATCH_PAYLOAD_BYTES)
    expect(rebuilt).toEqual(bytes)
  })

  it('останній шматок коротший, а не добитий нулями', () => {
    const chunks = planWrites(payload())
    const last = at(chunks, -1)

    expect(BATCH_PAYLOAD_BYTES % WRITE_CHUNK_BYTES).not.toBe(0)
    expect(last.bytes.length).toBe(BATCH_PAYLOAD_BYTES % WRITE_CHUNK_BYTES)
    expect(last.offset + last.bytes.length).toBe(BATCH_PAYLOAD_BYTES)
  })

  it('відмовляє вантажу не того розміру', () => {
    expect(() => planWrites(new Uint8Array(BATCH_PAYLOAD_BYTES - 1))).toThrow(RangeError)
  })

  /**
   * Головний тест файлу. Розмір шматка виведений арифметикою в коментарі до
   * `WRITE_CHUNK_BYTES`, а арифметика в коментарі — це припущення. Тут
   * складається справжня транзакція версії 0 і міряється серіалізацією:
   * помилка в оцінці накладних витрат впаде тут, а не на 79-й транзакції
   * живого прогону.
   */
  it('шматок укладається в транзакцію версії 0 із запасом', async () => {
    const chunks = planWrites(payload())
    const ix = await writeBatchIx({
      program,
      dispatcher: DISPATCHER,
      run: RUN,
      offset: at(chunks, 0).offset,
      bytes: at(chunks, 0).bytes,
    })

    const message = new TransactionMessage({
      payerKey: DISPATCHER,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [ix],
    }).compileToV0Message()
    const size = new VersionedTransaction(message).serialize().length

    expect(size).toBeLessThanOrEqual(MAX_TRANSACTION_BYTES)
    // Запас названий числом, а не «десь лишилось»: наступний, хто додасть
    // `ComputeBudget` чи другий підпис, має побачити, скільки в нього є.
    expect(MAX_TRANSACTION_BYTES - size).toBeGreaterThanOrEqual(32)
  })

  it('шматок на 32 байти більший уже не влазить', async () => {
    const bytes = payload().subarray(0, WRITE_CHUNK_BYTES + 64)
    const ix = await writeBatchIx({ program, dispatcher: DISPATCHER, run: RUN, offset: 0, bytes })

    const message = new TransactionMessage({
      payerKey: DISPATCHER,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [ix],
    }).compileToV0Message()

    expect(new VersionedTransaction(message).serialize().length).toBeGreaterThan(
      MAX_TRANSACTION_BYTES,
    )
  })

  it('один батч коштує 79 транзакцій запису', () => {
    // Число тримається тестом, бо на ньому стоїть уся оцінка `SC-003`:
    // 313 згорток × 79 — це ~24 700 транзакцій на стандартний датасет.
    expect(writesPerBatch()).toBe(79)
  })
})

describe('межі запису', () => {
  it('не дає записати за межу вантажу', async () => {
    await expect(
      writeBatchIx({
        program,
        dispatcher: DISPATCHER,
        run: RUN,
        offset: BATCH_PAYLOAD_BYTES - 8,
        bytes: new Uint8Array(16),
      }),
    ).rejects.toThrow(RangeError)
  })
})
