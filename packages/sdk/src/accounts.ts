import type { ContentHash, DatasetId } from '@genovault/shared'
import { datasetIdSchema } from '@genovault/shared'
import type { PublicKey } from '@solana/web3.js'
import { bytesToHash, fromBn, fromBnOption } from './convert.ts'
import type { GenoVaultProgram } from './program.ts'

/**
 * Читання акаунтів програми.
 *
 * Декодоване Anchor подання назовні не віддається: у ньому `BN` замість
 * `bigint` і `{ active: {} }` замість статусу. Одне мовчки округлюється
 * `Number()`, друге змушує кожного викликача знати внутрішню форму enum'а
 * Anchor. Тут це нормалізується один раз.
 */

export type DatasetStatus = 'active' | 'retired'

export interface VerificationBadge {
  verifier: PublicKey
  verifiedAt: bigint
}

export interface DatasetAccount {
  owner: PublicKey
  datasetId: DatasetId
  version: number
  contentHash: ContentHash
  recordCountClaimed: bigint
  pricePer1k: bigint
  /** 0 означає «згоди ще немає» — не «версія нульова». */
  consentVersion: number
  status: DatasetStatus
  /** `null`, доки заявку не розглянуто (`T060`). Картка датасету має показувати різницю. */
  verifiedBadge: VerificationBadge | null
  bump: number
}

export interface ConsentAccount {
  dataset: PublicKey
  version: number
  allowedUses: number
  forbiddenUses: number
  buyerCategories: number
  /** `null` — без строку. Строк перевіряється часом ланцюга, не клієнта. */
  expiresAt: bigint | null
  /** Момент відкликання; `null` — чинна. Проставляється один раз (`FR-007`). */
  revokedAt: bigint | null
  /** Попередня версія згоди; `null` для першої. Ланцюг версій, а не перезапис. */
  prevVersion: PublicKey | null
  bump: number
}

export interface PlatformConfigAccount {
  authority: PublicKey
  mint: PublicKey
  feeBps: number
  paused: boolean
  bump: number
}

type Raw = Awaited<ReturnType<GenoVaultProgram['account']['dataset']['fetch']>>
type RawConsent = Awaited<ReturnType<GenoVaultProgram['account']['consent']['fetch']>>
type RawConfig = Awaited<ReturnType<GenoVaultProgram['account']['platformConfig']['fetch']>>

/**
 * Anchor подає enum без даних як об'єкт з одним ключем.
 *
 * Тому перевіряється саме наявність ключа, а не значення: `{ retired: {} }`
 * має стати `'retired'`, і невідомий варіант має падати тут, а не
 * перетворюватись на `undefined` десь у картці датасету.
 */
function datasetStatus(raw: Raw['status']): DatasetStatus {
  if ('active' in raw) return 'active'
  if ('retired' in raw) return 'retired'
  throw new Error(`невідомий статус датасету: ${JSON.stringify(raw)}`)
}

export function decodeDataset(raw: Raw): DatasetAccount {
  return {
    owner: raw.owner,
    datasetId: datasetIdSchema.parse(raw.datasetId),
    version: raw.version,
    contentHash: bytesToHash(raw.contentHash),
    recordCountClaimed: fromBn(raw.recordCountClaimed),
    pricePer1k: fromBn(raw.pricePer1k),
    consentVersion: raw.consentVersion,
    status: datasetStatus(raw.status),
    verifiedBadge:
      raw.verifiedBadge === null
        ? null
        : {
            verifier: raw.verifiedBadge.verifier,
            verifiedAt: fromBn(raw.verifiedBadge.verifiedAt),
          },
    bump: raw.bump,
  }
}

export function decodeConsent(raw: RawConsent): ConsentAccount {
  return {
    dataset: raw.dataset,
    version: raw.version,
    allowedUses: raw.allowedUses,
    forbiddenUses: raw.forbiddenUses,
    buyerCategories: raw.buyerCategories,
    expiresAt: fromBnOption(raw.expiresAt),
    revokedAt: fromBnOption(raw.revokedAt),
    prevVersion: raw.prevVersion,
    bump: raw.bump,
  }
}

export function decodePlatformConfig(raw: RawConfig): PlatformConfigAccount {
  return {
    authority: raw.authority,
    mint: raw.mint,
    feeBps: raw.feeBps,
    paused: raw.paused,
    bump: raw.bump,
  }
}

