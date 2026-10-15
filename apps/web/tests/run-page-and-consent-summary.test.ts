import { describe, expect, it } from 'vitest'
import {
  type ConsentDraft,
  consentDraftSentence,
  EMPTY_CONSENT,
} from '../src/components/ConsentFields.tsx'
import { consentSentence } from '../src/lib/format.ts'
import { mockRunView, runIsSettled } from '../src/lib/runData.ts'
import { RUNS } from '../src/mockData.ts'

/**
 * Two defects from the demo rehearsal of 2026-10-07 (`T078`).
 */
describe('runIsSettled — when the run page stops polling', () => {
  const run = mockRunView(RUNS.running)

  it('keeps polling a run that is accepted or running', () => {
    expect(runIsSettled({ ...run, status: 'accepted', refunded: false })).toBe(false)
    expect(runIsSettled({ ...run, status: 'running', refunded: false })).toBe(false)
  })

  it('stops on a completed or rejected run', () => {
    expect(runIsSettled({ ...run, status: 'completed', refunded: true })).toBe(true)
    expect(runIsSettled({ ...run, status: 'rejected', refunded: false })).toBe(true)
  })

  it('waits for the refund of a failed run, which lands in its own transaction', () => {
    expect(runIsSettled({ ...run, status: 'failed', refunded: false })).toBe(false)
    expect(runIsSettled({ ...run, status: 'failed', refunded: true })).toBe(true)
  })
})

describe('consentDraftSentence — the summary under the consent form', () => {
  const complete: ConsentDraft = {
    allowedUses: ['oncology'],
    forbiddenUses: [],
    buyerCategories: ['academic'],
    noExpiry: false,
    expiresAt: '2027-12-31',
  }

  it('names every missing part of an empty draft, and never says "no one"', () => {
    const sentence = consentDraftSentence(EMPTY_CONSENT)
    expect(sentence).toBe(
      'Not a consent yet: pick an allowed use type, a buyer category and an expiry date or “no expiry” to see what it allows.',
    )
    expect(sentence).not.toContain('no one')
  })

  it('does not call a draft without a date "with no expiry"', () => {
    const sentence = consentDraftSentence({ ...complete, expiresAt: '' })
    expect(sentence).toBe(
      'Not a consent yet: pick an expiry date or “no expiry” to see what it allows.',
    )
    expect(sentence).not.toContain('with no expiry')
  })

  it('names the one part still missing', () => {
    expect(consentDraftSentence({ ...complete, buyerCategories: [] })).toBe(
      'Not a consent yet: pick a buyer category to see what it allows.',
    )
  })

  it('says what a complete draft allows, the same way the dataset card does', () => {
    expect(consentDraftSentence(complete)).toBe(
      'Any academic buyer may run oncology computations on this dataset until 2027-12-31.',
    )
    expect(consentDraftSentence({ ...complete, noExpiry: true, expiresAt: '' })).toContain(
      'with no expiry',
    )
  })
})

describe('consentSentence — a consent that allows nothing', () => {
  it('says so instead of "Any no one buyer…"', () => {
    const sentence = consentSentence({
      allowedUses: [],
      forbiddenUses: [],
      buyerCategories: [],
      expiresAt: null,
      revoked: false,
    })
    expect(sentence).toBe('This consent allows no run, so this dataset cannot enter one.')
  })
})
