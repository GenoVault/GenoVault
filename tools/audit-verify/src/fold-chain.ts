/**
 * Незалежне відтворення ланцюжка відбитків (`FR-025`, `T030`).
 *
 * # Що саме тут доводиться, а що ні
 *
 * Ланцюг **не перевіряє**, що згорнули зареєстрований датасет: потокового
 * sha-256 через транзакції не існує, а цілий конверт у транзакцію не влазить.
 * Замість перевірки програма веде **свідчення**: у `Run.folded_hash`
 * вплітається датасет, кількість живих записів і самі байти кожної згортки.
 *
 * Звіряч бере публічний шифротекст зі сховища, ріже його **тим самим батчем**,
 * рахує **той самий ланцюжок** — і бачить розбіжність. Тобто доводиться саме
 * це: байти, за які поручився ланцюг, — це байти конверта, а не щось інше.
 * Хто підмінив би конверт у сховищі, розійшовся б із `Dataset.content_hash`;
 * хто підмінив би батч дорогою в MPC, розійшовся б тут.
 *
 * Розкладка батча відтворена самостійно, з опису формату, а не взята з
 * `tools/run-dispatcher`. Спільний модуль зробив би збіг тавтологією.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { sharedKeyWord } from './curve.ts'
import type { EnvelopeHeader } from './envelope.ts'
import { frameAt, LIMB_BYTES, NONCE_BYTES, readHeader } from './envelope.ts'

/**
 * Числа рецепта. Публічні: вони в тексті програми й у `.idarc`.
 *
 * `RECIPE_BATCH` тут — четвірка, і звіряч бере її з опису рецепта, а не з
 * нашого коду: батч задає, як саме публічний шифротекст ріжеться на згортки, і
 * без цього числа ланцюжок відбитків не перерахувати.
 */
export const RECIPE_BATCH = 4
export const RECIPE_MARKERS = 64
export const WORD_BYTES = 32
export const RECORD_WORDS = 2 + 3 + RECIPE_MARKERS
export const BATCH_PAYLOAD_BYTES = RECIPE_BATCH * RECORD_WORDS * WORD_BYTES

export class FoldChainError extends Error {
  override readonly name = 'FoldChainError'
}

export interface DatasetSource {
  /** Адреса датасету ончейн — вона входить у відбиток кожної згортки. */
  address: Uint8Array
  /** Байти конверта зі сховища. Публічні: це шифротекст. */
  envelope: Uint8Array
}

export interface ExpectedFold {
  dataset: Uint8Array
  live: number
}

export interface ChainVerdict {
  /** Скільки згорток мало б бути на цей пул. */
  expectedFolds: number
  /** Скільки їх насправді записав ланцюг. */
  actualFolds: number
  /** Відбиток, який дає наш перерахунок. */
  computed: Uint8Array
  /** Відбиток із акаунта прогону. */
  onChain: Uint8Array
  matches: boolean
}

/**
 * Збирає байти одного батча — те, що диспетчер клав у буферний акаунт.
 *
 * Слоти за межею `live` повторюють **перший запис батча**. Це не здогад: інакше
 * там були б нулі, які контур розшифрував би в польові елементи поза
 * діапазоном `u8`, і поведінка обчислення стала б невизначеною. Диспетчер, який
 * добив би хвіст інакше, дасть інший відбиток — і саме це тут і видно.
 */
export function batchPayload(
  envelope: Uint8Array,
  header: EnvelopeHeader,
  index: number,
): { payload: Uint8Array; live: number } {
  const firstRecord = index * RECIPE_BATCH
  if (firstRecord >= header.recordCount) {
    throw new FoldChainError(`батч ${index} поза датасетом на ${header.recordCount} записів`)
  }
  const live = Math.min(RECIPE_BATCH, header.recordCount - firstRecord)
  const payload = new Uint8Array(BATCH_PAYLOAD_BYTES)
  const shared = sharedKeyWord(header.ephemeralPublicKey)

  for (let slot = 0; slot < RECIPE_BATCH; slot += 1) {
    const record = firstRecord + (slot < live ? slot : 0)
    const at = slot * RECORD_WORDS * WORD_BYTES
    const frame = frameAt(header, record)

    payload.set(shared, at)
    payload.set(envelope.subarray(frame, frame + NONCE_BYTES), at + WORD_BYTES)
    payload.set(
      envelope.subarray(
        frame + NONCE_BYTES,
        frame + NONCE_BYTES + header.fieldsPerRecord * LIMB_BYTES,
      ),
      at + 2 * WORD_BYTES,
    )
  }

  return { payload, live }
}

/**
 * Перераховує ланцюжок відбитків для пулу в тому порядку, в якому його згортали.
 *
 * Порядок — це порядок `Run.datasets`: курсор пулу рухає callback і назад не
 * ходить. Перерваний і перезапущений драйвер згортає датасет спочатку, і тоді
 * згорток більше, ніж записів у пулі; ланцюг у такому разі не збігається, і це
 * не підміна, а факт, який звіряч мусить показати числом, а не приховати.
 */
export function replayFoldChain(sources: readonly DatasetSource[]): {
  hash: Uint8Array
  folds: ExpectedFold[]
} {
  let hash: Uint8Array = new Uint8Array(32)
  const folds: ExpectedFold[] = []

  for (const source of sources) {
    const header = readHeader(source.envelope)
    if (header.markerCount !== RECIPE_MARKERS) {
      throw new FoldChainError(
        `датасет має ${header.markerCount} маркерів, рецепт приймає ${RECIPE_MARKERS}`,
      )
    }

    const batches = Math.ceil(header.recordCount / RECIPE_BATCH)
    for (let index = 0; index < batches; index += 1) {
      const { payload, live } = batchPayload(source.envelope, header, index)
      hash = foldHash(hash, source.address, live, payload)
      folds.push({ dataset: source.address, live })
    }
  }

  return { hash, folds }
}

/** `hashv(prev · dataset · [live] · batch)` — те саме, що робить `Run::record_fold`. */
export function foldHash(
  previous: Uint8Array,
  dataset: Uint8Array,
  live: number,
  batch: Uint8Array,
): Uint8Array {
  if (live < 1 || live > RECIPE_BATCH) {
    throw new FoldChainError(`живих записів має бути 1…${RECIPE_BATCH}, отримано ${live}`)
  }
  const message = new Uint8Array(previous.length + dataset.length + 1 + batch.length)
  message.set(previous, 0)
  message.set(dataset, previous.length)
  message[previous.length + dataset.length] = live
  message.set(batch, previous.length + dataset.length + 1)
  // Копія у власний буфер, бо `sha256` типізований на `ArrayBufferLike`, а
  // весь звіряч домовився про `Uint8Array<ArrayBuffer>` — інакше відбиток
  // мандрував би типом, який далі не приймається.
  const digest = sha256(message)
  const hash = new Uint8Array(digest.length)
  hash.set(digest)
  return hash
}

/** Зводить перерахунок із тим, що записав ланцюг. */
export function verifyFoldChain(
  sources: readonly DatasetSource[],
  onChain: Uint8Array,
  foldedBatches: number,
): ChainVerdict {
  const { hash, folds } = replayFoldChain(sources)
  return {
    expectedFolds: folds.length,
    actualFolds: foldedBatches,
    computed: hash,
    onChain,
    matches: folds.length === foldedBatches && equalBytes(hash, onChain),
  }
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => right[index] === byte)
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
