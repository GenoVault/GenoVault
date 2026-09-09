import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { bpsSchema, pricePer1kSchema, tokenAmountSchema } from '../src/primitives.ts'
import {
  contributedRecords,
  grossFor,
  platformFee,
  SettlementError,
  type SettlementRun,
  settleRun,
} from '../src/settlement.ts'

/**
 * Числа тут — ті самі, що в юніт-тестах `state/settlement.rs`, і навмисно.
 * Дзеркало доводиться не тим, що обидві сторони «виглядають однаково», а тим,
 * що на однакових входах дають однакові виходи до найменшої одиниці.
 */

const FEE_BPS = bpsSchema.parse(700)

/** Прогін із заданими парами «ціна за 1000 · оголошений внесок». */
function run(escrow: bigint, recordsIncluded: number, pool: [bigint, number][]): SettlementRun {
  return {
    escrowAmount: tokenAmountSchema.parse(escrow),
    feeBps: FEE_BPS,
    recordsIncluded,
    suppressed: recordsIncluded === 0,
    datasets: pool.map(([price, records]) => ({
      pricePer1k: pricePer1kSchema.parse(price),
      recordsIncluded: records,
      belowFloor: records === 0,
      settled: false,
    })),
  }
}

const total = (settlement: SettlementRun): bigint => settleRun(settlement).grossTotal

describe('нарахування за внесок', () => {
  it('кожен власник отримує за записи, які увійшли', () => {
    // Ніхто не придушений: R = C, масштабу немає, кожен отримує рівно
    // «ціна × записи» — це і є `FR-018b` дослівно.
    const r = run(1_000_000n, 3_000, [
      [100_000n, 1_000],
      [50_000n, 2_000],
    ])

    expect(grossFor(r, 0)).toBe(100_000n)
    expect(grossFor(r, 1)).toBe(100_000n)
    expect(total(r)).toBe(200_000n)
  })

  it('придушені записи оплачуються середньою ціною пулу', () => {
    // Другий датасет дав 9 записів — під порогом, оголошено нуль. Але записи
    // в когорті, і покупець за них платить: R = 1009, C = 1000.
    const r = run(1_000_000n, 1_009, [
      [100_000n, 1_000],
      [100_000n, 0],
    ])

    // 100 000 × 1 000 × 1 009 / (1 000 × 1 000) = 100 900.
    expect(grossFor(r, 0)).toBe(100_900n)
    expect(grossFor(r, 1)).toBe(0n)
  })

  it('покупець ніколи не платить більше за депозит', () => {
    // Дорогий датасет дав усе, дешевий придушено: середня ціна пулу вища за ту,
    // з якої рахувалась верхня оцінка, і повна ціна за депозит не влазить.
    const r = run(100n, 109, [
      [1_000n, 100],
      [1n, 0],
    ])

    expect(grossFor(r, 0)).toBe(100n)
    expect(total(r)).toBe(100n)
    expect(total(r)).toBeLessThanOrEqual(r.escrowAmount)
  })

  it('датасет, дрібніший за тисячу записів, не безкоштовний', () => {
    // Те саме заокруглення вгору, що й у верхній оцінці: 9 записів за ціною
    // 1 000 це 9, а не нуль.
    expect(grossFor(run(1_000_000n, 9, [[1_000n, 9]]), 0)).toBe(9n)
  })

  it('придушена когорта не коштує нічого', () => {
    const r = run(1_000_000n, 0, [
      [100_000n, 0],
      [50_000n, 0],
    ])

    expect(total(r)).toBe(0n)
    expect(settleRun(r).refund).toBe(1_000_000n)
  })

  it('індексу поза пулом не існує', () => {
    const r = run(1_000n, 10, [[1_000n, 10]])
    expect(() => grossFor(r, 1)).toThrow(SettlementError)
    try {
      grossFor(r, 1)
      expect.unreachable('очікувалась відмова')
    } catch (error) {
      expect((error as SettlementError).reason).toBe('dataset-index-out-of-range')
    }
  })

  it('сума внесків рахується по всьому пулу', () => {
    expect(
      contributedRecords(
        run(1_000n, 3_000, [
          [1n, 1_000],
          [1n, 2_000],
        ]),
      ),
    ).toBe(3_000n)
  })
})

describe('комісія платформи', () => {
  it('береться з нарахування, а не додається до рахунку', () => {
    // 7% від 100 000 це 7 000, власник отримує 93 000 — а покупець платить ті
    // самі 100 000, які бачив у квоті (`FR-015a`).
    expect(platformFee(tokenAmountSchema.parse(100_000n), FEE_BPS)).toBe(7_000n)
    expect(platformFee(tokenAmountSchema.parse(0n), FEE_BPS)).toBe(0n)
  })

  it('заокруглюється вниз — залишок лишається власнику', () => {
    expect(platformFee(tokenAmountSchema.parse(99n), FEE_BPS)).toBe(6n)
  })

  it('нульова комісія лишає власнику все', () => {
    expect(platformFee(tokenAmountSchema.parse(12_345n), bpsSchema.parse(0))).toBe(0n)

    const zero = { ...run(1_000_000n, 1_000, [[100_000n, 1_000]]), feeBps: bpsSchema.parse(0) }
    const settlement = settleRun(zero)
    expect(settlement.feeTotal).toBe(0n)
    expect(settlement.ownersTotal).toBe(settlement.grossTotal)
  })
})

