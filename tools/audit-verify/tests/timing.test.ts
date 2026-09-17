import { describe, expect, it } from 'vitest'
import type { ChainEvent, RunTiming } from '../src/timing.ts'
import {
  buildLadder,
  decodeBase58,
  LINEARITY_TOLERANCE,
  mean,
  measureSlotMs,
  SPEEDUP_FLOOR,
  splitCycles,
  summariseWave,
  TimingError,
} from '../src/timing.ts'

/**
 * Вимір `SC-003` тримається на трьох властивостях, і кожна перевіряється з
 * обох боків.
 *
 * Розкладка мусить віднести затримку туди, де вона сталася, — і в наш бік
 * циклу, і в бік MPC. Драбина мусить дозволити екстраполяцію на сталій
 * вартості згортки й **відмовити** на несталій. Хвиля мусить рахувати
 * пропускну здатність по хвилі цілком, а не як суму швидкостей прогонів, —
 * інакше чотири прогони, що по черзі чекають той самий кластер, виглядали б
 * учетверо швидшими за один.
 */

/** Стрічка подій одного циклу згортки, зібрана з названих слотів. */
function cycle(options: {
  fold: number
  callback: number
  writes: number[]
  nextFold: number
}): ChainEvent[] {
  const at = (kind: ChainEvent['kind'], slot: number): ChainEvent => ({
    kind,
    slot,
    signature: `${kind}-${slot}`,
    blockTime: null,
  })

  return [
    at('fold', options.fold),
    at('callback', options.callback),
    ...options.writes.map((slot) => at('write', slot)),
    at('fold', options.nextFold),
  ]
}

describe('розкладка циклу згортки', () => {
  it('ділить цикл на чотири ділянки за подіями ланцюга', () => {
    const [phases] = splitCycles(
      cycle({ fold: 100, callback: 108, writes: [110, 111], nextFold: 112 }),
    )

    expect(phases).toEqual({ mpc: 8, idle: 2, write: 1, arm: 1, total: 12 })
  })

  it('циклів завжди на один менше, ніж згорток', () => {
    const events = [
      ...cycle({ fold: 100, callback: 108, writes: [110], nextFold: 112 }),
      ...cycle({ fold: 112, callback: 120, writes: [122], nextFold: 124 }).slice(1),
    ]

    expect(events.filter((event) => event.kind === 'fold')).toHaveLength(3)
    expect(splitCycles(events)).toHaveLength(2)
  })

  it('цикл без callback у розкладку не потрапляє', () => {
    const events: ChainEvent[] = [
      { kind: 'fold', slot: 100, signature: 'a', blockTime: null },
      { kind: 'write', slot: 110, signature: 'b', blockTime: null },
      { kind: 'fold', slot: 112, signature: 'c', blockTime: null },
    ]

    // Не помилка й не нуль: цикл, у якому вузол не відповів, просто не є
    // виміром. Скільки таких, видно з різниці між `folds` і `cycles`.
    expect(splitCycles(events)).toHaveLength(0)
  })

  it('затримка перед записом лягає в простій драйвера, а не в MPC', () => {
    const clean = splitCycles(cycle({ fold: 100, callback: 108, writes: [110], nextFold: 112 }))
    // Той самий кластер, той самий круг до MPC — але драйвер прокинувся на
    // п'ять слотів пізніше. Це і є негативний контроль `T033` у мініатюрі.
    const stalled = splitCycles(cycle({ fold: 100, callback: 108, writes: [115], nextFold: 117 }))

    expect(stalled[0]?.mpc).toBe(clean[0]?.mpc)
    expect((stalled[0]?.idle ?? 0) - (clean[0]?.idle ?? 0)).toBe(5)
    expect((stalled[0]?.total ?? 0) - (clean[0]?.total ?? 0)).toBe(5)
  })
})

describe('годинник', () => {
  it('міряє слот по blockTime першої й останньої транзакції', () => {
    const events: ChainEvent[] = [
      { kind: 'fold', slot: 1000, signature: 'a', blockTime: 500 },
      { kind: 'fold', slot: 2000, signature: 'b', blockTime: 920 },
    ]

    expect(measureSlotMs(events)).toBeCloseTo(420, 6)
  })

  it('відмовляється міряти прогін, що вклався в нуль секунд', () => {
    const events: ChainEvent[] = [
      { kind: 'fold', slot: 1000, signature: 'a', blockTime: 500 },
      { kind: 'fold', slot: 1002, signature: 'b', blockTime: 500 },
    ]

    expect(() => measureSlotMs(events)).toThrow(TimingError)
  })

  it('відмовляється, коли blockTime немає ні в кого', () => {
    expect(() =>
      measureSlotMs([{ kind: 'fold', slot: 1, signature: 'a', blockTime: null }]),
    ).toThrow(TimingError)
  })
})

/** Прогін драбини з однією цікавою властивістю — вартістю згортки. */
function rung(run: string, folds: number, foldMs: number): RunTiming {
  return {
    run,
    folds,
    foldsSeen: folds,
    cycles: folds - 1,
    status: 'completed',
    msPerSlot: 420,
    phases: { mpc: foldMs * 0.72, idle: foldMs * 0.11, write: foldMs * 0.09, arm: foldMs * 0.08 },
    foldMs,
    firstSlot: 0,
    lastSlot: folds * 12,
    problems: [],
  }
}

