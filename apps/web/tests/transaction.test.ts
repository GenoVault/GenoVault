import {
  AccountRole,
  address,
  type Blockhash,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit'
import { describe, expect, it } from 'vitest'
import { buildTransaction, serializeTransaction, toKitInstruction } from '../src/lib/transaction.ts'

/**
 * Складання транзакції з інструкції API (`T029`).
 *
 * Перевіряється не «функція щось повернула», а те, що байти **розбираються
 * назад** у ту саму інструкцію: між JSON API й підписом гаманця немає жодного
 * місця, де помилка в ролі акаунта проявилась би раніше, ніж відмовою мережі
 * після підпису.
 */

const PROGRAM = 'EBDdxS1AsBojwbLBQqAsh61194ZNUqZRSbB8gyUZJ2p1'
const BUYER = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T'
const VAULT = '8gn6vk6KDHJ3Gt8Act7gK1A8ZEHYvbSHJREABxPkJxSK'
const CONFIG = 'So11111111111111111111111111111111111111112'

const LIFETIME = {
  blockhash: '11111111111111111111111111111111' as Blockhash,
  lastValidBlockHeight: 250n,
}

const unsigned = {
  programId: PROGRAM,
  accounts: [
    { pubkey: BUYER, isSigner: true, isWritable: true },
    { pubkey: VAULT, isSigner: false, isWritable: true },
    { pubkey: CONFIG, isSigner: false, isWritable: false },
  ],
  data: Buffer.from(Uint8Array.from([1, 2, 3, 250, 255])).toString('base64'),
} as never

describe('інструкція з API', () => {
  it('ролі відновлюються з двох прапорців, а не переносяться числом', () => {
    const instruction = toKitInstruction(unsigned)

    expect(instruction.programAddress).toBe(PROGRAM)
    expect(instruction.accounts?.map((a) => a.role)).toEqual([
      AccountRole.WRITABLE_SIGNER,
      AccountRole.WRITABLE,
      AccountRole.READONLY,
    ])
  })

  it('дані інструкції переживають base64 без втрат', () => {
    // Байти з 0xfa і 0xff тут не випадкові: саме на них помиляється кодування,
    // що ходить через рядок замість байтів.
    expect(Array.from(toKitInstruction(unsigned).data ?? [])).toEqual([1, 2, 3, 250, 255])
  })
})

describe('транзакція', () => {
  it('розбирається назад у ту саму інструкцію', () => {
    const transaction = buildTransaction(toKitInstruction(unsigned), BUYER, LIFETIME)
    const bytes = serializeTransaction(transaction)

    const decoded = getTransactionDecoder().decode(bytes)
    const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes)
    const message = decompileTransactionMessage(compiled)

    expect(message.feePayer.address).toBe(address(BUYER))
    expect(message.instructions).toHaveLength(1)
    const [instruction] = message.instructions
    expect(instruction?.programAddress).toBe(address(PROGRAM))
    expect(Array.from(instruction?.data ?? [])).toEqual([1, 2, 3, 250, 255])
    expect(instruction?.accounts?.map((a) => a.address)).toEqual([
      address(BUYER),
      address(VAULT),
      address(CONFIG),
    ])
  })

  it('версія повідомлення — 0, не legacy', () => {
    // Пул на 50 датасетів це 100 акаунтів, і без таблиць пошуку адрес він не
    // складеться. Міняти версію після того, як гаманці навчились підписувати
    // одну, дорожче, ніж почати з тієї, що вміє обидва випадки.
    const transaction = buildTransaction(toKitInstruction(unsigned), BUYER, LIFETIME)
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes)

    expect(compiled.version).toBe(0)
  })

  it('підписів у транзакції ще немає — їх ставить гаманець', () => {
    const transaction = buildTransaction(toKitInstruction(unsigned), BUYER, LIFETIME)

    expect(Object.keys(transaction.signatures)).toEqual([BUYER])
    expect(transaction.signatures[BUYER]).toBeNull()
  })
})
