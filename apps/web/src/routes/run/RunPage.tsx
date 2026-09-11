/**
 * Екран 4, частина C — прогін і результат `/runs/:runId`.
 * Звіт — агрегати. Жодного subjectId, жодного експорту когорти.
 */

import { CheckCircle2, CircleDashed, Loader2, XCircle } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Amount,
  BarRow,
  CopyValue,
  Count,
  FrequencySparkline,
  KeyValue,
  SourceNote,
  Tag,
} from '@/components/Primitives'
import { ErrorBlock, SignInGate, StatePreview } from '@/components/StateBlocks'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  BUYER_CATEGORY_LABEL,
  formatBps,
  formatDateTime,
  formatInt,
  formatRate,
  RUN_STATUS_LABEL,
  truncateMiddle,
  USE_TYPE_LABEL,
} from '@/lib/format'
import { RECIPES, RUN_STATUS_ORDER, RUNS, type Run, type RunStatus } from '@/mockData'

const StatusTag = ({ status }: { status: RunStatus }) => {
  const map: Record<
    RunStatus,
    { tone: 'info' | 'success' | 'danger' | 'warning'; icon: ReactNode }
  > = {
    accepted: { tone: 'info', icon: <CircleDashed className="h-3 w-3" /> },
    running: { tone: 'info', icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    completed: { tone: 'success', icon: <CheckCircle2 className="h-3 w-3" /> },
    failed: { tone: 'danger', icon: <XCircle className="h-3 w-3" /> },
    rejected: { tone: 'warning', icon: <XCircle className="h-3 w-3" /> },
  }
  const { tone, icon } = map[status]
  return (
    <Tag tone={tone}>
      {icon}
      {RUN_STATUS_LABEL[status]}
    </Tag>
  )
}

const RunReportBlock = ({ run }: { run: Run }) => {
  const report = run.report
  if (!report) return null
  const histMax = Math.max(...report.ageHistogram.map((b) => b.count))

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[19px]">Report</h2>
        <span className="text-[12.5px] text-muted-foreground">
          aggregates over <span className="num">{formatInt(report.cohortSize)}</span> records
        </span>
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div>
          <span className="label-tiny">
            Allele frequencies · <span className="num">{report.alleleFrequencies.length}</span>{' '}
            markers
          </span>
          <FrequencySparkline values={report.alleleFrequencies} className="mt-2" height={64} />
          <SourceNote className="mt-2">
            Computed by the recipe over the filtered cohort. One value per marker, in schema order.
          </SourceNote>
        </div>

        <div className="flex flex-col gap-5">
          <div>
            <span className="label-tiny mb-2 block">Distribution by sex</span>
            <div className="flex flex-col gap-2">
              <BarRow
                label="female"
                value={report.sexDistribution.female}
                total={report.cohortSize}
              />
              <BarRow label="male" value={report.sexDistribution.male} total={report.cohortSize} />
            </div>
          </div>
          <div>
            <span className="label-tiny mb-2 block">
              Age histogram · five-year buckets, {run.filters.minAge}–{run.filters.maxAge}
            </span>
            <div className="flex flex-col gap-1.5">
              {report.ageHistogram.map((b) => (
                <BarRow
                  key={b.from}
                  label={`${b.from}–${b.to}`}
                  value={b.count}
                  total={histMax}
                  tone="brand"
                />
              ))}
            </div>
          </div>
          <KeyValue label="Affected rate">
            <span className="num text-lg">{formatRate(report.affectedRate)}</span>
          </KeyValue>
        </div>
      </div>
    </section>
  )
}

