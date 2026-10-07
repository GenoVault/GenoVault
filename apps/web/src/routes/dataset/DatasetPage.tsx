/**
 * Екран 2 — картка датасету `/datasets/:owner/:datasetId`.
 * `datasetId` унікальний лише в межах власника, тому адреса — у шляху.
 *
 * Since `T065` the screen reads `DatasetDetail` — the answer of
 * `GET /datasets/:owner/:id` — whether it comes from the API or from the
 * prototype's fixtures (`lib/catalogData.ts`).
 */

import {
  type ChainView,
  type DatasetDetail,
  type DatasetField,
  MIN_COHORT,
} from '@genovault/shared'
import { ChevronDown, ChevronRight, Loader2, Plus, ShieldCheck, ShieldOff } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  type ConsentDraft,
  ConsentFields,
  consentDraftErrors,
  draftFromTerms,
  EMPTY_CONSENT,
} from '@/components/ConsentFields'
import {
  Amount,
  CopyValue,
  Count,
  FrequencySparkline,
  KeyValue,
  SourceNote,
  Tag,
} from '@/components/Primitives'
import { EmptyState, ErrorBlock, SkeletonCard, StatePreview } from '@/components/StateBlocks'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAppState } from '@/lib/appState'
import { useDatasetDetail } from '@/lib/catalogData'
import { type ConsentTerms, termsFromView } from '@/lib/consentTerms'
import {
  BUYER_CATEGORY_LABEL,
  consentSentence,
  formatDate,
  formatRate,
  SOURCE_LABEL,
  truncateMiddle,
  USE_TYPE_LABEL,
} from '@/lib/format'
import { type ConsentChange, useConsentChange } from '@/lib/ownerConsent'
import { RPC_URL } from '@/lib/rpc'
import { type ChainStateKind, datasetKey, LIMITS } from '@/mockData'

type RegisteredChain = Extract<ChainView, { state: 'registered' }>

/** `ceil(price × records / 1000)` in base units — the bound `FR-015a` keeps. */
const upperBound = (pricePer1k: string, records: string): bigint =>
  (BigInt(pricePer1k) * BigInt(records) + 999n) / 1000n

/** Unix seconds → ISO date. */
const secondsDate = (seconds: string): string =>
  new Date(Number(seconds) * 1000).toISOString().slice(0, 10)

const Section = ({
  title,
  children,
  aside,
}: {
  title: string
  children: React.ReactNode
  aside?: React.ReactNode
}) => (
  <section className="panel p-5">
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <h2 className="text-[19px]">{title}</h2>
      {aside}
    </div>
    <div className="mt-4">{children}</div>
  </section>
)

const FieldRow = ({ field, nested = false }: { field: DatasetField; nested?: boolean }) => (
  <TableRow className={nested ? 'bg-surface-sunken/40' : undefined}>
    <TableCell className={nested ? 'num pl-10 text-[13px]' : 'num text-[13px]'}>
      {field.field}
    </TableCell>
    <TableCell className="text-[13px] text-muted-foreground">{field.type}</TableCell>
    <TableCell className="text-[13px]">{field.description}</TableCell>
  </TableRow>
)

const SchemaTable = ({ dataset }: { dataset: DatasetDetail }) => {
  const [expanded, setExpanded] = useState(false)
  // Markers close the schema: the fixed fields come first, as in the envelope.
  const split = dataset.schema.length - dataset.markerCount
  const fixed = dataset.schema.slice(0, split)
  const markers = dataset.schema.slice(split)
  const first = markers[0]
  const last = markers[markers.length - 1]

  return (
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
          {fixed.map((field) => (
            <FieldRow key={field.field} field={field} />
          ))}
          {first !== undefined && last !== undefined && (
            <TableRow>
              <TableCell colSpan={3} className="p-0">
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-secondary/60"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="num text-[13px]">
                    {first.field}…{last.field}
                  </span>
                  <span className="text-[13px] text-muted-foreground">
                    · <span className="num">{markers.length}</span> fields · {first.type} ·{' '}
                    {first.description}
                  </span>
                </button>
              </TableCell>
            </TableRow>
          )}
          {expanded && markers.map((field) => <FieldRow key={field.field} field={field} nested />)}
        </TableBody>
      </Table>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        <span className="num">{dataset.schema.length}</span> fields in total,{' '}
        <span className="num">{dataset.markerCount}</span> of them markers.
      </p>
    </div>
  )
}

