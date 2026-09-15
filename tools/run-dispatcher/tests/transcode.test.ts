import { RescueCipher, x25519 } from '@arcium-hq/client'
import type { DatasetRecord } from '@genovault/crypto'
import { encryptDataset } from '@genovault/crypto'
import { HEADER_BYTES, inspectEnvelope, LIMB_BYTES, NONCE_BYTES } from '@genovault/shared'
import { beforeAll, describe, expect, it } from 'vitest'
import { montgomeryToEdwards } from '../src/curve.ts'
import {
  BATCH_BUFFER_BYTES,
  BATCH_PAYLOAD_BYTES,
  growSteps,
  RECIPE_BATCH,
  RECORD_WORDS,
  WORD_BYTES,
} from '../src/layout.ts'
import {
  assertEnvelopeFitsRecipe,
  batchCount,
  TranscodeError,
  transcodeBatch,
  transcodeDataset,
} from '../src/transcode.ts'

const MARKERS = 64
const FIXTURE_RECORDS = 70

/**
 * Шифр коштує ~1,2 мс на польовий елемент, тобто конверт на 70 записів — це
 * секунди, а не мілісекунди. Тому фікстура шифрується **один раз** на весь
 * файл: сім тестів по власному конверту клали б збірку в таймаут, і виглядало
 * б це як помилка транскодування.
 */
const TIMEOUT_MS = 120_000

/** Індекс без `!`: `noUncheckedIndexedAccess` вмикнений, а тихий `undefined` у тесті — це зелений тест ні про що. */
function pick<T>(list: readonly T[], index: number): T {
  const item = list.at(index)
  if (item === undefined) throw new RangeError(`немає елемента ${index} серед ${list.length}`)
  return item
}

/**
 * Датасет із передбачуваними значеннями: розкладку звіряємо розшифруванням, а
 * не оком, тож самі числа мають бути такими, щоб збіг був неможливий випадково.
 */
function records(count: number, markers = MARKERS): DatasetRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    sex: (index % 2) as 0 | 1,
    age: 20 + (index % 60),
    affected: (index % 3 === 0 ? 1 : 0) as 0 | 1,
    genotypes: Array.from({ length: markers }, (_, marker) => (index + marker) % 3),
  }))
}

let mxeSecret: Uint8Array
let source: DatasetRecord[]
let envelope: Uint8Array
/** Той самий датасет, але з 50 маркерами — вивід `gen-dataset` за замовчуванням. */
let narrowEnvelope: Uint8Array

beforeAll(() => {
  mxeSecret = x25519.utils.randomSecretKey()
  const mxePublicKey = x25519.getPublicKey(mxeSecret)
  source = records(FIXTURE_RECORDS)
  envelope = encryptDataset(source, mxePublicKey).bytes
  narrowEnvelope = encryptDataset(records(2, 50), mxePublicKey).bytes
}, TIMEOUT_MS)

describe('розкладка дзеркалить рецепт', () => {
  // Той самий набір тверджень, що `mirrors_the_recipe_shape` у
  // `state/dispatch.rs`: розійтись цим числам означає поставити в чергу
  // обчислення, яке не складеться, і дізнатись про це від вузлів.
  it('дає 69 слів на запис і 8 832 байти на батч', () => {
    expect(RECORD_WORDS).toBe(69)
    expect(BATCH_PAYLOAD_BYTES).toBe(8_832)
    expect(RECIPE_BATCH * RECORD_WORDS).toBe(276)
    expect(BATCH_PAYLOAD_BYTES % WORD_BYTES).toBe(0)
    expect(BATCH_BUFFER_BYTES).toBe(8_896)
  })

  it('буфер створюється одразу цілим, без дорощувань', () => {
    // Нуль кроків — наслідок `RECIPE_BATCH = 4`, а не властивість програми.
    // Якщо стеля Arcium колись дозволить більший батч, це число має вирости
    // само, а `grow_batch_buffer` лишається на місці саме для цього.
    expect(growSteps()).toBe(0)
  })
})

describe('конверт проти рецепта', () => {
  it('відмовляє датасету з іншою кількістю маркерів', () => {
    expect(() => assertEnvelopeFitsRecipe(inspectEnvelope(narrowEnvelope))).toThrow(TranscodeError)
  })

  it('приймає датасет рівно під рецепт', () => {
    expect(() => assertEnvelopeFitsRecipe(inspectEnvelope(envelope))).not.toThrow()
  })
})

