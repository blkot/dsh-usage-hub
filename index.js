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

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'
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
  const codex = isRecord(config.codex) ? config.codex : {}
  // `system` resolves HTTPS_PROXY/ALL_PROXY, then the platform proxy; an
  // explicit empty string means a direct connection, so it must survive the
  // usual "blank means unset" rule.
  const proxy = typeof config.proxy === 'string' ? config.proxy.trim() : 'system'
  return {
    cacheTtlMs: positiveInteger(config.cacheTtlMs, DEFAULT_TTL_MS),
    deepseek: {
      enabled: deepseek.enabled !== false,
      apiKeyEnv: nonEmptyString(deepseek.apiKeyEnv) ?? 'DEEPSEEK_API_KEY',
      baseUrl: trimTrailingSlash(nonEmptyString(deepseek.baseUrl) ?? 'https://api.deepseek.com'),
      proxy: typeof deepseek.proxy === 'string' ? deepseek.proxy.trim() : proxy,
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
      proxy: typeof opencode.proxy === 'string' ? opencode.proxy.trim() : proxy,
    },
    codex: {
      enabled: codex.enabled !== false,
      authPath: nonEmptyString(codex.authPath) ?? '',
      baseUrl: trimTrailingSlash(nonEmptyString(codex.baseUrl) ?? 'https://chatgpt.com/backend-api'),
      proxy: typeof codex.proxy === 'string' ? codex.proxy.trim() : proxy,
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
    guard('codex', 'Codex', () => codexUsage(settings.codex)),
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

/** Cache for the Windows system-proxy lookup. */
let systemProxyCache
/** How long one system-proxy lookup stays fresh. */
const SYSTEM_PROXY_TTL_MS = 60 * 1000

/**
 * Read one endpoint, through the configured proxy when there is one.
 *
 * Loopback targets always go direct: a local OpenCode server must never be
 * handed to the user's HTTP proxy. A system proxy that cannot be reached
 * degrades to a direct call, because a stale proxy setting should not take a
 * reading down when the host is reachable anyway.
 *
 * @param url - absolute URL.
 * @param headers - request headers.
 * @param proxyOption - '' for direct, 'system', or a proxy URL.
 * @returns `{ status, text }`.
 */
async function readJson(url, headers, proxyOption) {
  const target = new URL(url)
  if (proxyOption === '' || isLoopback(target.hostname)) return fetchText(url, headers)
  const proxy = await resolveProxy(proxyOption)
  if (proxy === undefined) return fetchText(url, headers)
  try {
    return await tunnelText(target, headers, proxy)
  } catch (error) {
    if (proxyOption === 'system') return fetchText(url, headers)
    throw coded('network', `${target.host} is unreachable through ${proxy}: ${reasonOf(error)}`)
  }
}

/**
 * One plain request.
 * @param url - absolute URL.
 * @param headers - request headers.
 * @returns `{ status, text }`.
 */
async function fetchText(url, headers) {
  const response = await fetch(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  return { status: response.status, text: await response.text().catch(() => '') }
}

/**
 * An https Agent that rides an already-established TLS socket, so a CONNECT
 * tunnel can carry an ordinary request whose framing Node still parses.
 */
class TunnelAgent extends https.Agent {
  /**
   * @param socket - the TLS socket built on the proxy tunnel.
   */
  constructor(socket) {
    super({ keepAlive: false, maxSockets: 1 })
    this.socket = socket
  }

  /** @returns the tunneled socket for this one request. */
  createConnection() {
    return this.socket
  }
}

/**
 * One request through an HTTP CONNECT tunnel.
 * @param target - parsed target URL.
 * @param headers - request headers.
 * @param proxy - proxy URL.
 * @returns `{ status, text }`.
 */
function tunnelText(target, headers, proxy) {
  const proxyUrl = new URL(proxy)
  return new Promise((resolve, reject) => {
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => {
      fail(new Error(`the proxy did not answer within ${FETCH_TIMEOUT_MS} ms`))
    }, FETCH_TIMEOUT_MS)

    const proxyAuth = proxyUrl.username === ''
      ? {}
      : {
        'proxy-authorization': `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString('base64')}`,
      }
    const connect = http.request({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port === '' ? 80 : proxyUrl.port),
      method: 'CONNECT',
      path: `${target.hostname}:${target.port === '' ? 443 : target.port}`,
      headers: proxyAuth,
    })
    connect.once('error', fail)
    connect.once('connect', (answer, socket) => {
      if (answer.statusCode !== 200) {
        socket.destroy()
        fail(new Error(`the proxy refused CONNECT with HTTP ${answer.statusCode}`))
        return
      }
      const secure = tls.connect({ socket, servername: target.hostname })
      secure.once('error', fail)
      const request = https.request({
        host: target.hostname,
        port: Number(target.port === '' ? 443 : target.port),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { ...headers, connection: 'close' },
        agent: new TunnelAgent(secure),
      }, (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.once('error', fail)
        response.once('end', () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
        })
      })
      request.once('error', fail)
      request.end()
    })
    connect.end()
  })
}

