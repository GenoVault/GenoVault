/**
 * Наскрізний шлях покупця «каталог → результат», виміряний і звірений (`T030`, `SC-010`).
 *
 * # Що саме міряється
 *
 * Продуктове рішення 2026-09-14: **два числа, і обидва названі вголос**.
 *
 * 1. **Активний час покупця** — те, за що відповідає інтерфейс: прочитати пул,
 *    прочитати стан прогону, прочитати й розшифрувати звіт. Очікування MPC сюди
 *    не входить, бо це `SC-003`, і в нього свій бюджет. Це й є критерій
 *    `SC-010` ≤ 3 хвилини.
 * 2. **Wall-clock до результату** — від хвилини, коли ланцюг прийняв
 *    замовлення, до хвилини, коли в ньому з'явився звіт. Береться з часу блоків,
 *    а не з нашого секундоміра: це число мусить бути перевірним третьою
 *    стороною, і воно є.
 *
 * Друге число прив'язане до розміру демо-пулу й окремо ним і підписується.
 * Читати його як твердження про продукт узагалі — помилка, від якої застерігає
 * саме визначення віх.
 *
 * # Чому вимір живе у звірячі
 *
 * Бо разом із часом він віддає **вердикт**: ланцюжок відбитків зійшовся чи ні,
 * внески узгоджені чи ні, звіт розшифровується ключем покупця чи ні. Час без
 * вердикту — це «щось відбулося за стільки-то секунд», і продавати це як
 * пройдений критерій не можна.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AnchorProvider, Wallet } from '@anchor-lang/core'
import { getMXEPublicKey } from '@arcium-hq/client'
import type { Connection } from '@solana/web3.js'
import { Keypair, PublicKey } from '@solana/web3.js'
import type { Run, RunResult } from './chain.ts'
import { decodeRun, decodeRunResult, fetchAccount } from './chain.ts'
import type { ChainVerdict, DatasetSource } from './fold-chain.ts'
import { equalBytes, hex, verifyFoldChain } from './fold-chain.ts'
import type { Report } from './report.ts'
import { decryptReport, loadReportLayout } from './report.ts'

export class AuditError extends Error {
  override readonly name = 'AuditError'
}

const RESULT_SEED = new TextEncoder().encode('result')

/** `["result", run]` — seeds публічні, тож звіряч виводить адресу сам. */
export function runResultAddress(run: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([RESULT_SEED, run.toBuffer()], programId)[0]
}

export interface AuditOptions {
  connection: Connection
  programId: PublicKey
  run: PublicKey
  /** Тека з конвертами: `<адреса датасету>.gvds`. Шифротекст публічний. */
  storageDir: string
  /** Приватна половина ключа звіту. Без неї шлях покупця не закінчується. */
  buyerSecretKey: Uint8Array
  /** Шлях до `build/circuits.ts` — вивід `arcium build`, не наш код. */
  circuitsModulePath: string
}

export interface Timings {
  /** Скільки звіряч витратив на кроки покупця, що не є очікуванням. */
  activeMs: number
  /** Розкладка активного часу по кроках — щоб було видно, що саме довге. */
  steps: { step: string; ms: number }[]
  /** Від замовлення до звіту, з часу блоків. `null` — RPC не віддав часу блоку. */
  wallClockSeconds: number | null
  orderedAt: number
  resultAt: number | null
}

export interface Audit {
  run: Run
  result: RunResult
  report: Report
  chain: ChainVerdict
  timings: Timings
  /** Розбіжності, кожна — окремим реченням. Порожній список і є «зійшлося». */
  problems: string[]
}

/**
 * Проходить шлях покупця й одразу звіряє те, що на ньому побачив.
 *
 * Кожен крок міряється окремо: «три хвилини» без розкладки не кажуть, чи
 * впирається шлях у мережу, у шифр, чи в наш код.
 */
export async function auditBuyerPath(options: AuditOptions): Promise<Audit> {
  const steps: { step: string; ms: number }[] = []
  const timed = async <T>(step: string, work: () => Promise<T> | T): Promise<T> => {
    const started = Date.now()
    const value = await work()
    steps.push({ step, ms: Date.now() - started })
    return value
  }

  const run = await timed('прочитати прогін', async () =>
    decodeRun(await fetchAccount(options.connection, options.run, 'прогін')),
  )

  const resultAddress = runResultAddress(options.run, options.programId)
  const result = await timed('прочитати звіт', async () =>
    decodeRunResult(await fetchAccount(options.connection, resultAddress, 'результат прогону')),
  )

  // Каталог покупця — це конверти пулу зі сховища. Читаються тут, бо саме
  // їхній обсяг покупець і чекає на екрані: 64 записи це ~430 КіБ шифротексту.
  const sources = await timed('прочитати пул зі сховища', async () =>
    Promise.all(
      run.datasets.map(async (entry): Promise<DatasetSource> => {
        const address = new PublicKey(entry.dataset)
        return {
          address: entry.dataset,
          envelope: Uint8Array.from(
            await readFile(join(options.storageDir, `${address.toBase58()}.gvds`)),
          ),
        }
      }),
    ),
  )

  const report = await timed('розшифрувати звіт', async () =>
    decryptReport({
      buyerSecretKey: options.buyerSecretKey,
      mxePublicKey: await mxeKey(options),
      nonce: result.nonce,
      ciphertexts: result.ciphertexts,
      layout: await loadReportLayout(options.circuitsModulePath),
    }),
  )

  // Звірка ланцюжка — робота звіряча, а не покупця, тож в активний час не йде.
  const chain = verifyFoldChain(sources, run.foldedHash, run.foldedBatches)

  const resultAt = await firstBlockTime(options.connection, resultAddress)
  const orderedAt = Number(run.createdAt)

  return {
    run,
    result,
    report,
    chain,
    timings: {
      activeMs: steps.reduce((total, step) => total + step.ms, 0),
      steps,
      wallClockSeconds: resultAt === null ? null : resultAt - orderedAt,
      orderedAt,
      resultAt,
    },
    problems: collectProblems(options.run, run, result, report, chain),
  }
}