describe('нарізка на батчі', () => {
  it('рахує згортки з довжини датасету', () => {
    expect(batchCount(1)).toBe(1)
    expect(batchCount(4)).toBe(1)
    expect(batchCount(5)).toBe(2)
    // Стандартний датасет `SC-003` — 2500 послідовних кругів до MPC.
    expect(batchCount(10_000)).toBe(2_500)
  })

  it('відмовляє порожньому датасету', () => {
    expect(() => batchCount(0)).toThrow(TranscodeError)
  })

  it('останній батч неповного датасету оголошує менше живих записів', () => {
    const batches = transcodeDataset(envelope)

    // 70 записів по чотири — сімнадцять повних батчів і хвіст на два.
    expect(batches).toHaveLength(18)
    expect(batches.map((batch) => batch.live)).toEqual([...Array(17).fill(4), 2])
    expect(batches.map((batch) => batch.firstRecord)).toEqual(
      Array.from({ length: 18 }, (_, index) => index * 4),
    )
    for (const batch of batches) expect(batch.payload.length).toBe(BATCH_PAYLOAD_BYTES)
  })

  it('не віддає батча поза межами датасету', () => {
    expect(() => transcodeBatch(envelope, 18)).toThrow(TranscodeError)
    expect(() => transcodeBatch(envelope, -1)).toThrow(TranscodeError)
  })
})

describe('розкладка слів у батчі', () => {
  it('кожен слот несе ключ, нонс і 67 шифротекстів на своїх місцях', () => {
    const header = inspectEnvelope(envelope)
    const batch = transcodeBatch(envelope, 0)

    for (let slot = 0; slot < RECIPE_BATCH; slot += 1) {
      const at = slot * RECORD_WORDS * WORD_BYTES
      const record = slot < batch.live ? slot : 0
      const frame = HEADER_BYTES + record * (NONCE_BYTES + header.fieldsPerRecord * LIMB_BYTES)

      // Слово ключа — біраціональний образ, а не u-координата з конверта:
      // черга розбирає його як стиснену точку Едвардса (`curve.ts`).
      expect(batch.payload.subarray(at, at + WORD_BYTES)).toEqual(
        montgomeryToEdwards(header.ephemeralPublicKey),
      )

      // Нонс лягає little-endian у повне слово: шістнадцять байтів кадру й
      // шістнадцять нулів. Зсув на пів слова тут не впав би ніде.
      const nonceWord = batch.payload.subarray(at + WORD_BYTES, at + 2 * WORD_BYTES)
      expect(nonceWord.subarray(0, NONCE_BYTES)).toEqual(
        envelope.subarray(frame, frame + NONCE_BYTES),
      )
      expect(Array.from(nonceWord.subarray(NONCE_BYTES))).toEqual(Array(16).fill(0))

      const limbs = batch.payload.subarray(at + 2 * WORD_BYTES, at + RECORD_WORDS * WORD_BYTES)
      expect(limbs).toEqual(
        envelope.subarray(
          frame + NONCE_BYTES,
          frame + NONCE_BYTES + header.fieldsPerRecord * LIMB_BYTES,
        ),
      )
    }
  })

  /**
   * Найважливіший тест файлу: він проходить шлях кластера в зворотний бік —
   * бере байти з буфера так, як їх ріже черга обчислень, і розшифровує тим
   * самим ключем. Зсув на одне слово тут падає, а на екрані прогону — ні.
   */
  it(
    'слова батча розшифровуються в ті самі записи',
    () => {
      // Останній батч: два живі записи й два слоти хвоста. Саме він і цікавий
      // — на повному батчі падінь заповнення просто не видно.
      const batch = transcodeBatch(envelope, 17)
      expect(batch.live).toBe(2)

      for (let slot = 0; slot < RECIPE_BATCH; slot += 1) {
        const at = slot * RECORD_WORDS * WORD_BYTES
        // Секрет виводиться з ключа **конверта**: у буфері лежить його образ в
        // Едвардсі, а Діффі-Гелман x25519 працює з u-координатою. Кластер
        // робить те саме перетворення у зворотний бік.
        const shared = inspectEnvelope(envelope).ephemeralPublicKey
        const nonce = batch.payload.subarray(at + WORD_BYTES, at + WORD_BYTES + NONCE_BYTES)
        const limbs: number[][] = []
        for (let field = 0; field < 3 + MARKERS; field += 1) {
          const from = at + (2 + field) * WORD_BYTES
          limbs.push(Array.from(batch.payload.subarray(from, from + LIMB_BYTES)))
        }

        const cipher = new RescueCipher(x25519.getSharedSecret(mxeSecret, shared))
        const elements = cipher.decrypt(limbs, nonce)

        // Слоти за межею `live` повторюють перший запис батча — не нулі, які
        // розшифрувались би в польові елементи поза діапазоном `u8`.
        const expected = pick(source, batch.firstRecord + (slot < batch.live ? slot : 0))
        expect(Number(elements[0])).toBe(expected.sex)
        expect(Number(elements[1])).toBe(expected.age)
        expect(Number(elements[2])).toBe(expected.affected)
        expect(elements.slice(3).map(Number)).toEqual(expected.genotypes)
      }
    },
    TIMEOUT_MS,
  )

  it('той самий датасет дає ті самі байти батча', () => {
    expect(transcodeBatch(envelope, 1).payload).toEqual(transcodeBatch(envelope, 1).payload)
  })
})
