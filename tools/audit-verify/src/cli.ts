#!/usr/bin/env node
/**
 * Незалежний звіряч прогону (`T030`, `FR-025`).
 *
 * ```bash
 * node --experimental-strip-types tools/audit-verify/src/cli.ts e2e-buyer \
 *   --report artifacts/e2e/run.json
 * ```
 *
 * Звіт драйвера тут — джерело **адрес**, і тільки їх: прогін, сховище, ключ
 * покупця. Жодне твердження драйвера про час чи результат сюди не потрапляє;
 * усе інше звіряч читає з мережі й зі сховища сам.
 */

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Connection, PublicKey } from '@solana/web3.js'
import type { Audit } from './e2e-buyer.ts'
import { auditBuyerPath } from './e2e-buyer.ts'
import { hex } from './fold-chain.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    report: { type: 'string' },
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

async function main(): Promise<void> {
  const command = positionals.at(0) ?? 'e2e-buyer'
  if (command !== 'e2e-buyer') throw new Error(`невідома команда «${command}»`)

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

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
