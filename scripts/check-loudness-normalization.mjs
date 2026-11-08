import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule, runInContext } from 'node:vm'

const context = createContext({ console: { ...console }, setTimeout, clearTimeout, AbortController, window: {} })
const mock = exports => new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
}, { context })
async function load(path, dependencies = {}, extraExports = '') {
    const module = new SourceTextModule(await readFile(path, 'utf8') + extraExports, { context, identifier: path })
    await module.link(key => { assert.ok(dependencies[key], `Unexpected import: ${key}`); return dependencies[key] })
    await module.evaluate()
    return module
}
const adaptive = await load('src/utils/adaptiveLoudness.mjs', {
    './adaptiveLoudness.worklet.js?url': mock({ default: 'adaptive-worklet.js' }),
})
const gapless = await load('src/utils/webAudioGapless.js', { './adaptiveLoudness.mjs': adaptive })
const loudness = await load('src/utils/loudnessNormalization.mjs', { './webAudioGapless': gapless, './adaptiveLoudness.mjs': adaptive })
const { prepareHowlAudioProcessing, prepareProtectedPlayback } = loudness.namespace
const { PROTECTED_LOUDNESS_GAIN } = adaptive.namespace
assert.equal(loudness.namespace.calculateLoudnessGain, undefined)
assert.equal(gapless.namespace.configureDynamicCompression, undefined)

// All URL API variants must ignore online loudness fields, even when supplied.
let response
const song = await load('src/api/song.js', {
    './base': mock({ get: async () => response, post() {}, getById() {}, getWithPagination() {}, operationRequest() {} }),
    './params': mock({ buildIdWithTimestamp() {}, buildOperationParams() {}, buildPaginationParams() {} }),
    '../utils/kugouLyric': mock({ normalizeKugouKrcLyric() {} }),
    '../utils/lyricPreference': mock({ findRememberedLyricCandidate() {}, rememberLyricCandidate() {} }),
    '../utils/commentReplies': mock({ parseCommentReply() {} }),
})
const rawMetadata = { volume: -9.9, volume_gain: 60, volume_peak: 0.001 }
response = { status: 1, url: ['https://audio.test/a.mp3'], ...rawMetadata }
const track = (await song.namespace.getMusicUrl('A'.repeat(32), '128')).data[0]
assert.equal(track.loudness, undefined)
response = { status: 1, url: ['https://audio.test/a.mp3'] }
assert.equal((await song.namespace.getMusicUrl('A'.repeat(32))).data[0].loudness, undefined)
response = { status: 2, fail_process: ['pkg', 'buy'] }
assert.equal((await song.namespace.getMusicUrl('A'.repeat(32))).data[0].url, null)
response = { data: [{ quality: '128', info: { tracker_url: ['https://audio.test/a.mp3'], ...rawMetadata }, relate_goods: [
    { quality: 'flac', info: { tracker_url: ['https://audio.test/b.flac'], ...rawMetadata } },
] }] }
for (const quality of ['128', 'flac']) {
    const result = (await song.namespace.getMusicUrlNew('A'.repeat(32), quality)).data[0]
    assert.equal(result.level, quality)
    assert.equal(result.loudness, undefined)
}

const nodes = []
let resume
const audioContext = {
    state: 'running', currentTime: 0, destination: {},
    resume: async () => { audioContext.state = 'running'; if (resume) await resume },
    createGain: () => {
        const node = { gain: { value: 1, setValueAtTime(value) { this.value = value }, cancelScheduledValues() {}, linearRampToValueAtTime(value) { this.value = value } }, connections: [], connect(node) { this.connections.push(node) }, disconnect() { this.connections = []; this.disconnected = true } }
        nodes.push(node)
        return node
    },
    createDynamicsCompressor: () => { assert.fail('unified normalization must not stack another compressor') },
    createMediaElementSource: element => {
        assert.equal(element.crossOrigin, 'anonymous')
        const node = { connections: [], connect(node) { this.connections.push(node) }, disconnect() { this.connections = []; this.disconnected = true } }
        nodes.push(node)
        return node
    },
    decodeAudioData: async () => ({ duration: 10 }),
    createBufferSource: () => ({ playbackRate: { value: 1, setValueAtTime(value) { this.value = value } }, connect() {}, start() {}, stop() {}, disconnect() {} }),
}
context.window.AudioContext = function () { return audioContext }
context.window.HTMLMediaElement = class {
    get volume() { return this.nativeVolume ?? 1 }
    set volume(value) { this.nativeVolume = value }
}
context.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve() }

