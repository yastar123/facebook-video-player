'use client'

import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'

export type VideoItem = { id: number; title: string; url: string; status: 'Siap' | 'Dibatasi' | 'Perlu diperiksa'; added: string }
export type PlaylistItem = { id: number; name: string; description: string; videoIds: number[] }
export type PlaybackPreferences = { autoPlay: boolean; autoPlayNext: boolean; loop: boolean; shuffle: boolean; muted: boolean; maxConcurrent: number }

const initialVideos: VideoItem[] = [
  { id: 1, title: 'Cara berbagi hanya dengan teman', url: 'https://www.facebook.com/watch/?v=10153231379946729', status: 'Perlu diperiksa', added: '16 Nov 2026' },
]
const initialPlaylists: PlaylistItem[] = [
  { id: 1, name: 'Contoh sematan Facebook', description: 'Video contoh untuk pratinjau pemutar Facebook.', videoIds: [1] },
]

type DashboardSession = {
  videos: VideoItem[]
  setVideos: Dispatch<SetStateAction<VideoItem[]>>
  playlists: PlaylistItem[]
  setPlaylists: Dispatch<SetStateAction<PlaylistItem[]>>
  selectedPlaylist: number
  setSelectedPlaylist: Dispatch<SetStateAction<number>>
  preferences: PlaybackPreferences
  setPreferences: Dispatch<SetStateAction<PlaybackPreferences>>
}

const DashboardSessionContext = createContext<DashboardSession | null>(null)

export function DashboardSessionProvider({ children }: { children: ReactNode }) {
  const [videos, setVideos] = useState(initialVideos)
  const [playlists, setPlaylists] = useState(initialPlaylists)
  const [selectedPlaylist, setSelectedPlaylist] = useState(1)
  const [preferences, setPreferences] = useState<PlaybackPreferences>({
    autoPlay: true,
    autoPlayNext: true,
    loop: true,
    shuffle: false,
    muted: true,
    maxConcurrent: 20,
  })

  return (
    <DashboardSessionContext.Provider value={{ videos, setVideos, playlists, setPlaylists, selectedPlaylist, setSelectedPlaylist, preferences, setPreferences }}>
      {children}
    </DashboardSessionContext.Provider>
  )
}

export function useDashboardSession() {
  const session = useContext(DashboardSessionContext)
  if (!session) throw new Error('useDashboardSession must be used within DashboardSessionProvider')
  return session
}
