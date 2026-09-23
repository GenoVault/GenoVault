#!/usr/bin/env node
// Дзеркало таблиці помилок програми для `packages/shared` (`T038`, `FR-008`).
//
//   node scripts/sync-program-errors.mjs          # переписати з вендореного IDL
//   node scripts/sync-program-errors.mjs --check  # звірити, нічого не пишучи (гейт)
//
// Чому дзеркало, а не читання IDL там, де воно потрібне: назвати порушене
// обмеження мусить браузер, а `apps/web` навмисно не залежить від
// `packages/sdk` — той тягне `@anchor-lang/core` і `@solana/web3.js`, і заради
// таблиці на 65 рядків у бандл поїхав би IDL на 12 тисяч рядків при бюджеті
// `SC-011` у дві секунди.
//
// Джерело — вендорений IDL, а не `target/`, і це навмисно: звірка тоді не
// залежить від WSL і робиться в кожному гейті. Сам вендорений IDL звіряється з
// `target/types` окремо (`scripts/sync-idl.mjs`), тож ланцюг «програма → IDL →
// таблиця» замкнений з обох боків.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const IDL_MODULE = join(REPO, 'packages/sdk/src/idl/genovault.ts')
const OUT = join(REPO, 'packages/shared/src/program-errors.generated.ts')

const check = process.argv.slice(2).includes('--check')

function die(message) {
  console.error(`sync-program-errors: ${message}`)
  process.exit(1)
}

const { IDL } = await import(`file://${IDL_MODULE.replaceAll('\\', '/')}`)

if (!Array.isArray(IDL.errors) || IDL.errors.length === 0) die('в IDL немає таблиці помилок')

// Одинарні лапки — стиль `biome.json`; перевіряємо, що в тексті програми їх
// немає, бо екранування зробило б згенерований файл несхожим на відформатований
// і `--check` червонів би після кожного `biome format`.
for (const entry of IDL.errors) {
  if (/['\\]/.test(entry.msg) || /['\\]/.test(entry.name)) {
    die(`апостроф або бекслеш у «${entry.name}» — генератор такого не вміє екранувати`)
  }
}

const entries = IDL.errors
  .map(
    (entry) => `  {
    code: ${entry.code},
    name: '${entry.name}',
    msg: '${entry.msg}',
  },`,
  )
  .join('\n')

const rendered = `// Згенеровано \`scripts/sync-program-errors.mjs\` — руками не правити.
//
// Таблиця помилок програми: код, ім'я варіанта, повідомлення \`#[msg]\`. Одне
// джерело — вендорений IDL (\`packages/sdk/src/idl/genovault.ts\`), звірка в
// гейті (\`pnpm errors:check\`).
//
// \`as const\` тут несе роботу: з нього \`ProgramErrorName\` стає об'єднанням
// літералів, і словник порушених обмежень у \`program-errors.ts\` перестає
// компілюватись, щойно варіант перейменували або прибрали в програмі.

/** Адреса програми — та сама, що в IDL і в \`declare_id!\`. */
export const PROGRAM_ADDRESS = '${IDL.address}'

export const PROGRAM_ERRORS = [
${entries}
] as const
`

const shown = relative(REPO, OUT)

if (check) {
  let current
  try {
    current = readFileSync(OUT, 'utf8')
  } catch {
    die(`немає ${shown} — запусти node scripts/sync-program-errors.mjs`)
  }
  if (current !== rendered) {
    die(`${shown} відстав від IDL — запусти node scripts/sync-program-errors.mjs`)
  }
  console.log(`sync-program-errors: ✓ ${shown} збігається з IDL (${IDL.errors.length} помилок)`)
  process.exit(0)
}

// LF навмисно: файл читають і Windows, і WSL, а `--check` порівнює побайтово.
writeFileSync(OUT, rendered.replaceAll('\r\n', '\n'), 'utf8')
console.log(`sync-program-errors: записано ${shown} (${IDL.errors.length} помилок)`)
