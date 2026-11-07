import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import { reactive, computed } from 'vue'

// Run with node --experimental-vm-modules scripts/check-kugou-compatibility.mjs.
const storage = new Map()
const context = createContext({ console, Date, Math, localStorage: {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
} })
const requests = []
let responder
const mock = exports => new SyntheticModule(Object.keys(exports), function () {
  for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
}, { context })
const requestModule = mock({ default: config => {
  requests.push(config)
  return responder(config)
} })
const pinia = mock({ defineStore: (_id, options) => () => {
  const store = reactive(options.state())
  for (const [name, action] of Object.entries(options.actions)) store[name] = action.bind(store)
  return store
} })
const songStatus = mock({ mapSongsPlayableStatus: songs => songs })
async function load(path, dependencies) {
  const module = new SourceTextModule(await readFile(path, 'utf8'), { context, identifier: path })
  await module.link(name => {
    assert.ok(dependencies[name], `Unexpected import in ${path}: ${name}`)
    return dependencies[name]
  })
  await module.evaluate()
  return module
}
const other = await load('src/api/other.js', { '../utils/request': requestModule })
const { search } = other.namespace

// Album fields captured from a successful /v1/search/album response on 2026-10-06.
responder = async () => ({ status: 1, error_code: 0, data: { lists: [{
  albumid: 983378, albumname: '海阔天空', songcount: 10,
  img: 'http://imge.kugou.com/stdmusic/240/20220510/20220510154611248287.jpg',
  publish_time: '2004-02-27',
}] } })
const album = (await search({ keywords: '海阔天空', type: 10 })).result.albums[0]
assert.equal(requests.at(-1).params.type, 'album')
assert.equal(album.id, '983378')
assert.equal(album.name, '海阔天空')
assert.equal(album.size, 10)
assert.equal(album.publishTime, '2004-02-27')
assert.match(album.picUrl, /20220510154611248287\.jpg$/)

// Synthetic song fixtures exercise the existing supported fields; they are not authenticated captures.
responder = async () => ({ status: 1, data: { lists: [{
  FileHash: 'ABC123', MixSongID: 42, FileName: '歌手 - 歌曲.flac',
  Singers: [{ author_id: 7, author_name: '歌手' }], duration: 180,
  AlbumID: 9, AlbumName: '专辑', trans_param: { union_cover: 'https://example.test/{size}.jpg' },
}] } })
const song = (await search({ keywords: '歌曲', type: 1 })).result.songs[0]
assert.equal(requests.at(-1).params.type, 'song')
assert.equal(song.hash, 'ABC123')
assert.equal(song.id, '42')
assert.equal(song.mixsongid, 42)
assert.equal(song.album_audio_id, 42)
assert.equal(song.name, '歌曲')
assert.equal(song.ar[0].name, '歌手')
assert.equal(song.ar[0].id, '7')
assert.equal(song.dt, 180000)
assert.equal(song.al.picUrl, 'https://example.test/480.jpg')
for (const response of [{ data: { lists: [] } }, { data: { info: [] } }, { list: [] }]) {
  responder = async () => response
  assert.equal((await search({})).result.songs.length, 0)
}
responder = async () => ({ data: { data: { total: 1 } } })
await assert.rejects(() => search({}), /搜索响应格式异常/)

// A real guest song response has status=1 and error_code=152; both HTTP paths must reject it.
const authBody = { status: 1, error_code: 152, error_msg: 'Parameter Error', data: { lists: [] } }
responder = async () => authBody
await assert.rejects(() => search({}), /需要酷狗账号认证/)
responder = async () => { throw { response: { status: 502, data: authBody } } }
await assert.rejects(() => search({}), /需要酷狗账号认证/)
responder = async () => { throw { isAxiosError: true, code: 'ECONNABORTED' } }
await assert.rejects(() => search({}), /超时/)
responder = async () => { throw { isAxiosError: true, code: 'ERR_NETWORK' } }
await assert.rejects(() => search({}), /网络连接失败/)
responder = async () => ({ status: 0, error_code: 20010, errmsg: 'upstream unavailable' })
await assert.rejects(() => search({}), /upstream unavailable/)

