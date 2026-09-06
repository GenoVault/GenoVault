import { Buffer } from 'node:buffer'
import { createProgram, datasetAddress, registerDatasetIx } from '@genovault/sdk'
import type { ContentHash, DatasetId, PricePer1k, SolanaAddress } from '@genovault/shared'
import { Connection, PublicKey, type TransactionInstruction } from '@solana/web3.js'

/**
 * Дії ончейн, які API складає, але не підписує (`FR-022`, правило репозиторію).
 *
 * Тут немає ані ключів, ані відправки. Єдине, що вміє цей модуль, — перекласти
 * заявку власника в байти інструкції `register_dataset`, які власник підпише
 * своїм гаманцем. API, здатний підписати замість нього, — це API, який може
 * зареєструвати, переоцінити й зняти чужий датасет; тоді «оператор не має
 * доступу за побудовою» перестає бути властивістю й стає обіцянкою.
 *
 * **Віддається інструкція, а не готова транзакція**, і це не економія. Порядок
 * у `T020` такий: спершу байти шифротексту, потім підпис. Конверт на 10 000
 * записів — це ~16 МіБ, тобто хвилини завантаження, а `recentBlockhash` живе
 * близько хвилини. Транзакція, зібрана до аплоаду, доїхала б до підпису вже
 * простроченою, і власник побачив би `BlockhashNotFound` замість помилки, яку
 * можна зрозуміти. Хеш блоку бере той, хто підписує, — у момент підпису.
 */

export interface UnsignedAccount {
  pubkey: string
  isSigner: boolean
  isWritable: boolean
}

/** Інструкція у вигляді, який переживає JSON: адреси base58, дані base64. */
export interface UnsignedInstruction {
  programId: string
  accounts: UnsignedAccount[]
  data: string
}

export interface RegistrationParams {
  owner: SolanaAddress
  datasetId: DatasetId
  contentHash: ContentHash
  recordCountClaimed: number
  pricePer1k: PricePer1k
}

export interface Registration {
  /** Адреса PDA датасету — та сама, що деривується з `owner` і `datasetId`. */
  datasetAddress: string
  instruction: UnsignedInstruction
}

export type RegistrationBuilder = (params: RegistrationParams) => Promise<Registration>

export function encodeInstruction(instruction: TransactionInstruction): UnsignedInstruction {
  return {
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(instruction.data).toString('base64'),
  }
}

/**
 * Збирач інструкції реєстрації.
 *
 * `Connection` тут створюється, але не використовується: побудова інструкції з
 * повністю заданими акаунтами не робить жодного мережевого виклику — це
 * перевіряють тести `packages/sdk`, які будують ті самі інструкції проти
 * адреси, за якою нічого не слухає. З'єднання потрібне `Program` лише як
 * частина провайдера, і саме тому провайдер тут без гаманця (`ReadProvider`).
 */
export function createRegistrationBuilder(rpcUrl: string): RegistrationBuilder {
  const program = createProgram({ connection: new Connection(rpcUrl) })

  return async (params) => {
    const owner = new PublicKey(params.owner)
    const instruction = await registerDatasetIx(program, {
      owner,
      datasetId: params.datasetId,
      contentHash: params.contentHash,
      recordCountClaimed: params.recordCountClaimed,
      pricePer1k: params.pricePer1k,
    })

    return {
      datasetAddress: datasetAddress(owner, params.datasetId, program.programId).address.toBase58(),
      instruction: encodeInstruction(instruction),
    }
  }
}
