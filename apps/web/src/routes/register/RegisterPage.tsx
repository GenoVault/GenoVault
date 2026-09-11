/**
 * Екран 3 — реєстрація датасету `/datasets/new`.
 * Шифрування — це окремий стан екрана, а не спінер: 1183 µs на елемент поля,
 * лінійно, тобто хвилини. П'ять безіменних хвилин читаються як зависання.
 */

import { AlertTriangle, Check, FileUp, Loader2, Lock, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Count, KeyValue, SourceNote, Tag } from '@/components/Primitives'
import { ErrorBlock, SignInGate, StatePreview, WalletSignStep } from '@/components/StateBlocks'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Textarea } from '@/components/ui/textarea'
import {
  BUYER_CATEGORY_LABEL,
  consentSentence,
  estimateEncryption,
  formatBytes,
  formatDuration,
  formatInt,
  SOURCE_LABEL,
  USE_TYPE_LABEL,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  BASE_RECORD_SCHEMA,
  BUYER_CATEGORIES,
  type BuyerCategory,
  type Consent,
  DATASET_SOURCES,
  type DatasetSource,
  ENCRYPTION,
  LIMITS,
  markerFieldName,
  USE_TYPES,
  type UseType,
} from '@/mockData'

type Phase =
  | 'describe'
  | 'consent'
  | 'encrypting'
  | 'uploading'
  | 'signing'
  | 'done'
  | 'encrypt-error'
  | 'upload-error'
  | 'sign-error'

interface FormState {
  datasetId: string
  title: string
  description: string
  source: DatasetSource
  collectedFrom: string
  collectedTo: string
  records: string
  markers: string
  price: string
  affectedRate: string
  meanAge: string
  fileName: string | null
  allowedUseTypes: UseType[]
  forbiddenUseTypes: UseType[]
  buyerCategories: BuyerCategory[]
  noExpiry: boolean
  expiresAt: string
}

const INITIAL: FormState = {
  datasetId: '',
  title: '',
  description: '',
  source: 'synthetic',
  collectedFrom: '',
  collectedTo: '',
  records: '',
  markers: '50',
  price: '',
  affectedRate: '',
  meanAge: '',
  fileName: null,
  allowedUseTypes: [],
  forbiddenUseTypes: [],
  buyerCategories: [],
  noExpiry: false,
  expiresAt: '',
}

type Errors = Partial<Record<keyof FormState, string>>

const describeErrors = (f: FormState): Errors => {
  const e: Errors = {}
  if (f.datasetId.trim() === '') e.datasetId = 'Required.'
  else if (f.datasetId.length > LIMITS.DATASET_ID_MAX_LENGTH)
    e.datasetId = `At most ${LIMITS.DATASET_ID_MAX_LENGTH} characters.`
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(f.datasetId))
    e.datasetId = 'Lowercase letters, digits and hyphens only.'

  if (f.title.trim() === '') e.title = 'Required.'
  if (f.description.trim().length < 20) e.description = 'At least 20 characters.'
  if (f.collectedFrom === '') e.collectedFrom = 'Required.'
  if (f.collectedTo === '') e.collectedTo = 'Required.'
  else if (f.collectedFrom !== '' && f.collectedTo < f.collectedFrom)
    e.collectedTo = 'The window ends before it starts.'

  const records = Number(f.records)
  if (f.records === '' || !Number.isFinite(records) || records < 1)
    e.records = 'A positive integer.'

  const markers = Number(f.markers)
  if (f.markers === '' || !Number.isFinite(markers) || markers < 1)
    e.markers = 'A positive integer.'
  else if (markers > LIMITS.MAX_MARKERS) e.markers = `At most ${LIMITS.MAX_MARKERS} markers.`

  const price = Number(f.price)
  if (f.price === '' || !Number.isFinite(price) || price <= 0)
    e.price = 'Price per 1000 records, greater than zero.'

  const rate = Number(f.affectedRate)
  if (f.affectedRate === '' || !Number.isFinite(rate) || rate < 0 || rate > 1)
    e.affectedRate = 'A number between 0 and 1.'

  const age = Number(f.meanAge)
  if (f.meanAge === '' || !Number.isFinite(age) || age < LIMITS.AGE_MIN || age > LIMITS.AGE_MAX)
    e.meanAge = `Between ${LIMITS.AGE_MIN} and ${LIMITS.AGE_MAX}.`

  if (!f.fileName) e.fileName = 'Select a file — the field schema is derived from it.'
  return e
}

