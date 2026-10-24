/**
 * The corpus of runs behind `SC-006` (`T050`, with the rest of `T046`).
 *
 * `SC-006` says the owners' shares plus the fee plus the difference returned
 * to the buyer equal the escrow, to the smallest unit, on every run of the
 * set. The program's arithmetic is covered by the mollusk set
 * (`programs/genovault/tests/convergence.rs`), which reaches every branch of
 * `gross_for`. What it cannot reach is `below_floor`: on the cluster that bit
 * is decided inside the MPC, and the settlement takes it as given. So the live
 * set is not about breadth, it is about the shapes in which the MPC decides
 * who is under the floor:
 *
 * - every dataset above the floor — five owners with different prices and
 *   volumes, whose payouts must all differ and still add up (`T046`);
 * - some above, some under — the surplus goes to those under (`T043`);
 * - everyone under, the cohort revealed — the silent pool (`T027a`);
 * - a cohort under `MIN_COHORT` — nothing to pay, the escrow comes back;
 * - a dataset of one person next to a clinic (`FR-009`);
 * - an expensive dataset that gave everything next to a cheap one under the
 *   floor — the pool average does not fit and the ceiling cuts the surplus.
 *
 * The pools are seeded once and the runs are filters over them, as in `SC-001`:
 * encryption costs time and adds nothing here. Owners are fresh keys, so the
 * auditor can hold each owner's on-chain balance against the events of this
 * corpus alone. Prices are odd numbers on purpose — a round price makes every
 * fee division exact, and an exact division cannot show a lost unit.
 *
 * This command checks nothing. The auditor is `tools/audit-verify sc006`, and
 * it reads the chain, not this file's claims.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AnchorProvider } from '@anchor-lang/core'
import { getMXEPublicKey } from '@arcium-hq/client'
import type { DatasetRecord } from '@genovault/crypto'
import type { GenoVaultProgram } from '@genovault/sdk'
import type { FrequenciesParams } from '@genovault/shared'
import { buyerCategoryBit, useTypeBit } from '@genovault/shared'
import type { Connection, Keypair, PublicKey } from '@solana/web3.js'
import type { ArciumContext } from './arcium.ts'
import { counts, findWindow, MIN_COHORT, MIN_CONTRIBUTION } from './canary.ts'
import { drive } from './drive.ts'
import { syntheticRecords } from './scenario.ts'
import type { DatasetPlan, SeededDataset } from './seed.ts'
import { orderRun, seedDatasets } from './seed.ts'

export class SettlementCorpusError extends Error {
  override readonly name = 'SettlementCorpusError'
}

/** What the driver aims at. The auditor decides the shape from the chain. */
export type SettlementAim = 'exact' | 'surplus' | 'silent' | 'suppressed' | 'ceiling'

export interface PoolSpec {
  name: string
  sizes: readonly number[]
  pricesPer1k: readonly bigint[]
  /** Seed of `syntheticRecords`; dataset `i` takes `seed + i`. */
  seed: number
}

export const SETTLEMENT_POOLS: readonly PoolSpec[] = [
  {
    // Five owners above the floor without a filter: `T046`.
    name: 'five',
    sizes: [10, 12, 14, 16, 18],
    pricesPer1k: [1_000_003n, 1_700_009n, 2_300_011n, 3_100_007n, 4_900_013n],
    seed: 21,
  },
  {
    // A clinic, a dataset under the floor and one person (`FR-009`).
    name: 'individual',
    sizes: [12, 9, 1],
    pricesPer1k: [1_000_003n, 2_000_003n, 3_000_007n],
    seed: 31,
  },
  {
    // 10 records at 900 per record and 9 at almost nothing: the bill at the
    // pool average is ~1.9 × the escrow, so the ceiling cuts the surplus.
    name: 'ceiling',
    sizes: [10, 9],
    pricesPer1k: [900_000_007n, 1n],
    seed: 41,
  },
]

export interface SettlementVariant {
  label: string
  aim: SettlementAim
  pool: string
  params: FrequenciesParams
  /** Records each dataset is expected to give, from the open records. */
  expectedPerDataset: number[]
}

const ALL: FrequenciesParams = { minAge: 0, maxAge: 255, sex: 'any', affected: 'any' }

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

export function poolRecords(spec: PoolSpec): DatasetRecord[][] {
  return spec.sizes.map((size, index) => syntheticRecords(size, spec.seed + index))
}

/**
 * The runs of the corpus, with filters found over the open records.
 *
 * A window that does not exist is an error here, before anything is seeded:
 * a corpus that silently lacks a shape would pass the auditor on less than it
 * claims.
 */
