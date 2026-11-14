/**
 * Host half of the usage hub bundle.
 *
 * Owns one same-origin HTTP route under the Web GUI origin that answers the
 * aggregated subscription snapshot the composer dock renders:
 *
 *   - `deepseek`: GET `<baseUrl>/user/balance` on the official DeepSeek API
 *     with the API key named by `deepseek.apiKeyEnv`, resolved through the
 *     harness credential store (a stored key outranks the environment).
 *   - `opencode-go`: the Go allowance. `opencode.mode: api` signs the Go API
 *     key (`opencode.apiKeyEnv`, the same key the `opencode-go` model provider
 *     uses) against `GET <apiBaseUrl>/usage` on the gateway, so no local
 *     OpenCode app is required. `mode: server` instead asks
 *     `/api/experimental/usage/limits` on a local OpenCode server — attaching
 *     to a configured `baseUrl` + `password`, or starting the CLI on a free
 *     loopback port and stopping it after the read — which also returns the
 *     Console workspace and budgets. `mode: auto` prefers the API key and
 *     falls back to the server.
 *
 * The snapshot is cached for `cacheTtlMs`; the client passes `refresh=1` for a
 * user-initiated refresh. Requests must pass the Connection trust fence.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import { homedir } from 'node:os'
import path from 'node:path'

/** Route namespace shared with `client.js`. */
const API_PREFIX = '/dsh-usage-hub/api'
/** Default snapshot cache lifetime. */
const DEFAULT_TTL_MS = 5 * 60 * 1000
/** Upper bound for one provider HTTP call. */
const FETCH_TIMEOUT_MS = 20 * 1000
/** Upper bound for one `opencode serve` cold start. */
const DEFAULT_START_TIMEOUT_MS = 25 * 1000
/** Route in the OpenCode server the Go allowance is read from. */
const OPENCODE_LIMITS_PATH = '/api/experimental/usage/limits'
/**
 * Where the pi-ai adapter stores a provider key signed in through its own
 * flow; read as a second source when the named reference is unset.
 */
const DEFAULT_OPENCODE_RECORD = 'llm-pi-ai/opencode-go'

/** Host services this plugin needs before it activates. */
export const inject = ['webServer', 'connection']

/**
 * Mount the snapshot route while this plugin is active.
 * @param ctx - Host Cordis context carrying the injected services.
 * @param config - bundle row configuration.
 */
export function apply(ctx, config) {
  const settings = resolveSettings(config ?? {})
  const state = { cache: undefined, inflight: undefined }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (req, res) => {
      handle(ctx, settings, state, req, res).catch((error) => {
        // The handler answers its own failures; this is the last resort for a
        // throw outside the request pipeline.
        try {
          send(res, 500, failure({ code: 'internal', message: reasonOf(error) }))
        } catch {
          // The response is already gone.
        }
      })
    },
  }), 'usage-hub: subscription snapshot API')
}

/**
 * Normalize the row config with defaults.
 * @param config - raw bundle row config.
 * @returns resolved settings.
 */
function resolveSettings(config) {
  const deepseek = isRecord(config.deepseek) ? config.deepseek : {}
  const opencode = isRecord(config.opencode) ? config.opencode : {}
  return {
    cacheTtlMs: positiveInteger(config.cacheTtlMs, DEFAULT_TTL_MS),
    deepseek: {
      enabled: deepseek.enabled !== false,
      apiKeyEnv: nonEmptyString(deepseek.apiKeyEnv) ?? 'DEEPSEEK_API_KEY',
      baseUrl: trimTrailingSlash(nonEmptyString(deepseek.baseUrl) ?? 'https://api.deepseek.com'),
    },
    opencode: {
      enabled: opencode.enabled !== false,
      mode: opencode.mode === 'api' || opencode.mode === 'server' ? opencode.mode : 'auto',
      apiKeyEnv: nonEmptyString(opencode.apiKeyEnv) ?? 'OPENCODE_GO_API_KEY',
      credentialRecord: nonEmptyString(opencode.credentialRecord) ?? DEFAULT_OPENCODE_RECORD,
      apiBaseUrl: trimTrailingSlash(nonEmptyString(opencode.apiBaseUrl) ?? 'https://opencode.ai/zen/go/v1'),
      cliPath: nonEmptyString(opencode.cliPath) ?? '',
      baseUrl: trimTrailingSlash(nonEmptyString(opencode.baseUrl) ?? ''),
      password: nonEmptyString(opencode.password) ?? '',
      startTimeoutMs: positiveInteger(opencode.startTimeoutMs, DEFAULT_START_TIMEOUT_MS),
    },
  }
}

