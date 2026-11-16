'use client'

import { useCallback, useEffect, useState } from 'react'
import { Activity, CircleHelp, Clock3, Monitor, Play, RefreshCw, Server, Square } from 'lucide-react'
import type { RemoteRuntimeSnapshot, RuntimeCommand } from '@/lib/runtime-types'

type RuntimeAction = RuntimeCommand | 'health'

function formatDuration(seconds: number | null) {
  if (seconds === null) return '—'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  const remainder = seconds % 60
  return days ? `${days} hari ${hours} jam` : `${hours}j ${minutes}m ${remainder}d`
}

function formatDate(value: string | null) {
  if (!value) return 'Belum tersedia'
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value))
}

function stateLabel(value: string) {
  const labels: Record<string, string> = {
    STARTING: 'Memulai',
    ONLINE: 'Online',
    STOPPING: 'Menghentikan',
    OFFLINE: 'Offline',
    ERROR: 'Error',
    CLOSED: 'Tertutup',
    OPEN: 'Terbuka',
    CRASHED: 'Crash',
    UNKNOWN: 'Tidak diketahui',
  }
  return labels[value] ?? value
}

function stateTone(value: string) {
  if (value === 'ONLINE' || value === 'OPEN') return 'bg-emerald-50 text-emerald-700 ring-emerald-600/15'
  if (value === 'STARTING' || value === 'STOPPING') return 'bg-amber-50 text-amber-700 ring-amber-600/15'
  if (value === 'CRASHED' || value === 'ERROR') return 'bg-red-50 text-red-700 ring-red-600/15'
  return 'bg-zinc-100 text-zinc-600 ring-zinc-500/10'
}

