import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { config } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { chromium, type Browser, type Page } from 'playwright'
import { PrismaClient } from '../lib/generated/prisma/client'

config({ path: '.env.development.local' })
config()

const INTERNAL_HOST = '127.0.0.1'
const STATUS_ID = 'primary'
const HEARTBEAT_INTERVAL_MS = 10_000
const RECOVERY_WINDOW_MS = 5 * 60_000
const MAX_RECOVERY_ATTEMPTS = 3

type RuntimeProcessState = 'STARTING' | 'ONLINE' | 'STOPPING' | 'OFFLINE' | 'ERROR'
type RemoteBrowserState = 'CLOSED' | 'STARTING' | 'OPEN' | 'CRASHED'
type RuntimeCommand = 'start' | 'stop' | 'restart'

const connectionString = process.env.DATABASE_URL
if (!connectionString) throw new Error('DATABASE_URL is required for the remote browser runtime.')

const configuredApiToken = process.env.RUNTIME_API_TOKEN
if (!configuredApiToken || configuredApiToken.length < 32) {
  throw new Error('RUNTIME_API_TOKEN must contain at least 32 characters.')
}
const apiToken: string = configuredApiToken

const runtimePort = Number(process.env.RUNTIME_PORT ?? '3012')
if (!Number.isInteger(runtimePort) || runtimePort < 1024 || runtimePort > 65535) {
  throw new Error('RUNTIME_PORT must be an integer between 1024 and 65535.')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const intentionallyClosingBrowsers = new WeakSet<Browser>()

let processState: RuntimeProcessState = 'STARTING'
let browserState: RemoteBrowserState = 'CLOSED'
let browser: Browser | null = null
let page: Page | null = null
let chromiumVersion: string | null = null
let processStartedAt = new Date()
let browserStartedAt: Date | null = null
let lastHeartbeatAt: Date | null = null
let lastError: string | null = null
let recoveryAttempts = 0
let recoveryWindowStartedAt = Date.now()
let recoveryTimer: NodeJS.Timeout | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
let shuttingDown = false
let browserLaunchPromise: Promise<void> | null = null
let controlQueue: Promise<void> = Promise.resolve()

function sanitizeDiagnostic(value: string) {
  return value
    .replace(/(authorization|cookie|token|password|secret)\s*[:=]\s*[^,\s;]+/gi, '$1=[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500)
}

async function writeStatus() {
  const updatedAt = new Date()
  await prisma.remoteRuntimeStatus.upsert({
    where: { id: STATUS_ID },
    create: {
      id: STATUS_ID,
      processState,
      browserState,
      chromiumVersion,
      processStartedAt,
      browserStartedAt,
      lastHeartbeatAt,
      currentPage: page?.url() ?? null,
      lastError,
      updatedAt,
    },
    update: {
      processState,
      browserState,
      chromiumVersion,
      processStartedAt,
      browserStartedAt,
      lastHeartbeatAt,
      currentPage: page?.url() ?? null,
      lastError,
      updatedAt,
    },
  })
}

async function writeLog(level: 'INFO' | 'WARN' | 'ERROR', event: string, message: string) {
  await prisma.remoteRuntimeLog.create({
    data: { level, event, message: sanitizeDiagnostic(message) },
  })
  const excessLogs = await prisma.remoteRuntimeLog.findMany({
    orderBy: { createdAt: 'desc' },
    skip: 200,
    select: { id: true },
  })
  if (excessLogs.length) {
    await prisma.remoteRuntimeLog.deleteMany({ where: { id: { in: excessLogs.map((log) => log.id) } } })
  }
}

async function buildSnapshot() {
  await writeStatus()
  const logs = await prisma.remoteRuntimeLog.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: { id: true, level: true, event: true, message: true, createdAt: true },
  })

  return {
    serviceConnected: true,
    runtimeStatus: processState,
    browserStatus: browserState,
    lastKnownBrowserStatus: null,
    chromiumVersion,
    uptimeSeconds: Math.floor(process.uptime()),
    processStartedAt: processStartedAt.toISOString(),
    browserStartedAt: browserStartedAt?.toISOString() ?? null,
    lastHeartbeatAt: lastHeartbeatAt?.toISOString() ?? null,
    currentPage: page?.url() ?? null,
    embedStatus: 'NOT_LOADED',
    playbackStatus: 'NOT_OBSERVED',
    lastError,
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  }
}

async function scheduleRecovery() {
  const now = Date.now()
  if (now - recoveryWindowStartedAt >= RECOVERY_WINDOW_MS) {
    recoveryWindowStartedAt = now
    recoveryAttempts = 0
  }
  if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS || shuttingDown) {
    await writeLog('ERROR', 'browser_recovery_exhausted', 'Chromium recovery limit reached; restart it from the dashboard.')
    return
  }

  recoveryAttempts += 1
  const delay = Math.min(30_000, 1_000 * (2 ** (recoveryAttempts - 1)))
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    void startBrowser(true).catch(async (error: unknown) => {
      lastError = sanitizeDiagnostic(error instanceof Error ? error.message : 'Chromium recovery failed.')
      browserState = 'CRASHED'
      await writeStatus()
      await writeLog('ERROR', 'browser_recovery_failed', lastError)
      await scheduleRecovery()
    })
  }, delay)
  recoveryTimer.unref()
}

