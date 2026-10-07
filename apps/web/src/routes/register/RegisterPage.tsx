/**
 * Екран 3 — реєстрація датасету `/datasets/new`.
 * Шифрування — це окремий стан екрана, а не спінер: 1183 µs на елемент поля,
 * лінійно, тобто хвилини. П'ять безіменних хвилин читаються як зависання.
 *
 * Since `T066` the records file is read in the browser — NDJSON, as
 * `tools/gen-dataset` writes it — and the record count, the markers and the
 * three declared aggregates come from that file, not from typed fields
 * (decision 2026-10-07). Live, the screen then encrypts in a worker
 * to the MXE key read from the chain, uploads, and asks the wallet to sign the
 * registration and consent version 1. The prototype keeps a simulated run of
 * the same steps.
 */

import { AlertTriangle, Check, FileUp, Loader2, Lock, UploadCloud } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  type ConsentDraft,
  ConsentFields,
  consentDraftErrors,
  draftToTerms,
  EMPTY_CONSENT,
  FieldError,
} from '@/components/ConsentFields'
import {
  CopyValue,
  Count,
  FrequencySparkline,
  KeyValue,
  SourceNote,
  Tag,
} from '@/components/Primitives'
import { ErrorBlock, SignInGate, StatePreview, WalletSignStep } from '@/components/StateBlocks'
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
import { Textarea } from '@/components/ui/textarea'
import { useAppState } from '@/lib/appState'
import {
  consentSentence,
  estimateEncryption,
  formatBytes,
  formatDuration,
  formatInt,
  formatRate,
  SOURCE_LABEL,
  truncateMiddle,
} from '@/lib/format'
import { parseRecordsFile, type RecordsFile, RecordsFileError } from '@/lib/recordsFile'
import { type RegisterStage, useRegistration } from '@/lib/registration'
import { RPC_URL } from '@/lib/rpc'
import { LIVE_DATA } from '@/lib/runData'
import { cn } from '@/lib/utils'
import { DATASET_SOURCES, type DatasetSource, ENCRYPTION, LIMITS, STABLE_MINT } from '@/mockData'

type Step = 'describe' | 'consent' | 'process'

/** The prototype's simulated process — the live one is `useRegistration`. */
type MockPhase =
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
  price: string
}

const INITIAL: FormState = {
  datasetId: '',
  title: '',
  description: '',
  source: 'synthetic',
  collectedFrom: '',
  collectedTo: '',
  price: '',
}

type LoadedFile =
  | { name: string; parsed: RecordsFile; error: null }
  | { name: string; parsed: null; error: string }

type Errors = Partial<Record<keyof FormState | 'file', string>>

/** "4.5" stable units → base units, or `null` when it is not a plain decimal. */
const toBaseUnits = (value: string): string | null => {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim())
  if (match === null) return null
  const [, whole = '0', fraction = ''] = match
  if (fraction.length > STABLE_MINT.decimals) return null
  return (
    BigInt(whole) * 10n ** BigInt(STABLE_MINT.decimals) +
    BigInt(fraction.padEnd(STABLE_MINT.decimals, '0') || '0')
  ).toString()
}

const describeErrors = (f: FormState, file: LoadedFile | null): Errors => {
  const e: Errors = {}
  if (f.datasetId.trim() === '') e.datasetId = 'Required.'
  else if (f.datasetId.length > LIMITS.DATASET_ID_MAX_LENGTH)
    e.datasetId = `At most ${LIMITS.DATASET_ID_MAX_LENGTH} characters.`
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(f.datasetId))
    e.datasetId = 'Lowercase letters, digits and hyphens only.'

  if (f.title.trim().length < 3) e.title = 'At least 3 characters.'
  if (f.description.trim().length < 20) e.description = 'At least 20 characters.'
  if (f.collectedFrom === '') e.collectedFrom = 'Required.'
  if (f.collectedTo === '') e.collectedTo = 'Required.'
  else if (f.collectedFrom !== '' && f.collectedTo < f.collectedFrom)
    e.collectedTo = 'The window ends before it starts.'

  const price = toBaseUnits(f.price)
  if (price === null || BigInt(price) === 0n)
    e.price = `Price per 1000 records, greater than zero, at most ${STABLE_MINT.decimals} decimals.`

  if (file === null) e.file = 'Select a records file — everything below is derived from it.'
  else if (file.error !== null) e.file = file.error
  return e
}