function StateBadge({ value }: { value: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ring-1 ring-inset ${stateTone(value)}`}><span className="size-1.5 rounded-full bg-current opacity-70" />{stateLabel(value)}</span>
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="flex min-w-0 items-start gap-2.5">
    <span className="mt-0.5 text-zinc-400">{icon}</span>
    <div className="min-w-0">
      <p className="text-[10px] font-medium text-zinc-400">{label}</p>
      <p className="mt-1 truncate text-xs font-medium text-zinc-700">{value}</p>
    </div>
  </div>
}

export function RuntimeMonitor() {
  const [snapshot, setSnapshot] = useState<RemoteRuntimeSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<RuntimeAction | null>(null)
  const [requestError, setRequestError] = useState('')
  const [notice, setNotice] = useState('')

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/runtime', { cache: 'no-store' })
      const result = await response.json() as RemoteRuntimeSnapshot & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Status runtime tidak dapat dimuat.')
      setSnapshot(result)
      setRequestError('')
      return true
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Status runtime tidak dapat dimuat.')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      if (active) await refresh()
      if (active) timer = setTimeout(poll, 10_000)
    }
    void poll()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [refresh])

  async function runAction(action: RuntimeAction) {
    setPending(action)
    setRequestError('')
    setNotice('')
    try {
      if (action === 'health') {
        if (await refresh()) setNotice('Pemeriksaan runtime selesai.')
        return
      }

      const response = await fetch('/api/admin/runtime', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: action }),
      })
      const result = await response.json() as RemoteRuntimeSnapshot & { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Perintah runtime gagal.')
      setSnapshot(result)
      setNotice(action === 'start' ? 'Chromium berhasil dijalankan.' : action === 'stop' ? 'Chromium berhasil dihentikan.' : 'Chromium berhasil dimulai ulang.')
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Perintah runtime gagal.')
    } finally {
      setPending(null)
      if (action !== 'health') await refresh()
    }
  }

  const browserStatus = snapshot?.browserStatus ?? 'UNKNOWN'

  return <section className="mb-6 rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(20,20,30,.025)]">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
      <div>
        <div className="flex items-center gap-2">
          <Server className="size-4 text-zinc-400" />
          <h2 className="text-[13px] font-semibold text-zinc-800">Remote Browser Runtime</h2>
        </div>
        <p className="mt-1 text-xs text-zinc-400">Proses terpisah di VPS; tetap berjalan saat dashboard administrator ditutup.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending !== null || !snapshot?.serviceConnected || browserStatus === 'OPEN'} onClick={() => void runAction('start')} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
          <Play className="size-3.5" />{pending === 'start' ? 'Memulai…' : 'Start'}
        </button>
        <button type="button" disabled={pending !== null || !snapshot?.serviceConnected || browserStatus === 'CLOSED'} onClick={() => void runAction('stop')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
          <Square className="size-3.5" />{pending === 'stop' ? 'Menghentikan…' : 'Stop'}
        </button>
        <button type="button" disabled={pending !== null || !snapshot?.serviceConnected} onClick={() => void runAction('restart')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50">
          <RefreshCw className="size-3.5" />{pending === 'restart' ? 'Memulai ulang…' : 'Restart'}
        </button>
        <button type="button" disabled={pending !== null} onClick={() => void runAction('health')} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50">
          <Activity className="size-3.5" />{pending === 'health' ? 'Memeriksa…' : 'Health check'}
        </button>
      </div>
    </div>

    <div className="grid gap-5 p-5 sm:grid-cols-2 xl:grid-cols-4">
      <div className="flex items-center justify-between gap-3">
        <Metric label="Runtime service" value={loading ? 'Memuat…' : stateLabel(snapshot?.runtimeStatus ?? 'OFFLINE')} icon={<Server className="size-4" />} />
        <StateBadge value={snapshot?.runtimeStatus ?? 'OFFLINE'} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Metric label="Status Chromium" value={stateLabel(browserStatus)} icon={<Monitor className="size-4" />} />
        <StateBadge value={browserStatus} />
      </div>
      <Metric label="Versi Chromium" value={snapshot?.chromiumVersion ?? 'Belum tersedia'} icon={<Monitor className="size-4" />} />
      <Metric label="Uptime runtime" value={formatDuration(snapshot?.uptimeSeconds ?? null)} icon={<Clock3 className="size-4" />} />
      <Metric label="Heartbeat terakhir" value={formatDate(snapshot?.lastHeartbeatAt ?? null)} icon={<Activity className="size-4" />} />
      <Metric label="Halaman browser" value={snapshot?.currentPage ?? 'Tidak ada halaman'} icon={<Monitor className="size-4" />} />
      <Metric label="Embed Facebook runtime" value="Tidak dimuat" icon={<CircleHelp className="size-4" />} />
      <Metric label="Playback runtime" value="Tidak teramati" icon={<CircleHelp className="size-4" />} />
    </div>

    <div className="border-t border-zinc-100 px-5 py-3">
      <p className="text-[11px] leading-5 text-zinc-500">
        Chromium runtime hanya dibuka pada halaman kosong untuk health/diagnostik. Runtime ini tidak memulai embed, autoplay, atau mencatat playback; pemutar Facebook yang ada tetap berjalan terpisah di browser dashboard dan event hanya dicatat bila benar-benar diamati.
      </p>
    </div>

    {(requestError || snapshot?.lastError || notice) && <div className="border-t border-zinc-100 px-5 py-3">
      {requestError && <p role="alert" className="text-xs text-red-700">{requestError}</p>}
      {!requestError && snapshot?.lastError && <p className="text-xs text-red-700">Error terakhir: {snapshot.lastError}</p>}
      {notice && <p role="status" className="text-xs text-emerald-700">{notice}</p>}
    </div>}

    {snapshot?.logs.length ? <div className="border-t border-zinc-100">
      <p className="px-5 pt-3 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Log runtime terbaru</p>
      <ul className="divide-y divide-zinc-100">
        {snapshot.logs.slice(0, 5).map((log) => <li key={log.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2 text-[11px]">
          <time className="shrink-0 text-zinc-400" dateTime={log.createdAt}>{formatDate(log.createdAt)}</time>
          <span className={log.level === 'ERROR' ? 'font-medium text-red-700' : 'font-medium text-zinc-600'}>{log.event}</span>
          <span className="min-w-0 text-zinc-500">{log.message}</span>
        </li>)}
      </ul>
    </div> : null}
  </section>
}
