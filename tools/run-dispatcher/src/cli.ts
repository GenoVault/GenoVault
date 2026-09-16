#!/usr/bin/env node

/**
 * Драйвер прогону однією командою (`T030`).
 *
 * ```bash
 * # повний сценарій на чистому локальному стенді
 * node --experimental-strip-types tools/run-dispatcher/src/cli.ts e2e \
 *   --out artifacts/e2e/run.json
 *
 * # довести до кінця вже замовлений прогін
 * node --experimental-strip-types tools/run-dispatcher/src/cli.ts drive \
 *   --run <адреса> --storage artifacts/e2e/storage --dispatcher <шлях до ключа>
 * ```
 *
 * Перед `e2e` має бути піднятий локальний стенд:
 * `wsl -d Ubuntu-24.04 -e bash /mnt/<диск>/<шлях>/GenoVault/scripts/localnet.sh`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { AnchorProvider, Wallet } from '@anchor-lang/core'
import type { GenoVaultProgram } from '@genovault/sdk'
import { createProgram, PROGRAM_ID } from '@genovault/sdk'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { loadArciumContext } from './arcium.ts'
import { bootstrapCircuits, bootstrapPlatform, fundBuyer } from './bootstrap.ts'
import { buildCorpus } from './corpus.ts'
import type { Progress } from './drive.ts'
import { drive } from './drive.ts'
import { prepareScenario } from './scenario.ts'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rpc: { type: 'string', default: 'http://127.0.0.1:8899' },
    wallet: { type: 'string' },
    storage: { type: 'string', default: 'artifacts/e2e/storage' },
    out: { type: 'string', default: 'artifacts/e2e/run.json' },
    run: { type: 'string' },
    dispatcher: { type: 'string' },
    sizes: { type: 'string' },
    'fee-bps': { type: 'string', default: '250' },
    concurrency: { type: 'string', default: '8' },
    'callback-timeout': { type: 'string', default: '120000' },
    /** `sc001`: чи додавати одинадцятий, повнорозмірний прогін. */
    full: { type: 'boolean', default: true },
  },
})

const command = positionals.at(0) ?? 'e2e'

/** Ключ, яким `anchor` розгортає програму, — він же платить за стенд. */
async function loadWallet(path: string | undefined): Promise<Keypair> {
  const file = path ?? `${process.env.HOME ?? process.env.USERPROFILE}/.config/solana/id.json`
  const raw = JSON.parse(await readFile(file, 'utf8')) as number[]
  return Keypair.fromSecretKey(Uint8Array.from(raw))
}

function log(note: string): void {
  process.stdout.write(`${note}\n`)
}

function logProgress(progress: Progress): void {
  const where = [
    progress.dataset === undefined ? null : `датасет ${progress.dataset}`,
    progress.batch === undefined ? null : `батч ${progress.batch}`,
  ]
    .filter((part) => part !== null)
    .join(' · ')

  log(
    [
      progress.stage.padEnd(14),
      `${progress.elapsedMs.toString().padStart(7)} мс`,
      where,
      progress.note ?? '',
    ]
      .filter((part) => part !== '')
      .join('  '),
  )
}

/** Локальному стенду роздаємо SOL: rent за буфер сам по собі ~0,49 SOL. */
async function fund(connection: Connection, keys: PublicKey[], sol: number): Promise<void> {
  for (const key of keys) {
    const signature = await connection.requestAirdrop(key, sol * LAMPORTS_PER_SOL)
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  }
}

