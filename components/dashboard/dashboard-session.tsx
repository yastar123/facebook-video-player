'use client'

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { DashboardInitialData, PlaybackActivity, PlaybackPreferences, PlaylistItem, VideoItem } from '@/lib/dashboard-types'

type DashboardSession = {
  videos: VideoItem[]
  setVideos: Dispatch<SetStateAction<VideoItem[]>>
  playlists: PlaylistItem[]
  setPlaylists: Dispatch<SetStateAction<PlaylistItem[]>>
  selectedPlaylist: string
  setSelectedPlaylist: Dispatch<SetStateAction<string>>
  preferences: PlaybackPreferences
  setPreferences: Dispatch<SetStateAction<PlaybackPreferences>>
  admin: DashboardInitialData['admin']
  activities: PlaybackActivity[]
  setActivities: Dispatch<SetStateAction<PlaybackActivity[]>>
  completedPlaybackCount: number
  setCompletedPlaybackCount: Dispatch<SetStateAction<number>>
  activeSessionCount: number
  setActiveSessionCount: Dispatch<SetStateAction<number>>
  appSettings: DashboardInitialData['appSettings']
}

const DashboardSessionContext = createContext<DashboardSession | null>(null)

export function DashboardSessionProvider({ children, initialData }: { children: ReactNode; initialData: DashboardInitialData }) {
  const [videos, setVideos] = useState(initialData.videos)
  const [playlists, setPlaylists] = useState(initialData.playlists)
  const [selectedPlaylist, setSelectedPlaylist] = useState(initialData.playlists[0]?.id ?? '')
  const [preferences, setPreferences] = useState(initialData.preferences)
  const [activities, setActivities] = useState(initialData.activities)
  const [completedPlaybackCount, setCompletedPlaybackCount] = useState(initialData.completedPlaybackCount)
  const [activeSessionCount, setActiveSessionCount] = useState(initialData.activeSessionCount)

  return (
    <DashboardSessionContext.Provider
      value={{
        videos,
        setVideos,
        playlists,
        setPlaylists,
        selectedPlaylist,
        setSelectedPlaylist,
        preferences,
        setPreferences,
        admin: initialData.admin,
        activities,
        setActivities,
        completedPlaybackCount,
        setCompletedPlaybackCount,
        activeSessionCount,
        setActiveSessionCount,
        appSettings: initialData.appSettings,
      }}
    >
      {children}
    </DashboardSessionContext.Provider>
  )
}

export function useDashboardSession() {
  const session = useContext(DashboardSessionContext)
  if (!session) throw new Error('useDashboardSession must be used within DashboardSessionProvider')
  return session
}
