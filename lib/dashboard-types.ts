export type VideoItem = {
  id: string
  title: string
  url: string
  status: 'Siap' | 'Dibatasi' | 'Perlu diperiksa'
  added: string
}

export type PlaylistItem = {
  id: string
  name: string
  description: string
  videoIds: string[]
}

export type PlaybackPreferences = {
  autoPlay: boolean
  autoPlayNext: boolean
  loop: boolean
  shuffle: boolean
  muted: boolean
  maxConcurrent: number
}

export type PlaybackActivity = {
  id: string
  eventType: string
  createdAt: string
  videoTitle: string
  playlistName: string
}

export type DashboardInitialData = {
  videos: VideoItem[]
  playlists: PlaylistItem[]
  preferences: PlaybackPreferences
  activities: PlaybackActivity[]
  completedPlaybackCount: number
  activeSessionCount: number
  appSettings: {
    appName: string
    timezone: string
  }
  admin: {
    name: string
    email: string
  }
}
