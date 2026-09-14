/**
 * Драйвер прогону: від `open_run` до `finalize_run` (`T030`).
 *
 * # Чому це окрема програма, а не кнопка в браузері
 *
 * Один батч це 79 транзакцій запису, а стандартний датасет — 313 батчів. Так
 * само як публікацію підписує названий покупцем диспетчер, а не вкладка
 * (`T025`), доводить прогін до кінця саме цей код: він тримає ключ диспетчера,
 * подає байти й чекає callback'и від MPC-вузлів.
 *
 * # Чому крок вперед завжди читається з ланцюга
 *
 * Курсор пулу рухає **callback**, а не наша інструкція, і накопичувач стає
 * готовим теж у callback'у. Тобто драйвер не знає свого стану — його знає
 * ланцюг. Кожен крок починається з читання `Run` і `RunAccumulator`, і саме це
 * робить драйвер відновлюваним: перерваний посеред датасету прогін
 * продовжується з того місця, де його лишили вузли, а не з початку.
 */

import type { GenoVaultProgram, RunAccount } from '@genovault/sdk'
import {
  associatedTokenAddress,
  fetchPlatformConfig,
  fetchRun,
  platformConfigAddress,
  TOKEN_2022_PROGRAM_ID,
} from '@genovault/sdk'
import type { Connection, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import type { ArciumContext } from './arcium.ts'
import { freshComputationOffset } from './arcium.ts'
import { planWrites } from './chunks.ts'
import {
  closeAccumulatorIx,
  closeBatchBufferIx,
  dispatchCloseDatasetIx,
  dispatchFoldIx,
  dispatchInitIx,
  dispatchRevealIx,
  finalizeRunIx,
  growBatchBufferIx,
  openRunIx,
  settleDatasetIx,
  writeBatchIx,
} from './instructions.ts'
import { growSteps } from './layout.ts'
import { readAccumulator } from './state.ts'
import { transcodeDataset } from './transcode.ts'

/** Прогін не рушив далі, і причина не в нашій транзакції. */
export class DriveError extends Error {
  override readonly name = 'DriveError'
}

/** Що саме зараз робить драйвер — рівно те, що показується в лозі. */
export type ProgressStage =
  | 'open'
  | 'grow'
  | 'init'
  | 'write'
  | 'fold'
  | 'close-dataset'
  | 'reveal'
  | 'settle'
  | 'finalize'
  | 'sweep'

export interface Progress {
  stage: ProgressStage
  /** Номер датасету в пулі, якщо крок його стосується. */
  dataset?: number
  /** Номер батча в межах датасету. */
  batch?: number
  /** Скільки мілісекунд зайняв крок. */
  elapsedMs: number
  note?: string
}

export interface DriveOptions {
  connection: Connection
  program: GenoVaultProgram
  arcium: ArciumContext
  dispatcher: Keypair
  run: PublicKey
  /**
   * Шифротекст датасету за його ончейн-адресою.
   *
   * Функція, а не мапа: конверт на 10 000 записів важить ~16 МіБ, і тримати
   * весь пул у пам'яті означало б впертись у купу раніше, ніж у мережу.
   */
  envelope(dataset: PublicKey): Promise<Uint8Array>
  /** Скільки транзакцій запису тримати в польоті одночасно. */
  writeConcurrency?: number
  /** Скільки чекати на callback від MPC-вузлів, поки не визнати прогін завислим. */
  callbackTimeoutMs?: number
  onProgress?(progress: Progress): void
}

const DEFAULT_WRITE_CONCURRENCY = 8
const DEFAULT_CALLBACK_TIMEOUT_MS = 120_000
const POLL_INTERVAL_MS = 400

export interface DriveResult {
  /** Скільки згорток пішло в MPC за цей запуск драйвера. */
  folds: number
  /** Стан прогону після `finalize_run`. */
  run: RunAccount
  /** Скільки мілісекунд від першої транзакції до кінцевого статусу. */
  elapsedMs: number
}

/**
 * Доводить прогін до кінця.
 *
 * Ідемпотентна за побудовою: кожен крок питає ланцюг, чи він уже зроблений.
 * Повторний запуск на завершеному прогоні не робить нічого й не падає.
 */
export async function drive(options: DriveOptions): Promise<DriveResult> {
  const started = Date.now()
  let folds = 0

  let run = await requireRun(options)

  if (run.status === 'accepted') {
    await step(options, 'open', async () => [await openRunIx(context(options))])
    for (let i = 0; i < growSteps(); i += 1) {
      await step(options, 'grow', async () => [await growBatchBufferIx(context(options))], {
        note: `${i + 1}/${growSteps()}`,
      })
    }
    await step(options, 'init', async () => [
      await dispatchInitIx({ ...context(options), arcium: options.arcium, ...offset() }),
    ])
    await waitFor(options, 'накопичувач після frequencies_init', async () => {
      const accumulator = await readAccumulator(options.connection, options.program, options.run)
      return accumulator.ready && accumulator.pending === null
    })
    run = await requireRun(options)
  }

  // Курсор веде ланцюг: датасети, згорнуті попереднім запуском драйвера,
  // пропускаються без жодного питання до нас.
  while (run.status === 'running' && run.datasetCursor < run.datasets.length) {
    const index = run.datasetCursor
    const entry = run.datasets.at(index)
    if (entry === undefined) throw new DriveError(`курсор ${index} поза складом прогону`)
    const batches = transcodeDataset(await options.envelope(entry.dataset))

    // Скільки батчів цього датасету вже згорнуто, драйвер знає лише зі свого
    // лічильника: ланцюг веде `folded_batches` на весь прогін, а не на датасет.
    // Тому перерваний посеред датасету прогін доганяється з початку датасету —
    // це подвійна робота, але не подвійний рахунок: `frequencies_close_dataset`
    // ще не викликався, тож внесок не оголошений.
    for (const batch of batches) {
      await writeBatch(options, batch.payload, index, batch.index)

      await step(
        options,
        'fold',
        async () => [
          await dispatchFoldIx({
            ...context(options),
            arcium: options.arcium,
            ...offset(),
            live: batch.live,
          }),
        ],
        { dataset: index, batch: batch.index, note: `live=${batch.live}` },
      )
      await waitFor(options, `згортку ${index}/${batch.index}`, async () => {
        const accumulator = await readAccumulator(options.connection, options.program, options.run)
        return accumulator.pending === null
      })
      folds += 1
    }

    await step(
      options,
      'close-dataset',
      async () => [
        await dispatchCloseDatasetIx({ ...context(options), arcium: options.arcium, ...offset() }),
      ],
      { dataset: index },
    )
    await waitFor(options, `закриття датасету ${index}`, async () => {
      const next = await requireRun(options)
      return next.datasetCursor > index || next.status !== 'running'
    })
    run = await requireRun(options)
  }

  if (run.status === 'running') {
    await step(options, 'reveal', async () => [
      await dispatchRevealIx({ ...context(options), arcium: options.arcium, ...offset() }),
    ])
    await waitFor(options, 'розкриття звіту', async () => {
      const next = await requireRun(options)
      return next.status !== 'running'
    })
    run = await requireRun(options)
  }

  if (run.status === 'completed') {
    for (const [index, entry] of run.datasets.entries()) {
      if (entry.settled) continue
      await step(
        options,
        'settle',
        async () => [
          await settleDatasetIx({
            program: options.program,
            payer: options.dispatcher.publicKey,
            run: options.run,
            index,
            dataset: entry.dataset,
          }),
        ],
        { dataset: index },
      )
    }
    run = await requireRun(options)

    if (!run.refunded) {
      // Мінт лежить у конфігурації платформи, а не в `Run`: прогін копіює з
      // неї ціну й комісію, але не валюту — валюта у платформи одна, і другий
      // її запис розійшовся б із першим рівно тоді, коли її поміняють.
      const config = await fetchPlatformConfig(
        options.program,
        platformConfigAddress(options.program.programId).address,
      )
      if (config === null) throw new DriveError('конфігурації платформи немає в мережі')

      await step(options, 'finalize', async () => [
        await finalizeRunIx({
          program: options.program,
          run: options.run,
          mint: config.mint,
          buyerTokens: associatedTokenAddress(run.buyer, config.mint, TOKEN_2022_PROGRAM_ID)
            .address,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        }),
      ])
    }
  }

  // Rent за буфер — ~0,49 SOL, і лишати його диспетчер не зобов'язаний нікому.
  // Помилка тут не валить прогону: він уже завершений, і невдале прибирання
  // означає лише те, що гроші полежать далі.
  await sweep(options)

  return { folds, run: await requireRun(options), elapsedMs: Date.now() - started }
}

/** Заливає вантаж батча в буфер, тримаючи кілька транзакцій у польоті. */
async function writeBatch(
  options: DriveOptions,
  payload: Uint8Array,
  dataset: number,
  batch: number,
): Promise<void> {
  const started = Date.now()
  const chunks = planWrites(payload)
  const limit = options.writeConcurrency ?? DEFAULT_WRITE_CONCURRENCY

  for (let at = 0; at < chunks.length; at += limit) {
    // Порядок між шматками довільний — кожен несе власний зсув, — тож хвиля
    // йде паралельно. Хвилями, а не всі 79 одразу: локальний валідатор
    // відкидає надлишок як `TransactionExpired`, і виглядає це як помилка
    // програми.
    await Promise.all(
      chunks.slice(at, at + limit).map(async (chunk) =>
        send(options, [
          await writeBatchIx({
            ...context(options),
            offset: chunk.offset,
            bytes: chunk.bytes,
          }),
        ]),
      ),
    )
  }

  options.onProgress?.({
    stage: 'write',
    dataset,
    batch,
    elapsedMs: Date.now() - started,
    note: `${chunks.length} транзакцій`,
  })
}

/** Прибирає накопичувач і буфер, якщо вони ще живі. */
async function sweep(options: DriveOptions): Promise<void> {
  for (const build of [closeBatchBufferIx, closeAccumulatorIx]) {
    const started = Date.now()
    try {
      await send(options, [await build(context(options))])
      options.onProgress?.({ stage: 'sweep', elapsedMs: Date.now() - started })
    } catch (error) {
      options.onProgress?.({
        stage: 'sweep',
        elapsedMs: Date.now() - started,
        note: `не прибрано: ${describe(error)}`,
      })
    }
  }
}

function context(options: DriveOptions) {
  return {
    program: options.program,
    dispatcher: options.dispatcher.publicKey,
    run: options.run,
  }
}

function offset() {
  return { computationOffset: freshComputationOffset() }
}

async function requireRun(options: DriveOptions): Promise<RunAccount> {
  const run = await fetchRun(options.program, options.run)
  if (run === null) throw new DriveError(`прогону ${options.run.toBase58()} немає в мережі`)
  return run
}

/** Виконує один крок і повідомляє про нього. */
async function step(
  options: DriveOptions,
  stage: ProgressStage,
  build: () => Promise<TransactionInstruction[]>,
  extra: Omit<Progress, 'stage' | 'elapsedMs'> = {},
): Promise<void> {
  const started = Date.now()
  await send(options, await build())
  options.onProgress?.({ stage, elapsedMs: Date.now() - started, ...extra })
}

async function send(
  options: DriveOptions,
  instructions: TransactionInstruction[],
): Promise<string> {
  const { blockhash } = await options.connection.getLatestBlockhash('confirmed')
  const message = new TransactionMessage({
    payerKey: options.dispatcher.publicKey,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message()

  const transaction = new VersionedTransaction(message)
  transaction.sign([options.dispatcher])

  const signature = await options.connection.sendTransaction(transaction, {
    // Симуляція тут — зайвий круг до RPC на кожній з ~24 700 транзакцій
    // запису, а всі перевірки програми ми й так побачимо у підтвердженні.
    skipPreflight: true,
    maxRetries: 3,
  })
  const status = await options.connection.confirmTransaction(
    {
      signature,
      blockhash,
      lastValidBlockHeight: (await options.connection.getBlockHeight()) + 150,
    },
    'confirmed',
  )
  if (status.value.err !== null) {
    throw new DriveError(`транзакція ${signature} відхилена: ${JSON.stringify(status.value.err)}`)
  }
  return signature
}

/**
 * Чекає, поки ланцюг покаже, що callback прийшов.
 *
 * Опитуванням, а не підпискою: callback приходить окремою транзакцією від
 * вузлів, і `onAccountChange` мовчки губить оновлення при переприєднанні
 * сокета. Тут потрібна не швидкість, а те, щоб зависання називалося
 * зависанням.
 */
async function waitFor(
  options: DriveOptions,
  what: string,
  done: () => Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + (options.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS)

  while (Date.now() < deadline) {
    if (await done()) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }

  throw new DriveError(
    `не дочекались: ${what}. Обчислення в черзі Arcium не повернулось за ` +
      `${options.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS} мс — дивись лог MPC-вузлів`,
  )
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
