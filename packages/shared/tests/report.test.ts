import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MAX_MARKERS } from '../src/dataset-metadata.ts'
import {
  AGE_THRESHOLDS,
  ageHistogram,
  alleleFrequencies,
  REPORT_LAYOUT,
  ReportLayoutError,
  unpackReport,
} from '../src/report.ts'

const circuit = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../encrypted-ixs/src/lib.rs'),
  'utf8',
)

/** Packs values the way `frequencies_reveal` does: six 32-bit lanes per element. */
function pack(values: readonly number[], lanes = 6): bigint[] {
  const packed: bigint[] = []
  for (let start = 0; start < values.length; start += lanes) {
    let element = 0n
    for (const [lane, value] of values.slice(start, start + lanes).entries()) {
      element |= BigInt(value) << BigInt(lane * REPORT_LAYOUT.width)
    }
    packed.push(element)
  }
  return packed
}

/** A report whose every field is distinct, so a shift by one lands on a wrong number. */
function distinctValues(): number[] {
  return REPORT_LAYOUT.names.map((_name, index) => 1000 + index)
}

describe('report layout', () => {
  it('AGE_THRESHOLDS mirror the circuit', () => {
    const match = /AGE_THRESHOLDS:\s*\[u8;\s*AGE_BINS\]\s*=\s*\[([^\]]*)\]/.exec(circuit)
    expect(match?.[1]?.split(',').map((value) => Number(value.trim()))).toEqual([...AGE_THRESHOLDS])
  })

  it('has the recipe shape: four scalars, the age counters, one sum per marker', () => {
    expect(REPORT_LAYOUT.names.slice(0, 4)).toEqual(['included', 'suppressed', 'male', 'affected'])
    expect(REPORT_LAYOUT.names).toHaveLength(4 + AGE_THRESHOLDS.length + MAX_MARKERS)
  })

  it('packs 76 fields into the 13 elements the circuit returns', () => {
    expect(pack(distinctValues())).toHaveLength(13)
  })
})

describe('unpackReport', () => {
  it('puts every number back on its own field', () => {
    const values = distinctValues()
    const report = unpackReport(pack(values))

    expect(report.included).toBe(1000)
    expect(report.male).toBe(1002)
    expect(report.affected).toBe(1003)
    expect(report.ageAtLeast).toEqual(values.slice(4, 4 + AGE_THRESHOLDS.length))
    expect(report.alleleSum).toEqual(values.slice(4 + AGE_THRESHOLDS.length))
  })

  it('reads the suppression flag', () => {
    const values = REPORT_LAYOUT.names.map(() => 0)
    values[1] = 1
    expect(unpackReport(pack(values)).suppressed).toBe(true)
  })

  it('refuses an element count no lane width explains', () => {
    // 76 fields fit 13 elements only at six lanes; 12 elements fit none.
    expect(() => unpackReport(pack(distinctValues()).slice(0, 12))).toThrow(ReportLayoutError)
  })
})

describe('what the screen derives', () => {
  const report = {
    included: 52,
    suppressed: false,
    male: 30,
    affected: 20,
    ageAtLeast: [52, 52, 52, 40, 25, 9, 0, 0],
    alleleSum: [26, 0, 104],
  }

  it('turns cumulative counters into a histogram that adds up to the cohort', () => {
    const bins = ageHistogram(report)
    expect(bins.map((bin) => bin.count)).toEqual([0, 0, 0, 12, 15, 16, 9, 0, 0])
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(report.included)
    expect(bins.at(0)).toMatchObject({ from: null, to: 20 })
    expect(bins.at(-1)).toMatchObject({ from: 90, to: null })
  })

  it('gives the mean dosage over two alleles', () => {
    expect(alleleFrequencies(report)).toEqual([0.25, 0, 1])
  })
})
