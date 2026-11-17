'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, ArrowRight, AudioLines, Bell, Check, CircleHelp, Clock3, ExternalLink,
  Film, FolderPlus, Gauge, LayoutGrid, ListMusic, LogOut, Menu, Play, Plus, Search,
  Settings2, SkipBack, SkipForward, Trash2, Video, X,
} from 'lucide-react'
import { FacebookVideoEmbed } from './facebook-video-embed'
import { useDashboardSession } from './dashboard-session'
import { RuntimeMonitor } from './runtime-monitor'
import type { PlaybackActivity, PlaybackPreferences, PlaylistItem, VideoItem } from '@/lib/dashboard-types'
import {
  createPlaylistAction,
  createVideoAction,
  deletePlaylistAction,
  deleteVideoAction,
  finishPlaybackAction,
  getCompletedPlaybackCountAction,
  savePreferencesAction,
  startPlaybackAction,
  stopPlaybackAction,
  syncPlaybackSessionsAction,
  togglePlaylistVideoAction,
} from '@/app/dashboard/actions'
import { logoutAction } from '@/app/login/actions'
import { MAX_CONCURRENT_VIDEOS, MIN_CONCURRENT_VIDEOS } from '@/lib/playback-limits'
import { PLAYBACK_SESSION_HEARTBEAT_INTERVAL_MS } from '@/lib/playback-session'
import { handlePlaybackFinished } from '@/lib/playback-flow'

const navGroups = [
  { label: 'Ruang kerja', links: [{ label: 'Ringkasan', href: '/dashboard', icon: Gauge }, { label: 'Pemutar', href: '/dashboard/player', icon: Play }] },
  { label: 'Pustaka', links: [{ label: 'Video', href: '/dashboard/videos', icon: Film }, { label: 'Daftar putar', href: '/dashboard/playlists', icon: ListMusic }] },
  { label: 'Wawasan', links: [{ label: 'Riwayat pemutaran', href: '/dashboard/history', icon: Activity }] },
  { label: 'Preferensi', links: [{ label: 'Pengaturan', href: '/dashboard/settings', icon: Settings2 }] },
]
const pageNames: Record<string, string> = { dashboard: 'Ringkasan', videos: 'Video', playlists: 'Daftar putar', player: 'Pemutar', history: 'Riwayat pemutaran', settings: 'Pengaturan' }
const concurrentPlaybackOptions = Array.from(
  { length: MAX_CONCURRENT_VIDEOS - MIN_CONCURRENT_VIDEOS + 1 },
  (_, index) => index + MIN_CONCURRENT_VIDEOS,
)
const DASHBOARD_STATS_REFRESH_INTERVAL_MS = 10_000
const activityLabels: Record<string, string> = {
  SESSION_STARTED: 'Sesi dimulai',
  VIDEO_LOADED: 'Video dimuat',
  STARTED_PLAYING: 'Pemutaran dimulai',
  PAUSED: 'Pemutaran dijeda',
  FINISHED_PLAYING: 'Video selesai',
  NEXT_VIDEO_LOADED: 'Video berikutnya dimuat',
  SESSION_STOPPED: 'Sesi dihentikan',
  ERROR: 'Terjadi kesalahan',
}

