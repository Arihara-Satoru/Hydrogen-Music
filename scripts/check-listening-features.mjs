import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import { calculatePlaybackMilliseconds } from '../src/utils/listenTimeMath.mjs'
import { parseRecommendationWeights, validateRecommendationWeights, normalizeBlacklistItem } from '../src/utils/listeningPreference.mjs'

assert.equal(calculatePlaybackMilliseconds(0, 1000, 10, 11), 1000)
assert.equal(calculatePlaybackMilliseconds(0, 1000, 10, 10), 0) // buffering
assert.equal(calculatePlaybackMilliseconds(0, 1000, 10, 100), 0) // seek forward
assert.equal(calculatePlaybackMilliseconds(0, 1000, 10, 5), 0) // seek backward
assert.equal(calculatePlaybackMilliseconds(0, 60000, 10, 70), 0) // sleep
assert.equal(calculatePlaybackMilliseconds(0, 1000, 10, 12, 2), 1000)
assert.throws(() => parseRecommendationWeights('{'), SyntaxError)
assert.throws(() => parseRecommendationWeights('{"L1":101}'), /0–100/)
assert.throws(() => validateRecommendationWeights({ L1: 0, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 }), /全部屏蔽/)
assert.throws(() => validateRecommendationWeights({ S9: 100, T1: 0 }), /翻唱/)
validateRecommendationWeights({ L1: 0, S9: 50, T1: 0 })
assert.deepEqual(normalizeBlacklistItem({ song_k: 'hash', song_v: '{"n":"歌曲","m":"123"}' }, 'song'), { key: 'hash', name: '歌曲', mixsongid: '123' })
assert.equal(normalizeBlacklistItem({ singer_k: 9, singer_v: 'broken' }, 'singer').key, '9')

let clock = 0
let tick
const watchers = []
const reports = []
const player = { songList: [{ id: 123 }], currentIndex: 0, currentMusic: null, playing: false }
const user = { user: { userId: '1' }, gradeInfo: null, updateGradeInfo(value) { this.gradeInfo = value } }
const context = createContext({ console, Date, performance: { now: () => clock }, setInterval: fn => { tick = fn; return 1 }, clearInterval: () => {} })
function mock(exports) {
    return new SyntheticModule(Object.keys(exports), function () {
        for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
    }, { context })
}
const modules = {
    vue: mock({ watch: (source, callback, options) => {
        const watcher = { source, callback, value: source() }
        watchers.push(watcher)
        if (options?.immediate) callback(watcher.value)
        return () => watchers.splice(watchers.indexOf(watcher), 1)
    } }),
    '../api/user': mock({
        getUserGradeInfo: async () => ({ status: 1, data: { d_sec: 100 } }),
        reportSongListen: async data => { reports.push({ ...data }); return data.event === 'end' ? { status: 1, data: { grade: { status: 1, data: { d_sec: Number(data.d_sec) + (data.diff_sec || 0) } } } } : { status: 1 } },
    }),
    '../store/pinia': mock({ default: {} }),
    '../store/playerStore': mock({ usePlayerStore: () => player }),
    '../store/userStore': mock({ useUserStore: () => user }),
    './authority': mock({ isLogin: () => !!user.user, getCookie: () => 'mock-token' }),
    './request': mock({ getKugouApiDeviceIdentity: () => ({ guid: 'a'.repeat(32), mid: '123', dev: 'TEST' }) }),
    './listenTimeMath.mjs': mock({ calculatePlaybackMilliseconds }),
}
const module = new SourceTextModule(await readFile('src/utils/listenTimeReporter.js', 'utf8'), { context })
await module.link(key => modules[key])
await module.evaluate()
function flushWatchers() {
    for (const watcher of [...watchers]) {
        const value = watcher.source()
        if (value !== watcher.value) { const previous = watcher.value; watcher.value = value; watcher.callback(value, previous) }
    }
}
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function playback() {
    const listeners = new Map()
    return {
        position: 0, active: false,
        seek() { return this.position }, playing() { return this.active },
        on(event, fn) { const list = listeners.get(event) || new Set(); list.add(fn); listeners.set(event, list) },
        off(event, fn) { listeners.get(event)?.delete(fn) },
        emit(event) { for (const fn of [...(listeners.get(event) || [])]) fn() },
    }
}
module.namespace.initListenTimeReporter()
await settle()
const first = playback()
player.currentMusic = first
flushWatchers()
await settle()
assert.equal(reports.length, 0) // loading and optimistic playing flags do not start a report
first.active = true; first.emit('play'); first.emit('play')
await settle()
assert.equal(reports.length, 1)
assert.equal(reports[0].event, 'start')
clock = 1000; first.position = 1; tick()
clock = 2000; tick() // buffer
clock = 3000; first.position = 30; tick() // seek
clock = 4000; first.position = 31; first.active = false; first.emit('pause')
await settle()
assert.equal(reports.at(-1).duration, 2000)
assert.equal(reports.at(-1).diff_sec, 2)
assert.equal(reports.at(-1).d_sec, 100)
clock = 10000; first.active = true; first.emit('play')
clock = 11000; first.position = 32; tick()
player.songList = [{ id: 456 }]
player.currentMusic = playback()
flushWatchers()
await settle()
assert.equal(reports.at(-1).mixsongid, 123)
assert.equal(reports.at(-1).duration, 1000)
assert.equal(reports.at(-1).d_sec, 102)
player.currentMusic.active = true; player.currentMusic.emit('play')
user.user = { userId: '2' }; flushWatchers()
await settle()
assert.equal(reports.at(-1).userid, '2') // stale queued events cannot use a new account
const count = reports.length
player.songList = [{ id: 789, type: 'local' }]; player.currentMusic = playback(); flushWatchers()
player.currentMusic.emit('play'); await settle()
assert.equal(reports.length, count + 1) // previous session ends; local content never starts
module.namespace.destroyListenTimeReporter()
assert.equal(watchers.length, 0)
console.log('listening preference, blacklist and playback report checks passed')
