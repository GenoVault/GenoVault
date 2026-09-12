/** Дрібні спільні елементи: суми, чипи, підписи походження, копіювання, спарклайн. */

import { Check, Copy } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { type Amountish, amountTitle, formatAmount, formatInt, MINT_SHORT } from '@/lib/format'
import { cn } from '@/lib/utils'

/* --- amounts --- */

export const Amount = ({
  value,
  className,
  withMint = false,
}: {
  value: Amountish
  className?: string
  withMint?: boolean
}) => (
  <span className="inline-flex items-baseline gap-1.5">
    <span className={cn('num', className)} title={amountTitle(value)}>
      {formatAmount(value)}
    </span>
    {withMint && (
      <span className="text-[11px] text-muted-foreground" title={amountTitle(value)}>
        {MINT_SHORT} · stable unit
      </span>
    )}
  </span>
)

export const Count = ({ value, className }: { value: number; className?: string }) => (
  <span className={cn('num', className)}>{formatInt(value)}</span>
)

/* --- chips --- */

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand'

const TONES: Record<Tone, string> = {
  neutral: 'bg-secondary text-secondary-foreground border-border',
  info: 'bg-info-soft text-info border-info/25',
  success: 'bg-success-soft text-success border-success/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  danger: 'bg-destructive-soft text-destructive border-destructive/25',
  brand: 'bg-brand/10 text-brand border-brand/25',
}

export const Tag = ({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-4',
      TONES[tone],
      className,
    )}
  >
    {children}
  </span>
)

/* --- provenance of a number on screen --- */

export const SourceNote = ({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) => <p className={cn('text-[12.5px] leading-5 text-muted-foreground', className)}>{children}</p>

export const FieldLabel = ({ children }: { children: ReactNode }) => (
  <span className="label-tiny block">{children}</span>
)

export const KeyValue = ({
  label,
  children,
  className,
}: {
  label: string
  children: ReactNode
  className?: string
}) => (
  <div className={cn('min-w-0', className)}>
    <FieldLabel>{label}</FieldLabel>
    <div className="mt-1 text-sm">{children}</div>
  </div>
)

/* --- copy --- */

export const CopyValue = ({
  value,
  display,
  className,
}: {
  value: string
  display?: string
  className?: string
}) => {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      title={value}
      onClick={() => {
        void navigator.clipboard?.writeText(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1400)
      }}
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-sm border border-transparent px-1 py-0.5 text-left transition-colors hover:border-border hover:bg-secondary',
        className,
      )}
    >
      <span className="num truncate text-[13px]">{display ?? value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 group-hover:opacity-100" />
      )}
    </button>
  )
}

/* --- sparkline over marker frequencies --- */

export const FrequencySparkline = ({
  values,
  height = 44,
  className,
}: {
  values: number[]
  height?: number
  className?: string
}) => {
  const max = Math.max(...values, 0.001)
  return (
    <div className={cn('flex items-end gap-[2px]', className)} style={{ height }}>
      {values.map((v, i) => (
        <span
          key={`marker${String(i + 1).padStart(4, '0')}`}
          title={`marker${String(i + 1).padStart(4, '0')} · ${v.toFixed(3)}`}
          className="flex-1 rounded-[1px] bg-primary/70 transition-colors hover:bg-brand"
          style={{ height: `${Math.max(4, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

/* --- horizontal distribution bar --- */

export const BarRow = ({
  label,
  value,
  total,
  tone = 'primary',
}: {
  label: string
  value: number
  total: number
  tone?: 'primary' | 'brand'
}) => (
  <div className="grid grid-cols-[7rem_1fr_5.5rem] items-center gap-3">
    <span className="num text-[12.5px] text-muted-foreground">{label}</span>
    <span className="h-2 overflow-hidden rounded-sm bg-surface-sunken">
      <span
        className={cn('block h-full', tone === 'primary' ? 'bg-primary/75' : 'bg-brand/75')}
        style={{ width: `${total > 0 ? (value / total) * 100 : 0}%` }}
      />
    </span>
    <span className="num text-right text-[12.5px]">
      {formatInt(value)}
      <span className="ml-1 text-muted-foreground">
        {total > 0 ? `${((value / total) * 100).toFixed(1)}%` : ''}
      </span>
    </span>
  </div>
)