async function handleBrowserDisconnect(disconnectedBrowser: Browser) {
  if (intentionallyClosingBrowsers.has(disconnectedBrowser) || browser !== disconnectedBrowser || shuttingDown) return
  browser = null
  page = null
  browserState = 'CRASHED'
  lastError = 'Chromium exited unexpectedly.'
  await writeStatus()
  await writeLog('ERROR', 'browser_crashed', lastError)
  await scheduleRecovery()
}

async function launchBrowser(isRecovery: boolean) {
  if (browser && browser.isConnected()) return
  if (!isRecovery) {
    recoveryAttempts = 0
    recoveryWindowStartedAt = Date.now()
    if (recoveryTimer) clearTimeout(recoveryTimer)
    recoveryTimer = null
  }

  browserState = 'STARTING'
  lastError = null
  await writeStatus()
  const startEvent = isRecovery ? 'browser_recovery_started' : 'browser_start_requested'
  await writeLog('INFO', startEvent, 'Launching a blank, non-playing Chromium page.')

  if (process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() === 0) {
    browserState = 'CRASHED'
    lastError = 'Run the Chromium runtime as a non-root operating-system user to keep the browser sandbox enabled.'
    await writeStatus()
    await writeLog('ERROR', 'browser_start_failed', lastError)
    throw new Error(lastError)
  }

  let launchedBrowser: Browser
  try {
    launchedBrowser = await chromium.launch({ headless: true })
  } catch (error) {
    browserState = 'CRASHED'
    lastError = sanitizeDiagnostic(error instanceof Error ? error.message : 'Unable to launch Chromium.')
    await writeStatus()
    await writeLog('ERROR', 'browser_start_failed', lastError)
    throw error
  }
  browser = launchedBrowser
  launchedBrowser.on('disconnected', () => {
    void handleBrowserDisconnect(launchedBrowser).catch((error: unknown) => {
      console.error('Failed to record Chromium disconnect:', sanitizeDiagnostic(error instanceof Error ? error.message : 'Unknown error'))
    })
  })

  try {
    const newPage = await launchedBrowser.newPage()
    page = newPage
    newPage.on('pageerror', (error) => {
      const message = sanitizeDiagnostic(error.message)
      lastError = message
      void writeStatus()
        .then(() => writeLog('ERROR', 'browser_page_error', message))
        .catch((cause: unknown) => console.error('Failed to record runtime page error:', sanitizeDiagnostic(cause instanceof Error ? cause.message : 'Unknown error')))
    })
    chromiumVersion = launchedBrowser.version()
    browserStartedAt = new Date()
    browserState = 'OPEN'
    await writeStatus()
    await writeLog('INFO', 'browser_started', `Chromium ${chromiumVersion} is open on a blank page; Facebook playback is not started by this service.`)
  } catch (error) {
    intentionallyClosingBrowsers.add(launchedBrowser)
    try {
      await launchedBrowser.close()
    } catch (closeError) {
      console.error('Failed to close Chromium after page initialization error:', sanitizeDiagnostic(closeError instanceof Error ? closeError.message : 'Unknown close error.'))
    }
    browser = null
    page = null
    browserState = 'CRASHED'
    lastError = sanitizeDiagnostic(error instanceof Error ? error.message : 'Unable to initialize the Chromium page.')
    await writeStatus()
    await writeLog('ERROR', 'browser_start_failed', lastError)
    throw error
  }
}

async function startBrowser(isRecovery = false) {
  if (browser && browser.isConnected()) return
  if (browserLaunchPromise) return browserLaunchPromise

  const launch = launchBrowser(isRecovery)
  browserLaunchPromise = launch
  try {
    await launch
  } finally {
    if (browserLaunchPromise === launch) browserLaunchPromise = null
  }
}

async function stopBrowser() {
  if (recoveryTimer) clearTimeout(recoveryTimer)
  recoveryTimer = null
  if (browserLaunchPromise) {
    try {
      await browserLaunchPromise
    } catch {
      // The launch failure is persisted before the control operation reaches this point.
    }
  }
  const browserToClose = browser
  if (!browserToClose) {
    browserState = 'CLOSED'
    browserStartedAt = null
    page = null
    await writeStatus()
    return
  }

  browserState = 'CLOSED'
  await writeStatus()
  intentionallyClosingBrowsers.add(browserToClose)
  await browserToClose.close()
  if (browser === browserToClose) browser = null
  page = null
  browserStartedAt = null
  await writeStatus()
  await writeLog('INFO', 'browser_stopped', 'Chromium browser session stopped.')
}

