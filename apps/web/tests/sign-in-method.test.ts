import { describe, expect, it } from 'vitest'
import { signInMethodOf } from '../src/lib/privy.ts'

/**
 * The header's "signed in · <method>" after a reload, when Privy restores the
 * session and no `login()` in this tab said which way it went.
 */
describe('signInMethodOf', () => {
  it('names email when the user has an email account', () => {
    expect(signInMethodOf({ email: { address: 'owner@example.org' } })).toBe('email')
  })

  it('names wallet when the user has no email account', () => {
    expect(signInMethodOf({})).toBe('wallet')
    expect(signInMethodOf({ email: null })).toBe('wallet')
  })

  it('names nothing without a user', () => {
    expect(signInMethodOf(null)).toBeNull()
    expect(signInMethodOf(undefined)).toBeNull()
  })
})
