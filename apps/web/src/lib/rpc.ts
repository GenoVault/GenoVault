/**
 * Адреса вузла мережі для клієнта (`T029`).
 *
 * Окремий модуль на дві константи — не педантизм. Вони потрібні екрану
 * замовлення **до** підпису (щоб знати, чи є куди відправляти), а решта
 * `lib/transaction.ts` тягне за собою криптографію `@solana/kit`. Один
 * статичний імпорт звідти зводив би нанівець динамічне підвантаження й
 * повертав кит у бандл каталогу — екрана з бюджетом `SC-011` у дві секунди.
 *
 * Вузол називає клієнт, а не API: підписані байти шле гаманець, і адреса, яку
 * підказав би сервер, була б ще одним місцем, де він впливає на те, куди
 * потрапляють гроші покупця.
 */

const raw: unknown = import.meta.env.VITE_RPC_URL

export const RPC_URL: string | null =
  typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null

export const HAS_RPC: boolean = RPC_URL !== null

/**
 * Which network label the embedded wallet sends under (`T066`).
 *
 * Privy knows three labels — `solana:mainnet`, `solana:devnet`,
 * `solana:testnet` — and sends a signed transaction through the RPC its config
 * maps to the label, **mainnet when none is given**. Without this the wallet
 * would broadcast a transaction built against our node to mainnet, where its
 * blockhash does not exist. A local stand is mapped under `solana:devnet`: the
 * label picks the RPC, the node is ours.
 */
const SOLANA_CHAINS = ['solana:mainnet', 'solana:devnet', 'solana:testnet'] as const

export type SolanaChain = (typeof SOLANA_CHAINS)[number]

const rawChain: unknown = import.meta.env.VITE_SOLANA_CHAIN

export const SOLANA_CHAIN: SolanaChain =
  SOLANA_CHAINS.find((chain) => chain === rawChain) ?? 'solana:devnet'

const rawWs: unknown = import.meta.env.VITE_RPC_WS_URL

/**
 * WebSocket of the same node. By the validator's convention it listens on the
 * RPC port + 1; a hosted RPC names its own, through `VITE_RPC_WS_URL`.
 */
export const RPC_WS_URL: string | null =
  typeof rawWs === 'string' && rawWs.trim() !== ''
    ? rawWs.trim()
    : RPC_URL === null
      ? null
      : wsFor(RPC_URL)

function wsFor(http: string): string {
  const url = new URL(http)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  if (url.port !== '') url.port = String(Number(url.port) + 1)
  return url.toString().replace(/\/$/, '')
}