async function executeCommand(command: RuntimeCommand) {
  const operation = controlQueue.then(async () => {
    if (command === 'start') await startBrowser()
    else if (command === 'stop') await stopBrowser()
    else {
      await stopBrowser()
      await startBrowser()
    }
    return buildSnapshot()
  })
  controlQueue = operation.then(() => undefined, () => undefined)
  return operation
}

function matchesApiToken(value: string | undefined) {
  if (!value) return false
  const provided = Buffer.from(value)
  const expected = Buffer.from(apiToken)
  return provided.length === expected.length && timingSafeEqual(provided, expected)
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(JSON.stringify(body))
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 1024) throw new RequestBodyError('Request body exceeds the allowed size.', 413)
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new RequestBodyError('Request body must be valid JSON.', 400)
  }
}

class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) {
    super(message)
  }
}

const server = createServer((request, response) => {
  void (async () => {
    if (!matchesApiToken(request.headers.authorization?.replace(/^Bearer\s+/i, ''))) {
      sendJson(response, 401, { error: 'Unauthorized.' })
      return
    }

    const url = new URL(request.url ?? '/', `http://${INTERNAL_HOST}:${runtimePort}`)
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, await buildSnapshot())
      return
    }

    if (request.method === 'POST' && url.pathname === '/control') {
      if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        sendJson(response, 415, { error: 'Content-Type application/json is required.' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch (error) {
        if (error instanceof RequestBodyError) {
          sendJson(response, error.status, { error: error.message })
          return
        }
        throw error
      }
      if (!body || typeof body !== 'object' || !('command' in body) || !['start', 'stop', 'restart'].includes(String(body.command))) {
        sendJson(response, 400, { error: 'A valid runtime command is required.' })
        return
      }
      sendJson(response, 200, await executeCommand(body.command as RuntimeCommand))
      return
    }

    sendJson(response, 404, { error: 'Not found.' })
  })().catch((error: unknown) => {
    const message = sanitizeDiagnostic(error instanceof Error ? error.message : 'Runtime request failed.')
    console.error('Runtime request failed:', message)
    sendJson(response, 500, { error: 'Runtime command failed; inspect the protected runtime logs.' })
  })
})

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  if (recoveryTimer) clearTimeout(recoveryTimer)
  try {
    processState = 'STOPPING'
    await writeStatus()
    await writeLog('INFO', 'runtime_stopping', `Runtime received ${signal}.`)
    await stopBrowser()
    processState = 'OFFLINE'
    lastHeartbeatAt = new Date()
    await writeStatus()
  } catch (error) {
    console.error('Runtime graceful shutdown failed:', sanitizeDiagnostic(error instanceof Error ? error.message : 'Unknown shutdown error.'))
    process.exitCode = 1
  } finally {
    try {
      await prisma.$disconnect()
    } catch (error) {
      console.error('Runtime database disconnect failed:', sanitizeDiagnostic(error instanceof Error ? error.message : 'Unknown database error.'))
      process.exitCode = 1
    }
    if (server.listening) {
      server.close()
      server.closeAllConnections()
    }
  }
}

async function main() {
  processStartedAt = new Date()
  lastHeartbeatAt = new Date()
  await writeStatus()
  await writeLog('INFO', 'runtime_starting', 'Remote browser runtime process is starting.')
  server.listen(runtimePort, INTERNAL_HOST, () => {
    void (async () => {
      processState = 'ONLINE'
      lastHeartbeatAt = new Date()
      await writeStatus()
      await writeLog('INFO', 'runtime_online', `Runtime health API is listening on ${INTERNAL_HOST}:${runtimePort}.`)
      heartbeatTimer = setInterval(() => {
        lastHeartbeatAt = new Date()
        void writeStatus().catch((error: unknown) => {
          console.error('Runtime heartbeat failed:', sanitizeDiagnostic(error instanceof Error ? error.message : 'Database write failed.'))
        })
      }, HEARTBEAT_INTERVAL_MS)
      heartbeatTimer.unref()
    })().catch((error: unknown) => {
      console.error('Runtime initialization failed:', sanitizeDiagnostic(error instanceof Error ? error.message : 'Unknown startup error.'))
      process.exitCode = 1
      void shutdown('initialization_error')
    })
  })
  server.on('error', (error) => {
    console.error('Runtime server error:', sanitizeDiagnostic(error.message))
    process.exitCode = 1
    void shutdown('server_error')
  })
}

process.on('SIGINT', () => { void shutdown('SIGINT') })
process.on('SIGTERM', () => { void shutdown('SIGTERM') })

void main().catch(async (error: unknown) => {
  processState = 'ERROR'
  lastError = sanitizeDiagnostic(error instanceof Error ? error.message : 'Runtime failed to start.')
  console.error('Runtime startup failed:', lastError)
  try {
    await writeStatus()
    await writeLog('ERROR', 'runtime_start_failed', lastError)
  } finally {
    await prisma.$disconnect()
    process.exitCode = 1
  }
})
