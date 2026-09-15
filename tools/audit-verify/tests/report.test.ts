import { describe, expect, it } from 'vitest'
import { ReportError, unpackReport } from '../src/report.ts'

/**
 * Розкладка звіту — те місце, де мовчазна помилка коштує найдорожче: звіт, у
 * якому половина чисел нулі, виглядає як звіт.
 *
 * Саме так і сталося на `T030`: `createPacker` з `@arcium-hq/client` 0.14.1 на
 * 76 полях віддавав правильними перші дванадцять, а решту — нулями, і жодного
 * винятку при цьому не кидав. Тому розпакування тут своє, а тести на нього —
 * про межі, а не про щасливий шлях.
 */

function layout(count: number, width = 32): { names: string[]; width: number } {
  return { names: Array.from({ length: count }, (_, index) => `f[${index}]`), width }
}

/** Пакує числа тим самим правилом, яким їх пакує контур: смуги по `width` біт. */
function pack(values: readonly bigint[], lanes: number, width = 32): bigint[] {
  const packed: bigint[] = []
  for (let at = 0; at < values.length; at += lanes) {
    let element = 0n
    for (const [lane, value] of values.slice(at, at + lanes).entries()) {
      element |= value << BigInt(lane * width)
    }
    packed.push(element)
  }
  return packed
}

describe('розкладка звіту', () => {
  it('віддає всі числа, а не лише перший елемент', () => {
    const values = Array.from({ length: 76 }, (_, index) => BigInt(index + 1))
    const packed = pack(values, 6)

    expect(packed).toHaveLength(13)
    expect(unpackReport(packed, layout(76))).toEqual(values)
  })

  it('останній елемент неповний — і це нормально', () => {
    // 76 = 12 × 6 + 4: у тринадцятому елементі зайняті лише чотири смуги.
    const values = Array.from({ length: 76 }, () => 7n)
    const packed = pack(values, 6)
    expect(packed[12]).toBe(7n | (7n << 32n) | (7n << 64n) | (7n << 96n))
    expect(unpackReport(packed, layout(76))).toEqual(values)
  })

  it('відмовляє, коли ширина смуги неоднозначна', () => {
    // Вісім полів у двох елементах — це і по чотири смуги, і по п'ять, і по
    // шість, і по сім. Вибрати навмання означало б поставити числа не на свої
    // місця, і виглядало б це як звіт.
    expect(() => unpackReport([0n, 0n], layout(8))).toThrow(ReportError)
  })

  it('число на всю ширину поля не заповзає в сусіднє', () => {
    // Смуга в 32 біти вміщає рівно `2^32 − 1`; наступне значення має лягти в
    // сусідню смугу, а не додатись до цієї. Форма береться справжня — 76 полів
    // у 13 елементах, — щоб ширина смуги виводилась однозначно.
    const values = Array.from({ length: 76 }, (_, index) => (index === 0 ? 0xffff_ffffn : 1n))
    expect(unpackReport(pack(values, 6), layout(76))).toEqual(values)
  })

  it('відмовляє, коли смуги не вміщаються в польовий елемент', () => {
    // 76 полів у 2 елементи — це 38 смуг по 32 біти, тобто 1216 біт.
    expect(() => unpackReport([0n, 0n], layout(76))).toThrow(ReportError)
  })

  it('відмовляє, коли елементів менше, ніж треба на всі поля', () => {
    expect(() => unpackReport([0n], layout(76))).toThrow(ReportError)
  })
})
