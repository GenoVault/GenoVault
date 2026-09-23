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
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
})
