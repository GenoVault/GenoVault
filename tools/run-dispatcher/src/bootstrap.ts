/**
 * Розгортання світу під наскрізний прогін (`T030`).
 *
 * Усе тут — про **локальний стенд**, і жоден рядок не є частиною продукту.
 * Платформу в мережі розгортає власник платформи один раз своїм ключем; тут те саме
 * робиться на кожен запуск сценарію, бо валідатор щоразу починає з порожнього
 * ланцюга.
 *
 * Окремо від `drive.ts` саме тому: драйвер працює проти будь-якої мережі, де
 * платформа вже є, і додати йому здатність її створювати означало б дати
 * диспетчеру повноваження, яких у нього немає.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AnchorProvider } from '@anchor-lang/core'
import { uploadCircuit } from '@arcium-hq/client'
import type { GenoVaultProgram } from '@genovault/sdk'
import {
  initializeIx,
  platformConfigAddress,
  TOKEN_2022_PROGRAM_ID,
  vaultAddress,
} from '@genovault/sdk'
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
  MINT_SIZE,
} from '@solana/spl-token'
import type { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import type { ArciumContext, CircuitName } from './arcium.ts'
import { CIRCUITS } from './arcium.ts'

/** Стенд не піднявся — і причина названа, а не сховалась у `ConstraintAddress`. */
export class BootstrapError extends Error {
  override readonly name = 'BootstrapError'
}

export interface Platform {
  mint: PublicKey
  config: PublicKey
  vault: PublicKey
  feeBps: number
}

export interface BootstrapPlatformOptions {
  connection: Connection
  program: GenoVaultProgram
  /** Він же авторитет платформи й емітент розрахункового токена. */
  authority: Keypair
  mint: Keypair
  feeBps: number
  /** Скільки знаків після коми в розрахунковому токені. */
  decimals?: number
}

const DEFAULT_DECIMALS = 6

/**
 * Створює розрахунковий токен і розгортає платформу.
 *
 * Мінт — Token-2022, як і всюди в програмі: `PlatformConfig` звіряє програму
 * токена, і мінт зі старої програми відхилиться вже на `request_run`, коли
 * покупець уже підписав.
 */
