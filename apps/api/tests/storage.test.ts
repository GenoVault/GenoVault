import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  contentHash,
  DatasetEnvelopeError,
  HEADER_BYTES,
  LIMB_BYTES,
  NONCE_BYTES,
  SCALAR_FIELD_COUNT,
  serializeEnvelope,
  X25519_KEY_BYTES,
} from '@genovault/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError, z } from 'zod'
import {
  ciphertextKey,
  createStorage,
  fsDriver,
  loadCiphertext,
  StorageError,
  storageConfigFromEnv,
  storeCiphertext,
  supabaseDriver,
} from '../src/services/storage.ts'

const DATASET_ID = 'cohort-alpha'
const MARKERS = 4
const FIELDS = SCALAR_FIELD_COUNT + MARKERS

const SUPABASE = {
  driver: 'supabase',
  url: 'https://project.supabase.co',
  serviceKey: 'service-role-key',
  bucket: 'datasets',
} as const

/**
 * Конверт тут збирається з `serializeEnvelope`, а не шифром.
 *
 * Це не спрощення заради тесту, а сама перевірювана властивість: `apps/api`
 * шифру не має й відрізнити справжній шифротекст від байтів правильної форми
 * не може. Якби цей тест потребував `@genovault/crypto`, він доводив би, що
 * межа з `FR-004a` не тримається.
 */
function envelope(seed = 1, recordCount = 3): Uint8Array {
  const frames = Array.from({ length: recordCount }, (_, record) => {
    const nonce = new Uint8Array(NONCE_BYTES)
    new DataView(nonce.buffer).setUint32(0, record, true)
    return {
      nonce,
      limbs: Array.from({ length: FIELDS }, (_, field) =>
        Array.from({ length: LIMB_BYTES }, (_, byte) => (seed + record + field + byte) % 256),
      ),
    }
  })

  return serializeEnvelope(
    {
      mxePublicKey: Uint8Array.from({ length: X25519_KEY_BYTES }, () => 0x11),
      ephemeralPublicKey: Uint8Array.from({ length: X25519_KEY_BYTES }, () => 0x22),
      recordCount,
      markerCount: MARKERS,
      fieldsPerRecord: FIELDS,
    },
    frames,
  )
}

/** Те, що власник може завантажити помилково: сирі записи рядок за рядком. */
const PLAINTEXT = new TextEncoder().encode(
  [
    { subjectId: 'S-0001', sex: 1, age: 47, genotypes: [0, 1, 2, 1], affected: 1 },
    { subjectId: 'S-0002', sex: 0, age: 33, genotypes: [1, 1, 0, 2], affected: 0 },
  ]
    .map((record) => JSON.stringify(record))
    .join('\n'),
)

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'genovault-storage-'))
})

afterEach(async () => {
  vi.unstubAllGlobals()
  await rm(root, { recursive: true, force: true })
})

describe('гейт відхиляє все, що не є конвертом', () => {
  it('не приймає сирих записів і нічого при цьому не пише', async () => {
    const driver = fsDriver(root)
    const put = vi.spyOn(driver, 'put')

    await expect(storeCiphertext(driver, DATASET_ID, PLAINTEXT)).rejects.toThrow(
      DatasetEnvelopeError,
    )
    // Ключове — саме це. Сховище, у яке відкритий текст спершу лягає, а потім
    // видаляється, уже його приймало: резервні копії провайдера про наше
    // «потім» не знають.
    expect(put).not.toHaveBeenCalled()
  })

  it('не приймає випадкових байтів, порожнечі й обрізаного конверта', async () => {
    const driver = fsDriver(root)

    await expect(storeCiphertext(driver, DATASET_ID, new Uint8Array(0))).rejects.toThrow(
      /коротший за заголовок/,
    )
    await expect(
      storeCiphertext(
        driver,
        DATASET_ID,
        Uint8Array.from({ length: 4096 }, (_, i) => i % 251),
      ),
    ).rejects.toThrow(/не конверт датасету/)
    await expect(
      storeCiphertext(driver, DATASET_ID, envelope().slice(0, HEADER_BYTES + 20)),
    ).rejects.toThrow(/очікувалось \d+ байт/)
  })

  it('не приймає неприйнятного ідентифікатора датасету', async () => {
    await expect(storeCiphertext(fsDriver(root), 'ЩЕ НЕ ID', envelope())).rejects.toThrow(ZodError)
  })
})

describe('адреса виводиться з вмісту', () => {
  it('кладе байти під ключ, що містить їхній власний відбиток', async () => {
    const bytes = envelope()
    const stored = await storeCiphertext(fsDriver(root), DATASET_ID, bytes)

    expect(stored.contentHash).toBe(await contentHash(bytes))
    expect(stored.key).toBe(ciphertextKey(DATASET_ID, stored.contentHash))
    expect(stored.key).toContain(stored.contentHash)
    expect(stored).toMatchObject({ recordCount: 3, markerCount: MARKERS, byteLength: bytes.length })
  })

  it('різний вміст — різні адреси, тож перезаписати чужі байти нічим', async () => {
    const driver = fsDriver(root)
    const first = await storeCiphertext(driver, DATASET_ID, envelope(1))
    const second = await storeCiphertext(driver, DATASET_ID, envelope(2))

    expect(first.key).not.toBe(second.key)
    // Обидва лишились: другий не став на місце першого, по якому міг уже
    // пройти завершений прогін.
    expect(await driver.exists(first.key)).toBe(true)
    expect(await driver.exists(second.key)).toBe(true)
  })

  it('повторне завантаження тих самих байтів не пише вдруге', async () => {
    const driver = fsDriver(root)
    await storeCiphertext(driver, DATASET_ID, envelope())

    const put = vi.spyOn(driver, 'put')
    const again = await storeCiphertext(driver, DATASET_ID, envelope())

    expect(put).not.toHaveBeenCalled()
    expect(again.contentHash).toBe(await contentHash(envelope()))
  })
})