/**
 * Читає акаунт, віддаючи `null` замість винятку на «його немає».
 *
 * `fetchNullable` відрізняє відсутній акаунт від зіпсованого: перше — це
 * звичайний стан каталогу (датасет ще не зареєстровано), друге має падати.
 */
export async function fetchDataset(
  program: GenoVaultProgram,
  address: PublicKey,
): Promise<DatasetAccount | null> {
  const raw = await program.account.dataset.fetchNullable(address)
  return raw === null ? null : decodeDataset(raw)
}

export async function fetchConsent(
  program: GenoVaultProgram,
  address: PublicKey,
): Promise<ConsentAccount | null> {
  const raw = await program.account.consent.fetchNullable(address)
  return raw === null ? null : decodeConsent(raw)
}

export async function fetchPlatformConfig(
  program: GenoVaultProgram,
  address: PublicKey,
): Promise<PlatformConfigAccount | null> {
  const raw = await program.account.platformConfig.fetchNullable(address)
  return raw === null ? null : decodePlatformConfig(raw)
}

/**
 * Читання пачкою — один `getMultipleAccounts` замість `n` запитів.
 *
 * Прогін вміщає до 50 датасетів (`MAX_RUN_DATASETS`), і квота на такий пул
 * читанням по одному коштувала б 50 обходів мережі. Anchor сам ріже список на
 * порції, які приймає RPC, тож викликачу не треба знати цю межу.
 *
 * Порядок відповіді збігається з порядком запиту, і `null` на місці
 * відсутнього акаунта лишається — саме за ним видно, який датасет ще не
 * зареєстровано.
 */
export async function fetchDatasets(
  program: GenoVaultProgram,
  addresses: PublicKey[],
): Promise<(DatasetAccount | null)[]> {
  const raw = await program.account.dataset.fetchMultiple(addresses)
  return raw.map((account) => (account === null ? null : decodeDataset(account)))
}

export async function fetchConsents(
  program: GenoVaultProgram,
  addresses: PublicKey[],
): Promise<(ConsentAccount | null)[]> {
  const raw = await program.account.consent.fetchMultiple(addresses)
  return raw.map((account) => (account === null ? null : decodeConsent(account)))
}

/**
 * П'ять статусів прогону (`FR-013`) — рівно ті, що названі у SPEC.
 *
 * Порційність виплат сюди не додається шостим значенням: її тримає
 * `settledCount`. Інакше «завершено» означало б «обчислення скінчилось», а не
 * «всім заплачено».
 */
export type RunStatusName = 'accepted' | 'running' | 'completed' | 'rejected' | 'failed'

export interface RunDatasetEntry {
  dataset: PublicKey
  /** Ціна на момент замовлення — копія, а не поточна ціна датасету. */
  pricePer1k: bigint
  /** Внесок, оголошений усередині MPC. 0, доки датасет не закрито. */
  recordsIncluded: number
  /**
   * Внесок був меншим за `MIN_CONTRIBUTION` і оголошений нулем (`T019`).
   *
   * Окремо від нульового внеску: для власника «не дав жодного запису під
   * фільтр» і «дав, але замало, щоб про це говорити» — різні речі, і екран
   * нарахувань мусить їх розрізняти.
   */
  belowFloor: boolean
  settled: boolean
}

export interface RunAccount {
  buyer: PublicKey
  /** Кому покупець доручив довести прогін до кінця (`T025`). */
  dispatcher: PublicKey
  nonce: bigint
  recipeId: number
  /** Параметри рецепта в розкладці програми — 32 байти як є. */
  recipeParams: Uint8Array
  useType: number
  buyerCategory: number
  /** Публічний x25519 покупця: цим ключем MPC зашифрував звіт. */
  buyerX25519: Uint8Array
  datasets: RunDatasetEntry[]
  /** Комісія на момент замовлення — копія, а не поточна конфігурація. */
  feeBps: number
  escrowAmount: bigint
  settledCount: number
  settledAmount: bigint
  refunded: boolean
  status: RunStatusName
  /** `null`, доки не повернувся callback MPC. */
  resultHash: ContentHash | null
  recordsIncluded: number
  /** Когорта менша за `MIN_COHORT`: звіт із нулів, платити нема за що. */
  suppressed: boolean
  datasetCursor: number
  foldedBatches: number
  /** Ланцюжок відбитків усього, що пішло в MPC (`FR-025`). */
  foldedHash: ContentHash
  createdAt: bigint
  bump: number
}

