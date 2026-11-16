'use server'

import { z } from 'zod'
import { requireAdmin } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import type { PlaybackActivity, PlaybackPreferences, PlaylistItem, VideoItem } from '@/lib/dashboard-types'
import { MAX_CONCURRENT_VIDEOS, MIN_CONCURRENT_VIDEOS } from '@/lib/playback-limits'

type ActionResult<T> = { success: true; data: T } | { success: false; message: string }

const videoInputSchema = z.object({
  url: z.string().trim().url().max(2048),
  title: z.string().trim().max(120),
})

const playlistInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240),
})

const idSchema = z.string().min(1).max(64)

const preferencesSchema = z.object({
  autoPlay: z.boolean(),
  autoPlayNext: z.boolean(),
  loop: z.boolean(),
  shuffle: z.boolean(),
  muted: z.boolean(),
  maxConcurrent: z.number().int().min(MIN_CONCURRENT_VIDEOS).max(MAX_CONCURRENT_VIDEOS),
})

function getAllowedFacebookUrl(value: string) {
  try {
    const url = new URL(value)
    const allowedHosts = new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com', 'fb.watch'])
    return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase()) ? url.toString() : null
  } catch {
    return null
  }
}

function videoRecordToItem(video: {
  id: string
  title: string
  facebookUrl: string
  embedStatus: 'UNVERIFIED' | 'EMBEDDABLE' | 'FAILED'
  createdAt: Date
}): VideoItem {
  return {
    id: video.id,
    title: video.title,
    url: video.facebookUrl,
    status: video.embedStatus === 'EMBEDDABLE' ? 'Siap' : video.embedStatus === 'FAILED' ? 'Dibatasi' : 'Perlu diperiksa',
    added: new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' }).format(video.createdAt),
  }
}

export async function createVideoAction(input: { url: string; title: string }): Promise<ActionResult<VideoItem>> {
  await requireAdmin()
  const parsed = videoInputSchema.safeParse(input)
  if (!parsed.success) return { success: false, message: 'Periksa URL dan judul video.' }

  const facebookUrl = getAllowedFacebookUrl(parsed.data.url)
  if (!facebookUrl) return { success: false, message: 'Gunakan URL HTTPS dari Facebook atau fb.watch.' }

  const video = await prisma.video.create({
    data: {
      facebookUrl,
      title: parsed.data.title || 'Video Facebook tanpa judul',
    },
  })
  return { success: true, data: videoRecordToItem(video) }
}

export async function deleteVideoAction(id: string): Promise<ActionResult<null>> {
  await requireAdmin()
  if (!idSchema.safeParse(id).success) return { success: false, message: 'Video tidak valid.' }
  await prisma.video.delete({ where: { id } })
  return { success: true, data: null }
}

export async function createPlaylistAction(input: { name: string; description: string }): Promise<ActionResult<PlaylistItem>> {
  await requireAdmin()
  const parsed = playlistInputSchema.safeParse(input)
  if (!parsed.success) return { success: false, message: 'Masukkan nama dan deskripsi daftar putar yang valid.' }

  const playlist = await prisma.playlist.create({
    data: { name: parsed.data.name, description: parsed.data.description || null },
  })
  return {
    success: true,
    data: { id: playlist.id, name: playlist.name, description: playlist.description ?? '', videoIds: [] },
  }
}

export async function deletePlaylistAction(id: string): Promise<ActionResult<null>> {
  await requireAdmin()
  if (!idSchema.safeParse(id).success) return { success: false, message: 'Daftar putar tidak valid.' }

  const sessionCount = await prisma.playbackSession.count({ where: { playlistId: id } })
  if (sessionCount > 0) {
    return { success: false, message: 'Daftar putar memiliki riwayat pemutaran dan tidak dapat dihapus.' }
  }
  await prisma.playlist.delete({ where: { id } })
  return { success: true, data: null }
}