describe('розподіл усього прогону', () => {
  it('суми сходяться до депозиту — `SC-006`', () => {
    // Частки власників + комісія + різниця. Комісія береться з частки, тож
    // сходження перевіряється на трьох числах, а не на двох.
    const r = run(1_000_000n, 3_010, [
      [100_000n, 1_000],
      [50_000n, 2_000],
      [70_000n, 0],
    ])
    const settlement = settleRun(r)

    expect(settlement.ownersTotal + settlement.feeTotal + settlement.refund).toBe(r.escrowAmount)
    expect(settlement.grossTotal).toBeGreaterThan(200_000n)
    expect(settlement.escrowCapped).toBe(false)
    expect(settlement.escrowShortfall).toBe(0n)
  })

  it('називає, що частку обрізала стеля депозиту', () => {
    // Продуктове рішення 2026-09-07: екран нарахувань показує обидва числа й
    // прапорець. Власник, який бачить лише менше число, шукатиме винного там,
    // де його немає.
    const settlement = settleRun(
      run(100n, 109, [
        [1_000n, 100],
        [1n, 0],
      ]),
    )
    const line = settlement.lines[0]

    expect(line?.gross).toBe(100n)
    expect(line?.grossUncapped).toBe(109n)
    expect(line?.escrowCapped).toBe(true)
    expect(settlement.escrowCapped).toBe(true)
    expect(settlement.escrowShortfall).toBe(9n)
  })

  it('несе стан рядка, а не тільки числа', () => {
    // `belowFloor` і `settled` доходять до екрана незмінними: «не дав жодного
    // запису під фільтр» і «дав, але замало» — різні речі для власника.
    const settlement = settleRun(
      run(1_000_000n, 1_009, [
        [100_000n, 1_000],
        [100_000n, 0],
      ]),
    )

    expect(settlement.lines[1]?.belowFloor).toBe(true)
    expect(settlement.lines[1]?.net).toBe(0n)
    expect(settlement.lines.map((line) => line.index)).toEqual([0, 1])
  })

  it('когорта менша за суму внесків — відмова, а не тихий розрахунок', () => {
    // Ончейн такого стану не буває: `record_reveal` його не приймає. Але
    // проєкція, складена з чого завгодно, дала б тут числа, менші за чесні.
    const r = run(1_000_000n, 500, [[1_000n, 1_000]])
    expect(() => settleRun(r)).toThrow(SettlementError)
  })

  it('порожній пул нічого не коштує', () => {
    const settlement = settleRun(run(1_000n, 0, []))
    expect(settlement.grossTotal).toBe(0n)
    expect(settlement.refund).toBe(1_000n)
  })

  it('на випадкових пулах сума завжди сходиться', () => {
    // Детермінований генератор: тест, що падає раз на сто прогонів, не
    // доводить нічого й не відтворюється.
    let seed = 0x5eed
    const next = (limit: number) => {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fff_ffff
      return seed % limit
    }

    for (let trial = 0; trial < 500; trial += 1) {
      const pool = Array.from({ length: 1 + next(50) }, (): [bigint, number] => [
        BigInt(next(2_000_000)),
        next(2_000),
      ])
      const contributed = pool.reduce((sum, [, records]) => sum + records, 0)
      const escrow = pool.reduce(
        (sum, [price, records]) => sum + (price * BigInt(records) + 999n) / 1_000n,
        0n,
      )
      const settlement = settleRun(run(escrow, contributed + next(100), pool))

      expect(settlement.ownersTotal + settlement.feeTotal + settlement.refund).toBe(escrow)
      expect(settlement.grossTotal).toBeLessThanOrEqual(escrow)
    }
  })
})

