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
export default defineConfig({
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