// Without Worklet support use a protected gain, and never replace the user's volume.
const element = { volume: 0.3, _unlocked: true, load() { this.loads = (this.loads || 0) + 1 } }
const playback = { _sounds: [{ _node: element }], unload() { this.unloaded = true } }
prepareHowlAudioProcessing(playback)
assert.equal(element.loads, 1)
await playback.setLoudnessNormalization(true)
assert.equal(playback.__hmLoudnessMode, 'protected')
assert.equal(nodes.at(-1).gain.value, PROTECTED_LOUDNESS_GAIN)
assert.equal(element.nativeVolume, 1)
assert.equal(element.volume, 0.3)
element.volume = 0.1
assert.equal(nodes[1].gain.value, 0.1)
assert.throws(() => { element.volume = Infinity }, /音量/)
const protectedNode = nodes.at(-1)
await playback.setLoudnessNormalization(false)
assert.equal(protectedNode.disconnected, true)
assert.equal(nodes[0].gain.value, 1)
assert.ok(nodes[0].connections.includes(nodes[1]))
assert.equal(playback.__hmLoudnessMode, 'off')
audioContext.state = 'suspended'
resume = new Promise(resolve => { audioContext.releaseResume = resolve })
const pending = playback.setLoudnessNormalization(true)
await playback.setLoudnessNormalization(false)
audioContext.releaseResume()
await pending
assert.equal(playback.__hmLoudnessMode, 'off')
resume = null
playback.unload()
assert.equal(element._unlocked, false)
assert.ok(nodes.every(node => node.disconnected))

const protectedElement = { volume: 0.3, _unlocked: true }
const protectedPlayback = { _sounds: [{ _node: protectedElement }], unload() {} }
prepareProtectedPlayback(protectedPlayback)
protectedPlayback.setLoudnessProtection(PROTECTED_LOUDNESS_GAIN)
assert.equal(protectedElement.nativeVolume, 0.3 * PROTECTED_LOUDNESS_GAIN)
assert.equal(protectedElement.volume, 0.3)
protectedElement.volume = 0.6
assert.equal(protectedElement.nativeVolume, 0.6 * PROTECTED_LOUDNESS_GAIN)
assert.throws(() => { protectedElement.volume = 2 }, /音量/)
protectedPlayback.setLoudnessProtection(1)
assert.equal(protectedElement.nativeVolume, 0.6)
protectedPlayback.unload()
assert.equal(protectedElement._unlocked, false)

const bufferStart = nodes.length
const bufferPlayer = await gapless.namespace.createDecodedAudioPlayer('https://audio.test/a.mp3')
bufferPlayer.volume(0.3)
await bufferPlayer.setLoudnessNormalization(true)
assert.equal(bufferPlayer.__hmLoudnessMode, 'protected')
assert.equal(bufferPlayer._adaptive.node.gain.value, PROTECTED_LOUDNESS_GAIN)
assert.equal(bufferPlayer.volume(), 0.3)
await bufferPlayer.setLoudnessNormalization(false)
assert.equal(bufferPlayer._adaptive, null)
assert.ok(bufferPlayer._loudnessGain.connections.includes(nodes[bufferStart]))
bufferPlayer.unload()
assert.ok(nodes.slice(bufferStart).every(node => node.disconnected))

// Migrate either old setting to one boolean, remove the strength, and remain idempotent.
const mainSource = await readFile('src/electron/ipcMain.js', 'utf8')
const settingsFunction = mainSource.match(/function normalizeMusicSettings\(music = \{\}\) \{[\s\S]*?\n\}/)[0]
context.normalizeSearchAssistLimit = value => value
context.normalizeMusicLevel = value => value
runInContext(settingsFunction, context)
assert.equal(context.normalizeMusicSettings({ loudnessNormalization: true }).loudnessNormalization, true)
for (const value of [undefined, null, false, 'true', 1]) {
    assert.equal(context.normalizeMusicSettings({ loudnessNormalization: value }).loudnessNormalization, false)
}
for (const value of [true, 1, 2, 3, 4]) {
    const migrated = context.normalizeMusicSettings({ loudnessNormalization: false, dynamicCompression: value })
    assert.equal(migrated.loudnessNormalization, true)
    assert.equal('dynamicCompression' in migrated, false)
    assert.equal(context.normalizeMusicSettings(migrated).loudnessNormalization, true)
    migrated.loudnessNormalization = false
    assert.equal(context.normalizeMusicSettings(migrated).loudnessNormalization, false, 'old strength cannot re-enable the new switch')
}
for (const value of [undefined, null, false, 0, 'true', '2', -1, 5, 1.5, Infinity, [], {}]) {
    const migrated = context.normalizeMusicSettings({ dynamicCompression: value })
    assert.equal(migrated.loudnessNormalization, false)
    assert.equal('dynamicCompression' in migrated, false)
}

