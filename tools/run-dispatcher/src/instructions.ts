/**
 * Інструкції, які підписує **диспетчер** (`T025`, `T026`, `T030`).
 *
 * Живуть тут, а не в `packages/sdk`, з тієї ж причини, з якої диспетчер узагалі
 * існує окремо від покупця: SDK збирає те, що підписує **власник даних або
 * покупець**, і кожна його функція має відповідати на питання «хто це
 * підписує» одним іменем. Публікація в чергу обчислень підписується третьою
 * стороною, названою покупцем у `Run.dispatcher`, і змішувати ці набори
 * означало б запрошувати екран покупця покликати `dispatch_fold`.
 *
 * Що диспетчер може: подавати байти, ставити обчислення в чергу, доводити
 * прогін до кінця — або не доводити. Чого не може: рухати гроші, міняти склад
 * прогону чи параметри рецепта, обійти згоду. `settle_dataset` і
 * `finalize_run` тут теж є, і підписувати їх може будь-хто: вони рухають гроші
 * рівно за правилом, записаним у `Run`, і платник платить лише за rent.
 */

import type { BN } from '@anchor-lang/core'
import type { GenoVaultProgram } from '@genovault/sdk'
import { platformConfigAddress, vaultAddress } from '@genovault/sdk'
import type { PublicKey, TransactionInstruction } from '@solana/web3.js'
import type { ArciumContext, CircuitName } from './arcium.ts'
import { BATCH_PAYLOAD_BYTES } from './layout.ts'

/** Спільна частина кожної інструкції диспетчера. */
export interface DispatcherContext {
  program: GenoVaultProgram
  dispatcher: PublicKey
  /** Адреса прогону — не покупець із нонсом: диспетчер її вже прочитав. */
  run: PublicKey
}

/** Відкриває прогін: накопичувач і буфер на 10 КіБ. */
export async function openRunIx(ctx: DispatcherContext): Promise<TransactionInstruction> {
  return ctx.program.methods
    .openRun()
    .accountsPartial({ dispatcher: ctx.dispatcher, run: ctx.run })
    .instruction()
}

/**
 * Дорощує буфер на один крок.
 *
 * Кроків рівно `growSteps()`, і всі шість однакові: розмір задає програма, а не
 * аргумент. Клієнт, який назвав би цільовий розмір, дізнався б про межу
 * рантайму з помилки рантайму замість нашої.
 */
export async function growBatchBufferIx(ctx: DispatcherContext): Promise<TransactionInstruction> {
  return ctx.program.methods
    .growBatchBuffer()
    .accountsPartial({ dispatcher: ctx.dispatcher, run: ctx.run })
    .instruction()
}

export interface WriteBatchParams extends DispatcherContext {
  /** Зсув від початку вантажу, не від початку акаунта. */
  offset: number
  bytes: Uint8Array
}

/** Кладе шматок шифротексту в буфер. */
export async function writeBatchIx(params: WriteBatchParams): Promise<TransactionInstruction> {
  const end = params.offset + params.bytes.length
  if (params.offset < 0 || end > BATCH_PAYLOAD_BYTES) {
    throw new RangeError(
      `запис [${params.offset}, ${end}) виходить за вантаж батча ${BATCH_PAYLOAD_BYTES}`,
    )
  }

  return params.program.methods
    .writeBatch(params.offset, Buffer.from(params.bytes))
    .accountsPartial({ dispatcher: params.dispatcher, run: params.run })
    .instruction()
}

/** Акаунти Arcium, однакові в усіх чотирьох публікаціях. */
function queueAccounts(
  arcium: ArciumContext,
  circuit: CircuitName,
  computationOffset: BN,
): Record<string, PublicKey> {
  return {
    mxeAccount: arcium.mxeAccount,
    mempoolAccount: arcium.mempoolAccount,
    executingPool: arcium.executingPool,
    computationAccount: arcium.computation(computationOffset),
    compDefAccount: arcium.compDef(circuit),
    clusterAccount: arcium.clusterAccount,
    poolAccount: arcium.poolAccount,
    clockAccount: arcium.clockAccount,
    arciumProgram: arcium.arciumProgram,
  }
}

export interface QueueParams extends DispatcherContext {
  arcium: ArciumContext
  computationOffset: BN
}