/**
 * Answer one snapshot request.
 * @param ctx - Host context.
 * @param settings - resolved plugin settings.
 * @param state - cache and in-flight slot.
 * @param req - Node request.
 * @param res - Node response.
 */
async function handle(ctx, settings, state, req, res) {
  let rejection
  try {
    rejection = ctx.connection.requestRejection(req)
  } catch (error) {
    rejection = reasonOf(error)
  }
  if (rejection !== undefined) {
    send(res, 403, failure({ code: 'forbidden', message: 'forbidden' }))
    return
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    send(res, 405, failure({ code: 'method', message: 'method not allowed' }))
    return
  }

  const url = new URL(req.url ?? '/', 'http://dsh.internal')
  const method = url.pathname.startsWith(API_PREFIX)
    ? url.pathname.slice(API_PREFIX.length).replace(/^\/+/, '').replace(/\/+$/, '')
    : ''
  if (method !== 'snapshot') {
    send(res, 404, failure({ code: 'not-found', message: `unknown method "${method}"` }))
    return
  }

  const refresh = url.searchParams.get('refresh') === '1'
  send(res, 200, { ok: true, value: await snapshot(ctx, settings, state, refresh) })
}

/**
 * Return the cached snapshot, or collect a fresh one.
 * @param ctx - Host context.
 * @param settings - resolved plugin settings.
 * @param state - cache and in-flight slot.
 * @param refresh - true to bypass the cache.
 * @returns snapshot payload.
 */
async function snapshot(ctx, settings, state, refresh) {
  const now = Date.now()
  if (!refresh && state.cache !== undefined && now - state.cache.at < settings.cacheTtlMs) {
    return state.cache.value
  }
  if (state.inflight !== undefined) return state.inflight
  state.inflight = collect(ctx, settings)
    .then((value) => {
      state.cache = { at: Date.now(), value }
      return value
    })
    .finally(() => {
      state.inflight = undefined
    })
  return state.inflight
}

/**
 * Collect every enabled provider in parallel; one failure never hides another.
 * @param ctx - Host context.
 * @param settings - resolved plugin settings.
 * @returns snapshot payload.
 */
async function collect(ctx, settings) {
  const results = await Promise.all([
    guard('deepseek', 'DeepSeek API', () => deepseekUsage(ctx, settings.deepseek)),
    guard('opencode-go', 'OpenCode Go', () => opencodeUsage(ctx, settings.opencode)),
  ])
  return { at: Date.now(), providers: results.filter((entry) => entry !== undefined) }
}

/**
 * Run one provider read, converting a throw into an error entry.
 * @param id - stable provider id.
 * @param label - display label.
 * @param read - provider reader.
 * @returns provider entry; a turned-off provider keeps its label and status so
 * the panel can say why it is empty.
 */
async function guard(id, label, read) {
  let entry
  try {
    entry = await read()
  } catch (error) {
    const code = typeof error?.code === 'string' && error.code !== '' ? error.code : 'provider-failed'
    return { id, label, status: 'error', error: { code, message: reasonOf(error) } }
  }
  if (entry === undefined) return { id, label, status: 'disabled' }
  return { id, label, ...entry }
}

/**
 * Read the DeepSeek account balance.
 * @param ctx - Host context (credential seam).
 * @param options - deepseek settings.
 * @returns provider entry, or undefined when disabled.
 */
