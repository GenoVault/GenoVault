import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import {
  contentHashSchema,
  type DatasetId,
  datasetIdSchema,
  datasetMetadataSchema,
  pricePer1kSchema,
  type SolanaAddress,
  solanaAddressSchema,
} from '@genovault/shared'
import { z } from 'zod'
import { privyUserIdSchema } from './auth.ts'

/**
 * Каталог — дзеркало, а не джерело правди (`FR-002`, `FR-025`).
 *
 * Правда про згоду, гроші й статус прогону живе ончейн; тут лежить те, чого в
 * акаунті `Dataset` немає й не має бути: назва, опис, схема полів, агрегована
 * статистика, походження. Записів датасету тут немає — вони існують рівно в
 * одному вигляді, шифротекстом у сховищі (`storage.ts`), і ключа від них цей
 * процес не має (`FR-004a`).
 *
 * Драйвер за інтерфейсом, а не Drizzle напряму, з тієї ж причини, з якої так
 * зроблено сховище: `T004` чекає на доступи до Postgres, а `T020`-`T022` від
 * них не залежать. Коли доступи будуть, поруч стане драйвер `postgres`, і
 * жоден маршрут не зміниться. Драйвер `memory` лишиться потрібним і після
 * того — тестам, які не мають піднімати базу.
 */

/** Збій самого сховища каталогу — на відміну від помилки валідації запиту. */
export class CatalogError extends Error {
  override readonly name = 'CatalogError'
}

/**
 * Стан рядка каталогу.
 *
 * `pending` — метадані заявлені, байтів ще немає. Такий датасет каталог не
 * показує: картка з `content_hash`, за яким нічого не лежить, — це обіцянка
 * вмісту, а не вміст.
 */
export const DATASET_RECORD_STATUSES = ['pending', 'stored'] as const