const ChainBlock = ({ dataset }: { dataset: DatasetDetail }) => {
  const chain = dataset.chain

  if (chain.state === 'unavailable') {
    return (
      <div className="rounded border border-warning/30 bg-warning-soft/60 p-4">
        <p className="text-sm leading-6">
          The RPC node did not answer, so the on-chain record could not be read. This says nothing
          about the dataset — only about the connection.
        </p>
      </div>
    )
  }

  if (chain.state === 'unregistered') {
    return (
      <div className="rounded border border-border bg-surface-sunken/60 p-4">
        <p className="text-sm leading-6">
          The owner described this dataset but has not signed its registration yet. Until they do,
          there is no on-chain record: no content hash, no version, no claimed record count — and no
          run can include it.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={chain.status === 'active' ? 'success' : 'warning'}>
          registered · {chain.status}
        </Tag>
        <span className="text-[12.5px] text-muted-foreground">
          read from the chain, not declared by the owner
        </span>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KeyValue label="Content hash">
          <CopyValue
            value={chain.contentHash}
            display={truncateMiddle(chain.contentHash, 10, 8)}
            className="-ml-1"
          />
        </KeyValue>
        <KeyValue label="Version">
          <Count value={chain.version} />
        </KeyValue>
        <KeyValue label="Claimed records">
          <Count value={Number(chain.recordCountClaimed)} />
        </KeyValue>
        <KeyValue label="Price / 1000 records">
          <Amount value={chain.pricePer1k} withMint />
        </KeyValue>
      </div>
      <SourceNote>
        Upper bound for a run that takes every claimed record:{' '}
        <Amount value={upperBound(chain.pricePer1k, chain.recordCountClaimed)} withMint /> —{' '}
        <span className="num">ceil(price × records / 1000)</span>, rounded up.
      </SourceNote>
      {!dataset.ciphertextStored && (
        <p className="rounded border border-warning/30 bg-warning-soft/60 p-3 text-[13px] leading-6">
          Registered on chain, but the ciphertext is not in storage. No run can compute over this
          dataset until the owner uploads it.
        </p>
      )}
    </div>
  )
}

const ConsentBlock = ({ chain, owner }: { chain: ChainView; owner: React.ReactNode }) => {
  if (chain.state !== 'registered') {
    return (
      <p className="text-sm leading-6">
        {chain.state === 'unavailable'
          ? 'Consent lives on chain, and the chain could not be read just now.'
          : 'Consent can only be set on a registered dataset.'}
      </p>
    )
  }
  if (chain.consent === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-6">
          No consent has been set. Until the owner sets one, no run can include this dataset.
        </p>
        {owner}
      </div>
    )
  }

  const version = chain.consent.version
  const terms: ConsentTerms = termsFromView(chain.consent)

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <KeyValue label="Version">
          <Count value={version} />
        </KeyValue>
        <KeyValue label="Expiry">
          <span className="num">{terms.expiresAt ? formatDate(terms.expiresAt) : 'no expiry'}</span>
        </KeyValue>
        <KeyValue label="State">
          {terms.revoked ? <Tag tone="danger">revoked</Tag> : <Tag tone="success">in force</Tag>}
        </KeyValue>
        <KeyValue label="Buyer categories">
          <div className="flex flex-wrap gap-1">
            {terms.buyerCategories.map((c) => (
              <Tag key={c}>{BUYER_CATEGORY_LABEL[c]}</Tag>
            ))}
          </div>
        </KeyValue>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <KeyValue label="Allowed use types">
          <div className="flex flex-wrap gap-1">
            {terms.allowedUses.map((u) => (
              <Tag key={u} tone="success">
                {USE_TYPE_LABEL[u]}
              </Tag>
            ))}
          </div>
        </KeyValue>
        <KeyValue label="Forbidden purposes">
          {terms.forbiddenUses.length === 0 ? (
            <span className="text-[13px] text-muted-foreground">nothing explicitly forbidden</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {terms.forbiddenUses.map((u) => (
                <Tag key={u} tone="danger">
                  {USE_TYPE_LABEL[u]}
                </Tag>
              ))}
            </div>
          )}
        </KeyValue>
      </div>

      <p className="rounded border border-border bg-surface-sunken/60 p-3 text-[13.5px] leading-6">
        {consentSentence(terms)}
      </p>
      <SourceNote>
        A use type the owner never decided on is <em>not allowed</em>; a use type they ruled out is{' '}
        <em>forbidden</em>. Those are different answers and a quote names them differently.
      </SourceNote>
      {owner}
    </div>
  )
}