export async function togglePlaylistVideoAction(
  playlistId: string,
  videoId: string,
): Promise<ActionResult<string[]>> {
  await requireAdmin()
  if (!idSchema.safeParse(playlistId).success || !idSchema.safeParse(videoId).success) {
    return { success: false, message: 'Daftar putar atau video tidak valid.' }
  }

  const videoIds = await prisma.$transaction(async (transaction) => {
    const [playlist, video] = await Promise.all([
      transaction.playlist.findUnique({ where: { id: playlistId }, select: { id: true } }),
      transaction.video.findUnique({ where: { id: videoId }, select: { id: true } }),
    ])
    if (!playlist || !video) return null

    const current = await transaction.playlistVideo.findUnique({
      where: { playlistId_videoId: { playlistId, videoId } },
      select: { id: true },
    })
    if (current) {
      await transaction.playlistVideo.delete({ where: { id: current.id } })
    } else {
      const maximum = await transaction.playlistVideo.aggregate({
        where: { playlistId },
        _max: { position: true },
      })
      await transaction.playlistVideo.create({
        data: { playlistId, videoId, position: (maximum._max.position ?? -1) + 1 },
      })
    }

    const items = await transaction.playlistVideo.findMany({
      where: { playlistId },
      orderBy: { position: 'asc' },
      select: { videoId: true },
    })
    return items.map((item) => item.videoId)
  })

  if (!videoIds) return { success: false, message: 'Video atau daftar putar tidak ditemukan.' }
  return { success: true, data: videoIds }
}

export async function savePreferencesAction(input: PlaybackPreferences): Promise<ActionResult<PlaybackPreferences>> {
  await requireAdmin()
  const parsed = preferencesSchema.safeParse(input)
  if (!parsed.success) return { success: false, message: 'Preferensi pemutaran tidak valid.' }
  const value = parsed.data

  await prisma.appSettings.upsert({
    where: { id: 'global' },
    create: {
      id: 'global',
      autoplay: value.autoPlay,
      autoPlayNext: value.autoPlayNext,
      loopPlaylist: value.loop,
      shufflePlaylist: value.shuffle,
      muted: value.muted,
      maxConcurrent: value.maxConcurrent,
    },
    update: {
      autoplay: value.autoPlay,
      autoPlayNext: value.autoPlayNext,
      loopPlaylist: value.loop,
      shufflePlaylist: value.shuffle,
      muted: value.muted,
      maxConcurrent: value.maxConcurrent,
    },
  })
  return { success: true, data: value }
}