describe('читання перевіряє вдруге', () => {
  async function writeRaw(hash: string, bytes: Uint8Array) {
    const path = join(root, ciphertextKey(DATASET_ID, hash))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }

  it('повертає ті самі байти', async () => {
    const driver = fsDriver(root)
    const bytes = envelope()
    const stored = await storeCiphertext(driver, DATASET_ID, bytes)

    expect(await loadCiphertext(driver, DATASET_ID, stored.contentHash)).toEqual(bytes)
  })

  it('відхиляє вміст, покладений у сховище повз наш код', async () => {
    // Консоль провайдера, скрипт міграції, відновлення з копії — гейт на вході
    // про ці шляхи не знає, тому перевірка на читанні не є дублюванням.
    const hash = await contentHash(envelope())
    await writeRaw(hash, PLAINTEXT)

    await expect(loadCiphertext(fsDriver(root), DATASET_ID, hash)).rejects.toThrow(
      DatasetEnvelopeError,
    )
  })

  it('відхиляє конверт, що не відповідає своєму відбитку', async () => {
    const wrongHash = await contentHash(envelope(9))
    await writeRaw(wrongHash, envelope(1))

    await expect(loadCiphertext(fsDriver(root), DATASET_ID, wrongHash)).rejects.toThrow(
      /не відповідає своєму відбитку/,
    )
  })
})

describe('драйвер fs', () => {
  it('не випускає ключ за межі кореня', async () => {
    const driver = fsDriver(root)

    await expect(driver.get('../../../etc/passwd')).rejects.toThrow(StorageError)
    await expect(driver.get('datasets/../../escape/aa.gvds')).rejects.toThrow(StorageError)
    await expect(driver.put('anything.txt', envelope())).rejects.toThrow(/неприйнятний ключ/)
  })

  it('не лишає під адресою об єкта недописаного файлу', async () => {
    // Запис іде через тимчасовий файл і перейменування; проміжного стану під
    // самою адресою не буває.
    const driver = fsDriver(root)
    const stored = await storeCiphertext(driver, DATASET_ID, envelope())

    expect((await readFile(join(root, stored.key))).length).toBe(stored.byteLength)
  })
})

describe('драйвер supabase', () => {
  /** HEAD каже «немає», POST і GET успішні — інакше `exists` з'їдав би запис. */
  function stubFetch(status = 200) {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 404 })
        : new Response(null, { status }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('пише в бакет і не кладе ключ сервісної ролі в URL', async () => {
    const fetchMock = stubFetch()
    const bytes = envelope()
    const stored = await storeCiphertext(supabaseDriver(SUPABASE), DATASET_ID, bytes)

    const [url, init] = fetchMock.mock.calls.at(-1) ?? []
    expect(url).toBe(`${SUPABASE.url}/storage/v1/object/${SUPABASE.bucket}/${stored.key}`)
    expect(url).not.toContain(SUPABASE.serviceKey)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ Authorization: `Bearer ${SUPABASE.serviceKey}` })
    expect(init?.body).toBe(bytes)
  })

  it('перетворює відмову сховища на StorageError, а не на мовчазний успіх', async () => {
    stubFetch(403)

    await expect(storeCiphertext(supabaseDriver(SUPABASE), DATASET_ID, envelope())).rejects.toThrow(
      /сховище відмовило на записі/,
    )
  })
})

describe('конфігурація', () => {
  it('за замовчуванням бере fs', () => {
    expect(storageConfigFromEnv({ STORAGE_FS_ROOT: './fixtures/generated/storage' })).toEqual({
      driver: 'fs',
      root: './fixtures/generated/storage',
    })
  })

  it('падає на старті, а не на першому завантаженні', () => {
    // supabase без ключа — це помилка розгортання. Виявити її на першому
    // завантаженні означало б виявити її після того, як власник уже зашифрував
    // і надіслав шістнадцять мегабайтів.
    expect(() =>
      storageConfigFromEnv({ STORAGE_DRIVER: 'supabase', SUPABASE_URL: 'https://x.supabase.co' }),
    ).toThrow(ZodError)
    expect(() => storageConfigFromEnv({ STORAGE_DRIVER: 'fs' })).toThrow(ZodError)
  })

  it('createStorage віддає драйвер, названий у конфігурації', () => {
    expect(createStorage({ driver: 'fs', root }).kind).toBe('fs')
    expect(createStorage(SUPABASE).kind).toBe('supabase')
  })
})

describe('межа FR-004a тримається маніфестом', () => {
  it('apps/api не залежить від шифру ані прямо, ані через Arcium', async () => {
    // Машинна форма жорсткого правила з CLAUDE.md. Поки цей тест зелений,
    // компрометація API не дає доступу до записів — не тому, що ми обіцяли не
    // дешифрувати, а тому, що дешифрувати нічим.
    const manifestSchema = z.object({
      dependencies: z.record(z.string(), z.string()).prefault({}),
      devDependencies: z.record(z.string(), z.string()).prefault({}),
    })
    const raw: unknown = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    )
    const manifest = manifestSchema.parse(raw)
    const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })

    expect(deps).not.toContain('@genovault/crypto')
    expect(deps.filter((name) => name.startsWith('@arcium-hq/'))).toEqual([])
  })
})
