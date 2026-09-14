/**
 * Адреси Arcium, які наша програма виводить макросами (`T030`).
 *
 * `derive_mxe_pda!`, `derive_cluster_pda!(mxe_account)` і решта розкриваються в
 * ончейн-коді, і клієнт мусить дати ті самі акаунти в тому самому порядку —
 * інакше транзакція падає з `ConstraintAddress`, і виглядає це як помилка нашої
 * програми, хоча помилка в клієнті.
 *
 * Ключове тут — **зсув кластера**. Мемпул, черга виконання, акаунт кластера й
 * акаунт обчислення виводяться не з програми, а з нього, а лежить він усередині
 * `MXEAccount`. Тобто його не можна ні захардкодити, ні вивести: його читають з
 * мережі, і саме тому цей модуль асинхронний.
 */

import type { AnchorProvider, BN } from '@anchor-lang/core'
import { BN as AnchorBN } from '@anchor-lang/core'
import {
  getArciumProgram,
  getArciumProgramId,
  getClockAccAddress,
  getClusterAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getFeePoolAccAddress,
  getLookupTableAddress,
  getMempoolAccAddress,
  getMXEAccAddress,
} from '@arcium-hq/client'
import type { PublicKey } from '@solana/web3.js'

/** Контури, які публікує програма. Імена — ті самі, що в `#[arcium_program]`. */
export const CIRCUITS = [
  'frequencies_init',
  'frequencies_fold',
  'frequencies_close_dataset',
  'frequencies_reveal',
] as const

export type CircuitName = (typeof CIRCUITS)[number]

/** Мережа не дала того, без чого прогін не почати. */
export class ArciumError extends Error {
  override readonly name = 'ArciumError'
}

export interface ArciumContext {
  /** MXE нашої програми. */
  mxeAccount: PublicKey
  /** Зсув кластера, прочитаний з `MXEAccount`. */
  clusterOffset: number
  clusterAccount: PublicKey
  mempoolAccount: PublicKey
  executingPool: PublicKey
  poolAccount: PublicKey
  clockAccount: PublicKey
  arciumProgram: PublicKey
  /** Таблиця пошуку адрес MXE — її вимагає розгортання визначень обчислень. */
  addressLookupTable: PublicKey
  /** Акаунт визначення обчислення для контуру. */
  compDef(circuit: CircuitName): PublicKey
  /** Акаунт обчислення під конкретний зсув. */
  computation(offset: BN): PublicKey
}

/** Зсув визначення обчислення — перші чотири байти sha-256 імені контуру. */
export function compDefOffset(circuit: CircuitName): number {
  const bytes = getCompDefAccOffset(circuit)
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
}

/**
 * Збирає всі адреси Arcium для нашої програми.
 *
 * Читає `MXEAccount` кодувальником самої Arcium, а не сирими зсувами. Ціна —
 * потрібен провайдер із гаманцем; вигода — розкладка чужого акаунта перестає
 * бути нашим припущенням. `MXEAccount` уже одного разу міняв форму (`_padding`
 * у ньому — слід від `cluster: Option<u32>`), і другий раз ми б це побачили як
 * кластер із випадковим номером.
 */
export async function loadArciumContext(
  provider: AnchorProvider,
  mxeProgramId: PublicKey,
): Promise<ArciumContext> {
  const mxeAccount = getMXEAccAddress(mxeProgramId)
  const arcium = getArciumProgram(provider)
  const mxe = await arcium.account.mxeAccount.fetchNullable(mxeAccount)
  if (mxe === null) {
    throw new ArciumError(
      `MXE ${mxeAccount.toBase58()} не існує — кластер не піднятий або програма не розгорнута`,
    )
  }

  const clusterOffset = mxe.cluster

  return {
    mxeAccount,
    clusterOffset,
    clusterAccount: getClusterAccAddress(clusterOffset),
    mempoolAccount: getMempoolAccAddress(clusterOffset),
    executingPool: getExecutingPoolAccAddress(clusterOffset),
    poolAccount: getFeePoolAccAddress(),
    clockAccount: getClockAccAddress(),
    arciumProgram: getArciumProgramId(),
    addressLookupTable: getLookupTableAddress(mxeProgramId, mxe.lutOffsetSlot),
    compDef: (circuit) => getCompDefAccAddress(mxeProgramId, compDefOffset(circuit)),
    computation: (offset) => getComputationAccAddress(clusterOffset, offset),
  }
}

/**
 * Свіжий зсув обчислення.
 *
 * Зсув — це seed акаунта обчислення, тож повтор означає спробу створити наявний
 * акаунт, і транзакція падає. Беремо випадкові 63 біти: лічильник розійшовся б
 * між перезапусками драйвера, а час у мілісекундах збігається, коли дві
 * згортки йдуть в одну мілісекунду.
 */
export function freshComputationOffset(): BN {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  // Старший біт у нуль: зсув їде в програму як `u64`, а `BN` зі знаком
  // перетворив би половину значень на від'ємні.
  bytes.set([(bytes.at(7) ?? 0) & 0x7f], 7)
  return new AnchorBN(bytes, 'le')
}