function cx(...names: Array<string | false | undefined>) { return names.filter(Boolean).join(' ') }
function Button({ children, onClick, href, variant = 'secondary', disabled = false, className = '' }: { children: React.ReactNode; onClick?: () => void; href?: string; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean; className?: string }) {
  const base = 'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50'
  const variants = { primary: 'bg-blue-600 text-white hover:bg-blue-700', secondary: 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50', quiet: 'text-zinc-600 hover:bg-zinc-100', danger: 'text-red-600 hover:bg-red-50' }
  if (href) return <Link className={cx(base, variants[variant], className)} href={href}>{children}</Link>
  return <button type="button" disabled={disabled} onClick={onClick} className={cx(base, variants[variant], className)}>{children}</button>
}
function Status({ children }: { children: string }) {
  const tones: Record<string, string> = { Siap: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15', Dibatasi: 'bg-amber-50 text-amber-700 ring-amber-600/15', 'Perlu diperiksa': 'bg-zinc-100 text-zinc-600 ring-zinc-500/10', Aktif: 'bg-blue-50 text-blue-700 ring-blue-600/15' }
  return <span className={cx('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset', tones[children] ?? tones['Perlu diperiksa'])}><span className="size-1.5 rounded-full bg-current opacity-70" />{children}</span>
}
function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[.12em] text-zinc-400">{eyebrow}</p>}<h1 className="text-[26px] font-semibold tracking-[-.04em] text-zinc-900">{title}</h1>{description && <p className="mt-1.5 text-[13px] text-zinc-500">{description}</p>}</div>{action}</div>
}
function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <section className={cx('rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(20,20,30,.025)]', className)}>{children}</section> }
function PanelTitle({ children, note, action }: { children: React.ReactNode; note?: string; action?: React.ReactNode }) { return <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-5 py-4"><div><h2 className="text-[13px] font-semibold text-zinc-800">{children}</h2>{note && <p className="mt-1 text-xs text-zinc-400">{note}</p>}</div>{action}</div> }
function EmptyState({ title, description }: { title: string; description: string }) { return <div className="px-6 py-12 text-center"><div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500"><Film className="size-5" /></div><p className="text-sm font-medium text-zinc-700">{title}</p><p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-zinc-500">{description}</p></div> }

export function VideoDashboard() {
  const pathname = usePathname()
  const section = pathname.split('/')[2] || 'dashboard'
  const title = pageNames[section] ?? 'Ringkasan'
  const [mobileNav, setMobileNav] = useState(false)
  const {
    videos,
    setVideos,
    playlists,
    setPlaylists,
    selectedPlaylist,
    setSelectedPlaylist,
    preferences,
    setPreferences,
    admin,
    activities,
    setActivities,
    completedPlaybackCount,
    setCompletedPlaybackCount,
    activeSessionCount,
    setActiveSessionCount,
    appSettings,
  } = useDashboardSession()
  const playbackSessionId = useRef<string | null>(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [multiView, setMultiView] = useState(false)
  const [multiVideoIds, setMultiVideoIds] = useState<string[] | null>(null)
  const [dialog, setDialog] = useState<'video' | 'playlist' | null>(null)
  const [search, setSearch] = useState('')
  const [notice, setNotice] = useState('')
  const activePlaylist = playlists.find((item) => item.id === selectedPlaylist) ?? playlists[0]
  const playlistVideos = useMemo(() => activePlaylist?.videoIds.map((id) => videos.find((item) => item.id === id)).filter((item): item is VideoItem => Boolean(item)) ?? [], [activePlaylist, videos])
  const currentVideo = playlistVideos[currentIndex]
  const maxConcurrentVideos = Math.min(preferences.maxConcurrent, MAX_CONCURRENT_VIDEOS)
  const selectedMultiVideos = useMemo(() => {
    const selectedIds = multiVideoIds ?? playlistVideos.slice(0, maxConcurrentVideos).map((video) => video.id)
    return playlistVideos.filter((video) => selectedIds.includes(video.id)).slice(0, maxConcurrentVideos)
  }, [multiVideoIds, playlistVideos, maxConcurrentVideos])
  const visibleVideos = videos.filter((item) => `${item.title} ${item.url}`.toLowerCase().includes(search.toLowerCase()))
  const [formError, setFormError] = useState('')
  const [errorNotice, setErrorNotice] = useState('')

  useEffect(() => {
    let syncing = false
    const synchronizeSessions = async () => {
      if (syncing) return
      syncing = true
      try {
        const result = await syncPlaybackSessionsAction(playbackSessionId.current)
        if (!result.success) {
          setErrorNotice(result.message)
          return
        }
        setActiveSessionCount(result.data)
      } catch {
        setErrorNotice('Status sesi pemutaran tidak dapat disinkronkan.')
      } finally {
        syncing = false
      }
    }

    void synchronizeSessions()
    const intervalId = window.setInterval(
      () => void synchronizeSessions(),
      PLAYBACK_SESSION_HEARTBEAT_INTERVAL_MS,
    )
    return () => window.clearInterval(intervalId)
  }, [setActiveSessionCount])

  useEffect(() => {
    if (section !== 'dashboard') return

    let syncing = false
    const synchronizeCompletedPlaybackCount = async () => {
      if (syncing) return
      syncing = true
      try {
        const result = await getCompletedPlaybackCountAction()
        if (!result.success) {
          setErrorNotice(result.message)
          return
        }
        setCompletedPlaybackCount(result.data)
      } catch {
        setErrorNotice('Jumlah video selesai tidak dapat disinkronkan.')
      } finally {
        syncing = false
      }
    }

    void synchronizeCompletedPlaybackCount()
    const intervalId = window.setInterval(
      () => void synchronizeCompletedPlaybackCount(),
      DASHBOARD_STATS_REFRESH_INTERVAL_MS,
    )
    return () => window.clearInterval(intervalId)
  }, [section, setCompletedPlaybackCount])

  async function addVideo(form: FormData) {
    const url = String(form.get('url') ?? '').trim()
    const titleValue = String(form.get('title') ?? '').trim()
    try {
      const result = await createVideoAction({ url, title: titleValue })
      if (!result.success) { setFormError(result.message); return }
      setVideos((items) => [result.data, ...items])
      setFormError('')
      setDialog(null)
      setNotice('Video berhasil disimpan.')
      setErrorNotice('')
    } catch {
      setFormError('Video tidak dapat disimpan. Periksa koneksi database lalu coba lagi.')
    }
  }
  async function addPlaylist(form: FormData) {
    const name = String(form.get('name') ?? '').trim()
    if (!name) { setFormError('Masukkan nama daftar putar.'); return }
    try {
      const result = await createPlaylistAction({ name, description: String(form.get('description') ?? '').trim() })
      if (!result.success) { setFormError(result.message); return }
      setPlaylists((items) => [...items, result.data])
      setSelectedPlaylist(result.data.id)
      setFormError('')
      setDialog(null)
      setNotice('Daftar putar berhasil disimpan.')
      setErrorNotice('')
    } catch {
      setFormError('Daftar putar tidak dapat disimpan. Periksa koneksi database lalu coba lagi.')
    }
  }
  async function removeVideo(id: string) {
    try {
      const result = await deleteVideoAction(id)
      if (!result.success) { setErrorNotice(result.message); return }
      setVideos((items) => items.filter((item) => item.id !== id))
      setPlaylists((items) => items.map((list) => ({ ...list, videoIds: list.videoIds.filter((videoId) => videoId !== id) })))
      setNotice('Video berhasil dihapus.')
      setErrorNotice('')
    } catch {
      setErrorNotice('Video tidak dapat dihapus. Coba lagi.')
    }
  }
  async function togglePlaylistVideo(videoId: string) {
    if (!selectedPlaylist) {
      setErrorNotice('Buat daftar putar terlebih dahulu sebelum menambahkan video.')
      return
    }
    try {
      const result = await togglePlaylistVideoAction(selectedPlaylist, videoId)
      if (!result.success) { setErrorNotice(result.message); return }
      setPlaylists((items) => items.map((item) => item.id === selectedPlaylist ? { ...item, videoIds: result.data } : item))
      setErrorNotice('')
    } catch {
      setErrorNotice('Perubahan daftar putar tidak dapat disimpan. Coba lagi.')
    }
  }
  async function removePlaylist(id: string) {
    const playlist = playlists.find((item) => item.id === id)
    if (!playlist) return
    if (!window.confirm(`Hapus daftar putar "${playlist.name}" beserta semua sesi dan riwayat pemutarannya?`)) return

    try {
      const result = await deletePlaylistAction(id)
      if (!result.success) { setErrorNotice(result.message); return }
      const remaining = playlists.filter((item) => item.id !== id)
      setPlaylists(remaining)
      setActiveSessionCount((count) => Math.max(0, count - result.data))
      if (selectedPlaylist === id) {
        setSelectedPlaylist(remaining[0]?.id ?? '')
        setCurrentIndex(0)
        setMultiVideoIds(null)
      }
      setNotice('Daftar putar beserta riwayat pemutarannya berhasil dihapus.')
      setErrorNotice('')
    } catch {
      setErrorNotice('Daftar putar tidak dapat dihapus. Coba lagi.')
    }
  }
  async function updatePreferences(value: PlaybackPreferences) {
    const previous = preferences
    setPreferences(value)
    try {
      const result = await savePreferencesAction(value)
      if (!result.success) {
        setPreferences(previous)
        setErrorNotice(result.message)
        return
      }
      setNotice('Preferensi berhasil disimpan.')
      setErrorNotice('')
    } catch {
      setPreferences(previous)
      setErrorNotice('Preferensi tidak dapat disimpan. Coba lagi.')
    }
  }
  async function onVideoReady(playlistId: string, videoId: string) {
    try {
      const result = await startPlaybackAction(playlistId, videoId, playbackSessionId.current)
      if (!result.success) { setErrorNotice(result.message); return }
      playbackSessionId.current = result.data.sessionId
      setActivities((items) => [...result.data.activities, ...items].slice(0, 30))
      if (result.data.activeDelta) setActiveSessionCount((count) => Math.max(0, count + result.data.activeDelta))
      setErrorNotice('')
    } catch {
      setErrorNotice('Sesi pemutaran tidak dapat disimpan.')
    }
  }
  async function onVideoFinished(videoId: string) {
    const sessionId = playbackSessionId.current
    if (!sessionId) return
    try {
      const result = await finishPlaybackAction(sessionId, videoId)
      if (!result.success) { setErrorNotice(result.message); return }
      const activity = result.data
      if (activity) {
        setActivities((items) => [activity, ...items].slice(0, 30))
        setCompletedPlaybackCount((count) => count + 1)
      }
    } catch {
      setErrorNotice('Event selesai tidak dapat disimpan.')
    }
  }
  useEffect(() => {
    if (section === 'player' && !multiView) return
    const sessionId = playbackSessionId.current
    if (!sessionId) return
    playbackSessionId.current = null
    void stopPlaybackAction(sessionId).then((result) => {
      if (!result.success) { setErrorNotice(result.message); return }
      const activity = result.data
      if (activity) {
        setActivities((items) => [activity, ...items].slice(0, 30))
        setActiveSessionCount((count) => Math.max(0, count - 1))
      }
    }).catch(() => setErrorNotice('Sesi pemutaran tidak dapat dihentikan.'))
  }, [section, multiView, setActivities, setActiveSessionCount])
  const side = <aside className={cx('fixed inset-y-0 left-0 z-30 flex w-[248px] flex-col border-r border-zinc-200/80 bg-white px-3 transition-transform lg:static lg:translate-x-0', mobileNav ? 'translate-x-0' : '-translate-x-full')}>
    <div className="flex h-[62px] items-center gap-3 px-2"><div className="flex size-8 items-center justify-center rounded-[10px] bg-blue-600 text-white"><Play className="size-4 fill-current" /></div><span className="text-[14px] font-semibold tracking-[-.02em] text-zinc-900">Pemutar Video Facebook</span><button className="ml-auto rounded-md p-1 text-zinc-400 hover:bg-zinc-100 lg:hidden" onClick={() => setMobileNav(false)} aria-label="Tutup navigasi"><X className="size-4" /></button></div>
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-2"><div className="flex size-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-600"><Video className="size-3.5" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-700">Pustaka administrator</p><p className="text-[10px] text-zinc-400">PostgreSQL</p></div></div>
    <nav className="mt-7 flex-1 space-y-6" aria-label="Navigasi utama">{navGroups.map((group) => <div key={group.label}><p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[.12em] text-zinc-400">{group.label}</p><div className="space-y-0.5">{group.links.map((item) => { const active = item.href === '/dashboard' ? section === 'dashboard' : pathname === item.href || (item.href !== '/dashboard/player' && pathname.startsWith(`${item.href}/`)); const Icon = item.icon; return <Link key={item.href} onClick={() => setMobileNav(false)} href={item.href} className={cx('flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors', active ? 'bg-blue-50 font-medium text-blue-700' : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900')}><Icon className="size-[16px]" strokeWidth={1.8} />{item.label}{item.label === 'Video' && <span className="ml-auto text-[11px] text-zinc-400">{videos.length}</span>}</Link> })}</div></div>)}</nav>
    <div className="mb-3 flex items-center gap-2.5 rounded-lg px-2 py-2"><div className="flex size-8 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-600">AD</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-700">{admin.name}</p><p className="truncate text-[10px] text-zinc-400">{admin.email}</p></div><form action={logoutAction}><button type="submit" className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100" aria-label="Keluar"><LogOut className="size-4" /></button></form></div>
  </aside>

  function header() { return <header className="sticky top-0 z-20 flex h-[62px] items-center justify-between border-b border-zinc-200/80 bg-[#fafafa]/90 px-4 backdrop-blur-md sm:px-7"><div className="flex items-center gap-3"><button className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Buka navigasi"><Menu className="size-[18px]" /></button><div className="hidden items-center gap-2 text-xs text-zinc-400 sm:flex"><span>Ruang kerja</span><span>/</span><span className="font-medium text-zinc-700">{title}</span></div><span className="text-sm font-medium text-zinc-700 sm:hidden">{title}</span></div><div className="flex items-center gap-2"><Button variant="quiet" className="hidden sm:inline-flex"><CircleHelp className="size-4" />Bantuan</Button><button className="relative rounded-lg p-2 text-zinc-500 hover:bg-zinc-100" aria-label="Notifikasi"><Bell className="size-4" /></button><div className="mx-1 h-5 w-px bg-zinc-200" /><span className="flex size-7 items-center justify-center rounded-full bg-zinc-200 text-[10px] font-semibold text-zinc-600" aria-label={`Administrator ${admin.name}`}>AD</span></div></header> }

  return <div className="min-h-screen bg-[#fafafa] text-zinc-900"><div className="flex min-h-screen">{side}{mobileNav && <button aria-label="Tutup latar navigasi" className="fixed inset-0 z-20 bg-zinc-950/20 lg:hidden" onClick={() => setMobileNav(false)} />}
    <div className="min-w-0 flex-1">{header()}<main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-7 sm:py-8">
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-4 py-3"><div className="mt-0.5 text-emerald-700"><Check className="size-4" /></div><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-emerald-900">Data tersimpan di PostgreSQL</p><p className="mt-0.5 text-[11px] leading-5 text-emerald-800/80">Perubahan video, daftar putar, dan preferensi disimpan pada basis data.</p></div><span className="hidden shrink-0 rounded-md bg-white/70 px-2 py-1 text-[10px] font-medium text-emerald-800 ring-1 ring-emerald-200 sm:block">TERHUBUNG</span></div>
      {errorNotice && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{errorNotice}</div>}
      {notice && <div role="status" className="mb-4 flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><span className="flex items-center gap-2"><Check className="size-4" />{notice}</span><button onClick={() => setNotice('')} aria-label="Tutup notifikasi"><X className="size-4" /></button></div>}
      {section === 'videos' ? <VideosPage videos={visibleVideos} search={search} setSearch={setSearch} onAdd={() => { setFormError(''); setDialog('video') }} onRemove={removeVideo} onAddToPlaylist={togglePlaylistVideo} /> : null}
      {section === 'playlists' ? <PlaylistsPage playlists={playlists} videos={videos} selected={selectedPlaylist} onSelect={setSelectedPlaylist} onCreate={() => { setFormError(''); setDialog('playlist') }} onToggleVideo={togglePlaylistVideo} onDelete={removePlaylist} /> : null}
      {section === 'player' ? <PlayerPage playlists={playlists} activePlaylist={activePlaylist} playlistVideos={playlistVideos} currentVideo={currentVideo} currentIndex={currentIndex} onSelectPlaylist={(id) => { setSelectedPlaylist(id); setCurrentIndex(0); setMultiVideoIds(null) }} onSelectVideo={setCurrentIndex} onNext={() => setCurrentIndex((i) => Math.min(i + 1, playlistVideos.length - 1))} onPrevious={() => setCurrentIndex((i) => Math.max(0, i - 1))} preferences={preferences} setPreferences={updatePreferences} multiView={multiView} setMultiView={setMultiView} selectedMultiVideos={selectedMultiVideos} maxConcurrentVideos={maxConcurrentVideos} onVideoReady={(videoId) => { if (activePlaylist) void onVideoReady(activePlaylist.id, videoId) }} onVideoFinished={(videoId) => { void onVideoFinished(videoId) }} onToggleMultiVideo={(id) => setMultiVideoIds((multiVideoIds ?? selectedMultiVideos.map((video) => video.id)).includes(id) ? (multiVideoIds ?? selectedMultiVideos.map((video) => video.id)).filter((videoId) => videoId !== id) : [...(multiVideoIds ?? selectedMultiVideos.map((video) => video.id)), id])} /> : null}
      {section === 'history' ? <HistoryPage activities={activities} /> : null}
      {section === 'settings' ? <SettingsPage preferences={preferences} setPreferences={updatePreferences} admin={admin} appSettings={appSettings} /> : null}
      {section === 'dashboard' || !pageNames[section] ? <OverviewPage videos={videos} playlists={playlists} activePlaylist={activePlaylist} activities={activities} completedPlaybackCount={completedPlaybackCount} activeSessionCount={activeSessionCount} onAddVideo={() => { setFormError(''); setDialog('video') }} /> : null}
    </main></div></div>
    {dialog && <Dialog title={dialog === 'video' ? 'Tambah video' : 'Buat daftar putar'} onClose={() => setDialog(null)} onSubmit={dialog === 'video' ? addVideo : addPlaylist} error={formError} kind={dialog} />}
  </div>
}

function OverviewPage({ videos, playlists, activePlaylist, activities, completedPlaybackCount, activeSessionCount, onAddVideo }: {
  videos: VideoItem[]
  playlists: PlaylistItem[]
  activePlaylist?: PlaylistItem
  activities: PlaybackActivity[]
  completedPlaybackCount: number
  activeSessionCount: number
  onAddVideo: () => void
}) {
  return <>
    <SectionHeading eyebrow="Ringkasan" title="Selamat datang, Admin" description="Data berikut diambil dari basis data aplikasi." action={<Button variant="primary" onClick={onAddVideo}><Plus className="size-4" />Tambah video</Button>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: 'Video di pustaka', value: videos.length.toString(), meta: 'Tersimpan', icon: Film },
        { label: 'Daftar putar', value: playlists.length.toString(), meta: 'Tersimpan', icon: ListMusic },
        { label: 'Video selesai', value: completedPlaybackCount.toString(), meta: 'Event aplikasi', icon: Activity },
        { label: 'Sesi pemutar terhubung', value: activeSessionCount.toString(), meta: 'Heartbeat <5 mnt', icon: AudioLines },
      ].map(({ label, value, meta, icon: Icon }) => <Panel key={label} className="p-4"><div className="flex items-center justify-between"><span className="text-xs font-medium text-zinc-500">{label}</span><Icon className="size-4 text-zinc-400" /></div><div className="mt-4 flex items-end justify-between"><span className="text-[27px] font-semibold tracking-[-.05em] text-zinc-900">{value}</span><span className="mb-1 text-[10px] text-zinc-400">{meta}</span></div></Panel>)}
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
      <Panel>
        <PanelTitle note="Event yang diamati oleh pemutar aplikasi, bukan statistik Facebook." action={<Button href="/dashboard/history" variant="quiet">Riwayat <ArrowRight className="size-3.5" /></Button>}>Aktivitas terbaru</PanelTitle>
        {activePlaylist && <p className="border-b border-zinc-100 px-5 py-3 text-xs text-zinc-500">Daftar putar terakhir dipilih: {activePlaylist.name}</p>}
        {activities.length ? <div className="divide-y divide-zinc-100">{activities.slice(0, 4).map((activity) => <div key={activity.id} className="flex items-center gap-3 px-5 py-3"><Activity className="size-4 text-zinc-400" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-700">{activityLabels[activity.eventType] ?? activity.eventType} · {activity.videoTitle}</p><p className="mt-1 truncate text-[10px] text-zinc-400">{activity.playlistName}</p></div></div>)}</div> : <p className="px-5 py-4 text-sm text-zinc-600">Belum ada event pemutaran yang teramati.</p>}
      </Panel>
      <Panel>
        <PanelTitle note="Daftar putar yang tersimpan." action={<Button href="/dashboard/playlists" variant="quiet">Semua daftar putar <ArrowRight className="size-3.5" /></Button>}>Daftar putar</PanelTitle>
        <div className="divide-y divide-zinc-100">
          {playlists.slice(0, 3).map((list, index) => <Link href="/dashboard/playlists" key={list.id} className="flex items-center gap-3 px-5 py-4 hover:bg-zinc-50/70"><div className={cx('flex size-9 items-center justify-center rounded-lg', index === 0 ? 'bg-blue-50 text-blue-600' : 'bg-zinc-100 text-zinc-500')}><ListMusic className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-800">{list.name}</p><p className="mt-1 text-[11px] text-zinc-400">{list.videoIds.length} video · PostgreSQL</p></div><ArrowRight className="size-4 text-zinc-300" /></Link>)}
          {!playlists.length && <EmptyState title="Belum ada daftar putar" description="Buat daftar putar untuk mengelompokkan video tersimpan." />}
        </div>
      </Panel>
    </div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.55fr]">
      <Panel><PanelTitle>Tindakan cepat</PanelTitle><div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-1">{[{ href: '/dashboard/videos', icon: Plus, title: 'Tambahkan ke pustaka', note: 'Simpan URL Facebook' }, { href: '/dashboard/playlists', icon: FolderPlus, title: 'Buat daftar putar', note: 'Susun video tersimpan' }, { href: '/dashboard/player', icon: Play, title: 'Buka pemutar', note: 'Putar video yang diizinkan' }, { href: '/dashboard/history', icon: Clock3, title: 'Lihat riwayat', note: 'Event aplikasi saja' }].map((item) => <Link href={item.href} key={item.title} className="flex items-center gap-3 rounded-lg border border-zinc-100 p-3 hover:border-zinc-200 hover:bg-zinc-50"><item.icon className="size-4 text-zinc-500" /><span className="min-w-0 flex-1"><span className="block text-xs font-medium text-zinc-700">{item.title}</span><span className="mt-0.5 block text-[10px] text-zinc-400">{item.note}</span></span><ArrowRight className="size-3.5 text-zinc-300" /></Link>)}</div></Panel>
      <Panel><PanelTitle note="Ketersediaan sematan ditentukan oleh penerbit." action={<Button href="/dashboard/videos" variant="quiet">Lihat pustaka <ArrowRight className="size-3.5" /></Button>}>Video terbaru</PanelTitle><div className="divide-y divide-zinc-100">{videos.slice(0, 3).map((video) => <div key={video.id} className="flex items-center gap-3 px-5 py-3.5"><div className="flex size-9 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500"><Film className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-800">{video.title}</p><p className="mt-1 truncate text-[10px] text-zinc-400">{video.added}</p></div><Status>{video.status}</Status></div>)}{!videos.length && <EmptyState title="Belum ada video" description="Tambahkan URL video Facebook yang dapat Anda akses." />}</div></Panel>
    </div>
  </>
}

function VideosPage({ videos, search, setSearch, onAdd, onRemove, onAddToPlaylist }: {
  videos: VideoItem[]
  search: string
  setSearch: (value: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onAddToPlaylist: (id: string) => void
}) {
  return <>
    <SectionHeading eyebrow="Pustaka" title="Video" description="Kelola tautan video Facebook yang Anda berhak sematkan." action={<Button variant="primary" onClick={onAdd}><Plus className="size-4" />Tambah video</Button>} />
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
        <div><p className="text-[13px] font-semibold text-zinc-800">Pustaka video <span className="ml-1 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">{videos.length}</span></p><p className="mt-1 text-[11px] text-zinc-400">Data tersimpan di PostgreSQL.</p></div>
        <label className="flex h-9 w-[210px] items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3"><Search className="size-3.5 text-zinc-400" /><input aria-label="Cari video" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari video" className="w-full bg-transparent text-xs outline-none placeholder:text-zinc-400" /></label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left">
          <thead className="bg-zinc-50/70 text-[10px] font-medium uppercase tracking-[.08em] text-zinc-400"><tr><th className="px-5 py-3">Video</th><th className="px-4 py-3">URL Facebook</th><th className="px-4 py-3">Status sematan</th><th className="px-4 py-3">Ditambahkan</th><th className="px-4 py-3 text-right">Tindakan</th></tr></thead>
          <tbody className="divide-y divide-zinc-100">{videos.map((video) => <tr key={video.id} className="group hover:bg-zinc-50/50"><td className="px-5 py-3.5"><div className="flex items-center gap-3"><div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500"><Film className="size-4" /></div><span className="max-w-[200px] truncate text-xs font-medium text-zinc-700">{video.title}</span></div></td><td className="max-w-[220px] truncate px-4 py-3.5 text-[11px] text-zinc-500">{video.url}</td><td className="px-4 py-3.5"><Status>{video.status}</Status></td><td className="px-4 py-3.5 text-[11px] text-zinc-500">{video.added}</td><td className="px-4 py-3.5"><div className="flex justify-end gap-1"><button onClick={() => onAddToPlaylist(video.id)} title={`Tambahkan atau hapus ${video.title} dari daftar putar terpilih`} aria-label={`Tambahkan atau hapus ${video.title} dari daftar putar terpilih`} className="rounded-md p-2 text-zinc-400 hover:bg-blue-50 hover:text-blue-600"><ListMusic className="size-4" /></button><a href={video.url} target="_blank" rel="noreferrer" title="Buka video asli di Facebook" className="rounded-md p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><ExternalLink className="size-4" /></a><button onClick={() => onRemove(video.id)} title="Hapus video" aria-label={`Hapus ${video.title}`} className="rounded-md p-2 text-zinc-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="size-4" /></button></div></td></tr>)}</tbody>
        </table>
        {videos.length === 0 && <EmptyState title="Belum ada video" description={search ? 'Tidak ada video yang cocok dengan pencarian.' : 'Tambahkan URL video Facebook yang dapat Anda akses.'} />}
      </div>
    </Panel>
    <p className="mt-3 text-[11px] leading-5 text-zinc-400">Sematan dapat diblokir oleh pemilik video, pembatasan pemirsa, atau pengaturan Facebook.</p>
  </>
}

function PlaylistsPage({ playlists, videos, selected, onSelect, onCreate, onToggleVideo, onDelete }: {
  playlists: PlaylistItem[]
  videos: VideoItem[]
  selected: string
  onSelect: (id: string) => void
  onCreate: () => void
  onToggleVideo: (id: string) => void
  onDelete: (id: string) => void
}) {
  const selectedList = playlists.find((item) => item.id === selected)
  return <>
    <SectionHeading eyebrow="Pustaka" title="Daftar putar" description="Susun video tersimpan ke dalam daftar putar." action={<Button variant="primary" onClick={onCreate}><Plus className="size-4" />Daftar putar baru</Button>} />
    {playlists.length ? <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
      <Panel className="h-fit">
        <PanelTitle note={`${playlists.length} daftar putar tersimpan`}>Daftar putar Anda</PanelTitle>
        <div className="divide-y divide-zinc-100">{playlists.map((list) => <button onClick={() => onSelect(list.id)} key={list.id} className={cx('flex w-full items-center gap-3 px-4 py-4 text-left transition-colors', selected === list.id ? 'bg-blue-50/70' : 'hover:bg-zinc-50')}><div className={cx('flex size-9 items-center justify-center rounded-lg', selected === list.id ? 'bg-blue-100 text-blue-700' : 'bg-zinc-100 text-zinc-500')}><ListMusic className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-800">{list.name}</p><p className="mt-1 text-[10px] text-zinc-400">{list.videoIds.length} video</p></div><ArrowRight className="size-3.5 text-zinc-300" /></button>)}</div>
      </Panel>
      {selectedList ? <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4"><div><p className="text-sm font-semibold text-zinc-800">{selectedList.name}</p><p className="mt-1 text-xs text-zinc-400">{selectedList.description || 'Tidak ada deskripsi'} · Tersimpan</p></div><div className="flex gap-2"><Button variant="danger" onClick={() => onDelete(selectedList.id)}><Trash2 className="size-3.5" />Hapus</Button><Button href="/dashboard/player" variant="primary"><Play className="size-3.5" />Buka pemutar</Button></div></div>
        <div className="border-b border-zinc-100 bg-zinc-50/70 px-5 py-3"><p className="text-[11px] font-medium text-zinc-600">Video dalam daftar putar</p><p className="mt-1 text-[10px] text-zinc-400">Pilih video untuk menambahkan atau menghapusnya. Urutan penambahan tersimpan.</p></div>
        <div className="divide-y divide-zinc-100">{videos.map((video) => { const included = selectedList.videoIds.includes(video.id); return <button key={video.id} onClick={() => onToggleVideo(video.id)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-50"><span className={cx('flex size-5 items-center justify-center rounded border', included ? 'border-blue-600 bg-blue-600 text-white' : 'border-zinc-300 bg-white')}>{included && <Check className="size-3.5" />}</span><Film className="size-4 text-zinc-400" /><span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-700">{video.title}</span><Status>{video.status}</Status></button> })}{videos.length === 0 && <EmptyState title="Pustaka Anda kosong" description="Tambahkan video terlebih dahulu untuk memasukkannya ke daftar putar." />}</div>
      </Panel> : <Panel><EmptyState title="Pilih daftar putar" description="Pilih daftar dari sisi kiri untuk melihat videonya." /></Panel>}
    </div> : <Panel><EmptyState title="Belum ada daftar putar" description="Buat daftar putar pertama untuk mengelompokkan video tersimpan." /></Panel>}
  </>
}

type PlayerPageProps = {
  playlists: PlaylistItem[]
  activePlaylist?: PlaylistItem
  playlistVideos: VideoItem[]
  currentVideo?: VideoItem
  currentIndex: number
  onSelectPlaylist: (id: string) => void
  onSelectVideo: (index: number) => void
  onNext: () => void
  onPrevious: () => void
  preferences: PlaybackPreferences
  setPreferences: (value: PlaybackPreferences) => void
  multiView: boolean
  setMultiView: (value: boolean) => void
  selectedMultiVideos: VideoItem[]
  maxConcurrentVideos: number
  onVideoReady: (videoId: string) => void
  onVideoFinished: (videoId: string) => void
  onToggleMultiVideo: (id: string) => void
}

function PlayerPage(props: PlayerPageProps) {
  return <>
    {props.multiView ? <MultiPlayerPage {...props} /> : <SinglePlayerPage {...props} />}
    <RuntimeMonitor
      playlists={props.playlists}
      activePlaylistId={props.activePlaylist?.id ?? ''}
      autoPlayNext={props.preferences.autoPlayNext}
      loopEnabled={props.preferences.loop}
    />
  </>
}

function SinglePlayerPage({ playlists, activePlaylist, playlistVideos, currentVideo, currentIndex, onSelectPlaylist, onSelectVideo, onNext, onPrevious, preferences, setPreferences, setMultiView, onVideoReady, onVideoFinished }: PlayerPageProps) {
  const validFacebookUrl = currentVideo && (/^https:\/\/(www\.|m\.)?facebook\.com\//.test(currentVideo.url) || /^https:\/\/fb\.watch\//.test(currentVideo.url)) ? currentVideo.url : null
  return <><SectionHeading eyebrow="Pemutaran" title="Pemutar" description="Putar video yang dapat disematkan melalui pemutar resmi Facebook." action={<div className="flex items-center gap-2"><Button variant="secondary" onClick={() => setMultiView(true)}><LayoutGrid className="size-3.5" />Tampilan serentak</Button><label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-xs text-zinc-500"><ListMusic className="size-4" /><span className="sr-only">Pilih daftar putar</span><select aria-label="Pilih daftar putar" className="max-w-[170px] bg-transparent text-xs text-zinc-700 outline-none" value={activePlaylist?.id ?? ''} onChange={(e) => onSelectPlaylist(e.target.value)}>{playlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,.8fr)]"><div className="min-w-0"><Panel className="overflow-hidden"><div className="relative flex aspect-video items-center justify-center bg-[#101114]">{validFacebookUrl ? <FacebookVideoEmbed
      key={currentVideo?.id}
      url={validFacebookUrl}
      title={currentVideo?.title ?? 'video'}
      autoPlay={preferences.autoPlay}
      muted={preferences.muted}
      width={1280}
      onReady={() => { if (currentVideo) onVideoReady(currentVideo.id) }}
      onFinished={(player) => {
        if (currentVideo) onVideoFinished(currentVideo.id)
        handlePlaybackFinished({
          autoPlayNext: preferences.autoPlayNext,
          loop: preferences.loop,
          currentIndex,
          playlistLength: playlistVideos.length,
          replayCurrent: () => {
            player.seek(0)
            player.play()
          },
          playNext: onNext,
          restartPlaylist: () => onSelectVideo(0),
        })
      }}
    /> : <div className="px-6 text-center text-white"><Film className="mx-auto mb-3 size-8 text-zinc-500" /><p className="text-sm font-medium">{currentVideo ? 'Tautan ini perlu diperiksa sebelum disematkan di Facebook' : 'Pilih video untuk memulai'}</p><p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-zinc-400">Privasi video dan pengaturan penerbit menentukan apakah Facebook mengizinkan sematan ini diputar.</p></div>}</div><div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3.5"><div className="min-w-0"><p className="truncate text-xs font-semibold text-zinc-800">{currentVideo?.title ?? 'Belum ada video yang dipilih'}</p><p className="mt-1 text-[10px] text-zinc-400">{activePlaylist?.name ?? 'Belum ada daftar putar'} · {playlistVideos.length ? `${currentIndex + 1} dari ${playlistVideos.length}` : '0 video'}</p></div><div className="flex items-center gap-1"><Button variant="quiet" disabled={currentIndex === 0} onClick={onPrevious}><SkipBack className="size-4" /><span className="sr-only">Video sebelumnya</span></Button><Button variant="quiet" disabled={currentIndex >= playlistVideos.length - 1} onClick={onNext}><SkipForward className="size-4" /><span className="sr-only">Video berikutnya</span></Button></div></div></Panel>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-[11px] leading-5 text-blue-800"><CircleHelp className="mt-0.5 size-3.5 shrink-0" /><p>Putar otomatis, perpindahan antar-Reel, dan pengulangan menggunakan peristiwa dari pemutar Facebook. Pengaturan privasi Facebook, kebijakan peramban, atau sematan yang diblokir dapat menghambat fitur ini.</p></div></div>
      <div className="flex min-w-0 flex-col gap-4"><Panel className="flex min-h-[355px] flex-1 flex-col">      <PanelTitle note={`${playlistVideos.length} video · urutan tersimpan`} action={<span className="text-[10px] text-zinc-400">{activePlaylist?.name ?? 'Daftar putar'}</span>}>Antrian</PanelTitle><div className="flex-1 divide-y divide-zinc-100 overflow-y-auto">{playlistVideos.map((video, index) => <button key={video.id} onClick={() => onSelectVideo(index)} className={cx('flex w-full items-center gap-3 px-4 py-3.5 text-left', currentIndex === index ? 'bg-blue-50/60' : 'hover:bg-zinc-50')}><span className={cx('flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-medium', currentIndex === index ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-500')}>{index + 1}</span><span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-700">{video.title}</span>{currentIndex === index && <span className="text-[9px] font-medium uppercase tracking-wider text-blue-600">Terpilih</span>}</button>)}{!playlistVideos.length && <EmptyState title="Daftar putar ini masih kosong" description="Tambahkan video dari pustaka." />}</div></Panel>
      <Panel><PanelTitle>Preferensi pemutaran <span className="ml-1 text-[10px] font-normal text-zinc-400">· tersimpan</span></PanelTitle><div className="divide-y divide-zinc-100 px-4">{[{ key: 'autoPlay' as const, label: 'Putar otomatis Reel ini', description: 'Mulai tanpa suara jika diizinkan oleh Facebook dan peramban.' }, { key: 'autoPlayNext' as const, label: 'Lanjut otomatis ke Reel berikutnya', description: 'Beralih ke Reel berikutnya setelah pemutaran selesai.' }, { key: 'loop' as const, label: 'Ulangi daftar putar', description: 'Mulai kembali dari awal setelah Reel terakhir.' }].map((item) => <label key={item.key} className="flex cursor-pointer items-center justify-between gap-3 py-3"><span><span className="block text-xs font-medium text-zinc-700">{item.label}</span><span className="mt-0.5 block text-[10px] text-zinc-400">{item.description}</span></span><input type="checkbox" checked={preferences[item.key]} onChange={(e) => setPreferences({ ...preferences, [item.key]: e.target.checked })} className="size-4 accent-blue-600" /></label>)}</div></Panel></div></div>
  </>
}

function MultiPlayerPage({ playlists, activePlaylist, playlistVideos, currentIndex, onSelectPlaylist, onSelectVideo, preferences, setPreferences, setMultiView, selectedMultiVideos, maxConcurrentVideos, onToggleMultiVideo }: PlayerPageProps) {
  const selectedIds = new Set(selectedMultiVideos.map((video) => video.id))

  return <>
    <SectionHeading
      eyebrow="Pemutaran"
      title="Tampilan serentak"
      description="Pilih beberapa Reel untuk diputar bersamaan melalui kontrol pemutar Facebook masing-masing."
      action={<div className="flex items-center gap-2">
        <Button variant="secondary" onClick={() => setMultiView(false)}><Play className="size-3.5" />Pemutar tunggal</Button>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-xs text-zinc-500">
          <ListMusic className="size-4" />
          <span className="sr-only">Pilih daftar putar</span>
          <select aria-label="Pilih daftar putar" className="max-w-[170px] bg-transparent text-xs text-zinc-700 outline-none" value={activePlaylist?.id ?? ''} onChange={(e) => onSelectPlaylist(e.target.value)}>
            {playlists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      </div>}
    />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,.8fr)]">
      <div className="min-w-0">
        {selectedMultiVideos.length ? <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {selectedMultiVideos.map((video) => {
            const validUrl = /^https:\/\/(www\.|m\.)?facebook\.com\//.test(video.url) || /^https:\/\/fb\.watch\//.test(video.url)
            return <Panel key={video.id} className="overflow-hidden">
              <div className="relative aspect-video bg-[#101114]">
                {validUrl ? <FacebookVideoEmbed
                  key={video.id}
                  url={video.url}
                  title={video.title}
                  autoPlay={preferences.autoPlay}
                  muted={preferences.muted}
                  width={720}
                  onFinished={preferences.loop ? (player) => {
                    player.seek(0)
                    player.play()
                  } : undefined}
                /> : <div className="flex h-full items-center justify-center px-5 text-center text-xs text-zinc-300">Tautan ini perlu diperiksa sebelum disematkan di Facebook.</div>}
              </div>
              <p className="truncate px-3 py-2.5 text-xs font-medium text-zinc-700">{video.title}</p>
            </Panel>
          })}
        </div> : <Panel><EmptyState title="Pilih Reel untuk diputar" description="Pilih video dari daftar. Setiap Reel terpilih akan memiliki pemutarnya sendiri." /></Panel>}
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-[11px] leading-5 text-blue-800">
          <CircleHelp className="mt-0.5 size-3.5 shrink-0" />
          <p>Reel terpilih dimulai bersamaan dan diputar ulang setelah selesai. Facebook dapat membatasi pemutaran otomatis, terutama di perangkat seluler; jika diizinkan, suara akan dibisukan.</p>
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        <Panel className="flex min-h-[355px] flex-1 flex-col">
          <PanelTitle note={`${selectedMultiVideos.length} dari ${maxConcurrentVideos} terpilih · ${playlistVideos.length} dalam daftar putar`} action={<span className="text-[10px] text-zinc-400">{activePlaylist?.name ?? 'Daftar putar'}</span>}>Reel yang diputar bersamaan</PanelTitle>
          <div className="flex-1 divide-y divide-zinc-100 overflow-y-auto">
            {playlistVideos.map((video, index) => {
              const selected = selectedIds.has(video.id)
              const atLimit = !selected && selectedMultiVideos.length >= maxConcurrentVideos
              return <div key={video.id} className="flex items-center gap-2 px-4 py-3.5 hover:bg-zinc-50">
                <button onClick={() => onSelectVideo(index)} className={cx('flex min-w-0 flex-1 items-center gap-3 text-left', currentIndex === index && 'text-blue-700')}>
                  <span className={cx('flex size-7 shrink-0 items-center justify-center rounded-md text-[10px] font-medium', currentIndex === index ? 'bg-blue-600 text-white' : 'bg-zinc-100 text-zinc-500')}>{index + 1}</span>
                  <span className="truncate text-xs font-medium text-zinc-700">{video.title}</span>
                </button>
                <label className="flex shrink-0 items-center gap-2 text-[10px] text-zinc-500">
                  <input
                    type="checkbox"
                    aria-label={`Sertakan ${video.title} dalam tampilan serentak`}
                    checked={selected}
                    disabled={atLimit}
                    onChange={() => onToggleMultiVideo(video.id)}
                    className="size-4 accent-blue-600"
                  />
                  <span className="sr-only">Sertakan dalam tampilan serentak</span>
                </label>
              </div>
            })}
            {!playlistVideos.length && <EmptyState title="Daftar putar ini masih kosong" description="Tambahkan video ke daftar putar sebelum memulai tampilan serentak." />}
          </div>
        </Panel>
        <Panel>
          <PanelTitle>Preferensi pemutaran <span className="ml-1 text-[10px] font-normal text-zinc-400">· tersimpan</span></PanelTitle>
          <div className="divide-y divide-zinc-100 px-4">
            {[
              { key: 'autoPlay' as const, label: 'Putar otomatis Reel terpilih' },
              { key: 'loop' as const, label: 'Putar ulang Reel terus-menerus' },
            ].map((item) => <label key={item.key} className="flex cursor-pointer items-center justify-between gap-3 py-3">
              <span className="text-xs font-medium text-zinc-700">{item.label}</span>
              <input type="checkbox" checked={preferences[item.key]} onChange={(e) => setPreferences({ ...preferences, [item.key]: e.target.checked })} className="size-4 accent-blue-600" />
            </label>)}
          </div>
        </Panel>
      </div>
    </div>
  </>
}

function HistoryPage({ activities }: { activities: PlaybackActivity[] }) {
  return <><SectionHeading eyebrow="Wawasan" title="Riwayat pemutaran" description="Event yang diamati oleh aplikasi, bukan analitik tayangan Facebook." /><Panel><PanelTitle note={`${activities.length} event terakhir tersimpan`}>Aktivitas terbaru</PanelTitle>{activities.length ? <div className="divide-y divide-zinc-100">{activities.map((activity) => <div key={activity.id} className="flex flex-wrap items-center gap-3 px-5 py-4"><Activity className="size-4 text-zinc-400" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-zinc-800">{activityLabels[activity.eventType] ?? activity.eventType} · {activity.videoTitle}</p><p className="mt-1 truncate text-[11px] text-zinc-400">{activity.playlistName}</p></div><time className="text-[11px] text-zinc-500" dateTime={activity.createdAt}>{new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(activity.createdAt))}</time></div>)}</div> : <EmptyState title="Belum ada aktivitas pemutaran" description="Event yang didukung akan muncul di sini saat pemutar mengamatinya. Tidak ada statistik Facebook yang diperkirakan." />}</Panel></>
}
function SettingsPage({ preferences, setPreferences, admin, appSettings }: { preferences: PlaybackPreferences; setPreferences: (value: PlaybackPreferences) => void; admin: { name: string; email: string }; appSettings: { appName: string; timezone: string } }) {
  return <>
    <SectionHeading
      eyebrow="Preferensi"
      title="Pengaturan"
      description="Preferensi pemutaran tersimpan di PostgreSQL."
      action={<Button variant="secondary" onClick={() => setPreferences({ autoPlay: false, autoPlayNext: false, loop: false, shuffle: false, muted: true, maxConcurrent: 20 })}><Check className="size-3.5" />Atur ulang preferensi</Button>}
    />
    <div className="grid gap-5 xl:grid-cols-[1fr_310px]">
      <div className="space-y-5">
        <Panel>
          <PanelTitle note="Perubahan disimpan otomatis.">Preferensi pemutaran</PanelTitle>
          <div className="divide-y divide-zinc-100 px-5">
            {[
              { key: 'autoPlay' as const, label: 'Putar Reel otomatis', desc: 'Mulai sematan terpilih secara otomatis; suara dibisukan dan pemutaran otomatis dapat dibatasi oleh peramban atau Facebook.' },
              { key: 'autoPlayNext' as const, label: 'Lanjut otomatis ke Reel berikutnya', desc: 'Beralih ke Reel berikutnya setelah video selesai.' },
              { key: 'loop' as const, label: 'Ulangi pemutaran', desc: 'Ulangi setiap Reel terpilih dalam tampilan serentak, atau mulai ulang daftar putar setelah item terakhir.' },
              { key: 'shuffle' as const, label: 'Acak daftar putar', desc: 'Putar item dalam urutan acak.' },
              { key: 'muted' as const, label: 'Mulai dengan suara dibisukan', desc: 'Patuhi kebijakan pemutaran otomatis peramban dan penerbit.' },
            ].map((pref) => <label key={pref.key} className="flex cursor-pointer items-center justify-between gap-4 py-4">
              <span><span className="block text-xs font-medium text-zinc-700">{pref.label}</span><span className="mt-1 block text-[11px] text-zinc-400">{pref.desc}</span></span>
              <input type="checkbox" className="size-4 accent-blue-600" checked={preferences[pref.key]} onChange={(e) => setPreferences({ ...preferences, [pref.key]: e.target.checked })} />
            </label>)}
          </div>
        </Panel>
        <Panel>
          <PanelTitle note="Batas ini disimpan untuk sesi berikutnya.">Pemutaran serentak</PanelTitle>
          <div className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <label htmlFor="max-concurrent-reels" className="text-xs font-medium text-zinc-700">Jumlah maksimum Reel bersamaan</label>
              <p className="mt-1 text-[11px] text-zinc-400">Atur batas 2–50 sematan; pemutaran dan beban sistem bergantung pada Facebook dan peramban Anda.</p>
            </div>
            <select
              id="max-concurrent-reels"
              aria-label="Jumlah maksimum Reel bersamaan"
              value={preferences.maxConcurrent}
              onChange={(e) => setPreferences({ ...preferences, maxConcurrent: Number(e.target.value) })}
              className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs text-zinc-700"
            >
              {concurrentPlaybackOptions.map((count) => <option key={count} value={count}>{count} Reel</option>)}
            </select>
          </div>
        </Panel>
        <Panel>
          <PanelTitle note="Pengaturan aplikasi.">Aplikasi</PanelTitle>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <label className="text-xs font-medium text-zinc-600">Nama aplikasi<input value={appSettings.appName} readOnly className="mt-2 block h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-500" /></label>
            <label className="text-xs font-medium text-zinc-600">Zona waktu<input value={appSettings.timezone} readOnly className="mt-2 block h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs text-zinc-500" /></label>
          </div>
        </Panel>
      </div>
      <Panel className="h-fit">
        <PanelTitle>Akun</PanelTitle>
        <div className="p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold text-zinc-500">AD</div>
            <div><p className="text-xs font-medium text-zinc-700">{admin.name}</p><p className="mt-1 text-[11px] text-zinc-400">{admin.email}</p></div>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-[11px] font-semibold text-emerald-900">Sesi administrator aktif</p>
            <p className="mt-1 text-[10px] leading-4 text-emerald-800">Kredensial login dikelola melalui variabel lingkungan server.</p>
          </div>
          <form action={logoutAction} className="mt-4"><button type="submit" className="text-xs font-medium text-zinc-600 hover:text-zinc-900">Keluar</button></form>
        </div>
      </Panel>
    </div>
  </>
}
function Dialog({ title, onClose, onSubmit, error, kind }: { title: string; onClose: () => void; onSubmit: (form: FormData) => void | Promise<void>; error: string; kind: 'video' | 'playlist' }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}><div role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl"><div className="flex items-start justify-between"><div><h2 id="dialog-title" className="text-base font-semibold text-zinc-900">{title}</h2><p className="mt-1 text-xs text-zinc-500">Perubahan disimpan ke PostgreSQL.</p></div><button onClick={onClose} aria-label="Tutup dialog" className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100"><X className="size-4" /></button></div><form action={onSubmit} className="mt-5 flex flex-col gap-4">{kind === 'video' ? <><label className="text-xs font-medium text-zinc-700">URL video Facebook <span className="text-red-500">*</span><input name="url" type="url" required placeholder="https://www.facebook.com/watch/?v=…" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label><label className="text-xs font-medium text-zinc-700">Judul <span className="font-normal text-zinc-400">(opsional)</span><input name="title" maxLength={120} placeholder="Beri nama untuk video ini" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label></> : <><label className="text-xs font-medium text-zinc-700">Nama daftar putar<input name="name" required maxLength={80} placeholder="Contoh: Sorotan proyek" className="mt-2 h-10 w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label><label className="text-xs font-medium text-zinc-700">Deskripsi <span className="font-normal text-zinc-400">(opsional)</span><textarea name="description" rows={3} maxLength={240} placeholder="Apa saja isi daftar putar ini?" className="mt-2 w-full resize-none rounded-lg border border-zinc-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label></>}{error && <p role="alert" className="text-xs text-red-600">{error}</p>}<div className="mt-1 flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Batal</Button><button type="submit" className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-[13px] font-medium text-white hover:bg-blue-700">{kind === 'video' ? <Plus className="size-4" /> : <FolderPlus className="size-4" />}{kind === 'video' ? 'Tambah video' : 'Buat daftar putar'}</button></div></form></div></div>
}
