import { Program } from '@anchor-lang/core'
import type { Connection, PublicKey } from '@solana/web3.js'
import { PublicKey as Web3PublicKey } from '@solana/web3.js'
import { type Genovault, IDL } from './idl/genovault.ts'

/**
 * Клієнт програми (`FR-013`, `FR-025`).
 *
 * Адреса береться з самого IDL — того ж тексту, що звіряється з `declare_id!`
 * у `scripts/sync-idl.mjs --check`. Другого місця, де вона написана, тут
 * навмисно немає: константа поруч з IDL — це рівно те місце, де вони
 * розходяться після зміни ключа програми.
 */
export const PROGRAM_ID = new Web3PublicKey(IDL.address)

export type GenoVaultProgram = Program<Genovault>

/**
 * Провайдер, у якого немає гаманця.
 *
 * `AnchorProvider` вимагає гаманця, бо вміє підписувати й відправляти. Нам це
 * не потрібне й не дозволене: API не підписує транзакцій, він повертає їх
 * клієнту неспідписаними. Тому сюди йде рівно з'єднання — цього досить і
 * щоб читати акаунти, і щоб будувати інструкції.
 */
export interface ReadProvider {
  connection: Connection
}

/**
 * Збирає клієнта програми.
 *
 * `Program` камелкейсить усе, що йому дали, включно з `pda.seeds[].path`, —
 * саме тому вендорений IDL мусить бути одним текстом для типу й значення
 * (див. `scripts/sync-idl.mjs`).
 */
export function createProgram(provider: ReadProvider): GenoVaultProgram {
  return new Program<Genovault>(IDL, provider)
}

/** Чи належить акаунт нашій програмі — перевірка перед декодуванням. */
export function isProgramOwned(owner: PublicKey, programId: PublicKey = PROGRAM_ID): boolean {
  return owner.equals(programId)
}
