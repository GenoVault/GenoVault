import { describe, expect, it } from 'vitest'
import { restoreDeepLink } from '../src/lib/deepLink.ts'

/**
 * The round trip through the site's 404 page (T071).
 *
 * `apps/landing/404.html` encodes `/app/<path>?<query>#<hash>` as
 * `/app/?p=/<path>&q=<query>#<hash>`. These cases mirror exactly what that
 * script produces, so a change on either side that breaks the pair fails here.
 */
describe('restoreDeepLink', () => {
  const base = '/GenoVault/app'

  it('restores a nested route under the base path', () => {
    const search = `?p=${encodeURIComponent('/runs/Buyer111/7')}`
    expect(restoreDeepLink(search, '', base)).toBe('/GenoVault/app/runs/Buyer111/7')
  })

  it('carries the original query and hash', () => {
    const search = `?p=${encodeURIComponent('/datasets')}&q=${encodeURIComponent('min=100&provenance=clinic')}`
    expect(restoreDeepLink(search, '#top', base)).toBe(
      '/GenoVault/app/datasets?min=100&provenance=clinic#top',
    )
  })

  it('accepts a base path with a trailing slash, as Vite reports it', () => {
    const search = `?p=${encodeURIComponent('/balance')}`
    expect(restoreDeepLink(search, '', '/GenoVault/app/')).toBe('/GenoVault/app/balance')
  })

  it('works at the root of a custom domain', () => {
    expect(restoreDeepLink('?p=%2Fbalance', '', '/')).toBe('/balance')
  })

  it('does nothing on an ordinary visit', () => {
    expect(restoreDeepLink('', '', base)).toBeNull()
    expect(restoreDeepLink('?min=100', '', base)).toBeNull()
  })

  it('refuses anything that is not a plain absolute path', () => {
    expect(restoreDeepLink('?p=%2F%2Fevil.example%2Fx', '', base)).toBeNull()
    expect(restoreDeepLink('?p=https%3A%2F%2Fevil.example', '', base)).toBeNull()
    expect(restoreDeepLink('?p=runs', '', base)).toBeNull()
  })
})
