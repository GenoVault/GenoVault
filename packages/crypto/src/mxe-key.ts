import { AnchorProvider } from '@anchor-lang/core'
import { getMXEPublicKey } from '@arcium-hq/client'
import { Connection, PublicKey, type Transaction, type VersionedTransaction } from '@solana/web3.js'

/**
 * The key a dataset is encrypted to — read from the chain by whoever encrypts
 * (`T066`).
 *
 * Not from the API, and on purpose: an API that handed out the MXE key could
 * hand out its own, and the owner's browser would encrypt the dataset to a key
 * the server holds. That is the one change `CLAUDE.md` names as a change of
 * product, not of code. The key lives in the MXE account of our program, the
 * caller names the node, and the program address is pinned in the client
 * (`PROGRAM_ADDRESS`, generated from the IDL).
 *
 * `tools/audit-verify` reads the same key its own way and does not import this
 * — the verifier stays independent of the code it checks.
 */

export class MxeKeyError extends Error {
  override readonly name = 'MxeKeyError'
}

/**
 * A provider that can read and cannot sign. `getMXEPublicKey` wants an Anchor
 * provider only to fetch one account; a wallet that signs nothing is exactly
 * the authority this read needs.
 */
const readOnlyWallet = {
  publicKey: PublicKey.default,
  signTransaction<T extends Transaction | VersionedTransaction>(): Promise<T> {
    return Promise.reject(new MxeKeyError('reading the MXE key signs nothing'))
  },
  signAllTransactions<T extends Transaction | VersionedTransaction>(): Promise<T[]> {
    return Promise.reject(new MxeKeyError('reading the MXE key signs nothing'))
  },
}

export async function fetchMxePublicKey(
  rpcUrl: string,
  programAddress: string,
): Promise<Uint8Array> {
  const connection = new Connection(rpcUrl, 'confirmed')
  const provider = new AnchorProvider(connection, readOnlyWallet, { commitment: 'confirmed' })

  let key: Uint8Array | null
  try {
    key = await getMXEPublicKey(provider, new PublicKey(programAddress))
  } catch {
    // No MXE account at all: a bare validator, or a program never registered
    // with a cluster. Encrypting to anything else would make data no cluster
    // can compute over.
    throw new MxeKeyError(
      'this network has no MXE for the program — runs need an Arcium cluster, and so does encryption',
    )
  }
  if (key === null) {
    throw new MxeKeyError(
      'the MXE has no public key yet — the cluster has not finished key generation',
    )
  }
  return key
}