export async function bootstrapPlatform(options: BootstrapPlatformOptions): Promise<Platform> {
  const decimals = options.decimals ?? DEFAULT_DECIMALS
  const config = platformConfigAddress(options.program.programId).address
  const vault = vaultAddress(options.program.programId).address

  if ((await options.connection.getAccountInfo(config)) !== null) {
    throw new BootstrapError(
      `платформа вже розгорнута (${config.toBase58()}) — стенд піднімається на чистому ланцюгу`,
    )
  }

  const rent = await getMinimumBalanceForRentExemptMint(options.connection)
  await send(
    options.connection,
    options.authority,
    [options.mint],
    [
      SystemProgram.createAccount({
        fromPubkey: options.authority.publicKey,
        newAccountPubkey: options.mint.publicKey,
        space: MINT_SIZE,
        lamports: rent,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        options.mint.publicKey,
        decimals,
        options.authority.publicKey,
        null,
        TOKEN_2022_PROGRAM_ID,
      ),
    ],
  )

  await send(
    options.connection,
    options.authority,
    [],
    [
      await initializeIx(options.program, {
        authority: options.authority.publicKey,
        mint: options.mint.publicKey,
        feeBps: options.feeBps,
      }),
      await options.program.methods
        .initializeVault()
        .accountsPartial({
          authority: options.authority.publicKey,
          config,
          mint: options.mint.publicKey,
          vault,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction(),
    ],
  )

  return { mint: options.mint.publicKey, config, vault, feeBps: options.feeBps }
}

/** Видає покупцю розрахунковий токен, щоб було чим заплатити депозит. */
export async function fundBuyer(
  connection: Connection,
  authority: Keypair,
  mint: PublicKey,
  buyer: PublicKey,
  amount: bigint,
): Promise<PublicKey> {
  const tokens = getAssociatedTokenAddressSync(mint, buyer, false, TOKEN_2022_PROGRAM_ID)

  await send(
    connection,
    authority,
    [],
    [
      createAssociatedTokenAccountIdempotentInstruction(
        authority.publicKey,
        tokens,
        buyer,
        mint,
        TOKEN_2022_PROGRAM_ID,
      ),
      createMintToInstruction(mint, tokens, authority.publicKey, amount, [], TOKEN_2022_PROGRAM_ID),
    ],
  )

  return tokens
}

export interface BootstrapCircuitsOptions {
  provider: AnchorProvider
  program: GenoVaultProgram
  arcium: ArciumContext
  payer: Keypair
  /** Тека з `*.arcis` — вивід `scripts/wsl-build-circuits.sh`. */
  circuitsDir: string
  onProgress?(circuit: CircuitName, note: string): void
}

/**
 * Розгортає чотири визначення обчислень.
 *
 * Кожен контур в Arcium — окремий акаунт, і без нього обчислення не поставити
 * в чергу. На локальному стенді сирі буфери контурів кладе в генезис сам
 * `arcium localnet`, тож `uploadCircuit` здебільшого відразу повертає порожній
 * список — але кликати його все одно треба: він же й фіналізує визначення.
 */
export async function bootstrapCircuits(options: BootstrapCircuitsOptions): Promise<void> {
  for (const circuit of CIRCUITS) {
    const compDef = options.arcium.compDef(circuit)

    if ((await options.provider.connection.getAccountInfo(compDef)) === null) {
      await send(
        options.provider.connection,
        options.payer,
        [],
        [await initCompDefIx(options, circuit)],
      )
      options.onProgress?.(circuit, 'визначення створене')
    } else {
      options.onProgress?.(circuit, 'визначення вже було')
    }

    const raw = await readFile(join(options.circuitsDir, `${circuit}.arcis`))
    const signatures = await uploadCircuit(
      options.provider,
      circuit,
      options.program.programId,
      raw,
      false,
    )
    options.onProgress?.(
      circuit,
      signatures.length === 0
        ? 'контур уже в мережі'
        : `завантажено ${signatures.length} транзакцій`,
    )
  }
}

/**
 * Інструкція розгортання визначення — чотири різні імені, одні й ті самі акаунти.
 *
 * Anchor не дає покликати інструкцію за рядком без втрати типу, тож перемикач
 * тут явний. Ім'я контуру й ім'я інструкції зв'язані макросом
 * `#[init_computation_definition_accounts]` у програмі, і розійтись їм не дасть
 * `queue_computation`: невідповідне визначення відхиляє вже черга.
 */
async function initCompDefIx(
  options: BootstrapCircuitsOptions,
  circuit: CircuitName,
): Promise<TransactionInstruction> {
  const accounts = {
    payer: options.payer.publicKey,
    mxeAccount: options.arcium.mxeAccount,
    compDefAccount: options.arcium.compDef(circuit),
    addressLookupTable: options.arcium.addressLookupTable,
    arciumProgram: options.arcium.arciumProgram,
  }

  switch (circuit) {
    case 'frequencies_init':
      return options.program.methods
        .initFrequenciesInitCompDef()
        .accountsPartial(accounts)
        .instruction()
    case 'frequencies_fold':
      return options.program.methods
        .initFrequenciesFoldCompDef()
        .accountsPartial(accounts)
        .instruction()
    case 'frequencies_close_dataset':
      return options.program.methods
        .initFrequenciesCloseDatasetCompDef()
        .accountsPartial(accounts)
        .instruction()
    case 'frequencies_reveal':
      return options.program.methods
        .initFrequenciesRevealCompDef()
        .accountsPartial(accounts)
        .instruction()
  }
}

/** Підписує й відправляє транзакцію версії 0. Локальна дрібниця, не загальний клієнт. */
async function send(
  connection: Connection,
  payer: Keypair,
  extraSigners: Keypair[],
  instructions: TransactionInstruction[],
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message()

  const transaction = new VersionedTransaction(message)
  transaction.sign([payer, ...extraSigners])

  const signature = await connection.sendTransaction(transaction, { maxRetries: 3 })
  const status = await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed',
  )
  if (status.value.err !== null) {
    throw new BootstrapError(
      `транзакція ${signature} відхилена: ${JSON.stringify(status.value.err)}`,
    )
  }
  return signature
}