export interface RunResultAccount {
  run: PublicKey
  /** Ключ, яким MXE зашифрував звіт на покупця. */
  encryptionKey: Uint8Array
  nonce: bigint
  /** 24 польові елементи звіту — розшифровує їх покупець, і більше ніхто. */
  ciphertexts: Uint8Array[]
  recordsIncluded: number
  suppressed: boolean
  bump: number
}

type RawRun = Awaited<ReturnType<GenoVaultProgram['account']['run']['fetch']>>
type RawRunResult = Awaited<ReturnType<GenoVaultProgram['account']['runResult']['fetch']>>

function runStatus(raw: RawRun['status']): RunStatusName {
  if ('accepted' in raw) return 'accepted'
  if ('running' in raw) return 'running'
  if ('completed' in raw) return 'completed'
  if ('rejected' in raw) return 'rejected'
  if ('failed' in raw) return 'failed'
  throw new Error(`невідомий статус прогону: ${JSON.stringify(raw)}`)
}

/**
 * Байти з IDL приходять масивом чисел і йдуть назовні `Uint8Array`.
 *
 * Не hex-рядком, як `contentHash`: відбиток читає людина й порівнює очима, а
 * ключ шифрування і шифротексти читає лише крипто — і кожне перетворення в
 * рядок і назад це ще одне місце, де 32 байти можуть стати 31.
 */
function toBytes(raw: number[]): Uint8Array {
  return Uint8Array.from(raw)
}

export function decodeRun(raw: RawRun): RunAccount {
  return {
    buyer: raw.buyer,
    dispatcher: raw.dispatcher,
    nonce: fromBn(raw.nonce),
    recipeId: raw.recipeId,
    recipeParams: toBytes(raw.recipeParams),
    useType: raw.useType,
    buyerCategory: raw.buyerCategory,
    buyerX25519: toBytes(raw.buyerX25519),
    datasets: raw.datasets.map((entry) => ({
      dataset: entry.dataset,
      pricePer1k: fromBn(entry.pricePer1k),
      recordsIncluded: entry.recordsIncluded,
      belowFloor: entry.belowFloor,
      settled: entry.settled,
    })),
    feeBps: raw.feeBps,
    escrowAmount: fromBn(raw.escrowAmount),
    settledCount: raw.settledCount,
    settledAmount: fromBn(raw.settledAmount),
    refunded: raw.refunded,
    status: runStatus(raw.status),
    resultHash: raw.resultHash === null ? null : bytesToHash(raw.resultHash),
    recordsIncluded: raw.recordsIncluded,
    suppressed: raw.suppressed,
    datasetCursor: raw.datasetCursor,
    foldedBatches: raw.foldedBatches,
    foldedHash: bytesToHash(raw.foldedHash),
    createdAt: fromBn(raw.createdAt),
    bump: raw.bump,
  }
}

export function decodeRunResult(raw: RawRunResult): RunResultAccount {
  return {
    run: raw.run,
    encryptionKey: toBytes(raw.encryptionKey),
    nonce: fromBn(raw.nonce),
    ciphertexts: raw.ciphertexts.map(toBytes),
    recordsIncluded: raw.recordsIncluded,
    suppressed: raw.suppressed,
    bump: raw.bump,
  }
}

export async function fetchRun(
  program: GenoVaultProgram,
  address: PublicKey,
): Promise<RunAccount | null> {
  const raw = await program.account.run.fetchNullable(address)
  return raw === null ? null : decodeRun(raw)
}

/**
 * Звіт прогону; `null` — розкриття ще не відбулося.
 *
 * Відсутній акаунт тут не помилка й на екрані має читатись як «ще рахують», а
 * не як «звіту не буде»: `dispatch_reveal` створює його вже після того, як
 * пул вичерпано.
 */
export async function fetchRunResult(
  program: GenoVaultProgram,
  address: PublicKey,
): Promise<RunResultAccount | null> {
  const raw = await program.account.runResult.fetchNullable(address)
  return raw === null ? null : decodeRunResult(raw)
}
