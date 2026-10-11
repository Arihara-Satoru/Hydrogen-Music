import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import * as data from '../src/utils/listenTogetherData.mjs'

// Representative public genting response: progress is seconds and pause=1 plays.
const snapshot = data.normalizeRoomPlayback({ pause: '1', list_version: '20',
    progress_info: { cur_song: 'abc', progress: 83, album_audio_id: '42' },
    song_info: [{ hash: 'abc', album_audio_id: '42', singername: '歌手' }] },
    [{ hash: 'ABC', album_audio_id: '42', songname: '歌曲', duration: 200 }])
assert.equal(snapshot.position, 83)
assert.equal(snapshot.paused, false)
assert.equal(snapshot.song.name, '歌曲')
assert.equal(data.playbackPosition(snapshot, 1500), 84.5)
assert.equal(data.playbackPosition({ ...snapshot, paused: true }, 1500), 83)
assert.equal(data.normalizeRoomPlayback({}), null)
assert.equal(data.normalizeRoomPlayback({ audio: { hash: 'a' }, progress: -1 }), null)
assert.equal(data.normalizeRoom({ roomid: '123', userid: 11, room_theme: '测试' }).ownerId, '11')
assert.equal(data.normalizeRoom({ roomid: '123', room_biz: 1006 }).kind, '')
assert.equal(data.roomAudio({ type: 'local', hash: 'a' }), null)
assert.equal(data.playableRoomUrl({ url: ['https://example.test/music.mp3'] }), 'https://example.test/music.mp3')
assert.equal(data.playableRoomUrl('javascript:alert(1)'), '')
assert.equal(data.mergeRoomMessages([{ id: '9007199254740993', text: 'old' }], [{ id: '9007199254740993', text: 'new' }, { id: '9007199254740992' }])[1].text, 'new')

// song_order_list wraps each song and requester separately (real response shape).
const orderResponse = { list: [{
    song_info: { song_name: 'West Ride', hash: '7815A27693F6460A0DDDBF3613821D7C', mixsongid: '596265274',
        album_info: { album_id: '83146532', sizable_cover: 'https://example.test/{size}/cover.jpg' },
        authors: [{ author_id: '6565632', author_name: 'SKUNK' }] },
    user_info: { userid: 101, nick_name: '测试点歌人' },
}, {
    song_info: { song_name: 'Komm, süsser Tod', hash: 'A6E9BB49E2AF24CF2B78F7B5B2ED7DC7', mixsongid: '129141735', authors: [{ author_name: 'ARIANNE' }] },
    user_info: { userid: 102 },
}, {
    song_info: { song_name: '真夜中のドア/Stay With Me', hash: '1E1898733BB33FBEE0CD6EDAD4AC0DEB', mixsongid: '47488162', authors: [{ author_name: '松原みき' }] },
    user_info: { userid: 103 },
}], total: 3 }
const normalizedOrders = data.roomItems(orderResponse).map(data.normalizeRoomOrder)
assert.equal(normalizedOrders.length, 3)
assert.ok(normalizedOrders.every(Boolean))
assert.equal(normalizedOrders[0].name, 'West Ride')
assert.equal(normalizedOrders[0].ar[0].name, 'SKUNK')
assert.equal(normalizedOrders[0].al.id, '83146532')
assert.equal(normalizedOrders[0].coverUrl, 'https://example.test/{size}/cover.jpg')
assert.equal(normalizedOrders[0].order_userid, '101')
assert.equal(data.roomAudio(normalizedOrders[0]).mixsongid, '596265274')
assert.equal(data.normalizeRoomOrder({ hash: 'abc', order_userid: 7, user_info: { userid: 8 } }).order_userid, '7')
assert.equal(data.normalizeRoomOrder({ song_info: {} }), null)
assert.equal(data.normalizeRoomSong({ audio: { hash: 'abc', singername: '旧格式歌手' } }).ar[0].name, '旧格式歌手')

