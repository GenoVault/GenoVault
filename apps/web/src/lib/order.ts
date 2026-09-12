// Підшлях, а не кореневий експорт: `@genovault/crypto` тягне за собою
// `@arcium-hq/client`, який імпортує вузлівський `crypto` і не збирається під
// браузер. Виведенню ключа звіту той клієнт не потрібен.
import { deriveReportKey, reportKeyMessage, toHex } from '@genovault/crypto/report-key'
import type { ApiError, RunQuote } from '@genovault/shared'
import { useCallback, useState } from 'react'
import { postOrder, toApiError } from '@/lib/api'
import type { BuyerCategory, RunFilters, UseType } from '@/mockData'

/**
 * Замовлення прогону з боку покупця (`T029`).
 *
 * # Порядок кроків, і чому саме такий
 *
 * 1. **Гаманець підписує повідомлення** — з нього виводиться ключ, яким
 *    покупець читатиме звіт. Спершу він, бо публічна половина мусить поїхати
 *    в тій самій транзакції, що й гроші: якби ключ називала публікація,
 *    диспетчер підставив би свій і прочитав чужий звіт.
 * 2. **API складає інструкцію** — з ончейн-цін, перевіривши згоду. Він не
 *    підписує й не бачить жодного ключа.
 * 3. **Клієнт бере хеш блоку** — за мить до підпису. Хеш живе близько хвилини,
 *    і взятий на кроці 2 доїхав би сюди простроченим.
 * 4. **Гаманець підписує й відправляє.**
 *
 * Кроки 3 і 4 тягнуть за собою криптографію `@solana/kit`, тому модуль
 * транзакцій підвантажується динамічно — на екранах, які нічого не замовляють,
 * його немає в бандлі взагалі.
 *
 * # Чого тут немає
 *
 * Повторів. Якщо підпис пройшов, а відправка ні, повторний виклик зібрав би
 * **другу** транзакцію з тим самим нонсом — і мережа відхилила б її як
 * створення вже наявного акаунта. Покупець бачить помилку й вирішує сам; те,
 * що вже підписане, лишається підписаним.
 */

export type OrderPhase =
  /** Нічого не почато. */
  | 'idle'
  /** Гаманець просить підпис повідомлення — з нього виводиться ключ звіту. */
  | 'key'
  /** API складає інструкцію з ончейн-цін. */
  | 'building'
  /** Гаманець просить підпис транзакції. */
  | 'signing'
  /** Транзакція відправлена. */
  | 'sent'
  | 'error'

export interface OrderResult {
  buyer: string
  nonce: string
  /** Підпис транзакції — за ним прогін видно в експлорері. */
  signature: string
}

export interface OrderInputs {
  buyer: string
  quote: RunQuote
  datasets: { owner: string; datasetId: string }[]
  useType: UseType
  buyerCategory: BuyerCategory
  params: RunFilters
  /** Диспетчер від покупця; пропущений — той, якого публікує платформа. */
  dispatcher?: string | undefined
  token: string | null
  rpcUrl: string
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
  signAndSendTransaction: (transaction: Uint8Array) => Promise<Uint8Array>
}

/**
 * Нонс прогону — випадкові 64 біти від криптографічного генератора.
 *
 * Не лічильник і не час: нонс іде в seeds акаунта, тож збіг означає транзакцію,
 * яка падає на «акаунт уже існує». Час до мілісекунди дав би збіг на двох
 * вкладках, лічильник — на двох пристроях.
 */
export function randomNonce(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return new DataView(bytes.buffer).getBigUint64(0, true).toString(10)
}

/** Підпис транзакції у вигляді, придатному для посилання в експлорер. */
async function toBase58(bytes: Uint8Array): Promise<string> {
  const { getBase58Decoder } = await import('@solana/kit')
  return getBase58Decoder().decode(bytes)
}

export function useOrderRun() {
  const [phase, setPhase] = useState<OrderPhase>('idle')
  const [error, setError] = useState<ApiError['error'] | null>(null)
  const [result, setResult] = useState<OrderResult | null>(null)

  const reset = useCallback(() => {
    setPhase('idle')
    setError(null)
    setResult(null)
  }, [])

  const start = useCallback(async (input: OrderInputs): Promise<OrderResult | null> => {
    const nonce = randomNonce()
    setError(null)
    setResult(null)

    try {
      setPhase('key')
      const message = new TextEncoder().encode(reportKeyMessage(input.buyer, BigInt(nonce)))
      const reportKey = await deriveReportKey(await input.signMessage(message))

      setPhase('building')
      const order = await postOrder(
        {
          buyer: input.buyer,
          recipeId: input.quote.recipeId,
          useType: input.useType,
          buyerCategory: input.buyerCategory,
          datasets: input.datasets,
          params: { ...input.params },
          nonce,
          // Стеля — рівно та сума, яку покупець щойно бачив. Вища зробила б
          // видиме число декорацією, нижча завалила б транзакцію на межі.
          maxEscrow: input.quote.upperBound,
          buyerX25519: toHex(reportKey.publicKey),
          ...(input.dispatcher === undefined ? {} : { dispatcher: input.dispatcher }),
        },
        { token: input.token },
      )

      const { buildTransaction, fetchLifetime, serializeTransaction, toKitInstruction } =
        await import('@/lib/transaction')

      setPhase('signing')
      const lifetime = await fetchLifetime(input.rpcUrl)
      const transaction = buildTransaction(
        toKitInstruction(order.instruction),
        input.buyer,
        lifetime,
      )
      const signature = await input.signAndSendTransaction(serializeTransaction(transaction))

      const done: OrderResult = {
        buyer: input.buyer,
        nonce,
        signature: await toBase58(signature),
      }
      setResult(done)
      setPhase('sent')
      return done
    } catch (cause) {
      setError(toApiError(cause))
      setPhase('error')
      return null
    }
  }, [])

  return { phase, error, result, start, reset }
}
