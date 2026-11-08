import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { encodePCM, normalizeRecognitionResults, recordAudioSample, readRecognitionHistory, saveRecognitionHistory, recognitionErrorMessage } from '../src/utils/audioRecognition.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const hash = 'abcdef0123456789abcdef0123456789'
const songs = normalizeRecognitionResults({ status: 1, data: [
    { songname: '测试歌曲', singername: '歌手', hash_128: hash, album: [{ albumname: '专辑', album_id: 4, album_audio_id: 9 }], union_cover: 'https://example.com/{size}.jpg', songNameSuffix: '现场版', timelength_128: 123000 },
    { songname: '重复', hash: hash.toUpperCase() }, { songname: '只知道名字', singername: '歌手' }, null,
] })
assert.equal(songs.length, 2)
assert.equal(songs[0].hash, hash)
assert.equal(songs[0].id, '9')
assert.equal(songs[0].al.name, '专辑')
assert.equal(songs[0].coverUrl, 'https://example.com/240.jpg')
assert.equal(songs[0].name, '测试歌曲 (现场版)')
assert.equal(songs[1].hash, '')
assert.deepEqual(normalizeRecognitionResults({ status: 1, data: [] }), [])
assert.throws(() => normalizeRecognitionResults({ status: 0, msg: '服务故障' }), /服务故障/)
assert.throws(() => normalizeRecognitionResults({ status: 1, data: {} }), /无法解析/)
const pcm = new DataView(encodePCM([-2, -1, 0, 1, 2, NaN]))
assert.deepEqual(Array.from({ length: 6 }, (_, i) => pcm.getInt16(i * 2, true)), [-32768, -32768, 0, 32767, 32767, 0])
const storage = { value: '', getItem() { return this.value }, setItem(key, value) { this.value = value } }
assert.deepEqual(readRecognitionHistory(storage), [])
storage.value = '{broken'
assert.deepEqual(readRecognitionHistory(storage), [])
let history = saveRecognitionHistory([], songs[0], 'system', storage)
history = saveRecognitionHistory(history, songs[0], 'microphone', storage)
assert.equal(history.length, 1)
assert.equal(readRecognitionHistory(storage)[0].source, 'microphone')
for (let i = 0; i < 20; i++) history = saveRecognitionHistory(history, { ...songs[0], hash: String(i) }, 'system', storage)
assert.equal(history.length, 12)
assert.ok(!storage.value.includes('pcm'))
assert.match(recognitionErrorMessage({ name: 'NotAllowedError' }, 'system'), /授权/)
assert.match(recognitionErrorMessage({ name: 'NotSupportedError' }, 'system'), /内录支持/)
assert.doesNotMatch(recognitionErrorMessage({ name: 'NotAllowedError' }, 'system'), /切换音频输入|麦克风|虚拟声卡/)

// 真实执行录音生命周期：正常停止、取消、设备中断、初始化失败都释放音频及伴随视频轨道。
const original = { MediaRecorder: globalThis.MediaRecorder, MediaStream: globalThis.MediaStream, AudioContext: globalThis.AudioContext }
class Track extends EventTarget { readyState = 'live'; stopped = false; stop() { this.stopped = true; this.readyState = 'ended' } }
class Recorder {
    static isTypeSupported() { return true }
    state = 'inactive'; mimeType = 'audio/webm'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.() }) }
}
globalThis.MediaRecorder = Recorder
globalThis.MediaStream = class { constructor(tracks) { this.tracks = tracks } }
globalThis.AudioContext = undefined
const makeStream = () => {
    const audio = new Track(), video = new Track()
    return { audio, video, getTracks: () => [audio, video], getAudioTracks: () => [audio] }
}
try {
    let stream = makeStream()
    const blob = await recordAudioSample(stream, { durationMs: 1 })
    assert.ok(blob.size > 0)
    assert.ok(stream.audio.stopped && stream.video.stopped)
    stream = makeStream()
    const abort = new AbortController()
    const pending = recordAudioSample(stream, { signal: abort.signal })
    abort.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.ok(stream.audio.stopped && stream.video.stopped)
    stream = makeStream()
    const ended = recordAudioSample(stream)
    stream.audio.dispatchEvent(new Event('ended'))
    await assert.rejects(ended, /中断/)
    assert.ok(stream.audio.stopped && stream.video.stopped)
    stream = makeStream()
    stream.audio.readyState = 'ended'
    await assert.rejects(recordAudioSample(stream), /不可用/)
    assert.ok(stream.video.stopped)
} finally { Object.assign(globalThis, original) }

