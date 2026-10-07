/// <reference lib="webworker" />
// First, before Anchor and web3.js evaluate: they read a global `Buffer`.
import '@/lib/bufferGlobal'
import { sealDataset } from '@genovault/crypto'
import { fetchMxePublicKey } from '@genovault/crypto/mxe-key'
import type { PlainRecord } from '@/lib/recordsFile'

/**
 * Encryption off the main thread (`FR-004a`, decision 2026-09-07).
 *
 * Ten thousand records are ~10 minutes of single-threaded CPU; in the tab
 * itself that is a frozen page. Here the tab stays alive and the screen names
 * the count.
 *
 * The worker also reads the MXE key, from the chain, through the node the
 * client names. Neither the key's source nor the plaintext ever passes through
 * the API, and the ephemeral scalar dies inside `sealDataset` (`T014`).
 */

export interface EncryptRequest {
  records: PlainRecord[]
  rpcUrl: string
  programAddress: string
}

export type EncryptMessage =
  | { type: 'key' }
  | { type: 'progress'; done: number; total: number }
  | {
      type: 'done'
      bytes: ArrayBuffer
      contentHash: string
      recordCount: number
      markerCount: number
    }
  | { type: 'error'; name: string; message: string }

const post = (message: EncryptMessage, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(message, transfer)

self.onmessage = async (event: MessageEvent<EncryptRequest>) => {
  const { records, rpcUrl, programAddress } = event.data
  try {
    const mxeKey = await fetchMxePublicKey(rpcUrl, programAddress)
    post({ type: 'key' })

    const sealed = await sealDataset(records, mxeKey, (done, total) =>
      post({ type: 'progress', done, total }),
    )
    // A copy into a buffer of its own, so the transfer moves exactly the envelope.
    const bytes = sealed.bytes.slice().buffer
    post(
      {
        type: 'done',
        bytes,
        contentHash: sealed.contentHash,
        recordCount: sealed.recordCount,
        markerCount: sealed.markerCount,
      },
      [bytes],
    )
  } catch (error) {
    post({
      type: 'error',
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
