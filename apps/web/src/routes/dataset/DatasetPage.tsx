/**
 * Екран 2 — картка датасету `/datasets/:owner/:datasetId`.
 * `datasetId` унікальний лише в межах власника, тому адреса — у шляху.
 */

import { ChevronDown, ChevronRight, Plus, ShieldCheck, ShieldOff } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Amount,
  CopyValue,
  Count,
  FrequencySparkline,
  KeyValue,
  SourceNote,
  Tag,
} from '@/components/Primitives'
import { EmptyState, StatePreview } from '@/components/StateBlocks'
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
import {
  BUYER_CATEGORY_LABEL,
  consentSentence,
  formatDate,
  formatRate,
  SOURCE_LABEL,
  truncateMiddle,
  USE_TYPE_LABEL,
} from '@/lib/format'
import {
  BASE_RECORD_SCHEMA,
  type ChainStateKind,
  type Dataset,
  datasetKey,
  datasetUpperBound,
  findDataset,
  LIMITS,
  markerFieldName,
  markerFields,
} from '@/mockData'

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

const SchemaTable = ({ dataset }: { dataset: Dataset }) => {
  const [expanded, setExpanded] = useState(false)
  const markers = useMemo(() => markerFields(dataset.markers), [dataset.markers])

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
          {BASE_RECORD_SCHEMA.map((f) => (
            <TableRow key={f.name}>
              <TableCell className="num text-[13px]">{f.name}</TableCell>
              <TableCell className="text-[13px] text-muted-foreground">{f.type}</TableCell>
              <TableCell className="text-[13px]">{f.description}</TableCell>
            </TableRow>
          ))}
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
                  {markerFieldName(0)}…{markerFieldName(dataset.markers - 1)}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  · <span className="num">{dataset.markers}</span> fields · integer · minor-allele
                  copies (0, 1, 2)
                </span>
              </button>
            </TableCell>
          </TableRow>
          {expanded &&
            markers.map((f) => (
              <TableRow key={f.name} className="bg-surface-sunken/40">
                <TableCell className="num pl-10 text-[13px]">{f.name}</TableCell>
                <TableCell className="text-[13px] text-muted-foreground">{f.type}</TableCell>
                <TableCell className="text-[13px]">{f.description}</TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        <span className="num">{BASE_RECORD_SCHEMA.length + dataset.markers}</span> fields in total,{' '}
        <span className="num">{dataset.markers}</span> of them markers. Field names are
        lowerCamelCase with no underscores — a schema requirement, not a preference.
      </p>
    </div>
  )
}

const ChainBlock = ({ dataset, state }: { dataset: Dataset; state: ChainStateKind }) => {
  if (state === 'unavailable') {
    return (
      <div className="rounded border border-warning/30 bg-warning-soft/60 p-4">
        <p className="text-sm leading-6">
          The RPC node did not answer, so the on-chain record could not be read. This says nothing
          about the dataset — only about the connection.
        </p>
        <Button variant="outline" size="sm" className="mt-3">
          Try again
        </Button>
      </div>
    )
  }

  if (state === 'unregistered') {
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

  const chain = dataset.chain
  if (chain.state !== 'registered') return null

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
          <Count value={chain.claimedRecords} />
        </KeyValue>
        <KeyValue label="Price / 1000 records">
          <Amount value={chain.pricePer1k} withMint />
        </KeyValue>
      </div>
      <SourceNote>
        Registered {formatDate(chain.registeredAt)}. Upper bound for a run that takes every claimed
        record:{' '}
        <Amount value={datasetUpperBound(chain.pricePer1k, chain.claimedRecords)} withMint /> —{' '}
        <span className="num">ceil(price × records / 1000)</span>, rounded up.
      </SourceNote>
    </div>
  )
}

const DatasetPage = () => {
  const { owner = '', datasetId = '' } = useParams()
  const dataset = findDataset(owner, datasetId)
  const navigate = useNavigate()
  const { pool, addToPool } = useAppState()
  const [chainState, setChainState] = useState<ChainStateKind>('registered')

  if (!dataset) {
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

  const key = datasetKey(dataset)
  const inPool = pool.includes(key)
  const consent = dataset.consent

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
              {dataset.attestation.attested ? (
                <Tag tone="success">
                  <ShieldCheck className="h-3 w-3" />
                  operator-attested · {formatDate(dataset.attestation.attestedAt)}
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
            <p>{dataset.ownerName}</p>
            <CopyValue
              value={dataset.owner}
              display={truncateMiddle(dataset.owner, 6, 6)}
              className="-ml-1 mt-0.5"
            />
          </KeyValue>
          <KeyValue label="Collection window">
            <span className="num">
              {formatDate(dataset.collectedFrom)} → {formatDate(dataset.collectedTo)}
            </span>
          </KeyValue>
          <KeyValue label="Records · markers">
            <Count value={dataset.records} /> · <Count value={dataset.markers} />
          </KeyValue>
          <KeyValue label="Price / 1000 records">
            <Amount value={dataset.pricePer1k} withMint />
          </KeyValue>
        </div>
        {dataset.attestation.attested && (
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
              <span className="num text-lg">{formatRate(dataset.declaredStats.affectedRate)}</span>
            </KeyValue>
            <KeyValue label="Mean age">
              <span className="num text-lg">{dataset.declaredStats.meanAge.toFixed(1)}</span>
            </KeyValue>
          </div>
          <div>
            <span className="label-tiny">
              Allele frequencies ·{' '}
              <span className="num">{dataset.declaredStats.alleleFrequencies.length}</span> markers
            </span>
            <FrequencySparkline
              values={dataset.declaredStats.alleleFrequencies}
              className="mt-2"
              height={56}
            />
            <p className="mt-2 text-[12px] text-muted-foreground">
              One bar per marker, in schema order. Exactly as many numbers as there are markers.
            </p>
          </div>
        </div>
      </Section>

      {/* 4 — consent */}
      <Section title="Consent">
        {consent ? (
          <div className="flex flex-col gap-5">
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <KeyValue label="Version">
                <Count value={consent.version} />
                <span className="ml-2 text-[12.5px] text-muted-foreground">
                  set {formatDate(consent.setAt)}
                </span>
              </KeyValue>
              <KeyValue label="Expiry">
                <span className="num">
                  {consent.expiresAt ? formatDate(consent.expiresAt) : 'no expiry'}
                </span>
              </KeyValue>
              <KeyValue label="State">
                {consent.revoked ? (
                  <Tag tone="danger">revoked · {formatDate(consent.revokedAt)}</Tag>
                ) : (
                  <Tag tone="success">in force</Tag>
                )}
              </KeyValue>
              <KeyValue label="Buyer categories">
                <div className="flex flex-wrap gap-1">
                  {consent.buyerCategories.map((c) => (
                    <Tag key={c}>{BUYER_CATEGORY_LABEL[c]}</Tag>
                  ))}
                </div>
              </KeyValue>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <KeyValue label="Allowed use types">
                <div className="flex flex-wrap gap-1">
                  {consent.allowedUseTypes.map((u) => (
                    <Tag key={u} tone="success">
                      {USE_TYPE_LABEL[u]}
                    </Tag>
                  ))}
                </div>
              </KeyValue>
              <KeyValue label="Forbidden purposes">
                {consent.forbiddenUseTypes.length === 0 ? (
                  <span className="text-[13px] text-muted-foreground">
                    nothing explicitly forbidden
                  </span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {consent.forbiddenUseTypes.map((u) => (
                      <Tag key={u} tone="danger">
                        {USE_TYPE_LABEL[u]}
                      </Tag>
                    ))}
                  </div>
                )}
              </KeyValue>
            </div>

            <p className="rounded border border-border bg-surface-sunken/60 p-3 text-[13.5px] leading-6">
              {consentSentence(consent)}
            </p>
            <SourceNote>
              A use type the owner never decided on is <em>not allowed</em>; a use type they ruled
              out is <em>forbidden</em>. Those are different answers and a quote names them
              differently.
            </SourceNote>
          </div>
        ) : (
          <p className="text-sm leading-6">
            No consent has been set. Until the owner sets one, no run can include this dataset.
          </p>
        )}
      </Section>

      {/* 5 — chain state */}
      <Section
        title="Chain state"
        aside={
          <StatePreview
            label="Preview"
            options={['registered', 'unregistered', 'unavailable'] as const}
            value={chainState}
            onChange={setChainState}
          />
        }
      >
        <ChainBlock dataset={dataset} state={chainState} />
      </Section>

      <p className="text-[12px] text-muted-foreground">
        A dataset identifier is at most <span className="num">{LIMITS.DATASET_ID_MAX_LENGTH}</span>{' '}
        characters and unique within an owner, which is why the owner address sits in the path.
      </p>
    </div>
  )
}

export default DatasetPage
