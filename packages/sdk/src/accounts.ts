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
