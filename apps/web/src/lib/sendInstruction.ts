import type { UnsignedInstruction } from '@genovault/shared'

/**
 * Sign, send and wait for one instruction the API assembled (`T066`).
 *
 * The order screen did this inline since `T029`; registration and consent need
 * the same three steps, so they live here once. The API returns the instruction
 * unsigned; the transaction around it — fee payer, blockhash — is built here,
 * at the moment of signing, and the wallet signs and broadcasts it.
 *
 * `@solana/kit` comes in through a dynamic import, as in `lib/order.ts`: the
 * catalog bundle (`SC-011`) must not carry it.
 */

export type SendTransaction = (transaction: Uint8Array) => Promise<Uint8Array>

/** The chain executed the transaction and refused it. `cause` is `meta.err` as RPC gave it. */
export class TransactionRefusedError extends Error {
  override readonly name = 'TransactionRefusedError'
  override readonly cause: unknown

  constructor(signature: string, cause: unknown) {
    super(`transaction ${signature} failed on chain`)
    this.cause = cause
  }
}

export async function signAndSendInstruction(
  instruction: UnsignedInstruction,
  feePayer: string,
  rpcUrl: string,
  send: SendTransaction,
): Promise<string> {
  const { buildTransaction, fetchLifetime, serializeTransaction, toKitInstruction } = await import(
    '@/lib/transaction'
  )
  const lifetime = await fetchLifetime(rpcUrl)
  const transaction = buildTransaction(toKitInstruction(instruction), feePayer, lifetime)
  const signature = await send(serializeTransaction(transaction))

  const { getBase58Decoder } = await import('@solana/kit')
  return getBase58Decoder().decode(signature)
}

/**
 * Wait until the chain says `confirmed` — the commitment the API reads at
 * (`T041`), so a card refreshed after this shows what was just signed.
 *
 * Polls signature status every 400 ms. The wait is for the screen, not a
 * measurement: nothing here times anything (`CLAUDE.md`, "time is measured by
 * the chain").
 */
export async function awaitConfirmation(
  rpcUrl: string,
  signature: string,
  timeoutMs = 60_000,
): Promise<void> {
  const { createSolanaRpc, signature: asSignature } = await import('@solana/kit')
  const rpc = createSolanaRpc(rpcUrl)
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    // With history: the wallet may hand the signature back minutes after it
    // landed — Privy resolves only when its success screen is closed — and
    // without history the node answers from a cache of the last ~150 slots,
    // i.e. `null` for a transaction that is long finalized.
    const { value } = await rpc
      .getSignatureStatuses([asSignature(signature)], { searchTransactionHistory: true })
      .send()
    const status = value[0]
    if (status !== null && status !== undefined) {
      if (status.err !== null) throw new TransactionRefusedError(signature, status.err)
      if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
        return
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error(`transaction ${signature} was not confirmed within ${timeoutMs / 1000} s`)
}