const otherStoreModule = await load('src/store/otherStore.js', {
  pinia,
  '../api/other': other,
  '../api/mv': mock({ getMVDetail() {}, getMVUrl() {} }),
  '../utils/songStatus': songStatus,
  '../utils/dialog': mock({ noticeOpen() {} }),
})
const store = otherStoreModule.namespace.useOtherStore()
responder = async ({ params }) => params.type === 'song' ? authBody : { data: { lists: [] } }
await store.getSearchInfo('guest')
assert.match(store.searchErrors.searchSongs, /认证/)
assert.equal(store.searchErrors.searchAlbums, undefined)
assert.equal(store.searchResult.searchAlbums.length, 0)
assert.equal(store.searchLoading, false)
let releaseSlow
const slowGate = new Promise(resolve => { releaseSlow = resolve })
responder = async ({ params }) => {
  if (params.keywords === 'slow') { await slowGate; return authBody }
  return { data: { lists: [] } }
}
const slow = store.getSearchInfo('slow')
assert.equal(Object.keys(store.searchErrors).length, 0)
assert.equal(store.searchLoading, true)
await store.getSearchInfo('latest')
releaseSlow()
await slow
assert.equal(Object.keys(store.searchErrors).length, 0)
assert.equal(store.searchLoading, false)

const playlist = await load('src/api/playlist.js', { '../utils/request': requestModule })
const { getPlaylistAll } = playlist.namespace
const { updatePlaylist, createPlaylist, deletePlaylist } = playlist.namespace
responder = async () => ({ status: 1, data: { status: 1 } })
for (const [track, expected] of [
  [{ name: '歌|曲,名', hash: 'HASH', id: 'f'.repeat(32), album_id: 'invalid' }, '歌 曲 名|HASH'],
  [{ name: '歌曲', hash_320: 'HQ', id: 81, audio_id: 81, album_id: 9 }, '歌曲|HQ|9|0'],
  [{ base: { audio_name: '专辑歌曲', album_audio_id: 42, album_id: 9 }, audio_info: { hash: 'BASE' } }, '专辑歌曲|BASE|9|42'],
  [{ SongName: '搜索歌曲', SQFileHash: 'SQ', AlbumID: '9', MixSongID: '42' }, '搜索歌曲|SQ|9|42'],
  [{ name: '歌曲', hash: 'HASH', album_audio_id: 0, mixsongid: 42, al: { id: 0 }, album_id: 9 }, '歌曲|HASH|9|42'],
]) {
  await updatePlaylist({ op: 'add', pid: 2, tracks: track, timestamp: 1234 })
  assert.equal(requests.at(-1).params.data, expected)
  assert.equal(requests.at(-1).params.timestamp, 1234, 'write timestamps must survive the adapter')
}
for (const run of [
  () => updatePlaylist({ op: 'add', pid: 2, tracks: { name: '歌曲', hash: 'HASH' } }),
  () => updatePlaylist({ op: 'del', pid: 2, fileids: '859' }),
  () => createPlaylist({ name: '新歌单' }),
  () => deletePlaylist({ id: 2 }),
]) {
  const before = Date.now()
  await run()
  assert.ok(requests.at(-1).params.timestamp >= before, 'all playlist writes bypass URL-based response caches')
}
const pageOne = Array.from({ length: 300 }, (_, index) => ({
  hash: `hash-${index}`, fileid: index + 1, filename: `歌手 - 歌曲${index}`,
  shield: index === 0 ? 1 : 0,
}))
const pageTwo = [{ ...pageOne[1] }, { hash: 'tail', fileid: 301, filename: '歌手 - 尾曲' }]
for (const rootInfo of [false, true]) {
  requests.length = 0
  responder = async ({ params }) => {
    const info = params.page === 1 ? pageOne : pageTwo
    return rootInfo ? { status: 1, info } : { status: 1, data: { info } }
  }
  const result = await getPlaylistAll({ id: 123 })
  assert.deepEqual(requests.map(({ params }) => params.page), [1, 2])
  assert.equal(result.complete, true)
  assert.equal(result.songs.length, 301)
  assert.deepEqual(Array.from(result.songs, item => item.hash), [...pageOne.slice(1), ...pageTwo].reverse().map(item => item.hash))
  assert.equal(result.songs.filter(item => item.hash === 'hash-1').length, 2, 'intentional duplicates survive')
}
requests.length = 0
responder = async ({ params }) => ({ data: { info: params.page === 1 ? pageOne.map(song => ({ ...song, shield: 0 })) : [] } })
assert.equal((await getPlaylistAll({ id: 123 })).songs.length, 300)
assert.deepEqual(requests.map(({ params }) => params.page), [1, 2], 'a full page requires checking the boundary')
requests.length = 0
responder = async ({ params }) => ({ data: { info: params.page === 1 ? pageOne.map(song => ({ ...song, shield: 1 })) : pageTwo } })
assert.equal((await getPlaylistAll({ id: 123 })).songs.length, 2)
assert.deepEqual(requests.map(({ params }) => params.page), [1, 2], 'a fully shielded page is still a full page')