const consentErrors = (f: FormState): Errors => {
  const e: Errors = {}
  if (f.allowedUseTypes.length === 0)
    e.allowedUseTypes = 'Pick at least one, or the dataset can never enter a run.'
  if (f.buyerCategories.length === 0) e.buyerCategories = 'Pick at least one buyer category.'
  if (!f.noExpiry && f.expiresAt === '') e.expiresAt = 'A date, or tick “no expiry”.'
  const overlap = f.allowedUseTypes.filter((u) => f.forbiddenUseTypes.includes(u))
  if (overlap.length > 0)
    e.forbiddenUseTypes = `${overlap
      .map((u) => USE_TYPE_LABEL[u])
      .join(', ')} cannot be allowed and forbidden at once.`
  return e
}

const FieldError = ({ children }: { children?: string | undefined }) =>
  children ? <p className="mt-1 text-[12px] text-destructive">{children}</p> : null

const CheckList = <T extends string>({
  options,
  value,
  onChange,
  label: labelOf,
  idPrefix,
}: {
  options: readonly T[]
  value: T[]
  onChange: (next: T[]) => void
  label: (v: T) => string
  idPrefix: string
}) => (
  <div className="flex flex-col gap-2">
    {options.map((opt) => {
      const id = `${idPrefix}-${opt}`
      const checked = value.includes(opt)
      return (
        <label key={opt} htmlFor={id} className="flex items-center gap-2 text-[13.5px]">
          <Checkbox
            id={id}
            checked={checked}
            onCheckedChange={() =>
              onChange(checked ? value.filter((v) => v !== opt) : [...value, opt])
            }
          />
          {labelOf(opt)}
        </label>
      )
    })}
  </div>
)

const Stepper = ({ phase }: { phase: Phase }) => {
  const steps = [
    { key: 'describe', label: 'Describe' },
    { key: 'consent', label: 'Consent' },
    { key: 'process', label: 'Encrypt · upload · sign' },
  ]
  const activeIndex = phase === 'describe' ? 0 : phase === 'consent' ? 1 : 2
  return (
    <ol className="flex flex-wrap items-center gap-2 text-[13px]">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-full border text-[12px]',
              i < activeIndex && 'border-success bg-success-soft text-success',
              i === activeIndex && 'border-primary bg-primary text-primary-foreground',
              i > activeIndex && 'border-border text-muted-foreground',
            )}
          >
            {i < activeIndex ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={i === activeIndex ? '' : 'text-muted-foreground'}>{s.label}</span>
          {i < steps.length - 1 && <span className="w-6 border-t border-border" />}
        </li>
      ))}
    </ol>
  )
}

const ProgressBar = ({ fraction, tone }: { fraction: number; tone: 'primary' | 'brand' }) => (
  <span className="block h-2 overflow-hidden rounded-sm bg-surface-sunken">
    <span
      className={cn(
        'block h-full transition-[width] duration-200 ease-out',
        tone === 'primary' ? 'bg-primary' : 'bg-brand',
      )}
      style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
    />
  </span>
)

