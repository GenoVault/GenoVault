import { readdir, readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { join, relative, resolve } from 'node:path'

/**
 * Чи переживе кожен наш `.ts` завантаження без транспілятора.
 *
 * `apps/api` запускається як `node --experimental-strip-types src/server.ts` —
 * Node знімає типи, але коду не породжує. Синтаксис, який вимагає породження,
 * валить процес на завантаженні модуля: параметри-властивості
 * (`constructor(readonly x)`), `enum`, `namespace`, декоратори.
 *
 * Ані `tsc`, ані vitest цього не бачать — обидва такий синтаксис розуміють, —
 * тож гейт лишався зеленим при непрацездатному `dev` і `start`. Саме так це
 * одного разу й сталося: `AuthError` мав параметр-властивість, і API не
 * піднімався взагалі, поки не спробували підняти.
 *
 * `node --check` тут не годиться: він перевіряє синтаксис, а не здатність
 * знятися. `stripTypeScriptTypes` робить рівно те, що робить завантажувач, і
 * нічого не виконує.
 */

const SKIP = new Set(['node_modules', 'target', 'build', 'dist', '.anchor', '.git', 'artifacts'])

async function* typescriptFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) yield* typescriptFiles(path)
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) yield path
  }
}

const root = resolve(import.meta.dirname, '..')
const broken = []
let checked = 0

for await (const path of typescriptFiles(root)) {
  checked += 1
  try {
    stripTypeScriptTypes(await readFile(path, 'utf8'), { mode: 'strip' })
  } catch (error) {
    broken.push([relative(root, path), error instanceof Error ? error.message : String(error)])
  }
}

if (broken.length > 0) {
  console.error('strip-types: синтаксис, який не переживе завантаження без транспілятора\n')
  for (const [path, message] of broken) {
    console.error(`  ${path}\n    ${message.split('\n')[0]}\n`)
  }
  process.exit(1)
}

console.log(`strip-types: ✓ ${checked} файлів знімаються без породження коду`)
