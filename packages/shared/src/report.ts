import { REPORT_LAYOUT } from './report-layout.generated.ts'

/**
 * The buyer's report of `frequencies` — what `frequencies_reveal` packs
 * into the ciphertexts of `RunResult`.
 *
 * Unpacking only; decryption lives in `packages/crypto` (`decryptReport`),
 * because the cipher is not a dependency `shared` may have.
 *
 * `tools/audit-verify` has its own reader of the same report on purpose: it
 * reads the layout straight from `build/circuits.ts` and depends on nothing of
 * ours. This one reads the generated mirror of that file
 * (`report-layout.generated.ts`), which the gate compares with the compiler
 * output — the browser cannot read `build/`.
 */

export { REPORT_LAYOUT }

export class ReportLayoutError extends Error {
  override readonly name = 'ReportLayoutError'
}

/**
 * Lower edges of the age counters — mirror of `AGE_THRESHOLDS` in
 * `encrypted-ixs`. `ageAtLeast[i]` counts the cohort aged `AGE_THRESHOLDS[i]`
 * or more; a test compares this list with the circuit text.
 */
export const AGE_THRESHOLDS = [20, 30, 40, 50, 60, 70, 80, 90] as const

export interface FrequenciesReport {
  included: number
  /** The cohort was smaller than `MIN_COHORT`: every other number is zero. */
  suppressed: boolean
  male: number
  affected: number
  ageAtLeast: number[]
  /**
   * Σ minor-allele copies over the cohort, per marker. The genotype
   * distribution {0, 1, 2} cannot be recovered from it — `Σg²` was cut from
   * the recipe (`T030`) — so a screen may show the mean dosage, not a split.
   */
  alleleSum: number[]
}

/**
 * How many fields share one field element.
 *
 * Inferred from the number of elements the circuit actually returned, and
 * strictly: if more than one lane count fits, the reader refuses instead of
 * picking one. `createPacker` of `@arcium-hq/client` 0.14.1 does not reproduce
 * this shape (measured on `T030`), which is why it is not used.
 */
function lanesPerElement(fields: number, elements: number, width: number): number {
  const limit = Math.floor(255 / width)
  const candidates: number[] = []
  for (let lanes = 1; lanes <= limit; lanes += 1) {
    if (Math.ceil(fields / lanes) === elements) candidates.push(lanes)
  }
  const only = candidates.at(0)
  if (candidates.length !== 1 || only === undefined) {
    throw new ReportLayoutError(
      `${fields} fields in ${elements} elements: the lane count is not unique ` +
        `(fits: ${candidates.length === 0 ? 'none' : candidates.join(', ')})`,
    )
  }
  return only
}

/** Field elements of a decrypted report → named numbers, by the compiler's layout. */
export function unpackReport(packed: readonly bigint[]): FrequenciesReport {
  const { names, width } = REPORT_LAYOUT
  const lanes = lanesPerElement(names.length, packed.length, width)
  const mask = (1n << BigInt(width)) - 1n

  const values: bigint[] = []
  for (const element of packed) {
    for (let lane = 0; lane < lanes && values.length < names.length; lane += 1) {
      values.push((element >> BigInt(lane * width)) & mask)
    }
  }

  const scalars = new Map<string, number>()
  const vectors = new Map<string, number[]>()
  for (const [index, name] of names.entries()) {
    const value = Number(values[index] ?? 0n)
    // Array fields come as `allele_sum[7]`, exactly as the compiler writes them.
    const slot = /^(.+)\[(\d+)\]$/.exec(name)
    if (slot === null) {
      scalars.set(name, value)
      continue
    }
    const base = slot[1] ?? ''
    const list = vectors.get(base) ?? []
    list[Number(slot[2])] = value
    vectors.set(base, list)
  }

  const scalar = (name: string): number => {
    const value = scalars.get(name)
    if (value === undefined) throw new ReportLayoutError(`the layout has no field ${name}`)
    return value
  }
  const vector = (name: string): number[] => {
    const value = vectors.get(name)
    if (value === undefined) throw new ReportLayoutError(`the layout has no field ${name}`)
    return value
  }

  const ageAtLeast = vector('age_at_least')
  if (ageAtLeast.length !== AGE_THRESHOLDS.length) {
    throw new ReportLayoutError(
      `age_at_least has ${ageAtLeast.length} counters, AGE_THRESHOLDS ${AGE_THRESHOLDS.length}`,
    )
  }

  return {
    included: scalar('included'),
    suppressed: scalar('suppressed') === 1,
    male: scalar('male'),
    affected: scalar('affected'),
    ageAtLeast,
    alleleSum: vector('allele_sum'),
  }
}

export interface AgeBin {
  /** Inclusive; `null` — no lower edge. */
  from: number | null
  /** Exclusive; `null` — no upper edge. */
  to: number | null
  count: number
}

/**
 * Cumulative counters → a histogram. The youngest bin is
 * `included − ageAtLeast[0]`, and bin `[t_i, t_{i+1})` is the difference of
 * two neighbouring counters — the circuit says so next to `AGE_THRESHOLDS`.
 */
export function ageHistogram(report: FrequenciesReport): AgeBin[] {
  const bins: AgeBin[] = []
  const first = report.ageAtLeast[0] ?? 0
  bins.push({ from: null, to: AGE_THRESHOLDS[0], count: report.included - first })
  for (const [index, from] of AGE_THRESHOLDS.entries()) {
    const here = report.ageAtLeast[index] ?? 0
    const next = report.ageAtLeast[index + 1]
    bins.push({
      from,
      to: AGE_THRESHOLDS[index + 1] ?? null,
      count: next === undefined ? here : here - next,
    })
  }
  return bins
}

/** Mean minor-allele dosage per marker over two alleles: Σg / (2 · included). */
export function alleleFrequencies(report: FrequenciesReport): number[] {
  if (report.included === 0) return report.alleleSum.map(() => 0)
  return report.alleleSum.map((sum) => sum / (2 * report.included))
}
