import { type FrequenciesReport, PROGRAM_ADDRESS, type RunView } from '@genovault/shared'
import { useCallback, useState } from 'react'

/**
 * Reading the buyer's report on the run page.
 *
 * 1. **The wallet signs the same message as at ordering.** Solana signatures
 *    are deterministic, so the same message gives the same report key; the key
 *    is stored nowhere (`T029`).
 * 2. **The derived public half is compared with `RunResult.encryption_key`**
 *    before anything is decrypted. Another wallet would decrypt to noise that
 *    still unpacks into plausible numbers — the comparison turns that into a
 *    named refusal.
 * 3. **The cluster key is read from the chain** through the client's own node,
 *    as for registration: a key handed over by the API would be the API's say.
 * 4. **Decryption runs here**, and the private half is wiped right after.
 *
 * The crypto modules load on demand: the run page itself does not need them,
 * and the cipher drags `@arcium-hq/client` with it.
 */

export class ReportKeyMismatchError extends Error {
  override readonly name = 'ReportKeyMismatchError'
}

export interface ReadReportInput {
  run: RunView
  rpcUrl: string
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
}

export async function readReport(input: ReadReportInput): Promise<FrequenciesReport> {
  const { run } = input
  if (run.result === null) throw new Error('this run has no report yet')

  const { deriveReportKey, reportKeyMessage, toHex } = await import('@genovault/crypto/report-key')
  const message = new TextEncoder().encode(reportKeyMessage(run.buyer, BigInt(run.nonce)))
  const key = await deriveReportKey(await input.signMessage(message))

  try {
    if (toHex(key.publicKey) !== run.result.encryptionKey) {
      throw new ReportKeyMismatchError(
        'This wallet does not hold the key the report was sealed to — only the buyer who ordered the run can read it.',
      )
    }

    const [{ fetchMxePublicKey }, { decryptReport }] = await Promise.all([
      import('@genovault/crypto/mxe-key'),
      import('@genovault/crypto/report'),
    ])
    const mxePublicKey = await fetchMxePublicKey(input.rpcUrl, PROGRAM_ADDRESS)

    return decryptReport({
      buyerSecretKey: key.secretKey,
      mxePublicKey,
      nonce: BigInt(run.result.nonce),
      ciphertexts: run.result.ciphertexts.map(fromHex),
    })
  } finally {
    key.secretKey.fill(0)
  }
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

export type ReportPhase = 'idle' | 'reading' | 'done' | 'error'

export function useReport() {
  const [phase, setPhase] = useState<ReportPhase>('idle')
  const [report, setReport] = useState<FrequenciesReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const read = useCallback(async (input: ReadReportInput) => {
    setPhase('reading')
    setError(null)
    try {
      setReport(await readReport(input))
      setPhase('done')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setPhase('error')
    }
  }, [])

  return { phase, report, error, read }
}
