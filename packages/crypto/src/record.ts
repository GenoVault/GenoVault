import { SCALAR_FIELD_COUNT } from '@genovault/shared'
import { z } from 'zod'

/**
 * Запис у тому вигляді, в якому він іде під шифр.
 *
 * Тут навмисно немає `subjectId`, хоча генератор датасетів його видає. Жоден
 * рецепт із каталогу (`FR-011`) ідентифікатора особи не споживає, а те, чого
 * рецепт не споживає, не має потрапляти в шифротекст: інакше єдиний спосіб
 * зв'язати запис з людиною подорожує разом з даними в MPC і в сховище без
 * жодної на те причини. Запис адресується позицією в датасеті — тим самим
 * індексом, яким рецепт повертає `records_included` (`FR-018a`).
 */
export interface DatasetRecord {
  /** 0 — жіноча, 1 — чоловіча. */
  sex: 0 | 1
  age: number
  affected: 0 | 1
  /** Кількість копій мінорного алеля на кожен маркер: 0, 1 або 2. */
  genotypes: number[]
}

const MAX_AGE = 200

export const datasetRecordSchema = z.strictObject({
  sex: z.union([z.literal(0), z.literal(1)]),
  age: z.number().int().min(0).max(MAX_AGE),
  affected: z.union([z.literal(0), z.literal(1)]),
  genotypes: z.array(z.number().int().min(0).max(2)).min(1),
})

/**
 * Розкладає запис у вектор польових елементів для шифру Rescue.
 *
 * Rescue працює над елементами базового поля Curve25519, тож кожне число тут —
 * окремий `bigint`. Пакувати кілька дрібних значень в один елемент було б
 * ощадніше за розміром, але рецепт мовою Arcis мусив би їх розпаковувати
 * арифметикою всередині MPC, а це найдорожчі операції в системі.
 */
export function toFieldElements(record: DatasetRecord): bigint[] {
  return [
    BigInt(record.sex),
    BigInt(record.age),
    BigInt(record.affected),
    ...record.genotypes.map((genotype) => BigInt(genotype)),
  ]
}

/**
 * Збирає запис назад із вектора польових елементів.
 *
 * Перевірки тут не дублюють `datasetRecordSchema` заради симетрії: після
 * розшифрування невірним ключем вектор виглядає як випадкові числа розміром із
 * поле, і мовчазне `Number()` перетворило б це на запис із віком 10^70 замість
 * помилки.
 */
export function fromFieldElements(elements: bigint[]): DatasetRecord {
  if (elements.length <= SCALAR_FIELD_COUNT) {
    throw new RangeError(`очікувалось більше за ${SCALAR_FIELD_COUNT} польових елементів`)
  }

  const [sex, age, affected] = elements
  const genotypes = elements.slice(SCALAR_FIELD_COUNT)

  return datasetRecordSchema.parse({
    sex: asSmallNumber(sex, 'sex'),
    age: asSmallNumber(age, 'age'),
    affected: asSmallNumber(affected, 'affected'),
    genotypes: genotypes.map((genotype, index) => asSmallNumber(genotype, `genotypes[${index}]`)),
  })
}

function asSmallNumber(value: bigint | undefined, field: string): number {
  if (value === undefined || value < 0n || value > BigInt(MAX_AGE)) {
    throw new RangeError(`поле ${field} поза межами після розшифрування: ${value}`)
  }
  return Number(value)
}
