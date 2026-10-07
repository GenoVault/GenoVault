import { type ApiError, PROGRAM_ADDRESS } from '@genovault/shared'
import { useCallback, useRef, useState } from 'react'
import { type ConsentDraft, draftToRequest } from '@/components/ConsentFields'
import { postConsent, postDataset, putCiphertext, toApiError } from '@/lib/api'
import type { RecordsFile } from '@/lib/recordsFile'
import {
  awaitConfirmation,
  type SendTransaction,
  signAndSendInstruction,
} from '@/lib/sendInstruction'
import type { EncryptMessage, EncryptRequest } from '@/workers/encrypt.worker'

/**
 * Registering a dataset from the browser, live (`T066`, `T066a`).
 *
 * The order is the API's (`T020`) and it is fixed: encrypt, declare, upload
 * the bytes, **then** sign the registration — a transaction assembled before a
 * 21 MB upload would reach the wallet with an expired blockhash, and a
 * registration signed before the bytes would put a hash on chain that nothing
 * in storage answers to. Consent version 1 follows, signed separately: the
 * program sets consent only on a registered dataset.
 *
 * A failure keeps what was done. The ciphertext stays in this tab, so a failed
 * upload or a rejected signature is retried from where it stopped, without
 * encrypting again.
 */

export type RegisterStage =
  | 'key'
  | 'encrypting'
  | 'declaring'
  | 'uploading'
  | 'signing'
  | 'confirming'
  | 'consent-building'
  | 'consent-signing'
  | 'consent-confirming'

export type RegisterPhase = 'idle' | RegisterStage | 'done' | 'error'

export interface RegisterInput {
  datasetId: string
  title: string
  description: string
  source: string
  collectedFrom: string
  collectedTo: string
  /** Base units of the mint, decimal string. */
  pricePer1k: string
  file: RecordsFile
  consent: ConsentDraft
}

export interface RegisterContext {
  token: string | null
  owner: string
  rpcUrl: string
  send: SendTransaction
}

export interface RegisterResult {
  datasetId: string
  owner: string
  contentHash: string
  byteLength: number
  registrationSignature: string
  consentSignature: string
  consentVersion: number
}

/** What survives a failure, so a retry does not redo it. */
interface Progress {
  sealed?: { bytes: Uint8Array; contentHash: string }
  declared?: { instruction: Parameters<typeof signAndSendInstruction>[0] }
  uploaded?: { byteLength: number }
  registrationSignature?: string
  registered?: true
  consentSignature?: string
  consentVersion?: number
}

function encryptInWorker(
  request: EncryptRequest,
  onMessage: (message: EncryptMessage) => void,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; contentHash: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/encrypt.worker.ts', import.meta.url), {
      type: 'module',
    })
    const stop = () => {
      worker.terminate()
      reject(new Error('encryption cancelled — nothing was uploaded and nothing was signed'))
    }
    signal.addEventListener('abort', stop, { once: true })
    worker.onmessage = (event: MessageEvent<EncryptMessage>) => {
      const message = event.data
      onMessage(message)
      if (message.type === 'done') {
        signal.removeEventListener('abort', stop)
        worker.terminate()
        resolve({ bytes: new Uint8Array(message.bytes), contentHash: message.contentHash })
      } else if (message.type === 'error') {
        signal.removeEventListener('abort', stop)
        worker.terminate()
        const error = new Error(message.message)
        error.name = message.name
        reject(error)
      }
    }
    worker.onerror = (event) => {
      signal.removeEventListener('abort', stop)
      worker.terminate()
      reject(new Error(event.message || 'the encryption worker failed to start'))
    }
    worker.postMessage(request)
  })
}