/**
 * Resolve the proxy option into a proxy URL, if any.
 * @param option - 'system' or an explicit proxy URL.
 * @returns proxy URL, or undefined for a direct call.
 */
async function resolveProxy(option) {
  if (option !== 'system') return normaliseProxy(option)
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    const proxy = normaliseProxy(process.env[name])
    if (proxy !== undefined) return proxy
  }
  const now = Date.now()
  if (systemProxyCache !== undefined && now - systemProxyCache.at < SYSTEM_PROXY_TTL_MS) {
    return systemProxyCache.value
  }
  const value = process.platform === 'win32'
    ? await windowsSystemProxy()
    : process.platform === 'darwin'
      ? await macosSystemProxy()
      : undefined
  systemProxyCache = { at: now, value }
  return value
}

/**
 * The Windows per-user proxy, when it is enabled.
 * @returns proxy URL, or undefined.
 */
function windowsSystemProxy() {
  if (process.platform !== 'win32') return Promise.resolve(undefined)
  return new Promise((resolve) => {
    execFile(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined)
          return
        }
        if (!/ProxyEnable\s+REG_DWORD\s+0x1/i.test(stdout)) {
          resolve(undefined)
          return
        }
        const server = /ProxyServer\s+REG_SZ\s+(\S+)/i.exec(stdout)
        resolve(server === null ? undefined : normaliseProxy(server[1]))
      },
    )
  })
}

/**
 * The macOS system proxy, when one is enabled for HTTPS or HTTP traffic.
 * A GUI proxy toggle (ClashX, Surge, …) lives in SystemConfiguration rather
 * than the environment, which is why it is asked for explicitly.
 * @returns proxy URL, or undefined.
 */
function macosSystemProxy() {
  return new Promise((resolve) => {
    execFile('scutil', ['--proxy'], { timeout: 5000 }, (error, stdout) => {
      if (error !== null) {
        resolve(undefined)
        return
      }
      resolve(parseScutilProxy(stdout))
    })
  })
}

/**
 * Parse `scutil --proxy` output into a proxy URL.
 *
 * HTTPS wins over HTTP, because this transport tunnels TLS. A SOCKS-only or
 * PAC setup is left alone: the tunnel speaks HTTP CONNECT.
 *
 * @param text - command output.
 * @returns proxy URL, or undefined.
 */
