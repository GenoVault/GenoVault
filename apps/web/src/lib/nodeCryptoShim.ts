/**
 * What `@arcium-hq/client` imports from Node's `crypto`, for the browser (`T066`).
 *
 * The client's first line is `import { randomBytes, createHash, createCipheriv,
 * createDecipheriv } from 'crypto'`, and Vite has no `crypto` for the browser:
 * the build failed on that import alone. The dataset is encrypted with
 * `RescueCipher`, which calls **none** of the four — they serve
 * `generateRandomFieldElem`, a SHA helper and the AES ciphers, none of which
 * the product uses (decision 2026-10-07: replace the module, do not
 * polyfill Node and do not rewrite the cipher).
 *
 * So `randomBytes` is real, from the browser's CSPRNG, and the other three
 * refuse by name. If a future client calls one on our path, the owner sees
 * which, instead of an envelope built on a stub.
 */

class NotInBrowser extends Error {
  override readonly name = 'NotInBrowser'

  constructor(what: string) {
    super(`crypto.${what} is not available in the browser build of GenoVault`)
  }
}

/** Bytes with the one Buffer method the client reads off them: `toString('hex')`. */
class RandomBytes extends Uint8Array {
  override toString(encoding?: string): string {
    if (encoding !== 'hex') return super.toString()
    return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
}

export function randomBytes(size: number): RandomBytes {
  const bytes = new RandomBytes(size)
  // `getRandomValues` takes at most 65 536 bytes per call.
  for (let offset = 0; offset < size; offset += 65_536) {
    globalThis.crypto.getRandomValues(bytes.subarray(offset, Math.min(size, offset + 65_536)))
  }
  return bytes
}

export function createHash(): never {
  throw new NotInBrowser('createHash')
}

export function createCipheriv(): never {
  throw new NotInBrowser('createCipheriv')
}

export function createDecipheriv(): never {
  throw new NotInBrowser('createDecipheriv')
}

export default { randomBytes, createHash, createCipheriv, createDecipheriv }