async function main(): Promise<void> {
  const connection = new Connection(values.rpc, 'confirmed')
  const payer = await loadWallet(values.wallet)
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: 'confirmed',
  })
  const program = createProgram({ connection })
  const storageDir = resolve(values.storage)

  if (command === 'drive') {
    if (values.run === undefined) throw new Error('потрібна адреса прогону: --run <base58>')
    const dispatcher = values.dispatcher === undefined ? payer : await loadWallet(values.dispatcher)
    const arcium = await loadArciumContext(provider, PROGRAM_ID)

    const result = await drive({
      connection,
      program,
      arcium,
      dispatcher,
      run: new PublicKey(values.run),
      envelope: (dataset) => readFile(`${storageDir}/${dataset.toBase58()}.gvds`),
      writeConcurrency: Number(values.concurrency),
      callbackTimeoutMs: Number(values['callback-timeout']),
      onProgress: logProgress,
    })

    log(`\nстатус: ${result.run.status} · згорток: ${result.folds} · ${result.elapsedMs} мс`)
    return
  }

  if (command === 'sc001') {
    await sc001(connection, provider, program, payer, storageDir)
    return
  }

  if (command !== 'e2e') {
    throw new Error(`невідома команда «${command}»: буває e2e, drive або sc001`)
  }

  const sizes = values.sizes?.split(',').map((part) => Number(part.trim()))
  const poolSize = sizes?.length ?? 3
  const owners = Array.from({ length: poolSize }, () => Keypair.generate())
  const buyer = Keypair.generate()
  const dispatcher = Keypair.generate()
  const mint = Keypair.generate()

  log('роздаємо SOL учасникам стенду…')
  await fund(connection, [...owners.map((o) => o.publicKey), buyer.publicKey], 2)
  // Диспетчеру більше: буфер, накопичувач і 2500 акаунтів обчислень на
  // стандартний датасет — усе це rent, який він вносить і забирає назад.
  await fund(connection, [dispatcher.publicKey], 5)

  log('розгортаємо платформу…')
  const platform = await bootstrapPlatform({
    connection,
    program,
    authority: payer,
    mint,
    feeBps: Number(values['fee-bps']),
  })
  log(`  мінт ${platform.mint.toBase58()} · комісія ${platform.feeBps} б.п.`)

  log('розгортаємо визначення обчислень…')
  const arcium = await loadArciumContext(provider, PROGRAM_ID)
  await bootstrapCircuits({
    provider,
    program,
    arcium,
    payer,
    circuitsDir: resolve('build'),
    onProgress: (circuit, note) => log(`  ${circuit}: ${note}`),
  })

  // Стеля депозиту завідомо вища за ціну пулу: сценарій міряє час, а не
  // поведінку на межі — межу перевіряє `T027` окремим тестом.
  const maxEscrow = 1_000_000_000n
  await fundBuyer(connection, payer, platform.mint, buyer.publicKey, maxEscrow)

  const nonce = BigInt(Date.now())
  log('готуємо пул і замовляємо прогін…')
  const scenario = await prepareScenario({
    connection,
    provider,
    program,
    owners,
    buyer,
    dispatcher: dispatcher.publicKey,
    mint: platform.mint,
    storageDir,
    nonce,
    ...(sizes === undefined ? {} : { sizes }),
    maxEscrow,
    onProgress: (note) => log(`  ${note}`),
  })

  // Звіт кладеться на диск **до** прогону, а не після: у ньому адреси, ключ
  // читача звіту й шлях до ключа диспетчера, а прогін на 2500 згорток колись
  // обірветься — таймаутом, світлом, Ctrl+C. Звіт, який з'являється лише в
  // кінці, робить перерваний прогін невідновлюваним: ані довести до кінця, ані
  // навіть прочитати те, за що заплачено, уже нічим. Після прогону файл
  // переписується з результатами.
  //
  // Читає його `tools/audit-verify`, і читає він **адреси**, а не наші
  // висновки. Приватна половина ключа звіту теж тут — іншого місця, де вона
  // зберігається, немає за побудовою (`T029`).
  const out = resolve(values.out)
  await mkdir(dirname(out), { recursive: true })

  // Ключ диспетчера — окремим файлом у форматі solana, щоб `drive --dispatcher`
  // узяв його без перекладу. Це ключ локального стенду й нічого більше.
  const dispatcherKeyPath = join(dirname(out), 'dispatcher.json')
  await writeFile(dispatcherKeyPath, JSON.stringify(Array.from(dispatcher.secretKey)), 'utf8')

  const report = {
    rpc: values.rpc,
    programId: PROGRAM_ID.toBase58(),
    mint: platform.mint.toBase58(),
    buyer: buyer.publicKey.toBase58(),
    dispatcher: dispatcher.publicKey.toBase58(),
    dispatcherKeyPath,
    nonce: nonce.toString(10),
    run: scenario.order.run.toBase58(),
    reportSecretKey: Buffer.from(scenario.order.reportSecretKey).toString('hex'),
    storageDir,
    datasets: scenario.datasets.map((dataset) => ({
      id: dataset.id,
      owner: dataset.owner.toBase58(),
      address: dataset.address.toBase58(),
      recordCount: dataset.recordCount,
      contentHash: dataset.contentHash,
      envelopePath: dataset.envelopePath,
    })),
    orderMs: scenario.order.elapsedMs,
  }

  const write = async (extra: Record<string, unknown>): Promise<void> => {
    await writeFile(out, `${JSON.stringify({ ...report, ...extra }, null, 2)}\n`, 'utf8')
  }
  await write({ status: 'accepted' })
  log(`звіт: ${out}`)

  log('\nведемо прогін:')
  const result = await drive({
    connection,
    program,
    arcium,
    dispatcher,
    run: scenario.order.run,
    envelope: (dataset) => readFile(`${storageDir}/${dataset.toBase58()}.gvds`),
    writeConcurrency: Number(values.concurrency),
    callbackTimeoutMs: Number(values['callback-timeout']),
    onProgress: logProgress,
  })

  await write({
    status: result.run.status,
    folds: result.folds,
    driveMs: result.elapsedMs,
  })

  log(`\nстатус: ${result.run.status} · згорток: ${result.folds} · ${result.elapsedMs} мс`)
  log(`звіт: ${out}`)
}