export function planSettlementRuns(
  pools: ReadonlyMap<string, readonly (readonly DatasetRecord[])[]>,
): SettlementVariant[] {
  const pool = (name: string): readonly (readonly DatasetRecord[])[] => {
    const records = pools.get(name)
    if (records === undefined) throw new SettlementCorpusError(`no pool "${name}"`)
    return records
  }
  const variant = (
    label: string,
    aim: SettlementAim,
    name: string,
    params: FrequenciesParams | null,
  ): SettlementVariant => {
    if (params === null) {
      throw new SettlementCorpusError(`pool "${name}" has no age window for "${label}"`)
    }
    return { label, aim, pool: name, params, expectedPerDataset: counts(pool(name), params) }
  }

  const above = (count: number) => count >= MIN_CONTRIBUTION
  const under = (count: number) => count > 0 && count < MIN_CONTRIBUTION

  const runs = [
    variant('five owners, all above the floor', 'exact', 'five', ALL),
    variant(
      'five owners, some under the floor',
      'surplus',
      'five',
      findWindow(
        pool('five'),
        (perDataset) => perDataset.some(above) && perDataset.filter(under).length >= 2,
      ),
    ),
    variant(
      'five owners, everyone under the floor',
      'silent',
      'five',
      findWindow(
        pool('five'),
        (perDataset, total) => total >= MIN_COHORT && perDataset.every((n) => n < MIN_CONTRIBUTION),
      ),
    ),
    variant(
      'five owners, cohort under MIN_COHORT',
      'suppressed',
      'five',
      findWindow(pool('five'), (_, total) => total > 0 && total < MIN_COHORT),
    ),
    variant('a clinic, a small dataset and one person', 'surplus', 'individual', ALL),
    variant('the pool average above the escrow', 'ceiling', 'ceiling', ALL),
  ]

  // The aims are checked against the open records once more: `findWindow`
  // returns the first window that fits, and a pool edited later could make
  // the fixed variants miss their shape without anyone noticing.
  for (const run of runs) {
    const perDataset = run.expectedPerDataset
    const total = sum(perDataset)
    const ok =
      run.aim === 'exact'
        ? perDataset.every(above)
        : run.aim === 'surplus'
          ? perDataset.some(above) && perDataset.some(under)
          : run.aim === 'silent'
            ? total >= MIN_COHORT && perDataset.every((n) => n < MIN_CONTRIBUTION)
            : run.aim === 'suppressed'
              ? total > 0 && total < MIN_COHORT
              : perDataset.every((n, i) => (i === 0 ? n >= MIN_CONTRIBUTION : under(n)))
    if (!ok) {
      throw new SettlementCorpusError(
        `"${run.label}" does not have the shape "${run.aim}": ${perDataset.join('+')}`,
      )
    }
  }
  return runs
}

export interface SettlementRunEntry {
  label: string
  aim: SettlementAim
  pool: string
  run: string
  status: string
  folds: number
  driveMs: number
  expectedPerDataset: number[]
}

export interface SettlementCorpus {
  rpc: string
  programId: string
  buyer: string
  dispatcher: string
  datasets: {
    pool: string
    id: string
    address: string
    owner: string
    recordCount: number
    pricePer1k: string
  }[]
  runs: SettlementRunEntry[]
}

export interface SettlementCorpusOptions {
  connection: Connection
  provider: AnchorProvider
  program: GenoVaultProgram
  arcium: ArciumContext
  rpc: string
  /** One fresh owner per dataset of `SETTLEMENT_POOLS`. */
  owners: readonly Keypair[]
  buyer: Keypair
  dispatcher: Keypair
  mint: PublicKey
  storageDir: string
  /** Rewritten after every run, so an interrupted corpus stays readable. */
  out: string
  nonce: bigint
  maxEscrow: bigint
  /** Only the first `limit` runs — the negative control needs two, not six. */
  limit?: number
  writeConcurrency?: number
  callbackTimeoutMs?: number
  onProgress?(note: string): void
}

export function datasetCount(): number {
  return sum(SETTLEMENT_POOLS.map((spec) => spec.sizes.length))
}

