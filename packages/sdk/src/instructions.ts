import type { PublicKey, TransactionInstruction } from '@solana/web3.js'
import { hashToBytes, toBn } from './convert.ts'
import { consentAddress, datasetAddress, platformConfigAddress } from './pda.ts'
import type { GenoVaultProgram } from './program.ts'

/**
 * Побудова інструкцій — і тільки побудова (`FR-023a`, правило репозиторію).
 *
 * Кожна функція повертає неспідписану `TransactionInstruction`. Ані підпису,
 * ані відправки тут немає й не має бути: API, який підписує від імені
 * власника, — це API, який може розпоряджатися його датасетом і його
 * нарахуваннями. Хто підписує, той і вирішує; наша справа — скласти байти.
 *
 * Усі білдери `async` — включно з тими, де перевірка аргументів падає ще до
 * першого `await`. Функція, оголошена як `Promise`, але здатна кинути
 * синхронно, змушує викликача ловити помилку двома способами, і другий
 * забувають. Тут будь-яка відмова приходить відмовою проміса.
 */

export interface InitializeParams {
  authority: PublicKey
  mint: PublicKey
  feeBps: number
}

/** Одноразове розгортання платформи (`FR-019`). */
export async function initializeIx(
  program: GenoVaultProgram,
  params: InitializeParams,
): Promise<TransactionInstruction> {
  if (!Number.isInteger(params.feeBps) || params.feeBps < 0 || params.feeBps > 0xffff) {
    throw new RangeError(`комісія має бути u16, отримано ${params.feeBps}`)
  }

  return program.methods
    .initialize(params.feeBps)
    .accountsPartial({
      authority: params.authority,
      config: platformConfigAddress(program.programId).address,
      mint: params.mint,
    })
    .instruction()
}

export interface RegisterDatasetParams {
  owner: PublicKey
  datasetId: string
  /** sha-256 шифротексту в тій самій формі, що й у `packages/shared`. */
  contentHash: string
  recordCountClaimed: bigint | number
  pricePer1k: bigint | number
}

/** Реєстрація датасету (`FR-001`, `FR-003`). */
export async function registerDatasetIx(
  program: GenoVaultProgram,
  params: RegisterDatasetParams,
): Promise<TransactionInstruction> {
  return program.methods
    .registerDataset({
      datasetId: params.datasetId,
      contentHash: hashToBytes(params.contentHash),
      recordCountClaimed: toBn(params.recordCountClaimed),
      pricePer1k: toBn(params.pricePer1k),
    })
    .accountsPartial({
      owner: params.owner,
      dataset: datasetAddress(params.owner, params.datasetId, program.programId).address,
    })
    .instruction()
}

export interface UpdateDatasetContentParams {
  owner: PublicKey
  datasetId: string
  contentHash: string
  recordCountClaimed: bigint | number
}

/** Нова версія вмісту (`FR-003`). Стара лишається — на неї посилаються прогони. */
export async function updateDatasetContentIx(
  program: GenoVaultProgram,
  params: UpdateDatasetContentParams,
): Promise<TransactionInstruction> {
  return program.methods
    .updateDatasetContent(hashToBytes(params.contentHash), toBn(params.recordCountClaimed))
    .accountsPartial({
      owner: params.owner,
      dataset: datasetAddress(params.owner, params.datasetId, program.programId).address,
    })
    .instruction()
}

export interface SetDatasetPriceParams {
  owner: PublicKey
  datasetId: string
  pricePer1k: bigint | number
}

/** Ціна за 1000 записів (`FR-015`). */
export async function setDatasetPriceIx(
  program: GenoVaultProgram,
  params: SetDatasetPriceParams,
): Promise<TransactionInstruction> {
  return program.methods
    .setDatasetPrice(toBn(params.pricePer1k))
    .accountsPartial({
      owner: params.owner,
      dataset: datasetAddress(params.owner, params.datasetId, program.programId).address,
    })
    .instruction()
}

export interface DatasetRef {
  owner: PublicKey
  datasetId: string
}

/** Зняття датасету з каталогу. Акаунт лишається — на нього посилаються прогони. */
export async function retireDatasetIx(
  program: GenoVaultProgram,
  params: DatasetRef,
): Promise<TransactionInstruction> {
  return program.methods
    .retireDataset()
    .accountsPartial({
      owner: params.owner,
      dataset: datasetAddress(params.owner, params.datasetId, program.programId).address,
    })
    .instruction()
}

export interface SetConsentParams extends DatasetRef {
  /**
   * Номер чинної версії згоди з акаунта датасету; 0 — згоди ще немає.
   *
   * Береться параметром, а не вгадується: адреса нової версії в програмі —
   * це `consent_version.saturating_add(1)`, а резолвер Anchor виразів не
   * обчислює. Мовчазне «спробуємо версію 1» створило б згоду не там, де
   * її шукатиме програма, і зрозуміло це стало б на першому ж прогоні.
   */
  currentVersion: number
  allowedUses: number
  forbiddenUses: number
  buyerCategories: number
  /** `null` — без строку. Секунди Unix, як і всюди в програмі. */
  expiresAt: bigint | number | null
}

/** Нова версія згоди (`FR-005`). Попередня лишається окремим акаунтом. */
export async function setConsentIx(
  program: GenoVaultProgram,
  params: SetConsentParams,
): Promise<TransactionInstruction> {
  const dataset = datasetAddress(params.owner, params.datasetId, program.programId).address
  const next = consentAddress(dataset, params.currentVersion + 1, program.programId).address

  return program.methods
    .setConsent({
      allowedUses: params.allowedUses,
      forbiddenUses: params.forbiddenUses,
      buyerCategories: params.buyerCategories,
      expiresAt: params.expiresAt === null ? null : toBn(params.expiresAt),
    })
    .accountsPartial({
      owner: params.owner,
      dataset,
      // Для першої згоди попередньої не існує: `null` тут — це «акаунта немає»,
      // а не «підставте будь-який». Anchor кладе замість нього програму.
      previousConsent:
        params.currentVersion === 0
          ? null
          : consentAddress(dataset, params.currentVersion, program.programId).address,
      consent: next,
    })
    .instruction()
}

export interface RevokeConsentParams extends DatasetRef {
  currentVersion: number
}

/** Відкликання згоди (`FR-007`). Діє на прогони, замовлені після нього. */
export async function revokeConsentIx(
  program: GenoVaultProgram,
  params: RevokeConsentParams,
): Promise<TransactionInstruction> {
  const dataset = datasetAddress(params.owner, params.datasetId, program.programId).address

  return program.methods
    .revokeConsent()
    .accountsPartial({
      owner: params.owner,
      dataset,
      consent: consentAddress(dataset, params.currentVersion, program.programId).address,
    })
    .instruction()
}
