import {
  contentHash,
  type DatasetId,
  datasetIdSchema,
  inspectEnvelope,
  registerDatasetRequestSchema,
  type SolanaAddress,
} from '@genovault/shared'
import { Hono } from 'hono'
import { fail } from '../errors.ts'
import { type AuthVariables, requireAuth } from '../middleware/auth.ts'
import type { TokenVerifier } from '../services/auth.ts'
import { type CatalogStore, type DatasetRecord, now } from '../services/catalog.ts'
import type { RegistrationBuilder } from '../services/chain.ts'
import { type StorageDriver, storeCiphertext } from '../services/storage.ts'

/**
 * Реєстрація датасету і завантаження шифротексту (`FR-001`, `FR-004`).
 *
 * Порядок дій власника тут такий: `POST /datasets` заявляє метадані й відбиток
 * майбутнього вмісту, `PUT /datasets/:id/ciphertext` кладе байти, і **аж тоді**
 * власник підписує `register_dataset`. Обернений порядок дав би в мережі
 * `Dataset` із `content_hash`, за яким нічого не лежить: обірваний аплоад
 * лишив би його таким назавжди, а прибрати це коштувало б ще однієї
 * транзакції. Тому інструкція віддається на першому кроці, а сенс має після
 * другого — і саме так її описано у відповіді.
 *
 * Ключа шифрування тут немає й бути не може (`FR-004a`). Усе, що ці маршрути
 * знають про вміст, — що він має форму конверта `GVDS`, скільки в ньому кадрів
 * і який у нього відбиток.
 */

export interface DatasetRoutesDeps {
  // `| undefined` явно: під `exactOptionalPropertyTypes` «поля немає» і «поле
  // є, але порожнє» — різні типи, а `createApp` передає саме друге.
  verify?: TokenVerifier | undefined
  catalog?: CatalogStore
  storage?: StorageDriver
  buildRegistration?: RegistrationBuilder
  /** Звідки збирається `uploadUrl` у відповіді. */
  baseUrl?: string
  maxCiphertextBytes?: number
}

/**
 * Стеля розміру конверта — 64 МіБ.
 *
 * Стандартний датасет `SC-003` (10 000 записів × 64 маркери) важить ~21 МБ, і
 * межа взята з запасом на профіль, який ще не зафіксовано. Тіло читається в
 * пам'ять цілком, тож це водночас межа того, скільки один запит займає у
 * процесі; потокове приймання — питання не `T020`, а обсягів, яких ще немає.
 */
export const DEFAULT_MAX_CIPHERTEXT_BYTES = 64 * 1024 * 1024

const DEFAULT_BASE_URL = 'http://127.0.0.1:8879'

interface DatasetServices {
  catalog: CatalogStore
  storage: StorageDriver
  buildRegistration: RegistrationBuilder
  baseUrl: string
  maxCiphertextBytes: number
}

/**
 * Ненастроєні сервіси — це збій сервера, а не поганий запит.
 *
 * Та сама логіка, що й у `requireAuth` із відсутнім перевірячем: маршрут, який
 * нікуди не пише, не має відповідати «не знайдено» чи «неправильні дані» —
 * обидві відповіді кажуть клієнту виправити те, що ціле.
 */
function configure(deps: DatasetRoutesDeps): DatasetServices | undefined {
  const { catalog, storage, buildRegistration } = deps
  if (catalog === undefined || storage === undefined || buildRegistration === undefined) {
    return undefined
  }
  return {
    catalog,
    storage,
    buildRegistration,
    baseUrl: deps.baseUrl ?? DEFAULT_BASE_URL,
    maxCiphertextBytes: deps.maxCiphertextBytes ?? DEFAULT_MAX_CIPHERTEXT_BYTES,
  }
}

