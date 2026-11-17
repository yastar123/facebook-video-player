import { timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { config } from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import { chromium, type Browser, type Page, type Route } from 'playwright'
import { PrismaClient } from '../lib/generated/prisma/client'
import { getNextRemotePlaybackIndex, hasRemotePlaybackProgressed } from '../lib/remote-playback-flow'

config({ path: '.env.development.local' })
config()

const INTERNAL_HOST = '127.0.0.1'
const STATUS_ID = 'primary'
const HEARTBEAT_INTERVAL_MS = 10_000
const RECOVERY_WINDOW_MS = 5 * 60_000
const MAX_RECOVERY_ATTEMPTS = 3

type RuntimeProcessState = 'STARTING' | 'ONLINE' | 'STOPPING' | 'OFFLINE' | 'ERROR'
type RemoteBrowserState = 'CLOSED' | 'STARTING' | 'OPEN' | 'CRASHED'
type RemotePlaybackStatus = 'IDLE' | 'STARTING' | 'PLAYING' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'ERROR'
type RemoteEmbedStatus = 'NOT_LOADED' | 'LOADING' | 'LOADED' | 'ERROR'
type RuntimeCommand = 'start' | 'stop' | 'restart'
type PlaybackEventType = 'SESSION_STARTED' | 'VIDEO_LOADED' | 'STARTED_PLAYING' | 'PAUSED' | 'FINISHED_PLAYING' | 'NEXT_VIDEO_LOADED' | 'SESSION_STOPPED' | 'ERROR'
type RemotePlaylistItem = { id: string; title: string; url: string }
type FacebookVideoPlayer = {
  play: () => void
  mute: () => void
  seek: (seconds: number) => void
  getCurrentPosition: () => number
  subscribe: (
    event: 'startedPlaying' | 'paused' | 'finishedPlaying' | 'error',
    callback: () => void,
  ) => { release?: (event: string) => void } | void
}

type FacebookSdk = {
  init: (options: { xfbml: boolean; version: string }) => void
  XFBML: { parse: (element?: HTMLElement) => void }
  Event: {
    subscribe: (event: 'xfbml.ready', callback: (message: { type: string; id: string; instance: FacebookVideoPlayer }) => void) => void
    unsubscribe?: (event: 'xfbml.ready', callback: (message: { type: string; id: string; instance: FacebookVideoPlayer }) => void) => void
  }
}

type RemotePlayerWindow = Omit<Window, 'FB'> & {
  FB?: FacebookSdk
  __remotePlaybackEvent?: (event: string, index: number, generation: number) => Promise<void>
  __remotePlayer?: FacebookVideoPlayer
  __loadRemoteVideo?: (url: string, index: number, generation: number, seekSeconds: number, muted: boolean) => void
}

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
let playbackStatus: RemotePlaybackStatus = 'IDLE'
let embedStatus: RemoteEmbedStatus = 'NOT_LOADED'
let playlistId: string | null = null
let playlistItems: RemotePlaylistItem[] = []
let currentVideoId: string | null = null
let currentPosition = 0
let currentEmbedGeneration = 0
let currentTimeSeconds = 0
let remotePlayerOrigin: string | null = null
let playbackStartedAt: Date | null = null
let lastPlaybackEventAt: Date | null = null
let resumeOnStart = false
let playbackSessionId: string | null = null
let loadStartedAt = 0
let startedPlayingLogged = false
let lastStartingPositionSeconds: number | null = null
let finishingCurrentItem = false
let playbackMonitorTimer: NodeJS.Timeout | null = null
let playbackMonitorRunning = false
let lastPlaylistCheckAt = 0
let autoPlayNext = true
let loopPlaylist = false
let mutedPlayback = true

function sanitizeDiagnostic(value: string) {
  return value
    .replace(/(authorization|cookie|token|password|secret)\s*[:=]\s*[^,\s;]+/gi, '$1=[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500)
}

function getPlayerOrigin(value: unknown) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (url.origin !== value) return null
    const isHttps = url.protocol === 'https:'
    const isLocalDevelopmentOrigin = url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && url.port !== String(runtimePort)
    return isHttps || isLocalDevelopmentOrigin ? url.origin : null
  } catch {
    return null
  }
}

