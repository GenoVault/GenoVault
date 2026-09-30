/**
 * Puts back a deep link that GitHub Pages bounced through the site's 404 page.
 *
 * Pages has no SPA fallback, and the app lives in `/app/` under a history
 * router, so `/app/runs/<buyer>/<nonce>` is not a file and Pages answers with
 * the site's root `404.html` (`apps/landing/404.html`). That page sends the
 * visitor on to `/app/?p=<path>&q=<query>#<hash>`; this function turns that
 * back into `/app/<path>?<query>#<hash>` so the router sees the address that
 * was asked for.
 *
 * Returns `null` when there is nothing to restore, or when `p` is not a plain
 * absolute path: the result is always inside `basename`, never another origin
 * or a protocol-relative `//host` URL.
 */
export function restoreDeepLink(search: string, hash: string, basename: string): string | null {
  const params = new URLSearchParams(search)
  const path = params.get('p')
  if (path === null || !path.startsWith('/') || path.startsWith('//')) return null

  const query = params.get('q')
  const base = basename === '/' ? '' : basename.replace(/\/+$/, '')
  return `${base}${path}${query ? `?${query}` : ''}${hash}`
}
