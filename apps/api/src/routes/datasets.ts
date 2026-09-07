import {
  contentHash,
  type DatasetCard,
  type DatasetId,
  datasetIdSchema,
  datasetQuerySchema,
  inspectEnvelope,
  registerDatasetRequestSchema,
  type SolanaAddress,
  solanaAddressSchema,
} from '@genovault/shared'
import { Hono } from 'hono'
import { fail } from '../errors.ts'
import { type AuthVariables, requireAuth } from '../middleware/auth.ts'
import type { TokenVerifier } from '../services/auth.ts'
import { type CatalogStore, type DatasetRecord, now } from '../services/catalog.ts'
import {
  type ChainReader,
  deriveDatasetAddress,
  type RegistrationBuilder,
} from '../services/chain.ts'
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

/**
 * Скрізь `| undefined` явно.
 *
 * Під `exactOptionalPropertyTypes` «поля немає» і «поле є, але порожнє» —
 * різні типи, а `createApp` передає саме друге. Без цього кожне поле довелось
 * би проносити умовним спредом, і проводка перетворюється на десять рядків,
 * у яких легко загубити одне.
 */
export interface DatasetRoutesDeps {
  verify?: TokenVerifier | undefined
  catalog?: CatalogStore | undefined
  storage?: StorageDriver | undefined
  buildRegistration?: RegistrationBuilder | undefined
  readChain?: ChainReader | undefined
  /** Звідки збирається `uploadUrl` у відповіді. */
  baseUrl?: string | undefined
  maxCiphertextBytes?: number | undefined
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
  readChain: ChainReader
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
  const { catalog, storage, buildRegistration, readChain } = deps
  if (
    catalog === undefined ||
    storage === undefined ||
    buildRegistration === undefined ||
    readChain === undefined
  ) {
    return undefined
  }
  return {
    catalog,
    storage,
    buildRegistration,
    readChain,
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

  /**
   * Перелік каталогу (`FR-002`).
   *
   * Датасети без байтів у переліку не видно нікому, крім їхнього ж власника:
   * картка з `content_hash`, за яким нічого не лежить, — це обіцянка вмісту, а
   * не вміст, і покупець, який замовить по ній прогін, отримає відмову вже
   * після оплати. Свої ж власник має бачити — інакше він не знає, що аплоад
   * обірвався.
   *
   * Стану ланцюга тут немає навмисно: читання мережі на кожен із двадцяти
   * рядків зробило б `SC-011` («перший екран каталогу < 2 с») недосяжним за
   * побудовою. Згода й бейдж живуть у картці окремого датасету.
   */
  routes.get('/datasets', requireAuth(deps.verify), async (c) => {
    if (services === undefined) return fail(c, 'INTERNAL', 'внутрішня помилка')

    const query = datasetQuerySchema.parse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    )
    const actor = c.get('actor')
    const self = await services.catalog.ownerOf(actor.userId)

    // `owner=me` — це не адреса, а «мої». Сесія без прив'язаної адреси нічим
    // не володіє, і перелік для неї порожній, а не «усі датасети».
    const requested = query.owner === 'me' ? self : query.owner
    if (query.owner === 'me' && self === undefined) {
      return c.json({ items: [], total: 0, limit: query.limit, offset: query.offset })
    }

    const page = await services.catalog.listDatasets({
      ...(requested === undefined ? {} : { owner: requested }),
      ...(query.source === undefined ? {} : { source: query.source }),
      ...(query.minRecords === undefined ? {} : { minRecords: query.minRecords }),
      ...(query.maxPricePer1k === undefined ? {} : { maxPricePer1k: query.maxPricePer1k }),
      ...(query.q === undefined ? {} : { q: query.q.toLowerCase() }),
      includePending: requested !== undefined && requested === self,
      limit: query.limit,
      offset: query.offset,
    })

    return c.json({
      items: page.items.map(toCard),
      total: page.total,
      limit: query.limit,
      offset: query.offset,
    })
  })

  /**
   * Картка окремого датасету (`FR-002`, `FR-024`).
   *
   * Адреса власника стоїть у шляху, бо ідентифікатор унікальний лише в межах
   * власника: seeds PDA — `["dataset", owner, dataset_id]`. Саме заради цього
   * `dataset_id` іде в деривацію як є, з межею в 32 символи, — щоб адресу
   * датасету можна було відновити з URL каталогу без жодного запиту до мережі.
   * URL без власника вимагав би зворотного індексу «ідентифікатор → власник»,
   * тобто ще одного місця, де правда може розійтися з ланцюгом.
   */
  routes.get('/datasets/:owner/:id', requireAuth(deps.verify), async (c) => {
    if (services === undefined) return fail(c, 'INTERNAL', 'внутрішня помилка')

    const owner = solanaAddressSchema.parse(c.req.param('owner'))
    const datasetId = datasetIdSchema.parse(c.req.param('id'))

    const record = await services.catalog.getDataset(owner, datasetId)
    const actor = c.get('actor')
    const self = await services.catalog.ownerOf(actor.userId)

    // Незавантажений датасет видно тільки власнику — тією ж відповіддю, що й
    // неіснуючий, бо інакше 404 і 403 разом дають перелік чужих чернеток.
    if (record === undefined || (record.status !== 'stored' && record.owner !== self)) {
      return fail(c, 'NOT_FOUND', 'датасет не знайдено')
    }

    const chain = await services.readChain(record.owner, record.datasetId)

    return c.json({
      ...toCard(record),
      schema: record.metadata.schema,
      statistics:
        record.metadata.statistics === undefined
          ? null
          : // Походження чисел їде разом із числами: їх заявив власник, і жодна
            // перевірка їх не чіпала. MPC рахує інше й під гарантією.
            { ...record.metadata.statistics, declaredBy: 'owner', verified: false },
      provenance: record.metadata.provenance,
      contentHash: record.contentHash,
      ciphertextStored: record.status === 'stored',
      chain,
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

/**
 * Рядок каталогу → картка.
 *
 * Перетворення в одному місці, бо перелік і окремий датасет мають показувати
 * те саме: розбіжність між ними читалася б як зміна датасету між екранами.
 * Ціна їде рядком — `JSON.parse` зводить числа до `double` і мовчки округлює
 * усе, що більше за 2^53, а `price_per_1k` це u64.
 */
function toCard(record: DatasetRecord): DatasetCard {
  return {
    datasetId: record.datasetId,
    owner: record.owner,
    datasetAddress: deriveDatasetAddress(record.owner, record.datasetId),
    title: record.metadata.title,
    description: record.metadata.description,
    recordCount: record.metadata.recordCount,
    markerCount: record.metadata.markerCount,
    source: record.metadata.provenance.source,
    pricePer1k: record.pricePer1k.toString(),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function uploadUrl(baseUrl: string, datasetId: DatasetId): string {
  return `${baseUrl.replace(/\/+$/, '')}/datasets/${datasetId}/ciphertext`
}