export const datasetRecordSchema = z.strictObject({
  datasetId: datasetIdSchema,
  owner: solanaAddressSchema,
  /**
   * Хто зареєстрував — DID сесії, не адреса. Потрібен, щоб журнал відповідав
   * на питання «через який вхід це зробили», коли адреса та сама (`FR-025`).
   */
  registeredBy: privyUserIdSchema,
  contentHash: contentHashSchema,
  pricePer1k: pricePer1kSchema,
  metadata: datasetMetadataSchema,
  status: z.enum(DATASET_RECORD_STATUSES),
  /** Розмір конверта в байтах; є лише в стані `stored`. */
  byteLength: z.number().int().nonnegative().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type DatasetRecord = z.infer<typeof datasetRecordSchema>

export interface CatalogStore {
  readonly kind: 'memory' | 'fs'
  /**
   * Прив'язує сесію до адреси власника при першій реєстрації й повертає ту
   * адресу, яка від цього моменту вважається адресою цього входу.
   *
   * Повертає, а не кидає: викликач сам вирішує, як назвати розходження, і
   * саме він знає, яку адресу просили. Повторний виклик із тією самою
   * адресою — не подія, а повтор запиту після обриву мережі.
   */
  bindOwner(userId: string, owner: SolanaAddress): Promise<SolanaAddress>
  ownerOf(userId: string): Promise<SolanaAddress | undefined>
  getDataset(owner: SolanaAddress, datasetId: DatasetId): Promise<DatasetRecord | undefined>
  putDataset(record: DatasetRecord): Promise<void>
}

/**
 * `pricePer1k` — bigint, а `JSON.stringify` на bigint кидає.
 *
 * Тому серіалізація явна: у файл іде десятковий рядок, назад він проходить
 * через `pricePer1kSchema`, який рядок і приймає. Мовчазного переходу в
 * `number` тут бути не може — на u64 він втрачає точність, а це недоплата
 * власнику, яка не падає.
 */
function serializeRecord(record: DatasetRecord): string {
  return JSON.stringify(
    record,
    (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
    2,
  )
}

// ── Драйвери ──────────────────────────────────────────────────────────────────

export const catalogConfigSchema = z.discriminatedUnion('driver', [
  z.strictObject({ driver: z.literal('memory') }),
  z.strictObject({ driver: z.literal('fs'), root: z.string().min(1) }),
])

export type CatalogConfig = z.infer<typeof catalogConfigSchema>

export function catalogConfigFromEnv(env: Record<string, string | undefined>): CatalogConfig {
  return catalogConfigSchema.parse(
    env.CATALOG_DRIVER === 'memory'
      ? { driver: 'memory' }
      : { driver: 'fs', root: env.CATALOG_FS_ROOT },
  )
}

export function createCatalog(config: CatalogConfig): CatalogStore {
  return config.driver === 'memory' ? memoryCatalog() : fsCatalog(config.root)
}

/** Ключ рядка датасету в межах сховища. Обидві частини — з перевірених алфавітів. */
function datasetKey(owner: SolanaAddress, datasetId: DatasetId): string {
  return `${owner}/${datasetId}`
}

/**
 * Ім'я файлу для сесії.
 *
 * DID виду `did:privy:<id>` містить двокрапки, а вони заборонені в іменах
 * файлів на Windows — розробка тут іде саме на ньому. Береться хвіст після
 * префікса: схема звужує його до `[A-Za-z0-9]{1,64}`, тобто до алфавіту, який
 * не має жодного шляхового значення в жодній із файлових систем.
 */
function userFileName(userId: string): string {
  return privyUserIdSchema.parse(userId).slice('did:privy:'.length)
}

export function memoryCatalog(): CatalogStore {
  const owners = new Map<string, SolanaAddress>()
  const datasets = new Map<string, DatasetRecord>()

  return {
    kind: 'memory',

    async bindOwner(userId, owner) {
      const key = privyUserIdSchema.parse(userId)
      const bound = owners.get(key)
      if (bound !== undefined) return bound
      owners.set(key, owner)
      return owner
    },

    async ownerOf(userId) {
      return owners.get(privyUserIdSchema.parse(userId))
    },

    async getDataset(owner, datasetId) {
      return datasets.get(datasetKey(owner, datasetId))
    },

    async putDataset(record) {
      datasets.set(datasetKey(record.owner, record.datasetId), datasetRecordSchema.parse(record))
    },
  }
}

/**
 * Частина шляху всередині кореня каталогу.
 *
 * Перевіряється кожна окремо, а не лише підсумковий шлях: `..` у середині
 * ланцюга може лишитися **всередині** кореня — `datasets/<owner>/../../etc`
 * зводиться до `<root>/etc`, тобто перевірка «не виходить за корінь» його
 * пропускає. Алфавіт тут вужчий за будь-який із наших ідентифікаторів, тож
 * законні ключі він не чіпає.
 */
const PART_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export function fsCatalog(root: string): CatalogStore {
  const base = resolve(root)

  const pathFor = (...parts: string[]): string => {
    for (const part of parts) {
      if (!PART_PATTERN.test(part) || part.includes('..')) {
        throw new CatalogError(`неприйнятна частина ключа каталогу: ${part}`)
      }
    }

    const full = resolve(join(base, ...parts))
    if (!full.startsWith(base + sep)) {
      throw new CatalogError(`ключ веде за межі каталогу: ${parts.join('/')}`)
    }
    return full
  }

  const readJson = async (path: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw new CatalogError(`не вдалося прочитати ${path}: ${describe(error)}`)
    }
  }

  return {
    kind: 'fs',

    async bindOwner(userId, owner) {
      const path = pathFor('owners', `${userFileName(userId)}.json`)
      await mkdir(dirname(path), { recursive: true })

      // `wx` — створити або впасти, без перезапису. Це і є перевірка «прив'язки
      // ще немає» одним кроком: два одночасні перші запити не можуть обидва
      // побачити порожньо й записати різні адреси, бо створення файлу
      // ексклюзивне на рівні файлової системи.
      try {
        await writeFile(path, JSON.stringify({ userId, owner, boundAt: now() }, null, 2), {
          flag: 'wx',
        })
        return owner
      } catch (error) {
        if (!isExists(error))
          throw new CatalogError(`не вдалося прив'язати сесію: ${describe(error)}`)
      }

      const stored = await readJson(path)
      const parsed = z.object({ owner: solanaAddressSchema }).safeParse(stored)
      if (!parsed.success) throw new CatalogError(`прив'язка сесії у ${path} не читається`)
      return parsed.data.owner
    },

    async ownerOf(userId) {
      const stored = await readJson(pathFor('owners', `${userFileName(userId)}.json`))
      if (stored === undefined) return undefined
      const parsed = z.object({ owner: solanaAddressSchema }).safeParse(stored)
      return parsed.success ? parsed.data.owner : undefined
    },

    async getDataset(owner, datasetId) {
      const stored = await readJson(pathFor('datasets', owner, `${datasetId}.json`))
      if (stored === undefined) return undefined

      // Рядок із диска проходить ту саму схему, що й рядок із запиту: файл
      // могли покласти міграцією або відновленням із копії, і довіряти йому
      // більше, ніж мережі, підстав немає.
      const parsed = datasetRecordSchema.safeParse(stored)
      if (!parsed.success) {
        throw new CatalogError(`рядок каталогу ${owner}/${datasetId} не проходить власну схему`)
      }
      return parsed.data
    },

    async putDataset(record) {
      const checked = datasetRecordSchema.parse(record)
      const path = pathFor('datasets', checked.owner, `${checked.datasetId}.json`)
      await mkdir(dirname(path), { recursive: true })
      try {
        await writeFile(path, serializeRecord(checked))
      } catch (error) {
        throw new CatalogError(`не вдалося записати рядок каталогу: ${describe(error)}`)
      }
    },
  }
}

// ── Допоміжне ─────────────────────────────────────────────────────────────────

export function now(): string {
  return new Date().toISOString()
}

function code(error: unknown): string | undefined {
  return error !== null && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined
}

function isNotFound(error: unknown): boolean {
  return code(error) === 'ENOENT'
}

function isExists(error: unknown): boolean {
  return code(error) === 'EEXIST'
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
