/**
 * Наскрізний сценарій «каталог → результат» на локальному стенді (`T030`).
 *
 * Пул за замовчуванням — продуктове рішення 2026-09-14: **три датасети,
 * 64 + 64 + 9 записів**. Два повні дають по дві згортки кожен, третій навмисно
 * нижчий за поріг `MIN_CONTRIBUTION`, щоб придушення когорти (`T019`) і
 * розподіл надлишку середньою ціною пулу (`T026`) пройшли живими, а не
 * лишились доведеними тільки на стенді `mollusk`. Стандартний датасет на
 * 10 000 записів — це `T033`, і сюди він не поміщається за часом.
 *
 * Сценарій **не міряє** `SC-010`: він створює умови й доводить прогін до
 * кінця. Міряє й звіряє `tools/audit-verify`, і робить це не нашим кодом —
 * інакше вимір нічого не доводив би третій стороні (`FR-025`).
 */

import type { AnchorProvider } from '@anchor-lang/core'
import { getMXEPublicKey } from '@arcium-hq/client'
import type { DatasetRecord } from '@genovault/crypto'
import type { GenoVaultProgram } from '@genovault/sdk'
import type { FrequenciesParams } from '@genovault/shared'
import { buyerCategoryBit, useTypeBit } from '@genovault/shared'
import type { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { RECIPE_MARKERS } from './layout.ts'
import type { DatasetPlan, OrderedRun, SeededDataset } from './seed.ts'
import { orderRun, seedDatasets } from './seed.ts'

export class ScenarioError extends Error {
  override readonly name = 'ScenarioError'
}

/** Скільки записів у кожному датасеті пулу за замовчуванням. */
export const DEFAULT_POOL_SIZES = [64, 64, 9] as const

/**
 * Синтетична когорта з відомою наперед структурою.
 *
 * Детермінована за побудовою: `seed` входить у кожне значення, тож два запуски
 * сценарію дають ті самі записи. Без цього звірка `SC-002` (`T032`) не мала б
 * із чим порівнювати, а падіння прогону не відтворювалося б.
 *
 * Це **не** генератор із `tools/gen-dataset`: той робить датасет із причинними
 * маркерами під звірку якості, і кожен його запис коштує часу шифрування. Тут
 * потрібна рівно форма запису, а не правдоподібна генетика.
 */
export function syntheticRecords(count: number, seed: number): DatasetRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const base = seed * 7919 + index * 104_729
    return {
      sex: (base % 2) as 0 | 1,
      age: 18 + (base % 62),
      affected: (base % 3 === 0 ? 1 : 0) as 0 | 1,
      genotypes: Array.from({ length: RECIPE_MARKERS }, (_, marker) => (base + marker * 31) % 3),
    }
  })
}

export interface ScenarioOptions {
  connection: Connection
  provider: AnchorProvider
  program: GenoVaultProgram
  /** Власники датасетів — по одному на кожен розмір із `sizes`. */
  owners: Keypair[]
  buyer: Keypair
  dispatcher: PublicKey
  mint: PublicKey
  storageDir: string
  nonce: bigint
  sizes?: readonly number[]
  /** Ціна за 1000 записів. Різна на датасет — інакше середня ціна пулу нічого не показує. */
  prices?: readonly bigint[]
  maxEscrow: bigint
  params?: FrequenciesParams
  onProgress?(note: string): void
}

export interface Scenario {
  datasets: SeededDataset[]
  order: OrderedRun
  /** Публічний ключ MXE, на який шифрувався пул. */
  mxePublicKey: Uint8Array
}

/** Фільтри за замовчуванням: беремо всіх, кого пустила згода. */
export const DEFAULT_PARAMS: FrequenciesParams = {
  minAge: 0,
  maxAge: 255,
  sex: 'any',
  affected: 'any',
}

/**
 * Готує пул і замовляє прогін.
 *
 * Публічний ключ MXE читається з мережі, а не задається: датасет, зашифрований
 * на чужий кластер, розшифрувати не зможе ніхто, і побачили б ми це як
 * обчислення, що повернулось сміттям.
 */
export async function prepareScenario(options: ScenarioOptions): Promise<Scenario> {
  const sizes = options.sizes ?? DEFAULT_POOL_SIZES
  const prices = options.prices ?? sizes.map((_, index) => BigInt(1_000 * (index + 1)))

  if (options.owners.length !== sizes.length) {
    throw new ScenarioError(
      `власників ${options.owners.length}, а датасетів ${sizes.length} — по одному на датасет`,
    )
  }
  if (prices.length !== sizes.length) {
    throw new ScenarioError(`цін ${prices.length}, а датасетів ${sizes.length}`)
  }

  const mxePublicKey = await getMXEPublicKey(options.provider, options.program.programId)
  if (mxePublicKey === null) {
    throw new ScenarioError(
      'MXE ще не має публічного ключа — keygen кластера не завершився; дивись лог `arcium localnet`',
    )
  }

  // Дозволяємо рівно той тип використання, який замовляє покупець, і рівно ту
  // категорію, до якої він належить. Ширша згода зробила б `SC-004` тестом ні
  // про що: прогін пройшов би й тоді, коли перевірка не працює взагалі.
  const allowedUses = useTypeBit('populationGenetics')
  const buyerCategories = buyerCategoryBit('academic')

  const plans: DatasetPlan[] = sizes.map((size, index) => ({
    id: `e2e-${index}-${options.nonce.toString(16)}`.slice(0, 32),
    owner: pick(options.owners, index),
    records: syntheticRecords(size, index + 1),
    pricePer1k: pick(prices, index),
    allowedUses,
    forbiddenUses: 0,
    buyerCategories,
    expiresAt: null,
  }))

  const datasets = await seedDatasets({
    connection: options.connection,
    program: options.program,
    mxePublicKey,
    storageDir: options.storageDir,
    plans,
    onProgress: (id, note) => options.onProgress?.(`${id}: ${note}`),
  })

  const order = await orderRun({
    connection: options.connection,
    program: options.program,
    buyer: options.buyer,
    mint: options.mint,
    dispatcher: options.dispatcher,
    nonce: options.nonce,
    useType: allowedUses,
    buyerCategory: buyerCategories,
    maxEscrow: options.maxEscrow,
    params: options.params ?? DEFAULT_PARAMS,
    datasets,
  })
  options.onProgress?.(`прогін замовлено: ${order.run.toBase58()}`)

  return { datasets, order, mxePublicKey }
}

function pick<T>(list: readonly T[], index: number): T {
  const item = list.at(index)
  if (item === undefined) throw new ScenarioError(`немає елемента ${index} серед ${list.length}`)
  return item
}
