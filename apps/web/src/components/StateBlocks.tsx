/** Порожні стани, помилки, скелетони, крок підпису в гаманці, ворота входу. */

import { AlertTriangle, Inbox, KeyRound, RotateCcw, Wallet } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAppState } from '@/lib/appState'
import { cn } from '@/lib/utils'
import { API_ERROR_STATUS, type ApiError, type ApiErrorCode } from '@/mockData'

export const EmptyState = ({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: ReactNode
}) => (
  <div className="panel flex flex-col items-center gap-3 px-6 py-14 text-center">
    <Inbox className="h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
    <h3 className="text-lg">{title}</h3>
    <p className="max-w-md text-[13.5px] leading-6 text-muted-foreground">{body}</p>
    {action}
  </div>
)

/** UPSTREAM_UNAVAILABLE пропонує повтор; INTERNAL — ні. */
const RETRYABLE: ApiErrorCode[] = ['UPSTREAM_UNAVAILABLE', 'RATE_LIMITED']

export const ErrorBlock = ({
  error,
  onRetry,
  className,
}: {
  error: ApiError['error']
  onRetry?: () => void
  className?: string
}) => {
  const retryable = RETRYABLE.includes(error.code)
  return (
    <div
      className={cn('rounded border border-destructive/30 bg-destructive-soft/60 p-4', className)}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="num text-[12px] text-destructive">
            {error.code} · {API_ERROR_STATUS[error.code]}
          </p>
          <p className="mt-1 text-sm leading-6">{error.message}</p>
          {error.details && (
            <pre className="num mt-2 overflow-x-auto rounded-sm bg-background/70 p-2 text-[11.5px] text-muted-foreground">
              {JSON.stringify(error.details, null, 2)}
            </pre>
          )}
          {retryable ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={onRetry}
              disabled={!onRetry}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          ) : (
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              Retrying will not change the outcome. Nothing was charged.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export const SkeletonLine = ({ className }: { className?: string }) => (
  <span className={cn('block animate-shimmer rounded-sm bg-surface-sunken', className)} />
)

export const SkeletonCard = () => (
  <div className="panel flex flex-col gap-3 p-4">
    <SkeletonLine className="h-3 w-20" />
    <SkeletonLine className="h-4 w-4/5" />
    <SkeletonLine className="h-3 w-full" />
    <SkeletonLine className="h-3 w-2/3" />
    <div className="hairline mt-2 flex gap-6 pt-3">
      <SkeletonLine className="h-3 w-16" />
      <SkeletonLine className="h-3 w-16" />
      <SkeletonLine className="h-3 w-16" />
    </div>
  </div>
)

/** Явний крок «підпишіть у гаманці»: API ніколи не підписує за користувача. */
export const WalletSignStep = ({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  pending = false,
}: {
  title: string
  body: string
  confirmLabel: string
  onConfirm: () => void
  onCancel?: () => void
  pending?: boolean
}) => (
  <div className="panel p-5">
    <div className="flex items-start gap-3">
      <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
      <div className="flex-1">
        <h3 className="text-base">{title}</h3>
        <p className="mt-1.5 max-w-xl text-[13.5px] leading-6 text-muted-foreground">{body}</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? 'Waiting for your wallet…' : confirmLabel}
          </Button>
          {onCancel && (
            <Button variant="ghost" onClick={onCancel} disabled={pending}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  </div>
)

/** Каталог і картка датасету відкриті без входу; решта — ні (FR-023). */
export const SignInGate = ({ what, children }: { what: string; children: ReactNode }) => {
  const { ready, signedIn, signIn, live } = useAppState()
  if (signedIn) return <>{children}</>
  if (!ready) {
    return (
      <div className="panel mx-auto h-48 max-w-xl animate-shimmer bg-muted" aria-hidden="true" />
    )
  }
  return (
    <div className="panel mx-auto max-w-xl px-6 py-12 text-center">
      <KeyRound className="mx-auto h-6 w-6 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="mt-3 text-xl">Sign in to {what}</h2>
      <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-6 text-muted-foreground">
        Two equal paths: a wallet you already have, or an email address — in which case a wallet is
        created for you. From there the paths differ in nothing.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <Button onClick={() => signIn('wallet')}>Continue with a wallet</Button>
        <Button variant="outline" onClick={() => signIn('email')}>
          Continue with email
        </Button>
      </div>
      {!live && (
        <p className="mx-auto mt-4 max-w-md text-[12.5px] leading-5 text-warning">
          This is the prototype sign-in: no Privy app is configured, so nothing is authenticated and
          no wallet is created. The address it puts in the header is mock data.
        </p>
      )}
      <p className="mt-5 text-[12.5px] text-muted-foreground">
        Browsing the{' '}
        <Link to="/datasets" className="underline underline-offset-2">
          catalog
        </Link>{' '}
        needs no sign-in.
      </p>
    </div>
  )
}

/** Перемикач станів прототипу: інакше половина станів ніколи не буде намальована. */
export const StatePreview = <T extends string>({
  label = 'Prototype state preview',
  options,
  value,
  onChange,
  render = (v) => v,
}: {
  label?: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  render?: (v: T) => string
}) => (
  <div className="flex flex-wrap items-center gap-2 rounded border border-dashed border-border bg-surface-sunken/60 px-3 py-2">
    <span className="label-tiny">{label}</span>
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={cn(
            'rounded-sm px-2 py-1 text-[12px] transition-colors',
            opt === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-secondary',
          )}
        >
          {render(opt)}
        </button>
      ))}
    </div>
  </div>
)
