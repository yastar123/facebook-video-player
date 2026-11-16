export type RuntimeProcessState = 'STARTING' | 'ONLINE' | 'STOPPING' | 'OFFLINE' | 'ERROR'
export type RemoteBrowserState = 'CLOSED' | 'STARTING' | 'OPEN' | 'CRASHED' | 'UNKNOWN'
export type RuntimeCommand = 'start' | 'stop' | 'restart'

export type RuntimeLogEntry = {
  id: string
  level: string
  event: string
  message: string
  createdAt: string
}

export type RemoteRuntimeSnapshot = {
  serviceConnected: boolean
  runtimeStatus: RuntimeProcessState
  browserStatus: RemoteBrowserState
  lastKnownBrowserStatus: Exclude<RemoteBrowserState, 'UNKNOWN'> | null
  chromiumVersion: string | null
  uptimeSeconds: number | null
  processStartedAt: string | null
  browserStartedAt: string | null
  lastHeartbeatAt: string | null
  currentPage: string | null
  embedStatus: 'NOT_LOADED'
  playbackStatus: 'NOT_OBSERVED'
  lastError: string | null
  logs: RuntimeLogEntry[]
}