// The live recommendation API repeats page 1 on pages 2/3; is_end arrives later.
const firstRooms = [data.normalizeRoom({ roomid: '123' })]
const requestedPages = []
const repeated = await data.loadDistinctRoomPages({ previous: firstRooms, startPage: 2, fetchPage: async page => {
    requestedPages.push(page)
    return { list: [{ roomid: '123' }], is_end: page === 3 ? 1 : 0 }
} })
assert.deepEqual(requestedPages, [2, 3])
assert.equal(repeated.rooms.length, 1); assert.equal(repeated.added, 0); assert.equal(repeated.hasMore, false)
const skipped = await data.loadDistinctRoomPages({ previous: firstRooms, startPage: 2, fetchPage: async page => ({
    list: [{ roomid: page === 2 ? '123' : '456' }], is_end: 0,
}) })
assert.equal(skipped.page, 3); assert.equal(skipped.added, 1); assert.equal(skipped.hasMore, true)
const lastPage = await data.loadDistinctRoomPages({ previous: firstRooms, startPage: 2, fetchPage: async () => ({
    list: [{ roomid: '123', member_count: 5 }, { roomid: '456' }], is_end: '1',
}) })
assert.deepEqual(lastPage.rooms.map(room => room.id), ['123', '456'])
assert.equal(lastPage.rooms[0].count, 5)
assert.equal(lastPage.added, 1); assert.equal(lastPage.hasMore, false)
assert.equal(firstRooms.length, 1); assert.equal(firstRooms[0].count, 0)
await assert.rejects(data.loadDistinctRoomPages({ previous: firstRooms, startPage: 2, fetchPage: async page => {
    if (page === 3) throw new Error('分页请求失败')
    return { list: [{ roomid: '123', member_count: 10 }], is_end: 0 }
} }), /分页请求失败/)
assert.equal(firstRooms[0].count, 0)
let repeatedCalls = 0
await data.loadDistinctRoomPages({ previous: firstRooms, fetchPage: async () => { repeatedCalls++; return { list: [{ roomid: '123' }], is_end: 0 } } })
assert.equal(repeatedCalls, 3)
const emptyPage = await data.loadDistinctRoomPages({ fetchPage: async () => ({ list: [], is_end: 0 }) })
assert.equal(emptyPage.hasMore, false)
let activeRequest = true
assert.equal(await data.loadDistinctRoomPages({ isCurrent: () => activeRequest, fetchPage: async () => {
    activeRequest = false; return { list: [{ roomid: '123' }] }
} }), null)

