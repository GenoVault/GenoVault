#!/usr/bin/env node
// Вендорування IDL програми в `packages/sdk/src/idl/genovault.ts`.
//
//   node scripts/sync-idl.mjs            # переписати з target/types
//   node scripts/sync-idl.mjs --check    # звірити, нічого не пишучи (гейт)
//   node scripts/sync-idl.mjs --from <шлях до genovault.ts>
//
// `target/` тут — симлінк на ext4, тобто з Windows він не читається. Тому
// перепис робиться з WSL (`scripts/wsl-sync-idl.sh`), а `--check` мовчки
// пропускає звірку з `target/`, коли її нізвідки зробити, — але не пропускає
// перевірок, які можливі завжди (див. нижче).

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(REPO, 'packages/sdk/src/idl/genovault.ts')
const LIB_RS = join(REPO, 'programs/genovault/src/lib.rs')
const TYPE_NAME = 'Genovault'

const args = process.argv.slice(2)
const check = args.includes('--check')
const fromFlag = args.indexOf('--from')
const source =
  fromFlag !== -1
    ? resolve(args[fromFlag + 1] ?? '')
    : (process.env.GENOVAULT_IDL_TYPES ?? join(REPO, 'target/types/genovault.ts'))

function die(message) {
  console.error(`sync-idl: ${message}`)
  process.exit(1)
}

/** Перший збалансований `{…}` після позиції `from`. */
function braceBlock(text, from, where) {
  const open = text.indexOf('{', from)
  if (open === -1) die(`не вдалося виділити тіло об'єкта в ${where}`)

  // Рахунок дужок із урахуванням рядків: у docs-коментарях програми дужка
  // трапляється, і наївний `lastIndexOf` різав би текст не там.
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = open; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(open, i + 1)
    }
  }
  die(`тіло об'єкта в ${where} не закривається`)
}

/**
 * Тіло `export type Genovault = { … };` — і воно ж валідний JSON.
 *
 * Саме тому тип і значення можна писати одним текстом. Природний хід — взяти
 * тип з `target/types` і зробити значення конверсією IDL у camelCase — не
 * працює: рантаймовий конвертер Anchor камелкейсить `pda.seeds[].path`, а
 * згенерований тип лишає його в snake_case, і значення перестає присвоюватись
 * власному типу. Один текст розійтися з собою не може.
 */
function extractBody(text, where) {
  const start = text.indexOf(`export type ${TYPE_NAME} = `)
  if (start === -1) die(`у ${where} немає \`export type ${TYPE_NAME}\``)

  const body = braceBlock(text, start, where)
  try {
    JSON.parse(body)
  } catch (error) {
    die(`тіло типу в ${where} не є JSON: ${error.message}`)
  }
  return body
}

function render(body) {
  return `// Згенеровано \`scripts/sync-idl.mjs\` — руками не правити.
//
// Тип і значення — це той самий текст, і розійтися їм нема як. Дві окремі
// форми (тип з \`target/types\`, значення з конверсії IDL) не збігаються:
// \`Program\` камелкейсить \`pda.seeds[].path\`, а згенерований тип лишає його
// в snake_case, і значення перестає присвоюватись власному типу.
//
// Джерело: \`anchor build\` → \`target/types/genovault.ts\`.

export type ${TYPE_NAME} = ${body}

export const IDL: ${TYPE_NAME} = ${body}
`
}

/** Адреса в IDL має збігатися з `declare_id!` — це та перевірка, що можлива завжди. */
function declaredId() {
  const match = /declare_id!\("([1-9A-HJ-NP-Za-km-z]{32,44})"\)/.exec(readFileSync(LIB_RS, 'utf8'))
  if (!match) die('у lib.rs не знайдено declare_id!')
  return match[1]
}

// ── Перевірки, які не залежать від доступності target/ ────────────────────────

if (check) {
  if (!existsSync(OUT)) die(`немає ${OUT} — запусти scripts/wsl-sync-idl.sh`)

  const vendored = readFileSync(OUT, 'utf8')
  const typeBody = extractBody(vendored, 'вендорений IDL')

  const constAt = vendored.indexOf(`export const IDL: ${TYPE_NAME} = `)
  if (constAt === -1) die('у вендореному IDL немає `export const IDL`')
  const constBody = braceBlock(vendored, constAt, 'вендорений IDL (значення)')

  // Тип і значення мають бути одним текстом. Якщо їх колись правили руками —
  // саме тут це видно, і саме тут воно ще нікому не встигло збрехати.
  if (typeBody !== constBody) die('тип і значення у вендореному IDL розійшлися')

  const parsed = JSON.parse(typeBody)
  const expected = declaredId()
  if (parsed.address !== expected) {
    die(`адреса в IDL (${parsed.address}) не збігається з declare_id! (${expected})`)
  }
}

// ── Звірка з target/, коли він доступний ──────────────────────────────────────

if (!existsSync(source)) {
  if (!check) die(`немає ${source} — спершу \`anchor build\` (scripts/wsl-build.sh)`)
  console.log(`sync-idl: ✓ вендорений IDL цілий; ${source} недоступний, звірку пропущено`)
  process.exit(0)
}

const rendered = render(extractBody(readFileSync(source, 'utf8'), source))

if (check) {
  if (readFileSync(OUT, 'utf8') !== rendered) {
    die('вендорений IDL відстав від target/types — запусти scripts/wsl-sync-idl.sh')
  }
  console.log('sync-idl: ✓ вендорений IDL збігається з target/types')
  process.exit(0)
}

mkdirSync(dirname(OUT), { recursive: true })
// LF навмисно: цей файл читає і Windows, і WSL, а гейт порівнює його побайтово.
writeFileSync(OUT, rendered.replace(/\r\n/g, '\n'), 'utf8')
console.log(`sync-idl: записано ${OUT}`)
