/**
 * The corpus of runs behind `SC-007` (`T051`).
 *
 * `SC-007` says the distribution between 50 owners in one run finishes in
 * under 30 seconds. "Distribution" here starts where paying becomes possible —
 * the reveal callback that leaves the report on chain — and ends with
 * `finalize_run`, which returns the difference to the buyer. The MPC part of
 * the run is `SC-003`, not this.
 *
 * The runs are the worst case for the distribution, not the average:
 *
 * - every pool has the full 50 datasets (`MAX_RUN_DATASETS`), each of its own
 *   fresh owner, so all 50 `OwnerBalance` accounts are created by the payouts
 *   themselves (`init_if_needed`, the heaviest path — 74 202 CU on `T050`);
 * - every dataset gives exactly `MIN_CONTRIBUTION` records, so all 50 are
 *   above the floor and every payout is a non-zero transfer of value;
 * - each measured run has a pool of its own: on a reused pool only the first
 *   run would create the balances.
 *
 * The negative control is one more run with the dispatcher waiting for
 * `finalized` on every payout. It is ordered by a buyer of its own, so the
 * auditor counts the measured set and the control set separately from the
 * chain.
 *
 * This command checks nothing. The auditor is `tools/audit-verify sc007`, and
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
import type { Commitment, Connection, Keypair, PublicKey } from '@solana/web3.js'
import type { ArciumContext } from './arcium.ts'
import { counts, MIN_CONTRIBUTION } from './canary.ts'
import { drive } from './drive.ts'
import { syntheticRecords } from './scenario.ts'
import type { DatasetPlan, SeededDataset } from './seed.ts'
import { orderRun, seedDatasets } from './seed.ts'

export class DistributionCorpusError extends Error {
  override readonly name = 'DistributionCorpusError'
}

/** Owners in one run — the number in `SC-007`, and `MAX_RUN_DATASETS`. */
export const DISTRIBUTION_OWNERS = 50

/** Measured runs: the criterion holds the worst of them, not one lucky run. */
export const MEASURED_RUNS = 3

const ALL: FrequenciesParams = { minAge: 0, maxAge: 255, sex: 'any', affected: 'any' }

export interface DistributionPool {
  name: string
  records: DatasetRecord[][]
  pricesPer1k: bigint[]
}

/**
 * The pools of the measured runs, one per run.
 *
 * Prices are odd and all different: a round price makes every fee division
 * exact, and equal prices would make 50 payouts that differ only by name.
 */
export function distributionPools(runs = MEASURED_RUNS): DistributionPool[] {
  return Array.from({ length: runs }, (_, pool) => ({
    name: `pool-${pool}`,
    records: Array.from({ length: DISTRIBUTION_OWNERS }, (_, index) =>
      syntheticRecords(MIN_CONTRIBUTION, 1_000 * (pool + 1) + index),
    ),
    pricesPer1k: Array.from(
      { length: DISTRIBUTION_OWNERS },
      (_, index) => 1_000_003n + 2n * BigInt(index) + 200n * BigInt(pool),
    ),
  }))
}

/**
 * Checks the pools against the open records before anything is seeded: a
 * dataset that gives fewer than `MIN_CONTRIBUTION` records under the run's
 * filter would be paid nothing, and the run would distribute between fewer
 * owners than it claims.
 */
export function checkPools(pools: readonly DistributionPool[]): void {
  for (const pool of pools) {
    if (pool.records.length !== DISTRIBUTION_OWNERS) {
      throw new DistributionCorpusError(
        `${pool.name} has ${pool.records.length} datasets, not ${DISTRIBUTION_OWNERS}`,
      )
    }
    const perDataset = counts(pool.records, ALL)
    const under = perDataset.filter((count) => count < MIN_CONTRIBUTION).length
    if (under > 0) {
      throw new DistributionCorpusError(
        `${pool.name}: ${under} datasets under the floor — they would be paid nothing`,
      )
    }
    if (new Set(pool.pricesPer1k).size !== pool.pricesPer1k.length) {
      throw new DistributionCorpusError(`${pool.name}: two datasets share a price`)
    }
  }
}

export interface DistributionRunEntry {
  label: string
  pool: string
  run: string
  status: string
  folds: number
  /** The driver's own stopwatch, for the log. The auditor does not read it. */
  driveMs: number
  settleCommitment: Commitment
}

export interface DistributionSet {
  buyer: string
  runs: DistributionRunEntry[]
}

export interface DistributionCorpus {
  rpc: string
  programId: string
  dispatcher: string
  datasets: {
    pool: string
    id: string
    address: string
    owner: string
    recordCount: number
    pricePer1k: string
  }[]
  measured: DistributionSet
  control: DistributionSet
}

export interface DistributionCorpusOptions {
  connection: Connection
  provider: AnchorProvider
  program: GenoVaultProgram
  arcium: ArciumContext
  rpc: string
  /** `DISTRIBUTION_OWNERS × runs` fresh owners, one per dataset. */
  owners: readonly Keypair[]
  buyer: Keypair
  /** The buyer of the negative control — a key of its own. */
  controlBuyer: Keypair
  dispatcher: Keypair
  mint: PublicKey
  storageDir: string
  /** Rewritten after every run, so an interrupted corpus stays readable. */
  out: string
  nonce: bigint
  maxEscrow: bigint
  /** Measured runs; the control always comes after them. */
  runs?: number
  /** `false` skips the control — for a rerun of the measured set alone. */
  control?: boolean
  writeConcurrency?: number
  callbackTimeoutMs?: number
  onProgress?(note: string): void
}

