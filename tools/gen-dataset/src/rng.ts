/**
 * Детермінований генератор псевдовипадкових чисел (mulberry32).
 *
 * Власний, а не з бібліотеки, і не `Math.random()`, з однієї причини: `SC-002`
 * порівнює якість моделі на зашифрованих даних із тією самою моделлю на
 * відкритих. Порівняння має сенс лише тоді, коли обидва прогони йдуть по
 * побайтово однакових даних, а отже датасет має відтворюватись із сіда.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    if (!Number.isInteger(seed) || seed < 0) {
      throw new RangeError('сід має бути невід’ємним цілим')
    }
    this.state = seed >>> 0
  }

  /** Рівномірно на [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }

  /** Ціле на [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }

  /** Випробування Бернуллі з імовірністю p. */
  bernoulli(p: number): 0 | 1 {
    return this.next() < p ? 1 : 0
  }
}