// Public/collected playlists retain upstream order; fallback must also load every page.
for (const fallback of [false, true]) {
  requests.length = 0
  responder = async ({ url, params }) => {
    if (url.endsWith('/new')) throw new Error('unsupported listid')
    return { data: { info: params.page === 1 ? pageOne : pageTwo } }
  }
  const result = await getPlaylistAll(fallback ? { id: 'legacy-id' } : { id: 'collection_3_123_4_0' })
  assert.equal(result.complete, true)
  assert.deepEqual(Array.from(result.songs, item => item.hash), [...pageOne.slice(1), ...pageTwo].map(item => item.hash))
  assert.deepEqual(requests.filter(({ url }) => !url.endsWith('/new')).map(({ params }) => params.page), [1, 2])
}
requests.length = 0
responder = async ({ params }) => {
  if (params.page === 2) throw new Error('second page failed')
  return { data: { info: pageOne } }
}
await assert.rejects(() => getPlaylistAll({ id: 123 }), /second page failed/)
assert.ok(requests.every(({ url }) => url.endsWith('/new')), 'do not replace a partial load with another playlist')
responder = async () => ({ status: 0, error_code: 152, errmsg: 'authentication required' })
await assert.rejects(() => getPlaylistAll({ id: 'collection_3_123_4_0' }), /authentication required/)
responder = async () => ({ data: { info: {} } })
await assert.rejects(() => getPlaylistAll({ id: 'collection_3_123_4_0' }), /歌单响应格式异常/)

// Exercise the real detail action so filtering cannot trigger a second hydration and duplicate tracks.
const libraryModule = await load('src/store/libraryStore.js', {
  pinia,
  '../api/playlist': playlist,
  '../api/album': mock({ getAlbumDetail() {}, albumDynamic() {} }),
  '../api/artist': mock({ getArtistDetail() {}, getArtistTopSong() {}, getArtistAlbum() {} }),
  '../api/mv': mock({ getArtistMV() {} }),
  '../utils/songStatus': songStatus,
  '../utils/songFilter': mock({ buildAlbumSearchText() {}, buildCloudSongSearchText: song => song.name, buildMVSearchText() {} }),
})
for (const collected of [false, true]) {
  const library = libraryModule.namespace.useLibraryStore()
  const info = { id: '123', is_mine: collected ? 0 : 1, trackCount: 1200 }
  if (collected) info.global_collection_id = 'collection_3_123_4_0'
  else info.listid = '123'
  library.libraryList = [info]
  library.playlistUserSub = collected ? [info] : []
  const pages = Array.from({ length: 4 }, (_, page) => pageOne.map((song, index) => ({ ...song, hash: `${page}-${index}`, fileid: page * 300 + index })))
  requests.length = 0
  responder = async ({ params }) => ({ data: { info: pages[params.page - 1] || [] } })
  await library.updatePlaylistDetail('123')
  assert.deepEqual(requests.map(({ params }) => params.page), [1, 2, 3, 4, 5])
  assert.equal(library.librarySongs.length, 1196)
  assert.equal(new Set(library.librarySongs.map(song => song.hash)).size, 1196)
  assert.equal(library.playlistHydration.status, 'completed')
  assert.equal(library.playlistHydration.loaded, 1196)
  const upstream = pages.flat().filter(song => song.shield !== 1).map(song => song.hash).reverse()
  assert.deepEqual(Array.from(library.librarySongs, song => song.hash), upstream, 'retain existing created and collected display order')
}