describe('драбина', () => {
  it('дозволяє екстраполяцію, коли вартість згортки стала', () => {
    const ladder = buildLadder([rung('a', 10, 4770), rung('b', 20, 4700), rung('c', 40, 4800)])

    expect(ladder.spread).toBeLessThan(LINEARITY_TOLERANCE)
    expect(ladder.linear).toBe(true)
  })

  it('відмовляє, коли згортка дорожчає з довжиною прогону', () => {
    // Саме та ситуація, заради якої драбина існує: помножити 4 770 мс на 2500
    // тут означало б пообіцяти час, якого не буде.
    const ladder = buildLadder([rung('a', 10, 4770), rung('b', 20, 6200), rung('c', 40, 9100)])

    expect(ladder.spread).toBeGreaterThan(LINEARITY_TOLERANCE)
    expect(ladder.linear).toBe(false)
  })

  it('одного щабля замало — сталість нічим не доведена', () => {
    expect(buildLadder([rung('a', 10, 4770)]).linear).toBe(false)
  })
})

/** Події хвилі: `count` прогонів, кожен по `folds` згорток, від слота `start`. */
function wave(count: number, folds: number, start: number, step: number): ChainEvent[][] {
  return Array.from({ length: count }, (_, run) =>
    Array.from({ length: folds }, (_, index) => index).flatMap((index): ChainEvent[] => [
      {
        kind: 'fold',
        slot: start + index * step,
        signature: `f-${run}-${index}`,
        blockTime: null,
      },
      {
        kind: 'callback',
        slot: start + index * step + 8,
        signature: `c-${run}-${index}`,
        blockTime: null,
      },
    ]),
  )
}

describe('хвиля', () => {
  it('міряє пропускну здатність по хвилі, а не сумою прогонів', () => {
    // Чотири прогони по 10 згорток ідуть одночасно й укладаються в той самий
    // відрізок, що й один. Це і є працюючий паралелізм: згорток учетверо
    // більше за ті самі слоти.
    const solo = summariseWave('×1', 1, [rung('a', 10, 5040)], wave(1, 10, 100, 12))
    const four = summariseWave(
      '×4',
      4,
      [rung('a', 10, 5040), rung('b', 10, 5040), rung('c', 10, 5040), rung('d', 10, 5040)],
      wave(4, 10, 100, 12),
    )

    expect(four.folds).toBe(40)
    expect(four.spanSlots).toBe(solo.spanSlots)
    expect(four.foldMs).toBeCloseTo(solo.foldMs / 4, 6)
  })

  it('не бачить прискорення там, де кластер рахує по черзі', () => {
    // Той самий хвіст роботи, розтягнутий учетверо: чотири прогони по десять
    // згорток, але кожна наступна чекає попередню. Сума швидкостей прогонів
    // збрехала б про прискорення ×4 — вимір по хвилі каже ×1.
    const solo = summariseWave('×1', 1, [rung('a', 10, 5040)], wave(1, 10, 100, 12))
    const serialised: ChainEvent[][] = [
      wave(1, 10, 100, 12).flat(),
      wave(1, 10, 220, 12).flat(),
      wave(1, 10, 340, 12).flat(),
      wave(1, 10, 460, 12).flat(),
    ]
    const four = summariseWave(
      '×4',
      4,
      [rung('a', 10, 5040), rung('b', 10, 5040), rung('c', 10, 5040), rung('d', 10, 5040)],
      serialised,
    )

    expect(four.folds).toBe(40)
    // Твердження тут — не про мілісекунди, а про прискорення: воно мусить
    // лишитись під порогом важеля. Хвіст у кілька слотів між прогонами робить
    // послідовну хвилю навіть трохи **повільнішою** за одинокий прогін.
    expect(solo.foldMs / four.foldMs).toBeLessThan(SPEEDUP_FLOOR)
    expect(solo.foldMs / four.foldMs).toBeCloseTo(1, 1)
  })
})

describe('base58', () => {
  it('розбирає вкладену інструкцію в байти', () => {
    // Дискримінатор `frequencies_fold_callback` у тому вигляді, у якому він
    // приїжджає з RPC у `innerInstructions`.
    expect([...decodeBase58('3Bxs4h24hBtQy9rw')]).toHaveLength(12)
    expect([...decodeBase58('2')]).toEqual([1])
    expect([...decodeBase58('z')]).toEqual([57])
  })

  it('зберігає провідні нулі', () => {
    expect([...decodeBase58('11')]).toEqual([0, 0])
    expect([...decodeBase58('112')]).toEqual([0, 0, 1])
  })

  it('відмовляє на символі поза алфавітом', () => {
    // `0`, `O`, `I` і `l` у base58 не входять навмисно, і мовчки прочитати їх
    // як щось інше означало б розібрати чужі байти.
    expect(() => decodeBase58('0')).toThrow(TimingError)
    expect(() => decodeBase58('OIl')).toThrow(TimingError)
  })
})

describe('середнє', () => {
  it('порожній список дає нуль, а не NaN', () => {
    // Ділення на нуль тут проїхало б до звіту нечитабельним `NaN мс`, і
    // виглядало б це як зламаний вимір, а не як «циклів не було».
    expect(mean([])).toBe(0)
  })
})
