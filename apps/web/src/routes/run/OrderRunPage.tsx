/**
 * Екран 4, частини A і B — складання прогону і оцінка `/runs/new`.
 * Неприйнятний рядок не має жодного числа: тільки названа причина.
 */

import { Ban, Info, Plus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Amount, Count, KeyValue, SourceNote, Tag } from '@/components/Primitives'
import { EmptyState, SignInGate, StatePreview, WalletSignStep } from '@/components/StateBlocks'
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
  USE_TYPE_LABEL,
} from '@/lib/format'
import { buildQuote } from '@/lib/quote'
import {
  type AffectedFilter,
  BUYER_CATEGORIES,
  type BuyerCategory,
  DATASETS,
  datasetKey,
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

const OrderRunFlow = () => {
  const { pool, addToPool, removeFromPool } = useAppState()
  const navigate = useNavigate()

  const [useType, setUseType] = useState<UseType>('rareDisease')
  const [buyerCategory, setBuyerCategory] = useState<BuyerCategory>('academic')
  const [filters, setFilters] = useState<RunFilters>(MOCK_QUOTE_FILTERS)
  const [platformPaused, setPlatformPaused] = useState<'running' | 'platform-paused'>('running')
  const [signing, setSigning] = useState(false)

  // Прототип: якщо покупець зайшов напряму, пул один раз заповнюється каталогом,
  // щоб оцінка мала що показати. Далі пул повністю в руках користувача.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current) return
    seeded.current = true
    if (pool.length === 0) {
      for (const d of DATASETS) addToPool(datasetKey(d))
    }
  }, [pool.length, addToPool])

  const poolDatasets = useMemo(() => DATASETS.filter((d) => pool.includes(datasetKey(d))), [pool])

  const available = DATASETS.filter((d) => !pool.includes(datasetKey(d)))

  const quote = useMemo(
    () =>
      buildQuote(
        poolDatasets,
        useType,
        buyerCategory,
        filters,
        platformPaused === 'platform-paused',
      ),
    [poolDatasets, useType, buyerCategory, filters, platformPaused],
  )

  const setFilter = <K extends keyof RunFilters>(key: K, value: RunFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }))

  const clampAge = (raw: string) => {
    const n = Number(raw.replace(/\D/g, ''))
    if (!Number.isFinite(n)) return LIMITS.AGE_MIN
    return Math.min(LIMITS.AGE_MAX, Math.max(LIMITS.AGE_MIN, n))
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
                key={datasetKey(d)}
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
                  onClick={() => removeFromPool(datasetKey(d))}
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
                key={datasetKey(d)}
                variant="outline"
                size="sm"
                className="num text-[12.5px]"
                onClick={() => addToPool(datasetKey(d))}
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

        {quote.rows.length === 0 ? (
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
                {quote.rows.map((row) => (
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
                      <p className="text-[12px] text-muted-foreground">{row.ownerName}</p>
                    </TableCell>
                    {row.eligible ? (
                      <>
                        <TableCell className="text-right">
                          <Amount value={row.pricePer1k ?? 0} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Count value={row.claimedRecords ?? 0} />
                        </TableCell>
                        <TableCell className="text-right">
                          <Amount value={row.upperBound ?? 0} />
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

        <div className="hairline mt-5 grid gap-5 pt-5 md:grid-cols-3">
          <KeyValue label="Upper bound">
            <Amount value={quote.upperBound} className="text-xl" withMint />
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
              Exactly this amount is locked in escrow. Whatever the run does not use is refunded to
              you when it settles.
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
              {quote.eligibleCount} of {quote.totalCount}
            </span>
            <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
              Ineligible datasets carry no numbers — a price for a dataset that cannot be computed
              is a false quote.
            </p>
          </KeyValue>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button disabled={!quote.orderable} onClick={() => setSigning(true)}>
            Order run
          </Button>
          {quote.blocker && (
            <span className="flex items-center gap-1.5 text-[13px] text-destructive">
              <Info className="h-3.5 w-3.5" />
              {BLOCKER_TEXT[quote.blocker]}
            </span>
          )}
          {quote.orderable && (
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
          body={`Locking the upper bound of the quote. The platform never signs on your behalf, and the difference between the upper bound and the actual cost comes back to you at settlement.`}
          confirmLabel="Sign and order"
          pending={false}
          onConfirm={() => navigate(`/runs/${RUNS.accepted.runId}`)}
          onCancel={() => setSigning(false)}
        />
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
