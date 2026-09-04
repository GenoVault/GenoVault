import { datasetIdSchema } from '@genovault/shared'
import { PublicKey } from '@solana/web3.js'
import { PROGRAM_ID } from './program.ts'

/**
 * Деривація адрес програми (`FR-003`, `FR-005`).
 *
 * Ці функції живуть тут, а не виводяться з IDL рантаймом, з двох причин.
 * Перша: адреса датасету має відновлюватись із URL каталогу без жодного
 * запиту до мережі — саме заради цього `dataset_id` іде в seeds як є, з
 * межею в 32 символи. Друга: резолвер Anchor не обчислює виразів, а seeds
 * нової версії згоди у програмі — це `consent_version.saturating_add(1)`,
 * тобто автоматично він її не знайде взагалі.
 *
 * Той самий рядок і та сама межа перевіряються схемою з `packages/shared`:
 * ідентифікатор, довший за seed, дав би не помилку валідації, а помилку
 * деривації десь у надрах web3.js — і не там, де його ввели.
 */

const DATASET_SEED = Buffer.from('dataset')
const CONSENT_SEED = Buffer.from('consent')
const CONFIG_SEED = Buffer.from('config')

export interface DerivedAddress {
  address: PublicKey
  bump: number
}

function derive(seeds: Buffer[], programId: PublicKey): DerivedAddress {
  const [address, bump] = PublicKey.findProgramAddressSync(seeds, programId)
  return { address, bump }
}

/** Конфігурація платформи — єдиний акаунт на всю програму. Seeds: `["config"]`. */
export function platformConfigAddress(programId: PublicKey = PROGRAM_ID): DerivedAddress {
  return derive([CONFIG_SEED], programId)
}

/** Датасет. Seeds: `["dataset", owner, dataset_id]`. */
export function datasetAddress(
  owner: PublicKey,
  datasetId: string,
  programId: PublicKey = PROGRAM_ID,
): DerivedAddress {
  const id = datasetIdSchema.parse(datasetId)
  return derive([DATASET_SEED, owner.toBuffer(), Buffer.from(id, 'utf8')], programId)
}

/**
 * Версія згоди. Seeds: `["consent", dataset, version_le_u32]`.
 *
 * Версія — окремий акаунт, а не перезапис поля, і адреса кожної лишається
 * обчислюваною. Без цього «історія без можливості перезапису» (`FR-005`)
 * трималася б на тому, що ніхто не перезаписав.
 */
export function consentAddress(
  dataset: PublicKey,
  version: number,
  programId: PublicKey = PROGRAM_ID,
): DerivedAddress {
  if (!Number.isInteger(version) || version < 0 || version > 0xffff_ffff) {
    throw new RangeError(`версія згоди має бути u32, отримано ${version}`)
  }

  const seed = Buffer.alloc(4)
  seed.writeUInt32LE(version, 0)
  return derive([CONSENT_SEED, dataset.toBuffer(), seed], programId)
}
