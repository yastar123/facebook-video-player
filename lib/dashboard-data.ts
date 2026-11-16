import 'server-only'

import { prisma } from '@/lib/prisma'
import type { AdminIdentity } from '@/lib/auth'
import type { DashboardInitialData } from '@/lib/dashboard-types'
import { MAX_CONCURRENT_VIDEOS, MIN_CONCURRENT_VIDEOS } from '@/lib/playback-limits'

function displayDate(date: Date) {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(date)
}

export async function getDashboardInitialData(admin: AdminIdentity): Promise<DashboardInitialData> {
  const settings = await prisma.appSettings.upsert({
    where: { id: 'global' },
    create: { id: 'global' },
    update: {},
  })

  const [videos, playlists, activities, completedPlaybackCount, activeSessionCount] = await Promise.all([
    prisma.video.findMany({ orderBy: { createdAt: 'desc' } }),
    prisma.playlist.findMany({
      include: { videos: { orderBy: { position: 'asc' }, select: { videoId: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.playbackLog.findMany({
      take: 30,
      orderBy: { createdAt: 'desc' },
      include: { video: { select: { title: true } }, session: { include: { playlist: { select: { name: true } } } } },
    }),
    prisma.playbackLog.count({ where: { eventType: 'FINISHED_PLAYING' } }),
    prisma.playbackSession.count({ where: { status: 'ACTIVE' } }),
  ])

  return {
    videos: videos.map((video) => ({
      id: video.id,
      title: video.title,
      url: video.facebookUrl,
      status: video.embedStatus === 'EMBEDDABLE' ? 'Siap' : video.embedStatus === 'FAILED' ? 'Dibatasi' : 'Perlu diperiksa',
      added: displayDate(video.createdAt),
    })),
    playlists: playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      description: playlist.description ?? '',
      videoIds: playlist.videos.map((item) => item.videoId),
    })),
    preferences: {
      autoPlay: settings.autoplay,
      autoPlayNext: settings.autoPlayNext,
      loop: settings.loopPlaylist,
      shuffle: settings.shufflePlaylist,
      muted: settings.muted,
      maxConcurrent: Math.min(MAX_CONCURRENT_VIDEOS, Math.max(MIN_CONCURRENT_VIDEOS, settings.maxConcurrent)),
    },
    activities: activities.map((activity) => ({
      id: activity.id,
      eventType: activity.eventType,
      createdAt: activity.createdAt.toISOString(),
      videoTitle: activity.video?.title ?? 'Video dihapus',
      playlistName: activity.session.playlist.name,
    })),
    completedPlaybackCount,
    activeSessionCount,
    appSettings: {
      appName: settings.appName,
      timezone: settings.timezone,
    },
    admin: { name: admin.name, email: admin.email },
  }
}
