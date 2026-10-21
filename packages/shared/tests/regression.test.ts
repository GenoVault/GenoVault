import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  EVENTS_PER_PARAMETER,
  FEATURE_AGE,
  FEATURE_MARKER_BASE,
  FEATURE_NONE,
  FEATURE_SEX,
  PIVOT_FLOOR,
  REGRESSION_FEATURE_PAIRS,
  REGRESSION_FEATURES,
  type RegressionMoments,
  RIDGE,
  regressionMomentsSchema,
  solveRegression,
} from '../src/regression.ts'

/**
 * The buyer's solve has to give the numbers the `SC-002` measurement was
 * taken on — `solve_moments` in `encrypted-ixs/tests/regression.rs`. The
 * fixture below is that function's input and output, printed by the Rust
 * test; the constants are read from the circuit and the Rust test, so a
 * change on either side breaks this file.
 */

const here = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(here, '../../..', path), 'utf8')

/** Moments with only the first slots in use: `pairs[j][k]` for `j ≤ k`. */
function moments(
  included: number,
  cases: number,
  sumX: number[],
  sumXy: number[],
  pairs: number[][],
): RegressionMoments {
  const sumXx: number[] = []
  for (let j = 0; j < REGRESSION_FEATURES; j++) {
    for (let k = j; k < REGRESSION_FEATURES; k++) sumXx.push(pairs[j]?.[k] ?? 0)
  }
  const pad = (xs: number[]) => [...xs, ...new Array(REGRESSION_FEATURES - xs.length).fill(0)]
  return regressionMomentsSchema.parse({
    included,
    cases,
    suppressed: 0,
    oversized: 0,
    sumX: pad(sumX),
    sumXy: pad(sumXy),
    sumXx,
  })
}

describe('constants mirror the circuit', () => {
  const circuit = read('encrypted-ixs/src/lib.rs')
  const reference = read('encrypted-ixs/tests/regression.rs')
  const constant = (source: string, name: string): string => {
    const match = new RegExp(`const ${name}: [\\w0-9]+ = ([^;]+);`).exec(source)
    if (match?.[1] === undefined) throw new Error(`${name} not found`)
    return match[1].trim()
  }

  it('feature slots and codes', () => {
    expect(Number(constant(circuit, 'FEATURES'))).toBe(REGRESSION_FEATURES)
    expect(Number(constant(circuit, 'FEATURE_SEX'))).toBe(FEATURE_SEX)
    expect(Number(constant(circuit, 'FEATURE_AGE'))).toBe(FEATURE_AGE)
    expect(Number(constant(circuit, 'FEATURE_MARKER_BASE'))).toBe(FEATURE_MARKER_BASE)
    expect(Number(constant(circuit, 'FEATURE_NONE'))).toBe(FEATURE_NONE)
    expect(Number(constant(circuit, 'EVENTS_PER_PARAMETER'))).toBe(EVENTS_PER_PARAMETER)
    expect(REGRESSION_FEATURE_PAIRS).toBe(55)
  })

  it('ridge and pivot floor of the reference solve', () => {
    expect(Number(constant(reference, 'RIDGE'))).toBe(RIDGE)
    expect(Number(constant(reference, 'PIVOT_FLOOR'))).toBe(PIVOT_FLOOR)
  })
})

describe('solveRegression', () => {
  it('one feature has the closed form', () => {
    // x ∈ {0, 1, 2}, 60 records: 20 of each; cases 5 / 10 / 15.
    const m = moments(60, 30, [60], [10 + 2 * 15], [[20 + 4 * 20]])
    const model = solveRegression(m)
    expect(model.kind).toBe('model')
    if (model.kind !== 'model') return
    const mean = 1
    const variance = 100 / 60 - mean * mean
    const cov = 40 / 60 - mean * 0.5
    const beta = (4 * cov) / (variance * (1 + RIDGE) + PIVOT_FLOOR)
    expect(model.coef[0]).toBeCloseTo(beta, 12)
    expect(model.intercept).toBeCloseTo(4 * (0.5 - 0.5) - beta * mean, 12)
    expect(model.coef.slice(1).every((b) => b === 0)).toBe(true)
  })

  it('a constant feature gets zero, not a division by zero', () => {
    // Slot 0 is `sex` under a sex filter: every record has 1.
    const m = moments(
      40,
      20,
      [40, 30],
      [20, 20],
      [
        [40, 30],
        [0, 50],
      ],
    )
    const model = solveRegression(m)
    if (model.kind !== 'model') throw new Error(model.kind)
    expect(Math.abs(model.coef[0] ?? Number.NaN)).toBeLessThan(1e-6)
    expect(model.coef.every(Number.isFinite)).toBe(true)
  })

  it('names a refusal instead of solving it', () => {
    const base = moments(40, 20, [40], [20], [[40]])
    expect(solveRegression({ ...base, suppressed: 1 })).toEqual({ kind: 'suppressed' })
    expect(solveRegression({ ...base, oversized: 1 })).toEqual({ kind: 'oversized' })
  })

  it('the schema refuses a report of the wrong shape', () => {
    const base = moments(40, 20, [40], [20], [[40]])
    expect(regressionMomentsSchema.safeParse({ ...base, sumXx: base.sumXx.slice(1) }).success).toBe(
      false,
    )
    expect(regressionMomentsSchema.safeParse({ ...base, cases: -1 }).success).toBe(false)
  })
})

describe('the fixture of the reference solve', () => {
  // `fixture_moments()` and `FIXTURE_*` in `encrypted-ixs/tests/regression.rs`:
  // 300 synthetic records over sex, age and eight markers. The Rust side
  // asserts the same numbers, so the two solves agree on this input.
  const fixture = regressionMomentsSchema.parse({
    included: 300,
    cases: 88,
    suppressed: 0,
    oversized: 0,
    sumX: [145, 15338, 191, 195, 196, 168, 185, 171, 183, 187],
    sumXy: [48, 4992, 72, 39, 69, 55, 50, 50, 64, 58],
    sumXx: [
      145, 7364, 85, 87, 103, 77, 92, 75, 97, 83, 880344, 10061, 10320, 10012, 8833, 9679, 8686,
      9693, 9779, 249, 134, 128, 118, 120, 106, 117, 119, 261, 126, 138, 110, 111, 127, 116, 268,
      114, 115, 117, 119, 113, 214, 91, 92, 111, 111, 239, 94, 94, 118, 229, 99, 111, 235, 108, 243,
    ],
  })
  const intercept = -2.2898729545907717
  const coef = [
    0.2519753086552152, 0.020319498981722233, 0.4968673813503957, -0.688992477270575,
    0.28814591569473413, 0.22774299961009872, -0.16579675084950238, 0.01745507768515699,
    0.2690434585960987, 0.07450298801952789,
  ]

  it('solves to the model the Rust reference recorded', () => {
    const model = solveRegression(fixture)
    if (model.kind !== 'model') throw new Error(model.kind)
    expect(Math.abs(model.intercept - intercept)).toBeLessThan(1e-12)
    model.coef.forEach((b, j) => {
      expect(Math.abs(b - (coef[j] ?? Number.NaN))).toBeLessThan(1e-12)
    })
  })

  it('the Rust file carries the same numbers', () => {
    const rust = read('encrypted-ixs/tests/regression.rs')
    expect(rust).toContain(`const FIXTURE_INTERCEPT: f64 = ${intercept};`)
    for (const b of coef) expect(rust).toContain(`${b},`)
    expect(rust).toContain('included: 300,')
    expect(rust).toContain('cases: 88,')
  })
})
