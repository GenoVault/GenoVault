import { serve } from '@hono/node-server'
import { pino } from 'pino'
import { createApp } from './app.ts'
import { authConfigFromEnv, createTokenVerifier } from './services/auth.ts'

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' })

// 8879, а не 8080: типовий порт часто зайнятий стороннім софтом, і бінд на
// 0.0.0.0 маскує конфлікт — сервіс «слухається», але localhost віддає чуже.
const port = Number(process.env.API_PORT ?? 8879)

// Налаштування автентифікації розбирається на старті: API без перевіряча
// сесій не має підніматись узагалі, бо кожен його стан далі — це «хто це».
const auth = authConfigFromEnv(process.env)

const app = createApp({ verifyAccessToken: createTokenVerifier(auth) })

serve({ fetch: app.fetch, port }, (info) => {
  logger.info({ port: info.port, authKeySource: auth.keySource }, 'api піднято')
})
