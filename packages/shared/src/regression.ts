import { z } from 'zod'

/**
 * The buyer's half of the "logistic regression" recipe (`T044`, `FR-011`).
 *
 * # Why the model is solved here and not in MPC
 *
 * The circuit (`encrypted-ixs/src/lib.rs`, `regression_*`) accumulates the
 * exact integer moments of the cohort — `n`, `Σy`, `Σx`, `Σxy`, `Σxxᵀ` — and
 * checks the disclosure thresholds inside MPC. Solving the system there was
 * written and measured: Arcis `f64` is fixed point, a multiplication costs
 * ~100 M ACU and a division ~650 M, and ten features come to ~64 G ACU
 * against a ceiling of 5 G per computation. So the reveal hands the moments
 * to the buyer under the buyer's key, and the Newton step runs here — in the
 * buyer's browser, on numbers nobody else can read (decision 2026-10-21).
 *
 * # Rule
 *
 * One Newton step of the logistic log-likelihood from `β = 0`, where every
 * Newton weight is `1/4`:
 *
 * ```text
 * β  = 4 · (Cov(x) + ridge)⁻¹ · Cov(x, y)
 * β₀ = 4 · (ȳ − 1/2) − β · x̄
 * ```
 *
 * with the ridge `RIDGE · Var(xⱼ) + PIVOT_FLOOR` on the diagonal. This is a
 * word-for-word retelling of `solve_moments` in
 * `encrypted-ixs/tests/regression.rs` — the function the `SC-002` measurement
 * runs — and `tests/regression.test.ts` holds both to the same numbers.
 */

/** Feature slots per model, unused ones included — `FEATURES` in the circuit. */
export const REGRESSION_FEATURES = 10

/** Upper triangle of `XᵀX`, row by row — `FEATURE_PAIRS` in the circuit. */
export const REGRESSION_FEATURE_PAIRS = (REGRESSION_FEATURES * (REGRESSION_FEATURES + 1)) / 2

/** Feature codes, as the circuit reads them from `recipe_params`. */
export const FEATURE_SEX = 0
export const FEATURE_AGE = 1
export const FEATURE_MARKER_BASE = 2
export const FEATURE_NONE = 255

/** Records per model parameter before the circuit says anything (`FR-012`). */
export const EVENTS_PER_PARAMETER = 10

/**
 * Ridge as a share of each feature's variance — ridge on standardised
 * features written in raw units. Small on purpose: it keeps duplicated
 * features solvable, it does not regularise the model.
 */
export const RIDGE = 0.001

/**
 * Floor on every pivot. A feature constant in the cohort has zero variance
 * and zero covariance with everything, so the floor makes its coefficient
 * zero instead of dividing by zero.
 */
export const PIVOT_FLOOR = 0.000001

const u32 = z.number().int().min(0).max(0xffff_ffff)

/** The report `regression_reveal` encrypts for the buyer (`Moments`). */
export const regressionMomentsSchema = z.object({
  included: u32,
  cases: u32,
  suppressed: z.union([z.literal(0), z.literal(1)]),
  oversized: z.union([z.literal(0), z.literal(1)]),
  sumX: z.array(u32).length(REGRESSION_FEATURES),
  sumXy: z.array(u32).length(REGRESSION_FEATURES),
  sumXx: z.array(u32).length(REGRESSION_FEATURE_PAIRS),
})
export type RegressionMoments = z.infer<typeof regressionMomentsSchema>

export type RegressionModel =
  | { kind: 'model'; intercept: number; coef: number[] }
  /** The circuit refused: the cohort is too small for the model, or a class is. */
  | { kind: 'suppressed' }
  /** A sum outgrew a `u32` (`Σ age²` past ~107 000 records). */
  | { kind: 'oversized' }

/**
 * Solves the model from the revealed moments.
 *
 * Gaussian elimination without pivoting, in the same order as the reference:
 * the matrix is symmetric positive definite once the ridge and the floor are
 * on the diagonal.
 */
export function solveRegression(moments: RegressionMoments): RegressionModel {
  if (moments.oversized === 1) return { kind: 'oversized' }
  if (moments.suppressed === 1 || moments.included === 0) return { kind: 'suppressed' }

  const d = REGRESSION_FEATURES
  const n = moments.included
  const mean = moments.sumX.map((s) => s / n)
  const yMean = moments.cases / n

  const a: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0))
  const b = new Array<number>(d).fill(0)
  let pair = 0
  for (let j = 0; j < d; j++) {
    b[j] = (moments.sumXy[j] ?? 0) / n - (mean[j] ?? 0) * yMean
    for (let k = j; k < d; k++) {
      const cov = (moments.sumXx[pair] ?? 0) / n - (mean[j] ?? 0) * (mean[k] ?? 0)
      setCell(a, j, k, cov)
      setCell(a, k, j, cov)
      pair++
    }
  }
  for (let j = 0; j < d; j++) {
    setCell(a, j, j, cell(a, j, j) * (1 + RIDGE) + PIVOT_FLOOR)
  }

  for (let p = 0; p < d; p++) {
    for (let i = p + 1; i < d; i++) {
      const factor = cell(a, i, p) / cell(a, p, p)
      for (let j = p; j < d; j++) {
        setCell(a, i, j, cell(a, i, j) - factor * cell(a, p, j))
      }
      b[i] = (b[i] ?? 0) - factor * (b[p] ?? 0)
    }
  }
  const slope = new Array<number>(d).fill(0)
  for (let i = d - 1; i >= 0; i--) {
    let rest = b[i] ?? 0
    for (let j = i + 1; j < d; j++) rest -= cell(a, i, j) * (slope[j] ?? 0)
    slope[i] = rest / cell(a, i, i)
  }

  const coef = slope.map((s) => 4 * s)
  let intercept = 4 * (yMean - 0.5)
  for (let j = 0; j < d; j++) intercept -= (coef[j] ?? 0) * (mean[j] ?? 0)
  return { kind: 'model', intercept, coef }
}

function cell(m: number[][], i: number, j: number): number {
  return m[i]?.[j] ?? 0
}

function setCell(m: number[][], i: number, j: number, value: number): void {
  const row = m[i]
  if (row !== undefined) row[j] = value
}
