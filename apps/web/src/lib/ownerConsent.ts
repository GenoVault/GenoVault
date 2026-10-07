import type { ApiError, ConsentTransaction } from '@genovault/shared'
import { useCallback, useState } from 'react'
import { type ConsentDraft, draftToRequest } from '@/components/ConsentFields'
import { deleteConsent, postConsent, toApiError } from '@/lib/api'
import {
  awaitConfirmation,
  type SendTransaction,
  signAndSendInstruction,
} from '@/lib/sendInstruction'

/**
 * The owner sets or revokes consent from the interface (`T066a`).
 *
 * API → wallet → chain, in that order and nothing else: the API builds the
 * unsigned instruction, the owner's wallet signs and sends it, and the screen
 * waits for `confirmed` before it re-reads the card — the commitment the API
 * reads at, so the card shows what was just signed.
 */

export type ConsentPhase = 'idle' | 'building' | 'signing' | 'confirming' | 'done' | 'error'

export type ConsentChange =
  | { action: 'set'; datasetId: string; draft: ConsentDraft }
  | { action: 'revoke'; datasetId: string }

export interface ConsentContext {
  token: string | null
  /** The wallet that signs. */
  address: string
  rpcUrl: string
  send: SendTransaction
}

export interface ConsentDone {
  transaction: ConsentTransaction
  signature: string
}

export function useConsentChange() {
  const [phase, setPhase] = useState<ConsentPhase>('idle')
  const [error, setError] = useState<ApiError['error'] | null>(null)
  const [done, setDone] = useState<ConsentDone | null>(null)

  const reset = useCallback(() => {
    setPhase('idle')
    setError(null)
    setDone(null)
  }, [])

  const start = useCallback(
    async (change: ConsentChange, context: ConsentContext): Promise<ConsentDone | null> => {
      setError(null)
      setDone(null)
      try {
        setPhase('building')
        const options = { token: context.token }
        const transaction =
          change.action === 'set'
            ? await postConsent(change.datasetId, draftToRequest(change.draft), options)
            : await deleteConsent(change.datasetId, options)

        // The API answers for the address the session is bound to. A wallet
        // that is a different address would sign for nothing and fail on
        // `NotDatasetOwner`; say so before the wallet opens.
        if (transaction.owner !== context.address) {
          throw new Error(
            `this dataset belongs to ${transaction.owner}, and the wallet signing is ${context.address}`,
          )
        }

        setPhase('signing')
        const signature = await signAndSendInstruction(
          transaction.instruction,
          context.address,
          context.rpcUrl,
          context.send,
        )

        setPhase('confirming')
        await awaitConfirmation(context.rpcUrl, signature)

        const result = { transaction, signature }
        setDone(result)
        setPhase('done')
        return result
      } catch (cause) {
        setError(toApiError(cause))
        setPhase('error')
        return null
      }
    },
    [],
  )

  return { phase, error, done, start, reset }
}
