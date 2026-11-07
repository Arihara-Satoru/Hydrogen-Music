import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

// No network or real account writes: exercise the entire player module with mocked dependencies.
let now = 10000
class Clock extends Date { static now() { return now } }
const noop = () => {}
const bridge = new Proxy({}, { get: () => noop })
const context = createContext({ console, Date: Clock, setTimeout, clearTimeout, setInterval: () => 1,
  clearInterval: noop, windowApi: bridge, window: { playerApi: bridge, addEventListener: noop }, navigator: {} })
const mock = exports => new SyntheticModule(Object.keys(exports), function () {
  for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
}, { context })
const source = await readFile('src/utils/player.js', 'utf8')
const dependencies = {}
for (const [, imported, key] of source.matchAll(/^import\s+([\s\S]+?)\s+from\s+["']([^"']+)["'];?/gm)) {
  const names = imported.startsWith('{') ? imported.replace(/[{}]/g, '').split(',').map(name => name.trim()).filter(Boolean) : ['default']
  dependencies[key] = mock(Object.fromEntries(names.map(name => [name, noop])))
}
const user = { user: { userId: 'user-a' }, favoritePlaylistId: 2, favoritePlaylistName: '我喜欢', likelist: [],
  updateLikelist(list) { this.likelist = list }, updateFavoritePlaylistMeta(meta) { this.favoritePlaylistId = meta?.id; this.favoritePlaylistName = meta?.name } }
const state = { songList: [], currentIndex: 0, listInfo: null }
const library = { playlistUserCreated: [{ id: 2, name: '我喜欢' }], applyPlaylistTrackChange: noop }
const refs = new Proxy({}, { get: (_, key) => ({ get value() { return state[key] }, set value(value) { state[key] = value } }) })
let readSongs = async () => ({ songs: [] })
let writeResult = { status: 1, data: { status: 1 } }
const writes = []
const watchers = []
Object.assign(dependencies, {
  vue: mock({ markRaw: value => value, watch: (source, callback) => watchers.push({ source, callback }) }),
  pinia: mock({ storeToRefs: () => refs }),
  '../store/playerStore': mock({ usePlayerStore: () => state }),
  '../store/userStore': mock({ useUserStore: () => user }),
  '../store/libraryStore': mock({ useLibraryStore: () => library }),
  '../store/otherStore': mock({ useOtherStore: () => ({}) }),
  '../api/playlist': mock({ getPlaylistAll: params => readSongs(params), updatePlaylist: async params => { writes.push(params); return writeResult } }),
})
const module = new SourceTextModule(source, { context })
await module.link(key => dependencies[key])
await module.evaluate()
const player = module.namespace
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const sync = () => player.syncFavoritePlaylistLikelist(2, { forceRefresh: true })
const reset = () => {
  now += 6000
  player.syncLikelistFromFavoriteSongs([], 2)
  writes.length = 0
  readSongs = async () => ({ songs: [] })
}

for (const result of [
  { status: 200, data: { status: 0 } }, { status: 0, error_code: 0 },
  { status: 1, error_code: 152 },
  { status: 1, data: { info: [{ status: 0 }] } },
  { status: 1, data: { info: [{ error_code: 123 }] } }, { status: 200, body: { code: 500 } },
]) assert.equal(player.isPlaylistTrackOperationSuccess(result), false)
for (const result of [{ status: 1 }, { code: 200 }, { status: 200, data: { status: 1, info: [] } }, { data: { status: 1, info: [{ fileid: 859 }] } }]) {
  assert.equal(player.isPlaylistTrackOperationSuccess(result), true)
}
assert.equal(player.resolveFavoritePlaylistMeta([{ id: 1, name: '默认收藏' }]), null, 'never silently write to an unrelated playlist')