// Worklet module is shared; estimates are bounded and conservative, never upstream-derived.
let moduleLoads = 0
const worklets = []
audioContext.audioWorklet = { addModule: async () => { moduleLoads++ } }
context.window.AudioWorkletNode = class {
    constructor(_context, _name, options) {
        this.options = options
        this.connections = []
        this.messages = []
        this.port = { onmessage: null, postMessage: message => this.messages.push(message), close: () => { this.closed = true } }
        worklets.push(this)
    }
    connect(node) { this.connections.push(node) }
    disconnect() { this.connections = []; this.disconnected = true }
}
const cacheSeed = await adaptive.namespace.createAdaptiveLoudness(audioContext, 'source:cache:128')
cacheSeed.node.port.onmessage({ data: { gain: 0.2 } })
cacheSeed.dispose()
const cacheHit = await adaptive.namespace.createAdaptiveLoudness(audioContext, 'source:cache:128')
assert.equal(cacheHit.node.options.processorOptions.initialGain, 0.2)
cacheHit.dispose()
const differentQuality = await adaptive.namespace.createAdaptiveLoudness(audioContext, 'source:cache:flac')
assert.equal(differentQuality.node.options.processorOptions.initialGain, PROTECTED_LOUDNESS_GAIN)
differentQuality.dispose()
const invalidCached = await adaptive.namespace.createAdaptiveLoudness(audioContext, 'source:invalid')
for (const gain of [NaN, Infinity, 0, -1, 4, '0.5']) invalidCached.node.port.onmessage({ data: { gain } })
invalidCached.dispose()
const invalidCacheHit = await adaptive.namespace.createAdaptiveLoudness(audioContext, 'source:invalid')
assert.equal(invalidCacheHit.node.options.processorOptions.initialGain, PROTECTED_LOUDNESS_GAIN)
invalidCacheHit.dispose()
const cacheBoost = await adaptive.namespace.createAdaptiveLoudness(audioContext, 'source:boost')
cacheBoost.node.port.onmessage({ data: { gain: 3 } })
cacheBoost.dispose()
const cappedCache = await adaptive.namespace.createAdaptiveLoudness(audioContext, 'source:boost')
assert.equal(cappedCache.node.options.processorOptions.initialGain, PROTECTED_LOUDNESS_GAIN)
cappedCache.dispose()
for (let i = 0; i < 129; i++) {
    const item = await adaptive.namespace.createAdaptiveLoudness(audioContext, `bounded:${i}`)
    item.node.port.onmessage({ data: { gain: 0.5 } })
    item.dispose()
}
const evictedCache = await adaptive.namespace.createAdaptiveLoudness(audioContext, 'source:cache:128')
assert.equal(evictedCache.node.options.processorOptions.initialGain, PROTECTED_LOUDNESS_GAIN)
evictedCache.dispose()
assert.equal(moduleLoads, 1)
const failedContext = { ...audioContext, audioWorklet: { addModule: async () => { throw new Error('expected worklet load failure') } } }
const warnings = []
context.console.warn = (...args) => warnings.push(args)
const failedWorklet = await adaptive.namespace.createAdaptiveLoudness(failedContext, 'source:failed')
context.console.warn = console.warn
assert.equal(warnings.length, 1)
assert.equal(failedWorklet.realtime, false)
assert.equal(failedWorklet.node.gain.value, PROTECTED_LOUDNESS_GAIN)
failedWorklet.dispose()

