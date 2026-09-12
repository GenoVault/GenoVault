import type { UnsignedInstruction } from '@genovault/shared'
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  type Blockhash,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64Encoder,
  getTransactionEncoder,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Transaction,
} from '@solana/kit'

/**
 * Складання транзакції з інструкції, яку віддав API (`T029`).
 *
 * Модуль тягне за собою криптографію `@solana/kit`, тому екрани, яким
 * транзакції не потрібні, імпортують його динамічно: у каталогу бюджет
 * `SC-011` у дві секунди, і платити його за код підпису він не має.
 *
 * API повертає **неспідписану інструкцію**, а не транзакцію, і саме тут видно,
 * чому: хеш блоку живе близько хвилини, а покупець між квотою й підписом ще
 * читає, за що платить. Хеш береться тут, за мить до підпису, і бере його той,
 * хто підписує.
 *
 * Підпис і відправка тут не роблять: гаманець отримує байти й вирішує сам.
 * Функція лишається чистою відносно ключів — жоден із них сюди не потрапляє.
 */

/**
 * Інструкція з JSON у подання `@solana/kit`.
 *
 * Ролі акаунтів відновлюються з двох прапорців, а не переносяться числом:
 * `isSigner`/`isWritable` — те, що описує саму інструкцію, а `AccountRole` це
 * вже внутрішня нумерація бібліотеки. Перекладати їх тут означає, що зміна
 * нумерації в бібліотеці зламає збірку, а не мовчки переставить права
 * акаунтів у підписаній транзакції.
 */
export function toKitInstruction(unsigned: UnsignedInstruction): Instruction {
  return {
    programAddress: address(unsigned.programId),
    accounts: unsigned.accounts.map((account) => ({
      address: address(account.pubkey),
      role: account.isSigner
        ? account.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : account.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: base64ToBytes(unsigned.data),
  }
}

export interface Lifetime {
  blockhash: Blockhash
  lastValidBlockHeight: bigint
}

/**
 * Транзакція з однієї інструкції, готова до підпису.
 *
 * Версія 0, а не legacy: таблиці пошуку адрес знадобляться вже на пулі з
 * кількох десятків датасетів (`T024` рахує 100 акаунтів на 50 датасетів), і
 * міняти версію повідомлення після того, як гаманці навчились підписувати
 * одну, дорожче, ніж почати з тієї, що вміє обидва випадки.
 */
export function buildTransaction(
  instruction: Instruction,
  feePayer: string,
  lifetime: Lifetime,
): Transaction {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayer(address(feePayer), message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(lifetime, message),
    (message) => appendTransactionMessageInstruction(instruction, message),
    compileTransaction,
  )
}

/** Байти транзакції у вигляді, який приймає гаманець Privy (`Uint8Array`). */
export function serializeTransaction(transaction: Transaction): Uint8Array {
  // `messageBytes` це ще не транзакція: у неї є місце під підписи, а гаманець
  // чекає повне подання.
  return new Uint8Array(getTransactionEncoder().encode(transaction))
}

/** Свіжий хеш блоку. Береться за мить до підпису — інакше він застаріє в дорозі. */
export async function fetchLifetime(rpcUrl: string): Promise<Lifetime> {
  const rpc = createSolanaRpc(rpcUrl)
  const { value } = await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  return { blockhash: value.blockhash, lastValidBlockHeight: value.lastValidBlockHeight }
}

function base64ToBytes(encoded: string): Uint8Array {
  return new Uint8Array(getBase64Encoder().encode(encoded))
}
