import { x25519 } from '@arcium-hq/client'
import type { DatasetRecord } from '@genovault/crypto'
import { encryptDataset } from '@genovault/crypto'
import { transcodeDataset } from '@genovault/run-dispatcher'
import { sha256 } from '@noble/hashes/sha2.js'
import { Keypair } from '@solana/web3.js'
import { beforeAll, describe, expect, it } from 'vitest'
import { readHeader } from '../src/envelope.ts'
import {
  BATCH_PAYLOAD_BYTES,
  batchPayload,
  equalBytes,
  FoldChainError,
  foldHash,
  RECIPE_BATCH,
  replayFoldChain,
  verifyFoldChain,
} from '../src/fold-chain.ts'

/**
 * Головна перевірка звіряча: дві незалежні реалізації однієї розкладки мусять
 * дати однакові байти.
 *
 * Диспетчер ріже конверт своїм кодом (`tools/run-dispatcher`), звіряч —
 * своїм. Спільного модуля між ними немає навмисно: він зробив би збіг
 * тавтологією, а весь сенс `FR-025` у тому, що третя сторона відтворює
 * розкладку з опису формату й бачить розбіжність.
 *
 * `@genovault/run-dispatcher` тут — еталон із `devDependencies`; у рантайм
 * звіряча він не потрапляє (`independence.test.ts`).
 */

const MARKERS = 64
const TIMEOUT_MS = 120_000

let envelope: Uint8Array
let source: DatasetRecord[]

function records(count: number): DatasetRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    sex: (index % 2) as 0 | 1,
    age: 20 + (index % 60),
    affected: (index % 3 === 0 ? 1 : 0) as 0 | 1,
    genotypes: Array.from({ length: MARKERS }, (_, marker) => (index + marker) % 3),
  }))
}

beforeAll(() => {
  source = records(70)
  envelope = encryptDataset(source, x25519.getPublicKey(x25519.utils.randomSecretKey())).bytes
}, TIMEOUT_MS)

describe('дві реалізації розкладки батча', () => {
  it('дають байт у байт однакові батчі', () => {
    const header = readHeader(envelope)
    const theirs = transcodeDataset(envelope)

    expect(theirs).toHaveLength(18)
    for (const [index, batch] of theirs.entries()) {
      const mine = batchPayload(envelope, header, index)
      expect(mine.live).toBe(batch.live)
      expect(mine.payload.length).toBe(BATCH_PAYLOAD_BYTES)
      expect(equalBytes(mine.payload, batch.payload)).toBe(true)
    }
  })

  it('останній батч оголошує рівно стільки живих, скільки лишилось записів', () => {
    const header = readHeader(envelope)
    expect(batchPayload(envelope, header, 17).live).toBe(70 - 17 * RECIPE_BATCH)
  })

  it('не віддає батча поза датасетом', () => {
    const header = readHeader(envelope)
    expect(() => batchPayload(envelope, header, 18)).toThrow(FoldChainError)
  })
})

describe('ланцюжок відбитків', () => {
  it('перший відбиток рахується від нульового стану', () => {
    const header = readHeader(envelope)
    const dataset = Uint8Array.from(Keypair.generate().publicKey.toBytes())
    const { payload, live } = batchPayload(envelope, header, 0)

    // Те саме, що робить `hashv` у програмі: sha-256 від склейки, без довжин
    // і роздільників. Порядок частин тут і є те, за чим стежимо.
    const expected = sha256(Uint8Array.from([...new Uint8Array(32), ...dataset, live, ...payload]))

    expect(equalBytes(foldHash(new Uint8Array(32), dataset, live, payload), expected)).toBe(true)
  })

  it('відмовляє `live` поза межами рецепта', () => {
    const dataset = Uint8Array.from(Keypair.generate().publicKey.toBytes())
    const batch = new Uint8Array(BATCH_PAYLOAD_BYTES)

    expect(() => foldHash(new Uint8Array(32), dataset, 0, batch)).toThrow(FoldChainError)
    expect(() => foldHash(new Uint8Array(32), dataset, RECIPE_BATCH + 1, batch)).toThrow(
      FoldChainError,
    )
  })

  it('порядок датасетів у пулі змінює відбиток', () => {
    const a = Uint8Array.from(Keypair.generate().publicKey.toBytes())
    const b = Uint8Array.from(Keypair.generate().publicKey.toBytes())

    const forward = replayFoldChain([
      { address: a, envelope },
      { address: b, envelope },
    ])
    const backward = replayFoldChain([
      { address: b, envelope },
      { address: a, envelope },
    ])

    expect(forward.folds).toHaveLength(36)
    expect(equalBytes(forward.hash, backward.hash)).toBe(false)
  })

  it('підміна одного байта шифротексту ламає ланцюжок', () => {
    const dataset = Uint8Array.from(Keypair.generate().publicKey.toBytes())
    const honest = replayFoldChain([{ address: dataset, envelope }])

    const tampered = Uint8Array.from(envelope)
    // Останній байт файлу — лімб останнього кадру, тобто чистий шифротекст.
    tampered.set([(tampered.at(-1) ?? 0) ^ 1], tampered.length - 1)
    const forged = replayFoldChain([{ address: dataset, envelope: tampered }])

    expect(equalBytes(honest.hash, forged.hash)).toBe(false)
  })

  it('вердикт зводить перерахунок із тим, що записав ланцюг', () => {
    const dataset = Uint8Array.from(Keypair.generate().publicKey.toBytes())
    const sources = [{ address: dataset, envelope }]
    const { hash } = replayFoldChain(sources)

    expect(verifyFoldChain(sources, hash, 18).matches).toBe(true)
    // Стільки ж згорток, інший відбиток: підміна вмісту.
    expect(verifyFoldChain(sources, new Uint8Array(32), 18).matches).toBe(false)
    // Той самий відбиток, інша кількість: перезапущений драйвер згорнув зайве.
    expect(verifyFoldChain(sources, hash, 19).matches).toBe(false)
  })
})