const playerStoreModule = await load('src/store/playerStore.js', {
    pinia: mock({ defineStore: (_id, options) => options.state }),
    '../utils/togetherBridge': mock({ getTogetherPersonalSnapshot: () => null }),
})
const playerState = playerStoreModule.namespace.usePlayerStore()
assert.equal('dynamicCompression' in playerState, false)
assert.equal(playerState.loudnessNormalizationActive, false)
assert.equal(playerState.playbackRate, 1)
Object.assign(playerState, { songList: [{ id: 1, name: 'Track' }, { id: 2, name: 'Next' }], songId: 1, loudnessNormalization: true })
const refs = Object.fromEntries(Object.keys(playerState).map(key => [key, {
    get value() { return playerState[key] }, set value(value) { playerState[key] = value },
}]))
const watchers = []
class Howl {
    constructor(options) {
        this.options = options; this._src = options.src; this._state = 'loading'; this._volume = options.volume; this._rate = options.rate ?? 1
        this._sounds = [{ _node: { volume: options.volume, _unlocked: true, load() {} } }]; this.events = new Map(); this.position = 0
        this.on('loaderror', options.onloaderror)
    }
    on(event, fn) { const handlers = this.events.get(event) || []; handlers.push(fn); this.events.set(event, handlers); return this }
    once(event, fn) { const once = (...args) => { this.events.set(event, this.events.get(event).filter(item => item !== once)); fn(...args) }; return this.on(event, once) }
    emit(event, ...args) { if (event === 'load') this._state = 'loaded'; for (const fn of [...(this.events.get(event) || [])]) fn(...args) }
    volume(value) { if (value !== undefined) { this._volume = value; this._sounds[0]._node.volume = value }; return this._volume }
    rate(value) { if (value !== undefined) this._rate = value; return this._rate }
    seek(value) { if (value !== undefined) this.position = value; return this.position }
    duration() { return 10 }
    state() { return this._state }
    playing() { return this.active === true }
    loop() {}
    fade(_from, to) { this.volume(to) }
    play() { this.active = true; this.emit('play') }
    pause() { this.active = false; this.emit('pause') }
    unload() { this.active = false; this._state = 'unloaded' }
}
const noop = () => {}
const bridge = new Proxy({}, { get: () => noop })
Object.assign(context.window, { playerApi: bridge, addEventListener: noop, dispatchEvent: noop })
Object.assign(context, { windowApi: bridge, navigator: {}, CustomEvent: class {}, setInterval: () => 1, clearInterval: noop })
const playerSource = await readFile('src/utils/player.js', 'utf8')
const playerDependencies = {}
for (const [, imported, key] of playerSource.matchAll(/^import\s+([\s\S]+?)\s+from\s+["']([^"']+)["'];?/gm)) {
    const names = imported.startsWith('{') ? imported.replace(/[{}]/g, '').split(',').map(name => name.trim()).filter(Boolean) : ['default']
    playerDependencies[key] = mock(Object.fromEntries(names.map(name => [name, async () => ({})])))
}
Object.assign(playerDependencies, {
    './togetherBridge': mock({ interceptTogetherControl: () => false, isTogetherPlayback: () => false }),
    vue: mock({ markRaw: value => value, watch: (source, callback) => { watchers.push({ source, callback }) } }),
    pinia: mock({ storeToRefs: store => store === playerState ? refs : {} }),
    howler: mock({ Howl, Howler: { unload: noop } }),
    '../store/playerStore': mock({ usePlayerStore: () => playerState }),
    '../store/otherStore': mock({ useOtherStore: () => ({}) }),
    '../store/userStore': mock({ useUserStore: () => ({}) }),
    '../store/libraryStore': mock({ useLibraryStore: () => ({}) }),
    './loudnessNormalization.mjs': loudness,
    './adaptiveLoudness.mjs': adaptive,
    './webAudioGapless': gapless,
    './otherAudioPause.mjs': await load('src/utils/otherAudioPause.mjs'),
    './authority': mock({ isLogin: () => true }),
    './siren': mock({ isSirenSong: () => false, getSirenSourceId: () => '', getSirenAudioExtension: () => '' }),
    '../api/song': mock({ checkMusic: async () => ({ success: true }), likeMusic: noop, getLyric: async () => ({}), getSongClimax: async () => ({}) }),
    './musicUrlResolver': mock({ resolveTrackByQualityPreference: async () => track }),
    './quality': await load('src/utils/quality.js'),
    './player/playbackTicker': mock({ PLAYBACK_TICK_FAST_INTERVAL_MS: 100, subscribePlaybackTick: () => noop }),
})
const player = await load('src/utils/player.js', playerDependencies, '\nexport { refreshStreamAndResume, preloadGaplessSong, startGaplessTarget };')
const processingWatcher = watchers.find(item => item.source === refs.loudnessNormalization)
assert.ok(processingWatcher)