export async function buildSettlementCorpus(
  options: SettlementCorpusOptions,
): Promise<SettlementCorpus> {
  const note = (line: string): void => options.onProgress?.(line)
  if (options.owners.length !== datasetCount()) {
    throw new SettlementCorpusError(
      `${options.owners.length} owners for ${datasetCount()} datasets — one fresh owner each`,
    )
  }

  const mxePublicKey = await getMXEPublicKey(options.provider, options.program.programId)
  if (mxePublicKey === null) {
    throw new SettlementCorpusError('the MXE has no public key yet — cluster keygen is not done')
  }

  const allowedUses = useTypeBit('populationGenetics')
  const buyerCategories = buyerCategoryBit('academic')
  const tag = options.nonce.toString(16)

  const records = new Map(SETTLEMENT_POOLS.map((spec) => [spec.name, poolRecords(spec)]))
  const variants = planSettlementRuns(records).slice(0, options.limit)

  const plans: (DatasetPlan & { pool: string })[] = []
  for (const spec of SETTLEMENT_POOLS) {
    for (const [index, poolRecordsOf] of (records.get(spec.name) ?? []).entries()) {
      const owner = options.owners[plans.length]
      const price = spec.pricesPer1k[index]
      if (owner === undefined || price === undefined) {
        throw new SettlementCorpusError(`pool "${spec.name}" is missing an owner or a price`)
      }
      plans.push({
        pool: spec.name,
        id: `sc006-${spec.name}-${index}-${tag}`.slice(0, 32),
        owner,
        records: poolRecordsOf,
        pricePer1k: price,
        allowedUses,
        forbiddenUses: 0,
        buyerCategories,
        expiresAt: null,
      })
    }
  }

  note(
    `encrypting ${plans.length} datasets: ${plans.map((plan) => plan.records.length).join(' + ')} records`,
  )
  const seeded = await seedDatasets({
    connection: options.connection,
    program: options.program,
    mxePublicKey,
    storageDir: options.storageDir,
    plans,
    onProgress: (id, line) => note(`  ${id}: ${line}`),
  })

  const poolOf = (name: string): SeededDataset[] =>
    seeded.filter((_, index) => plans[index]?.pool === name)

  const corpus: SettlementCorpus = {
    rpc: options.rpc,
    programId: options.program.programId.toBase58(),
    buyer: options.buyer.publicKey.toBase58(),
    dispatcher: options.dispatcher.publicKey.toBase58(),
    datasets: seeded.map((dataset, index) => ({
      pool: plans[index]?.pool ?? '',
      id: dataset.id,
      address: dataset.address.toBase58(),
      owner: dataset.owner.toBase58(),
      recordCount: dataset.recordCount,
      pricePer1k: (plans[index]?.pricePer1k ?? 0n).toString(10),
    })),
    runs: [],
  }

  await mkdir(dirname(options.out), { recursive: true })
  const persist = async (): Promise<void> => {
    await writeFile(options.out, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8')
  }
  await persist()

  for (const [index, variant] of variants.entries()) {
    note(
      `\n[${index + 1}/${variants.length}] "${variant.label}" — ${variant.expectedPerDataset.join('+')}`,
    )
    const pool = poolOf(variant.pool)

    const order = await orderRun({
      connection: options.connection,
      program: options.program,
      buyer: options.buyer,
      mint: options.mint,
      dispatcher: options.dispatcher.publicKey,
      nonce: options.nonce + BigInt(index),
      useType: allowedUses,
      buyerCategory: buyerCategories,
      maxEscrow: options.maxEscrow,
      params: variant.params,
      datasets: pool,
    })
    note(`  ordered ${order.run.toBase58()}`)

    const driven = await drive({
      connection: options.connection,
      program: options.program,
      arcium: options.arcium,
      dispatcher: options.dispatcher,
      run: order.run,
      envelope: async (dataset) => {
        const found = seeded.find((entry) => entry.address.equals(dataset))
        if (found === undefined) {
          throw new SettlementCorpusError(`no envelope for ${dataset.toBase58()}`)
        }
        return Uint8Array.from(await readFile(found.envelopePath))
      },
      ...(options.writeConcurrency === undefined
        ? {}
        : { writeConcurrency: options.writeConcurrency }),
      ...(options.callbackTimeoutMs === undefined
        ? {}
        : { callbackTimeoutMs: options.callbackTimeoutMs }),
    })

    corpus.runs.push({
      label: variant.label,
      aim: variant.aim,
      pool: variant.pool,
      run: order.run.toBase58(),
      status: driven.run.status,
      folds: driven.folds,
      driveMs: driven.elapsedMs,
      expectedPerDataset: variant.expectedPerDataset,
    })
    await persist()
    note(
      `  ${driven.run.status} · cohort ${driven.run.recordsIncluded} · ` +
        `${driven.folds} folds · ${driven.elapsedMs} ms`,
    )
  }

  return corpus
}