// 在隔离 VM 中模拟三平台 Electron，检查来源校验、一次性授权和异步取消竞态。
for (const platform of ['win32', 'darwin', 'linux']) {
    const handlers = new Map(), permissions = {}, listeners = {}
    let releaseSources = null
    const frame = { url: 'file:///D:/app/dist/index.html' }
    const win = { isDestroyed: () => false, webContents: { mainFrame: frame, getURL: () => frame.url, session: {
        setPermissionCheckHandler: fn => { permissions.check = fn },
        setPermissionRequestHandler: fn => { permissions.request = fn },
        setDisplayMediaRequestHandler: fn => { permissions.display = fn },
    } }, once: (name, fn) => { listeners[name] = fn } }
    const electron = {
        desktopCapturer: { getSources: () => new Promise(resolve => { releaseSources = resolve }) },
        ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) },
        systemPreferences: { askForMediaAccess: async () => true },
    }
    const context = vm.createContext({ require: name => { assert.equal(name, 'electron'); return electron }, module: { exports: {} }, process: { platform }, URL, Date })
    vm.runInContext(read('../src/electron/audioRecognition.js'), context)
    context.module.exports.installAudioRecognition(win)
    const event = { sender: win.webContents, senderFrame: frame }
    const prepare = handlers.get('audio-recognition:prepare'), cancel = handlers.get('audio-recognition:cancel')
    assert.equal(permissions.check(win.webContents, 'media', '', { isMainFrame: true, mediaType: 'audio' }), false)
    assert.equal(permissions.check(win.webContents, 'clipboard-sanitized-write', '', {}), true, '不得破坏既有剪贴板行为')
    await assert.rejects(prepare({ ...event, senderFrame: { url: frame.url } }, 'system', 'a'), /不允许/)
    await assert.rejects(prepare(event, 'camera', 'a'), /仅支持电脑声音/)
    await assert.rejects(prepare(event, 'microphone', 'a'), /仅支持电脑声音/)
    assert.equal(permissions.check(win.webContents, 'media', '', { isMainFrame: true, mediaType: 'audio' }), false)
    assert.equal(permissions.check(win.webContents, 'media', '', { isMainFrame: true, mediaType: 'video' }), false)
    assert.equal(permissions.check(win.webContents, 'media', '', { isMainFrame: false, mediaType: 'audio' }), false)
    await prepare(event, 'system', 'b')
    let mediaGranted
    permissions.request(win.webContents, 'display-capture', value => { mediaGranted = value }, { isMainFrame: true })
    assert.equal(mediaGranted, true)
    permissions.request(win.webContents, 'media', value => { mediaGranted = value }, { isMainFrame: true, mediaTypes: [] })
    assert.equal(mediaGranted, true, 'Electron 42 系统内录会先请求 mediaTypes=[] 的 media 权限')
    permissions.request(win.webContents, 'media', value => { mediaGranted = value }, { isMainFrame: true, mediaTypes: ['video'] })
    assert.equal(mediaGranted, false, '系统内录授权不得被用于摄像头')
    permissions.request(win.webContents, 'media', value => { mediaGranted = value }, { isMainFrame: true, mediaTypes: ['audio'] })
    assert.equal(mediaGranted, false, '系统内录授权不得被用于麦克风')
    let result = 'pending'
    const request = { frame, audioRequested: true }
    const pending = permissions.display(request, value => { result = value })
    cancel(event, 'b')
    releaseSources([{ id: 'screen:0' }])
    await pending
    assert.equal(result, null, '取消后到达的屏幕来源不可再授权')
    await prepare(event, 'system', 'c')
    cancel(event, 'b')
    const success = permissions.display(request, value => { result = value })
    releaseSources([{ id: 'screen:0' }])
    await success
    assert.equal(result.audio, 'loopback')
    await permissions.display(request, value => { result = value })
    assert.equal(result, null, '同一次用户操作不可重复采集')
    cancel(event, 'c')
    assert.equal(permissions.check(win.webContents, 'display-capture', '', {}), false)
    listeners.closed()
    assert.equal(handlers.size, 0)
}

const component = read('../src/components/AudioRecognition.vue')
assert.match(component, /aria-modal="true"/)
assert.match(component, /prefers-reduced-motion/)
assert.match(component, /:global\(\.dark \.recognition-panel\)/, '深色覆盖必须命中面板，不能误生成根 .dark 规则')
assert.match(component, /overflow-x: hidden/)
assert.doesNotMatch(component, /background: var\(--panel\)/, '识曲面板不能透出页面封面')
assert.match(component, /createProgressiveRecognition/)
assert.doesNotMatch(component, /getUserMedia|enumerateDevices|devicechange|chooseSource|recognition-device|<select/)
assert.match(component, /prepareAudioRecognition\?\.\('system', captureId\)/)
assert.match(component, /getDisplayMedia/)
assert.match(component, /期间可能分次上传/)
assert.match(component, /if \(!current\(\)\) return/)
assert.match(component, /stream\?\.getTracks\(\)\.forEach\(track => track.stop\(\)\)/)
assert.match(component, /togetherStore.room/)
assert.match(component, /v-if="song.hash"/)
assert.match(read('../src/api/audioRecognition.js'), /application\/octet-stream/)
assert.match(read('../src/api/audioRecognition.js'), /params: \{ timestamp:/)
const config = read('../electron-builder.config.cjs')
assert.doesNotMatch(config, /NSMicrophoneUsageDescription/)
assert.match(config, /NSAudioCaptureUsageDescription/)
console.log('听歌识曲检查通过：PCM、结果适配、记录、录音释放及三平台权限/取消竞态（模拟）。')