async function writeStatus() {
  const updatedAt = new Date()
  await prisma.remoteRuntimeStatus.upsert({
    where: { id: STATUS_ID },
    create: {
      id: STATUS_ID,
      processState,
      browserState,
      playbackStatus,
      embedStatus,
      chromiumVersion,
      processStartedAt,
      browserStartedAt,
      lastHeartbeatAt,
      currentPage: page?.url() ?? null,
      lastError,
      playlistId,
      currentVideoId,
      currentPosition,
      currentTimeSeconds,
      playbackStartedAt,
      lastPlaybackEventAt,
      resumeOnStart,
      playbackSessionId,
      updatedAt,
    },
    update: {
      processState,
      browserState,
      playbackStatus,
      embedStatus,
      chromiumVersion,
      processStartedAt,
      browserStartedAt,
      lastHeartbeatAt,
      currentPage: page?.url() ?? null,
      lastError,
      playlistId,
      currentVideoId,
      currentPosition,
      currentTimeSeconds,
      playbackStartedAt,
      lastPlaybackEventAt,
      resumeOnStart,
      playbackSessionId,
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
  const [status, logs] = await Promise.all([
    prisma.remoteRuntimeStatus.findUnique({
      where: { id: STATUS_ID },
      include: {
        playlist: { select: { name: true, videos: { select: { id: true } } } },
        currentVideo: { select: { title: true } },
      },
    }),
    prisma.remoteRuntimeLog.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: { id: true, level: true, event: true, message: true, createdAt: true },
    }),
  ])

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
    embedStatus,
    playbackStatus,
    currentPlaylistName: status?.playlist?.name ?? null,
    currentContentTitle: status?.currentVideo?.title ?? null,
    currentPosition: status ? status.currentPosition + 1 : 0,
    playlistLength: status?.playlist?.videos.length ?? 0,
    currentTimeSeconds,
    playbackStartedAt: playbackStartedAt?.toISOString() ?? null,
    lastPlaybackEventAt: lastPlaybackEventAt?.toISOString() ?? null,
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
    if (resumeOnStart && !shuttingDown) {
      lastError = 'Chromium recovery limit reached; restart playback from the dashboard.'
      playbackStatus = 'ERROR'
      embedStatus = 'ERROR'
      await updatePlaybackSession('ERROR', new Date())
      await writeStatus()
    }
    await writeLog('ERROR', 'browser_recovery_exhausted', 'Chromium recovery limit reached; restart it from the dashboard.')
    return
  }

  recoveryAttempts += 1
  const delay = Math.min(30_000, 1_000 * (2 ** (recoveryAttempts - 1)))
  recoveryTimer = setTimeout(() => {
    recoveryTimer = null
    void startBrowser(true).then(async () => {
      if (resumeOnStart) {
        await initializePlayerPage()
        await loadCurrentVideo(currentTimeSeconds)
      }
    }).catch(async (error: unknown) => {
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
  if (resumeOnStart) {
    playbackStatus = 'STARTING'
    embedStatus = 'LOADING'
    loadStartedAt = Date.now()
  }
  await writeStatus()
  await writeLog('ERROR', 'browser_crashed', lastError)
  await scheduleRecovery()
}

function getAllowedFacebookUrl(value: string) {
  try {
    const url = new URL(value)
    const allowedHosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'])
    return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

async function writePlaybackEvent(eventType: PlaybackEventType) {
  if (!playbackSessionId) return
  await prisma.playbackLog.create({
    data: {
      sessionId: playbackSessionId,
      videoId: currentVideoId,
      eventType,
    },
  })
}

async function updatePlaybackSession(
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'STOPPED' | 'ERROR',
  endedAt: Date | null = null,
) {
  if (!playbackSessionId) return
  await prisma.playbackSession.updateMany({
    where: { id: playbackSessionId },
    data: {
      status,
      currentVideoId,
      lastHeartbeatAt: new Date(),
      endedAt,
    },
  })
}

async function initializePlayerPage() {
  if (!page) throw new Error('Chromium page is not available.')
  if (await page.evaluate(() => Boolean((window as RemotePlayerWindow).__loadRemoteVideo))) return
  const eventBridgeExists = await page.evaluate(() => Boolean((window as RemotePlayerWindow).__remotePlaybackEvent))

  if (!remotePlayerOrigin) throw new Error('The public application origin is unavailable for the Facebook embed.')
  const playerPageUrl = new URL('/remote-player', remotePlayerOrigin).toString()
  const playerPageRoute = (route: Route) => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><html><head><meta charset="utf-8"><title>Remote Video Player</title></head><body><div id="fb-root"></div><main id="remote-player"></main></body></html>',
  })
  await page.route(playerPageUrl, playerPageRoute)
  try {
    await page.goto(playerPageUrl, { waitUntil: 'domcontentloaded' })
  } finally {
    await page.unroute(playerPageUrl, playerPageRoute)
  }
  if (!eventBridgeExists) {
    await page.exposeFunction('__remotePlaybackEvent', async (event: string, index: number, generation: number) => {
      try {
        await handleRemotePlaybackEvent(event, index, generation)
      } catch (error) {
        const message = sanitizeDiagnostic(error instanceof Error ? error.message : 'Playback event could not be recorded.')
        lastError = message
        console.error('Remote playback event failed:', message)
        try {
          await writeStatus()
          await writeLog('ERROR', 'playback_event_failed', message)
        } catch (cause) {
          console.error('Could not persist playback event failure:', sanitizeDiagnostic(cause instanceof Error ? cause.message : 'Database write failed.'))
        }
      }
    })
  }
  await page.addScriptTag({ url: 'https://connect.facebook.net/en_US/sdk.js' })
  await writeLog('INFO', 'facebook_sdk_loaded', 'Facebook JavaScript SDK loaded in the remote browser.')
  await page.evaluate(() => {
    const remoteWindow = window as RemotePlayerWindow
    const sdk = remoteWindow.FB
    if (!sdk) throw new Error('Facebook JavaScript SDK was not initialized.')
    sdk.init({ xfbml: false, version: 'v3.2' })
    sdk.Event.subscribe('xfbml.ready', (message) => {
      if (message.type !== 'video') return
      const match = /^remote-facebook-video-(\d+)-(\d+)$/.exec(message.id)
      if (!match) return

      const index = Number(match[1])
      const generation = Number(match[2])
      const player = message.instance
      remoteWindow.__remotePlayer = player
      player.subscribe('startedPlaying', () => { void remoteWindow.__remotePlaybackEvent?.('startedPlaying', index, generation) })
      player.subscribe('paused', () => { void remoteWindow.__remotePlaybackEvent?.('paused', index, generation) })
      player.subscribe('finishedPlaying', () => { void remoteWindow.__remotePlaybackEvent?.('finishedPlaying', index, generation) })
      player.subscribe('error', () => { void remoteWindow.__remotePlaybackEvent?.('error', index, generation) })

      const config = (window as Window & { __remotePlayerConfig?: { index: number; generation: number; seekSeconds: number; muted: boolean } }).__remotePlayerConfig
      if (!config || config.index !== index || config.generation !== generation) return
      void remoteWindow.__remotePlaybackEvent?.('ready', index, generation)
      if (config.muted) player.mute()
      if (config.seekSeconds > 0) player.seek(config.seekSeconds)
      player.play()
    })

    remoteWindow.__loadRemoteVideo = (url, index, generation, seekSeconds, muted) => {
      const container = document.getElementById('remote-player')
      if (!container) throw new Error('Remote player container is missing.')
      remoteWindow.__remotePlayer = undefined
      ;(window as Window & { __remotePlayerConfig?: { index: number; generation: number; seekSeconds: number; muted: boolean } }).__remotePlayerConfig = {
        index,
        generation,
        seekSeconds,
        muted,
      }
      const plugin = document.createElement('div')
      plugin.id = `remote-facebook-video-${index}-${generation}`
      plugin.className = 'fb-video'
      plugin.setAttribute('data-href', url)
      plugin.setAttribute('data-width', '640')
      plugin.setAttribute('data-allowfullscreen', 'true')
      plugin.setAttribute('data-autoplay', String(muted))
      plugin.setAttribute('data-show-text', 'false')
      container.replaceChildren(plugin)
      sdk.XFBML.parse(container)
    }
  })
}

async function loadPlaylist(playlistIdToLoad: string) {
  const [playlist, settings] = await Promise.all([
    prisma.playlist.findUnique({
      where: { id: playlistIdToLoad },
      include: {
        videos: {
          orderBy: { position: 'asc' },
          include: { video: { select: { id: true, title: true, facebookUrl: true } } },
        },
      },
    }),
    prisma.appSettings.findUnique({
      where: { id: 'global' },
      select: { autoPlayNext: true, loopPlaylist: true, muted: true },
    }),
  ])
  if (!playlist) throw new Error('Playlist tidak ditemukan.')

  const items = playlist.videos.map(({ video }) => ({
    id: video.id,
    title: video.title,
    url: video.facebookUrl,
  }))
  if (!items.length) throw new Error('Playlist tidak memiliki video.')
  if (items.some((item) => !getAllowedFacebookUrl(item.url))) {
    throw new Error('Playlist berisi URL video yang bukan HTTPS Facebook yang didukung.')
  }

  playlistId = playlist.id
  playlistItems = items
  lastPlaylistCheckAt = Date.now()
  autoPlayNext = settings?.autoPlayNext ?? true
  loopPlaylist = settings?.loopPlaylist ?? false
  mutedPlayback = settings?.muted ?? true
}

async function loadCurrentVideo(seekSeconds = 0, isNext = false) {
  if (!page || currentPosition < 0 || currentPosition >= playlistItems.length) {
    throw new Error('Posisi video runtime tidak valid.')
  }
  const item = playlistItems[currentPosition]
  currentVideoId = item.id
  currentTimeSeconds = Math.max(0, seekSeconds)
  playbackStatus = 'STARTING'
  embedStatus = 'LOADING'
  playbackStartedAt = null
  lastPlaybackEventAt = new Date()
  loadStartedAt = Date.now()
  startedPlayingLogged = false
  lastStartingPositionSeconds = null
  finishingCurrentItem = false
  lastError = null
  currentEmbedGeneration += 1

  await updatePlaybackSession('ACTIVE')
  if (isNext) await writePlaybackEvent('NEXT_VIDEO_LOADED')
  await writePlaybackEvent('VIDEO_LOADED')
  await writeStatus()

  const loaded = await page.evaluate(({ url, index, generation, seek, muted }) => {
    const load = (window as RemotePlayerWindow).__loadRemoteVideo
    if (!load) return false
    load(url, index, generation, seek, muted)
    return true
  }, {
    url: item.url,
    index: currentPosition,
    generation: currentEmbedGeneration,
    seek: currentTimeSeconds,
    muted: mutedPlayback,
  })
  if (!loaded) throw new Error('Facebook player bridge is unavailable.')
}

async function finishPlaybackSession(
  status: 'COMPLETED' | 'STOPPED' | 'ERROR',
  message?: string,
) {
  resumeOnStart = false
  playbackStatus = status
  embedStatus = status === 'ERROR' ? 'ERROR' : embedStatus
  lastPlaybackEventAt = new Date()
  if (message) lastError = sanitizeDiagnostic(message)
  await updatePlaybackSession(status, new Date())
  await writeStatus()
}

async function handleRemotePlaybackEvent(event: string, index: number, generation: number) {
  if (index !== currentPosition || generation !== currentEmbedGeneration || !resumeOnStart || !playbackSessionId) return
  lastPlaybackEventAt = new Date()

  if (event === 'ready') {
    embedStatus = 'LOADED'
    await writeStatus()
    await writeLog('INFO', 'facebook_embed_ready', 'Facebook initialized the embedded video player.')
    return
  }
  if (event === 'startedPlaying') {
    playbackStatus = 'PLAYING'
    embedStatus = 'LOADED'
    lastError = null
    if (!startedPlayingLogged) {
      startedPlayingLogged = true
      playbackStartedAt = new Date()
      await updatePlaybackSession('ACTIVE')
      await writePlaybackEvent('STARTED_PLAYING')
      await writeLog('INFO', 'facebook_playback_started', 'Facebook reported that the remote video started playing.')
    }
    await writeStatus()
    return
  }
  if (event === 'paused') {
    playbackStatus = 'PAUSED'
    await updatePlaybackSession('PAUSED')
    await writePlaybackEvent('PAUSED')
    await writeStatus()
    return
  }

  if (finishingCurrentItem) return
  if (event === 'finishedPlaying') {
    finishingCurrentItem = true
    currentTimeSeconds = 0
    await writePlaybackEvent('FINISHED_PLAYING')
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'global' },
      select: { autoPlayNext: true, loopPlaylist: true },
    })
    autoPlayNext = settings?.autoPlayNext ?? autoPlayNext
    loopPlaylist = settings?.loopPlaylist ?? loopPlaylist
    const previousPosition = currentPosition
    const nextIndex = getNextRemotePlaybackIndex(
      currentPosition,
      playlistItems.length,
      autoPlayNext,
      loopPlaylist,
    )
    if (nextIndex !== null) {
      currentPosition = nextIndex
      await loadCurrentVideo(0, nextIndex !== previousPosition)
      return
    }

    await finishPlaybackSession('COMPLETED')
    await stopBrowser()
    return
  }

  if (event === 'error') {
    finishingCurrentItem = true
    const message = 'Facebook embed reported a playback error.'
    lastError = message
    embedStatus = 'ERROR'
    await writePlaybackEvent('ERROR')
    await writeLog('ERROR', 'facebook_embed_error', message)
    const nextIndex = getNextRemotePlaybackIndex(currentPosition, playlistItems.length)
    if (nextIndex !== null) {
      await writeLog('WARN', 'video_skipped', `Skipping a video after the embed reported an error: ${playlistItems[currentPosition]?.title ?? 'unknown video'}.`)
      currentPosition = nextIndex
      await loadCurrentVideo(0, true)
      return
    }
    await finishPlaybackSession('ERROR', message)
    await stopBrowser()
  }
}

async function startRemotePlayback(playlistIdToLoad: string, requestedPlayerOrigin?: string) {
  if (resumeOnStart) await stopRemotePlayback()
  remotePlayerOrigin = getPlayerOrigin(requestedPlayerOrigin)
  if (!remotePlayerOrigin) throw new Error('A valid HTTPS application origin is required for remote Facebook playback.')
  playbackSessionId = null
  await loadPlaylist(playlistIdToLoad)
  currentPosition = 0
  currentVideoId = playlistItems[0].id
  currentTimeSeconds = 0
  playbackStartedAt = null
  playbackSessionId = null
  playbackStatus = 'STARTING'
  embedStatus = 'LOADING'
  resumeOnStart = true
  const session = await prisma.playbackSession.create({
    data: { playlistId: playlistIdToLoad, currentVideoId, status: 'ACTIVE' },
  })
  playbackSessionId = session.id
  await writePlaybackEvent('SESSION_STARTED')
  await writeStatus()

  if (!browser?.isConnected()) await startBrowser()
  await initializePlayerPage()
  await loadCurrentVideo()
}

async function stopRemotePlayback() {
  if (playbackSessionId && resumeOnStart) {
    await writePlaybackEvent('SESSION_STOPPED')
    await finishPlaybackSession('STOPPED')
  } else {
    resumeOnStart = false
    if (playbackStatus !== 'COMPLETED') playbackStatus = 'STOPPED'
    await writeStatus()
  }
  await stopBrowser()
}

async function resumePersistedPlayback() {
  const saved = await prisma.remoteRuntimeStatus.findUnique({ where: { id: STATUS_ID } })
  if (!saved?.resumeOnStart || !saved.playlistId) return
  try {
    remotePlayerOrigin = saved.currentPage ? getPlayerOrigin(new URL(saved.currentPage).origin) : null
    if (!remotePlayerOrigin) throw new Error('The saved application origin is unavailable for playback recovery.')
    await loadPlaylist(saved.playlistId)
    currentPosition = saved.currentPosition
    currentVideoId = saved.currentVideoId
    currentTimeSeconds = saved.currentTimeSeconds
    playbackSessionId = saved.playbackSessionId
    playbackStartedAt = saved.playbackStartedAt
    resumeOnStart = currentPosition >= 0 && currentPosition < playlistItems.length
      && playlistItems[currentPosition]?.id === currentVideoId
    if (!resumeOnStart) throw new Error('Persisted playlist position is no longer valid.')

    const session = playbackSessionId
      ? await prisma.playbackSession.findUnique({ where: { id: playbackSessionId }, select: { status: true } })
      : null
    if (!session || !['ACTIVE', 'PAUSED'].includes(session.status)) {
      const created = await prisma.playbackSession.create({
        data: { playlistId: saved.playlistId, currentVideoId, status: 'ACTIVE' },
      })
      playbackSessionId = created.id
      await writePlaybackEvent('SESSION_STARTED')
    }
    playbackStatus = 'STARTING'
    embedStatus = 'LOADING'
    await writeLog('INFO', 'playback_recovery_started', 'Resuming the saved playlist position after runtime restart.')
    await startBrowser(true)
    await initializePlayerPage()
    await loadCurrentVideo(currentTimeSeconds)
  } catch (error) {
    const message = sanitizeDiagnostic(error instanceof Error ? error.message : 'Playback recovery failed.')
    lastError = message
    resumeOnStart = false
    playbackStatus = 'ERROR'
    embedStatus = 'ERROR'
    await writeStatus()
    await writeLog('ERROR', 'playback_recovery_failed', message)
  }
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
  await writeLog('INFO', startEvent, 'Launching Chromium for the configured runtime playlist.')

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
    await writeLog('INFO', 'browser_started', `Chromium ${chromiumVersion} is ready for the configured runtime playlist.`)
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

async function executeCommand(
  command: RuntimeCommand,
  requestedPlaylistId?: string,
  requestedPlayerOrigin?: string,
) {
  const operation = controlQueue.then(async () => {
    if (command === 'start') {
      if (!requestedPlaylistId) throw new Error('Pilih playlist untuk memulai remote playback.')
      try {
        await startRemotePlayback(requestedPlaylistId, requestedPlayerOrigin)
      } catch (error) {
        const message = sanitizeDiagnostic(error instanceof Error ? error.message : 'Remote playback could not be started.')
        lastError = message
        await finishPlaybackSession('ERROR', message)
        await writeLog('ERROR', 'playback_start_failed', message)
        throw error
      }
    } else if (command === 'stop') await stopRemotePlayback()
    else {
      const shouldResume = resumeOnStart
      await stopBrowser()
      if (shouldResume) {
        await startBrowser()
        await initializePlayerPage()
        await loadCurrentVideo(currentTimeSeconds)
      } else {
        await startBrowser()
      }
    }
    return buildSnapshot()
  })
  controlQueue = operation.then(() => undefined, () => undefined)
  return operation
}

async function monitorPlayback() {
  if (playbackMonitorRunning || !resumeOnStart) return
  playbackMonitorRunning = true
  try {
    if (playlistId && Date.now() - lastPlaylistCheckAt >= HEARTBEAT_INTERVAL_MS) {
      lastPlaylistCheckAt = Date.now()
      const activePlaylist = await prisma.playlist.findUnique({
        where: { id: playlistId },
        include: { videos: { orderBy: { position: 'asc' }, select: { videoId: true } } },
      })
      const currentVideoIds = activePlaylist?.videos.map((item) => item.videoId) ?? []
      const playlistChanged = !activePlaylist
        || currentVideoIds.length !== playlistItems.length
        || currentVideoIds.some((id, index) => id !== playlistItems[index]?.id)
      if (playlistChanged) {
        const deletedPlaylistId = playlistId
        if (!activePlaylist) {
          playbackSessionId = null
          playlistId = null
          currentVideoId = null
        } else if (!currentVideoIds.includes(currentVideoId ?? '')) {
          currentVideoId = null
        }
        const message = activePlaylist
          ? 'The active playlist changed; remote playback was stopped.'
          : 'The active playlist was deleted; remote playback was stopped.'
        lastError = message
        embedStatus = 'ERROR'
        if (playbackSessionId) {
          await finishPlaybackSession('ERROR', message)
          await writePlaybackEvent('ERROR')
        } else {
          resumeOnStart = false
          playbackStatus = 'ERROR'
          await writeStatus()
        }
        await stopBrowser()
        await writeLog('WARN', 'playback_playlist_changed', `Remote playback stopped because playlist ${deletedPlaylistId} was changed or deleted.`)
        return
      }
    }

    if (page && ['STARTING', 'PLAYING'].includes(playbackStatus)) {
      const observedPosition = await page.evaluate(() => {
        const player = (window as RemotePlayerWindow).__remotePlayer
        try {
          return player ? player.getCurrentPosition() : null
        } catch {
          return null
        }
      })
      if (typeof observedPosition === 'number' && Number.isFinite(observedPosition) && observedPosition >= 0) {
        if (playbackStatus === 'STARTING') {
          if (hasRemotePlaybackProgressed(lastStartingPositionSeconds, observedPosition)) {
            await handleRemotePlaybackEvent('startedPlaying', currentPosition, currentEmbedGeneration)
          }
          lastStartingPositionSeconds = observedPosition
        }
        if (playbackStatus === 'PLAYING') currentTimeSeconds = observedPosition
      }
    }

    if (playbackStatus === 'STARTING' && Date.now() - loadStartedAt >= 30_000) {
      const message = embedStatus === 'LOADED'
        ? 'Facebook initialized the embed, but the video did not start. Check whether the video is public and autoplay is allowed.'
        : 'Facebook did not initialize the video embed. Check whether the video is public and the Facebook SDK can load it.'
      await finishPlaybackSession('ERROR', message)
      await writePlaybackEvent('ERROR')
      await writeLog('WARN', 'playback_start_not_observed', message)
      return
    }

  } catch (error) {
    const message = sanitizeDiagnostic(error instanceof Error ? error.message : 'Playback health check failed.')
    lastError = message
    await writeStatus()
    await writeLog('ERROR', 'playback_health_check_failed', message)
  } finally {
    playbackMonitorRunning = false
  }
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
    const url = new URL(request.url ?? '/', `http://${INTERNAL_HOST}:${runtimePort}`)
    if (!matchesApiToken(request.headers.authorization?.replace(/^Bearer\s+/i, ''))) {
      sendJson(response, 401, { error: 'Unauthorized.' })
      return
    }

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
      const playlistIdFromBody = 'playlistId' in body && typeof body.playlistId === 'string'
        ? body.playlistId
        : undefined
      if (body.command === 'start' && !playlistIdFromBody) {
        sendJson(response, 400, { error: 'Pilih playlist untuk memulai remote playback.' })
        return
      }
      const playerOriginFromBody = 'playerOrigin' in body
        ? getPlayerOrigin(body.playerOrigin)
        : null
      if (body.command === 'start' && !playerOriginFromBody) {
        sendJson(response, 400, { error: 'A valid HTTPS application origin is required.' })
        return
      }
      sendJson(response, 200, await executeCommand(
        body.command as RuntimeCommand,
        playlistIdFromBody,
        playerOriginFromBody ?? undefined,
      ))
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
  if (playbackMonitorTimer) clearInterval(playbackMonitorTimer)
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
  const saved = await prisma.remoteRuntimeStatus.findUnique({ where: { id: STATUS_ID } })
  if (saved) {
    browserState = 'CLOSED'
    chromiumVersion = saved.chromiumVersion
    browserStartedAt = null
    lastError = saved.lastError
    playbackStatus = saved.playbackStatus
    embedStatus = saved.embedStatus
    playlistId = saved.playlistId
    currentVideoId = saved.currentVideoId
    currentPosition = saved.currentPosition
    currentTimeSeconds = saved.currentTimeSeconds
    playbackStartedAt = saved.playbackStartedAt
    lastPlaybackEventAt = saved.lastPlaybackEventAt
    resumeOnStart = saved.resumeOnStart
    playbackSessionId = saved.playbackSessionId
  }
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
        void Promise.all([
          writeStatus(),
          resumeOnStart && ['STARTING', 'PLAYING', 'PAUSED'].includes(playbackStatus)
            ? updatePlaybackSession(playbackStatus === 'PAUSED' ? 'PAUSED' : 'ACTIVE')
            : Promise.resolve(),
        ]).catch((error: unknown) => {
          console.error('Runtime heartbeat failed:', sanitizeDiagnostic(error instanceof Error ? error.message : 'Database write failed.'))
        })
      }, HEARTBEAT_INTERVAL_MS)
      heartbeatTimer.unref()
      playbackMonitorTimer = setInterval(() => {
        void monitorPlayback()
      }, 1_000)
      playbackMonitorTimer.unref()
      await resumePersistedPlayback()
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
