import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { datasetIdSchema, solanaAddressSchema } from '@genovault/shared'
import { Connection, Keypair } from '@solana/web3.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  CHAIN_READ_COMMITMENT,
  ChainStateError,
  createQuoteChainReader,
} from '../src/services/chain.ts'

/**
 * The API reads the chain at `confirmed` — `T041`.
 *
 * Measured on the stand: the default web3.js commitment is `finalized`, 31
 * slots (13 s) behind the bank a transaction executes in. For that long a
 * revoked consent still quoted as allowed and an expired one still produced an
 * order the program then refused. The API's answer is a forecast of the
 * program's verdict, and a forecast about a state 13 s old is wrong exactly
 * when it matters — right after the owner changed their mind.
 *
 * A fake RPC records what each request asked for. The control at the end shows
 * the recorder tells the difference: a connection without a commitment does
 * not send `confirmed`.
 */

interface Recorded {
  method: string
  params: unknown[]
}

const SLOT = 4_242
const BLOCK_TIME = 1_790_000_000
const recorded: Recorded[] = []
let server: Server
let url: string

function commitmentOf(entry: Recorded): unknown {
  const last = entry.params.at(-1)
  return typeof last === 'object' && last !== null && 'commitment' in last
    ? (last as { commitment: unknown }).commitment
    : undefined
}

function answer(method: string, params: unknown[]): unknown {
  if (method === 'getSlot') return SLOT
  if (method === 'getBlockTime') return BLOCK_TIME
  if (method === 'getMultipleAccounts') {
    const keys = Array.isArray(params[0]) ? params[0] : []
    return { context: { slot: SLOT }, value: keys.map(() => null) }
  }
  if (method === 'getAccountInfo') return { context: { slot: SLOT }, value: null }
  throw new Error(`the fake RPC does not answer ${method}`)
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')
    })
    request.on('end', () => {
      const call = JSON.parse(body) as { id: unknown; method: string; params?: unknown[] }
      const params = call.params ?? []
      recorded.push({ method: call.method, params })
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({ jsonrpc: '2.0', id: call.id, result: answer(call.method, params) }),
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  recorded.length = 0
})

describe('chain reads behind a pre-sign answer', () => {
  it('the quote reads slot, clock and accounts at confirmed', async () => {
    const read = createQuoteChainReader(url)
    const owner = solanaAddressSchema.parse(Keypair.generate().publicKey.toBase58())
    const datasetId = datasetIdSchema.parse('alpha')

    // No platform config on the fake chain: the reader stops there, after it
    // has already read the slot, the clock and the accounts.
    await expect(read([{ owner, datasetId }])).rejects.toBeInstanceOf(ChainStateError)

    const slots = recorded.filter((entry) => entry.method === 'getSlot')
    const accounts = recorded.filter((entry) =>
      ['getMultipleAccounts', 'getAccountInfo'].includes(entry.method),
    )
    const clocks = recorded.filter((entry) => entry.method === 'getBlockTime')

    // What the check had to look at is counted, not assumed.
    expect(slots).toHaveLength(1)
    expect(accounts.length).toBeGreaterThan(0)
    expect(clocks).toHaveLength(1)

    for (const entry of [...slots, ...accounts]) {
      expect(commitmentOf(entry), entry.method).toBe(CHAIN_READ_COMMITMENT)
    }
    // `getBlockTime` takes no commitment; its slot is the confirmed one.
    expect(clocks[0]?.params[0]).toBe(SLOT)
    expect(CHAIN_READ_COMMITMENT).toBe('confirmed')
  })

  it('control: a connection without a commitment does not ask for confirmed', async () => {
    await new Connection(url).getSlot()
    const [entry] = recorded
    expect(entry?.method).toBe('getSlot')
    expect(commitmentOf(entry as Recorded)).not.toBe('confirmed')
  })

  it('no reader in the module builds its own connection', async () => {
    // Structural, because a reader added later with `new Connection(rpcUrl)`
    // would pass every behavioural test that does not happen to call it.
    const source = await readFile(new URL('../src/services/chain.ts', import.meta.url), 'utf8')
    const constructions = source.match(/new Connection\(/g) ?? []
    expect(constructions).toHaveLength(1)
    expect(source).toContain('new Connection(rpcUrl, CHAIN_READ_COMMITMENT)')
  })
})
