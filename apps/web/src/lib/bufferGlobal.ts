import { Buffer } from 'buffer'

/**
 * A global `Buffer` for code written for Node (`T066`).
 *
 * Anchor and web3.js in the encryption worker read it, and so does Privy's
 * sign-and-send screen in the page: both failed with `Buffer is not defined`
 * on the first live registration. Imported first in `main.tsx` and in the
 * worker, so it runs before any of them evaluates.
 */
const scope = globalThis as typeof globalThis & { Buffer?: typeof Buffer }
scope.Buffer ??= Buffer