const CONSENT_PHASE_TEXT: Record<'building' | 'signing' | 'confirming', string> = {
  building: 'The API is assembling the unsigned transaction…',
  signing: 'Sign in your wallet. The API never signs on your behalf.',
  confirming: 'Sent. Waiting for the chain to confirm…',
}

/**
 * The owner's own controls (`T066a`): a new consent version, or revocation.
 *
 * Shown only on a live card whose owner is the signed-in wallet. Everyone else
 * reads the consent; only the owner can sign a change, and the program checks
 * that again (`NotDatasetOwner`).
 */
const OwnerConsentPanel = ({
  dataset,
  chain,
  onChanged,
}: {
  dataset: DatasetDetail
  chain: RegisteredChain
  onChanged: () => void
}) => {
  const { address, token, signAndSendTransaction } = useAppState()
  const change = useConsentChange()
  const current = chain.consent === null ? null : termsFromView(chain.consent)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ConsentDraft>(() =>
    current === null || current.revoked ? EMPTY_CONSENT : draftFromTerms(current),
  )
  const [showErrors, setShowErrors] = useState(false)
  const errors = consentDraftErrors(draft, new Date().toISOString().slice(0, 10))
  const phase = change.phase
  const busy = phase === 'building' || phase === 'signing' || phase === 'confirming'

  if (address === null || RPC_URL === null) {
    return (
      <p className="text-[12.5px] text-muted-foreground">
        {RPC_URL === null
          ? 'No RPC node is configured (VITE_RPC_URL), so nothing can be signed from here.'
          : 'Sign in with the owner wallet to change this consent.'}
      </p>
    )
  }
  const signer = address
  const rpcUrl = RPC_URL

  const run = async (next: ConsentChange) => {
    const result = await change.start(next, {
      token,
      address: signer,
      rpcUrl,
      send: signAndSendTransaction,
    })
    if (result !== null) {
      setEditing(false)
      onChanged()
    }
  }

  const nextVersion = (chain.consent?.version ?? 0) + 1
  const canRevoke = current !== null && !current.revoked

  return (
    <div className="flex flex-col gap-4 rounded border border-primary/30 bg-surface-sunken/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13.5px]">You own this dataset.</span>
        <div className="flex flex-wrap gap-2">
          {!editing && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
              {current === null ? 'Set consent' : 'Change consent'}
            </Button>
          )}
          {canRevoke && !editing && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              disabled={busy}
              onClick={() => void run({ action: 'revoke', datasetId: dataset.datasetId })}
            >
              Revoke consent
            </Button>
          )}
        </div>
      </div>

      {canRevoke && !editing && (
        <SourceNote>
          Revocation closes the gate for every run ordered after it, in the very block it lands in.
          Runs ordered before it are not touched — they were paid for under the consent in force.
        </SourceNote>
      )}

      {editing && (
        <div>
          <ConsentFields
            draft={draft}
            onChange={setDraft}
            errors={showErrors ? errors : undefined}
            idPrefix="owner-consent"
          />
          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              disabled={busy}
              onClick={() => {
                setShowErrors(true)
                if (Object.keys(errors).length === 0) {
                  void run({ action: 'set', datasetId: dataset.datasetId, draft })
                }
              }}
            >
              Sign consent · version <span className="num ml-1">{nextVersion}</span>
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {nextVersion > 1 && (
            <SourceNote className="mt-3">
              A new version does not rewrite the old one: version{' '}
              <span className="num">{nextVersion - 1}</span> stays on chain as history, and a run is
              checked against whichever version is in force when it is ordered.
            </SourceNote>
          )}
        </div>
      )}

      {(phase === 'building' || phase === 'signing' || phase === 'confirming') && (
        <p className="flex items-center gap-2 text-[13px]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          {CONSENT_PHASE_TEXT[phase]}
        </p>
      )}
      {phase === 'done' && change.done !== null && (
        <p className="flex flex-wrap items-center gap-1 text-[13px]">
          Consent version <span className="num">{change.done.transaction.version}</span>
          {change.done.transaction.action === 'set' ? ' is in force' : ' is revoked'} · transaction
          <CopyValue
            value={change.done.signature}
            display={truncateMiddle(change.done.signature, 6, 6)}
          />
        </p>
      )}
      {change.error !== null && <ErrorBlock error={change.error} />}
    </div>
  )
}

