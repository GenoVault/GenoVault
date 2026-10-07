import { RescueCipher, x25519 } from '@arcium-hq/client'
import { REPORT_LAYOUT } from '@genovault/shared'
import { describe, expect, it } from 'vitest'
import { decryptReport } from '../src/report.ts'

/** Six 32-bit lanes per element — the shape `frequencies_reveal` returns. */
function pack(values: readonly number[]): bigint[] {
  const packed: bigint[] = []
  for (let start = 0; start < values.length; start += 6) {
    let element = 0n
    for (const [lane, value] of values.slice(start, start + 6).entries()) {
      element |= BigInt(value) << BigInt(lane * 32)
    }
    packed.push(element)
  }
  return packed
}

function nonceBytes(nonce: bigint): Uint8Array {
  const bytes = new Uint8Array(16)
  let value = nonce
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number(value & 0xffn)
    value >>= 8n
  }
  return bytes
}

describe('decryptReport', () => {
  // The cluster side of `Enc<Shared, _>`: the MXE key pair and the buyer's
  // public key give the secret the buyer recomputes from its private key.
  const mxeSecret = x25519.utils.randomSecretKey()
  const buyerSecret = x25519.utils.randomSecretKey()
  const values = REPORT_LAYOUT.names.map((_name, index) => 7 + index * 3)
  const nonce = 0x0102030405060708090a0b0c0d0e0f10n

  function seal(): Uint8Array[] {
    const cipher = new RescueCipher(
      x25519.getSharedSecret(mxeSecret, x25519.getPublicKey(buyerSecret)),
    )
    return cipher.encrypt(pack(values), nonceBytes(nonce)).map((block) => Uint8Array.from(block))
  }

  it('opens the report with the buyer key and the cluster key', () => {
    const report = decryptReport({
      buyerSecretKey: buyerSecret,
      mxePublicKey: x25519.getPublicKey(mxeSecret),
      nonce,
      ciphertexts: seal(),
    })

    expect(report.included).toBe(values[0])
    expect(report.alleleSum).toEqual(values.slice(12))
  })

  it('a different nonce does not give the same numbers', () => {
    // Wrong nonce byte order would decrypt to noise and still "succeed" — the
    // only symptom is numbers that do not match, so this is what is checked.
    let report: ReturnType<typeof decryptReport> | undefined
    try {
      report = decryptReport({
        buyerSecretKey: buyerSecret,
        mxePublicKey: x25519.getPublicKey(mxeSecret),
        nonce: nonce + 1n,
        ciphertexts: seal(),
      })
    } catch {
      report = undefined
    }
    expect(report?.included).not.toBe(values[0])
  })
})
