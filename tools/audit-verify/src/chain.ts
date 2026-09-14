/**
 * Прогін і його результат, прочитані з мережі без нашого коду (`T030`, `FR-025`).
 *
 * Розкладка взята з IDL, який лежить у публічному репозиторії, і відтворена тут
 * по байту. Це не дублювання заради дублювання: перевірка, яка користується
 * `packages/sdk`, доводить, що наш декодер узгоджений із нашим кодувальником, —
 * і рівно нічого більше. Розійтись цим двом читачам не дасть живий прогін:
 * поля, яке з'явилось у програмі й не з'явилось тут, вистачить, щоб `Run`
 * перестав розбиратись до кінця (`assertConsumed`).
 */

import type { Connection, PublicKey } from '@solana/web3.js'
import { type Reader, stripDiscriminator } from './borsh.ts'

/** Дискримінатори з IDL. Вісім байтів, які відрізняють тип акаунта. */
export const RUN_DISCRIMINATOR = [199, 54, 155, 86, 235, 115, 246, 189] as const
export const RUN_RESULT_DISCRIMINATOR = [201, 22, 203, 115, 112, 189, 94, 243] as const

export const RUN_STATUSES = ['accepted', 'running', 'completed', 'rejected', 'failed'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export interface RunDataset {
  dataset: Uint8Array
  pricePer1k: bigint
  recordsIncluded: number
  belowFloor: boolean
  settled: boolean
}

export interface Run {
  buyer: Uint8Array
  dispatcher: Uint8Array
  nonce: bigint
  recipeId: number
  recipeParams: Uint8Array
  useType: number
  buyerCategory: number
  buyerX25519: Uint8Array
  datasets: RunDataset[]
  feeBps: number
  escrowAmount: bigint
  settledCount: number
  settledAmount: bigint
  refunded: boolean
  status: RunStatus
  resultHash: Uint8Array | null
  recordsIncluded: number
  suppressed: boolean
  datasetCursor: number
  foldedBatches: number
  /** Ланцюжок відбитків усього, що пішло в MPC. Саме його звіряє `fold-chain.ts`. */
  foldedHash: Uint8Array
  createdAt: bigint
  bump: number
}

export interface RunResult {
  run: Uint8Array
  /** Ключ, яким MXE зашифрував звіт на покупця. */
  encryptionKey: Uint8Array
  nonce: bigint
  ciphertexts: Uint8Array[]
  recordsIncluded: number
  suppressed: boolean
  bump: number
}

export function decodeRun(data: Uint8Array): Run {
  const reader = stripDiscriminator(data, RUN_DISCRIMINATOR)

  const run: Run = {
    buyer: reader.pubkey(),
    dispatcher: reader.pubkey(),
    nonce: reader.u64(),
    recipeId: reader.u16(),
    recipeParams: reader.bytesOf(32),
    useType: reader.u32(),
    buyerCategory: reader.u32(),
    buyerX25519: reader.bytesOf(32),
    datasets: reader.vec(readDataset),
    feeBps: reader.u16(),
    escrowAmount: reader.u64(),
    settledCount: reader.u32(),
    settledAmount: reader.u64(),
    refunded: reader.bool(),
    status: readStatus(reader),
    resultHash: reader.option((inner) => inner.bytesOf(32)),
    recordsIncluded: reader.u32(),
    suppressed: reader.bool(),
    datasetCursor: reader.u32(),
    foldedBatches: reader.u32(),
    foldedHash: reader.bytesOf(32),
    createdAt: reader.i64(),
    bump: reader.u8(),
  }

  // `Run` має змінну довжину через `Vec<RunDataset>`, але Anchor виділяє акаунт
  // під максимум пулу — тобто хвіст із нулів тут законний, і `assertConsumed`
  // не кличеться. Що байти справді ті самі, показує сам розбір: зсув на один
  // байт зробив би `status` невідомим варіантом.
  return run
}

export function decodeRunResult(data: Uint8Array): RunResult {
  const reader = stripDiscriminator(data, RUN_RESULT_DISCRIMINATOR)

  return {
    run: reader.pubkey(),
    encryptionKey: reader.bytesOf(32),
    nonce: reader.u128(),
    ciphertexts: Array.from({ length: 24 }, () => reader.bytesOf(32)),
    recordsIncluded: reader.u32(),
    suppressed: reader.bool(),
    bump: reader.u8(),
  }
}

function readDataset(reader: Reader): RunDataset {
  return {
    dataset: reader.pubkey(),
    pricePer1k: reader.u64(),
    recordsIncluded: reader.u32(),
    belowFloor: reader.bool(),
    settled: reader.bool(),
  }
}

function readStatus(reader: Reader): RunStatus {
  const index = reader.enumIndex(RUN_STATUSES.length)
  const status = RUN_STATUSES.at(index)
  if (status === undefined) throw new Error(`невідомий статус прогону ${index}`)
  return status
}

/** Акаунт за адресою — або чесна відмова, а не `null`, який мовчки їде далі. */
export async function fetchAccount(
  connection: Connection,
  address: PublicKey,
  what: string,
): Promise<Uint8Array> {
  const info = await connection.getAccountInfo(address, 'confirmed')
  if (info === null) throw new Error(`${what} (${address.toBase58()}) немає в мережі`)
  return Uint8Array.from(info.data)
}
