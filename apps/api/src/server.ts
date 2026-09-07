import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { createApp } from './app.ts'
import { authConfigFromEnv, createTokenVerifier } from './services/auth.ts'
import { catalogConfigFromEnv, createCatalog } from './services/catalog.ts'
import { createChainReader, createRegistrationBuilder } from './services/chain.ts'
import { createStorage, storageConfigFromEnv } from './services/storage.ts'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// 8879, а не 8080: типовий порт часто зайнятий стороннім софтом, і бінд на
// 0.0.0.0 маскує конфлікт — сервіс «слухається», але localhost віддає чуже.
const port = Number(process.env.API_PORT ?? 8879)

// Налаштування автентифікації розбирається на старті: API без перевіряча
// сесій не має підніматись узагалі, бо кожен його стан далі — це «хто це».
const auth = authConfigFromEnv(process.env)

// Решта налаштувань розбирається тут із тієї ж причини: сховище без кореня і
// каталог без драйвера мають зупинити старт, а не перший запит власника, який
// на той момент уже витратив десять хвилин на шифрування.
const catalog = catalogConfigFromEnv(process.env)
const storage = storageConfigFromEnv(process.env)
const rpcUrl = process.env.SOLANA_RPC_URL ?? 'http://127.0.0.1:8909'

const app = createApp({
  verifyAccessToken: createTokenVerifier(auth),
  catalog: createCatalog(catalog),
  storage: createStorage(storage),
  buildRegistration: createRegistrationBuilder(rpcUrl),
  readChain: createChainReader(rpcUrl),
  baseUrl: process.env.API_BASE_URL ?? `http://127.0.0.1:${port}`,
  ...(process.env.API_MAX_CIPHERTEXT_BYTES === undefined
    ? {}
    : { maxCiphertextBytes: Number(process.env.API_MAX_CIPHERTEXT_BYTES) }),
})

serve({ fetch: app.fetch, port }, (info) => {
  logger.info(
    {
      port: info.port,
      authKeySource: auth.keySource,
      catalogDriver: catalog.driver,
      storageDriver: storage.driver,
    },
    'api піднято',
  )
})
