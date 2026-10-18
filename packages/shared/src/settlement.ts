import {
  BPS_DENOMINATOR,
  type Bps,
  type PricePer1k,
  type TokenAmount,
  tokenAmountSchema,
} from './primitives.ts'
import { RECORDS_PER_PRICE_UNIT } from './quote.ts'

/**
 * Розподіл плати за прогін — дзеркало `programs/genovault/src/state/settlement.rs`
 * (`T027`, `FR-018b`, `FR-019`).
 *
 * # Навіщо друга копія формули
 *
 * Екран нарахувань (`T048`) і картка прогону мусять показувати ті самі числа,
 * що нарахує програма, **не питаючи ланцюг**: до `settle_dataset` цих чисел
 * ончейн ще немає — є лише внески, оголошені при закритті датасетів, — а
 * власник хоче бачити свою частку тоді ж, коли бачить завершений прогін.
 * Порахувати її можна лише повторивши формулу.
 *
 * Два незалежні написання однієї формули розходяться завжди, тому це не
 * «своя реалізація», а дослівний переказ: ті самі гілки, ті самі напрямки
 * заокруглення, ті самі ранні виходи. Розходження стереже
 * `tests/settlement.test.ts` — і числами (ті самі випадки, що в юніт-тестах
 * програми), і текстом (регекс по `settlement.rs`: зміна формули там валить
 * тест тут).
 *
 * # Rule
 *
 * MPC returns two numbers: the cohort size (`recordsIncluded` of the run, `R`)
 * and each dataset's own contribution (`recordsIncluded` of the row, `C` in
 * total). They need not match: a dataset whose contribution did not reach
 * `MIN_CONTRIBUTION` declares zero, but its records are already in the cohort.
 * For that surplus the buyer pays at the pool average — every contribution
 * scaled by `R / C` (decision 2026-09-07, `T019` + `T026`). A dataset above the
 * floor is paid exactly its own price for its own records; the rest of the
 * bill is split equally between the datasets under the floor, the ones the
 * surplus came from (`T043`, 2026-10-18).
 *
 * The ceiling is the escrow. When the pool average comes out above the price
 * the escrow was computed from (an expensive dataset gave everything, a cheap
 * one was suppressed), the surplus gets what is left after the owners above
 * the floor are paid. The buyer never pays more than they locked — and it is
 * the ceiling, not the arithmetic, that keeps `FR-015a` in pools with a cheap
 * silent dataset next to an expensive loud one.
 */

const U64_MAX = 0xffff_ffff_ffff_ffffn

/** Чому розрахунок неможливий. Назви дублюють помилки програми. */
export const SETTLEMENT_ERRORS = [
  /** `RunDatasetIndexOutOfRange` — індексу поза пулом не існує. */
  'dataset-index-out-of-range',
  /** `RunSettlementOverflow` — сума не вміщається в `u64`. */
  'overflow',
  /**
   * `RunRecordsBelowContributions` — когорта менша за суму оголошених внесків.
   * Ончейн такого стану не буває: `record_reveal` його не приймає.
   */
  'records-below-contributions',
] as const

export type SettlementErrorReason = (typeof SETTLEMENT_ERRORS)[number]

export class SettlementError extends Error {
  readonly reason: SettlementErrorReason

  constructor(reason: SettlementErrorReason, message: string) {
    super(message)
    this.name = 'SettlementError'
    this.reason = reason
  }
}

/**
 * Датасет у складі прогону — дзеркало `RunDataset`.
 *
 * `belowFloor` окремо від нульового внеску навмисно, як і ончейн: для власника
 * «не дав жодного запису під фільтр» і «дав, але замало, щоб про це говорити» —
 * різні речі, хоч для гаманця однакові.
 */
export interface SettlementDataset {
  readonly pricePer1k: PricePer1k
  /** Оголошений внесок. Нуль, поки датасет не закрито, і нуль назавжди, якщо не дотяг до порога. */
  readonly recordsIncluded: number
  readonly belowFloor: boolean
  readonly settled: boolean
}

