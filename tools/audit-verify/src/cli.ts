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
import { auditParity, RECIPE_MARKERS, readRecords } from './parity.ts'
import { loadReportLayout } from './report.ts'
import { auditTiming, LINEARITY_TOLERANCE, RECIPE_BATCH, SPEEDUP_FLOOR } from './timing.ts'

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
    /** Бюджет `SC-002` у відсоткових пунктах. */
    'parity-budget': { type: 'string', default: '2' },
    /**
     * Нижня межа абсолютної якості скану, під якою порівняння порожнє.
     *
     * Це не критерій SPEC, а сторож: розрив нуль між двома сканами, які нічого
     * не знаходять, теж нуль. Число задається, щоб його було видно у виклику.
     */
    'scan-floor': { type: 'string', default: '0.75' },
    /** Бюджет `SC-003` у секундах і розмір стандартного датасету. Обидва з SPEC. */
    'timing-budget': { type: 'string', default: '16200' },
    'timing-records': { type: 'string', default: '10000' },
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

/** Корпус звірки якості: адреси двох плечей і те, що власник знає про себе. */
interface ParityCorpusFile {
  rpc: string
  programId: string
  recordsPath: string
  causalMarkers: number[]
  cases: { label: string; run: string; reportSecretKey: string }
  controls: { label: string; run: string; reportSecretKey: string }
}

function corpusArm(
  raw: unknown,
  name: string,
): { label: string; run: string; reportSecretKey: string } {
  if (!isRecord(raw)) throw new Error(`у корпусі немає плеча «${name}»`)
  return {
    label: text(raw, 'label'),
    run: text(raw, 'run'),
    reportSecretKey: text(raw, 'reportSecretKey'),
  }
}

async function loadParityCorpus(path: string): Promise<ParityCorpusFile> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(raw)) throw new Error(`корпус має бути об'єктом`)

  const causal = raw.causalMarkers
  if (!Array.isArray(causal) || causal.some((value) => !Number.isInteger(value))) {
    throw new Error('у корпусі немає причинних маркерів')
  }

  return {
    rpc: text(raw, 'rpc'),
    programId: text(raw, 'programId'),
    recordsPath: text(raw, 'recordsPath'),
    causalMarkers: causal.map((value: number) => value),
    cases: corpusArm(raw.cases, 'cases'),
    controls: corpusArm(raw.controls, 'controls'),
  }
}

function points(value: number): string {
  return `${value.toFixed(1)} п.п.`
}

/**
 * `SC-002` на двох плечах скану.
 *
 * Друкуються **обидва** числа: розрив, якого вимагає критерій, і абсолютна
 * якість скану. Друге не менш важливе за перше: розрив нуль між двома
 * мовчазними сканами теж нуль, і саме про це попереджав `T031`.
 */
async function parityCheck(): Promise<void> {
  if (values.corpus === undefined) throw new Error('потрібен корпус звірки: --corpus <шлях>')
  const corpus = await loadParityCorpus(resolve(values.corpus))

  const connection = new Connection(corpus.rpc, 'confirmed')
  const programId = new PublicKey(corpus.programId)
  const budgetPoints = Number(values['parity-budget'])
  const scanFloor = Number(values['scan-floor'])

  const records = await readRecords(resolve(corpus.recordsPath))

  const audit = await auditParity({
    connection,
    programId,
    cases: {
      label: corpus.cases.label,
      run: new PublicKey(corpus.cases.run),
      buyerSecretKey: fromHex(corpus.cases.reportSecretKey),
    },
    controls: {
      label: corpus.controls.label,
      run: new PublicKey(corpus.controls.run),
      buyerSecretKey: fromHex(corpus.controls.reportSecretKey),
    },
    mxePublicKey: await fetchMxePublicKey(connection, programId),
    layout: await loadReportLayout(resolve(values.circuits)),
    records,
    causalMarkers: corpus.causalMarkers,
    scanFloor,
    budgetPoints,
  })

  log('')
  log('══ SC-002: звірка якості з відкритим прогоном ═══════════')
  log(`  записів у власника:   ${audit.records}`)
  log(`  причинні маркери:     ${audit.causalMarkers.join(', ')} з ${RECIPE_MARKERS}`)

  for (const arm of [audit.cases, audit.controls]) {
    log('')
    log(`── плече «${arm.label}» ──────────────────────────────────`)
    log(
      `  ${arm.run.slice(0, 8)}… фільтр вік ${arm.filters.minAge}…${arm.filters.maxAge}, ` +
        `стать ${arm.filters.sexFilter}, ураженість ${arm.filters.affectedFilter}`,
    )
    log(`  когорта: MPC ${arm.mpc.included}, відкрито ${arm.open.included}`)
    log(`  чисел звірено: ${3 + 8 + RECIPE_MARKERS} · розбіжностей ${arm.differences.length}`)
  }

  log('')
  log('── скан за різницею частот алеля ────────────────────────')
  log(
    `  повнота на топ-${audit.causalMarkers.length}: MPC ${(audit.scanMpc.recallAtK * 100).toFixed(1)}%, ` +
      `відкрито ${(audit.scanOpen.recallAtK * 100).toFixed(1)}%`,
  )
  log(
    `  AUC ранжування:       MPC ${audit.scanMpc.auc.toFixed(4)}, відкрито ${audit.scanOpen.auc.toFixed(4)}`,
  )
  log(
    `  топ-${audit.causalMarkers.length} маркерів MPC: ${audit.scanMpc.ranking.slice(0, audit.causalMarkers.length).join(', ')}`,
  )

  log('')
  log('══ вердикт ══════════════════════════════════════════════')
  log(`  розрив повноти:  ${points(audit.recallGapPoints)}`)
  log(`  розрив AUC:      ${points(audit.aucGapPoints)}`)
  log(`  бюджет SC-002:   ${points(budgetPoints)}`)
  log(
    `  абсолютна якість скану на відкритих даних: AUC ${audit.scanOpen.auc.toFixed(4)} ` +
      `(межа осмисленості ${scanFloor})`,
  )
  log('')

  if (audit.problems.length === 0) {
    log('  розбіжностей немає — звіт MPC тотожний відкритому перерахунку')
  } else {
    for (const problem of audit.problems) log(`  • ${problem}`)
    log('')
    log('  SC-002 НЕ ВИКОНАНО')
    process.exitCode = 1
  }
  log('')
}

