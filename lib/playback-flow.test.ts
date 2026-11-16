import assert from 'node:assert/strict'
import test from 'node:test'
import { handlePlaybackFinished } from './playback-flow'

test('replays a one-video playlist when auto-next and loop are enabled', () => {
  const calls: string[] = []

  handlePlaybackFinished({
    autoPlayNext: true,
    loop: true,
    currentIndex: 0,
    playlistLength: 1,
    replayCurrent: () => calls.push('replay'),
    playNext: () => calls.push('next'),
    restartPlaylist: () => calls.push('restart'),
  })

  assert.deepEqual(calls, ['replay'])
})

test('advances to the next video before reaching the end of a looping playlist', () => {
  const calls: string[] = []

  handlePlaybackFinished({
    autoPlayNext: true,
    loop: true,
    currentIndex: 0,
    playlistLength: 2,
    replayCurrent: () => calls.push('replay'),
    playNext: () => calls.push('next'),
    restartPlaylist: () => calls.push('restart'),
  })

  assert.deepEqual(calls, ['next'])
})

test('restarts a multi-video playlist after its last video', () => {
  const calls: string[] = []

  handlePlaybackFinished({
    autoPlayNext: true,
    loop: true,
    currentIndex: 1,
    playlistLength: 2,
    replayCurrent: () => calls.push('replay'),
    playNext: () => calls.push('next'),
    restartPlaylist: () => calls.push('restart'),
  })

  assert.deepEqual(calls, ['restart'])
})