function parseScutilProxy(text) {
  const value = (key) => {
    const match = new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)\\s*$`, 'm').exec(text)
    return match === null ? undefined : match[1]
  }
  for (const scheme of ['HTTPS', 'HTTP']) {
    if (value(`${scheme}Enable`) !== '1') continue
    const host = value(`${scheme}Proxy`)
    const port = value(`${scheme}Port`)
    if (host === undefined || port === undefined) continue
    return normaliseProxy(`${host}:${port}`)
  }
  return undefined
}

/**
 * Normalize a proxy spelling into a URL.
 * @param value - `host:port`, `http://host:port`, or `https=h:p;http=h:p`.
 * @returns proxy URL, or undefined.
 */
function normaliseProxy(value) {
  if (typeof value !== 'string') return undefined
  let text = value.trim()
  if (text === '') return undefined
  if (text.includes('=')) {
    const parts = {}
    for (const part of text.split(';')) {
      const index = part.indexOf('=')
      if (index > 0) parts[part.slice(0, index).trim().toLowerCase()] = part.slice(index + 1).trim()
    }
    text = parts.https ?? parts.http ?? ''
  }
  if (text === '') return undefined
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`
  try {
    return new URL(text).toString()
  } catch {
    return undefined
  }
}

/**
 * Whether a host must bypass any proxy.
 * @param hostname - target host.
 * @returns true for a loopback name or address.
 */
function isLoopback(hostname) {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
}

/**
 * Parse a JSON body without throwing.
 * @param text - raw body.
 * @returns parsed value, or undefined.
 */
function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
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

  const answer = await readJson(`${options.baseUrl}/user/balance`, {
    authorization: `Bearer ${credential.value}`,
    accept: 'application/json',
  }, options.proxy)
  if (answer.status < 200 || answer.status >= 300) {
    return {
      status: 'error',
      error: {
        code: `http-${answer.status}`,
        message: `DeepSeek answered HTTP ${answer.status}${answer.text === '' ? '' : `: ${clip(answer.text)}`}`,
      },
    }
  }

  const body = parseJson(answer.text)
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
  const answer = await readJson(`${options.apiBaseUrl}/usage`, {
    authorization: `Bearer ${credential.value}`,
    accept: 'application/json',
  }, options.proxy)
  if (answer.status < 200 || answer.status >= 300) {
    return {
      status: 'error',
      error: {
        code: `http-${answer.status}`,
        message: `the OpenCode usage endpoint answered HTTP ${answer.status}${answer.text === '' ? '' : `: ${clip(answer.text)}`}`,
      },
    }
  }

  const body = parseJson(answer.text)
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
    const answer = await readJson(`${server.url}${OPENCODE_LIMITS_PATH}`, {
      authorization: basicAuth('opencode', server.password),
      accept: 'application/json',
    }, options.proxy)
    if (answer.status < 200 || answer.status >= 300) {
      return {
        status: 'error',
        error: {
          code: `http-${answer.status}`,
          message: `OpenCode answered HTTP ${answer.status}${answer.text === '' ? '' : `: ${clip(answer.text)}`}`,
        },
      }
    }

    const body = parseJson(answer.text)
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
 * Read the Codex subscription allowance.
 *
 * Codex signs in through ChatGPT rather than an API key, so the only source is
 * the OAuth token the Codex CLI keeps in `${CODEX_HOME:-~/.codex}/auth.json`.
 * The backend reports the same two windows the CLI's `/status` shows: a 5-hour
 * session and a weekly cap.
 *
 * @param options - codex settings.
 * @returns provider entry, or undefined when Codex is not set up on this machine.
 */
async function codexUsage(options) {
  if (!options.enabled) return undefined
  const authPath = options.authPath !== '' ? options.authPath : defaultCodexAuthPath()
  if (!existsSync(authPath)) return undefined

  let auth
  try {
    auth = JSON.parse(await readFile(authPath, 'utf8'))
  } catch (error) {
    return {
      status: 'error',
      error: { code: 'codex-auth-unreadable', message: `could not read ${authPath}: ${reasonOf(error)}` },
    }
  }

  const tokens = isRecord(auth?.tokens) ? auth.tokens : {}
  const token = nonEmptyString(tokens.access_token)
  if (token === undefined) {
    return {
      status: 'unconfigured',
      error: { code: 'codex-not-signed-in', message: `no OAuth access token in ${authPath}` },
    }
  }

  const headers = {
    authorization: `Bearer ${token}`,
    accept: 'application/json',
    'user-agent': 'codex-cli',
    ...codexAccountHeaders(token),
  }
  const accountId = nonEmptyString(tokens.account_id)
  if (accountId !== undefined) headers['ChatGPT-Account-ID'] = accountId

  const answer = await readJson(`${options.baseUrl}/wham/usage`, headers, options.proxy)
  if (answer.status === 401 || answer.status === 403) {
    return {
      status: 'error',
      error: {
        code: 'codex-token-expired',
        message: `the Codex backend answered HTTP ${answer.status}${answer.text === '' ? '' : `: ${clip(answer.text)}`}`,
      },
    }
  }
  if (answer.status < 200 || answer.status >= 300) {
    return {
      status: 'error',
      error: {
        code: `http-${answer.status}`,
        message: `the Codex backend answered HTTP ${answer.status}${answer.text === '' ? '' : `: ${clip(answer.text)}`}`,
      },
    }
  }

  const body = parseJson(answer.text)
  const rateLimit = isRecord(body?.rate_limit) ? body.rate_limit : {}
  const allowance = codexAllowance(rateLimit)
  if (allowance.rolling === undefined && allowance.weekly === undefined) {
    return {
      status: 'error',
      error: {
        code: 'unexpected-payload',
        message: `the Codex answer carried no rate-limit window: ${clip(JSON.stringify(body ?? null))}`,
      },
    }
  }

  const credits = isRecord(body?.credits) ? body.credits : {}
  const plan = nonEmptyString(body?.plan_type)
  const summary = isRecord(body?.rate_limit_reset_credits) ? body.rate_limit_reset_credits : {}
  const resetCount = Number(summary.available_count ?? 0) || 0
  return {
    status: 'ok',
    source: 'codex-auth',
    plan: plan === undefined ? undefined : `${plan.charAt(0).toUpperCase()}${plan.slice(1)}`,
    credits: {
      hasCredits: credits.has_credits === true,
      unlimited: credits.unlimited === true,
      balance: Number(credits.balance ?? 0) || 0,
    },
    resetCredits: {
      count: resetCount,
      items: resetCount > 0 ? await codexResetCredits(options, headers) : [],
    },
    allowance,
  }
}

/**
 * List the banked reset credits, with the expiry each one carries.
 *
 * The usage answer only counts them; the dedicated endpoint is the only place
 * that dates each credit. A failure here must never cost the windows the
 * caller already has, so every problem answers an empty list.
 *
 * @param options - codex settings.
 * @param headers - the authenticated headers already built for the usage call.
 * @returns normalized credits.
 */
async function codexResetCredits(options, headers) {
  try {
    const answer = await readJson(`${options.baseUrl}/wham/rate-limit-reset-credits`, headers, options.proxy)
    if (answer.status < 200 || answer.status >= 300) return []
    const body = parseJson(answer.text)
    const list = Array.isArray(body?.credits) ? body.credits : []
    return list.map((raw) => ({
      id: String(raw?.id ?? ''),
      status: String(raw?.status ?? ''),
      grantedAt: codexInstant(raw?.granted_at),
      expiresAt: codexInstant(raw?.expires_at),
      title: nonEmptyString(raw?.title) ?? '',
    }))
  } catch {
    return []
  }
}

/**
 * The Codex CLI's credential file.
 * @returns absolute path.
 */
function defaultCodexAuthPath() {
  const override = process.env.CODEX_HOME
  const home = typeof override === 'string' && override !== '' ? override : path.join(homedir(), '.codex')
  return path.join(home, 'auth.json')
}

/**
 * Workspace headers the Codex backend derives from the OAuth JWT; a malformed
 * token contributes nothing rather than failing the read.
 * @param token - the access token.
 * @returns header record.
 */
function codexAccountHeaders(token) {
  const headers = {}
  try {
    const parts = String(token).split('.')
    if (parts.length < 2) return headers
    const segment = parts[1] + '='.repeat((4 - parts[1].length % 4) % 4)
    const claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    const auth = isRecord(claims?.['https://api.openai.com/auth']) ? claims['https://api.openai.com/auth'] : {}
    if (typeof auth.chatgpt_account_id === 'string' && auth.chatgpt_account_id !== '') {
      headers['ChatGPT-Account-ID'] = auth.chatgpt_account_id
    }
    const residency = auth.chatgpt_data_residency ?? auth.chatgpt_compute_residency
    if (typeof residency === 'string' && residency.trim() !== '') {
      headers['x-openai-internal-codex-residency'] = residency.trim()
    }
  } catch {
    // A token that is not a JWT simply supplies no extra headers.
  }
  return headers
}

/**
 * Map Codex rate-limit windows onto the panel's allowance slots.
 *
 * The backend keys windows by position but states their duration; a payload
 * that carries only the weekly cap puts it in `primary_window`, so the
 * duration decides the slot and position is the fallback.
 *
 * @param rateLimit - `rate_limit` from the answer.
 * @returns `{ rolling, weekly }` windows.
 */
function codexAllowance(rateLimit) {
  const windows = {}
  for (const key of ['primary_window', 'secondary_window']) {
    const raw = rateLimit[key]
    if (!isRecord(raw)) continue
    const percent = Number(raw.used_percent)
    if (!Number.isFinite(percent)) continue
    const seconds = Number(raw.limit_window_seconds)
    const slot = seconds === 604800 ? 'weekly' : (seconds === 18000 ? 'rolling' : (windows.rolling === undefined ? 'rolling' : 'weekly'))
    if (windows[slot] !== undefined) continue
    windows[slot] = {
      percent: Math.max(0, Math.min(100, percent)),
      limited: rateLimit.limit_reached === true,
      resetsAt: codexInstant(raw.reset_at),
    }
  }
  return { rolling: windows.rolling, weekly: windows.weekly }
}

/**
 * Read a Codex reset instant: epoch seconds (the backend's usual spelling),
 * epoch milliseconds, or an ISO instant.
 * @param value - raw value.
 * @returns epoch milliseconds, or 0.
 */
function codexInstant(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 1e12 ? Math.round(value * 1000) : value
  }
  if (typeof value === 'string' && value !== '') {
    if (/^\d+(\.\d+)?$/.test(value)) return codexInstant(Number(value))
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
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