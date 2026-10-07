import type { DatasetField, DatasetStatistics } from '@genovault/shared'
import { MAX_MARKERS, MIN_COHORT } from '@genovault/shared'
import { z } from 'zod'

/**
 * The owner's records file, read in the browser (`T066`).
 *
 * NDJSON, one record per line — exactly what `tools/gen-dataset` writes
 * (decision 2026-10-07). Nothing here leaves the tab: the records go
 * into the encryption worker, and what goes to the API is the shape and three
 * aggregates computed below, from the very file that gets encrypted.
 *
 * `subjectId` is accepted and dropped. It is a pseudonymous key that helps the
 * owner find a row in their own file; the envelope carries no such field, and
 * nothing the platform computes needs one.
 */

/** One plaintext record as the encryption takes it (`@genovault/crypto`). */
export interface PlainRecord {
  sex: 0 | 1
  age: number
  affected: 0 | 1
  genotypes: number[]
}

const lineSchema = z.strictObject({
  subjectId: z.string().max(64).optional(),
  sex: z.union([z.literal(0), z.literal(1)]),
  age: z.number().int().min(0).max(130),
  affected: z.union([z.literal(0), z.literal(1)]),
  genotypes: z.array(z.number().int().min(0).max(2)).min(1).max(MAX_MARKERS),
})

export class RecordsFileError extends Error {
  override readonly name = 'RecordsFileError'
  /** 1-based line of the file, so the owner can open it there. */
  readonly line: number | null

  constructor(message: string, line: number | null = null) {
    super(line === null ? message : `line ${line}: ${message}`)
    this.line = line
  }
}

export interface RecordsFile {
  records: PlainRecord[]
  markerCount: number
  schema: DatasetField[]
  /**
   * `null` below `MIN_COHORT`: an aggregate over fewer records describes a
   * person, and the catalog does not take one (`datasetMetadataSchema`).
   */
  statistics: DatasetStatistics | null
}

export function parseRecordsFile(text: string): RecordsFile {
  const records: PlainRecord[] = []
  let markerCount: number | null = null

  const lines = text.split(/\r?\n/)
  for (const [index, raw] of lines.entries()) {
    if (raw.trim() === '') continue
    const lineNumber = index + 1

    let value: unknown
    try {
      value = JSON.parse(raw)
    } catch {
      throw new RecordsFileError('not a JSON object', lineNumber)
    }
    const parsed = lineSchema.safeParse(value)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const where =
        issue === undefined || issue.path.length === 0 ? '' : `${issue.path.join('.')}: `
      throw new RecordsFileError(`${where}${issue?.message ?? 'invalid record'}`, lineNumber)
    }

    const { sex, age, affected, genotypes } = parsed.data
    if (markerCount === null) markerCount = genotypes.length
    else if (genotypes.length !== markerCount) {
      throw new RecordsFileError(
        `${genotypes.length} markers where the first record had ${markerCount}`,
        lineNumber,
      )
    }
    records.push({ sex, age, affected, genotypes })
  }

  if (markerCount === null) throw new RecordsFileError('the file has no records')

  return {
    records,
    markerCount,
    schema: schemaFor(markerCount),
    statistics: records.length < MIN_COHORT ? null : summarize(records, markerCount),
  }
}

/**
 * The same three aggregates and the same formulas as `tools/gen-dataset`:
 * affected share, mean age, and per marker the minor-allele copies over two
 * copies per person.
 */
export function summarize(records: readonly PlainRecord[], markerCount: number): DatasetStatistics {
  const copies = new Array<number>(markerCount).fill(0)
  let affected = 0
  let ageSum = 0
  for (const record of records) {
    affected += record.affected
    ageSum += record.age
    record.genotypes.forEach((value, marker) => {
      copies[marker] = (copies[marker] ?? 0) + value
    })
  }
  return {
    affectedRate: affected / records.length,
    meanAge: ageSum / records.length,
    alleleFrequencies: copies.map((count) => count / (2 * records.length)),
  }
}

/**
 * The fields of the envelope, named as the generator names them.
 *
 * No `subjectId`: the schema describes what is encrypted, and that key is not
 * — listing it would promise the buyer a field no computation can read.
 */
export function schemaFor(markerCount: number): DatasetField[] {
  return [
    { field: 'sex', type: 'integer', description: '0 — female, 1 — male' },
    { field: 'age', type: 'integer', description: 'Age in years at collection' },
    { field: 'affected', type: 'integer', description: 'Phenotype: 0 — unaffected, 1 — affected' },
    ...Array.from({ length: markerCount }, (_, m) => ({
      field: `marker_${String(m + 1).padStart(4, '0')}`,
      type: 'integer' as const,
      description: 'Minor-allele copies: 0, 1 or 2',
    })),
  ]
}