export function datasetRoutes(deps: DatasetRoutesDeps) {
  const routes = new Hono<{ Variables: AuthVariables }>()
  const services = configure(deps)

  routes.post('/datasets', requireAuth(deps.verify), async (c) => {
    if (services === undefined) return fail(c, 'INTERNAL', 'внутрішня помилка')

    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      // Поламаний JSON — це 400. Без цієї гілки `SyntaxError` дійшов би до
      // обробника помилок застосунку й став би 500, тобто «це ми зламались».
      return fail(c, 'INVALID_INPUT', 'тіло запиту не є JSON')
    }

    const request = registerDatasetRequestSchema.parse(raw)
    const actor = c.get('actor')

    // TOFU: перша реєстрація прив'язує сесію до адреси, далі вона мусить
    // збігатися. Ончейн від цього не залежить — транзакцію все одно підписує
    // власник адреси, — але каталог перестає бути місцем, де можна безкоштовно
    // наговорити від чужого імені.
    const bound = await services.catalog.bindOwner(actor.userId, request.owner)
    if (bound !== request.owner) {
      return fail(
        c,
        'INVALID_INPUT',
        `ця сесія вже прив'язана до адреси ${bound}; реєстрація на іншу адресу потребує іншого входу`,
      )
    }

    const existing = await services.catalog.getDataset(request.owner, request.datasetId)
    if (existing !== undefined && existing.contentHash !== request.contentHash) {
      // Новий вміст під тим самим ідентифікатором — це нова версія датасету
      // (`update_dataset_content`, `FR-003`), а не повторна реєстрація. Тихо
      // перезаписати відбиток означало б відв'язати завершені прогони від
      // того, по чому вони насправді йшли.
      return fail(
        c,
        'INVALID_INPUT',
        `датасет ${request.datasetId} уже зареєстрований з іншим відбитком вмісту`,
      )
    }

    const registration = await services.buildRegistration({
      owner: request.owner,
      datasetId: request.datasetId,
      contentHash: request.contentHash,
      recordCountClaimed: request.metadata.recordCount,
      pricePer1k: request.pricePer1k,
    })

    const timestamp = now()
    const record: DatasetRecord = {
      datasetId: request.datasetId,
      owner: request.owner,
      registeredBy: actor.userId,
      contentHash: request.contentHash,
      pricePer1k: request.pricePer1k,
      metadata: request.metadata,
      // Той самий запит удруге — це повтор після обриву, а не конфлікт: вміст
      // заявлено той самий, тож стан лишається таким, якого він уже досяг.
      status: existing?.status ?? 'pending',
      ...(existing?.byteLength === undefined ? {} : { byteLength: existing.byteLength }),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    await services.catalog.putDataset(record)

    return c.json(
      {
        datasetId: record.datasetId,
        owner: record.owner,
        datasetAddress: registration.datasetAddress,
        contentHash: record.contentHash,
        status: record.status,
        uploadUrl: uploadUrl(services.baseUrl, record.datasetId),
        registration: {
          instruction: registration.instruction,
          // Підписувати після успішного завантаження — див. заголовок модуля.
          signAfter: 'ciphertext-upload',
        },
      },
      existing === undefined ? 201 : 200,
    )
  })

  routes.put('/datasets/:id/ciphertext', requireAuth(deps.verify), async (c) => {
    if (services === undefined) return fail(c, 'INTERNAL', 'внутрішня помилка')

    const actor = c.get('actor')
    const datasetId = datasetIdSchema.parse(c.req.param('id'))

    const record = await resolveOwnDataset(services.catalog, actor.userId, datasetId)
    if (record === undefined) return fail(c, 'NOT_FOUND', 'датасет не знайдено')

    // Заявлена довжина перевіряється до читання тіла: сенсу приймати в пам'ять
    // гігабайт, щоб потім його відхилити, немає.
    const declared = Number(c.req.header('content-length') ?? Number.NaN)
    if (Number.isFinite(declared) && declared > services.maxCiphertextBytes) {
      return fail(
        c,
        'INVALID_INPUT',
        `шифротекст більший за межу ${services.maxCiphertextBytes} байтів`,
      )
    }

    const bytes = new Uint8Array(await c.req.arrayBuffer())
    if (bytes.length > services.maxCiphertextBytes) {
      return fail(
        c,
        'INVALID_INPUT',
        `шифротекст більший за межу ${services.maxCiphertextBytes} байтів`,
      )
    }

    // Порядок навмисний: форма конверта, потім відбиток, потім заявлені числа —
    // і лише після цього запис. Сховище не має приймати байти, яких ніхто не
    // заявляв: інакше будь-яка сесія кладе туди будь-який правильний за формою
    // конверт під власним ідентифікатором і платить за це нічим.
    const header = inspectEnvelope(bytes)
    const uploaded = await contentHash(bytes)

    if (uploaded !== record.contentHash) {
      return fail(
        c,
        'INVALID_INPUT',
        `відбиток завантаженого вмісту (${uploaded}) не збігається із заявленим при реєстрації`,
      )
    }
    if (header.recordCount !== record.metadata.recordCount) {
      return fail(
        c,
        'INVALID_INPUT',
        `у конверті ${header.recordCount} записів, а заявлено ${record.metadata.recordCount}`,
      )
    }
    if (header.markerCount !== record.metadata.markerCount) {
      return fail(
        c,
        'INVALID_INPUT',
        `у конверті ${header.markerCount} маркерів, а заявлено ${record.metadata.markerCount}`,
      )
    }

    const stored = await storeCiphertext(services.storage, datasetId, bytes)

    await services.catalog.putDataset({
      ...record,
      status: 'stored',
      byteLength: stored.byteLength,
      updatedAt: now(),
    })

    return c.json({
      storedHash: stored.contentHash,
      recordCount: stored.recordCount,
      markerCount: stored.markerCount,
      byteLength: stored.byteLength,
      status: 'stored',
    })
  })

  return routes
}

/**
 * Датасет цієї сесії — або нічого.
 *
 * «Не твій» і «не існує» тут навмисно одна відповідь: різні коди сказали б
 * покупцю, які ідентифікатори зайняті в чужих власників, а каталог відповідає
 * на це окремим маршрутом і за окремими правилами (`FR-002`).
 */
async function resolveOwnDataset(
  catalog: CatalogStore,
  userId: string,
  datasetId: DatasetId,
): Promise<DatasetRecord | undefined> {
  const owner: SolanaAddress | undefined = await catalog.ownerOf(userId)
  return owner === undefined ? undefined : catalog.getDataset(owner, datasetId)
}

function uploadUrl(baseUrl: string, datasetId: DatasetId): string {
  return `${baseUrl.replace(/\/+$/, '')}/datasets/${datasetId}/ciphertext`
}
