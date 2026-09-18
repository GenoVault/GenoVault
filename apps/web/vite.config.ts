import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react-swc'
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
