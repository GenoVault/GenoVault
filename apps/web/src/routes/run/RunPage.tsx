/**
 * Екран 4, частина C — прогін і результат `/runs/:buyer/:nonce`.
 *
 * Стан прогону читається **з ланцюга** (`GET /runs/:buyer/:nonce`), а не з
 * дзеркала: прогін — це те, за що заплачено, і рядок у нашій базі був би другим
 * твердженням про ті самі гроші.
 *
 * # Чого тут немає в живому режимі, і чому це сказано вголос
 *
 * **Звіту.** MPC шифрує його на ключ покупця, і розшифрувати шифротексти зараз
 * нічим: розкладку, якою Arcis пакує 140 чисел у 24 польові елементи, ми ще не
 * звіряли з жодним справжнім виводом. Написати розбір «за здоровим глуздом»
 * означало б показати покупцю числа, походження яких ніхто не перевіряв. Перший
 * справжній вивід дає `T030` — розбір робиться там.
 *
 * **Списку транзакцій.** Він є в прототипі, бо там його виписали руками. З
 * ланцюга ми читаємо акаунти, а не історію підписів; збирати її означає інший
 * запит до RPC і інший бюджет `SC-010`.
 *
 * Обидві прогалини показані на екрані як прогалини, а не сховані: демо, у якому
 * заглушка виглядає як результат, дає рівно те хибне відчуття доведеності, від
 * якого застерігає визначення віх.
 */

import type { RunStatusName, RunView } from '@genovault/shared'
import { bpsSchema, pricePer1kSchema, settleRun, tokenAmountSchema } from '@genovault/shared'
import { CheckCircle2, CircleDashed, Loader2, Lock, XCircle } from 'lucide-react'
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
  formatInt,
  formatRate,
  RUN_STATUS_LABEL,
  truncateMiddle,
  USE_TYPE_LABEL,
} from '@/lib/format'
import { LIVE_DATA, useRunView } from '@/lib/runData'
import { MOCK_SESSION, type Run as MockRun, RUN_STATUS_ORDER, RUNS } from '@/mockData'

