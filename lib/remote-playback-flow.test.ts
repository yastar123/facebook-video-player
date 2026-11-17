import assert from 'node:assert/strict'
import test from 'node:test'
import { getNextRemotePlaybackIndex } from './remote-playback-flow.ts'

test('advances remote playback in playlist order', () => {
  assert.equal(getNextRemotePlaybackIndex(0, 3), 1)
  assert.equal(getNextRemotePlaybackIndex(1, 3), 2)
})

test('stops after the last item when repeat is disabled', () => {
  assert.equal(getNextRemotePlaybackIndex(2, 3), null)
  assert.equal(getNextRemotePlaybackIndex(0, 1), null)
})

test('repeats a playlist from its first item when enabled', () => {
  assert.equal(getNextRemotePlaybackIndex(2, 3, true, true), 0)
  assert.equal(getNextRemotePlaybackIndex(0, 1, true, true), 0)
})

test('repeats only the current item when auto-next is disabled', () => {
  assert.equal(getNextRemotePlaybackIndex(1, 3, false, true), 1)
  assert.equal(getNextRemotePlaybackIndex(1, 3, false, false), null)
})

test('rejects invalid playlist positions', () => {
  assert.equal(getNextRemotePlaybackIndex(-1, 3), null)
  assert.equal(getNextRemotePlaybackIndex(0, 0), null)
  assert.equal(getNextRemotePlaybackIndex(3, 3), null)
})