export function useRegistration() {
  const [phase, setPhase] = useState<RegisterPhase>('idle')
  const [failedAt, setFailedAt] = useState<RegisterStage | null>(null)
  const [encrypted, setEncrypted] = useState<{ done: number; total: number } | null>(null)
  const [uploaded, setUploaded] = useState<{ sent: number; total: number } | null>(null)
  const [error, setError] = useState<ApiError['error'] | null>(null)
  const [result, setResult] = useState<RegisterResult | null>(null)
  const progress = useRef<Progress>({})
  const controller = useRef<AbortController | null>(null)

  const run = useCallback(async (input: RegisterInput, context: RegisterContext) => {
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setError(null)
    setFailedAt(null)
    const done = progress.current
    let stage: RegisterStage = 'key'

    try {
      if (done.sealed === undefined) {
        stage = 'key'
        setPhase('key')
        done.sealed = await encryptInWorker(
          { records: input.file.records, rpcUrl: context.rpcUrl, programAddress: PROGRAM_ADDRESS },
          (message) => {
            if (message.type === 'key') {
              stage = 'encrypting'
              setPhase('encrypting')
            }
            if (message.type === 'progress')
              setEncrypted({ done: message.done, total: message.total })
          },
          abort.signal,
        )
      }
      const sealed = done.sealed

      if (done.declared === undefined) {
        stage = 'declaring'
        setPhase('declaring')
        const declared = await postDataset(
          {
            datasetId: input.datasetId,
            owner: context.owner,
            contentHash: sealed.contentHash,
            pricePer1k: input.pricePer1k,
            metadata: {
              title: input.title,
              description: input.description,
              schema: input.file.schema,
              recordCount: input.file.records.length,
              markerCount: input.file.markerCount,
              ...(input.file.statistics === null ? {} : { statistics: input.file.statistics }),
              provenance: {
                source: input.source,
                collectedFrom: input.collectedFrom,
                collectedTo: input.collectedTo,
              },
            },
          },
          { token: context.token, signal: abort.signal },
        )
        done.declared = { instruction: declared.registration.instruction }
      }
      const declared = done.declared

      if (done.uploaded === undefined) {
        stage = 'uploading'
        setPhase('uploading')
        const stored = await putCiphertext(input.datasetId, sealed.bytes, {
          token: context.token,
          signal: abort.signal,
          onProgress: (sent, total) => setUploaded({ sent, total }),
        })
        done.uploaded = { byteLength: stored.byteLength }
      }
      const upload = done.uploaded

      if (done.registered === undefined) {
        if (done.registrationSignature === undefined) {
          stage = 'signing'
          setPhase('signing')
          done.registrationSignature = await signAndSendInstruction(
            declared.instruction,
            context.owner,
            context.rpcUrl,
            context.send,
          )
        }
        stage = 'confirming'
        setPhase('confirming')
        await awaitConfirmation(context.rpcUrl, done.registrationSignature)
        done.registered = true
      }

      if (done.consentVersion === undefined) {
        stage = 'consent-building'
        setPhase('consent-building')
        const consent = await postConsent(input.datasetId, draftToRequest(input.consent), {
          token: context.token,
          signal: abort.signal,
        })
        stage = 'consent-signing'
        setPhase('consent-signing')
        const signature = await signAndSendInstruction(
          consent.instruction,
          context.owner,
          context.rpcUrl,
          context.send,
        )
        stage = 'consent-confirming'
        setPhase('consent-confirming')
        await awaitConfirmation(context.rpcUrl, signature)
        done.consentSignature = signature
        done.consentVersion = consent.version
      }

      const outcome: RegisterResult = {
        datasetId: input.datasetId,
        owner: context.owner,
        contentHash: sealed.contentHash,
        byteLength: upload.byteLength,
        registrationSignature: done.registrationSignature ?? '',
        consentSignature: done.consentSignature ?? '',
        consentVersion: done.consentVersion ?? 1,
      }
      setResult(outcome)
      setPhase('done')
      return outcome
    } catch (cause) {
      setError(toApiError(cause))
      setFailedAt(stage)
      setPhase('error')
      return null
    }
  }, [])

  /** Stops the worker or the upload; nothing signed yet stays unsigned. */
  const cancel = useCallback(() => {
    controller.current?.abort()
  }, [])

  /** Forget everything — a new dataset, from the start. */
  const reset = useCallback(() => {
    controller.current?.abort()
    progress.current = {}
    setPhase('idle')
    setFailedAt(null)
    setEncrypted(null)
    setUploaded(null)
    setError(null)
    setResult(null)
  }, [])

  return { phase, failedAt, encrypted, uploaded, error, result, run, cancel, reset }
}