/**
 * Корпус прогонів під `SC-001` (`T031`).
 *
 * ```bash
 * node --experimental-strip-types tools/run-dispatcher/src/cli.ts sc001 \
 *   --out artifacts/no-plaintext/corpus.json --storage artifacts/no-plaintext/storage
 * ```
 *
 * Ця команда **не перевіряє** нічого: вона створює умови й доводить одинадцять
 * прогонів до кінця. Перевіряє `tools/audit-verify no-plaintext`, і робить це
 * без жодного нашого пакета в рантаймі — інакше «розшифрування не було»
 * означало б рівно те, що наш код так каже.
 */
async function sc001(
  connection: Connection,
  provider: AnchorProvider,
  program: GenoVaultProgram,
  payer: Keypair,
  storageDir: string,
): Promise<void> {
  const full = values.full !== false
  // П'ятеро власників: троє на малий пул і двоє на повнорозмірний.
  const owners = Array.from({ length: full ? 5 : 3 }, () => Keypair.generate())
  const buyer = Keypair.generate()
  const dispatcher = Keypair.generate()
  const mint = Keypair.generate()

  log('роздаємо SOL учасникам стенду…')
  await fund(connection, [...owners.map((owner) => owner.publicKey), buyer.publicKey], 2)
  // Диспетчеру більше: одинадцять прогонів — це одинадцять буферів і
  // накопичувачів, і rent за кожен вносить саме він.
  await fund(connection, [dispatcher.publicKey], 20)

  log('розгортаємо платформу…')
  const platform = await bootstrapPlatform({
    connection,
    program,
    authority: payer,
    mint,
    feeBps: Number(values['fee-bps']),
  })
  log(`  мінт ${platform.mint.toBase58()} · комісія ${platform.feeBps} б.п.`)

  log('розгортаємо визначення обчислень…')
  const arcium = await loadArciumContext(provider, PROGRAM_ID)
  await bootstrapCircuits({
    provider,
    program,
    arcium,
    payer,
    circuitsDir: resolve('build'),
    onProgress: (circuit, note) => log(`  ${circuit}: ${note}`),
  })

  const maxEscrow = 1_000_000_000n
  // Депозит вноситься на кожен прогін окремо, і невитрачена частина
  // повертається аж наприкінці: покупцю треба стільки, скільки прогонів.
  await fundBuyer(connection, payer, platform.mint, buyer.publicKey, maxEscrow * 20n)

  const out = resolve(values.out)
  const corpus = await buildCorpus({
    connection,
    provider,
    program,
    arcium,
    rpc: values.rpc,
    owners,
    buyer,
    dispatcher,
    mint: platform.mint,
    storageDir,
    out,
    nonce: BigInt(Date.now()),
    maxEscrow,
    full,
    writeConcurrency: Number(values.concurrency),
    callbackTimeoutMs: Number(values['callback-timeout']),
    onProgress: log,
  })

  log(`\nкорпус: ${out}`)
  log(`прогонів: ${corpus.runs.length} · датасетів: ${corpus.datasets.length}`)
  log(`канарка: ${corpus.canary.dataset} (${corpus.canary.records.length} відкритих записів)`)
  log('\nтепер звіряч, і він нашого коду не бачить:')
  log(
    `  node --experimental-strip-types tools/audit-verify/src/cli.ts no-plaintext --corpus ${out}`,
  )
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
