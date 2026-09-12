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

const RUN_SEED = Buffer.from('run')
const VAULT_SEED = Buffer.from('vault')
const RESULT_SEED = Buffer.from('result')

/**
 * Сейф платформи. Seeds: `["vault"]`.
 *
 * Один на всі прогони, а не по сейфу на прогін (`T024`): розподіл між
 * п'ятдесятьма власниками інакше впирався б у п'ятдесят переказів, і `SC-007`
 * міряв би не арифметику, а кількість транзакцій.
 */
export function vaultAddress(programId: PublicKey = PROGRAM_ID): DerivedAddress {
  return derive([VAULT_SEED], programId)
}

/**
 * Прогін. Seeds: `["run", buyer, nonce_le_u64]`.
 *
 * Нонс обирає покупець, і саме він розрізняє два прогони того самого покупця з
 * тим самим складом пулу. `bigint`, а не `number`: `u64` не вміщається в
 * безпечне ціле, і мовчазне округлення дало б адресу, за якою нічого немає.
 */
export function runAddress(
  buyer: PublicKey,
  nonce: bigint,
  programId: PublicKey = PROGRAM_ID,
): DerivedAddress {
  if (nonce < 0n || nonce > 0xffff_ffff_ffff_ffffn) {
    throw new RangeError(`нонс прогону має бути u64, отримано ${nonce}`)
  }

  const seed = Buffer.alloc(8)
  seed.writeBigUInt64LE(nonce, 0)
  return derive([RUN_SEED, buyer.toBuffer(), seed], programId)
}

/**
 * Звіт прогону під ключем покупця. Seeds: `["result", run]`.
 *
 * Окремий акаунт, а не поле в `Run`: звіт читає покупець, а `Run` читає
 * незалежний звіряч журналу (`FR-025`), і 24 шифротексти по 32 байти в
 * спільному акаунті зробили б друге читання дорожчим заради першого.
 */
export function runResultAddress(
  run: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): DerivedAddress {
  return derive([RESULT_SEED, run.toBuffer()], programId)
}

/**
 * Токен-акаунт покупця, з якого списується депозит.
 *
 * Мінт платформи завжди Token-2022 — це перевіряє `initialize` (`owner =
 * TOKEN_2022_PROGRAM_ID`), тож програму токена вгадувати не треба. Деривація
 * виписана тут, а не взята з `@solana/spl-token`: заради однієї формули з
 * трьох seeds пакет тягнув би за собою ще й увесь клієнт токена, а обидві
 * адреси нижче — константи протоколу, які не змінюються між мережами.
 *
 * Програма приймає **будь-який** токен-акаунт покупця (`token::authority =
 * buyer`), не лише асоційований. Ця функція — тільки зручний типовий вибір;
 * гаманець, який тримає баланс деінде, передає свою адресу явно.
 */
export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')

export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
)

export function associatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_2022_PROGRAM_ID,
): DerivedAddress {
  return derive(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )
}