/**
 * Те, що потрібно від прогону для розрахунку.
 *
 * Структурний тип, а не декодований акаунт із `packages/sdk`: `shared` лежить
 * нижче за sdk і не має про нього знати, а рахувати ті самі числа треба і по
 * тому, що приїхало з ланцюга, і по тому, що API склав із власного дзеркала.
 */
export interface SettlementRun {
  readonly escrowAmount: TokenAmount
  readonly feeBps: Bps
  /** Розмір когорти `R` — скільки записів увійшло всього. */
  readonly recordsIncluded: number
  /** Когорта менша за `MIN_COHORT`: звіт із нулів (`FR-012`). */
  readonly suppressed: boolean
  readonly datasets: readonly SettlementDataset[]
}

/** Сума оголошених внесків `C` — дзеркало `Run::contributed_records`. */
export function contributedRecords(run: SettlementRun): bigint {
  return run.datasets.reduce((sum, entry) => sum + BigInt(entry.recordsIncluded), 0n)
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator === 0n) return 0n
  return (numerator - 1n) / denominator + 1n
}

/**
 * Межа перевіряється до `parse`, а не після: `tokenAmountSchema` теж відхилить
 * завелике число, але помилкою Zod, а не названою відмовою програми — і
 * викликач не відрізнить переповнення від зіпсованого входу.
 */
function toU64(amount: bigint, what: string): TokenAmount {
  if (amount > U64_MAX) throw new SettlementError('overflow', `${what} does not fit in u64`)
  return tokenAmountSchema.parse(amount)
}

/**
 * Пул, у якому мовчать усі (`T027a`) — дзеркало `silent_pool_share`.
 *
 * Коли `C = 0`, масштабу `R / C` нема на що множити, і основна гілка віддала б
 * нуль усім при розкритій когорті: покупець отримав би звіт безкоштовно, а
 * вузьким фільтром — і безкоштовний зонд. Ціна тут — **найнижча ненульова**
 * ціна серед мовчазних за весь `R`, поділена **порівну** між `belowFloor`.
 * Ненульова, бо один безкоштовний датасет у пулі інакше знову зробив би весь
 * пул безкоштовним; порівну, бо внесків тут немає — усі оголосили нуль.
 * Залишок від ділення повертається покупцю: порядок пулу називає покупець, і
 * він не має вирішувати, кому перепаде зайва одиниця.
 */
function silentPool(run: SettlementRun): { full: bigint; recipients: number } {
  const silent = run.datasets.filter((other) => other.belowFloor)
  const priced = silent.filter((other) => other.pricePer1k > 0n)
  const records = BigInt(run.recordsIncluded)
  if (records === 0n || priced.length === 0) return { full: 0n, recipients: silent.length }

  const lowest = priced.reduce(
    (min, other) => (other.pricePer1k < min ? other.pricePer1k : min),
    priced[0]?.pricePer1k ?? 0n,
  )
  return { full: ceilDiv(lowest * records, RECORDS_PER_PRICE_UNIT), recipients: silent.length }
}

function silentShare(run: SettlementRun, entry: SettlementDataset, cap: boolean): bigint {
  if (!entry.belowFloor) return 0n

  const { full, recipients } = silentPool(run)
  if (full === 0n || recipients === 0) return 0n

  const escrow = run.escrowAmount as bigint
  const total = cap && full > escrow ? escrow : full
  return total / BigInt(recipients)
}

/** What a dataset above the floor is paid — mirror of `own_price`. */
function ownPrice(entry: SettlementDataset): bigint {
  return ceilDiv(entry.pricePer1k * BigInt(entry.recordsIncluded), RECORDS_PER_PRICE_UNIT)
}

/** Everything the owners above the floor earned at their own prices. */
function earnedTotal(run: SettlementRun): bigint {
  return run.datasets.reduce((sum, other) => sum + ownPrice(other), 0n)
}

/**
 * The buyer's bill before the ceiling — mirror of `pool_bill`: every
 * contribution at the pool average, that is, scaled by `R / C`.
 */
function poolBill(run: SettlementRun, records: bigint, contributed: bigint): bigint {
  return run.datasets.reduce(
    (sum, other) =>
      sum +
      ceilDiv(
        other.pricePer1k * BigInt(other.recordsIncluded) * records,
        contributed * RECORDS_PER_PRICE_UNIT,
      ),
    0n,
  )
}

