type PlaybackFinishOptions = {
  autoPlayNext: boolean
  loop: boolean
  currentIndex: number
  playlistLength: number
  replayCurrent: () => void
  playNext: () => void
  restartPlaylist: () => void
}

export function handlePlaybackFinished({
  autoPlayNext,
  loop,
  currentIndex,
  playlistLength,
  replayCurrent,
  playNext,
  restartPlaylist,
}: PlaybackFinishOptions) {
  if (!autoPlayNext) {
    if (loop) replayCurrent()
    return
  }

  if (currentIndex < playlistLength - 1) {
    playNext()
    return
  }

  if (!loop || playlistLength === 0) return
  if (currentIndex === 0) replayCurrent()
  else restartPlaylist()
}