const StatusTag = ({ status }: { status: RunStatusName }) => {
  const map: Record<
    RunStatusName,
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

/** Параметри рецепта в акаунті — плоский запис; читаємо обережно. */
function filterText(params: Record<string, unknown>): string {
  const value = (key: string, fallback: string) => {
    const raw = params[key]
    return typeof raw === 'number' || typeof raw === 'string' ? String(raw) : fallback
  }
  return `age ${value('minAge', '?')}–${value('maxAge', '?')} · sex ${value('sex', 'any')} · affected ${value('affected', 'any')}`
}

/**
 * Розподіл плати — порахований тими самими функціями, що й у програмі.
 *
 * `packages/shared/settlement.ts` — дзеркало `state/settlement.rs` до найменшої
 * одиниці (`T027`). Друга реалізація тут показувала б числа, які не сходяться
 * з тим, що насправді нарахувала мережа.
 */
const SettlementBlock = ({ run }: { run: RunView }) => {
  if (run.settledCount === 0) return null

  // Числа проходять через брендовані схеми, а не приведення типу: `as` тут
  // сховав би саме ту помилку, від якої бренди й захищають, — ціну за тисячу,
  // передану на місце суми.
  const settlement = settleRun({
    escrowAmount: tokenAmountSchema.parse(run.escrowAmount),
    feeBps: bpsSchema.parse(run.feeBps),
    recordsIncluded: run.recordsIncluded,
    suppressed: run.suppressed,
    datasets: run.datasets.map((entry) => ({
      pricePer1k: pricePer1kSchema.parse(entry.pricePer1k),
      recordsIncluded: entry.recordsIncluded,
      belowFloor: entry.belowFloor,
      settled: entry.settled,
    })),
  })

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
            {settlement.lines.map((line) => {
              const entry = run.datasets[line.index]
              return (
                <TableRow key={entry?.datasetAddress ?? line.index}>
                  <TableCell>
                    {entry?.datasetId === undefined ? (
                      <span className="num text-[13px] text-muted-foreground">
                        {truncateMiddle(entry?.datasetAddress ?? '', 4, 4)}
                      </span>
                    ) : (
                      <Link
                        to={`/datasets/${entry.owner}/${entry.datasetId}`}
                        className="num text-[13px] hover:underline"
                      >
                        {entry.datasetId}
                      </Link>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {entry?.title ?? 'not in the catalog mirror'}
                    </p>
                  </TableCell>
                  <TableCell className="text-right">
                    <Count value={line.recordsIncluded} />
                    {line.belowFloor && (
                      <p className="text-[11.5px] text-muted-foreground">
                        below the contribution floor — declared as zero
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={line.gross} />
                    {line.escrowCapped && (
                      <p className="text-[11.5px] text-muted-foreground">
                        capped by the escrow · rule says <Amount value={line.grossUncapped} />
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    <Amount value={line.fee} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={line.net} />
                  </TableCell>
                </TableRow>
              )
            })}
            <TableRow className="bg-surface-sunken/60 font-medium">
              <TableCell>Total</TableCell>
              <TableCell className="text-right">
                <Count value={run.recordsIncluded} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={settlement.grossTotal} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={settlement.feeTotal} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={settlement.ownersTotal} />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="hairline mt-5 grid gap-5 pt-5 md:grid-cols-3">
        <KeyValue label="Locked in escrow">
          <Amount value={run.escrowAmount} className="text-lg" withMint />
        </KeyValue>
        <KeyValue label="Actual cost">
          <Amount value={settlement.grossTotal} className="text-lg" withMint />
        </KeyValue>
        <KeyValue label={run.refunded ? 'Refunded to you' : 'To be refunded'}>
          <Amount value={settlement.refund} className="text-lg" withMint />
        </KeyValue>
      </div>
      <SourceNote className="mt-3">
        <span className="num">
          {settlement.ownersTotal.toString()} + {settlement.feeTotal.toString()} +{' '}
          {settlement.refund.toString()} = {run.escrowAmount}
        </span>{' '}
        base units. Owner payouts, the platform fee and your refund add up to exactly what was
        locked.
      </SourceNote>
    </section>
  )
}

/**
 * Звіт є, але прочитати його поки нічим.
 *
 * Шифротексти публічні — вони лежать в акаунті мережі. Приватна половина ключа
 * не зберігається ніде й виводиться з підпису гаманця; чого немає, так це
 * розбору того, як Arcis пакує числа звіту в польові елементи. Це `T030`.
 */
const SealedReportBlock = ({ run }: { run: RunView }) => {
  if (run.result === null) return null
  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[19px]">
          <Lock className="h-4 w-4" />
          Report — encrypted to you
        </h2>
        <span className="num text-[12.5px] text-muted-foreground">
          {run.result.ciphertexts.length} field elements
        </span>
      </div>
      <p className="mt-3 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
        The cohort is <span className="num">{formatInt(run.result.recordsIncluded)}</span> records.
        The numbers themselves are sealed to the key derived from your wallet signature — nobody
        else can read them, this app included.
      </p>
      <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
        Decoding is not wired yet: the layout Arcis uses to pack the report into field elements has
        not been checked against a real MPC output. Guessing it would put numbers on this screen
        that nobody verified.
      </p>
      {run.result.suppressed && (
        <p className="mt-2 text-[13.5px] leading-6 text-destructive">
          The cohort was smaller than the recipe's minimum, so the report is zeros and the deposit
          comes back in full.
        </p>
      )}
      <div className="mt-4">
        <CopyValue
          value={run.result.encryptionKey}
          display={truncateMiddle(run.result.encryptionKey, 8, 8)}
        />
      </div>
    </section>
  )
}

/**
 * Блоки, які існують лише в прототипі: звіт із вигаданими числами й список
 * транзакцій. У живому режимі їх немає, і це видно.
 */
const PrototypeExtras = ({ run }: { run: MockRun }) => {
  const report = run.report
  const histMax = report === undefined ? 1 : Math.max(...report.ageHistogram.map((b) => b.count))

  return (
    <>
      {report !== undefined && (
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
                Computed by the recipe over the filtered cohort. One value per marker, in schema
                order.
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
                  <BarRow
                    label="male"
                    value={report.sexDistribution.male}
                    total={report.cohortSize}
                  />
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
    </>
  )
}

const RunDetail = ({ run }: { run: RunView }) => (
  <div className="flex flex-col gap-5">
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag status={run.status} />
            <CopyValue value={run.runAddress} display={truncateMiddle(run.runAddress, 6, 6)} />
          </div>
          <h1 className="mt-3 text-[26px] leading-tight md:text-[30px]">{run.recipe}</h1>
          <p className="mt-1.5 num text-[12.5px] text-muted-foreground">nonce {run.nonce}</p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <KeyValue label="Use type">{USE_TYPE_LABEL[run.useType]}</KeyValue>
          <KeyValue label="Buyer category">{BUYER_CATEGORY_LABEL[run.buyerCategory]}</KeyValue>
          <KeyValue label="Filters">
            <span className="num text-[13px]">{filterText(run.params)}</span>
          </KeyValue>
        </div>
      </div>

      <div className="hairline mt-5 grid gap-5 pt-5 md:grid-cols-3">
        <KeyValue label="Datasets in the run">
          <div className="flex flex-wrap gap-1.5">
            {run.datasets.map((d) => (
              <Link
                key={d.datasetAddress}
                to={d.datasetId === undefined ? '/datasets' : `/datasets/${d.owner}/${d.datasetId}`}
                className="num rounded-sm border border-border bg-surface-sunken/60 px-1.5 py-0.5 text-[12px] hover:border-primary/40"
              >
                {d.datasetId ?? truncateMiddle(d.datasetAddress, 4, 4)}
              </Link>
            ))}
          </div>
        </KeyValue>
        <KeyValue label="Escrow locked">
          <Amount value={run.escrowAmount} withMint />
        </KeyValue>
        <KeyValue label="Platform fee">
          <span className="num">{formatBps(run.feeBps)}</span>
          <span className="ml-2 text-[12.5px] text-muted-foreground">
            out of the owner's payout
          </span>
        </KeyValue>
      </div>

      <div className="hairline mt-5 grid gap-5 pt-5 md:grid-cols-3">
        <KeyValue label="Dispatcher">
          <CopyValue value={run.dispatcher} display={truncateMiddle(run.dispatcher, 4, 4)} />
          <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
            Carries the run to the end. Moves no money, changes no pool, bypasses no consent.
          </p>
        </KeyValue>
        <KeyValue label="Folded batches">
          <Count value={run.foldedBatches} />
        </KeyValue>
        <KeyValue label="Datasets folded">
          <span className="num">
            {run.datasetCursor} of {run.datasets.length}
          </span>
        </KeyValue>
      </div>
    </section>

    {run.status === 'accepted' && (
      <section className="panel p-5">
        <h2 className="text-[19px]">Accepted</h2>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
          The escrow is locked and every dataset in the pool was checked against its consent at the
          moment of ordering. The computation has not been published to the MPC cluster yet.
        </p>
      </section>
    )}

    {run.status === 'running' && (
      <section className="panel p-5">
        <h2 className="text-[19px]">Running</h2>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
          The computation is published to the MPC cluster and folds in batches of records. There is
          no total to show against: how many batches a pool needs depends on how many records each
          dataset actually contributes, and that number is declared inside the MPC.
        </p>
      </section>
    )}

    <SealedReportBlock run={run} />
    <SettlementBlock run={run} />

    {(run.status === 'failed' || run.status === 'rejected') && (
      <section className="panel p-5">
        <p className="text-sm leading-6">
          Your deposit of <Amount value={run.escrowAmount} withMint /> {run.refunded ? 'was' : 'is'}{' '}
          returned in full.
        </p>
        <SourceNote className="mt-2">
          {run.status === 'rejected'
            ? 'A rejected run never reached the MPC cluster: consent is re-checked at the moment of ordering, not only at the quote.'
            : 'A failed run computed nothing. Nothing was charged and no owner was paid.'}
        </SourceNote>
      </section>
    )}
  </div>
)

const RunPage = () => {
  const { buyer = '', nonce = '' } = useParams()
  // У прототипі «прогін» обирається статусом: інших прогонів немає, і саме
  // статус їде в місці нонса.
  const [status, setStatus] = useState<RunStatusName>(
    RUN_STATUS_ORDER.includes(nonce as RunStatusName) ? (nonce as RunStatusName) : 'accepted',
  )
  const view = useRunView(
    LIVE_DATA ? buyer || MOCK_SESSION.address : null,
    LIVE_DATA ? nonce : status,
  )

  return (
    <div className="flex flex-col gap-5">
      <Link to="/runs/new" className="text-[12.5px] text-muted-foreground hover:text-foreground">
        ← Order another run
      </Link>
      <SignInGate what="see a run">
        <div className="flex flex-col gap-5">
          {!LIVE_DATA && (
            <StatePreview
              options={RUN_STATUS_ORDER}
              value={status}
              onChange={setStatus}
              render={(s) => RUN_STATUS_LABEL[s]}
            />
          )}
          {view.error !== null && <ErrorBlock error={view.error} onRetry={view.refresh} />}
          {view.data !== null && <RunDetail run={view.data} />}
          {!LIVE_DATA && <PrototypeExtras run={RUNS[status]} />}
        </div>
      </SignInGate>
    </div>
  )
}

export default RunPage