const favoriteLibrary = libraryModule.namespace.useLibraryStore()
favoriteLibrary.libraryInfo = { id: 2, trackCount: 1 }
favoriteLibrary.librarySongs = [{ id: 42, hash: 'abc', fileid: 856, name: '歌曲' }]
favoriteLibrary.applyPlaylistTrackChange({ playlist: { id: 2 }, op: 'add', song: { id: 43, hash: 'ABC', fileid: 859, name: '歌曲' } })
assert.equal(favoriteLibrary.librarySongs.length, 1)
assert.equal(favoriteLibrary.librarySongs[0].fileid, 859, 're-add replaces stale fileid')
assert.equal(favoriteLibrary.libraryInfo.trackCount, 1, 'replacement does not increment count')
favoriteLibrary.applyPlaylistTrackChange({ playlist: { id: 2 }, op: 'del', song: { hash: 'abc' } })
assert.equal(favoriteLibrary.librarySongs.length, 0)

// Match the user's view: detail and sidebar may start with different stale counts.
favoriteLibrary.libraryInfo = { id: 2, trackCount: 648, count: 648 }
const sidebarFavorite = { id: 2, trackCount: 647, count: 647 }
favoriteLibrary.playlistUserCreated = [sidebarFavorite]
favoriteLibrary.libraryList = [sidebarFavorite] // shared references must not double-increment
favoriteLibrary.librarySongs = [{ id: 1, name: '原有歌曲', hash: 'existing' }]
const previousSongs = favoriteLibrary.librarySongs
const visibleSongs = computed(() => favoriteLibrary.librarySongs.map(song => song.id))
assert.deepEqual(visibleSongs.value, [1])
const newSong = { id: 2, name: '新增歌曲', hash: 'new', fileid: 860 }
favoriteLibrary.applyPlaylistTrackChange({ playlist: { id: 2 }, op: 'add', song: newSong })
assert.notEqual(favoriteLibrary.librarySongs, previousSongs, 'publish a fresh array for virtualized and filtered views')
assert.equal(favoriteLibrary.librarySongs[0].id, 2, 'new favorites appear at the top without reloading')
assert.deepEqual(Array.from(visibleSongs.value), [2, 1], 'the Vue list projection reacts immediately without refreshing')
assert.equal(favoriteLibrary.libraryInfo.trackCount, 649)
assert.equal(sidebarFavorite.trackCount, 649, 'sidebar matches the detail count rather than incrementing an outdated count')
assert.equal(sidebarFavorite.count, 649)
favoriteLibrary.applyPlaylistTrackChange({ playlist: { id: 2 }, op: 'add', song: { ...newSong, fileid: 861 } })
assert.equal(favoriteLibrary.librarySongs.length, 2, 'acknowledgement metadata must not insert a duplicate')
assert.equal(sidebarFavorite.trackCount, 649)
favoriteLibrary.applyPlaylistTrackChange({ playlist: { id: 2 }, op: 'del', song: newSong })
assert.equal(sidebarFavorite.trackCount, 648)
assert.equal(favoriteLibrary.libraryInfo.trackCount, 648)

console.log('KuGou search and playlist compatibility check passed')
