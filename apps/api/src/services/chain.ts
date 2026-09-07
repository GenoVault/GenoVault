import { Buffer } from 'node:buffer'
import {
  consentAddress,
  createProgram,
  datasetAddress,
  fetchConsent,
  fetchConsents,
  fetchDataset,
  fetchDatasets,
  fetchPlatformConfig,
  platformConfigAddress,
  registerDatasetIx,
} from '@genovault/sdk'
import type {
  ChainView,
  ConsentState,
  ContentHash,
  DatasetId,
  PricePer1k,
  RunDatasetRef,
  SolanaAddress,
} from '@genovault/shared'
import { chainViewSchema, pricePer1kSchema, solanaAddressSchema } from '@genovault/shared'
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
 * записів — це ~21 МБ, тобто хвилини завантаження, а `recentBlockhash` живе
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

/**
 * PDA датасету — чиста функція, без мережі й без `Program`.
 *
 * Адреса не зберігається в рядку каталогу навмисно: вона повністю визначена
 * парою «власник + ідентифікатор», і збережене поле було б другим місцем, де
 * та сама правда може розійтися з ланцюгом після зміни ключа програми.
 */
export function deriveDatasetAddress(owner: SolanaAddress, datasetId: DatasetId): SolanaAddress {
  return solanaAddressSchema.parse(
    datasetAddress(new PublicKey(owner), datasetId).address.toBase58(),
  )
}

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

/**
 * Читач стану датасету в мережі (`FR-002`, `FR-024`).
 *
 * Згода й позначка підтвердження живуть **тільки** ончейн: дзеркала для них
 * немає, і поки його ніхто не наповнює, дзеркало було б застарілим за
 * побудовою. PLAN каже про це прямо — «правда про згоду живе ончейн,
 * розбіжність вирішується на користь ланцюга», — тож картка бере їх звідти.
 *
 * Недоступний RPC не є помилкою картки. Каталог має відкритися й без мережі,
 * просто без тієї частини, яку без неї не дізнатись: `state: 'unavailable'`
 * говорить фронту «спробуй пізніше», а не «датасету немає».
 */
export type ChainReader = (owner: SolanaAddress, datasetId: DatasetId) => Promise<ChainView>

export function createChainReader(rpcUrl: string): ChainReader {
  const program = createProgram({ connection: new Connection(rpcUrl) })

  return async (owner, datasetId) => {
    const address = datasetAddress(new PublicKey(owner), datasetId, program.programId).address

    try {
      const dataset = await fetchDataset(program, address)
      if (dataset === null) return chainViewSchema.parse({ state: 'unregistered' })

      // `consent_version` 0 означає «згоди ще немає» — не «версія нульова».
      // Адреса чинної згоди деривується з номера, тому ланцюг версій обходити
      // не треба: попередні лишаються окремими акаунтами для історії (`FR-005`).
      const consent =
        dataset.consentVersion === 0
          ? null
          : await fetchConsent(
              program,
              consentAddress(address, dataset.consentVersion, program.programId).address,
            )

      return chainViewSchema.parse({
        state: 'registered',
        status: dataset.status,
        version: dataset.version,
        contentHash: dataset.contentHash,
        recordCountClaimed: dataset.recordCountClaimed.toString(),
        pricePer1k: dataset.pricePer1k.toString(),
        consent:
          consent === null
            ? null
            : {
                version: consent.version,
                allowedUses: consent.allowedUses,
                forbiddenUses: consent.forbiddenUses,
                buyerCategories: consent.buyerCategories,
                expiresAt: consent.expiresAt === null ? null : consent.expiresAt.toString(),
                revoked: consent.revokedAt !== null,
              },
        verifiedBadge:
          dataset.verifiedBadge === null
            ? null
            : {
                verifier: dataset.verifiedBadge.verifier.toBase58(),
                verifiedAt: dataset.verifiedBadge.verifiedAt.toString(),
                // `FR-024a`: позначка — довіра до оператора, не доказ. Слово
                // їде разом зі значенням, щоб фронт не міг показати одне без
                // другого.
                kind: 'operator-attested',
              },
      })
    } catch {
      // Текст помилки назовні не йде: він регулярно містить адресу RPC, а це
      // деталь розгортання. Фронту досить знати, що зараз не вийшло.
      return chainViewSchema.parse({ state: 'unavailable' })
    }
  }
}

/**
 * Стан мережі, потрібний квоті (`T023`).
 *
 * Читається пачкою, а не по датасету: пул вміщає до 50 датасетів, і 50 обходів
 * мережі на одну відповідь зробили б квоту повільнішою за сам прогін. Виходить
 * чотири запити на будь-який розмір пулу — датасети, згоди, конфігурація і час
 * ланцюга, — і три перші не залежать від довжини списку.
 */