/** Створює порожній накопичувач під ключем MXE. */
export async function dispatchInitIx(params: QueueParams): Promise<TransactionInstruction> {
  return params.program.methods
    .dispatchInit(params.computationOffset)
    .accountsPartial({
      payer: params.dispatcher,
      run: params.run,
      ...queueAccounts(params.arcium, 'frequencies_init', params.computationOffset),
    })
    .instruction()
}

export interface FoldParams extends QueueParams {
  /** Скільки слотів батча несуть справжні записи. Програма вимагає 1…32. */
  live: number
}

/** Згортає батч, що лежить у буфері. */
export async function dispatchFoldIx(params: FoldParams): Promise<TransactionInstruction> {
  return params.program.methods
    .dispatchFold(params.computationOffset, params.live)
    .accountsPartial({
      payer: params.dispatcher,
      run: params.run,
      ...queueAccounts(params.arcium, 'frequencies_fold', params.computationOffset),
    })
    .instruction()
}

/** Оголошує внесок поточного датасету й рухає курсор пулу. */
export async function dispatchCloseDatasetIx(params: QueueParams): Promise<TransactionInstruction> {
  return params.program.methods
    .dispatchCloseDataset(params.computationOffset)
    .accountsPartial({
      payer: params.dispatcher,
      run: params.run,
      ...queueAccounts(params.arcium, 'frequencies_close_dataset', params.computationOffset),
    })
    .instruction()
}

/** Розкриває звіт на ключ покупця й переводить прогін у кінцевий статус. */
export async function dispatchRevealIx(params: QueueParams): Promise<TransactionInstruction> {
  return params.program.methods
    .dispatchReveal(params.computationOffset)
    .accountsPartial({
      payer: params.dispatcher,
      run: params.run,
      ...queueAccounts(params.arcium, 'frequencies_reveal', params.computationOffset),
    })
    .instruction()
}

/** Повертає rent за накопичувач. Дозволено після кінцевого статусу. */
export async function closeAccumulatorIx(ctx: DispatcherContext): Promise<TransactionInstruction> {
  return ctx.program.methods
    .closeAccumulator()
    .accountsPartial({ dispatcher: ctx.dispatcher, run: ctx.run })
    .instruction()
}

/** Повертає rent за буфер — ~0,49 SOL мертвим вантажем увесь прогін. */
export async function closeBatchBufferIx(ctx: DispatcherContext): Promise<TransactionInstruction> {
  return ctx.program.methods
    .closeBatchBuffer()
    .accountsPartial({ dispatcher: ctx.dispatcher, run: ctx.run })
    .instruction()
}

export interface SettleDatasetParams {
  program: GenoVaultProgram
  payer: PublicKey
  run: PublicKey
  /** Номер рядка в `Run.datasets` — той самий порядок, у якому їх замовили. */
  index: number
  dataset: PublicKey
}

/**
 * Нараховує одному датасету його частку.
 *
 * Підписує будь-хто: сума й отримувач записані в `Run`, і платник платить лише
 * за rent балансів, які створюються за потреби. Порційність тут не оптимізація,
 * а межа транзакції — пул на 50 датасетів це 50 викликів (`SC-007`).
 */
export async function settleDatasetIx(
  params: SettleDatasetParams,
): Promise<TransactionInstruction> {
  return params.program.methods
    .settleDataset(params.index)
    .accountsPartial({
      payer: params.payer,
      config: platformConfigAddress(params.program.programId).address,
      run: params.run,
      dataset: params.dataset,
    })
    .instruction()
}

export interface FinalizeRunParams {
  program: GenoVaultProgram
  run: PublicKey
  mint: PublicKey
  buyerTokens: PublicKey
  tokenProgram: PublicKey
}

/** Повертає покупцю різницю депозиту й закриває прогін статусом `completed`. */
export async function finalizeRunIx(params: FinalizeRunParams): Promise<TransactionInstruction> {
  return params.program.methods
    .finalizeRun()
    .accountsPartial({
      config: platformConfigAddress(params.program.programId).address,
      run: params.run,
      mint: params.mint,
      buyerTokens: params.buyerTokens,
      vault: vaultAddress(params.program.programId).address,
      tokenProgram: params.tokenProgram,
    })
    .instruction()
}
