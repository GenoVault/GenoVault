import { Rng } from './rng.ts'

export interface GenerateOptions {
  /** Скільки записів (осіб) у датасеті. */
  records: number
  /** Скільки біалельних маркерів на особу. */
  markers: number
  /** Скільки з них справді впливають на фенотип. */
  causalMarkers: number
  seed: number
  /** Частота мінорного алеля; за замовчуванням 0.25. */
  minorAlleleFrequency?: number
  /** Внесок однієї копії мінорного алеля в лог-шанси; за замовчуванням 0.8. */
  effectSize?: number
  /** Базова частка уражених за нульового генотипу; за замовчуванням 0.1. */
  baselineRisk?: number
}

export interface GenomicRecord {
  subjectId: string
  /** 0 — жіноча, 1 — чоловіча. Кодування числом, бо рецепти працюють з числами. */
  sex: 0 | 1
  age: number
  /** Кількість копій мінорного алеля: 0, 1 або 2. */
  genotypes: number[]
  affected: 0 | 1
}

export interface DatasetManifest {
  schema: { field: string; type: 'integer' | 'string'; description: string }[]
  recordCount: number
  markerCount: number
  statistics: {
    affectedRate: number
    meanAge: number
    alleleFrequencies: number[]
  }
  /**
   * Справжня відповідь: які маркери насправді впливають на фенотип.
   *
   * Існує виключно для наших перевірок — `SC-002` (звірка якості) і `T041`
   * (матриця згод). У каталозі покупцю не показується ніколи: датасет, до якого
   * додається правильна відповідь, не перевіряє нічого.
   */
  groundTruth: { causalMarkers: number[]; effectSize: number; seed: number }
}

export interface GeneratedDataset {
  manifest: DatasetManifest
  records: GenomicRecord[]
}

const MIN_AGE = 18
const MAX_AGE = 89

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x))
}

export function generateDataset(options: GenerateOptions): GeneratedDataset {
  const {
    records,
    markers,
    causalMarkers,
    seed,
    minorAlleleFrequency = 0.25,
    effectSize = 0.8,
    baselineRisk = 0.1,
  } = options

  if (records <= 0) throw new RangeError('records must be positive')
  if (markers <= 0) throw new RangeError('markers must be positive')
  if (causalMarkers > markers)
    throw new RangeError('there cannot be more causal markers than markers')
  if (minorAlleleFrequency <= 0 || minorAlleleFrequency >= 1) {
    throw new RangeError('the minor allele frequency must be strictly between 0 and 1')
  }
  if (baselineRisk <= 0 || baselineRisk >= 1) {
    throw new RangeError('the baseline risk must be strictly between 0 and 1')
  }

  const rng = new Rng(seed)

  // Причинні маркери беруться з того самого потоку, що й дані, — інакше сід не
  // відтворював би датасет цілком.
  const causal = new Set<number>()
  while (causal.size < causalMarkers) {
    causal.add(rng.int(0, markers - 1))
  }
  const causalMarkerList = [...causal].sort((a, b) => a - b)

  const intercept = Math.log(baselineRisk / (1 - baselineRisk))
  const alleleCounts = new Array<number>(markers).fill(0)
  const generated: GenomicRecord[] = []
  let affectedCount = 0
  let ageSum = 0

  for (let i = 0; i < records; i += 1) {
    const genotypes = new Array<number>(markers)
    for (let m = 0; m < markers; m += 1) {
      // Дві незалежні копії — рівновага Гарді-Вайнберга без структури популяції.
      const copies = rng.bernoulli(minorAlleleFrequency) + rng.bernoulli(minorAlleleFrequency)
      genotypes[m] = copies
      alleleCounts[m] = (alleleCounts[m] ?? 0) + copies
    }

    let logOdds = intercept
    for (const m of causalMarkerList) {
      logOdds += effectSize * (genotypes[m] ?? 0)
    }

    const affected = rng.bernoulli(logistic(logOdds))
    const age = rng.int(MIN_AGE, MAX_AGE)

    affectedCount += affected
    ageSum += age
    generated.push({
      subjectId: `S${String(i + 1).padStart(6, '0')}`,
      sex: rng.bernoulli(0.5),
      age,
      genotypes,
      affected,
    })
  }

  const schema: DatasetManifest['schema'] = [
    { field: 'subjectId', type: 'string', description: 'synthetic subject identifier' },
    { field: 'sex', type: 'integer', description: '0 — female, 1 — male' },
    { field: 'age', type: 'integer', description: 'age in years' },
    { field: 'affected', type: 'integer', description: 'phenotype: 0 — no, 1 — yes' },
    ...Array.from({ length: markers }, (_, m) => ({
      field: `marker_${String(m + 1).padStart(4, '0')}`,
      type: 'integer' as const,
      description: 'minor-allele copies: 0, 1 or 2',
    })),
  ]

  return {
    manifest: {
      schema,
      recordCount: records,
      markerCount: markers,
      statistics: {
        affectedRate: affectedCount / records,
        meanAge: ageSum / records,
        // Частота алеля = копій на особу, поділене на дві копії кожної особи.
        alleleFrequencies: alleleCounts.map((count) => count / (2 * records)),
      },
      groundTruth: { causalMarkers: causalMarkerList, effectSize, seed },
    },
    records: generated,
  }
}

/** Маніфест для каталогу: те саме, але без правильної відповіді. */
export function publicManifest(manifest: DatasetManifest): Omit<DatasetManifest, 'groundTruth'> {
  const { groundTruth: _groundTruth, ...rest } = manifest
  return rest
}
