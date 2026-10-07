import { RescueCipher, x25519 } from '@arcium-hq/client'
import { type FrequenciesReport, unpackReport } from '@genovault/shared'

/**
 * Reading the buyer's report of a run.
 *
 * A subpath of its own (`@genovault/crypto/report`), like `report-key`: the run
 * page loads it on demand, and only after the buyer asks to read the report.
 */

export interface DecryptReportInput {
  /** The private half of the report key — derived from the wallet signature (`T029`). */
  buyerSecretKey: Uint8Array
  /**
   * The MXE cluster's x25519 key, read from the chain.
   *
   * This one and not `RunResult.encryption_key`: `Enc<Shared, _>` encrypts to
   * the secret between the cluster and the named reader, so the reader gets
   * the same secret from its own private key and the cluster's key. The
   * `encryption_key` field holds the buyer's own key — who the report is for,
   * not what opens it.
   */
  mxePublicKey: Uint8Array
  /** `RunResult.nonce`, a u128. */
  nonce: bigint
  ciphertexts: readonly Uint8Array[]
}

/** u128 → the 16 little-endian bytes Rescue takes as its nonce. */
function nonceBytes(nonce: bigint): Uint8Array {
  const bytes = new Uint8Array(16)
  let value = nonce
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

export function decryptReport(input: DecryptReportInput): FrequenciesReport {
  const cipher = new RescueCipher(x25519.getSharedSecret(input.buyerSecretKey, input.mxePublicKey))
  const packed = cipher.decrypt(
    input.ciphertexts.map((ciphertext) => Array.from(ciphertext)),
    nonceBytes(input.nonce),
  )
  return unpackReport(packed)
}
