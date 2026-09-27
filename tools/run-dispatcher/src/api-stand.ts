/**
 * The real API server on a local stand (`T041`).
 *
 * Not `createApp()` in-process: the point of measuring the API layer is that
 * it is the process a buyer talks to, with its own environment parsing, its
 * own chain readers and its own token check. What the stand replaces is only
 * the identity provider — sessions are signed here with a key generated for
 * the run, and the server is told to trust that key through the same `pem`
 * setting a deployment would use for Privy's.
 *
 * Nothing in this file is part of the product.
 */

import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Issuer and audience the server checks; the audience is ours to name. */
const ISSUER = 'privy.io'
const APP_ID = 'genovault-sc004-stand'
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

export class ApiStandError extends Error {
  override readonly name = 'ApiStandError'
}

export interface ApiStandOptions {
  /** Repository root: the server is started from `apps/api/src/server.ts`. */
  repoRoot: string
  /** Where the catalog and the ciphertext storage live for this run. */
  workDir: string
  rpcUrl: string
  port: number
  onLog?(line: string): void
}

export interface ApiResponse {
  status: number
  body: unknown
}

export interface ApiStand {
  url: string
  /** A signed session for `did:privy:<subject>`; one subject, one identity. */
  session(subject: string): Promise<string>
  request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    token: string,
    body?: unknown,
  ): Promise<ApiResponse>
  stop(): Promise<void>
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  return Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString(
    'base64url',
  )
}

function segment(value: Record<string, unknown>): string {
  return b64url(new TextEncoder().encode(JSON.stringify(value)))
}

async function publicKeyPem(key: CryptoKey): Promise<string> {
  const der = Buffer.from(await crypto.subtle.exportKey('spki', key)).toString('base64')
  const body = der.replace(/(.{64})/g, '$1\n')
  const label = 'PUBLIC KEY'
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`
}

async function waitForHealth(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new ApiStandError(`the API server exited with code ${child.exitCode} before it was up`)
    }
    try {
      const response = await fetch(`${url}/health`)
      if (response.ok) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new ApiStandError(`the API server did not answer /health within ${timeoutMs} ms`)
}

export async function startApiStand(options: ApiStandOptions): Promise<ApiStand> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ])
  if (!('privateKey' in keys)) throw new ApiStandError('ECDSA did not return a key pair')

  // Fresh on every start, like the ledger: a catalog from the previous run
  // still binds this run's sessions to last run's owners, and the TOFU check
  // refuses the registration before consent is ever reached.
  const catalogRoot = join(options.workDir, 'catalog')
  const storageRoot = join(options.workDir, 'storage')
  await rm(catalogRoot, { recursive: true, force: true })
  await rm(storageRoot, { recursive: true, force: true })
  await mkdir(catalogRoot, { recursive: true })
  await mkdir(storageRoot, { recursive: true })

  const url = `http://127.0.0.1:${options.port}`
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PRIVY_APP_ID: APP_ID,
    PRIVY_VERIFICATION_KEY: await publicKeyPem(keys.publicKey),
    CATALOG_DRIVER: 'fs',
    CATALOG_FS_ROOT: catalogRoot,
    STORAGE_DRIVER: 'fs',
    STORAGE_FS_ROOT: storageRoot,
    SOLANA_RPC_URL: options.rpcUrl,
    API_PORT: String(options.port),
    API_BASE_URL: url,
    LOG_LEVEL: 'warn',
  }
  // The buyer names the dispatcher in every order; a platform dispatcher
  // inherited from the shell would be a default nobody in the matrix asked for.
  delete env.GENOVAULT_DISPATCHER
  delete env.PRIVY_JWKS_URL

  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'src/server.ts'],
    { cwd: join(options.repoRoot, 'apps', 'api'), env, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const forward = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line.trim() !== '') options.onLog?.(line)
    }
  }
  child.stdout?.on('data', forward)
  child.stderr?.on('data', forward)

  try {
    await waitForHealth(url, child, 30_000)
  } catch (error) {
    child.kill()
    throw error
  }

  let sessions = 0

  return {
    url,

    async session(subject: string): Promise<string> {
      if (!/^[A-Za-z0-9]{1,64}$/.test(subject)) {
        throw new ApiStandError(`subject ${subject} is not a valid Privy id`)
      }
      sessions += 1
      const now = Math.floor(Date.now() / 1000)
      const signed = `${segment({ alg: 'ES256', typ: 'JWT' })}.${segment({
        iss: ISSUER,
        aud: APP_ID,
        sub: `did:privy:${subject}`,
        sid: `stand-session-${sessions}`,
        iat: now - 5,
        exp: now + 3 * 3600,
      })}`
      const signature = await crypto.subtle.sign(
        SIGN,
        keys.privateKey,
        new TextEncoder().encode(signed),
      )
      return `${signed}.${b64url(signature)}`
    },

    async request(method, path, token, body) {
      const headers: Record<string, string> = { authorization: `Bearer ${token}` }
      let payload: string | Uint8Array | undefined
      if (body instanceof Uint8Array) {
        headers['content-type'] = 'application/octet-stream'
        payload = body
      } else if (body !== undefined) {
        headers['content-type'] = 'application/json'
        payload = JSON.stringify(body)
      }
      const response = await fetch(`${url}${path}`, {
        method,
        headers,
        ...(payload === undefined ? {} : { body: payload }),
      })
      const text = await response.text()
      let parsed: unknown = text
      try {
        parsed = text === '' ? null : JSON.parse(text)
      } catch {
        // Left as text: a non-JSON answer is itself worth reporting.
      }
      return { status: response.status, body: parsed }
    },

    async stop() {
      if (child.exitCode !== null) return
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill()
      await exited
    },
  }
}
