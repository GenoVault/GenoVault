#!/usr/bin/env node
/**
 * Незалежний звіряч прогону (`T030`, `T031`, `FR-025`).
 *
 * ```bash
 * # шлях покупця і ланцюжок відбитків одного прогону
 * node --experimental-strip-types tools/audit-verify/src/cli.ts e2e-buyer \
 *   --report artifacts/e2e/run.json
 *
 * # «розшифрування не було» на корпусі прогонів (`SC-001`)
 * node --experimental-strip-types tools/audit-verify/src/cli.ts no-plaintext \
 *   --corpus artifacts/no-plaintext/corpus.json
 * ```
 *
 * Звіт драйвера тут — джерело **адрес**, і тільки їх: прогін, сховище, ключ
 * покупця. Жодне твердження драйвера про час чи результат сюди не потрапляє;
 * усе інше звіряч читає з мережі й зі сховища сам. Виняток один і він названий:
 * відкриті записи канаркового датасету, які власник знає про себе, — без них
 * шукати відкритий запис не було б чим.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Connection, PublicKey } from '@solana/web3.js'
import type { Audit } from './e2e-buyer.ts'
import { auditBuyerPath, fetchMxePublicKey } from './e2e-buyer.ts'
import { hex } from './fold-chain.ts'
import type { PlainRecord, RunSweep } from './no-plaintext.ts'
import { auditNoPlaintext, recordNeedles, sweepProgramAccounts } from './no-plaintext.ts'
import { loadReportLayout } from './report.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    report: { type: 'string' },
    corpus: { type: 'string' },
    rpc: { type: 'string' },
    run: { type: 'string' },
    program: { type: 'string' },
    storage: { type: 'string' },
    'report-key': { type: 'string' },
    circuits: { type: 'string', default: 'build/circuits.ts' },
    /** Бюджет `SC-010` у секундах. Задається, а не зашивається: критерій живе в SPEC. */
    budget: { type: 'string', default: '180' },
  },
})

interface DriverReport {
  rpc: string
  programId: string
  run: string
  storageDir: string
  reportSecretKey: string
}

function log(line: string): void {
  process.stdout.write(`${line}\n`)
}

function fromHex(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error('ключ звіту має бути шістнадцятковим рядком парної довжини')
  }
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16))
}

async function settings(): Promise<{
  rpc: string
  programId: string
  run: string
  storageDir: string
  secretKey: Uint8Array
}> {
  if (values.report !== undefined) {
    const raw: unknown = JSON.parse(await readFile(resolve(values.report), 'utf8'))
    const report = raw as DriverReport
    return {
      rpc: values.rpc ?? report.rpc,
      programId: values.program ?? report.programId,
      run: values.run ?? report.run,
      storageDir: values.storage ?? report.storageDir,
      secretKey: fromHex(values['report-key'] ?? report.reportSecretKey),
    }
  }

  const missing = (['rpc', 'run', 'program', 'storage', 'report-key'] as const).filter(
    (name) => values[name] === undefined,
  )
  if (missing.length > 0) {
    throw new Error(`без --report потрібні всі: --${missing.join(', --')}`)
  }
  return {
    rpc: values.rpc ?? '',
    programId: values.program ?? '',
    run: values.run ?? '',
    storageDir: values.storage ?? '',
    secretKey: fromHex(values['report-key'] ?? ''),
  }
}

/** Друкує вердикт так, щоб його можна було прочитати вголос на показі. */
function print(audit: Audit, budgetSeconds: number): void {
  const { timings, chain, report, run } = audit

  log('')
  log('── шлях покупця ─────────────────────────────────────────')
  for (const step of timings.steps) {
    log(`  ${step.step.padEnd(28)} ${step.ms.toString().padStart(7)} мс`)
  }
  const activeSeconds = timings.activeMs / 1000
  log(`  ${'активний час покупця'.padEnd(28)} ${activeSeconds.toFixed(1).padStart(7)} с`)
  log(
    `  SC-010: бюджет ${budgetSeconds} с — ${activeSeconds <= budgetSeconds ? 'вкладається' : 'НЕ вкладається'}`,
  )
  log('')
  log(
    timings.wallClockSeconds === null
      ? '  wall-clock до звіту: RPC не віддав часу блоку'
      : `  wall-clock від замовлення до звіту: ${timings.wallClockSeconds} с ` +
          `(демо-пул ${run.datasets.length} датасетів, ${run.foldedBatches} згорток)`,
  )

  log('')
  log('── ланцюжок відбитків ───────────────────────────────────')
  log(`  згорток: ланцюг ${chain.actualFolds}, перерахунок ${chain.expectedFolds}`)
  log(`  ланцюг:      ${hex(chain.onChain)}`)
  log(`  перерахунок: ${hex(chain.computed)}`)
  log(`  ${chain.matches ? 'зійшлося' : 'НЕ ЗІЙШЛОСЯ'}`)

  log('')
  log('── звіт покупця ─────────────────────────────────────────')
  log(`  когорта:          ${report.included}`)
  log(`  придушено:        ${report.suppressed === 1n ? 'так' : 'ні'}`)
  log(`  чоловіків:        ${report.male}`)
  log(`  уражених:         ${report.affected}`)
  log(`  вік ≥ порогів:    ${report.ageAtLeast.join(', ')}`)
  log(`  Σ алелів (1-8):   ${report.alleleSum.slice(0, 8).join(', ')}…`)
  log('  (розподілу генотипів у звіті немає — Σg² прибрано з рецепта, T030)')

  log('')
  log('── внески пулу ──────────────────────────────────────────')
  for (const [index, entry] of run.datasets.entries()) {
    const address = new PublicKey(entry.dataset).toBase58()
    log(
      `  ${index}. ${address.slice(0, 8)}… записів ${entry.recordsIncluded}` +
        `${entry.belowFloor ? ' (нижче порога)' : ''}${entry.settled ? ' · нараховано' : ''}`,
    )
  }

  log('')
  if (audit.problems.length === 0) {
    log('── вердикт ──────────────────────────────────────────────')
    log('  розбіжностей немає')
  } else {
    log('── розбіжності ──────────────────────────────────────────')
    for (const problem of audit.problems) log(`  • ${problem}`)
  }
  log('')
}

