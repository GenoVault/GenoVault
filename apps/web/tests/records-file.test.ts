import { MIN_COHORT } from '@genovault/shared'
import { describe, expect, it } from 'vitest'
import { parseRecordsFile, RecordsFileError } from '../src/lib/recordsFile.ts'

const line = (sex: 0 | 1, age: number, affected: 0 | 1, genotypes: number[], id?: string) =>
  JSON.stringify({ ...(id === undefined ? {} : { subjectId: id }), sex, age, genotypes, affected })

/** Twelve records, two markers, with stats a person can check by hand. */
const TWELVE = Array.from({ length: 12 }, (_, i) =>
  line((i % 2) as 0 | 1, 40 + i, (i < 3 ? 1 : 0) as 0 | 1, [i % 3, 2], `S${i}`),
).join('\n')

describe('records file (T066)', () => {
  it('reads NDJSON as the generator writes it, subjectId and all', () => {
    const file = parseRecordsFile(`${TWELVE}\n`)
    expect(file.records).toHaveLength(12)
    expect(file.markerCount).toBe(2)
    expect(file.records[0]).toEqual({ sex: 0, age: 40, affected: 1, genotypes: [0, 2] })
  })

  it('drops subjectId — it is not encrypted, so it is not in the schema either', () => {
    const file = parseRecordsFile(TWELVE)
    expect(Object.keys(file.records[0] ?? {})).not.toContain('subjectId')
    expect(file.schema.map((field) => field.field)).toEqual([
      'sex',
      'age',
      'affected',
      'marker_0001',
      'marker_0002',
    ])
  })

  it('computes the generator’s three aggregates from the same file', () => {
    const stats = parseRecordsFile(TWELVE).statistics
    expect(stats?.affectedRate).toBeCloseTo(3 / 12, 12)
    expect(stats?.meanAge).toBeCloseTo((40 + 51) / 2, 12)
    // Marker 1: copies 0,1,2 repeating → 12 copies over 24 alleles; marker 2: all 2.
    expect(stats?.alleleFrequencies).toEqual([12 / 24, 1])
  })

  it('gives no statistics below MIN_COHORT — they would describe a person', () => {
    const few = TWELVE.split('\n')
      .slice(0, MIN_COHORT - 1)
      .join('\n')
    expect(parseRecordsFile(few).statistics).toBeNull()
  })

  it('names the line of the first bad record', () => {
    const bad = `${line(0, 40, 0, [0, 1])}\n${line(1, 41, 0, [0, 3])}`
    expect(() => parseRecordsFile(bad)).toThrow(RecordsFileError)
    expect(() => parseRecordsFile(bad)).toThrow(/^line 2: genotypes\.1/)
    expect(() => parseRecordsFile(`${line(0, 40, 0, [0, 1])}\n{oops`)).toThrow(
      /^line 2: not a JSON/,
    )
  })

  it('refuses a record with a different number of markers', () => {
    const ragged = `${line(0, 40, 0, [0, 1])}\n${line(1, 41, 0, [0, 1, 2])}`
    expect(() => parseRecordsFile(ragged)).toThrow(/line 2: 3 markers where the first record had 2/)
  })

  it('refuses fields the format does not have, and an empty file', () => {
    expect(() =>
      parseRecordsFile(JSON.stringify({ sex: 0, age: 1, affected: 0, genotypes: [0], name: 'x' })),
    ).toThrow(/line 1/)
    expect(() => parseRecordsFile('\n\n')).toThrow(/no records/)
  })
})