let userId = '11', handler, saved, roomRequests = [], timers = new Map(), timerId = 0, calls = [], pendingSync, failLeave = false, encrypted = false
let failInitialize = false, pendingJoin = null
let orderList = { list: [], total: 0 }
const blank = () => ({ room: null, joining: false, busy: false, owner: false, songs: [], messages: [], members: [], orders: [], localPaused: false, listVersion: '', error: '' })
const state = { ...blank(), $reset() { Object.assign(this, blank()) } }
Object.defineProperty(state, 'canControl', { get: () => state.owner && state.room?.kind === 'music' })
const personal = { songList: [{ id: 99 }], listInfo: { type: 'playlist', id: 9 }, songId: 99, currentIndex: 0, progress: 12, time: 200, playing: false }
const player = { ...personal }
const user = { user: { userId: '11', nickname: '测试' } }
const context = createContext({ console, Date, AbortController, performance, setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id }, clearTimeout: id => timers.delete(id), window: { addEventListener() {}, removeEventListener() {} } })
const mock = exports => new SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value) }, { context })
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve } }
const playback = mock({
    stopTogetherPlayback: () => { calls.push('stop'); player.currentMusic = null; player.playing = false },
    playTogetherTrack: (song, url, position, autoplay) => { calls.push({ song, url, position, autoplay }); player.songList = [song]; player.currentMusic = { seek: () => position }; player.playing = autoplay },
    pauseMusic: () => { calls.push('pause'); player.playing = false },
    startMusic: () => { calls.push('resume'); player.playing = true },
    changeProgress: position => calls.push({ seek: position }),
})
const modules = {
    vue: mock({ watch: () => () => {} }),
    '../store/pinia': mock({ default: {} }),
    '../store/listenTogetherStore': mock({ useListenTogetherStore: () => state }),
    '../store/playerStore': mock({ usePlayerStore: () => player }),
    '../store/userStore': mock({ useUserStore: () => user }),
    './authority': mock({ getCookie: () => userId, isLogin: () => !!userId }),
    './dialog': mock({ noticeOpen: message => calls.push(message) }),
    './togetherBridge': mock({ setTogetherHandler: value => { handler = value }, setTogetherPersonalSnapshot: value => { saved = value } }),
    './listenTogetherData.mjs': mock(data),
    '../api/listenTogether': mock({ ROOM_BIZ: { music: '1009', study: '1000' }, togetherRequest: async (domain, operation, args, options) => {
        roomRequests.push({ domain, operation, args, options })
        if (operation === 'create') return { groupid: 'created' }
        if (operation === 'join') return pendingJoin ? pendingJoin.promise : { groupid: args.room_id }
        if (operation === 'initialize' && failInitialize) throw new Error('初始化失败')
        if (operation === 'leave' && failLeave) throw new Error('离房失败')
        if (operation === 'sync_player') return pendingSync ? pendingSync.promise : { progress_info: { cur_song: 'ABC', progress: 83, album_audio_id: '42' }, pause: '1' }
        if (operation === 'playback_url') return { url: [encrypted ? 'https://example.test/audio.kgs' : 'https://example.test/audio.mp3'] }
        if (operation === 'detail') return { roomid: args.room_id, userid: 11, room_status: 1 }
        if (operation === 'playlist') return { songs_info: [{ hash: 'ABC', album_audio_id: 42, songname: '歌曲', duration: 200 }], list_version: '20' }
        if (operation === 'order_song') orderList = orderResponse
        if (operation === 'song_order_list') return orderList
        return {}
    } }),
}
await playback.link(() => {}); await playback.evaluate()
const resolver = mock({ resolveTrackByQualityPreference: async () => ({ url: 'https://example.test/authorized.mp3' }) })
await resolver.link(() => {}); await resolver.evaluate()
const session = new SourceTextModule(await readFile('src/utils/listenTogetherSession.js', 'utf8'), { context, importModuleDynamically: specifier => {
    if (specifier === './musicUrlResolver') return resolver
    assert.equal(specifier, './player'); return playback
} })
await session.link(key => { assert.ok(modules[key], `Missing mock: ${key}`); return modules[key] })
await session.evaluate()
const api = session.namespace
const settle = async () => { for (let i = 0; i < 50; i++) await Promise.resolve() }
async function syncTick() { const entry = [...timers].find(([, t]) => t.delay === 0 || t.delay === 3000); assert.ok(entry); timers.delete(entry[0]); await entry[1].fn() }
await api.enterTogetherRoom('123', 'music')
assert.equal(state.room.id, '123'); assert.ok(handler); assert.equal(saved.progress, 12)
await api.refreshRoomDetails()
assert.equal(state.owner, true); assert.equal(state.songs[0].name, '歌曲')
assert.equal(state.orders.length, 0)
await api.roomAction('music', 'order_song', data.roomAudio(normalizedOrders[0]))
await settle()
assert.equal(state.orders.length, 3, 'Submitting a song refreshes and displays nested song_order_list records')
assert.equal(state.orders[0].order_userid, '101')
await api.roomAction('music', 'music_add', { audios: [data.roomAudio(state.orders[0])], order_userid: state.orders[0].order_userid, action: 4 })
await settle()
const addOrder = roomRequests.find(request => request.operation === 'music_add')
assert.equal(addOrder.args.order_userid, '101')
assert.equal(addOrder.args.audios[0].hash, orderResponse.list[0].song_info.hash)
await api.roomAction('music', 'remove_song', { ...data.roomAudio(state.orders[0]), order_userid: state.orders[0].order_userid })
await settle()
const removeOrder = roomRequests.find(request => request.operation === 'remove_song')
assert.equal(removeOrder.args.order_userid, '101')
assert.equal(removeOrder.args.mixsongid, '596265274')
await syncTick()
assert.equal(calls.find(call => call?.url)?.position >= 83, true)
assert.equal(calls.find(call => call?.url)?.autoplay, true)
handler('seek', 50.5); await settle()
assert.equal(roomRequests.find(r => r.operation === 'player_operation').args.progress, 50)
handler('pause'); await settle()
assert.equal(roomRequests.filter(r => r.operation === 'player_operation').at(-1).args.pause, 2)
await api.setLocalListening(true)
assert.equal(state.localPaused, true)
failLeave = true
await assert.rejects(api.leaveTogetherRoom(), /离房失败/)
assert.equal(state.room.id, '123')
failLeave = false
await api.leaveTogetherRoom()
assert.equal(state.room, null); assert.equal(handler, null); assert.equal(timers.size, 0); assert.equal(saved, null)
assert.equal(player.songId, 99); assert.equal(player.progress, 12); assert.equal(player.playing, false)

