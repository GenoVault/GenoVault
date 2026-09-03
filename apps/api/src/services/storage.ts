import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  type ContentHash,
  contentHash,
  contentHashSchema,
  DatasetEnvelopeError,
  datasetIdSchema,
  inspectEnvelope,
} from '@genovault/shared'
import { z } from 'zod'

/**
 * Сховище шифротексту (`FR-004`).
 *
 * Тут лежить виключно шифротекст, і жоден шлях у цьому модулі не має способу
 * його прочитати як записи: `apps/api` не залежить від `@genovault/crypto` і
 * ключа не має (`FR-004a`). Усе, що вміє цей код, — упізнати конверт за
 * формою, порахувати його відбиток і покласти байти під адресу, яка з цього
 * відбитка й виводиться.
 */

/** Збій самого сховища — на відміну від `DatasetEnvelopeError`, який каже «це не шифротекст». */
export class StorageError extends Error {
  override readonly name = 'StorageError'
}

export interface StorageDriver {
  readonly kind: 'fs' | 'supabase'
  put(key: string, bytes: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array>
  exists(key: string): Promise<boolean>
}

export interface StoredCiphertext {
  key: string
  /** sha-256 конверта — те саме число, що лежить у `Dataset.content_hash` ончейн. */
  contentHash: ContentHash
  recordCount: number
  markerCount: number
  byteLength: number
}

/**
 * Адреса об'єкта виводиться з його ж вмісту, а не з номера версії.
 *
 * Тому покласти під ту саму адресу інші байти неможливо за побудовою: інші
 * байти дають інший відбиток, тобто іншу адресу. Це прибирає цілий клас тихих
 * помилок — перезапис вмісту, по якому вже пройшов завершений прогін, зробив
 * би `Run.content_hash` посиланням у нікуди, і помітив би це лише незалежний
 * звіряч (`SC-008`), та й то post factum. Заодно шлях від ланцюга до байтів
 * стає прямим: у `Dataset` і в `Run` лежить рівно те, чим адресується об'єкт.
 *
 * `dataset_id` у шляху потрібен не для адресації, а щоб об'єкти власника
 * лежали під спільним префіксом — під це стануть політики доступу (`T069`).
 */
export function ciphertextKey(datasetId: string, hash: string): string {
  return `datasets/${datasetIdSchema.parse(datasetId)}/${contentHashSchema.parse(hash)}.gvds`
}

const KEY_PATTERN = /^datasets\/[a-z0-9][a-z0-9-]{2,31}\/[0-9a-f]{64}\.gvds$/

/**
 * Кладе шифротекст у сховище — і не кладе нічого іншого.
 *
 * Порядок тут — половина сенсу задачі: конверт перевіряється **до** запису.
 * Сховище, у яке відкритий текст спершу лягає, а потім видаляється, уже його
 * приймало; резервні копії й журнали провайдера про наше «потім» не знають.
 *
 * Відбиток рахується тут же, з тих самих байтів, і з нього ж виводиться
 * адреса. Викликач не може передати відбиток окремо — тобто не може
 * помилитись і покласти байти під чужий відбиток.
 */
export async function storeCiphertext(
  driver: StorageDriver,
  datasetId: string,
  bytes: Uint8Array,
): Promise<StoredCiphertext> {
  const id = datasetIdSchema.parse(datasetId)
  const header = inspectEnvelope(bytes)
  const hash = await contentHash(bytes)
  const key = ciphertextKey(id, hash)

  // Той самий вміст під тією самою адресою — повторне завантаження після
  // обриву мережі, а не конфлікт. Байти вже там, і вони ті самі за побудовою.
  if (!(await driver.exists(key))) await driver.put(key, bytes)

  return {
    key,
    contentHash: hash,
    recordCount: header.recordCount,
    markerCount: header.markerCount,
    byteLength: bytes.length,
  }
}

/**
 * Читає шифротекст назад — і перевіряє його вдруге.
 *
 * Перевірка на читанні не дублює перевірку на записі: у сховище можна
 * покласти об'єкт повз наш код — консоллю провайдера, скриптом міграції,
 * відновленням з резервної копії. Гейт, який стоїть лише на вході, про такі
 * шляхи не знає.
 */
export async function loadCiphertext(
  driver: StorageDriver,
  datasetId: string,
  hash: ContentHash,
): Promise<Uint8Array> {
  const id = datasetIdSchema.parse(datasetId)
  const key = ciphertextKey(id, hash)
  const bytes = await driver.get(key)

  inspectEnvelope(bytes)

  const actual = await contentHash(bytes)
  if (actual !== hash) {
    throw new DatasetEnvelopeError(`вміст за адресою ${key} не відповідає своєму відбитку`)
  }

  return bytes
}

// ── Драйвери ──────────────────────────────────────────────────────────────────

export const storageConfigSchema = z.discriminatedUnion('driver', [
  z.strictObject({ driver: z.literal('fs'), root: z.string().min(1) }),
  z.strictObject({
    driver: z.literal('supabase'),
    url: z.url(),
    serviceKey: z.string().min(1),
    bucket: z.string().min(1),
  }),
])

export type StorageConfig = z.infer<typeof storageConfigSchema>

export function storageConfigFromEnv(env: Record<string, string | undefined>): StorageConfig {
  // Форма конфігурації залежить від драйвера, тому розбирається як союз:
  // `supabase` без ключа має падати на старті, а не на першому завантаженні.
  return storageConfigSchema.parse(
    env.STORAGE_DRIVER === 'supabase'
      ? {
          driver: 'supabase',
          url: env.SUPABASE_URL,
          serviceKey: env.SUPABASE_SERVICE_KEY,
          bucket: env.SUPABASE_STORAGE_BUCKET,
        }
      : { driver: 'fs', root: env.STORAGE_FS_ROOT },
  )
}

export function createStorage(config: StorageConfig): StorageDriver {
  return config.driver === 'fs' ? fsDriver(config.root) : supabaseDriver(config)
}

function assertKey(key: string): void {
  // Ключі будує `ciphertextKey`, але драйвер — теж межа: шлях, зібраний
  // деінде, не має шансу вийти за корінь сховища через `..`.
  if (!KEY_PATTERN.test(key)) throw new StorageError(`неприйнятний ключ об'єкта: ${key}`)
}

export function fsDriver(root: string): StorageDriver {
  const base = resolve(root)

  const pathFor = (key: string): string => {
    assertKey(key)
    const full = resolve(join(base, key))
    if (full !== base && !full.startsWith(base + sep)) {
      throw new StorageError(`ключ веде за межі сховища: ${key}`)
    }
    return full
  }

  return {
    kind: 'fs',

    async put(key, bytes) {
      const path = pathFor(key)
      await mkdir(dirname(path), { recursive: true })

      // Запис через тимчасовий файл і перейменування: обірваний запис лишає
      // недописаний файл, який пройшов би за розміром не завжди, зате читався б
      // як «об'єкт є». Перейменування в межах теки атомарне.
      const temp = `${path}.${process.pid}.partial`
      try {
        await writeFile(temp, bytes)
        await rename(temp, path)
      } catch (error) {
        await unlink(temp).catch(() => {})
        throw new StorageError(`не вдалося записати ${key}: ${describe(error)}`)
      }
    },

    async get(key) {
      try {
        // `readFile` віддає `Buffer`; контракт драйвера обіцяє `Uint8Array`, і
        // два драйвери мають повертати те саме. Подання без копії — Buffer уже
        // володіє своїм відрізком пам'яті.
        const buffer = await readFile(pathFor(key))
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      } catch (error) {
        if (error instanceof StorageError) throw error
        throw new StorageError(`не вдалося прочитати ${key}: ${describe(error)}`)
      }
    },

    async exists(key) {
      // `access`, а не читання: перевірка наявності не має коштувати шістнадцять
      // мегабайтів у купі щоразу, коли власник повторює завантаження.
      try {
        await access(pathFor(key))
        return true
      } catch (error) {
        if (error instanceof StorageError) throw error
        return false
      }
    },
  }
}

export function supabaseDriver(
  config: Extract<StorageConfig, { driver: 'supabase' }>,
): StorageDriver {
  const endpoint = (key: string): string => {
    assertKey(key)
    return `${config.url.replace(/\/+$/, '')}/storage/v1/object/${config.bucket}/${key}`
  }

  const auth = {
    Authorization: `Bearer ${config.serviceKey}`,
    // Ключ сервісної ролі обходить політики доступу, тому він живе тільки тут
    // і тільки в заголовку: у шлях або в журнал він не потрапляє ніде.
    apikey: config.serviceKey,
  }

  return {
    kind: 'supabase',

    async put(key, bytes) {
      const response = await fetch(endpoint(key), {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/octet-stream' },
        body: bytes,
      })
      if (!response.ok) {
        throw new StorageError(`сховище відмовило на записі ${key}: ${response.status}`)
      }
    },

    async get(key) {
      const response = await fetch(endpoint(key), { headers: auth })
      if (!response.ok) {
        throw new StorageError(`сховище відмовило на читанні ${key}: ${response.status}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    },

    async exists(key) {
      const response = await fetch(endpoint(key), { method: 'HEAD', headers: auth })
      return response.ok
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
