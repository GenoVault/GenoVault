/**
 * Екран 4, частини A і B — складання прогону і оцінка `/runs/new`.
 * Неприйнятний рядок не має жодного числа: тільки названа причина.
 */

import { Ban, Info, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Amount, Count, KeyValue, SourceNote, Tag } from '@/components/Primitives'
import {
  EmptyState,
  ErrorBlock,
  SignInGate,
  StatePreview,
  WalletSignStep,
} from '@/components/StateBlocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAppState } from '@/lib/appState'
import {
  BLOCKER_TEXT,
  BUYER_CATEGORY_LABEL,
  formatBps,
  formatInt,
  REASON_TEXT,
  truncateMiddle,
  USE_TYPE_LABEL,
} from '@/lib/format'
import { type OrderPhase, useOrderRun } from '@/lib/order'
import { RPC_URL } from '@/lib/rpc'
import { LIVE_DATA, useCatalog, usePlatform, useQuote } from '@/lib/runData'
import {
  type AffectedFilter,
  BUYER_CATEGORIES,
  type BuyerCategory,
  FREQUENCIES_RECIPE,
  LIMITS,
  MOCK_QUOTE_FILTERS,
  RUNS,
  type RunFilters,
  type SexFilter,
  USE_TYPES,
  type UseType,
} from '@/mockData'

const recipe = FREQUENCIES_RECIPE

/** Ключ датасету в пулі — та сама пара, що адресує його всюди. */
const key = (dataset: { owner: string; datasetId: string }) =>
  `${dataset.owner}/${dataset.datasetId}`

/**
 * Що саме зараз відбувається, поки покупець дивиться на модалку.
 *
 * Чотири кроки, і кожен названий: покупець підписує двічі, і без пояснення
 * другий запит гаманця виглядає як збій. Перший підпис — не про гроші, і саме
 * це треба сказати першим.
 */
const ORDER_STEP_TEXT: Record<OrderPhase, string> = {
  idle:
    'Two signatures, in this order. First a message — it derives the key your report is ' +
    'encrypted to, and moves no money. Then the transaction that locks the quote in escrow. ' +
    'The platform never signs on your behalf, and whatever the run does not use comes back ' +
    'to you at settlement.',
  key: 'Waiting for the message signature — this one derives your report key.',
  building: 'The API is composing the instruction from on-chain prices.',
  signing: 'Waiting for the transaction signature — this one locks the escrow.',
  sent: 'Sent. Opening the run…',
  error: 'The run was not ordered. Nothing was locked.',
}

const ORDER_ERROR_HINT =
  'Nothing is locked until the transaction is signed and accepted. If the signature went ' +
  'through but the send did not, do not order again with the same run — check the run page first.'