/** Корпус `sc003`: адреси прогонів драбини й хвиль, і більш нічого. */
interface TimingCorpusFile {
  rpc: string
  programId: string
  stallMs: number
  ladder: string[]
  waves: { label: string; concurrency: number; runs: string[] }[]
}

async function loadTimingCorpus(path: string): Promise<TimingCorpusFile> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (!isRecord(raw)) throw new Error(`корпус має бути об'єктом`)

  const ladder = raw.ladder
  if (!Array.isArray(ladder) || ladder.length === 0) {
    throw new Error('у корпусі немає драбини прогонів')
  }
  const waves = raw.waves
  if (!Array.isArray(waves)) throw new Error('у корпусі немає хвиль')

  return {
    rpc: text(raw, 'rpc'),
    programId: text(raw, 'programId'),
    stallMs: typeof raw.stallMs === 'number' ? raw.stallMs : 0,
    ladder: ladder.map((entry: unknown, index: number) => {
      if (!isRecord(entry)) throw new Error(`щабель ${index} драбини не об'єкт`)
      return text(entry, 'run')
    }),
    waves: waves.map((entry: unknown, index: number) => {
      if (!isRecord(entry)) throw new Error(`хвиля ${index} не об'єкт`)
      const runs = entry.runs
      if (!Array.isArray(runs)) throw new Error(`у хвилі ${index} немає прогонів`)
      const concurrency = entry.concurrency
      if (typeof concurrency !== 'number') throw new Error(`у хвилі ${index} немає паралельності`)
      return {
        label: text(entry, 'label'),
        concurrency,
        runs: runs.map((run: unknown, at: number) => {
          if (!isRecord(run)) throw new Error(`прогін ${at} хвилі ${index} не об'єкт`)
          return text(run, 'run')
        }),
      }
    }),
  }
}

/** Мілісекунди в читабельне: секунди до хвилини, далі хвилини й години. */
function duration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} с`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} хв`
  return `${(ms / 3_600_000).toFixed(2)} год`
}

/**
 * `SC-003`: скільки коштує згортка і що з цього виходить на 10 000 записів.
 *
 * Друкується не одне число, а три твердження, і кожне окремо перевірне:
 * розкладка циклу (чия саме вага), драбина (чи можна екстраполювати) і хвилі
 * (чи вміє кластер рахувати паралельно). Вердикт без будь-якого з них не
 * виводиться взагалі — число, яке нема на чому тримати, гірше за його
 * відсутність.
 */