const Stepper = ({ step }: { step: Step }) => {
  const steps = [
    { key: 'describe', label: 'Describe' },
    { key: 'consent', label: 'Consent' },
    { key: 'process', label: 'Encrypt · upload · sign' },
  ]
  const activeIndex = step === 'describe' ? 0 : step === 'consent' ? 1 : 2
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

const StageRow = ({
  icon,
  label,
  state,
  detail,
  fraction,
  tone,
}: {
  icon: React.ReactNode
  label: string
  state: 'waiting' | 'active' | 'done' | 'failed'
  detail: string
  fraction: number
  tone: 'primary' | 'brand'
}) => (
  <div>
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <span className="flex items-center gap-2 text-[13.5px]">
        {icon}
        {label}
        {state === 'active' && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
        {state === 'done' && <Check className="h-3.5 w-3.5 text-success" />}
        {state === 'failed' && <AlertTriangle className="h-3.5 w-3.5 text-destructive" />}
      </span>
      <span className="num text-[12.5px] text-muted-foreground">{detail}</span>
    </div>
    <ProgressBar fraction={fraction} tone={tone} />
  </div>
)

/** The derived description: what the file says, before anything is encrypted. */
const FileSummary = ({ file }: { file: RecordsFile }) => {
  const estimate = estimateEncryption(file.records.length, file.markerCount + 3)
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KeyValue label="Records">
          <Count value={file.records.length} />
        </KeyValue>
        <KeyValue label="Markers">
          <Count value={file.markerCount} />
        </KeyValue>
        <KeyValue label="Affected rate">
          <span className="num">
            {file.statistics === null ? '—' : formatRate(file.statistics.affectedRate)}
          </span>
        </KeyValue>
        <KeyValue label="Mean age">
          <span className="num">
            {file.statistics === null ? '—' : file.statistics.meanAge.toFixed(1)}
          </span>
        </KeyValue>
      </div>
      {file.statistics === null ? (
        <SourceNote>
          Fewer than <span className="num">{LIMITS.MIN_COHORT}</span> records: no aggregates are
          declared, because on a cohort that small they describe a person.
        </SourceNote>
      ) : (
        <div>
          <span className="label-tiny">
            Allele frequencies · <span className="num">{file.markerCount}</span> markers
          </span>
          <FrequencySparkline
            values={file.statistics.alleleFrequencies}
            className="mt-2"
            height={44}
          />
          <SourceNote className="mt-2">
            Computed in this browser from the file you selected. The catalog shows them as declared
            by you and verified by nobody.
          </SourceNote>
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">Field</TableHead>
              <TableHead className="w-[18%]">Type</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {file.schema.slice(0, 3).map((f) => (
              <TableRow key={f.field}>
                <TableCell className="num text-[13px]">{f.field}</TableCell>
                <TableCell className="text-[13px] text-muted-foreground">{f.type}</TableCell>
                <TableCell className="text-[13px]">{f.description}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell className="num text-[13px]">
                {file.schema[3]?.field}…{file.schema.at(-1)?.field}
              </TableCell>
              <TableCell className="text-[13px] text-muted-foreground">integer</TableCell>
              <TableCell className="text-[13px]">
                <span className="num">{file.markerCount}</span> fields · minor-allele copies (0, 1,
                2)
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div className="rounded border border-border bg-surface-sunken/60 p-3">
        <p className="text-[13px] leading-6">
          <Count value={file.records.length} /> records × <Count value={file.markerCount + 3} />{' '}
          encrypted fields = <Count value={estimate.elements} /> field elements ·{' '}
          <span className="num">~{formatDuration(estimate.seconds)}</span> of single-threaded CPU ·
          envelope <span className="num">{formatBytes(estimate.bytes)}</span>
        </p>
        <SourceNote className="mt-1">
          Measured at <span className="num">{ENCRYPTION.microsecondsPerElement} µs</span> per field
          element, linear in the number of elements. A pseudonymous{' '}
          <span className="num">subjectId</span> in the file stays in the file — it is not encrypted
          and not uploaded.
        </SourceNote>
      </div>
    </div>
  )
}

/* ---------------- live process ---------------- */

const STAGE_ORDER: RegisterStage[] = [
  'key',
  'encrypting',
  'declaring',
  'uploading',
  'signing',
  'confirming',
  'consent-building',
  'consent-signing',
  'consent-confirming',
]

const LiveProcess = ({
  form,
  file,
  consent,
  onBack,
}: {
  form: FormState
  file: RecordsFile
  consent: ConsentDraft
  onBack: () => void
}) => {
  const { address, token, signAndSendTransaction } = useAppState()
  const registration = useRegistration()
  const started = useRef(false)
  const price = toBaseUnits(form.price) ?? '0'

  const start = () => {
    if (address === null || RPC_URL === null) return
    void registration.run(
      {
        datasetId: form.datasetId,
        title: form.title.trim(),
        description: form.description.trim(),
        source: form.source,
        collectedFrom: form.collectedFrom,
        collectedTo: form.collectedTo,
        pricePer1k: price,
        file,
        consent,
      },
      { token, owner: address, rpcUrl: RPC_URL, send: signAndSendTransaction },
    )
  }

  // Starts once, when the step opens; a retry is a button, not a re-render.
  useEffect(() => {
    if (started.current) return
    started.current = true
    start()
  })

  if (RPC_URL === null) {
    return (
      <ErrorBlock
        error={{
          code: 'INTERNAL',
          message:
            'No RPC node is configured (VITE_RPC_URL): the MXE key cannot be read and nothing can be signed.',
        }}
      />
    )
  }

  const { phase, failedAt, encrypted, uploaded, error, result } = registration
  const current = phase === 'error' ? failedAt : phase === 'idle' || phase === 'done' ? null : phase
  const index = (stage: RegisterStage) => STAGE_ORDER.indexOf(stage)
  const reached = current === null ? (phase === 'done' ? STAGE_ORDER.length : -1) : index(current)
  const stateOf = (from: RegisterStage, to: RegisterStage) => {
    if (phase === 'done' || reached > index(to)) return 'done' as const
    if (reached >= index(from)) return phase === 'error' ? ('failed' as const) : ('active' as const)
    return 'waiting' as const
  }
  const encryptFraction = encrypted === null ? 0 : encrypted.done / encrypted.total
  const uploadFraction = uploaded === null ? 0 : uploaded.sent / uploaded.total
  const busy = phase !== 'idle' && phase !== 'done' && phase !== 'error'

  return (
    <div className="flex flex-col gap-5">
      <div className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[19px]">
            {phase === 'done' ? 'Dataset registered' : 'Encrypt, upload, then sign'}
          </h2>
          <span className="text-[12.5px] text-muted-foreground">bytes first, signature second</span>
        </div>
        <p className="mt-3 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
          Records are encrypted in this browser, in a Web Worker, to the key of the MPC cluster —
          read from the chain, not from GenoVault's server. Nobody holds a key that opens the
          envelope alone: not you, not the operator.
        </p>

        <div className="mt-5 flex flex-col gap-5">
          <StageRow
            icon={<Lock className="h-3.5 w-3.5 text-primary" />}
            label={phase === 'key' ? 'Reading the cluster key from the chain' : 'Encrypting'}
            state={stateOf('key', 'encrypting')}
            detail={
              encrypted === null
                ? `${formatInt(file.records.length)} records`
                : `${formatInt(encrypted.done)} / ${formatInt(encrypted.total)} records`
            }
            fraction={stateOf('key', 'encrypting') === 'done' ? 1 : encryptFraction}
            tone="primary"
          />
          <StageRow
            icon={<UploadCloud className="h-3.5 w-3.5 text-brand" />}
            label="Declaring and uploading"
            state={stateOf('declaring', 'uploading')}
            detail={
              uploaded === null
                ? 'waiting for the ciphertext'
                : `${formatBytes(uploaded.sent)} of ${formatBytes(uploaded.total)}`
            }
            fraction={stateOf('declaring', 'uploading') === 'done' ? 1 : uploadFraction}
            tone="brand"
          />
          <StageRow
            icon={<Check className="h-3.5 w-3.5 text-primary" />}
            label="Registration on chain"
            state={stateOf('signing', 'confirming')}
            detail={
              phase === 'signing'
                ? 'sign in your wallet'
                : phase === 'confirming'
                  ? 'waiting for confirmation'
                  : 'content hash · record count · price'
            }
            fraction={stateOf('signing', 'confirming') === 'done' ? 1 : 0}
            tone="primary"
          />
          <StageRow
            icon={<Check className="h-3.5 w-3.5 text-primary" />}
            label="Consent · version 1"
            state={stateOf('consent-building', 'consent-confirming')}
            detail={
              phase === 'consent-signing'
                ? 'sign in your wallet'
                : phase === 'consent-confirming'
                  ? 'waiting for confirmation'
                  : 'what a run is checked against'
            }
            fraction={stateOf('consent-building', 'consent-confirming') === 'done' ? 1 : 0}
            tone="primary"
          />
        </div>

        {busy && (phase === 'key' || phase === 'encrypting' || phase === 'uploading') && (
          <div className="mt-5">
            <Button variant="outline" size="sm" onClick={registration.cancel}>
              Cancel
            </Button>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Nothing has been signed yet, so nothing is on chain.
            </p>
          </div>
        )}
      </div>

      {phase === 'error' && error !== null && (
        <div className="flex flex-col gap-3">
          <ErrorBlock error={error} />
          <div className="flex flex-wrap gap-3">
            <Button onClick={start}>Retry from where it stopped</Button>
            <Button
              variant="ghost"
              onClick={() => {
                registration.reset()
                started.current = true
                onBack()
              }}
            >
              Back to consent
            </Button>
          </div>
          <SourceNote>
            The steps already done are kept: the ciphertext stays in this tab, and a signed
            registration is not signed twice.
          </SourceNote>
        </div>
      )}

      {phase === 'done' && result !== null && (
        <div className="panel p-5">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-success" />
            <h3 className="text-base">
              <span className="num">{result.datasetId}</span> is registered
            </h3>
          </div>
          <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <KeyValue label="Records">
              <Count value={file.records.length} />
            </KeyValue>
            <KeyValue label="Envelope">
              <span className="num">{formatBytes(result.byteLength)}</span>
            </KeyValue>
            <KeyValue label="Content hash">
              <CopyValue
                value={result.contentHash}
                display={truncateMiddle(result.contentHash, 8, 6)}
                className="-ml-1"
              />
            </KeyValue>
            <KeyValue label="Consent">
              <Tag tone="success">version {result.consentVersion} · in force</Tag>
            </KeyValue>
          </div>
          <SourceNote className="mt-4">{consentSentence(draftToTerms(consent))}</SourceNote>
          <Button variant="outline" className="mt-4" asChild>
            <Link to={`/datasets/${result.owner}/${result.datasetId}`}>Open its card</Link>
          </Button>
        </div>
      )}
    </div>
  )
}

/* ---------------- prototype process ---------------- */

const MockProcess = ({
  form,
  file,
  consent,
  onCancel,
}: {
  form: FormState
  file: RecordsFile
  consent: ConsentDraft
  onCancel: () => void
}) => {
  const [phase, setPhase] = useState<MockPhase>('encrypting')
  const [fraction, setFraction] = useState(0)
  const estimate = useMemo(
    () => estimateEncryption(file.records.length, file.markerCount + 3),
    [file],
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

  const doneElements = Math.round(estimate.elements * fraction)
  const remainingSeconds =
    ((estimate.elements - doneElements) * ENCRYPTION.microsecondsPerElement) / 1_000_000

  return (
    <div className="flex flex-col gap-5">
      <div className="panel p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[19px]">
            {phase === 'done' ? 'Dataset registered' : 'Encrypt, upload, then sign'}
          </h2>
          <span className="text-[12.5px] text-muted-foreground">bytes first, signature second</span>
        </div>
        <p className="mt-3 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
          Records are encrypted in your browser, in a Web Worker — the tab stays responsive and you
          can leave and come back. The key never leaves this device: GenoVault cannot decrypt your
          data, and neither can its operator.
        </p>
        <div className="mt-5 flex flex-col gap-5">
          <StageRow
            icon={<Lock className="h-3.5 w-3.5 text-primary" />}
            label="Encrypting"
            state={
              phase === 'encrypting' ? 'active' : phase === 'encrypt-error' ? 'failed' : 'done'
            }
            detail={
              phase === 'encrypting'
                ? `${formatInt(doneElements)} / ${formatInt(estimate.elements)} values · ~${formatDuration(remainingSeconds)} left`
                : `${formatInt(estimate.elements)} values · envelope ${formatBytes(estimate.bytes)}`
            }
            fraction={phase === 'encrypting' ? fraction : 1}
            tone="primary"
          />
          <StageRow
            icon={<UploadCloud className="h-3.5 w-3.5 text-brand" />}
            label="Uploading"
            state={
              phase === 'uploading'
                ? 'active'
                : phase === 'upload-error'
                  ? 'failed'
                  : phase === 'encrypting' || phase === 'encrypt-error'
                    ? 'waiting'
                    : 'done'
            }
            detail={
              phase === 'uploading'
                ? `${formatBytes(estimate.bytes * fraction)} of ${formatBytes(estimate.bytes)}`
                : formatBytes(estimate.bytes)
            }
            fraction={
              phase === 'uploading'
                ? fraction
                : phase === 'signing' || phase === 'done' || phase === 'sign-error'
                  ? 1
                  : 0
            }
            tone="brand"
          />
          {processing && (
            <div>
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
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
          onCancel={onCancel}
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
          <SourceNote className="mt-4">{consentSentence(draftToTerms(consent))}</SourceNote>
        </div>
      )}
      {phase === 'encrypt-error' && (
        <ErrorBlock
          error={{
            code: 'INTERNAL',
            message:
              'Encryption failed in the worker. Nothing was uploaded and nothing was signed.',
            details: { stage: 'encrypting' },
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

/* ---------------- the form ---------------- */

const RegisterForm = () => {
  const [form, setForm] = useState<FormState>(INITIAL)
  const [file, setFile] = useState<LoadedFile | null>(null)
  const [consent, setConsent] = useState<ConsentDraft>(EMPTY_CONSENT)
  const [step, setStep] = useState<Step>('describe')
  const [showErrors, setShowErrors] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const dErrors = describeErrors(form, file)
  const cErrors = consentDraftErrors(consent, new Date().toISOString().slice(0, 10))

  const readFile = async (picked: File | undefined) => {
    if (picked === undefined) return
    try {
      setFile({ name: picked.name, parsed: parseRecordsFile(await picked.text()), error: null })
    } catch (error) {
      setFile({
        name: picked.name,
        parsed: null,
        error:
          error instanceof RecordsFileError
            ? error.message
            : 'The file could not be read as NDJSON records.',
      })
    }
  }

  if (step === 'process' && file?.parsed) {
    return (
      <div className="flex flex-col gap-5">
        <Stepper step={step} />
        {LIVE_DATA ? (
          <LiveProcess
            form={form}
            file={file.parsed}
            consent={consent}
            onBack={() => setStep('consent')}
          />
        ) : (
          <MockProcess
            form={form}
            file={file.parsed}
            consent={consent}
            onCancel={() => setStep('consent')}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <Stepper step={step} />

      {step === 'describe' ? (
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
                placeholder="cardio-cohort-02"
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
                placeholder="Cardiology cohort — wave 02"
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

            <div>
              <label htmlFor="price" className="label-tiny mb-1 block">
                Price per {formatInt(LIMITS.RECORDS_PER_PRICE_UNIT)} records · stable units
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
          </div>

          <div className="hairline mt-6 pt-5">
            <h3 className="text-base">Records file</h3>
            <p className="mt-1.5 text-[13px] leading-6 text-muted-foreground">
              NDJSON, one record per line —{' '}
              <span className="num">{'{"sex":0,"age":54,"affected":1,"genotypes":[0,2,1,…]}'}</span>
              , as <span className="num">tools/gen-dataset</span> writes it. It is read here, in
              this tab; the record count, the markers and the aggregates come from it.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".ndjson,.jsonl,application/x-ndjson"
                className="hidden"
                onChange={(e) => void readFile(e.target.files?.[0])}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp className="mr-1.5 h-4 w-4" />
                {file ? 'Choose another file' : 'Select a records file'}
              </Button>
              {file && <span className="num text-[12.5px] text-muted-foreground">{file.name}</span>}
            </div>
            {file?.error && <FieldError>{file.error}</FieldError>}
            {!file && <FieldError>{showErrors ? dErrors.file : undefined}</FieldError>}
            {file?.parsed && <FileSummary file={file.parsed} />}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Button
              onClick={() => {
                setShowErrors(true)
                if (Object.keys(describeErrors(form, file)).length === 0) {
                  setShowErrors(false)
                  setStep('consent')
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
          <div className="mt-5">
            <ConsentFields
              draft={consent}
              onChange={setConsent}
              errors={showErrors ? cErrors : undefined}
              idPrefix="register"
            />
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              onClick={() => {
                setShowErrors(true)
                if (Object.keys(cErrors).length === 0) {
                  setShowErrors(false)
                  setStep('process')
                }
              }}
            >
              Encrypt and upload
            </Button>
            <Button variant="ghost" onClick={() => setStep('describe')}>
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