const DatasetView = ({
  dataset,
  preview,
  live,
  onChanged,
}: {
  dataset: DatasetDetail
  preview: React.ReactNode
  live: boolean
  onChanged: () => void
}) => {
  const navigate = useNavigate()
  const { pool, addToPool, address } = useAppState()
  const ownerPanel =
    live && address === dataset.owner && dataset.chain.state === 'registered' ? (
      <OwnerConsentPanel dataset={dataset} chain={dataset.chain} onChanged={onChanged} />
    ) : null
  const key = datasetKey(dataset)
  const inPool = pool.includes(key)
  const badge: RegisteredChain['verifiedBadge'] =
    dataset.chain.state === 'registered' ? dataset.chain.verifiedBadge : null
  const statistics = dataset.statistics

  return (
    <div className="flex flex-col gap-5">
      <Link to="/datasets" className="text-[12.5px] text-muted-foreground hover:text-foreground">
        ← Catalog
      </Link>

      {/* 1 — header */}
      <header className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Tag tone="brand">{SOURCE_LABEL[dataset.source]}</Tag>
              {badge !== null ? (
                <Tag tone="success">
                  <ShieldCheck className="h-3 w-3" />
                  operator-attested · {formatDate(secondsDate(badge.verifiedAt))}
                </Tag>
              ) : (
                <Tag tone="neutral">
                  <ShieldOff className="h-3 w-3" />
                  not attested
                </Tag>
              )}
            </div>
            <h1 className="mt-3 text-[26px] leading-[1.2] md:text-[32px]">{dataset.title}</h1>
            <p className="num mt-1.5 text-[12.5px] text-muted-foreground">{dataset.datasetId}</p>
            <p className="mt-3 max-w-2xl text-[13.5px] leading-6 text-muted-foreground">
              {dataset.description}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-stretch gap-2">
            <Button
              onClick={() => {
                addToPool(key)
                navigate('/runs/new')
              }}
              disabled={inPool}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {inPool ? 'Already in the run' : 'Add to run'}
            </Button>
            <p className="max-w-[15rem] text-[11.5px] leading-4 text-muted-foreground">
              The content exists in exactly one form — ciphertext. There is nothing to download and
              no rows to preview.
            </p>
          </div>
        </div>

        <div className="hairline mt-5 grid gap-5 pt-5 sm:grid-cols-2 lg:grid-cols-4">
          <KeyValue label="Owner">
            <CopyValue
              value={dataset.owner}
              display={truncateMiddle(dataset.owner, 6, 6)}
              className="-ml-1"
            />
          </KeyValue>
          <KeyValue label="Collection window">
            <span className="num">
              {formatDate(dataset.provenance.collectedFrom)} →{' '}
              {formatDate(dataset.provenance.collectedTo)}
            </span>
          </KeyValue>
          <KeyValue label="Records · markers">
            <Count value={dataset.recordCount} /> · <Count value={dataset.markerCount} />
          </KeyValue>
          <KeyValue label="Price / 1000 records">
            <Amount value={dataset.pricePer1k} withMint />
          </KeyValue>
        </div>
        {badge !== null && (
          <SourceNote className="mt-4">
            <span className="num">operator-attested</span> means the platform operator checked the
            owner's identity. It is trust in the operator, not a cryptographic proof of anything
            about the data.
          </SourceNote>
        )}
      </header>

      {/* 2 — data shape */}
      <Section
        title="Data shape"
        aside={
          <span className="text-[12.5px] text-muted-foreground">the schema, never the records</span>
        }
      >
        <SchemaTable dataset={dataset} />
      </Section>

      {/* 3 — declared statistics */}
      <Section title="Declared statistics">
        {statistics === null ? (
          <p className="text-sm leading-6">
            No statistics. Below <span className="num">{MIN_COHORT}</span> records an aggregate
            describes a person rather than a cohort, so none is accepted.
          </p>
        ) : (
          <>
            <div className="rounded border border-warning/30 bg-warning-soft/50 px-3 py-2">
              <p className="text-[12.5px] leading-5">
                These numbers were declared by the owner. Nobody verified them —{' '}
                <span className="num">declaredBy: owner</span>,{' '}
                <span className="num">verified: false</span>.
              </p>
            </div>
            <div className="mt-4 grid gap-6 lg:grid-cols-[16rem_1fr]">
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-1">
                <KeyValue label="Affected rate">
                  <span className="num text-lg">{formatRate(statistics.affectedRate)}</span>
                </KeyValue>
                <KeyValue label="Mean age">
                  <span className="num text-lg">{statistics.meanAge.toFixed(1)}</span>
                </KeyValue>
              </div>
              <div>
                <span className="label-tiny">
                  Allele frequencies ·{' '}
                  <span className="num">{statistics.alleleFrequencies.length}</span> markers
                </span>
                <FrequencySparkline
                  values={statistics.alleleFrequencies}
                  className="mt-2"
                  height={56}
                />
                <p className="mt-2 text-[12px] text-muted-foreground">
                  One bar per marker, in schema order. Exactly as many numbers as there are markers.
                </p>
              </div>
            </div>
          </>
        )}
      </Section>

      {/* 4 — consent */}
      <Section title="Consent">
        <ConsentBlock chain={dataset.chain} owner={ownerPanel} />
      </Section>

      {/* 5 — chain state */}
      <Section title="Chain state" aside={preview}>
        <ChainBlock dataset={dataset} />
      </Section>

      <p className="text-[12px] text-muted-foreground">
        A dataset identifier is at most <span className="num">{LIMITS.DATASET_ID_MAX_LENGTH}</span>{' '}
        characters and unique within an owner, which is why the owner address sits in the path.
      </p>
    </div>
  )
}

