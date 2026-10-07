import { describe, expect, it } from 'vitest'
import { setConsentRequestSchema } from '../src/owner.ts'

const VALID = {
  allowedUses: ['cardiology', 'populationGenetics'],
  forbiddenUses: ['pharmaCommercial'],
  buyerCategories: ['academic', 'nonProfit'],
  expiresAt: '1893456000',
}

function issuePaths(input: unknown): string[] {
  const result = setConsentRequestSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('setConsentRequestSchema', () => {
  it('accepts consent terms by name', () => {
    expect(setConsentRequestSchema.parse(VALID)).toEqual(VALID)
  })

  it('accepts a consent without expiry', () => {
    expect(issuePaths({ ...VALID, expiresAt: null })).toEqual([])
  })

  it('refuses a name outside the dictionary, naming the field', () => {
    // The reason names exist at all: a wrong bit fails nowhere, a wrong name
    // fails here.
    expect(issuePaths({ ...VALID, allowedUses: ['cardiology', 'marketing'] })).toEqual([
      'allowedUses.1',
    ])
    expect(issuePaths({ ...VALID, buyerCategories: ['insurer'] })).toEqual(['buyerCategories.0'])
  })

  it('refuses bit masks — the wire carries names only', () => {
    expect(issuePaths({ ...VALID, allowedUses: 6 })).toContain('allowedUses')
  })

  it('refuses a consent that allows nothing, like `ConsentAllowsNothing`', () => {
    expect(issuePaths({ ...VALID, allowedUses: [] })).toEqual(['allowedUses'])
    expect(issuePaths({ ...VALID, buyerCategories: [] })).toEqual(['buyerCategories'])
    expect(
      issuePaths({
        ...VALID,
        allowedUses: ['oncology'],
        forbiddenUses: ['oncology', 'cardiology'],
      }),
    ).toEqual(['forbiddenUses'])
  })

  it('lets a forbidden use stand outside the allowed ones, as the program does', () => {
    expect(
      issuePaths({ ...VALID, allowedUses: ['oncology'], forbiddenUses: ['pharmaCommercial'] }),
    ).toEqual([])
  })

  it('refuses a repeated name', () => {
    expect(issuePaths({ ...VALID, buyerCategories: ['academic', 'academic'] })).toEqual([
      'buyerCategories',
    ])
  })

  it('keeps expiry inside i64 and above zero', () => {
    expect(issuePaths({ ...VALID, expiresAt: '0' })).toEqual(['expiresAt'])
    expect(issuePaths({ ...VALID, expiresAt: '9223372036854775807' })).toEqual([])
    expect(issuePaths({ ...VALID, expiresAt: '9223372036854775808' })).toEqual(['expiresAt'])
    expect(issuePaths({ ...VALID, expiresAt: 1893456000 })).toEqual(['expiresAt'])
  })

  it('carries neither owner nor version — both come from the session and the chain', () => {
    expect(issuePaths({ ...VALID, owner: '11111111111111111111111111111111' })).toEqual([''])
    expect(issuePaths({ ...VALID, currentVersion: 1 })).toEqual([''])
  })

  it('does not throw on a body that is not an object', () => {
    // Zod 4 runs the refinement after a failed field; a throw here would turn
    // a 400 into a 500.
    for (const input of [null, 'x', [], { allowedUses: 'oncology' }, { expiresAt: '12' }]) {
      expect(() => setConsentRequestSchema.safeParse(input)).not.toThrow()
      expect(setConsentRequestSchema.safeParse(input).success).toBe(false)
    }
  })
})