/**
 * Публічний ключ MXE-кластера — з мережі, не з чужих слів.
 *
 * Читається бібліотекою Arcium, а не нашою: незалежність звіряча про **наш**
 * код, а не про криптографію взагалі. Гаманець провайдеру потрібен формально —
 * тут нічого не підписується, тож пара одноразова.
 */
async function mxeKey(options: AuditOptions): Promise<Uint8Array> {
  const provider = new AnchorProvider(options.connection, new Wallet(Keypair.generate()), {
    commitment: 'confirmed',
  })
  const key = await getMXEPublicKey(provider, options.programId)
  if (key === null)
    throw new AuditError('у MXE немає публічного ключа — кластер не завершив keygen')
  return key
}

/**
 * Час блоку, в якому акаунт з'явився.
 *
 * Підписи повертаються від найновішого; найстаріший і є той, що акаунт
 * створив. `null` замість помилки навмисно: RPC має право не тримати історію,
 * і відсутність часу блоку — це відсутність числа, а не невдала перевірка.
 */
async function firstBlockTime(connection: Connection, address: PublicKey): Promise<number | null> {
  const signatures = await connection.getSignaturesForAddress(address, { limit: 1000 }, 'confirmed')
  const oldest = signatures.at(-1)
  if (oldest === undefined) return null
  if (oldest.blockTime != null) return oldest.blockTime

  // Локальний валідатор часто віддає підписи без часу блоку. Слот у нього є
  // завжди, і час слота — окремий виклик; якщо й він порожній, числа просто
  // немає, і звіряч так і каже.
  try {
    return await connection.getBlockTime(oldest.slot)
  } catch {
    return null
  }
}

/**
 * Усі розбіжності, які звіряч може назвати, не маючи нашого коду.
 *
 * Список, а не перший знайдений збій: покупцю, який дивиться на звіт, потрібно
 * знати все, що з ним не так, а не найперше.
 */
function collectProblems(
  address: PublicKey,
  run: Run,
  result: RunResult,
  report: Report,
  chain: ChainVerdict,
): string[] {
  const problems: string[] = []

  if (!chain.matches) {
    problems.push(
      `ланцюжок відбитків не зійшовся: перерахунок дає ${hex(chain.computed)} на ` +
        `${chain.expectedFolds} згорток, ланцюг каже ${hex(chain.onChain)} на ${chain.actualFolds}`,
    )
  }

  // Адреса прогону в результаті — не формальність: `RunResult` виводиться з
  // seeds прогону, і акаунт, що вказує на інший, означає підмінений PDA.
  if (!equalBytes(result.run, Uint8Array.from(address.toBytes()))) {
    problems.push(
      `результат посилається на прогін ${new PublicKey(result.run).toBase58()}, ` +
        `а звіряли ${address.toBase58()}`,
    )
  }

  // Звіт адресований саме цьому покупцю: `encryption_key` — це його ключ.
  if (!equalBytes(result.encryptionKey, run.buyerX25519)) {
    problems.push('звіт зашифрований не на ключ покупця з акаунта прогону')
  }

  if (result.recordsIncluded !== run.recordsIncluded) {
    problems.push(
      `когорта в прогоні ${run.recordsIncluded}, а в результаті ${result.recordsIncluded}`,
    )
  }

  // Звіт зашифрований MPC; якщо він розкладається в число, відмінне від того,
  // що записав ланцюг, то одне з двох джерел не про цей прогін.
  if (Number(report.included) !== result.recordsIncluded) {
    problems.push(
      `у звіті ${report.included} записів когорти, а в акаунті результату ${result.recordsIncluded}`,
    )
  }

  const suppressed = report.suppressed === 1n
  if (suppressed !== result.suppressed) {
    problems.push(
      `придушення когорти: звіт каже ${suppressed}, акаунт результату — ${result.suppressed}`,
    )
  }

  // Внески датасетів не можуть у сумі перевищити когорту: записи датасету, чий
  // внесок придушено порогом, у когорту входять, а у внески — ні.
  const contributed = run.datasets.reduce((total, entry) => total + entry.recordsIncluded, 0)
  if (contributed > run.recordsIncluded) {
    problems.push(
      `сума внесків ${contributed} більша за когорту ${run.recordsIncluded} — так не буває`,
    )
  }

  if (run.status !== 'completed') {
    problems.push(`прогін у статусі ${run.status}, а не completed`)
  }

  if (!run.datasets.every((entry) => entry.settled) && run.status === 'completed') {
    problems.push('не всім датасетам пулу нараховано')
  }

  return problems
}
