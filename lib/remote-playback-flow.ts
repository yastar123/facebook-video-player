export function getNextRemotePlaybackIndex(
  currentIndex: number,
  playlistLength: number,
  autoPlayNext = true,
  loop = false,
): number | null {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(playlistLength) || playlistLength <= 0) return null
  if (currentIndex < 0 || currentIndex >= playlistLength) return null
  if (!autoPlayNext) return loop ? currentIndex : null
  const nextIndex = currentIndex + 1
  if (nextIndex < playlistLength) return nextIndex
  return loop ? 0 : null
}

export function hasRemotePlaybackProgressed(previousPosition: number | null, currentPosition: number): boolean {
  return previousPosition !== null
    && Number.isFinite(previousPosition)
    && Number.isFinite(currentPosition)
    && currentPosition > previousPosition + 0.25
}