describe('дзеркало формули', () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../programs/genovault/src/state/settlement.rs',
    ),
    'utf8',
  )

  /**
   * Числа збігаються рівно доти, доки збігаються формули. Тест на числах
   * зловить розходження лише на тих входах, які в ньому є; цей — на будь-якій
   * правці ончейн, яку сюди не переказали.
   */
  it('повна ціна масштабується на розмір когорти', () => {
    expect(source).toContain('ceil_div(base * records, contributed * unit)')
  })

  it('стеля ділить депозит пропорційно заробленому', () => {
    expect(source).toContain('escrow * base / total_base')
  })

  it('мовчазний пул рахується за найнижчою ненульовою ціною', () => {
    expect(source).toContain('other.below_floor && other.price_per_1k > 0')
    expect(source).toContain('ceil_div(lowest * records, RECORDS_PER_PRICE_UNIT as u128)')
  })

  it('мовчазний пул ділиться порівну, залишок лишається в депозиті', () => {
    expect(source).toContain('total / recipients')
  })

  it('нульовий внесок пулу йде в гілку мовчазного пулу, а не в основну', () => {
    // Без цієї розвилки основна гілка ділила б на нуль: `total_base` у пулі,
    // де ніхто не оголосив внеску, дорівнює нулю.
    expect(source).toContain('if contributed == 0 {')
    expect(source).toContain('return silent_pool_share(run, entry, records);')
  })

  it('рання відмова на нульовій ціні внеску лишається ранньою', () => {
    expect(source).toContain('if base == 0 {')
  })

  it('заокруглення вгору лишається вгору', () => {
    expect(source).toContain('(numerator - 1) / denominator + 1')
  })

  it('комісія заокруглюється вниз', () => {
    expect(source).toContain('/ BPS_DENOMINATOR as u128')
    expect(source).not.toMatch(/BPS_DENOMINATOR as u128\s*\+\s*1/)
  })

  it('різниця повертається як депозит мінус нараховане', () => {
    const runSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../programs/genovault/src/state/run.rs'),
      'utf8',
    )
    expect(runSource).toContain('self.escrow_amount.saturating_sub(self.settled_amount)')
  })
})

/**
 * Пул, у якому мовчать усі (`T027a`).
 *
 * Коли жоден датасет не дотягнув до `MIN_CONTRIBUTION`, `C = 0` і масштабу
 * `R / C` нема на що множити — основна гілка віддала б нуль усім при розкритій
 * когорті. Ціна тут — найнижча **ненульова** ціна серед мовчазних за весь `R`,
 * порівну між `belowFloor`, залишок повертається покупцю. Числа ті самі, що в
 * юніт-тестах `silent_pool_share`.
 */
describe('пул, у якому мовчать усі', () => {
  it('не безкоштовний: найнижча ціна пулу, порівну', () => {
    // 450 записів у когорті, ceil(1 000 × 450 / 1 000) = 450 на трьох.
    const r = run(1_000_000n, 450, [
      [1_000n, 0],
      [2_000n, 0],
      [3_000n, 0],
    ])

    expect(grossFor(r, 0)).toBe(150n)
    expect(grossFor(r, 1)).toBe(150n)
    expect(grossFor(r, 2)).toBe(150n)
    expect(settleRun(r).grossTotal).toBe(450n)
  })

  it('безкоштовний датасет не обнуляє пул', () => {
    // Один датасет із ціною 0 — консорціумний або зареєстрований покупцем саме
    // заради цього — не має робити безкоштовним увесь пул.
    const r = run(1_000_000n, 100, [
      [0n, 0],
      [1_000n, 0],
    ])

    expect(settleRun(r).grossTotal).toBe(100n)
    // Названа ціна рішення: платимо й тому, хто віддав дані безкоштовно —
    // `belowFloor` не відрізняє «дав, але замало» від «не дав нічого».
    expect(grossFor(r, 0)).toBe(50n)
    expect(grossFor(r, 1)).toBe(50n)
  })

  it('пул із самих нульових цін чесно коштує нуль', () => {
    const settlement = settleRun(
      run(1_000_000n, 100, [
        [0n, 0],
        [0n, 0],
      ]),
    )

    expect(settlement.grossTotal).toBe(0n)
    expect(settlement.refund).toBe(1_000_000n)
  })

  it('залишок від ділення повертається покупцю', () => {
    // 450 на чотирьох — 112 кожному й 2 одиниці залишку. Порядок пулу називає
    // покупець, і він не має вирішувати, кому перепаде зайва одиниця.
    const r = run(1_000_000n, 450, [
      [1_000n, 0],
      [1_000n, 0],
      [1_000n, 0],
      [1_000n, 0],
    ])
    const settlement = settleRun(r)

    expect(grossFor(r, 0)).toBe(112n)
    expect(settlement.grossTotal).toBe(448n)
    expect(settlement.refund).toBe(999_552n)
  })

  it('не виходить за депозит', () => {
    const settlement = settleRun(
      run(50n, 1_000, [
        [1_000n, 0],
        [1_000n, 0],
      ]),
    )

    expect(settlement.grossTotal).toBe(50n)
    expect(settlement.escrowCapped).toBe(true)
    expect(settlement.lines[0]?.grossUncapped).toBe(500n)
  })

  it('придушена когорта не коштує нічого й тут', () => {
    // `R = 0` означає, що рецепт віддав нулі: платити нема за що, скільки б
    // датасетів не мовчало.
    expect(
      settleRun(
        run(1_000_000n, 0, [
          [1_000n, 0],
          [2_000n, 0],
        ]),
      ).grossTotal,
    ).toBe(0n)
  })
})
