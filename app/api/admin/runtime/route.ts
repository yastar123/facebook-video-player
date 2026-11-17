import { z } from 'zod'
import { getAdminSession } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { RemoteRuntimeSnapshot } from '@/lib/runtime-types'

export const runtime = 'nodejs'

const commandSchema = z.object({
  command: z.enum(['start', 'stop', 'restart', 'health']),
  playlistId: z.string().min(1).max(64).optional(),
})

class RuntimeServiceError extends Error {}

function getRuntimeBaseUrl() {
  const port = Number(process.env.RUNTIME_PORT ?? '3012')
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new RuntimeServiceError('RUNTIME_PORT harus berupa port valid antara 1024 dan 65535.')
  }
  return `http://127.0.0.1:${port}`
}

async function callRuntime(path: '/health' | '/control', method: 'GET' | 'POST', body?: object) {
  const token = process.env.RUNTIME_API_TOKEN
  if (!token || token.length < 32) {
    throw new RuntimeServiceError('RUNTIME_API_TOKEN belum diatur atau panjangnya kurang dari 32 karakter.')
  }

  let response: Response
  try {
    response = await fetch(`${getRuntimeBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(4_000),
    })
  } catch {
    throw new RuntimeServiceError('Runtime service tidak dapat dijangkau di loopback; periksa status PM2.')
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new RuntimeServiceError('Token aplikasi dan runtime tidak cocok; samakan RUNTIME_API_TOKEN lalu restart keduanya.')
    }
    throw new RuntimeServiceError(`Runtime service merespons HTTP ${response.status}.`)
  }

  return await response.json() as RemoteRuntimeSnapshot
}

async function offlineSnapshot(error: string): Promise<RemoteRuntimeSnapshot> {
  const [status, logs] = await Promise.all([
    prisma.remoteRuntimeStatus.findUnique({
      where: { id: 'primary' },
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
    serviceConnected: false,
    runtimeStatus: 'OFFLINE',
    browserStatus: 'UNKNOWN',
    lastKnownBrowserStatus: status?.browserState ?? null,
    chromiumVersion: status?.chromiumVersion ?? null,
    uptimeSeconds: null,
    processStartedAt: status?.processStartedAt?.toISOString() ?? null,
    browserStartedAt: status?.browserStartedAt?.toISOString() ?? null,
    lastHeartbeatAt: status?.lastHeartbeatAt?.toISOString() ?? null,
    currentPage: status?.currentPage ?? null,
    embedStatus: status?.resumeOnStart ? 'UNKNOWN' : status?.embedStatus ?? 'NOT_LOADED',
    playbackStatus: status?.resumeOnStart ? 'UNKNOWN' : status?.playbackStatus ?? 'IDLE',
    currentPlaylistName: status?.playlist?.name ?? null,
    currentContentTitle: status?.currentVideo?.title ?? null,
    currentPosition: status ? status.currentPosition + 1 : 0,
    playlistLength: status?.playlist?.videos.length ?? 0,
    currentTimeSeconds: status?.currentTimeSeconds ?? 0,
    playbackStartedAt: status?.playbackStartedAt?.toISOString() ?? null,
    lastPlaybackEventAt: status?.lastPlaybackEventAt?.toISOString() ?? null,
    lastError: error,
    logs: logs.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() })),
  }
}

function isSameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return false

  try {
    const originUrl = new URL(origin)
    const host = request.headers.get('x-forwarded-host')?.split(',')[0].trim() ?? request.headers.get('host')
    const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim()
    const protocol = forwardedProtocol ? `${forwardedProtocol}:` : new URL(request.url).protocol
    return Boolean(host) && originUrl.host === host && originUrl.protocol === protocol
  } catch {
    return false
  }
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export async function GET() {
  if (!(await getAdminSession())) return jsonResponse({ error: 'Unauthorized.' }, 401)

  try {
    return jsonResponse(await callRuntime('/health', 'GET'))
  } catch (error) {
    if (!(error instanceof RuntimeServiceError)) throw error
    return jsonResponse(await offlineSnapshot(error.message))
  }
}

export async function POST(request: Request) {
  if (!(await getAdminSession())) return jsonResponse({ error: 'Unauthorized.' }, 401)
  if (!isSameOrigin(request)) return jsonResponse({ error: 'Invalid request origin.' }, 403)
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return jsonResponse({ error: 'Content-Type application/json is required.' }, 415)
  }

  const contentLength = Number(request.headers.get('content-length') ?? '0')
  if (contentLength > 1024) return jsonResponse({ error: 'Request body is too large.' }, 413)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400)
  }
  const parsed = commandSchema.safeParse(body)
  if (!parsed.success) return jsonResponse({ error: 'Invalid runtime command.' }, 400)
  if (parsed.data.command === 'start' && !parsed.data.playlistId) {
    return jsonResponse({ error: 'Pilih playlist untuk memulai remote playback.' }, 400)
  }

  try {
    if (parsed.data.command === 'health') return jsonResponse(await callRuntime('/health', 'GET'))
    const playerOrigin = request.headers.get('origin')
    if (!playerOrigin) return jsonResponse({ error: 'Request origin is required.' }, 403)
    const commandBody = parsed.data.command === 'start'
      ? { command: parsed.data.command, playlistId: parsed.data.playlistId, playerOrigin: new URL(playerOrigin).origin }
      : { command: parsed.data.command }
    return jsonResponse(await callRuntime('/control', 'POST', commandBody))
  } catch (error) {
    if (!(error instanceof RuntimeServiceError)) throw error
    return jsonResponse({ error: error.message }, 503)
  }
}