export function ownerCount(runs = MEASURED_RUNS): number {
  return DISTRIBUTION_OWNERS * runs
}

export async function buildDistributionCorpus(
  options: DistributionCorpusOptions,
): Promise<DistributionCorpus> {
  const note = (line: string): void => options.onProgress?.(line)
  const runs = options.runs ?? MEASURED_RUNS
  if (options.owners.length !== ownerCount(runs)) {
    throw new DistributionCorpusError(
      `${options.owners.length} owners for ${ownerCount(runs)} datasets — one fresh owner each`,
    )
  }

  const pools = distributionPools(runs)
  checkPools(pools)

  const mxePublicKey = await getMXEPublicKey(options.provider, options.program.programId)
  if (mxePublicKey === null) {
    throw new DistributionCorpusError('the MXE has no public key yet — cluster keygen is not done')
  }

  const allowedUses = useTypeBit('populationGenetics')
  const buyerCategories = buyerCategoryBit('academic')
  const tag = options.nonce.toString(16)

  const plans: (DatasetPlan & { pool: string })[] = []
  for (const pool of pools) {
    for (const [index, records] of pool.records.entries()) {
      const owner = options.owners[plans.length]
      const price = pool.pricesPer1k[index]
      if (owner === undefined || price === undefined) {
        throw new DistributionCorpusError(`${pool.name} is missing an owner or a price`)
      }
      plans.push({
        pool: pool.name,
        id: `sc007-${pool.name.slice(5)}-${index}-${tag}`.slice(0, 32),
        owner,
        records,
        pricePer1k: price,
        allowedUses,
        forbiddenUses: 0,
        buyerCategories,
        expiresAt: null,
      })
    }
  }

  note(`encrypting ${plans.length} datasets of ${MIN_CONTRIBUTION} records`)
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

  const corpus: DistributionCorpus = {
    rpc: options.rpc,
    programId: options.program.programId.toBase58(),
    dispatcher: options.dispatcher.publicKey.toBase58(),
    datasets: seeded.map((dataset, index) => ({
      pool: plans[index]?.pool ?? '',
      id: dataset.id,
      address: dataset.address.toBase58(),
      owner: dataset.owner.toBase58(),
      recordCount: dataset.recordCount,
      pricePer1k: (plans[index]?.pricePer1k ?? 0n).toString(10),
    })),
    measured: { buyer: options.buyer.publicKey.toBase58(), runs: [] },
    control: { buyer: options.controlBuyer.publicKey.toBase58(), runs: [] },
  }

  await mkdir(dirname(options.out), { recursive: true })
  const persist = async (): Promise<void> => {
    await writeFile(options.out, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8')
  }
  await persist()

  const plan = [
    ...pools.map((pool, index) => ({
      label: `50 owners, measured run ${index + 1}`,
      pool: pool.name,
      buyer: options.buyer,
      set: corpus.measured,
      settleCommitment: 'confirmed' as Commitment,
    })),
    // The control reuses the first pool: it only has to show that a slow
    // distribution is seen as slow, and its balances already exist — which
    // makes it faster, not slower, than a fresh pool.
    ...(options.control === false
      ? []
      : [
          {
            label: '50 owners, payouts wait for finalized (control)',
            pool: pools[0]?.name ?? '',
            buyer: options.controlBuyer,
            set: corpus.control,
            settleCommitment: 'finalized' as Commitment,
          },
        ]),
  ]

  for (const [index, entry] of plan.entries()) {
    note(`\n[${index + 1}/${plan.length}] "${entry.label}"`)
    const order = await orderRun({
      connection: options.connection,
      program: options.program,
      buyer: entry.buyer,
      mint: options.mint,
      dispatcher: options.dispatcher.publicKey,
      nonce: options.nonce + BigInt(index),
      useType: allowedUses,
      buyerCategory: buyerCategories,
      maxEscrow: options.maxEscrow,
      params: ALL,
      datasets: poolOf(entry.pool),
    })
    note(`  ordered ${order.run.toBase58()} in ${order.elapsedMs} ms`)

    const driven = await drive({
      connection: options.connection,
      program: options.program,
      arcium: options.arcium,
      dispatcher: options.dispatcher,
      run: order.run,
      envelope: async (dataset) => {
        const found = seeded.find((candidate) => candidate.address.equals(dataset))
        if (found === undefined) {
          throw new DistributionCorpusError(`no envelope for ${dataset.toBase58()}`)
        }
        return Uint8Array.from(await readFile(found.envelopePath))
      },
      settleCommitment: entry.settleCommitment,
      ...(options.writeConcurrency === undefined
        ? {}
        : { writeConcurrency: options.writeConcurrency }),
      ...(options.callbackTimeoutMs === undefined
        ? {}
        : { callbackTimeoutMs: options.callbackTimeoutMs }),
    })

    entry.set.runs.push({
      label: entry.label,
      pool: entry.pool,
      run: order.run.toBase58(),
      status: driven.run.status,
      folds: driven.folds,
      driveMs: driven.elapsedMs,
      settleCommitment: entry.settleCommitment,
    })
    await persist()
    note(
      `  ${driven.run.status} · cohort ${driven.run.recordsIncluded} · ` +
        `${driven.folds} folds · ${driven.elapsedMs} ms`,
    )
  }

  return corpus
}
