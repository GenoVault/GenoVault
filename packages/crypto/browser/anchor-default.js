// `@arcium-hq/client` imports Anchor's default export (`anchor__default.BN`),
// and Anchor's browser build has none — `vite build` of the encryption worker
// stopped on it (`T066`). This module is the browser build plus that default:
// `apps/web/vite.config.ts` points the exact specifier `@anchor-lang/core` here.
// It lives in `packages/crypto` because that package depends on Anchor, so the
// deep path below resolves; `apps/web` does not.
import * as anchor from '@anchor-lang/core/dist/browser/index.js'

export * from '@anchor-lang/core/dist/browser/index.js'
export default anchor