const DatasetPage = () => {
  const { owner = '', datasetId = '' } = useParams()
  const [chainState, setChainState] = useState<ChainStateKind>('registered')
  const { token } = useAppState()
  const detail = useDatasetDetail(owner, datasetId, chainState, token)

  if (detail.loading) return <SkeletonCard />

  if (detail.error?.code === 'NOT_FOUND' || (detail.error === null && detail.data === null)) {
    return (
      <EmptyState
        title="No such dataset"
        body="A dataset identifier is unique only within an owner, so both parts of the path have to match."
        action={
          <Button variant="outline" asChild>
            <Link to="/datasets">Back to the catalog</Link>
          </Button>
        }
      />
    )
  }

  if (detail.error !== null || detail.data === null) {
    return <ErrorBlock error={detail.error ?? { code: 'INTERNAL', message: 'No data.' }} />
  }

  // The chain-state preview is the prototype's: a live card shows what the
  // chain said and nothing else.
  const preview = detail.live ? undefined : (
    <StatePreview
      label="Preview"
      options={['registered', 'unregistered', 'unavailable'] as const}
      value={chainState}
      onChange={setChainState}
    />
  )

  return (
    <DatasetView
      dataset={detail.data}
      preview={preview}
      live={detail.live}
      onChanged={detail.refresh}
    />
  )
}

export default DatasetPage
