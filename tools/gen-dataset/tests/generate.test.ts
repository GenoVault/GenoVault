import { describe, expect, it } from 'vitest'
import { generateDataset, publicManifest } from '../src/generate.ts'
import { Rng } from '../src/rng.ts'

const BASE = { records: 400, markers: 20, causalMarkers: 3, seed: 42 } as const

describe('Rng', () => {
  it('той самий сід дає ту саму послідовність', () => {
    const a = new Rng(7)
    const b = new Rng(7)
    const left = Array.from({ length: 10 }, () => a.next())
    const right = Array.from({ length: 10 }, () => b.next())
    expect(left).toEqual(right)
  })

  it('різні сіди дають різні послідовності', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next())
  })

  it('відхиляє від’ємний і дробовий сід', () => {
    expect(() => new Rng(-1)).toThrow(RangeError)
    expect(() => new Rng(1.5)).toThrow(RangeError)
  })
})

describe('generateDataset', () => {
  it('відтворюється побайтово з того самого сіда', () => {
    // Без цього SC-002 не можна виміряти: порівняння якості на зашифрованих
    // і відкритих даних має сенс лише на однакових даних.
    expect(generateDataset(BASE)).toEqual(generateDataset(BASE))
  })

  it('видає запитану кількість записів і маркерів', () => {
    const { records, manifest } = generateDataset(BASE)
    expect(records).toHaveLength(BASE.records)
    expect(records[0]?.genotypes).toHaveLength(BASE.markers)
    expect(manifest.recordCount).toBe(BASE.records)
  })

  it('генотипи набувають лише значень 0, 1, 2', () => {
    const { records } = generateDataset(BASE)
    const seen = new Set(records.flatMap((record) => record.genotypes))
    expect([...seen].sort()).toEqual([0, 1, 2])
  })

  it('частоти алелів тримаються біля заданої', () => {
    const { manifest } = generateDataset({ ...BASE, records: 4000, minorAlleleFrequency: 0.25 })
    for (const frequency of manifest.statistics.alleleFrequencies) {
      expect(frequency).toBeGreaterThan(0.2)
      expect(frequency).toBeLessThan(0.3)
    }
  })

  it('причинні маркери справді зсувають фенотип, а решта — ні', () => {
    const { manifest, records } = generateDataset({ ...BASE, records: 4000, causalMarkers: 2 })
    const causal = manifest.groundTruth.causalMarkers
    const neutral = [...Array(BASE.markers).keys()].filter((m) => !causal.includes(m))

    const rateByGenotype = (marker: number, copies: number): number => {
      const subset = records.filter((record) => record.genotypes[marker] === copies)
      return subset.filter((record) => record.affected === 1).length / subset.length
    }

    for (const marker of causal) {
      expect(rateByGenotype(marker, 2)).toBeGreaterThan(rateByGenotype(marker, 0) + 0.1)
    }
    for (const marker of neutral) {
      expect(Math.abs(rateByGenotype(marker, 2) - rateByGenotype(marker, 0))).toBeLessThan(0.15)
    }
  })

  it('схема описує кожне поле, включно з маркерами', () => {
    const { manifest } = generateDataset(BASE)
    expect(manifest.schema).toHaveLength(4 + BASE.markers)
    expect(manifest.schema.at(-1)?.field).toBe('marker_0020')
  })

  it('відхиляє несумісні параметри', () => {
    expect(() => generateDataset({ ...BASE, records: 0 })).toThrow(RangeError)
    expect(() => generateDataset({ ...BASE, causalMarkers: 999 })).toThrow(RangeError)
    expect(() => generateDataset({ ...BASE, minorAlleleFrequency: 0 })).toThrow(RangeError)
    expect(() => generateDataset({ ...BASE, baselineRisk: 1 })).toThrow(RangeError)
  })
})

describe('publicManifest', () => {
  it('прибирає правильну відповідь', () => {
    const { manifest } = generateDataset(BASE)
    expect(manifest.groundTruth.causalMarkers.length).toBe(BASE.causalMarkers)
    expect(publicManifest(manifest)).not.toHaveProperty('groundTruth')
  })

  it('лишає статистику, потрібну каталогу', () => {
    const { manifest } = generateDataset(BASE)
    const shown = publicManifest(manifest)
    expect(shown.statistics.alleleFrequencies).toHaveLength(BASE.markers)
    expect(shown.recordCount).toBe(BASE.records)
  })
})
