'use client'

import { useEffect, useId, useRef, useState } from 'react'

type FacebookVideoPlayer = {
  play: () => void
  mute: () => void
  unmute: () => void
  seek: (seconds: number) => void
  subscribe: (event: 'finishedPlaying', callback: () => void) => { removeListener?: (event: string) => void } | void
}

type FacebookSdk = {
  init: (options: { xfbml: boolean; version: string }) => void
  XFBML: { parse: (element?: HTMLElement) => void }
  Event: {
    subscribe: (event: 'xfbml.ready', callback: (message: { type: string; id: string; instance: FacebookVideoPlayer }) => void) => void
    unsubscribe?: (event: 'xfbml.ready', callback: (message: { type: string; id: string; instance: FacebookVideoPlayer }) => void) => void
  }
}

declare global {
  interface Window {
    FB?: FacebookSdk
    fbAsyncInit?: () => void
  }
}

let facebookSdkPromise: Promise<FacebookSdk> | null = null
let facebookSdkInitialized = false

function initializeFacebookSdk(sdk: FacebookSdk) {
  if (!facebookSdkInitialized) {
    sdk.init({ xfbml: true, version: 'v3.2' })
    facebookSdkInitialized = true
  }
  return sdk
}

function loadFacebookSdk(): Promise<FacebookSdk> {
  if (window.FB) {
    try {
      return Promise.resolve(initializeFacebookSdk(window.FB))
    } catch (error) {
      return Promise.reject(error)
    }
  }
  if (facebookSdkPromise) return facebookSdkPromise

  facebookSdkPromise = new Promise<FacebookSdk>((resolve, reject) => {
    let settled = false
    const complete = () => {
      if (settled) return
      const sdk = window.FB
      if (!sdk) {
        settled = true
        reject(new Error('SDK JavaScript Facebook gagal diinisialisasi.'))
        return
      }

      try {
        initializeFacebookSdk(sdk)
        settled = true
        resolve(sdk)
      } catch (error) {
        settled = true
        reject(error)
      }
    }

    window.fbAsyncInit = complete
    let script = document.getElementById('facebook-jssdk') as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = 'facebook-jssdk'
      script.async = true
      script.defer = true
      script.src = 'https://connect.facebook.net/id_ID/sdk.js#xfbml=1&version=v3.2'
    }
    script.addEventListener('load', complete, { once: true })
    script.addEventListener('error', () => {
      if (settled) return
      settled = true
      reject(new Error('Tidak dapat memuat SDK JavaScript Facebook.'))
    }, { once: true })
    if (!script.parentNode) document.head.appendChild(script)
  }).catch((error: unknown) => {
    facebookSdkPromise = null
    throw error
  })

  return facebookSdkPromise
}

type FacebookVideoEmbedProps = {
  url: string
  title: string
  autoPlay: boolean
  muted: boolean
  width: number
  onFinished?: (player: FacebookVideoPlayer) => void
}

export function FacebookVideoEmbed({ url, title, autoPlay, muted, width, onFinished }: FacebookVideoEmbedProps) {
  const generatedId = useId().replace(/:/g, '')
  const playerId = `facebook-video-${generatedId}`
  const containerRef = useRef<HTMLDivElement>(null)
  const playerRef = useRef<FacebookVideoPlayer | null>(null)
  const onFinishedRef = useRef(onFinished)
  const optionsRef = useRef({ autoPlay, muted })
  const [error, setError] = useState('')

  useEffect(() => {
    onFinishedRef.current = onFinished
    optionsRef.current = { autoPlay, muted }
  }, [autoPlay, muted, onFinished])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let active = true
    let sdk: FacebookSdk | undefined
    let readyHandler: ((message: { type: string; id: string; instance: FacebookVideoPlayer }) => void) | undefined
    let finishedSubscription: ReturnType<FacebookVideoPlayer['subscribe']>

    loadFacebookSdk().then((facebookSdk) => {
      if (!active) return
      sdk = facebookSdk
      const plugin = document.createElement('div')
      plugin.id = playerId
      plugin.className = 'fb-video'
      plugin.setAttribute('data-href', url)
      plugin.setAttribute('data-allowfullscreen', 'true')
      plugin.setAttribute('data-autoplay', optionsRef.current.autoPlay ? 'true' : 'false')
      plugin.setAttribute('data-show-text', 'false')
      plugin.setAttribute('data-width', String(width))

      const ignoredMarkup = document.createElement('div')
      ignoredMarkup.className = 'fb-xfbml-parse-ignore'
      const blockquote = document.createElement('blockquote')
      blockquote.cite = url
      const link = document.createElement('a')
      link.href = url
      link.textContent = title
      blockquote.appendChild(link)
      ignoredMarkup.appendChild(blockquote)
      plugin.appendChild(ignoredMarkup)
      container.replaceChildren(plugin)

      readyHandler = (message) => {
        if (!active || message.type !== 'video' || message.id !== playerId) return
        const player = message.instance
        playerRef.current = player
        finishedSubscription = player.subscribe('finishedPlaying', () => onFinishedRef.current?.(player))
        if (optionsRef.current.autoPlay) {
          if (optionsRef.current.muted) player.mute()
          else player.unmute()
          player.play()
        }
      }
      facebookSdk.Event.subscribe('xfbml.ready', readyHandler)
      facebookSdk.XFBML.parse(document.body)
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Pemutar Facebook gagal disiapkan.')
    })

    return () => {
      active = false
      if (sdk && readyHandler) sdk.Event.unsubscribe?.('xfbml.ready', readyHandler)
      finishedSubscription?.removeListener?.('finishedPlaying')
      playerRef.current = null
    }
  }, [playerId, title, url, width])

  useEffect(() => {
    const player = playerRef.current
    if (!player || !autoPlay) return
    if (muted) player.mute()
    else player.unmute()
    player.play()
  }, [autoPlay, muted])

  return (
    <div className="relative size-full">
      <div ref={containerRef} className="size-full" />
      {error && <p role="alert" className="absolute inset-0 flex items-center justify-center bg-[#101114] p-3 text-xs text-white">{error}</p>}
    </div>
  )
}