async function timingCheck(): Promise<void> {
  if (values.corpus === undefined) throw new Error('потрібен корпус виміру: --corpus <шлях>')
  const corpus = await loadTimingCorpus(resolve(values.corpus))

  const connection = new Connection(corpus.rpc, 'confirmed')
  const programId = new PublicKey(corpus.programId)
  const budgetSeconds = Number(values['timing-budget'])
  const records = Number(values['timing-records'])

  const audit = await auditTiming({
    connection,
    programId,
    ladder: corpus.ladder.map((run) => new PublicKey(run)),
    waves: corpus.waves.map((wave) => ({
      label: wave.label,
      concurrency: wave.concurrency,
      runs: wave.runs.map((run) => new PublicKey(run)),
    })),
    budgetSeconds,
    records,
  })

  log('')
  log('══ SC-003: час прогону на 10 000 записів ════════════════')
  log(`  годинник:             слот ≈ ${audit.msPerSlot.toFixed(1)} мс (виміряно по blockTime)`)
  if (corpus.stallMs > 0) {
    log(`  негативний контроль:  у цикл вставлено ${corpus.stallMs} мс затримки`)
  }

  log('')
  log('── розкладка циклу згортки ─────────────────────────────')
  const share = (value: number): string =>
    audit.foldMs === 0 ? '—' : `${((value / audit.foldMs) * 100).toFixed(0)} %`
  log(
    `  MPC (dispatch → callback):   ${audit.phases.mpc.toFixed(0).padStart(6)} мс   ${share(audit.phases.mpc)}`,
  )
  log(
    `  простій драйвера:            ${audit.phases.idle.toFixed(0).padStart(6)} мс   ${share(audit.phases.idle)}`,
  )
  log(
    `  запис батча:                 ${audit.phases.write.toFixed(0).padStart(6)} мс   ${share(audit.phases.write)}`,
  )
  log(
    `  підтвердження згортки:       ${audit.phases.arm.toFixed(0).padStart(6)} мс   ${share(audit.phases.arm)}`,
  )
  log(`  цикл цілком:                 ${audit.foldMs.toFixed(0).padStart(6)} мс`)

  log('')
  log('── драбина: чи стала вартість згортки ──────────────────')
  for (const point of audit.ladder.points) {
    log(
      `  ${point.run.slice(0, 8)}…  ${point.folds.toString().padStart(4)} згорток  ` +
        `${point.foldMs.toFixed(0).padStart(6)} мс на згортку`,
    )
  }
  log(
    `  розкид ${(audit.ladder.spread * 100).toFixed(1)} % при допуску ` +
      `${(LINEARITY_TOLERANCE * 100).toFixed(0)} % — ` +
      (audit.ladder.linear ? 'екстраполювати можна' : 'ЕКСТРАПОЛЮВАТИ НЕМА НА ЧОМУ'),
  )

  if (audit.waves.length > 0) {
    log('')
    log('── хвилі: чи вміє кластер рахувати паралельно ──────────')
    for (const wave of audit.waves) {
      log(
        `  ×${wave.concurrency.toString().padEnd(2)} ${wave.folds.toString().padStart(4)} згорток  ` +
          `${wave.foldMs.toFixed(0).padStart(6)} мс на згортку  ` +
          (wave.speedup === null ? '' : `прискорення ×${wave.speedup.toFixed(2)}`),
      )
    }
    log(
      `  поріг важеля ×${SPEEDUP_FLOOR} — ` +
        (audit.parallelismHelps === null
          ? 'хвиль для висновку не було'
          : audit.parallelismHelps
            ? 'важіль паралельних накопичувачів реальний'
            : 'ВАЖЕЛЯ НЕМАЄ: кластер рахує по черзі'),
    )
  }

  log('')
  log('══ вердикт ══════════════════════════════════════════════')
  log(`  згорток на ${records} записів: ${audit.foldsFor10k} (батч ${RECIPE_BATCH})`)
  if (audit.projectedSeconds === null) {
    log('  проєкція:             не рахується — див. розбіжності нижче')
  } else {
    log(`  проєкція:             ${duration(audit.projectedSeconds * 1000)}`)
    log(`  бюджет SC-003:        ${duration(budgetSeconds * 1000)}`)
    // «Промах ×0,7» читається як промах, хоч означає запас. Слово міняється
    // разом зі знаком, бо звіт читають очима, а не парсером.
    const ratio = audit.overBudget ?? 0
    log(
      ratio > 1
        ? `  промах:               ×${ratio.toFixed(1)}`
        : `  запас:                ×${(1 / ratio).toFixed(1)}`,
    )
  }
  log(`  за бюджетні ${budgetSeconds} с архітектура встигає ${audit.recordsInBudget} записів`)
  if (audit.accumulatorsNeeded > 0) {
    log(
      `  одночасних накопичувачів під бюджет: ≥ ${audit.accumulatorsNeeded} ` +
        '(нижня оцінка — вона припускає, що паралельна згортка коштує як одинока)',
    )
  }
  log('')

  if (audit.problems.length > 0) {
    for (const problem of audit.problems) log(`  • ${problem}`)
    log('')
  }

  if (audit.passed) {
    log('  SC-003 виконано')
  } else {
    log('  SC-003 НЕ ВИКОНАНО')
    process.exitCode = 1
  }
  log('')
}

async function main(): Promise<void> {
  const command = positionals.at(0) ?? 'e2e-buyer'
  if (command === 'e2e-buyer') return buyerPath()
  if (command === 'no-plaintext') return noPlaintext()
  if (command === 'parity') return parityCheck()
  if (command === 'timing') return timingCheck()
  throw new Error(`невідома команда «${command}»: буває e2e-buyer, no-plaintext, parity або timing`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