/** One equal share of the surplus — mirror of `surplus_share`. */
function surplusShare(run: SettlementRun, surplus: bigint): bigint {
  const recipients = run.datasets.filter((other) => other.belowFloor).length
  if (recipients === 0) return 0n
  return surplus / BigInt(recipients)
}

/** Повна ціна внеску за правилом розподілу, без стелі депозиту. */
function uncappedFor(run: SettlementRun, index: number): bigint {
  const entry = run.datasets[index]
  if (entry === undefined) {
    throw new SettlementError('dataset-index-out-of-range', `dataset ${index} is not in the pool`)
  }

  const records = BigInt(run.recordsIncluded)
  const contributed = contributedRecords(run)
  if (contributed === 0n) return silentShare(run, entry, false)
  if (!entry.belowFloor) return ownPrice(entry)

  const bill = poolBill(run, records, contributed)
  const earned = earnedTotal(run)
  return surplusShare(run, bill > earned ? bill - earned : 0n)
}

/**
 * Скільки покупець платить за внесок датасету під індексом `index` — дзеркало
 * `gross_for` до найменшої одиниці.
 *
 * A dataset above the floor is paid its own price for its own records, rounded
 * up as in the upper bound (`FR-015a`) — otherwise a contribution of fewer than
 * a thousand records would cost nothing. The surplus, `R − C` at the pool
 * average, is split equally between the datasets under the floor (`T043`):
 * a dataset of one person (`FR-009`) is always under a floor of ten, and
 * before this it could not earn in any pool where someone cleared it. Shares
 * of a finite sum are rounded down, and the remainder goes back to the buyer.
 *
 * Вхід не перевіряється на узгодженість (`R ≥ C`) навмисно: `gross_for` ончейн
 * теж не перевіряє, бо цей стан не пропускає `record_reveal`. Перевірка живе в
 * `settleRun`, який рахує весь прогін і має що звіряти.
 */
export function grossFor(run: SettlementRun, index: number): TokenAmount {
  const entry = run.datasets[index]
  if (entry === undefined) {
    throw new SettlementError('dataset-index-out-of-range', `dataset ${index} is not in the pool`)
  }
  // Мовчазний пул має власну стелю й ділиться порівну, а не пропорційно
  // заробленому: ділити тут нема на що — усі оголосили нуль.
  const records = BigInt(run.recordsIncluded)
  const contributed = contributedRecords(run)
  if (contributed === 0n) {
    return toU64(silentShare(run, entry, true), 'payout')
  }

  const escrow = run.escrowAmount as bigint
  const earned = earnedTotal(run)

  if (earned > escrow) {
    // Unreachable while contributions do not exceed claimed volumes, and
    // guarded rather than assumed: split what there is in proportion to what
    // was earned. Each share is rounded down, so their sum fits.
    const base = entry.pricePer1k * BigInt(entry.recordsIncluded)
    if (base === 0n) return toU64(0n, 'payout')
    const totalBase = run.datasets.reduce(
      (sum, other) => sum + other.pricePer1k * BigInt(other.recordsIncluded),
      0n,
    )
    return toU64((escrow * base) / totalBase, 'payout')
  }

  if (!entry.belowFloor) return toU64(ownPrice(entry), 'payout')

  const full = poolBill(run, records, contributed)
  const bill = full < escrow ? full : escrow
  return toU64(surplusShare(run, bill > earned ? bill - earned : 0n), 'payout')
}

/**
 * Комісія платформи з нарахування — дзеркало `platform_fee` (`FR-019`).
 *
 * Береться **з нарахування власника**, а не додається до рахунку покупця:
 * покупець платить рівно те, що бачив у квоті. Заокруглення вниз — на користь
 * власника: залишок від ділення лишається йому, а не платформі, і сходження
 * сум від цього не страждає, бо частка власника рахується відніманням.
 */
export function platformFee(gross: TokenAmount, feeBps: Bps): TokenAmount {
  return toU64((gross * BigInt(feeBps)) / BPS_DENOMINATOR, 'fee')
}