const OrderRunFlow = () => {
  const { pool, addToPool, removeFromPool, address, token, signMessage, signAndSendTransaction } =
    useAppState()
  const navigate = useNavigate()

  const [useType, setUseType] = useState<UseType>('rareDisease')
  const [buyerCategory, setBuyerCategory] = useState<BuyerCategory>('academic')
  const [filters, setFilters] = useState<RunFilters>(MOCK_QUOTE_FILTERS)
  const [platformPaused, setPlatformPaused] = useState<'running' | 'platform-paused'>('running')
  const [signing, setSigning] = useState(false)

  const catalog = useCatalog(token)
  const platform = usePlatform()
  const order = useOrderRun()

  const datasets = useMemo(() => catalog.data ?? [], [catalog.data])

  // Прототип: якщо покупець зайшов напряму, пул один раз заповнюється каталогом,
  // щоб оцінка мала що показати. Далі пул повністю в руках користувача.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || datasets.length === 0) return
    seeded.current = true
    if (pool.length === 0) {
      for (const dataset of datasets) addToPool(key(dataset))
    }
  }, [pool.length, addToPool, datasets])

  const poolDatasets = useMemo(
    () => datasets.filter((dataset) => pool.includes(key(dataset))),
    [datasets, pool],
  )

  const available = datasets.filter((dataset) => !pool.includes(key(dataset)))

  const request = useMemo(
    () => ({
      datasets: poolDatasets.map((dataset) => ({
        owner: dataset.owner,
        datasetId: dataset.datasetId,
      })),
      useType,
      buyerCategory,
      params: { ...filters },
    }),
    [poolDatasets, useType, buyerCategory, filters],
  )

  const quoted = useQuote(request, token, platformPaused === 'platform-paused')
  const quote = quoted.data

  const setFilter = <K extends keyof RunFilters>(key2: K, value: RunFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key2]: value }))

  const clampAge = (raw: string) => {
    const n = Number(raw.replace(/\D/g, ''))
    if (!Number.isFinite(n)) return LIMITS.AGE_MIN
    return Math.min(LIMITS.AGE_MAX, Math.max(LIMITS.AGE_MIN, n))
  }

  /**
   * Замовлення.
   *
   * У прототипі підписувати нічого: гаманця немає, і вдавати підпис означало б
   * показувати робочий шлях покупця там, де його немає. Тому мок веде на
   * заготовлений прогін, а живий режим проходить усі чотири кроки `useOrderRun`.
   */
  const confirm = async () => {
    if (!LIVE_DATA || quote === null || address === null || RPC_URL === null) {
      navigate(`/runs/mock/${RUNS.accepted.status}`)
      return
    }

    const done = await order.start({
      buyer: address,
      quote,
      datasets: request.datasets,
      useType,
      buyerCategory,
      params: filters,
      ...(platform.data?.dispatcher == null ? {} : { dispatcher: platform.data.dispatcher }),
      token,
      rpcUrl: RPC_URL,
      signMessage,
      signAndSendTransaction,
    })

    if (done !== null) navigate(`/runs/${done.buyer}/${done.nonce}`)
  }

  return (
    <div className="flex flex-col gap-5">
      {/* A1 — recipe */}
      <section className="panel p-5">
        <h2 className="text-[19px]">Recipe</h2>
        <div className="mt-4 rounded border border-primary/30 bg-info-soft/50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-base">{recipe.name}</h3>
            <span className="num text-[12px] text-muted-foreground">
              id {recipe.id} · {recipe.key}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
            {recipe.description}
          </p>
          <div className="mt-3 flex flex-wrap gap-4 text-[12.5px]">
            <span>
              markers: <Count value={recipe.maxMarkers} />
            </span>
            <span>
              minimum cohort: <Count value={recipe.minCohort} />
            </span>
          </div>
        </div>
        <p className="mt-3 text-[13px] leading-6 text-muted-foreground">
          More recipes are added on the platform side. Buyers do not submit their own code.
        </p>
      </section>

      {/* A2, A3 — parameters, who and what for */}
      <section className="panel p-5">
        <h2 className="text-[19px]">Parameters</h2>
        <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <span className="label-tiny mb-1 block">
              Age window · {LIMITS.AGE_MIN}…{LIMITS.AGE_MAX}, both ends inclusive
            </span>
            <div className="flex items-center gap-2">
              <Input
                aria-label="Minimum age"
                inputMode="numeric"
                value={String(filters.minAge)}
                onChange={(e) => setFilter('minAge', clampAge(e.target.value))}
                className="num w-20"
              />
              <span className="text-muted-foreground">→</span>
              <Input
                aria-label="Maximum age"
                inputMode="numeric"
                value={String(filters.maxAge)}
                onChange={(e) => setFilter('maxAge', clampAge(e.target.value))}
                className="num w-20"
              />
            </div>
          </div>

          <div>
            <span className="label-tiny mb-1 block">Sex</span>
            <Select value={filters.sex} onValueChange={(v) => setFilter('sex', v as SexFilter)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="male">Male</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <span className="label-tiny mb-1 block">Affected status</span>
            <Select
              value={filters.affected}
              onValueChange={(v) => setFilter('affected', v as AffectedFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="affected">Affected</SelectItem>
                <SelectItem value="unaffected">Unaffected</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3 xl:col-span-1">
            <div>
              <span className="label-tiny mb-1 block">Use type</span>
              <Select value={useType} onValueChange={(v) => setUseType(v as UseType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USE_TYPES.map((u) => (
                    <SelectItem key={u} value={u}>
                      {USE_TYPE_LABEL[u]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <span className="label-tiny mb-1 block">Buyer category</span>
              <Select
                value={buyerCategory}
                onValueChange={(v) => setBuyerCategory(v as BuyerCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUYER_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {BUYER_CATEGORY_LABEL[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <SourceNote className="mt-4">
          Both “what for” and “who” are single-select: a run is checked against one use type and one
          buyer category, never a set.
        </SourceNote>
      </section>

      {/* A4 — pool */}
      <section className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[19px]">Dataset pool</h2>
          <span className="num text-[12.5px] text-muted-foreground">
            {formatInt(pool.length)} / {formatInt(LIMITS.MAX_RUN_DATASETS)}
          </span>
        </div>

        {poolDatasets.length === 0 ? (
          <p className="mt-3 text-[13.5px] text-muted-foreground">
            The pool is empty. Add datasets from the{' '}
            <Link to="/datasets" className="underline underline-offset-2">
              catalog
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-4 flex flex-wrap gap-2">
            {poolDatasets.map((d) => (
              <li
                key={key(d)}
                className="flex items-center gap-2 rounded border border-border bg-surface-sunken/60 py-1 pl-2.5 pr-1.5"
              >
                <Link
                  to={`/datasets/${d.owner}/${d.datasetId}`}
                  className="num text-[12.5px] hover:underline"
                >
                  {d.datasetId}
                </Link>
                <button
                  type="button"
                  aria-label={`Remove ${d.datasetId}`}
                  onClick={() => removeFromPool(key(d))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {available.length > 0 && pool.length < LIMITS.MAX_RUN_DATASETS && (
          <div className="mt-4 flex flex-wrap gap-2">
            {available.map((d) => (
              <Button
                key={key(d)}
                variant="outline"
                size="sm"
                className="num text-[12.5px]"
                onClick={() => addToPool(key(d))}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {d.datasetId}
              </Button>
            ))}
          </div>
        )}
      </section>

      {/* B — quote */}
      <section className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[19px]">Quote</h2>
          <StatePreview
            label="Platform"
            options={['running', 'platform-paused'] as const}
            value={platformPaused}
            onChange={setPlatformPaused}
          />
        </div>

        {quoted.error !== null ? (
          <div className="mt-4">
            <ErrorBlock error={quoted.error} />
          </div>
        ) : quote === null || quote.datasets.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nothing to quote yet"
              body="A quote needs at least one dataset in the pool."
              action={
                <Button variant="outline" asChild>
                  <Link to="/datasets">Open the catalog</Link>
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dataset</TableHead>
                  <TableHead className="text-right">Price / 1000</TableHead>
                  <TableHead className="text-right">Claimed records</TableHead>
                  <TableHead className="text-right">Upper bound</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {quote.datasets.map((row) => (
                  <TableRow
                    key={`${row.owner}/${row.datasetId}`}
                    className={row.eligible ? '' : 'bg-surface-sunken/40'}
                  >
                    <TableCell>
                      <Link
                        to={`/datasets/${row.owner}/${row.datasetId}`}
                        className="num text-[13px] hover:underline"
                      >
                        {row.datasetId}
                      </Link>
                      <p className="num text-[12px] text-muted-foreground">
                        {truncateMiddle(row.owner, 4, 4)}
                      </p>
                    </TableCell>
                    {row.eligible ? (
                      <>
                        <TableCell className="text-right">
                          <Amount value={row.pricePer1k} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Count value={Number(row.recordCountClaimed)} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Amount value={row.upperBound} />
                        </TableCell>
                      </>
                    ) : (
                      <TableCell colSpan={3}>
                        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                          <Ban className="h-3.5 w-3.5 shrink-0 text-destructive" />
                          {REASON_TEXT[row.reason]}
                          <span className="num text-[11.5px] opacity-70">{row.reason}</span>
                        </span>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {quote !== null && (
          <div className="hairline mt-5 grid gap-5 pt-5 md:grid-cols-3">
            <KeyValue label="Upper bound">
              <Amount value={quote.upperBound} className="text-xl" withMint />
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                Exactly this amount is locked in escrow. Whatever the run does not use is refunded
                to you when it settles.
              </p>
            </KeyValue>
            <KeyValue label="Platform fee">
              <span className="num text-xl">{formatBps(quote.feeBps)}</span>
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                Taken out of the owner's payout, not added to your bill. You pay exactly price ×
                records.
              </p>
            </KeyValue>
            <KeyValue label="Eligible datasets">
              <span className="num text-xl">
                {quote.eligibleCount} of {quote.datasets.length}
              </span>
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                Ineligible datasets carry no numbers — a price for a dataset that cannot be computed
                is a false quote.
              </p>
            </KeyValue>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            disabled={quote === null || !quote.orderable || order.phase !== 'idle'}
            onClick={() => setSigning(true)}
          >
            Order run
          </Button>
          {quote?.blocker && (
            <span className="flex items-center gap-1.5 text-[13px] text-destructive">
              <Info className="h-3.5 w-3.5" />
              {BLOCKER_TEXT[quote.blocker]}
            </span>
          )}
          {quote?.orderable && (
            <span className="text-[12.5px] text-muted-foreground">
              A cohort smaller than <span className="num">{LIMITS.MIN_COHORT}</span> records yields
              a report of zeros.
            </span>
          )}
        </div>
      </section>

      {signing && (
        <WalletSignStep
          title="Sign the escrow lock in your wallet"
          body={ORDER_STEP_TEXT[order.phase]}
          confirmLabel="Sign and order"
          pending={order.phase !== 'idle' && order.phase !== 'error'}
          onConfirm={() => void confirm()}
          onCancel={() => {
            order.reset()
            setSigning(false)
          }}
        />
      )}

      {order.error !== null && (
        <div className="panel p-5">
          <ErrorBlock error={order.error} onRetry={order.reset} />
          <p className="mt-3 text-[12.5px] leading-5 text-muted-foreground">{ORDER_ERROR_HINT}</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Tag>no raw results</Tag>
        <Tag>no cohort export</Tag>
        <Tag>no sample records</Tag>
        <span className="text-[12.5px] text-muted-foreground">
          A result is a statistic, not a slice of the data.
        </span>
      </div>
    </div>
  )
}

const OrderRunPage = () => (
  <div className="flex flex-col gap-6">
    <header className="max-w-3xl">
      <h1 className="text-[30px] leading-[1.15] md:text-[36px]">Order a run</h1>
      <p className="mt-3 text-[14.5px] leading-7 text-muted-foreground">
        Pick the recipe and its parameters, say who is computing and what for, then read the quote
        before anything is locked.
      </p>
    </header>
    <SignInGate what="order a run">
      <OrderRunFlow />
    </SignInGate>
  </div>
)

export default OrderRunPage
