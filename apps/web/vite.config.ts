import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Vite 7, а не 5, як писав `docs/PLAN.md`, і не 8, як прийшов експорт.
 *
 * 7 — та версія, яку вже тягне `vitest@3.2.7`, тож у дереві лишається один
 * Vite, а не два мажори, які по-різному резолвлять плагіни. 8 відпадає
 * жорсткіше: `vite@8.0.8` залежить від `rolldown`, а його нативний бінарник
 * блокує Smart App Control цієї машини — рівно те, через що ми тримаємо
 * Vitest на 3.x.
 */
/**
 * Плагін React на Babel, а не на SWC (`T038`, 2026-09-23).
 *
 * `@vitejs/plugin-react-swc` тягне нативний `@swc/core-win32-x64-msvc`, і з
 * 2026-09-22 Smart App Control цієї машини його блокує
 * (`An Application Control policy has blocked this file`). Падав не окремий
 * крок, а завантаження **цього файла**: ні `vite build`, ні `vite dev`, ні
 * `vitest` в `apps/web` не стартували взагалі. Третій випадок поспіль після
 * Vitest 4 (rolldown) і Vite 8.
 *
 * Вимкнути Smart App Control — не варіант: він не має вибіркового дозволу, а
 * після вимкнення вмикається лише перевстановленням Windows. Babel-версія
 * нативного бінарника не має зовсім, дає той самий Fast Refresh і той самий
 * автоматичний JSX-рантайм, і коштує лише швидкості перетворення. Версія 5.2.0,
 * а не 6.x: шоста вимагає Vite 8, який ми не беремо.
 *
 * CI від цього не залежав і не залежить — на Linux блокування немає.
 */
/**
 * Базовий шлях збірки.
 *
 * На GitHub Pages проект живе не в корені домену, а під ім'ям репозиторію —
 * `https://<owner>.github.io/GenoVault/`, — і кожен `<script src>` у
 * `index.html` мусить це знати, інакше сторінка відкривається порожньою без
 * жодної помилки в консолі. Локально й на власному домені — корінь.
 *
 * Змінна без префікса `VITE_` навмисно: це параметр **збірки**, а не значення,
 * яке має потрапити в бандл. У бандл потрапляє `import.meta.env.BASE_URL`, і
 * саме його читає роутер (`main.tsx`).
 */
const base = process.env.BASE_PATH?.trim() || '/'

export default defineConfig({
  base,
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      // `@arcium-hq/client` imports four names from Node's `crypto`; the
      // dataset cipher calls none of them (`src/lib/nodeCryptoShim.ts`, `T066`).
      // Exact match only: `node:crypto` and `crypto/…` are not ours to replace.
      {
        find: /^crypto$/,
        replacement: fileURLToPath(new URL('./src/lib/nodeCryptoShim.ts', import.meta.url)),
      },
      // The same client imports Anchor's default export, which Anchor's browser
      // build lacks (`packages/crypto/browser/anchor-default.js`).
      { find: /^@anchor-lang\/core$/, replacement: '@genovault/crypto/browser/anchor-default' },
    ],
  },
  server: {
    port: 5173,
  },
  // Pre-bundled at start, not discovered mid-flow: the encryption worker pulls
  // these in on its first run, and a dev server that optimises them then
  // reloads the page in the middle of a registration (`T066`).
  optimizeDeps: {
    include: [
      'buffer',
      '@genovault/crypto > @arcium-hq/client',
      '@genovault/crypto > @solana/web3.js',
      '@genovault/crypto > @anchor-lang/core/dist/browser/index.js',
    ],
  },
})