async function deepseekUsage(ctx, options) {
  if (!options.enabled) return undefined
  const credential = await resolveCredential(ctx, options.apiKeyEnv)
  if (credential === undefined) {
    return {
      status: 'unconfigured',
      error: { code: 'missing-credential', message: `no credential named ${options.apiKeyEnv}` },
    }
  }

  const response = await fetch(`${options.baseUrl}/user/balance`, {
    method: 'GET',
    headers: { authorization: `Bearer ${credential.value}`, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return {
      status: 'error',
      error: {
        code: `http-${response.status}`,
        message: `DeepSeek answered HTTP ${response.status}${detail === '' ? '' : `: ${clip(detail)}`}`,
      },
    }
  }

  const body = await response.json()
  const balances = Array.isArray(body?.balance_infos) ? body.balance_infos : []
  return {
    status: 'ok',
    credentialSource: credential.source,
    isAvailable: body?.is_available === true,
    balances: balances.map((entry) => ({
      currency: String(entry?.currency ?? ''),
      total: String(entry?.total_balance ?? '0'),
      granted: String(entry?.granted_balance ?? '0'),
      toppedUp: String(entry?.topped_up_balance ?? '0'),
    })),
  }
}

/**
 * Resolve one credential reference through the harness seam, then a provider
 * record the pi-ai adapter may have written, then the process environment.
 * @param ctx - Host context.
 * @param reference - credential reference name.
 * @param recordKey - optional `llm-pi-ai/<provider>` record to fall back to.
 * @returns `{ value, source }`, or undefined when nothing is set.
 */
async function resolveCredential(ctx, reference, recordKey) {
  let credentials
  try {
    credentials = ctx.get('credentials')
  } catch {
    credentials = undefined
  }
  if (credentials === undefined || credentials === null) {
    // Some Host compositions expose the seam as a property only.
    try {
      credentials = ctx.credentials
    } catch {
      credentials = undefined
    }
  }
  if (credentials !== undefined && credentials !== null && typeof credentials.resolve === 'function') {
    try {
      const hit = await credentials.resolve(reference)
      if (hit !== undefined && hit !== null && typeof hit.value === 'string' && hit.value !== '') {
        return { value: hit.value, source: String(hit.source ?? 'store') }
      }
    } catch {
      // A seam failure falls through to the record and the environment.
    }
    if (typeof recordKey === 'string' && recordKey !== '' && typeof credentials.readRecord === 'function') {
      try {
        const record = await credentials.readRecord(recordKey)
        if (record !== undefined && record !== null && typeof record.key === 'string' && record.key !== '') {
          return { value: record.key, source: 'record' }
        }
      } catch {
        // Nothing stored under that record.
      }
    }
  }
  const ambient = process.env[reference]
  if (typeof ambient === 'string' && ambient !== '') return { value: ambient, source: 'environment' }
  return undefined
}

/**
 * Read the OpenCode Go allowance.
 *
 * Two sources, chosen by `opencode.mode`:
 *   - `api` signs the Go API key (the same key the `opencode-go` model provider
 *     uses) against the gateway's usage endpoint, so no local OpenCode app is
 *     needed;
 *   - `server` asks a local OpenCode server, which additionally reports the
 *     Console workspace and the Console budgets.
 * `auto` prefers the API key and falls back to a local server.
 *
 * @param ctx - Host context (credential seam).
 * @param options - opencode settings.
 * @returns provider entry, or undefined when disabled.
 */
async function opencodeUsage(ctx, options) {
  if (!options.enabled) return undefined
  const credential = await resolveCredential(ctx, options.apiKeyEnv, options.credentialRecord)

  if (options.mode !== 'server' && credential !== undefined) {
    const entry = await zenUsage(options, credential)
    if (options.mode === 'api' || entry.status === 'ok') return entry
    // `auto`: a key the gateway refuses still leaves the local server as a
    // second source, and its failure must not hide the key's diagnostic.
    try {
      return await serverUsage(options)
    } catch {
      return entry
    }
  }
  if (options.mode === 'api') {
    return {
      status: 'unconfigured',
      error: { code: 'missing-credential', message: `no credential named ${options.apiKeyEnv}` },
    }
  }
  try {
    return await serverUsage(options)
  } catch (error) {
    if (options.mode === 'auto' && credential === undefined && error?.code === 'cli-missing') {
      throw coded('no-source', `neither a ${options.apiKeyEnv} credential nor a local OpenCode CLI was found`)
    }
    throw error
  }
}

/**
 * Read the allowance with the Go API key.
 * @param options - opencode settings.
 * @param credential - the resolved key.
 * @returns provider entry.
 */
async function zenUsage(options, credential) {
  const response = await fetch(`${options.apiBaseUrl}/usage`, {
    method: 'GET',
    headers: { authorization: `Bearer ${credential.value}`, accept: 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    return {
      status: 'error',
      error: {
        code: `http-${response.status}`,
        message: `the OpenCode usage endpoint answered HTTP ${response.status}${detail === '' ? '' : `: ${clip(detail)}`}`,
      },
    }
  }

  const body = await response.json().catch(() => undefined)
  const usage = isRecord(body?.usage) ? body.usage : isRecord(body?.data) ? body.data : body
  const allowance = {
    rolling: windowOf(usage?.rolling),
    weekly: windowOf(usage?.weekly),
    monthly: windowOf(usage?.monthly),
  }
  if (allowance.rolling === undefined && allowance.weekly === undefined && allowance.monthly === undefined) {
    return {
      status: 'error',
      error: {
        code: 'unexpected-payload',
        message: `the usage endpoint returned no allowance window: ${clip(JSON.stringify(body ?? null))}`,
      },
    }
  }
  return { status: 'ok', source: 'api-key', credentialSource: credential.source, allowance }
}

/**
 * Read the allowance, workspace, and budgets from a local OpenCode server.
 * @param options - opencode settings.
 * @returns provider entry.
 */
async function serverUsage(options) {
  const server = await acquireServer(options)
  try {
    const response = await fetch(`${server.url}${OPENCODE_LIMITS_PATH}`, {
      method: 'GET',
      headers: { authorization: basicAuth('opencode', server.password), accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return {
        status: 'error',
        error: {
          code: `http-${response.status}`,
          message: `OpenCode answered HTTP ${response.status}${detail === '' ? '' : `: ${clip(detail)}`}`,
        },
      }
    }

    const body = await response.json()
    const data = body?.data
    if (data === null || data === undefined) {
      return {
        status: 'unconfigured',
        error: {
          code: 'not-signed-in',
          message: 'the OpenCode Console workspace this location signs in to is unknown',
        },
      }
    }

    const workspace = isRecord(data.workspace) ? data.workspace : {}
    return {
      status: 'ok',
      workspace: {
        id: String(workspace.id ?? ''),
        name: String(workspace.name ?? ''),
        usageUrl: String(workspace.usageURL ?? ''),
      },
      allowance: {
        rolling: windowOf(data.go?.rolling),
        weekly: windowOf(data.go?.weekly),
        monthly: windowOf(data.go?.monthly),
      },
      budgets: Array.isArray(data.budgets)
        ? data.budgets.map((entry) => ({
          id: String(entry?.id ?? ''),
          limit: Number(entry?.limit ?? 0),
          spent: Number(entry?.spent ?? 0),
          scope: String(entry?.scope ?? ''),
        }))
        : [],
    }
  } finally {
    stopServer(server)
  }
}

/**
 * Attach to a configured OpenCode server, or start one for this read.
 * @param options - opencode settings.
 * @returns `{ url, password, child }`; `child` is undefined when attached.
 */
async function acquireServer(options) {
  if (options.baseUrl !== '' && options.password !== '') {
    return { url: options.baseUrl, password: options.password, child: undefined }
  }

  const cli = resolveCli(options.cliPath)
  if (cli === undefined) {
    throw coded('cli-missing', 'the OpenCode CLI was not found; set opencode.cliPath in the bundle configuration')
  }
  const port = await freePort()
  const child = spawn(cli, ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    return await waitForServer(child, options.startTimeoutMs)
  } catch (error) {
    stopServer({ child })
    if (error?.code === 'ENOENT') {
      throw coded('cli-missing', `the OpenCode CLI "${cli}" was not found; set opencode.cliPath in the bundle configuration`)
    }
    throw error
  }
}

/**
 * Wait for a started OpenCode server to print its address and password.
 * @param child - spawned CLI process.
 * @param timeoutMs - cold-start bound.
 * @returns `{ url, password, child }`.
 */
function waitForServer(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = ''
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout?.removeListener('data', onData)
      child.stderr?.removeListener('data', onData)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      if (error !== undefined) reject(error)
      else resolve(value)
    }
    const onData = (chunk) => {
      buffer += String(chunk)
      const address = /server listening on (http:\/\/\S+)/.exec(buffer)
      const password = /server password (\S+)/.exec(buffer)
      if (address !== null && password !== null) {
        finish(undefined, { url: address[1], password: password[1], child })
      }
    }
    const onExit = (code) => {
      finish(new Error(`the OpenCode server exited with code ${String(code)}${tailOf(buffer)}`))
    }
    const onError = (error) => {
      finish(error)
    }
    const timer = setTimeout(() => {
      finish(coded('cli-timeout', 'the OpenCode server did not start in time'))
    }, timeoutMs)

    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', onExit)
    child.once('error', onError)
  })
}

/**
 * Stop a server this plugin started.
 * @param server - `{ child }`.
 */
function stopServer(server) {
  const child = server?.child
  if (child === undefined || child === null) return
  try {
    child.kill()
  } catch {
    // The process is already gone.
  }
}

/**
 * Locate the OpenCode CLI executable.
 * @param configured - configured path, may be empty.
 * @returns absolute executable path, or undefined.
 */
function resolveCli(configured) {
  const candidates = []
  if (configured !== '') candidates.push(configured)
  const fromEnv = process.env.OPENCODE_CLI_PATH
  if (typeof fromEnv === 'string' && fromEnv !== '') candidates.push(fromEnv)
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA
    if (typeof localAppData === 'string' && localAppData !== '') {
      candidates.push(path.join(localAppData, 'Programs', 'ai.opencode.desktop', 'resources', 'opencode-cli.exe'))
    }
    candidates.push(path.join(homedir(), 'AppData', 'Local', 'Programs', 'ai.opencode.desktop', 'resources', 'opencode-cli.exe'))
  } else {
    candidates.push(path.join(homedir(), '.opencode', 'bin', 'opencode'))
  }
  for (const candidate of candidates) {
    if (candidate !== '' && existsSync(candidate)) return candidate
  }
  // An unqualified name resolves through PATH when spawned.
  return configured === '' ? 'opencode' : configured
}

/**
 * Pick a free loopback port.
 * @returns port number.
 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => {
        if (port > 0) resolve(port)
        else reject(new Error('could not reserve a local port'))
      })
    })
  })
}

/**
 * Normalize one allowance window.
 *
 * The Console route reports `{ percent, limited, resetsAt }` with an epoch
 * millisecond `resetsAt`; the gateway usage endpoint reports
 * `{ status, percent, resetsAt }` and may spell the reset as an ISO instant.
 * Both normalize here.
 *
 * @param value - raw window.
 * @returns normalized window, or undefined.
 */
function windowOf(value) {
  if (!isRecord(value)) return undefined
  const percent = Number(value.percent ?? 0)
  const status = typeof value.status === 'string' ? value.status.toLowerCase() : ''
  return {
    percent: Number.isFinite(percent) ? percent : 0,
    limited: value.limited === true
      || status === 'limited'
      || status === 'exhausted'
      || (status !== '' && status !== 'ok' && status !== 'active' && percent >= 100),
    resetsAt: instantOf(value.resetsAt),
  }
}

/**
 * Read one reset instant as epoch milliseconds.
 * @param value - epoch milliseconds, a numeric string, or an ISO instant.
 * @returns epoch milliseconds, or 0.
 */
function instantOf(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value !== '') {
    if (/^\d+$/.test(value)) return Number(value)
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

/**
 * Build one HTTP Basic authorization header.
 * @param user - user name.
 * @param password - password.
 * @returns header value.
 */
function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`
}

/**
 * Write one JSON answer.
 * @param res - Node response.
 * @param status - HTTP status.
 * @param payload - JSON payload.
 */
function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

/**
 * Build the failure envelope.
 * @param error - `{ code, message }`.
 * @returns response payload.
 */
function failure(error) {
  return { ok: false, error }
}

/**
 * Whether a value is a plain object.
 * @param value - candidate.
 * @returns true for a plain object.
 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Trimmed non-empty string, or undefined.
 * @param value - candidate.
 * @returns trimmed string or undefined.
 */
function nonEmptyString(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Strip trailing slashes from a base URL.
 * @param value - URL.
 * @returns URL without a trailing slash.
 */
function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '')
}

/**
 * Positive integer, or the fallback.
 * @param value - candidate.
 * @param fallback - default.
 * @returns positive integer.
 */
function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

/**
 * Clip one diagnostic for display.
 * @param text - raw text.
 * @returns clipped text.
 */
function clip(text) {
  const value = String(text).replace(/\s+/g, ' ').trim()
  return value.length > 200 ? `${value.slice(0, 200)}…` : value
}

/**
 * Last part of the captured server output, for a startup failure.
 * @param buffer - captured output.
 * @returns appended diagnostic.
 */
function tailOf(buffer) {
  const lines = buffer.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
  const tail = lines.slice(-3).join(' | ')
  return tail === '' ? '' : `: ${clip(tail)}`
}

/**
 * Read a message from an unknown thrown value.
 * @param error - thrown value.
 * @returns message text.
 */
function reasonOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Build one Error carrying a stable machine code the browser half maps to a
 * localized hint.
 * @param code - stable code.
 * @param message - English diagnostic, shown as secondary detail.
 * @returns the error.
 */
function coded(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}