export async function startPlaybackAction(
  playlistId: string,
  videoId: string,
  currentSessionId: string | null,
): Promise<ActionResult<{ sessionId: string; activeDelta: number; activities: PlaybackActivity[] }>> {
  await requireAdmin()
  if (!idSchema.safeParse(playlistId).success || !idSchema.safeParse(videoId).success) {
    return { success: false, message: 'Daftar putar atau video tidak valid.' }
  }

  const result = await prisma.$transaction(async (transaction) => {
    const playlistVideo = await transaction.playlistVideo.findUnique({
      where: { playlistId_videoId: { playlistId, videoId } },
      include: { video: { select: { title: true } }, playlist: { select: { name: true } } },
    })
    if (!playlistVideo) return null

    let session = currentSessionId
      ? await transaction.playbackSession.findUnique({ where: { id: currentSessionId } })
      : null
    const activities: PlaybackActivity[] = []
    let activeDelta = 0

    if (session?.status === 'ACTIVE' && session.playlistId === playlistId) {
      if (session.currentVideoId === videoId) return { sessionId: session.id, activeDelta, activities }
      await transaction.playbackSession.update({
        where: { id: session.id },
        data: { currentVideoId: videoId },
      })
      const event = await transaction.playbackLog.create({
        data: { sessionId: session.id, videoId, eventType: 'NEXT_VIDEO_LOADED' },
      })
      activities.push({
        id: event.id,
        eventType: event.eventType,
        createdAt: event.createdAt.toISOString(),
        videoTitle: playlistVideo.video.title,
        playlistName: playlistVideo.playlist.name,
      })
      return { sessionId: session.id, activeDelta, activities }
    }

    if (session?.status === 'ACTIVE') {
      activeDelta -= 1
      await transaction.playbackSession.update({
        where: { id: session.id },
        data: { status: 'STOPPED', endedAt: new Date() },
      })
      await transaction.playbackLog.create({
        data: { sessionId: session.id, eventType: 'SESSION_STOPPED' },
      })
    }

    session = await transaction.playbackSession.create({
      data: { playlistId, currentVideoId: videoId },
    })
    activeDelta += 1
    const startedEvent = await transaction.playbackLog.create({
      data: { sessionId: session.id, videoId, eventType: 'SESSION_STARTED' },
    })
    const loadedEvent = await transaction.playbackLog.create({
      data: { sessionId: session.id, videoId, eventType: 'VIDEO_LOADED' },
    })
    activities.push(
      {
        id: startedEvent.id,
        eventType: startedEvent.eventType,
        createdAt: startedEvent.createdAt.toISOString(),
        videoTitle: playlistVideo.video.title,
        playlistName: playlistVideo.playlist.name,
      },
      {
        id: loadedEvent.id,
        eventType: loadedEvent.eventType,
        createdAt: loadedEvent.createdAt.toISOString(),
        videoTitle: playlistVideo.video.title,
        playlistName: playlistVideo.playlist.name,
      },
    )
    return { sessionId: session.id, activeDelta, activities }
  })

  if (!result) return { success: false, message: 'Video tidak ditemukan di daftar putar tersebut.' }
  return { success: true, data: result }
}

export async function finishPlaybackAction(sessionId: string, videoId: string): Promise<ActionResult<PlaybackActivity | null>> {
  await requireAdmin()
  if (!idSchema.safeParse(sessionId).success || !idSchema.safeParse(videoId).success) {
    return { success: false, message: 'Sesi pemutaran tidak valid.' }
  }

  const session = await prisma.playbackSession.findFirst({
    where: { id: sessionId, status: 'ACTIVE', currentVideoId: videoId },
    include: { playlist: { select: { name: true } }, currentVideo: { select: { title: true } } },
  })
  if (!session?.currentVideo) return { success: true, data: null }

  const event = await prisma.playbackLog.create({
    data: { sessionId, videoId, eventType: 'FINISHED_PLAYING' },
  })
  return {
    success: true,
    data: {
      id: event.id,
      eventType: event.eventType,
      createdAt: event.createdAt.toISOString(),
      videoTitle: session.currentVideo.title,
      playlistName: session.playlist.name,
    },
  }
}

export async function stopPlaybackAction(sessionId: string): Promise<ActionResult<PlaybackActivity | null>> {
  await requireAdmin()
  if (!idSchema.safeParse(sessionId).success) return { success: false, message: 'Sesi pemutaran tidak valid.' }

  const activity = await prisma.$transaction(async (transaction) => {
    const session = await transaction.playbackSession.findFirst({
      where: { id: sessionId, status: 'ACTIVE' },
      include: { playlist: { select: { name: true } }, currentVideo: { select: { title: true } } },
    })
    if (!session) return null

    await transaction.playbackSession.update({
      where: { id: session.id },
      data: { status: 'STOPPED', endedAt: new Date() },
    })
    const event = await transaction.playbackLog.create({
      data: { sessionId, eventType: 'SESSION_STOPPED' },
    })
    return {
      id: event.id,
      eventType: event.eventType,
      createdAt: event.createdAt.toISOString(),
      videoTitle: session.currentVideo?.title ?? 'Tidak ada video',
      playlistName: session.playlist.name,
    }
  })

  return { success: true, data: activity }
}