// Deliberately pass stale upstream metadata: every track must still use the same local path.
player.namespace.play(track.url, true, null, null, { trackInfo: { ...track, loudness: { volume: -100, gain: 60, peak: 0.001 } } })
let active = playerState.currentMusic
assert.equal(playerState.loudnessNormalizationActive, false)
active.emit('load'); await settle()
assert.equal(active.__hmLoudnessMetadata, undefined)
assert.equal(active.__hmLoudnessMode, 'realtime')
assert.equal(playerState.loudnessNormalizationActive, true)
assert.equal(active.playing(), true)
assert.equal(active.volume(), 0.3)
const streamWorklet = worklets.at(-1)
assert.equal(streamWorklet.options.processorOptions.initialGain, PROTECTED_LOUDNESS_GAIN)
assert.ok(streamWorklet.messages.some(message => message.type === 'running' && message.value))
active.pause()
assert.equal(streamWorklet.messages.at(-1).value, false)
active.emit('seek')
assert.equal(streamWorklet.messages.at(-1).type, 'reset')
processingWatcher.callback(); await settle()
assert.equal(worklets.at(-1), streamWorklet, 're-applying the switch reuses one processor')
assert.equal(streamWorklet.connections.length, 1)
active.volume(0.1)
assert.equal(streamWorklet.options.processorOptions.initialGain, PROTECTED_LOUDNESS_GAIN)
playerState.loudnessNormalization = false
processingWatcher.callback(); await settle()
assert.equal(streamWorklet.closed, true)
assert.equal(playerState.loudnessNormalizationActive, false)
assert.equal(playerState.volume, 0.3)
playerState.loudnessNormalization = true
player.namespace.setPlaybackRate(1.25)
assert.equal(active.rate(), 1.25)
player.namespace.setPlaybackRate(1)
await player.namespace.refreshStreamAndResume('loaderror')
active = playerState.currentMusic
active.emit('load'); await settle()
assert.equal(active.__hmLoudnessMode, 'realtime')
const entry = await player.namespace.preloadGaplessSong()
assert.ok(entry?.player)
await player.namespace.getSongUrl(2, 1, false, false)
assert.equal(playerState.currentMusic, active)
playerState.songId = 2; playerState.currentIndex = 1
await player.namespace.getSongUrl(2, 1, false, false); await settle()
assert.equal(playerState.currentMusic, entry.player)
assert.equal(entry.player.__hmLoudnessMode, 'realtime')
assert.equal(playerState.loudnessNormalizationActive, true)
playerState.songList[1]._chorusPrefetch = { url: 'https://audio.test/new.mp3', level: '128', trackInfo: { loudness: { volume: -20, gain: 0, peak: 0.2 } } }
await player.namespace.getSongUrl(2, 1, false, false); await settle()
playerState.currentMusic.emit('load'); await settle()
assert.equal(playerState.currentMusic.__hmLoudnessMode, 'realtime')
player.namespace.play('https://audio.test/no-metadata.mp3', true)
assert.equal(playerState.loudnessNormalizationActive, false)
playerState.currentMusic.emit('load'); await settle()
assert.equal(playerState.loudnessNormalizationActive, true)
assert.equal(worklets.at(-1).options.processorOptions.initialGain, PROTECTED_LOUDNESS_GAIN)
const gaplessEntry = await player.namespace.preloadGaplessSong()
assert.ok(gaplessEntry?.player)
player.namespace.startGaplessTarget({ id: 1, index: 0, song: playerState.songList[0] }, gaplessEntry)
await settle()
assert.equal(playerState.currentMusic, gaplessEntry.player)
assert.equal(playerState.currentMusic.__hmLoudnessMode, 'realtime')
assert.equal(playerState.loudnessNormalizationActive, true)

// CORS fallback is protected, switchable, and never claims successful real-time analysis.
player.namespace.play(track.url, true)
active = playerState.currentMusic
active.emit('loaderror', 1, 'CORS rejected')
const fallback = playerState.currentMusic
assert.notEqual(fallback, active)
assert.equal(fallback.__hmAudioProcessingUnavailable, true)
fallback.emit('load'); await settle()
assert.equal(fallback.playing(), true)
assert.equal(fallback._sounds[0]._node.nativeVolume, playerState.volume * PROTECTED_LOUDNESS_GAIN)
assert.equal(playerState.loudnessNormalizationActive, false)
playerState.loudnessNormalization = false
processingWatcher.callback(); await settle()
assert.equal(fallback._sounds[0]._node.nativeVolume, playerState.volume)
playerState.loudnessNormalization = true
processingWatcher.callback(); await settle()
assert.equal(fallback._sounds[0]._node.nativeVolume, playerState.volume * PROTECTED_LOUDNESS_GAIN)
player.namespace.play(track.url, true)
active = playerState.currentMusic
player.namespace.pauseMusic()
active.emit('load'); await settle()
assert.equal(active.playing(), false)

