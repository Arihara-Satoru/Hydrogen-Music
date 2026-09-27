import assert from 'node:assert/strict'
import { selectSongRange } from '../src/utils/songSelection.mjs'

const rows = Array.from({ length: 165 }, (_, index) => ({ rowKey: `song-${index}` }))
assert.deepEqual([...selectSongRange(rows, 3, 5)], ['song-3', 'song-4', 'song-5'])
assert.deepEqual([...selectSongRange(rows, 105, 102, ['song-1'])], ['song-1', 'song-102', 'song-103', 'song-104', 'song-105'])
assert.deepEqual([...selectSongRange(rows, 164, 170)], ['song-164'])
console.log('song selection range checks passed')
