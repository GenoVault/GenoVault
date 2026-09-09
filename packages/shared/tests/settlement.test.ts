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

  it('рання відмова на нульовому внеску лишається ранньою', () => {
    // Без неї друга гілка ділила б на нуль, коли внесок не оголосив ніхто.
    expect(source).toContain('if contributed == 0 || base == 0 {')
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
 * Дірка, знайдена на `T027`: коли **жоден** датасет пулу не дотягнув до
 * `MIN_CONTRIBUTION`, `C = 0`, і `gross_for` віддає нуль усім — а когорта з
 * `R ≥ MIN_COHORT` записів розкривається. Покупець отримує звіт безкоштовно й
 * із повним поверненням депозиту.
 *
 * `T026` закрив «безкоштовні записи» лише для пулів, де хоч один датасет
 * платний: масштаб `R / C` не має на що множити, коли платних немає. Тест
 * фіксує **поточну** поведінку, щоб зміна правила була видною зміною, а не
 * тихою; рішення про саме правило — відкрите питання в `docs/TASKS.md`.
 */
describe('пул, у якому мовчать усі', () => {
  it('зараз не коштує покупцю нічого', () => {
    const pool = Array.from({ length: 50 }, (_unused, index): [bigint, number] => [
      BigInt(1_000 + index * 37),
      0,
    ])
    // 50 датасетів по 9 записів: кожен під порогом, оголошено нуль, але всі
    // 450 записів у когорті.
    const settlement = settleRun(run(1_000_000n, 450, pool))

    expect(settlement.grossTotal).toBe(0n)
    expect(settlement.refund).toBe(1_000_000n)
  })
})
