import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createPlaylistAddition, playlistAdditionNotice } from '../src/utils/playlistAddition.mjs'

// Mock-only: no real playlist reads or mutations.
let account = 'a', now = 1000, loaded = null, reads = 0, writes = []
let response = { status: 1, data: { info: [] } }
let songs = [], read = async () => ({ complete: true, songs })
const keys = song => [song?.id, song?.mixsongid, song?.hash?.toLowerCase(), ...(song?.favoriteLikeKeys || [])].filter(Boolean).map(String)
const create = () => createPlaylistAddition({
  getAccountId: () => account, now: () => now,
  extractKeys: keys, isSuccess: result => result.status === 1,
  getLoadedSongs: () => loaded,
  getPlaylistAll: async params => { reads++; return read(params) },
  updatePlaylist: async params => { writes.push(params); return response },
})
const playlist = { id: 'collection', list_create_listid: 2, name: '我喜欢' }
const existing = { id: 42, hash: 'ABC', fileid: 10 }
const fresh = { id: 43, hash: 'DEF', name: '新歌', fileid: 99 }
let addition = create()
songs = [existing]
let outcome = await addition.add(playlist, [{ id: 142, hash: 'abc' }])
assert.equal(outcome.skipped, 1)
assert.equal(writes.length, 0, 'duplicate songs must never be written')
assert.equal(playlistAdditionNotice(outcome, playlist.name), '歌曲已在「我喜欢」中')
outcome = await addition.add(playlist, [existing, fresh, { ...fresh, hash: 'def' }])
assert.equal(reads, 1, 'same target membership is reused within TTL')
assert.equal(writes.length, 1)
assert.equal(writes[0].pid, '2', 'use writable listid, not collection id')
assert.deepEqual(writes[0].tracks, [fresh])
assert.equal(outcome.skipped, 2, 'duplicates in selection are skipped too')
assert.match(playlistAdditionNotice(outcome, playlist.name), /已添加 1 首.*跳过 2 首/)
outcome = await addition.add(playlist, fresh)
assert.equal(outcome.skipped, 1, 'successful additions are immediately remembered even if upstream reads lag')
assert.equal(writes.length, 1)

// Expiry, explicit invalidation, and different targets do not reuse stale keys.
now += 6000
songs = []
await addition.add(playlist, fresh)
assert.equal(reads, 2)
addition.invalidate()
await addition.add(playlist, existing)
assert.equal(reads, 3)
await addition.add({ id: 3 }, fresh)
assert.equal(reads, 4)

// Completed visible playlists avoid any network read.
addition = create()
loaded = [existing]
const before = reads
outcome = await addition.add(playlist, existing)
assert.equal(outcome.skipped, 1)
assert.equal(reads, before)
loaded = null

// A failed or incomplete membership read must not blindly add.
for (const implementation of [async () => { throw new Error('network') }, async () => ({ songs: [] })]) {
  addition = create()
  read = implementation
  const beforeWrites = writes.length
  await assert.rejects(() => addition.add(playlist, fresh))
  assert.equal(writes.length, beforeWrites)
}

// Failed writes never create a cached duplicate or block retries.
read = async () => ({ complete: true, songs: [] })
addition = create()
response = { status: 0 }
outcome = await addition.add(playlist, fresh)
assert.equal(outcome.failed, true)
response = { status: 1, data: { info: [{ mixsongid: 143, hash: 'canonical', fileid: 20 }] } }
outcome = await addition.add(playlist, fresh)
assert.equal(outcome.added.length, 1)
outcome = await addition.add(playlist, { id: 143 })
assert.equal(outcome.skipped, 1, 'canonical aliases from the acknowledgement are remembered')

// Double clicks cannot start a second read/write while the first is pending.
addition = create()
let release
read = () => new Promise(resolve => { release = resolve })
const task = addition.add(playlist, fresh)
assert.equal((await addition.add(playlist, fresh)).busy, true)
release({ complete: true, songs: [] })
await task

// Account switch during read prevents a write; switch during write prevents UI commit.
addition = create()
const pendingAccount = addition.add(playlist, fresh)
account = 'b'
addition.invalidate({ cancel: true })
const beforeWrites = writes.length
release({ complete: true, songs: [] })
await assert.rejects(() => pendingAccount, /账号已切换/)
assert.equal(writes.length, beforeWrites)
read = async () => ({ complete: true, songs: [] })
await addition.add(playlist, fresh)
assert.equal(writes.length, beforeWrites + 1, 'new account cannot reuse old-account membership')
let releaseWrite
const pendingWriteService = createPlaylistAddition({
  getAccountId: () => account, extractKeys: keys, isSuccess: () => true,
  getLoadedSongs: () => [], getPlaylistAll: async () => { throw new Error('unexpected read') },
  updatePlaylist: () => new Promise(resolve => { releaseWrite = resolve }),
})
const pendingWrite = pendingWriteService.add(playlist, fresh)
account = 'another-account'
releaseWrite({ status: 1 })
await assert.rejects(() => pendingWrite, /账号已切换/)
account = null
await assert.rejects(() => addition.add(playlist, fresh), /登录/)

// Bounded cache: retain at most three target playlists, not every visited library.
account = 'c'
addition = create()
const beforeBounded = reads
for (let id = 1; id <= 4; id++) await addition.add({ id }, fresh)
await addition.add({ id: 1 }, fresh)
assert.equal(reads, beforeBounded + 5)

// One-pass membership building works for large playlists as well.
addition = create()
loaded = Array.from({ length: 10000 }, (_, id) => ({ id: id + 1, hash: `large-${id}` }))
outcome = await addition.add(playlist, [{ id: 10000 }, { id: 10001 }])
assert.equal(outcome.skipped, 1)
assert.equal(outcome.added.length, 1)
assert.match(playlistAdditionNotice({ added: [], skipped: 2, total: 2 }, '测试'), /所选歌曲已在/)

const component = await readFile('src/components/ContextMenu.vue', 'utf8')
assert.match(component, /playlistAddition\.add\(playlist, tracks\)/)
assert.match(component, /if \(playlistAddBusy\.value\) return/)
assert.match(component, /addedTracks\.forEach\(song => libraryStore\.applyPlaylistTrackChange/)
console.log('Playlist addition checks passed: duplicates, mixed batches, aliases, bounded cache, failures, double clicks, account guards and 10000-song membership')
