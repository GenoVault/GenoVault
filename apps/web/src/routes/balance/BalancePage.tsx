/**
 * Екран 5 — баланс і виплати `/balance`.
 * Обидва числа, з яких обчислена частка (FR-018), і два випадки,
 * які екран мусить пояснити сам: підлога внеску і стеля escrow.
 */

import { Info } from 'lucide-react'
import { Fragment, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatAmount, formatBps, formatInt, USE_TYPE_LABEL } from '@/lib/format'
import {
  EMPTY_OWNER_BALANCE,
  LIMITS,
  OWNER_BALANCE,
  type OwnerBalance,
  type PayoutRow,
  RECIPES,
} from '@/mockData'

type ScreenState = 'payouts' | 'empty' | 'withdrawing' | 'error'

const PayoutTable = ({ rows }: { rows: PayoutRow[] }) => (
  <div className="overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Run</TableHead>
          <TableHead>Dataset · use type</TableHead>
          <TableHead className="text-right">Your records of the cohort</TableHead>
          <TableHead className="text-right">Price / 1000</TableHead>
          <TableHead className="text-right">Gross</TableHead>
          <TableHead className="text-right">Fee</TableHead>
          <TableHead className="text-right">Net</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <Fragment key={row.runId}>
            <TableRow>
              <TableCell>
                <Link to={`/runs/${row.runId}`} className="num text-[13px] hover:underline">
                  {row.runId}
                </Link>
                <p className="num text-[12px] text-muted-foreground">{row.date}</p>
              </TableCell>
              <TableCell>
                <p className="num text-[13px]">{row.datasetId}</p>
                <p className="text-[12px] text-muted-foreground">
                  {RECIPES.find((r) => r.id === row.recipeId)?.name} · {USE_TYPE_LABEL[row.useType]}
                </p>
              </TableCell>
              <TableCell className="text-right">
                <span className="num text-[13px]">
                  {formatInt(row.recordsIncluded)} of {formatInt(row.cohortSize)}
                </span>
                <p className="text-[12px] text-muted-foreground">
                  {((row.recordsIncluded / row.cohortSize) * 100).toFixed(2)}% of the cohort
                </p>
              </TableCell>
              <TableCell className="text-right">
                <Amount value={row.pricePer1k} />
              </TableCell>
              <TableCell className="text-right">
                {row.escrowCapped ? (
                  <div>
                    <span className="num text-[13px]">
                      expected {formatAmount(row.expectedGross)}
                    </span>
                    <p className="num text-[13px] text-warning">
                      paid {formatAmount(row.paidGross)}
                    </p>
                  </div>
                ) : (
                  <Amount value={row.paidGross} />
                )}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                <Amount value={row.fee} />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={row.net} />
              </TableCell>
            </TableRow>

            {row.belowContributionFloor && (
              <TableRow className="bg-surface-sunken/50">
                <TableCell colSpan={7} className="py-3">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <div className="text-[12.5px] leading-6">
                      <p>
                        This dataset contributed <span className="num">{row.recordsIncluded}</span>{' '}
                        records — fewer than the floor of{' '}
                        <span className="num">{LIMITS.MIN_CONTRIBUTION}</span>, so the payout is
                        declared zero. Otherwise that very number becomes an answer about a specific
                        person.
                      </p>
                      <p className="text-muted-foreground">
                        Those records did stay in the buyer's report and the buyer did pay for them.
                        That money went to the other owners in the pool.
                      </p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}

            {row.escrowCapped && (
              <TableRow className="bg-warning-soft/40">
                <TableCell colSpan={7} className="py-3">
                  <div className="flex items-start gap-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <div className="text-[12.5px] leading-6">
                      <p>
                        The payout by the distribution rule did not fit inside the locked escrow, so
                        you received <span className="num">{formatAmount(row.paidGross)}</span>{' '}
                        instead of <span className="num">{formatAmount(row.expectedGross)}</span>.
                      </p>
                      <p className="text-muted-foreground">
                        The escrow was computed at a lower price than the pool's average turned out
                        to be. This is a named boundary of the escrow, not a bug.
                      </p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  </div>
)

const Withdrawal = ({ balance, pending = false }: { balance: OwnerBalance; pending?: boolean }) => {
  const [amount, setAmount] = useState(pending ? '10.00' : '')
  const [signing, setSigning] = useState(pending)
  const [withdrawn, setWithdrawn] = useState(0)

  const available = balance.available - withdrawn
  const requested = Math.round((Number(amount) || 0) * 1_000_000)
  const tooMuch = requested > available
  const valid = requested > 0 && !tooMuch

  return (
    <section className="panel p-5">
      <h2 className="text-[19px]">Withdraw</h2>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="amount" className="label-tiny mb-1 block">
            Amount
          </label>
          <Input
            id="amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder={formatAmount(available)}
            className="num w-40"
          />
        </div>
        <Button disabled={!valid || signing} onClick={() => setSigning(true)}>
          Withdraw
        </Button>
        <Button
          variant="ghost"
          onClick={() => setAmount(formatAmount(available))}
          disabled={available === 0}
        >
          All available
        </Button>
        <p className="text-[12.5px] text-muted-foreground">
          Available: <Amount value={available} withMint />
        </p>
      </div>
      {tooMuch && (
        <p className="mt-2 text-[12.5px] text-destructive">
          More than the available balance. A repeat request for an amount already withdrawn does not
          go through.
        </p>
      )}

      {signing && (
        <div className="mt-4">
          <WalletSignStep
            title="Sign the withdrawal in your wallet"
            body={`Moving ${formatAmount(requested)} out of the platform balance to your address. The API never signs this for you.`}
            confirmLabel="Sign withdrawal"
            onConfirm={() => {
              setWithdrawn((w) => w + requested)
              setAmount('')
              setSigning(false)
            }}
            onCancel={() => setSigning(false)}
          />
        </div>
      )}

      {withdrawn > 0 && (
        <SourceNote className="mt-3">
          Withdrawn in this session: <Amount value={withdrawn} withMint />. The balance dropped by
          exactly that amount, and the same request cannot go through twice.
        </SourceNote>
      )}
    </section>
  )
}

const BalanceBody = () => {
  const [state, setState] = useState<ScreenState>('payouts')
  const balance = useMemo<OwnerBalance>(
    () => (state === 'empty' ? EMPTY_OWNER_BALANCE : OWNER_BALANCE),
    [state],
  )

  return (
    <div className="flex flex-col gap-5">
      <StatePreview
        options={['payouts', 'empty', 'withdrawing', 'error'] as const}
        value={state}
        onChange={setState}
      />

      <section className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[19px]">{balance.ownerName}</h2>
          <Tag>data owner</Tag>
        </div>
        <div className="mt-5 grid gap-6 sm:grid-cols-3">
          <KeyValue label="Available to withdraw">
            <Amount value={balance.available} className="text-2xl" withMint />
          </KeyValue>
          <KeyValue label="Total earned">
            <Amount value={balance.totalEarned} className="text-2xl" withMint />
          </KeyValue>
          <KeyValue label="Total withdrawn">
            <Amount value={balance.totalWithdrawn} className="text-2xl" withMint />
          </KeyValue>
        </div>
        <SourceNote className="mt-4">
          Payouts are computed from the same contribution measure for every participant — records
          included, out of the cohort — and that measure is announced before a run is ordered. The
          platform fee of {formatBps(LIMITS.FEE_BPS)} is taken out of the gross, never added to the
          buyer's bill.
        </SourceNote>
      </section>

      {state === 'error' ? (
        <ErrorBlock
          error={{
            code: 'UPSTREAM_UNAVAILABLE',
            message: 'The payout ledger did not answer. Your balance is unchanged — try again.',
            details: { endpoint: 'GET /balance' },
          }}
          onRetry={() => setState('payouts')}
        />
      ) : balance.payouts.length === 0 ? (
        <EmptyState
          title="No payouts yet"
          body="None of your datasets has taken part in a run. Once one does, this table shows both numbers the share was computed from."
          action={
            <Button variant="outline" asChild>
              <Link to="/datasets/new">Register a dataset</Link>
            </Button>
          }
        />
      ) : (
        <section className="panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[19px]">Payouts by run</h2>
            <span className="text-[12.5px] text-muted-foreground">
              <Count value={balance.payouts.length} /> runs
            </span>
          </div>
          <div className="mt-4">
            <PayoutTable rows={balance.payouts} />
          </div>
        </section>
      )}

      {state !== 'error' && balance.payouts.length > 0 && (
        <Withdrawal key={state} balance={balance} pending={state === 'withdrawing'} />
      )}
    </div>
  )
}

const BalancePage = () => (
  <div className="flex flex-col gap-6">
    <header className="max-w-3xl">
      <h1 className="text-[30px] leading-[1.15] md:text-[36px]">Balance and payouts</h1>
      <p className="mt-3 text-[14.5px] leading-7 text-muted-foreground">
        What each run paid you, and what the number was computed from. Two boundaries — the
        contribution floor and the escrow ceiling — are explained where they happen.
      </p>
    </header>
    <SignInGate what="see your balance">
      <BalanceBody />
    </SignInGate>
  </div>
)

export default BalancePage