const SettlementBlock = ({ run }: { run: Run }) => {
  const s = run.settlement
  if (!s) return null
  return (
    <section className="panel p-5">
      <h2 className="text-[19px]">Payment</h2>
      <div className="mt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dataset</TableHead>
              <TableHead className="text-right">Records included</TableHead>
              <TableHead className="text-right">Charged to you</TableHead>
              <TableHead className="text-right">Fee {formatBps(run.feeBps)}</TableHead>
              <TableHead className="text-right">To owner</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {s.rows.map((row) => (
              <TableRow key={row.datasetId}>
                <TableCell>
                  <Link
                    to={`/datasets/${row.owner}/${row.datasetId}`}
                    className="num text-[13px] hover:underline"
                  >
                    {row.datasetId}
                  </Link>
                  <p className="text-[12px] text-muted-foreground">{row.ownerName}</p>
                </TableCell>
                <TableCell className="text-right">
                  <Count value={row.recordsIncluded} />
                  <span className="text-[12px] text-muted-foreground">
                    {' '}
                    of {formatInt(s.cohortSize)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.charged} />
                </TableCell>
                <TableCell className="text-right text-muted-foreground">
                  <Amount value={row.fee} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={row.toOwner} />
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-surface-sunken/60 font-medium">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">
                <Count value={s.cohortSize} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={s.totalCharged} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={s.totalFee} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={s.totalToOwners} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="hairline mt-5 grid gap-5 pt-5 md:grid-cols-3">
        <KeyValue label="Locked in escrow">
          <Amount value={run.upperBound} className="text-lg" withMint />
        </KeyValue>
        <KeyValue label="Actual cost">
          <Amount value={s.totalCharged} className="text-lg" withMint />
        </KeyValue>
        <KeyValue label="Refunded to you">
          <Amount value={s.refunded} className="text-lg" withMint />
        </KeyValue>
      </div>
      <SourceNote className="mt-3">
        <span className="num">
          {formatInt(s.totalToOwners)} + {formatInt(s.totalFee)} + {formatInt(s.refunded)} ={' '}
          {formatInt(run.upperBound)}
        </span>{' '}
        base units. Owner payouts, the platform fee and your refund add up to exactly what was
        locked.
      </SourceNote>
    </section>
  )
}

const RunView = ({ run }: { run: Run }) => {
  const recipe = RECIPES.find((r) => r.id === run.recipeId)
  return (
    <div className="flex flex-col gap-5">
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusTag status={run.status} />
              <span className="num text-[12.5px] text-muted-foreground">{run.runId}</span>
            </div>
            <h1 className="mt-3 text-[26px] leading-tight md:text-[30px]">{recipe?.name}</h1>
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">
              ordered {formatDateTime(run.createdAt)}
            </p>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <KeyValue label="Use type">{USE_TYPE_LABEL[run.useType]}</KeyValue>
            <KeyValue label="Buyer category">{BUYER_CATEGORY_LABEL[run.buyerCategory]}</KeyValue>
            <KeyValue label="Filters">
              <span className="num text-[13px]">
                age {run.filters.minAge}–{run.filters.maxAge} · sex {run.filters.sex} · affected{' '}
                {run.filters.affected}
              </span>
            </KeyValue>
          </div>
        </div>

        <div className="hairline mt-5 grid gap-5 pt-5 md:grid-cols-3">
          <KeyValue label="Datasets in the run">
            <div className="flex flex-wrap gap-1.5">
              {run.datasets.map((d) => (
                <Link
                  key={d.datasetId}
                  to={`/datasets/${d.owner}/${d.datasetId}`}
                  className="num rounded-sm border border-border bg-surface-sunken/60 px-1.5 py-0.5 text-[12px] hover:border-primary/40"
                >
                  {d.datasetId}
                </Link>
              ))}
            </div>
          </KeyValue>
          <KeyValue label="Escrow locked">
            <Amount value={run.upperBound} withMint />
          </KeyValue>
          <KeyValue label="Platform fee">
            <span className="num">{formatBps(run.feeBps)}</span>
            <span className="ml-2 text-[12.5px] text-muted-foreground">
              out of the owner's payout
            </span>
          </KeyValue>
        </div>
      </section>

      {run.status === 'accepted' && (
        <section className="panel p-5">
          <h2 className="text-[19px]">Accepted</h2>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
            The escrow is locked and every dataset in the pool was checked against its consent at
            the moment of ordering. The computation has not been published to the MPC cluster yet.
          </p>
        </section>
      )}

      {run.status === 'running' && run.progress && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[19px]">Running</h2>
            <span className="num text-[12.5px] text-muted-foreground">
              batch {formatInt(run.progress.batch)} / {formatInt(run.progress.batches)}
            </span>
          </div>
          <span className="mt-4 block h-2 overflow-hidden rounded-sm bg-surface-sunken">
            <span
              className="block h-full bg-primary"
              style={{
                width: `${(run.progress.batch / run.progress.batches) * 100}%`,
              }}
            />
          </span>
          <p className="mt-3 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
            The computation is published to the MPC cluster and runs in batches. Waiting without a
            number takes longer than it is, so the number is here.
          </p>
        </section>
      )}

      {run.status === 'completed' && (
        <>
          <RunReportBlock run={run} />
          <SettlementBlock run={run} />
        </>
      )}

      {(run.status === 'failed' || run.status === 'rejected') && run.failure && (
        <section className="flex flex-col gap-4">
          <ErrorBlock error={run.failure} />
          <div className="panel p-5">
            <p className="text-sm leading-6">
              Your deposit of <Amount value={run.upperBound} withMint /> was returned in full.
            </p>
            <SourceNote className="mt-2">
              {run.status === 'rejected'
                ? 'A rejected run never reached the MPC cluster: consent is re-checked at the moment of ordering, not only at the quote.'
                : 'A failed run computed nothing. Nothing was charged and no owner was paid.'}
            </SourceNote>
          </div>
        </section>
      )}

      {run.transactions.length > 0 && (
        <section className="panel p-5">
          <h2 className="text-[19px]">Transactions</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {run.transactions.map((tx) => (
              <li
                key={tx.signature}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <span className="text-[13px]">{tx.label}</span>
                <CopyValue value={tx.signature} display={truncateMiddle(tx.signature, 8, 8)} />
              </li>
            ))}
          </ul>
          <SourceNote className="mt-3">
            Every state change on-chain was signed in your wallet. The API never signs on your
            behalf.
          </SourceNote>
        </section>
      )}
    </div>
  )
}

const RunPage = () => {
  const { runId = '' } = useParams()
  const initial = RUN_STATUS_ORDER.find((s) => RUNS[s].runId === runId) ?? ('accepted' as RunStatus)
  const [status, setStatus] = useState<RunStatus>(initial)

  return (
    <div className="flex flex-col gap-5">
      <Link to="/runs/new" className="text-[12.5px] text-muted-foreground hover:text-foreground">
        ← Order another run
      </Link>
      <SignInGate what="see a run">
        <div className="flex flex-col gap-5">
          <StatePreview
            options={RUN_STATUS_ORDER}
            value={status}
            onChange={setStatus}
            render={(s) => RUN_STATUS_LABEL[s]}
          />
          <RunView run={RUNS[status]} />
        </div>
      </SignInGate>
    </div>
  )
}

export default RunPage