const original = { id: 42, name: '歌曲', hash: 'old', HQFileHash: 'high', audio_id: 100 }
const canonical = { mixsongid: 43, hash: 'new', fileid: 859 }
writeResult = { data: { status: 1, info: [] } }
readSongs = async () => ({ songs: [{ ...original, fileid: 859 }] })
assert.equal((await player.updateFavoritePlaylistTrack(original, true)).success, true, 'successful empty acknowledgement is accepted')
await settle()
reset()
writeResult = { status: 1, error_code: 0, data: { status: 1, info: [] } }
assert.equal((await player.updateFavoritePlaylistTrack(original, true)).success, true, 'lagging reads do not downgrade a successful empty acknowledgement')
await settle()
assert.equal(player.isSongLiked(original), true)
reset()
writeResult = { status: 1, error_code: 0, data: { status: 1, info: [{ ...original, fileid: 859, status: 0 }] } }
assert.equal((await player.updateFavoritePlaylistTrack(original, true)).success, true, 'resource status=0 is not an operation failure')
await settle()
assert.equal(player.isSongLiked(original), true)
reset()
writeResult = { status: 1, error_code: 0, data: { status: 1, info: [] } }
readSongs = async () => { throw new Error('read temporarily unavailable') }
assert.equal((await player.updateFavoritePlaylistTrack(original, true)).success, true, 'read errors cannot downgrade acknowledged writes')
await settle()
assert.equal(player.isSongLiked(original), true)
reset()
assert.match(player.getLikeActionErrorMessage({ data: { status: 0, error_code: 123 } }), /error_code=123/)
writeResult = { info: [] }
readSongs = async () => ({ songs: [{ ...original, fileid: 859 }] })
assert.equal((await player.updateFavoritePlaylistTrack(original, true)).success, true, 'unrecognized acknowledgement can still be confirmed from server state')
await settle()
reset()
writeResult = { status: 1, data: { status: 1, info: [canonical] } }
readSongs = async () => ({ songs: [] }) // eventual-consistency lag
assert.equal((await player.updateFavoritePlaylistTrack(original, true)).success, true)
await settle()
assert.equal(player.isSongLiked(original), true, 'lagging reads must not undo a successful add')
assert.equal(player.isSongLiked({ hash: 'HIGH' }), true, 'quality hash aliases are case-insensitive')
// A stale library view is another synchronization entry point.
player.syncLikelistFromFavoriteSongs([], 2)
assert.equal(player.isSongLiked(original), true)
readSongs = async () => ({ songs: [{ ...canonical, fileid: 856 }] })
await sync()
readSongs = async () => ({ songs: [canonical] })
now += 6000
await sync()
assert.equal(player.isSongLiked(original), true, 'canonical IDs keep the original source aliases')
writeResult = { status: 1, data: { status: 1 } }
assert.equal((await player.updateFavoritePlaylistTrack(original, false)).success, true)
assert.equal(writes.at(-1).fileids, '859', 'delete uses the returned playlist fileid, never the song ID')
user.updateLikelist(player.applyOptimisticLikeState(original, false)) // sidebar and FM callers reapply the state
await settle()
assert.equal(player.isSongLiked(original), false)
assert.equal(player.isSongLiked(canonical), false, 'remove all aliases')
await sync()
assert.equal(player.isSongLiked(original), false, 'stale read cannot resurrect a deleted favorite')
now += 6000
await sync()
assert.equal(player.isSongLiked(canonical), true, 'grace protection is bounded; later server state is authoritative')

reset()
writeResult = { status: 1, data: { status: 1, info: [canonical] } }
await player.updateFavoritePlaylistTrack(original, true)
await settle()
writeResult = { status: 1, data: { status: 1 } }
await player.updateFavoritePlaylistTrack(original, false)
await settle()
writeResult = { status: 1, data: { status: 1, info: [{ ...canonical, fileid: 860 }] } }
await player.updateFavoritePlaylistTrack(original, true)
user.updateLikelist(player.applyOptimisticLikeState(original, true))
await settle()
readSongs = async () => ({ songs: [canonical] }) // older fileid still visible on the read endpoint
await sync()
writeResult = { status: 1, data: { status: 1 } }
await player.updateFavoritePlaylistTrack(original, false)
assert.equal(writes.at(-1).fileids, '860', 'add/remove/re-add must use the newest fileid even when reads lag')
await settle()

reset()
let releaseOld
readSongs = () => new Promise(resolve => { releaseOld = resolve })
const oldSync = sync()
readSongs = async () => ({ songs: [] })
writeResult = { status: 1, data: { status: 1, info: [canonical] } }
await player.updateFavoritePlaylistTrack(original, true)
releaseOld({ songs: [] })
await oldSync
assert.equal(player.isSongLiked(original), true, 'pre-mutation request cannot overwrite a newer mutation')

reset()
let releaseFirst
readSongs = () => new Promise(resolve => { releaseFirst = resolve })
const firstSync = sync()
readSongs = async () => ({ songs: [canonical] })
await sync()
releaseFirst({ songs: [] })
await firstSync
assert.equal(player.isSongLiked(canonical), true, 'out-of-order refreshes retain the latest result')

reset()
state.listInfo = { id: 9 }
library.libraryInfo = { id: 2 }
const missing = { id: 999, name: '别的歌单', hash: 'missing', fileid: 7 }
assert.equal((await player.updateFavoritePlaylistTrack(missing, false)).success, false)
assert.equal(writes.length, 0, 'missing fileid must not delete a song from another playlist')

writeResult = { status: 1, data: { status: 1 } }
await player.updateFavoritePlaylistTrack(missing, true)
await settle()
writes.length = 0
assert.equal((await player.updateFavoritePlaylistTrack(missing, false)).success, false)
assert.equal(writes.length, 0, 'add response without fileid must not reuse the source-playlist fileid')
reset()
writeResult = { status: 200, data: { status: 0 } }
assert.equal((await player.updateFavoritePlaylistTrack(original, true)).success, false)
assert.equal(player.isSongLiked(original), false, 'business failure does not become optimistic success')

reset()
let releaseAccount
readSongs = () => new Promise(resolve => { releaseAccount = resolve })
const oldAccount = sync()
user.user = { userId: 'user-b' }
// Simulate Vue's synchronous account watcher.
watchers.find(item => typeof item.source === 'function' && item.source() === 'user-b').callback()
releaseAccount({ songs: [canonical] })
await oldAccount
assert.equal(player.isSongLiked(canonical), false, 'old-account response cannot populate the new account')
readSongs = async () => ({ songs: [] })
await sync()
assert.equal(player.isSongLiked(original), false)

const playerVue = await readFile('src/components/Player.vue', 'utf8')
const toolbar = playerVue.slice(playerVue.indexOf('class="song-control"'))
assert.ok(toolbar.indexOf('data-tour="player-like"') < toolbar.indexOf('data-tour="player-add-playlist"'))
assert.match(toolbar, /fill="#E5404F"/)
console.log('Favorite playlist checks passed: business status, canonical aliases, fileids, lag, race guards, bounded reconciliation and account isolation')
