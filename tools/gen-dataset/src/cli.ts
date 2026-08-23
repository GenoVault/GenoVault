#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { type GenerateOptions, generateDataset, publicManifest } from './generate.ts'

const { values } = parseArgs({
  options: {
    records: { type: 'string', default: '10000' },
    markers: { type: 'string', default: '50' },
    causal: { type: 'string', default: '5' },
    seed: { type: 'string', default: '1' },
    maf: { type: 'string', default: '0.25' },
    effect: { type: 'string', default: '0.8' },
    out: { type: 'string', default: 'fixtures/generated' },
    name: { type: 'string', default: 'cohort' },
  },
})

function number(raw: string, flag: string): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) throw new RangeError(`--${flag} має бути числом, отримано "${raw}"`)
  return parsed
}

const options: GenerateOptions = {
  records: number(values.records, 'records'),
  markers: number(values.markers, 'markers'),
  causalMarkers: number(values.causal, 'causal'),
  seed: number(values.seed, 'seed'),
  minorAlleleFrequency: number(values.maf, 'maf'),
  effectSize: number(values.effect, 'effect'),
}

const { manifest, records } = generateDataset(options)

const base = join(values.out, values.name)
mkdirSync(dirname(base), { recursive: true })

// NDJSON, а не JSON-масив: датасет на 10 000 записів читається порядково і
// шифрується поблочно, без тримання всього файлу в пам'яті.
const lines = records.map((record) => JSON.stringify(record)).join('\n')
writeFileSync(`${base}.ndjson`, `${lines}\n`, 'utf8')

// Повний маніфест — для наших перевірок, публічний — те, що бачить каталог.
// Правильна відповідь про причинні маркери в каталог не потрапляє ніколи.
writeFileSync(`${base}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
writeFileSync(
  `${base}.public.json`,
  `${JSON.stringify(publicManifest(manifest), null, 2)}\n`,
  'utf8',
)

process.stdout.write(
  [
    `датасет:    ${base}.ndjson`,
    `записів:    ${manifest.recordCount}`,
    `маркерів:   ${manifest.markerCount}`,
    `причинних:  ${manifest.groundTruth.causalMarkers.join(', ')}`,
    `уражених:   ${(manifest.statistics.affectedRate * 100).toFixed(1)}%`,
    `сід:        ${manifest.groundTruth.seed}`,
    '',
  ].join('\n'),
)