/** Чому квота не має чисел. Розрізняється, бо це різні відповіді клієнту. */
export type ChainFailureReason =
  /** Вузол не відповів. Клієнт має право повторити. */
  | 'unavailable'
  /** Програма в мережі є, але `PlatformConfig` немає — це наше розгортання. */
  | 'not-initialized'

export class ChainStateError extends Error {
  override readonly name = 'ChainStateError'
  readonly reason: ChainFailureReason

  constructor(reason: ChainFailureReason, message: string) {
    super(message)
    this.reason = reason
  }
}

export interface QuoteDatasetState {
  datasetAddress: SolanaAddress
  /** `null` — датасет ще не зареєстровано в мережі. */
  dataset: {
    status: 'active' | 'retired'
    recordCountClaimed: bigint
    pricePer1k: PricePer1k
  } | null
  /** `null` — згоди немає: або датасету немає, або власник її ще не задав. */
  consent: ConsentState | null
}

export interface QuoteChainState {
  feeBps: number
  mint: SolanaAddress
  paused: boolean
  /**
   * Час ланцюга в секундах Unix.
   *
   * Строк згоди перевіряється саме ним, а не годинником сервера (`FR-005`):
   * відхиляти прогін буде програма, і в неї є рівно цей час. Годинник, що
   * спішить на хвилину, дав би відмову там, де ланцюг пропустив би.
   */
  now: bigint
  datasets: QuoteDatasetState[]
}

export type QuoteChainReader = (refs: readonly RunDatasetRef[]) => Promise<QuoteChainState>

export function createQuoteChainReader(rpcUrl: string): QuoteChainReader {
  const connection = new Connection(rpcUrl)
  const program = createProgram({ connection })

  return async (refs) => {
    const addresses = refs.map(
      (ref) => datasetAddress(new PublicKey(ref.owner), ref.datasetId, program.programId).address,
    )

    let datasets: Awaited<ReturnType<typeof fetchDatasets>>
    let config: Awaited<ReturnType<typeof fetchPlatformConfig>>
    let blockTime: number | null
    try {
      const slot = await connection.getSlot()
      ;[datasets, config, blockTime] = await Promise.all([
        fetchDatasets(program, addresses),
        fetchPlatformConfig(program, platformConfigAddress(program.programId).address),
        connection.getBlockTime(slot),
      ])
    } catch {
      // Текст помилки назовні не йде: він регулярно містить адресу RPC, а це
      // деталь розгортання.
      throw new ChainStateError('unavailable', 'вузол мережі не відповів')
    }

    if (blockTime === null) {
      throw new ChainStateError('unavailable', 'час ланцюга недоступний')
    }
    if (config === null) {
      throw new ChainStateError('not-initialized', 'конфігурації платформи немає в мережі')
    }

    // Адреса згоди деривується з номера чинної версії, тож ланцюг версій
    // обходити не треба. Датасет без згоди в пачку не потрапляє — інакше
    // довелося б класти в неї заглушку й розбирати її на тому боці.
    const consentIndex = new Map<number, number>()
    const consentAddresses: PublicKey[] = []
    datasets.forEach((dataset, index) => {
      if (dataset === null || dataset.consentVersion === 0) return
      const address = addresses[index]
      if (address === undefined) return
      consentIndex.set(index, consentAddresses.length)
      consentAddresses.push(
        consentAddress(address, dataset.consentVersion, program.programId).address,
      )
    })

    let consents: Awaited<ReturnType<typeof fetchConsents>> = []
    if (consentAddresses.length > 0) {
      try {
        consents = await fetchConsents(program, consentAddresses)
      } catch {
        throw new ChainStateError('unavailable', 'вузол мережі не відповів')
      }
    }

    return {
      feeBps: config.feeBps,
      mint: solanaAddressSchema.parse(config.mint.toBase58()),
      paused: config.paused,
      now: BigInt(blockTime),
      datasets: datasets.map((dataset, index) => {
        const slot = consentIndex.get(index)
        const consent = slot === undefined ? null : (consents[slot] ?? null)

        return {
          datasetAddress: solanaAddressSchema.parse(addresses[index]?.toBase58()),
          dataset:
            dataset === null
              ? null
              : {
                  status: dataset.status,
                  recordCountClaimed: dataset.recordCountClaimed,
                  pricePer1k: pricePer1kSchema.parse(dataset.pricePer1k),
                },
          consent:
            consent === null
              ? null
              : {
                  allowedUses: consent.allowedUses,
                  forbiddenUses: consent.forbiddenUses,
                  buyerCategories: consent.buyerCategories,
                  expiresAt: consent.expiresAt,
                  revoked: consent.revokedAt !== null,
                },
        }
      }),
    }
  }
}
