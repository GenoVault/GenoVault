/**
 * Стан, який веде callback, а не наша інструкція (`T030`).
 *
 * `RunAccumulator` не експортується з `packages/sdk` навмисно: покупцю в ньому
 * нема на що дивитись — це 784 байти непрозорого шифротексту під ключем MXE.
 * Диспетчеру ж він потрібен на кожному кроці, бо саме звідти читається
 * єдине питання циклу: чи повернулось обчислення, яке ми поставили в чергу.
 */

import { type GenoVaultProgram, PROGRAM_ID } from '@genovault/sdk'
import type { Connection, PublicKey } from '@solana/web3.js'
import { PublicKey as Web3PublicKey } from '@solana/web3.js'

export const ACCUMULATOR_SEED = new TextEncoder().encode('acc')
export const BATCH_BUFFER_SEED = new TextEncoder().encode('batch')

export interface AccumulatorAccount {
  run: PublicKey
  nonce: bigint
  ready: boolean
  /** Акаунт обчислення, яке зараз у польоті; `null` — черга вільна. */
  pending: PublicKey | null
  bump: number
}

export function accumulatorAddress(run: PublicKey, programId: PublicKey = PROGRAM_ID): PublicKey {
  return Web3PublicKey.findProgramAddressSync([ACCUMULATOR_SEED, run.toBuffer()], programId)[0]
}

export function batchBufferAddress(run: PublicKey, programId: PublicKey = PROGRAM_ID): PublicKey {
  return Web3PublicKey.findProgramAddressSync([BATCH_BUFFER_SEED, run.toBuffer()], programId)[0]
}

/**
 * Читає накопичувач прогону.
 *
 * Шифротексти навмисно не повертаються. Драйверу вони не потрібні — він їх
 * ніколи не розбирає, — а віддавати з функції те, що виглядає як дані когорти,
 * означало б запрошувати наступного читача спробувати їх прочитати.
 */
export async function readAccumulator(
  connection: Connection,
  program: GenoVaultProgram,
  run: PublicKey,
): Promise<AccumulatorAccount> {
  const address = accumulatorAddress(run, program.programId)
  const info = await connection.getAccountInfo(address)
  if (info === null) {
    throw new Error(`накопичувача ${address.toBase58()} немає: прогін ще не відкритий`)
  }

  const raw = program.coder.accounts.decode('runAccumulator', info.data)
  return {
    run: raw.run,
    nonce: BigInt(raw.nonce.toString()),
    ready: raw.ready,
    pending: raw.pending ?? null,
    bump: raw.bump,
  }
}

/** Чи існує накопичувач узагалі — питання «прогін уже відкривали?». */
export async function accumulatorExists(
  connection: Connection,
  run: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): Promise<boolean> {
  return (await connection.getAccountInfo(accumulatorAddress(run, programId))) !== null
}