/** Прогін у корпусі: адреса, ключ звіту й людська назва умов. */
interface CorpusRun {
  label: string
  run: string
  reportSecretKey: string
}

/**
 * Корпус прогонів під `SC-001`.
 *
 * Це список **адрес** і відкриті записи канаркового датасету — тобто рівно те,
 * що має третя сторона: посилання на ланцюг і власні дані. Нічого, що корпус
 * стверджує про прогони, звіряч не бере на віру: статус, когорту й згортки він
 * читає з мережі сам.
 */
interface Corpus {
  rpc: string
  programId: string
  storageDir: string
  canary: { dataset: string; records: PlainRecord[] }
  runs: CorpusRun[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(raw: Record<string, unknown>, name: string): string {
  const value = raw[name]
  if (typeof value !== 'string') throw new Error(`у корпусі немає рядка «${name}»`)
  return value
}

function plainRecord(raw: unknown, at: number): PlainRecord {
  if (!isRecord(raw)) throw new Error(`канарковий запис ${at} не об'єкт`)
  const numbers = (name: string): number => {
    const value = raw[name]
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new Error(`канарковий запис ${at}: поле «${name}» не ціле число`)
    }
    return value
  }
  const genotypes = raw.genotypes
  if (!Array.isArray(genotypes) || genotypes.some((value) => typeof value !== 'number')) {
    throw new Error(`канарковий запис ${at}: генотипи мають бути масивом чисел`)
  }
  return {
    sex: numbers('sex'),
    age: numbers('age'),
    affected: numbers('affected'),
    genotypes: genotypes.map((value: number) => value),
  }
}

/** Розбирає корпус явно: `as Corpus` зробив би відсутнє поле нулем у звіті. */
async function loadCorpus(path: string): Promise<Corpus> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(raw)) throw new Error(`корпус має бути об'єктом`)

  const canary = raw.canary
  if (!isRecord(canary) || !Array.isArray(canary.records)) {
    throw new Error('у корпусі немає канаркового датасету з відкритими записами')
  }
  const runs = raw.runs
  if (!Array.isArray(runs) || runs.length === 0) throw new Error('корпус порожній')

  return {
    rpc: text(raw, 'rpc'),
    programId: text(raw, 'programId'),
    storageDir: text(raw, 'storageDir'),
    canary: {
      dataset: text(canary, 'dataset'),
      records: canary.records.map((record: unknown, at: number) => plainRecord(record, at)),
    },
    runs: runs.map((entry: unknown, at: number) => {
      if (!isRecord(entry)) throw new Error(`прогін ${at} у корпусі не об'єкт`)
      return {
        label: text(entry, 'label'),
        run: text(entry, 'run'),
        reportSecretKey: text(entry, 'reportSecretKey'),
      }
    }),
  }
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} КіБ`
}

/** Друкує один прогін так, щоб було видно і вердикт, і **скільки** оглянуто. */
function printSweep(sweepResult: RunSweep, needles: number): void {
  const { census } = sweepResult
  log('')
  log(`── прогін «${sweepResult.label}» ${'─'.repeat(Math.max(0, 34 - sweepResult.label.length))}`)
  log(
    `  ${sweepResult.run.slice(0, 8)}… ${sweepResult.status} · когорта ${sweepResult.cohort}` +
      `${sweepResult.suppressed ? ' (придушено)' : ''} · згорток ${sweepResult.folds}`,
  )
  log(
    `  оглянуто: акаунтів ${census.accounts} (${kib(census.accountBytes)}), ` +
      `транзакцій ${census.transactions} (${kib(census.transactionBytes)}), ` +
      `конвертів ${census.envelopes} (${kib(census.envelopeBytes)})`,
  )
  log(`  канарка: ${needles} голок · влучань ${sweepResult.hits.length}`)
  log(
    `  структура: ${sweepResult.batchWrites} записів у буфер, ` +
      `${sweepResult.batchWords} слів із ${sweepResult.expectedWords}, ` +
      `непояснених ${sweepResult.unexplained.length}`,
  )
  log(`  відкритих чисел опубліковано: ${sweepResult.clearNumbers}`)
  for (const problem of sweepResult.problems) log(`  • ${problem}`)
}

/**
 * `SC-001` на корпусі прогонів.
 *
 * Ключ MXE й розкладка звіту читаються **раз**: вони про кластер і про
 * компілятор, а не про прогін, і десять однакових читань нічого б не додали.
 */
async function noPlaintext(): Promise<void> {
  if (values.corpus === undefined) throw new Error('потрібен корпус прогонів: --corpus <шлях>')
  const corpus = await loadCorpus(resolve(values.corpus))

  const connection = new Connection(corpus.rpc, 'confirmed')
  const programId = new PublicKey(corpus.programId)
  const mxePublicKey = await fetchMxePublicKey(connection, programId)
  const layout = await loadReportLayout(resolve(values.circuits))
  const needles = recordNeedles(corpus.canary.records).length

  log('')
  log('══ SC-001: розшифрування не було ════════════════════════')
  log(`  канарковий датасет: ${corpus.canary.dataset}`)
  log(`  відкритих записів у власника: ${corpus.canary.records.length}`)
  log(`  голок на прогін: ${needles}`)
  log(`  прогонів у корпусі: ${corpus.runs.length}`)

  const sweeps: RunSweep[] = []
  for (const entry of corpus.runs) {
    const swept = await auditNoPlaintext({
      connection,
      programId,
      run: new PublicKey(entry.run),
      label: entry.label,
      storageDir: resolve(corpus.storageDir),
      buyerSecretKey: fromHex(entry.reportSecretKey),
      mxePublicKey,
      layout,
      canary: corpus.canary.records,
    })
    sweeps.push(swept)
    printSweep(swept, needles)
  }

  // Акаунти, які не належать жодному прогону: згода, каталожний рядок,
  // конфігурація платформи. Відкритий запис міг би осісти й там.
  const everything = await sweepProgramAccounts(connection, programId, corpus.canary.records)
  log('')
  log('── усі акаунти програми ─────────────────────────────────')
  log(
    `  ${everything.accounts} акаунтів, ${kib(everything.bytes)} · влучань ${everything.hits.length}`,
  )

  const bytes = sweeps.reduce(
    (total, entry) =>
      total +
      entry.census.accountBytes +
      entry.census.transactionBytes +
      entry.census.envelopeBytes,
    everything.bytes,
  )
  const hits = sweeps.reduce((total, entry) => total + entry.hits.length, everything.hits.length)
  const unexplained = sweeps.reduce((total, entry) => total + entry.unexplained.length, 0)
  const problems = sweeps.reduce((total, entry) => total + entry.problems.length, 0)

  log('')
  log('══ вердикт ══════════════════════════════════════════════')
  log(`  прогонів оглянуто:      ${sweeps.length}`)
  log(`  байтів оглянуто:        ${kib(bytes)}`)
  const seenWords = sweeps.reduce((total, entry) => total + entry.batchWords, 0)
  const dueWords = sweeps.reduce((total, entry) => total + entry.expectedWords, 0)
  log(`  слів звірено з конвертом: ${seenWords} із ${dueWords}`)
  log(`  влучань канарки:        ${hits}`)
  log(`  непояснених слів:       ${unexplained}`)
  log(`  розбіжностей:           ${problems}`)
  log('')
  log(hits === 0 && problems === 0 ? '  розшифрування не було' : '  SC-001 НЕ ВИКОНАНО')
  log('')

  if (hits > 0 || problems > 0) process.exitCode = 1
}

async function buyerPath(): Promise<void> {
  const config = await settings()
  const budgetSeconds = Number(values.budget)

  const audit = await auditBuyerPath({
    connection: new Connection(config.rpc, 'confirmed'),
    programId: new PublicKey(config.programId),
    run: new PublicKey(config.run),
    storageDir: resolve(config.storageDir),
    buyerSecretKey: config.secretKey,
    circuitsModulePath: resolve(values.circuits),
  })

  print(audit, budgetSeconds)

  // Ненульовий код виходу на будь-якій розбіжності або перевищенні бюджету:
  // звіряч, який друкує «не зійшлося» й повертає нуль, у CI мовчить.
  if (audit.problems.length > 0 || audit.timings.activeMs / 1000 > budgetSeconds) {
    process.exitCode = 1
  }
}

async function main(): Promise<void> {
  const command = positionals.at(0) ?? 'e2e-buyer'
  if (command === 'e2e-buyer') return buyerPath()
  if (command === 'no-plaintext') return noPlaintext()
  throw new Error(`невідома команда «${command}»: буває e2e-buyer або no-plaintext`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