const RegisterForm = () => {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [phase, setPhase] = useState<Phase>('describe')
  const [showErrors, setShowErrors] = useState(false)
  const [fraction, setFraction] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const dErrors = describeErrors(form)
  const cErrors = consentErrors(form)

  const records = Number(form.records) || 0
  const markers = Number(form.markers) || 0
  const fieldsPerRecord = markers + 3 // маркери + sex + age + affected
  const estimate = useMemo(
    () => estimateEncryption(records, fieldsPerRecord),
    [records, fieldsPerRecord],
  )

  const processing = phase === 'encrypting' || phase === 'uploading'

  useEffect(() => {
    if (!processing) return
    const timer = window.setInterval(() => {
      setFraction((f) => {
        const next = f + 0.02
        if (next >= 1) {
          setPhase((p) => (p === 'encrypting' ? 'uploading' : 'signing'))
          return 0
        }
        return next
      })
    }, 220)
    return () => window.clearInterval(timer)
  }, [processing])

  const consentPreview: Consent = {
    version: 1,
    setAt: new Date().toISOString().slice(0, 10),
    allowedUseTypes: form.allowedUseTypes,
    forbiddenUseTypes: form.forbiddenUseTypes,
    buyerCategories: form.buyerCategories,
    expiresAt: form.noExpiry ? null : form.expiresAt || null,
    revoked: false,
    revokedAt: null,
  }

  const doneElements = Math.round(estimate.elements * fraction)
  const remainingSeconds =
    ((estimate.elements - doneElements) * ENCRYPTION.microsecondsPerElement) / 1_000_000

  const cancel = () => {
    setFraction(0)
    setPhase('consent')
  }

  /* ---------------- process phases ---------------- */

  if (phase !== 'describe' && phase !== 'consent') {
    return (
      <div className="flex flex-col gap-5">
        <Stepper phase={phase} />

        <div className="panel p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[19px]">
              {phase === 'done' ? 'Dataset registered' : 'Encrypt, upload, then sign'}
            </h2>
            <span className="text-[12.5px] text-muted-foreground">
              bytes first, signature second
            </span>
          </div>

          <p className="mt-3 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
            Records are encrypted in your browser, in a Web Worker — the tab stays responsive and
            you can leave and come back. The key never leaves this device: GenoVault cannot decrypt
            your data, and neither can its operator.
          </p>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
            A transaction assembled before the upload would reach the signing step already expired,
            so the order is fixed: encrypt, upload, then sign.
          </p>

          <div className="mt-5 flex flex-col gap-5">
            {/* Encrypting */}
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[13.5px]">
                  <Lock className="h-3.5 w-3.5 text-primary" />
                  Encrypting
                  {phase === 'encrypting' && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  {(phase === 'uploading' ||
                    phase === 'signing' ||
                    phase === 'done' ||
                    phase === 'upload-error' ||
                    phase === 'sign-error') && <Check className="h-3.5 w-3.5 text-success" />}
                </span>
                <span className="num text-[12.5px] text-muted-foreground">
                  {phase === 'encrypting'
                    ? `${formatInt(doneElements)} / ${formatInt(
                        estimate.elements,
                      )} values · ~${formatDuration(
                        remainingSeconds,
                      )} left · envelope ${formatBytes(estimate.bytes * fraction)}`
                    : `${formatInt(estimate.elements)} values · envelope ${formatBytes(
                        estimate.bytes,
                      )}`}
                </span>
              </div>
              <ProgressBar fraction={phase === 'encrypting' ? fraction : 1} tone="primary" />
            </div>

            {/* Uploading */}
            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-[13.5px]">
                  <UploadCloud className="h-3.5 w-3.5 text-brand" />
                  Uploading
                  {phase === 'uploading' && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                  )}
                  {(phase === 'signing' || phase === 'done' || phase === 'sign-error') && (
                    <Check className="h-3.5 w-3.5 text-success" />
                  )}
                </span>
                <span className="num text-[12.5px] text-muted-foreground">
                  {phase === 'uploading'
                    ? `${formatBytes(estimate.bytes * fraction)} of ${formatBytes(estimate.bytes)}`
                    : phase === 'encrypting' || phase === 'encrypt-error'
                      ? 'waiting for the ciphertext'
                      : formatBytes(estimate.bytes)}
                </span>
              </div>
              <ProgressBar
                fraction={
                  phase === 'uploading'
                    ? fraction
                    : phase === 'signing' || phase === 'done' || phase === 'sign-error'
                      ? 1
                      : 0
                }
                tone="brand"
              />
            </div>

            {processing && (
              <div>
                <Button variant="outline" size="sm" onClick={cancel}>
                  Cancel
                </Button>
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Cancelling stops the worker. Nothing has been signed, so nothing is on-chain.
                </p>
              </div>
            )}
          </div>
        </div>

        {phase === 'signing' && (
          <WalletSignStep
            title="Sign the registration in your wallet"
            body="The bytes are in storage. Now the registration transaction — content hash, record count and price — goes on-chain. The API never signs on your behalf."
            confirmLabel="Sign registration"
            onConfirm={() => setPhase('done')}
            onCancel={cancel}
          />
        )}

        {phase === 'done' && (
          <div className="panel p-5">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-success" />
              <h3 className="text-base">
                <span className="num">{form.datasetId}</span> is registered
              </h3>
            </div>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <KeyValue label="Records">
                <Count value={records} />
              </KeyValue>
              <KeyValue label="Encrypted values">
                <Count value={estimate.elements} />
              </KeyValue>
              <KeyValue label="Envelope">
                <span className="num">{formatBytes(estimate.bytes)}</span>
              </KeyValue>
              <KeyValue label="Consent">
                <Tag tone="success">version 1 · in force</Tag>
              </KeyValue>
            </div>
            <SourceNote className="mt-4">{consentSentence(consentPreview)}</SourceNote>
          </div>
        )}

        {phase === 'encrypt-error' && (
          <ErrorBlock
            error={{
              code: 'INTERNAL',
              message:
                'Encryption failed in the worker at value 147,200. Nothing was uploaded and nothing was signed.',
              details: { stage: 'encrypting', value: 147200 },
            }}
          />
        )}
        {phase === 'upload-error' && (
          <ErrorBlock
            error={{
              code: 'UPSTREAM_UNAVAILABLE',
              message:
                'Storage stopped accepting the envelope. The ciphertext is still in this tab — the upload can resume.',
              details: { stage: 'uploading' },
            }}
            onRetry={() => {
              setFraction(0)
              setPhase('uploading')
            }}
          />
        )}
        {phase === 'sign-error' && (
          <ErrorBlock
            error={{
              code: 'INVALID_INPUT',
              message:
                'The wallet rejected the registration transaction. The bytes are uploaded; signing can be retried without re-encrypting.',
              details: { stage: 'signing' },
            }}
          />
        )}

        <StatePreview
          options={
            [
              'encrypting',
              'uploading',
              'signing',
              'done',
              'encrypt-error',
              'upload-error',
              'sign-error',
            ] as const
          }
          value={phase}
          onChange={(p) => {
            setFraction(p === 'uploading' || p === 'encrypting' ? 0.42 : 0)
            setPhase(p)
          }}
        />
      </div>
    )
  }

  /* ---------------- form phases ---------------- */

  return (
    <div className="flex flex-col gap-5">
      <Stepper phase={phase} />

      {phase === 'describe' ? (
        <div className="panel p-5">
          <h2 className="text-[19px]">Describe the dataset</h2>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
            Everything here is a declaration by you. The catalog will say so next to the numbers:
            declared by owner, not verified.
          </p>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div>
              <label htmlFor="datasetId" className="label-tiny mb-1 block">
                Dataset id · at most {LIMITS.DATASET_ID_MAX_LENGTH} characters
              </label>
              <Input
                id="datasetId"
                value={form.datasetId}
                maxLength={LIMITS.DATASET_ID_MAX_LENGTH}
                onChange={(e) => set('datasetId', e.target.value)}
                placeholder="nordveil-exome-02"
                className="num"
              />
              <div className="mt-1 flex items-baseline justify-between">
                <FieldError>{showErrors ? dErrors.datasetId : undefined}</FieldError>
                <span className="num text-[11.5px] text-muted-foreground">
                  {form.datasetId.length}/{LIMITS.DATASET_ID_MAX_LENGTH}
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="title" className="label-tiny mb-1 block">
                Title
              </label>
              <Input
                id="title"
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="Nordveil exome panel — cohort 02"
              />
              <FieldError>{showErrors ? dErrors.title : undefined}</FieldError>
            </div>

            <div className="md:col-span-2">
              <label htmlFor="description" className="label-tiny mb-1 block">
                Description
              </label>
              <Textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="What the cohort is, how it was produced, what the phenotype label means."
              />
              <FieldError>{showErrors ? dErrors.description : undefined}</FieldError>
            </div>

            <div>
              <span className="label-tiny mb-1 block">Provenance</span>
              <Select value={form.source} onValueChange={(v) => set('source', v as DatasetSource)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATASET_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SOURCE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="from" className="label-tiny mb-1 block">
                  Collected from
                </label>
                <Input
                  id="from"
                  type="date"
                  value={form.collectedFrom}
                  onChange={(e) => set('collectedFrom', e.target.value)}
                  className="num"
                />
                <FieldError>{showErrors ? dErrors.collectedFrom : undefined}</FieldError>
              </div>
              <div>
                <label htmlFor="to" className="label-tiny mb-1 block">
                  Collected to
                </label>
                <Input
                  id="to"
                  type="date"
                  value={form.collectedTo}
                  onChange={(e) => set('collectedTo', e.target.value)}
                  className="num"
                />
                <FieldError>{showErrors ? dErrors.collectedTo : undefined}</FieldError>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="records" className="label-tiny mb-1 block">
                  Records
                </label>
                <Input
                  id="records"
                  inputMode="numeric"
                  value={form.records}
                  onChange={(e) => set('records', e.target.value.replace(/\D/g, ''))}
                  placeholder="4800"
                  className="num"
                />
                <FieldError>{showErrors ? dErrors.records : undefined}</FieldError>
              </div>
              <div>
                <label htmlFor="markers" className="label-tiny mb-1 block">
                  Markers · at most {LIMITS.MAX_MARKERS}
                </label>
                <Input
                  id="markers"
                  inputMode="numeric"
                  value={form.markers}
                  onChange={(e) => set('markers', e.target.value.replace(/\D/g, ''))}
                  className="num"
                />
                <FieldError>{showErrors ? dErrors.markers : undefined}</FieldError>
              </div>
            </div>

            <div>
              <label htmlFor="price" className="label-tiny mb-1 block">
                Price per {formatInt(LIMITS.RECORDS_PER_PRICE_UNIT)} records
              </label>
              <Input
                id="price"
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set('price', e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="4.00"
                className="num"
              />
              <FieldError>{showErrors ? dErrors.price : undefined}</FieldError>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="affectedRate" className="label-tiny mb-1 block">
                  Declared affected rate · 0…1
                </label>
                <Input
                  id="affectedRate"
                  inputMode="decimal"
                  value={form.affectedRate}
                  onChange={(e) => set('affectedRate', e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0.34"
                  className="num"
                />
                <FieldError>{showErrors ? dErrors.affectedRate : undefined}</FieldError>
              </div>
              <div>
                <label htmlFor="meanAge" className="label-tiny mb-1 block">
                  Declared mean age
                </label>
                <Input
                  id="meanAge"
                  inputMode="decimal"
                  value={form.meanAge}
                  onChange={(e) => set('meanAge', e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="58.2"
                  className="num"
                />
                <FieldError>{showErrors ? dErrors.meanAge : undefined}</FieldError>
              </div>
            </div>
          </div>

          <div className="hairline mt-6 pt-5">
            <h3 className="text-base">Field schema</h3>
            <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
              Derived from the file you select, not typed by hand.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv"
                className="hidden"
                onChange={(e) => set('fileName', e.target.files?.[0]?.name ?? null)}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp className="mr-1.5 h-4 w-4" />
                {form.fileName ? 'Choose another file' : 'Select a records file'}
              </Button>
              {form.fileName && (
                <span className="num text-[12.5px] text-muted-foreground">{form.fileName}</span>
              )}
            </div>
            <FieldError>{showErrors ? dErrors.fileName : undefined}</FieldError>

            {form.fileName && markers > 0 && (
              <div className="mt-4 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[30%]">Field</TableHead>
                      <TableHead className="w-[18%]">Type</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {BASE_RECORD_SCHEMA.map((f) => (
                      <TableRow key={f.name}>
                        <TableCell className="num text-[13px]">{f.name}</TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">
                          {f.type}
                        </TableCell>
                        <TableCell className="text-[13px]">{f.description}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="num text-[13px]">
                        {markerFieldName(0)}…{markerFieldName(markers - 1)}
                      </TableCell>
                      <TableCell className="text-[13px] text-muted-foreground">integer</TableCell>
                      <TableCell className="text-[13px]">
                        <span className="num">{markers}</span> fields · minor-allele copies (0, 1,
                        2)
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {records > 0 && markers > 0 && (
            <div className="mt-5 rounded border border-border bg-surface-sunken/60 p-3">
              <p className="text-[13px] leading-6">
                <Count value={records} /> records × <Count value={fieldsPerRecord} /> encrypted
                fields = <Count value={estimate.elements} /> field elements ·{' '}
                <span className="num">~{formatDuration(estimate.seconds)}</span> of single-threaded
                CPU · envelope <span className="num">{formatBytes(estimate.bytes)}</span>
              </p>
              <SourceNote className="mt-1">
                Measured at <span className="num">{ENCRYPTION.microsecondsPerElement} µs</span> per
                field element, linear in the number of elements.
              </SourceNote>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                setShowErrors(true)
                if (Object.keys(describeErrors(form)).length === 0) {
                  setShowErrors(false)
                  setPhase('consent')
                }
              }}
            >
              Continue to consent
            </Button>
            {showErrors && Object.keys(dErrors).length > 0 && (
              <span className="flex items-center gap-1.5 text-[12.5px] text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                {Object.keys(dErrors).length} field(s) need attention
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="panel p-5">
          <h2 className="text-[19px]">Consent</h2>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
            This is what a run is checked against. A use type you leave out is “not allowed”; a use
            type you tick as forbidden is “forbidden”. Both block a run, and a buyer sees which of
            the two it was.
          </p>

          <div className="mt-5 grid gap-6 md:grid-cols-3">
            <div>
              <span className="label-tiny mb-2 block">Allowed use types</span>
              <CheckList
                idPrefix="allow"
                options={USE_TYPES}
                value={form.allowedUseTypes}
                onChange={(v) => set('allowedUseTypes', v)}
                label={(u) => USE_TYPE_LABEL[u]}
              />
              <FieldError>{showErrors ? cErrors.allowedUseTypes : undefined}</FieldError>
            </div>
            <div>
              <span className="label-tiny mb-2 block">Forbidden purposes</span>
              <CheckList
                idPrefix="forbid"
                options={USE_TYPES}
                value={form.forbiddenUseTypes}
                onChange={(v) => set('forbiddenUseTypes', v)}
                label={(u) => USE_TYPE_LABEL[u]}
              />
              <FieldError>{showErrors ? cErrors.forbiddenUseTypes : undefined}</FieldError>
            </div>
            <div>
              <span className="label-tiny mb-2 block">Buyer categories</span>
              <CheckList
                idPrefix="buyer"
                options={BUYER_CATEGORIES}
                value={form.buyerCategories}
                onChange={(v) => set('buyerCategories', v)}
                label={(c) => BUYER_CATEGORY_LABEL[c]}
              />
              <FieldError>{showErrors ? cErrors.buyerCategories : undefined}</FieldError>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="expiry" className="label-tiny mb-1 block">
                Expiry
              </label>
              <Input
                id="expiry"
                type="date"
                value={form.expiresAt}
                disabled={form.noExpiry}
                onChange={(e) => set('expiresAt', e.target.value)}
                className="num w-48"
              />
            </div>
            <label htmlFor="noExpiry" className="flex items-center gap-2 pb-2.5 text-[13.5px]">
              <Checkbox
                id="noExpiry"
                checked={form.noExpiry}
                onCheckedChange={(v) => set('noExpiry', Boolean(v))}
              />
              No expiry
            </label>
          </div>
          <FieldError>{showErrors ? cErrors.expiresAt : undefined}</FieldError>

          <p className="mt-5 rounded border border-border bg-surface-sunken/60 p-3 text-[13.5px] leading-6">
            {consentSentence(consentPreview)}
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setShowErrors(true)
                if (Object.keys(consentErrors(form)).length === 0) {
                  setShowErrors(false)
                  setFraction(0)
                  setPhase('encrypting')
                }
              }}
            >
              Encrypt and upload
            </Button>
            <Button variant="ghost" onClick={() => setPhase('describe')}>
              Back
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

const RegisterPage = () => (
  <div className="flex flex-col gap-6">
    <header className="max-w-3xl">
      <h1 className="text-[30px] leading-[1.15] md:text-[36px]">Register a dataset</h1>
      <p className="mt-3 text-[14.5px] leading-7 text-muted-foreground">
        Describe it, set the consent it will be checked against, then encrypt and upload. The two
        steps sit on one screen because in real life they happen back to back.
      </p>
    </header>
    <SignInGate what="register a dataset">
      <RegisterForm />
    </SignInGate>
  </div>
)

export default RegisterPage