playerState.loudnessNormalization = false
playerState.playing = false
player.namespace.play('file:///C:/music/local.wav', false)
active = playerState.currentMusic
assert.equal(active.setLoudnessNormalization, undefined)
playerState.loudnessNormalization = true
processingWatcher.callback()
assert.equal(active.state(), 'unloaded')
active = playerState.currentMusic
active.emit('load'); await settle()
assert.equal(active.__hmLoudnessMode, 'realtime')
assert.equal(active.playing(), false)
playerState.loudnessNormalization = false
processingWatcher.callback(); await settle()
playerState.loudnessNormalization = true
processingWatcher.callback()
playerState.loudnessNormalization = false
processingWatcher.callback(); await settle()
assert.equal(worklets.at(-1).closed, true, 'stale allocation is disposed after disable')
assert.equal(playerState.loudnessNormalizationActive, false)

playerState.loudnessNormalization = true
processingWatcher.callback(); await settle()
audioContext.state = 'suspended'
resume = new Promise(resolve => { audioContext.releaseResume = resolve })
processingWatcher.callback()
player.namespace.play('https://audio.test/replacement.mp3', false)
audioContext.releaseResume(); await settle()
assert.equal(playerState.loudnessNormalizationActive, false)
playerState.currentMusic.emit('load'); await settle()
assert.equal(playerState.loudnessNormalizationActive, true)
resume = null
playerState.currentMusic.unload()

const decoded = await gapless.namespace.createDecodedAudioPlayer('https://audio.test/gapless-live.mp3')
await decoded.setLoudnessNormalization(true)
const decodedWorklet = worklets.at(-1)
assert.equal(decoded.__hmLoudnessMode, 'realtime')
assert.equal(decodedWorklet.messages.at(-1).value, false)
await decoded.play()
assert.equal(decodedWorklet.messages.at(-1).value, true)
decoded.pause()
assert.equal(decodedWorklet.messages.at(-1).value, false)
decoded.seek(2)
assert.equal(decodedWorklet.messages.at(-1).type, 'reset')
await decoded.setLoudnessNormalization(false)
assert.equal(decodedWorklet.closed, true)
assert.equal(decoded._loudnessGain.gain.value, 1)
const pendingDecoded = decoded.setLoudnessNormalization(true)
decoded.unload()
await pendingDecoded
assert.equal(worklets.at(-1).closed, true)
const suspendedPlayer = await gapless.namespace.createDecodedAudioPlayer('https://audio.test/suspended.mp3')
audioContext.state = 'suspended'
resume = new Promise(resolve => { audioContext.releaseResume = resolve })
const suspendedPlay = suspendedPlayer.play()
suspendedPlayer.pause()
audioContext.releaseResume()
await suspendedPlay
assert.equal(suspendedPlayer.playing(), false)
resume = null
suspendedPlayer.unload()
const preloaded = await gapless.namespace.createDecodedAudioPlayer('https://audio.test/preloaded-live.mp3')
player.namespace.play('https://audio.test/preloaded-live.mp3', true, null, preloaded)
assert.equal(preloaded.playing(), false)
player.namespace.pauseMusic()
await settle()
assert.equal(preloaded.playing(), false)
assert.equal(playerState.loudnessNormalizationActive, true)
preloaded.unload()

const settingsSource = await readFile('src/views/Settings.vue', 'utf8')
assert.ok(settingsSource.includes('>响度均衡</div>'))
assert.ok(settingsSource.includes('本地实时分析音频'))
assert.ok(!settingsSource.includes('dynamicCompression'))
assert.ok(!settingsSource.includes('压缩强度'))
assert.ok(!playerSource.includes('trackInfo?.loudness'))
const initSource = await readFile('src/utils/initApp.js', 'utf8')
assert.ok(initSource.includes('playerStore.loudnessNormalization = settings?.music?.loudnessNormalization === true'))
assert.ok(!initSource.includes('dynamicCompression'))
console.log('local unified loudness: upstream ignored, single processor, streaming/gapless, volume, bypass, protected fallback, cache, pause/seek, races, cleanup and legacy settings migration passed')
