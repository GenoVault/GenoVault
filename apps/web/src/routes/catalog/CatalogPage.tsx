/**
 * Екран 1 — каталог `/datasets`. Бюджет SC-011: дві секунди, тому скелетон,
 * а не спінер, і жодного читання ланцюга на рядок.
 * Форма датасету, не записи (FR-002).
 */

import { Plus, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Amount, Count, Tag } from '@/components/Primitives'
import { EmptyState, ErrorBlock, SkeletonCard, StatePreview } from '@/components/StateBlocks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useAppState } from '@/lib/appState'
import { formatDate, SOURCE_LABEL } from '@/lib/format'
import { DATASET_SOURCES, DATASETS, type Dataset, datasetKey, LIMITS } from '@/mockData'

type ViewState = 'list' | 'empty' | 'error'

const DatasetCard = ({ dataset }: { dataset: Dataset }) => {
  const { pool, addToPool } = useAppState()
  const key = datasetKey(dataset)
  const inPool = pool.includes(key)

  return (
    <article className="panel group flex flex-col p-4 transition-shadow hover:shadow-[0_2px_2px_hsl(30_20%_40%/0.05),0_14px_28px_-14px_hsl(30_24%_30%/0.28)]">
      <div className="flex items-start justify-between gap-3">
        <Tag tone="brand">{SOURCE_LABEL[dataset.source]}</Tag>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-[12px] text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => addToPool(key)}
          disabled={inPool}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          {inPool ? 'In run' : 'Add to run'}
        </Button>
      </div>

      <h2 className="mt-2.5 text-[17px] leading-6">
        <Link
          to={`/datasets/${dataset.owner}/${dataset.datasetId}`}
          className="hover:underline hover:underline-offset-4"
        >
          {dataset.title}
        </Link>
      </h2>
      <p className="num mt-1 text-[11.5px] text-muted-foreground">{dataset.datasetId}</p>

      <p className="mt-2.5 line-clamp-3 text-[13.5px] leading-6 text-muted-foreground">
        {dataset.description}
      </p>

      <dl className="hairline mt-4 grid grid-cols-2 gap-x-4 gap-y-3 pt-3 text-[13px]">
        <div>
          <dt className="label-tiny">Records</dt>
          <dd className="mt-0.5">
            <Count value={dataset.records} />
          </dd>
        </div>
        <div>
          <dt className="label-tiny">Markers</dt>
          <dd className="mt-0.5">
            <Count value={dataset.markers} />
          </dd>
        </div>
        <div>
          <dt className="label-tiny">Price / 1000 records</dt>
          <dd className="mt-0.5">
            <Amount value={dataset.pricePer1k} withMint />
          </dd>
        </div>
        <div>
          <dt className="label-tiny">Updated</dt>
          <dd className="num mt-0.5">{formatDate(dataset.updatedAt)}</dd>
        </div>
      </dl>
    </article>
  )
}

/** Скелетони — шість своїх ключів, а не індекс масиву. */
const SKELETON_KEYS = ['a', 'b', 'c', 'd', 'e', 'f']

const CatalogPage = () => {
  const [params, setParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<ViewState>('list')

  const q = params.get('q') ?? ''
  const source = params.get('source') ?? 'any'
  const minRecords = params.get('minRecords') ?? ''
  const maxPrice = params.get('maxPrice') ?? ''

  useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 420)
    return () => window.clearTimeout(timer)
  }, [])

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value === '' || value === 'any') next.delete(name)
    else next.set(name, value)
    setParams(next, { replace: true })
  }

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const min = minRecords === '' ? 0 : Number(minRecords)
    const max = maxPrice === '' ? Number.POSITIVE_INFINITY : Number(maxPrice) * 1_000_000
    return DATASETS.filter((d) => {
      const matchesText =
        needle === '' ||
        d.title.toLowerCase().includes(needle) ||
        d.description.toLowerCase().includes(needle)
      return (
        matchesText &&
        (source === 'any' || d.source === source) &&
        d.records >= min &&
        d.pricePer1k <= max
      )
    })
  }, [q, source, minRecords, maxPrice])

  const shown = view === 'empty' ? [] : results.slice(0, LIMITS.DATASET_LIST_LIMIT_DEFAULT)
  const filtersActive = q !== '' || source !== 'any' || minRecords !== '' || maxPrice !== ''

  return (
    <div className="flex flex-col gap-6">
      <header className="max-w-3xl">
        <h1 className="text-[30px] leading-[1.15] md:text-[38px]">Dataset catalog</h1>
        <p className="mt-3 text-[14.5px] leading-7 text-muted-foreground">
          Every entry describes the <em>shape</em> of a dataset — which fields exist, how many
          records, what the owner declared. No individual record is shown here or anywhere else in
          the product.
        </p>
      </header>

      <div className="panel flex flex-col gap-3 p-3 md:flex-row md:items-end">
        <div className="relative flex-1">
          <label className="label-tiny mb-1 block" htmlFor="catalog-q">
            Search title and description
          </label>
          <Search className="pointer-events-none absolute bottom-2.5 left-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            id="catalog-q"
            value={q}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="exome, cardiology, pilot…"
            className="pl-8"
          />
        </div>

        <div className="md:w-44">
          <label className="label-tiny mb-1 block" htmlFor="catalog-source">
            Provenance
          </label>
          <Select value={source} onValueChange={(v) => setParam('source', v)}>
            <SelectTrigger id="catalog-source">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any provenance</SelectItem>
              {DATASET_SOURCES.map((s) => (
                <SelectItem key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="md:w-40">
          <label className="label-tiny mb-1 block" htmlFor="catalog-min-records">
            Min records
          </label>
          <Input
            id="catalog-min-records"
            value={minRecords}
            inputMode="numeric"
            onChange={(e) => setParam('minRecords', e.target.value.replace(/\D/g, ''))}
            placeholder="0"
            className="num"
          />
        </div>

        <div className="md:w-44">
          <label className="label-tiny mb-1 block" htmlFor="catalog-max-price">
            Max price / 1000
          </label>
          <Input
            id="catalog-max-price"
            value={maxPrice}
            inputMode="decimal"
            onChange={(e) => setParam('maxPrice', e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="no limit"
            className="num"
          />
        </div>

        {filtersActive && (
          <Button
            variant="ghost"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            <X className="mr-1.5 h-4 w-4" />
            Reset
          </Button>
        )}
      </div>

      <StatePreview options={['list', 'empty', 'error'] as const} value={view} onChange={setView} />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {SKELETON_KEYS.map((key) => (
            <SkeletonCard key={key} />
          ))}
        </div>
      ) : view === 'error' ? (
        <ErrorBlock
          error={{
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'The catalog index did not answer. Nothing was lost — try again.',
            details: { endpoint: 'GET /datasets' },
          }}
          onRetry={() => setView('list')}
        />
      ) : shown.length === 0 ? (
        <EmptyState
          title="No dataset matches these filters"
          body="Loosen a filter, or clear them all. The catalog has no popularity or rating to sort by — no such number exists in the system."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setParams(new URLSearchParams(), { replace: true })
                setView('list')
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-[12.5px] text-muted-foreground">
            Showing <span className="num">{shown.length}</span> of{' '}
            <span className="num">{results.length}</span> ·{' '}
            <span className="num">{LIMITS.DATASET_LIST_LIMIT_DEFAULT}</span> per page · field
            schema, declared statistics and chain state live on each dataset card
          </p>
          <div className="grid animate-rise-in gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((d) => (
              <DatasetCard key={datasetKey(d)} dataset={d} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default CatalogPage