/** Нарахування одному датасету з розкладеною стелею. */
export interface SettlementLine {
  readonly index: number
  readonly pricePer1k: PricePer1k
  readonly recordsIncluded: number
  readonly belowFloor: boolean
  readonly settled: boolean
  /** Скільки платить покупець — рівно те, що нарахує програма. */
  readonly gross: TokenAmount
  /** Скільки платив би за правилом розподілу, якби депозит не був стелею. */
  readonly grossUncapped: TokenAmount
  /** `gross < grossUncapped`: частку обрізала стеля депозиту. */
  readonly escrowCapped: boolean
  readonly fee: TokenAmount
  /** Частка власника після комісії — те, що ляже на `OwnerBalance`. */
  readonly net: TokenAmount
}

/**
 * Розподіл усього прогону.
 *
 * `escrowShortfall` є тут через рішення 2026-09-07: екран нарахувань показує
 * власнику **обидва** числа й прапорець. Різниця виникає не з помилки, а з
 * того, що депозит покупця рахувався за нижчою ціною, ніж вийшла середня по
 * пулу, — і власник, який бачить лише менше число, шукатиме винного там, де
 * його немає.
 */
export interface RunSettlement {
  readonly lines: readonly SettlementLine[]
  readonly grossTotal: TokenAmount
  readonly feeTotal: TokenAmount
  /** Сума часток власників після комісії. */
  readonly ownersTotal: TokenAmount
  /** Різниця, що повертається покупцю (`FR-016`) — дзеркало `Run::refund_amount`. */
  readonly refund: TokenAmount
  /** Скільки власники недоотримали через стелю депозиту, на весь прогін. */
  readonly escrowShortfall: TokenAmount
  readonly escrowCapped: boolean
}

/**
 * Рахує розподіл цілком і тримає `SC-006`: `ownersTotal + feeTotal + refund`
 * дорівнює депозиту до найменшої одиниці.
 *
 * `refund` рахується як `escrow − Σ gross`, а не читається з `Run.settled_amount`:
 * поле ончейн наповнюється порціями, і показувати недорахований залишок як
 * «різницю до повернення» означало б показувати неправду, поки йдуть
 * нарахування. Числа сходяться, бо `finalize_run` вимагає, щоб нараховано було
 * всім.
 */
export function settleRun(run: SettlementRun): RunSettlement {
  const contributed = contributedRecords(run)
  if (BigInt(run.recordsIncluded) < contributed) {
    throw new SettlementError(
      'records-below-contributions',
      `cohort ${run.recordsIncluded} is smaller than the sum of contributions ${contributed}`,
    )
  }

  const lines = run.datasets.map((entry, index): SettlementLine => {
    const gross = grossFor(run, index)
    const grossUncapped = toU64(uncappedFor(run, index), 'payout')
    const fee = platformFee(gross, run.feeBps)
    return {
      index,
      pricePer1k: entry.pricePer1k,
      recordsIncluded: entry.recordsIncluded,
      belowFloor: entry.belowFloor,
      settled: entry.settled,
      gross,
      grossUncapped,
      escrowCapped: gross < grossUncapped,
      fee,
      net: tokenAmountSchema.parse(gross - fee),
    }
  })

  const sum = (pick: (line: SettlementLine) => TokenAmount): bigint =>
    lines.reduce((total, line) => total + pick(line), 0n)

  const grossTotal = sum((line) => line.gross)
  const escrow = run.escrowAmount as bigint
  if (grossTotal > escrow) {
    throw new SettlementError('overflow', 'the payouts exceed the escrow')
  }

  const shortfall = sum((line) => line.grossUncapped) - grossTotal

  return {
    lines,
    grossTotal: tokenAmountSchema.parse(grossTotal),
    feeTotal: tokenAmountSchema.parse(sum((line) => line.fee)),
    ownersTotal: tokenAmountSchema.parse(sum((line) => line.net)),
    refund: tokenAmountSchema.parse(escrow - grossTotal),
    escrowShortfall: tokenAmountSchema.parse(shortfall > 0n ? shortfall : 0n),
    escrowCapped: lines.some((line) => line.escrowCapped),
  }
}