// A sync response that arrives after leaving must not start audio or schedule work.
await api.enterTogetherRoom('456', 'music')
pendingSync = deferred()
const tick = syncTick()
await settle()
api.resetTogetherSession()
const count = calls.length
pendingSync.resolve({ audio: { hash: 'LATE', id: 50 }, progress: 0, pause: 1 })
await tick
assert.equal(calls.length, count); assert.equal(timers.size, 0)
pendingSync = null
encrypted = true
await api.enterTogetherRoom('789', 'music')
await syncTick()
assert.equal(calls.at(-1).url, 'https://example.test/authorized.mp3')
api.resetTogetherSession()

// A partial create is compensated, without replacing the personal queue.
failInitialize = true
await assert.rejects(api.enterTogetherRoom(null, 'music', { room_name: '测试', audios: [] }), /初始化失败/)
assert.equal(roomRequests.at(-1).operation, 'dismiss')
assert.equal(state.room, null); assert.equal(state.joining, false); assert.equal(player.songId, 99)
failInitialize = false

// A late join for a previous account cannot enter a room or issue cleanup as the new user.
pendingJoin = deferred()
const joining = api.enterTogetherRoom('old-account', 'music')
await settle()
userId = '22'; api.resetTogetherSession()
const requestCount = roomRequests.length
pendingJoin.resolve({ groupid: 'old-account' })
await joining
assert.equal(state.room, null); assert.equal(roomRequests.length, requestCount); assert.equal(timers.size, 0)
pendingJoin = null; userId = '11'

// Non-owners can pause themselves but never send room playback commands.
await api.enterTogetherRoom('listener', 'music')
state.owner = false
const controlCount = roomRequests.filter(r => r.operation === 'player_operation').length
handler('seek', 80); handler('pause'); await settle()
assert.equal(state.localPaused, true)
assert.equal(roomRequests.filter(r => r.operation === 'player_operation').length, controlCount)
await assert.rejects(api.roomAction('music', 'music_add', {}), /只有房主/)
api.resetTogetherSession()

// Requests must not share cache URLs, and backend business errors must reject.
let requestConfigs = [], response = { status: 1, data: { groupid: '1' } }
const requestMock = mock({ default: async config => { requestConfigs.push(config); return response } })
const requestApi = new SourceTextModule(await readFile('src/api/listenTogether.js', 'utf8'), { context })
await requestApi.link(() => requestMock); await requestApi.evaluate()
await requestApi.namespace.togetherRequest('room', 'heartbeat', {})
await requestApi.namespace.togetherRequest('room', 'heartbeat', {})
assert.notEqual(requestConfigs[0].params.timestamp, requestConfigs[1].params.timestamp)
response = { status: 0, error_code: 20002, error_msg: '无权操作' }
await assert.rejects(requestApi.namespace.togetherRequest('music', 'order_song'), /无权操作/)

// Persist volume changes during a room without replacing the personal resume point.
const persisted = new Map()
context.localStorage = { getItem: key => persisted.get(key) ?? null, setItem: (key, value) => persisted.set(key, value), removeItem: key => persisted.delete(key) }
const playerStoreSource = new SourceTextModule(await readFile('src/store/playerStore.js', 'utf8'), { context })
await playerStoreSource.link(key => key === 'pinia'
    ? mock({ defineStore: (_id, config) => config })
    : mock({ getTogetherPersonalSnapshot: () => personal }))
await playerStoreSource.evaluate()
playerStoreSource.namespace.usePlayerStore.persist.storage.setItem('playerStore', JSON.stringify({ songId: 42, progress: 83, volume: .8, listInfo: { type: 'together' } }))
const resumed = JSON.parse(persisted.get('playerStore'))
assert.equal(resumed.songId, 99); assert.equal(resumed.progress, 12); assert.equal(resumed.volume, .8)
console.log('Together API, real response mapping, controls, leave recovery and stale-session checks passed')
