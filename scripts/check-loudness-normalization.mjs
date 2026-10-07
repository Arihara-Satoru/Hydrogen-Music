import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule, runInContext } from 'node:vm'

const context = createContext({ console, setTimeout, clearTimeout, AbortController, window: {} })
const mock = exports => new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
}, { context })
async function load(path, dependencies = {}, extraExports = '') {
    const module = new SourceTextModule(await readFile(path, 'utf8') + extraExports, { context, identifier: path })
    await module.link(key => { assert.ok(dependencies[key], `Unexpected import: ${key}`); return dependencies[key] })
    await module.evaluate()
    return module
}
const gapless = await load('src/utils/webAudioGapless.js')
const loudness = await load('src/utils/loudnessNormalization.mjs', { './webAudioGapless': gapless })
const { calculateLoudnessGain, prepareHowlAudioProcessing } = loudness.namespace
const metadata = { volume: -9.9, gain: 0, peak: 0.6 }
const expected = 10 ** (-4.1 / 20)
assert.ok(Math.abs(calculateLoudnessGain(metadata) - expected) < 1e-12)
assert.equal(calculateLoudnessGain({ volume: -30, gain: 0, peak: 0.01 }), 3)
assert.equal(calculateLoudnessGain({ volume: -30, gain: 0, peak: 1.6 }), 0.95 / 1.6)
assert.equal(calculateLoudnessGain({ volume: -100, gain: 60, peak: 1000 }), 0.00095)
assert.equal(calculateLoudnessGain({ volume: 0, gain: 0, peak: 1 }), 10 ** (-14 / 20))
assert.equal(calculateLoudnessGain({ volume: '-14', gain: '6', peak: '0.2' }), 10 ** (6 / 20))
for (const invalid of [null, {}, { ...metadata, peak: 0 }, { ...metadata, peak: -1 }, { ...metadata, volume: 1 }, { ...metadata, volume: -101 }, { ...metadata, gain: 61 }]) {
    assert.equal(calculateLoudnessGain(invalid), 1)
}
for (const key of ['volume', 'gain', 'peak']) {
    for (const value of [undefined, null, '', ' ', true, [], {}, 'bad', NaN, Infinity, -Infinity]) {
        assert.equal(calculateLoudnessGain({ ...metadata, [key]: value }), 1)
    }
}

let response
const song = await load('src/api/song.js', {
    './base': mock({ get: async () => response, post() {}, getById() {}, getWithPagination() {}, operationRequest() {} }),
    './params': mock({ buildIdWithTimestamp() {}, buildOperationParams() {}, buildPaginationParams() {} }),
    '../utils/kugouLyric': mock({ normalizeKugouKrcLyric() {} }),
    '../utils/lyricPreference': mock({ findRememberedLyricCandidate() {}, rememberLyricCandidate() {} }),
    '../utils/commentReplies': mock({ parseCommentReply() {} }),
})
const rawMetadata = { volume: -9.9, volume_gain: 0, volume_peak: 0.6 }
response = { status: 1, url: ['https://audio.test/a.mp3'], ...rawMetadata }
const track = (await song.namespace.getMusicUrl('A'.repeat(32), '128')).data[0]
assert.deepEqual(JSON.parse(JSON.stringify(track.loudness)), metadata)
response = { status: 1, url: ['https://audio.test/a.mp3'] }
assert.equal((await song.namespace.getMusicUrl('A'.repeat(32))).data[0].loudness, null)
response = { status: 2, fail_process: ['pkg', 'buy'] }
assert.equal((await song.namespace.getMusicUrl('A'.repeat(32))).data[0].url, null)
response = { data: [{ quality: '128', info: { tracker_url: ['https://audio.test/a.mp3'], ...rawMetadata }, relate_goods: [
    { quality: 'flac', info: { tracker_url: ['https://audio.test/b.flac'], volume: -20, volume_gain: 2, volume_peak: 1.6 } },
] }] }
assert.equal((await song.namespace.getMusicUrlNew('A'.repeat(32), 'flac')).data[0].loudness.volume, -20)
assert.equal((await song.namespace.getMusicUrlNew('A'.repeat(32), '128')).data[0].loudness.volume, -9.9)
response = { data: [{ quality: 'flac', ...rawMetadata, info: { tracker_url: ['https://audio.test/b.flac'], volume: -20 } }] }
assert.equal((await song.namespace.getMusicUrlNew('A'.repeat(32), 'flac')).data[0].loudness, null) // never combine partial metadata from different levels

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
    createDynamicsCompressor: () => {
        const node = { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connections: [], connect(node) { this.connections.push(node) }, disconnect() { this.connections = []; this.disconnected = true } }
        nodes.push(node)
        return node
    },
    createMediaElementSource: element => {
        assert.equal(element.crossOrigin, 'anonymous')
        const node = { connect() {}, disconnect() { this.disconnected = true } }
        nodes.push(node)
        return node
    },
    decodeAudioData: async () => ({ duration: 10 }),
    createBufferSource: () => ({ connect() {}, start() {}, stop() {}, disconnect() {} }),
}
context.window.AudioContext = function () { return audioContext }
context.window.HTMLMediaElement = class {
    get volume() { return this.nativeVolume ?? 1 }
    set volume(value) { this.nativeVolume = value }
}
const element = { volume: 0.3, _unlocked: true, load() { this.loads = (this.loads || 0) + 1 } }
const playback = { _sounds: [{ _node: element }], unload() { this.unloaded = true } }
prepareHowlAudioProcessing(playback)
assert.equal(element.loads, 1)
await playback.setAudioProcessing(expected)
assert.equal(nodes[0].gain.value, expected)
await playback.setAudioProcessing(1)
assert.equal(nodes[0].gain.value, 1)
assert.equal(nodes.length, 3) // toggle reuses the media source
assert.equal(element.nativeVolume, 1)
assert.equal(element.volume, 0.3)
element.volume = 0.1
assert.equal(nodes[1].gain.value, 0.1) // user volume remains after processing
assert.throws(() => { element.volume = Infinity }, /音量/)
audioContext.state = 'suspended'
resume = new Promise(resolve => { audioContext.releaseResume = resolve })
const pending = playback.setAudioProcessing(expected, 1)
await playback.setAudioProcessing(1, 0)
audioContext.releaseResume()
await pending
assert.equal(nodes[0].gain.value, 1) // stale async updates cannot re-enable normalization
playback.unload()
assert.equal(element._unlocked, false) // routed HTML5 elements cannot return to Howler's pool
assert.ok(nodes.every(node => node.disconnected))
context.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })
const bufferStart = nodes.length
const bufferPlayer = await gapless.namespace.createDecodedAudioPlayer('https://audio.test/a.mp3')
bufferPlayer.volume(0.3)
bufferPlayer.setAudioProcessing(expected)
assert.equal(nodes[bufferStart].gain.value, 0.3)
assert.equal(nodes[bufferStart + 1].gain.value, expected)
assert.equal(bufferPlayer.volume(), 0.3) // user volume and loudness remain independent
bufferPlayer.setAudioProcessing(expected, 1)
const bufferCompressor = nodes.at(-2)
assert.equal(bufferCompressor.threshold.value, -18)
assert.equal(bufferCompressor.ratio.value, 2)
assert.ok(nodes[bufferStart + 1].connections.includes(bufferCompressor))
assert.ok(nodes.at(-1).connections.includes(nodes[bufferStart]))
const bufferNodeCount = nodes.length
for (const [level, threshold, ratio, makeup] of [[2, -22, 3, 0.43], [3, -26, 4, 0.33], [1, -18, 2, 0.6]]) {
    bufferPlayer.setAudioProcessing(expected, level)
    assert.equal(bufferCompressor.threshold.value, threshold)
    assert.equal(bufferCompressor.ratio.value, ratio)
    assert.equal(nodes.at(-1).gain.value, makeup)
    assert.equal(nodes.length, bufferNodeCount) // strength changes reuse nodes
    assert.equal(nodes.at(-1).connections.length, 1) // no duplicate output connections
}
assert.throws(() => gapless.namespace.configureDynamicCompression(audioContext, 4), /无效/)
bufferPlayer.setAudioProcessing(expected, 0)
assert.ok(nodes[bufferStart + 1].connections.includes(nodes[bufferStart]))
assert.equal(nodes.at(-1).connections.length, 0) // complete bypass
bufferPlayer.unload()
assert.ok(nodes.slice(bufferStart).every(node => node.disconnected))

const mainSource = await readFile('src/electron/ipcMain.js', 'utf8')
const settingsFunction = mainSource.match(/function normalizeMusicSettings\(music = \{\}\) \{[\s\S]*?\n\}/)[0]
context.normalizeSearchAssistLimit = value => value
context.normalizeMusicLevel = value => value
runInContext(settingsFunction, context)
assert.equal(context.normalizeMusicSettings({ loudnessNormalization: true }).loudnessNormalization, true)
assert.equal(context.normalizeMusicSettings({ dynamicCompression: true }).dynamicCompression, 1)
for (const value of [undefined, null, false, 'true', 1]) {
    assert.equal(context.normalizeMusicSettings({ loudnessNormalization: value }).loudnessNormalization, false)
}
for (const value of [undefined, null, false, 'true', '2', -1, 4, 1.5, Infinity, [], {}]) {
    assert.equal(context.normalizeMusicSettings({ dynamicCompression: value }).dynamicCompression, 0)
}
for (const level of [0, 1, 2, 3]) assert.equal(context.normalizeMusicSettings({ dynamicCompression: level }).dynamicCompression, level)

// Exercise the real player entry points so metadata cannot get lost in a sibling playback path.
const playerStoreModule = await load('src/store/playerStore.js', { pinia: mock({ defineStore: (_id, options) => options.state }) })
const playerState = playerStoreModule.namespace.usePlayerStore()
assert.equal(playerState.dynamicCompression, 0)
assert.equal(playerState.loudnessNormalizationActive, false)
Object.assign(playerState, { songList: [{ id: 1, name: 'Track' }, { id: 2, name: 'Next' }], songId: 1, loudnessNormalization: true })
const refs = Object.fromEntries(Object.keys(playerState).map(key => [key, {
    get value() { return playerState[key] }, set value(value) { playerState[key] = value },
}]))
const watchers = []
class Howl {
    constructor(options) {
        this.options = options; this._src = options.src; this._state = 'loading'; this._volume = options.volume
        this._sounds = [{ _node: { volume: options.volume, _unlocked: true, load() {} } }]; this.events = new Map(); this.position = 0
        this.on('loaderror', options.onloaderror)
    }
    on(event, fn) { const handlers = this.events.get(event) || []; handlers.push(fn); this.events.set(event, handlers); return this }
    once(event, fn) { const once = (...args) => { this.events.set(event, this.events.get(event).filter(item => item !== once)); fn(...args) }; return this.on(event, once) }
    emit(event, ...args) { if (event === 'load') this._state = 'loaded'; for (const fn of [...(this.events.get(event) || [])]) fn(...args) }
    volume(value) { if (value !== undefined) { this._volume = value; this._sounds[0]._node.volume = value }; return this._volume }
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
    vue: mock({ markRaw: value => value, watch: (source, callback) => { watchers.push({ source, callback }) } }),
    pinia: mock({ storeToRefs: store => store === playerState ? refs : {} }),
    howler: mock({ Howl, Howler: { unload: noop } }),
    '../store/playerStore': mock({ usePlayerStore: () => playerState }),
    '../store/otherStore': mock({ useOtherStore: () => ({}) }),
    '../store/userStore': mock({ useUserStore: () => ({}) }),
    '../store/libraryStore': mock({ useLibraryStore: () => ({}) }),
    './loudnessNormalization.mjs': loudness,
    './webAudioGapless': gapless,
    './otherAudioPause.mjs': await load('src/utils/otherAudioPause.mjs'),
    './authority': mock({ isLogin: () => true }),
    './siren': mock({ isSirenSong: () => false, getSirenSourceId: () => '', getSirenAudioExtension: () => '' }),
    '../api/song': mock({ checkMusic: async () => ({ success: true }), likeMusic: noop, getLyric: async () => ({}), getSongClimax: async () => ({}) }),
    './musicUrlResolver': mock({ resolveTrackByQualityPreference: async () => track }),
    './quality': mock({ getPreferredQuality: () => '128' }),
    './player/playbackTicker': mock({ PLAYBACK_TICK_FAST_INTERVAL_MS: 100, subscribePlaybackTick: () => noop }),
})
const player = await load('src/utils/player.js', playerDependencies, '\nexport { refreshStreamAndResume, preloadGaplessSong, startGaplessTarget };')
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
player.namespace.play(track.url, true, null, null, { trackInfo: track })
let active = playerState.currentMusic
assert.equal(playerState.loudnessNormalizationActive, false) // loading is not applied processing
active.emit('load'); await settle()
assert.equal(playerState.loudnessNormalizationActive, true)
assert.equal(active.playing(), true)
assert.equal(active.volume(), 0.3)
assert.equal(nodes.at(-3).gain.value, expected)
playerState.loudnessNormalization = false
const processingWatcher = watchers.find(item => Array.isArray(item.source) && item.source.includes(refs.dynamicCompression))
processingWatcher.callback()
await settle()
assert.equal(nodes.at(-3).gain.value, 1)
assert.equal(playerState.loudnessNormalizationActive, false)
assert.equal(playerState.volume, 0.3)
playerState.loudnessNormalization = true
await player.namespace.refreshStreamAndResume('loaderror')
active = playerState.currentMusic
assert.equal(active.__hmLoudnessMetadata.volume, -9.9)
active.emit('load'); await settle()
const entry = await player.namespace.preloadGaplessSong()
assert.ok(entry?.trackInfo.loudness)
await player.namespace.getSongUrl(2, 1, false, false) // selecting the preloaded track through the normal queue
assert.equal(playerState.currentMusic, active) // stale request must not consume it
playerState.songId = 2; playerState.currentIndex = 1
await player.namespace.getSongUrl(2, 1, false, false)
assert.equal(playerState.currentMusic, entry.player)
assert.equal(playerState.currentMusic.__hmLoudnessMetadata.volume, -9.9)
await settle()
assert.equal(playerState.loudnessNormalizationActive, true) // decoded gapless player
assert.equal(nodes.at(-1).gain.value, expected)
playerState.songList[1]._chorusPrefetch = { url: 'https://audio.test/new.mp3', level: '128', trackInfo: { loudness: { volume: -20, gain: 0, peak: 0.2 } } }
await player.namespace.getSongUrl(2, 1, false, false)
assert.equal(playerState.currentMusic.__hmLoudnessMetadata.volume, -20)
const nodeCount = nodes.length
player.namespace.play('https://audio.test/missing.mp3', true)
assert.equal(playerState.loudnessNormalizationActive, false) // clear immediately, before the next track loads
assert.equal(playerState.currentMusic.__hmLoudnessMetadata, null)
playerState.currentMusic.emit('load'); await settle()
assert.equal(nodes.length, nodeCount) // the next track cannot inherit a previous track's attenuation
assert.equal(playerState.loudnessNormalizationActive, false)
player.namespace.play(track.url, true, null, null, { trackInfo: track })
active = playerState.currentMusic
active.emit('loaderror', 1, 'CORS rejected')
const fallback = playerState.currentMusic
assert.notEqual(fallback, active)
assert.equal(fallback.__hmAudioProcessingUnavailable, true)
fallback.emit('load'); await settle()
assert.equal(fallback.playing(), true)
assert.equal(playerState.loudnessNormalizationActive, false) // CORS fallback cannot claim normalization
player.namespace.play(track.url, true, null, null, { trackInfo: track })
active = playerState.currentMusic
player.namespace.pauseMusic()
active.emit('load'); await settle()
assert.equal(active.playing(), false) // an async load must not undo a manual pause

playerState.loudnessNormalization = false
playerState.playing = false
player.namespace.play('file:///C:/music/local.wav', false)
active = playerState.currentMusic
assert.equal(active.setAudioProcessing, undefined) // both options off: ordinary HTML5 playback
playerState.dynamicCompression = 1
processingWatcher.callback()
assert.equal(active.state(), 'unloaded')
active = playerState.currentMusic
const compressionStart = nodes.length
active.emit('load'); await settle()
assert.equal(active.__hmLoudnessMetadata, null)
assert.equal(active.playing(), false) // enabling on a paused track must keep it paused
assert.equal(nodes[compressionStart].gain.value, 1)
const streamCompressor = nodes[compressionStart + 3]
const streamMakeup = nodes[compressionStart + 4]
assert.equal(streamCompressor.threshold.value, -18)
assert.equal(playerState.loudnessNormalizationActive, false) // compression alone is not normalization
assert.equal(streamCompressor.ratio.value, 2)
assert.ok(streamMakeup.connections.includes(nodes[compressionStart + 1]))
active.volume(0.1)
assert.equal(nodes[compressionStart + 1].gain.value, 0.1)
assert.equal(streamCompressor.threshold.value, -18) // slider volume cannot change the compression threshold
const streamNodeCount = nodes.length
for (const [level, threshold, ratio, makeup] of [[2, -22, 3, 0.43], [3, -26, 4, 0.33]]) {
    playerState.dynamicCompression = level
    processingWatcher.callback(); await settle()
    assert.equal(playerState.currentMusic, active)
    assert.equal(active.playing(), false)
    assert.equal(streamCompressor.threshold.value, threshold)
    assert.equal(streamCompressor.ratio.value, ratio)
    assert.equal(streamMakeup.gain.value, makeup)
    assert.equal(nodes.length, streamNodeCount)
    assert.equal(streamMakeup.connections.length, 1)
}
playerState.dynamicCompression = 0
processingWatcher.callback(); await settle()
assert.equal(streamMakeup.connections.length, 0)
assert.ok(nodes[compressionStart].connections.includes(nodes[compressionStart + 1]))
playerState.dynamicCompression = 1
processingWatcher.callback(); await settle()
assert.equal(nodes[compressionStart + 3], streamCompressor) // reuse the node across toggles
playerState.loudnessNormalization = true
const compressedEntry = await player.namespace.preloadGaplessSong()
player.namespace.startGaplessTarget({ id: 1, index: 0, song: playerState.songList[0] }, compressedEntry)
await settle()
assert.equal(playerState.currentMusic._compressionLevel, 1)
assert.equal(playerState.currentMusic._loudnessGain.gain.value, expected)
assert.equal(playerState.loudnessNormalizationActive, true)
playerState.currentMusic.unload()
playerState.dynamicCompression = 3
player.namespace.play('https://audio.test/no-metadata.mp3', true)
active = playerState.currentMusic
active.emit('loaderror', 1, 'CORS rejected')
assert.notEqual(playerState.currentMusic, active)
assert.equal(playerState.currentMusic.__hmAudioProcessingUnavailable, true)
playerState.currentMusic.emit('load'); await settle()
assert.equal(playerState.currentMusic.playing(), true)
playerState.currentMusic.unload()

// The badge must not be restored by stale async processing after a setting change or track replacement.
playerState.dynamicCompression = 0
player.namespace.play(track.url, false, null, null, { trackInfo: track })
active = playerState.currentMusic
active.emit('load'); await settle()
assert.equal(playerState.loudnessNormalizationActive, true)
audioContext.state = 'suspended'
resume = new Promise(resolve => { audioContext.releaseResume = resolve })
processingWatcher.callback()
assert.equal(playerState.loudnessNormalizationActive, false)
playerState.loudnessNormalization = false
processingWatcher.callback()
audioContext.releaseResume(); await settle()
assert.equal(playerState.loudnessNormalizationActive, false)
playerState.loudnessNormalization = true
processingWatcher.callback(); await settle()
assert.equal(playerState.loudnessNormalizationActive, true)
audioContext.state = 'suspended'
resume = new Promise(resolve => { audioContext.releaseResume = resolve })
processingWatcher.callback()
player.namespace.play('https://audio.test/no-metadata.mp3', false)
audioContext.releaseResume(); await settle()
assert.equal(playerState.loudnessNormalizationActive, false)
playerState.currentMusic.emit('load'); await settle()
assert.equal(playerState.loudnessNormalizationActive, false)
resume = null
playerState.currentMusic.unload()

const settingsSource = await readFile('src/views/Settings.vue', 'utf8')
const compressionOptions = runInContext(settingsSource.match(/const dynamicCompressionOptions = (\[[\s\S]*?\]);/)[1], context)
assert.deepEqual(Array.from(compressionOptions, option => option.label), ['关闭', '轻度（推荐）', '适中', '较强'])
assert.deepEqual(Array.from(compressionOptions, option => option.value), [0, 1, 2, 3])
const selectorProps = { options: compressionOptions, modelValue: 0 }
context.defineProps = () => selectorProps
context.defineEmits = () => (_event, value) => { selectorProps.modelValue = value }
const selectorSource = (await readFile('src/components/Selector.vue', 'utf8')).match(/<script setup>([\s\S]*?)<\/script>/)[1]
const selectorModule = new SourceTextModule(selectorSource + '\nexport { handleKeydown, option, activeIndex, current };', { context })
await selectorModule.link(key => ({
    vue: mock({ ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }), nextTick: async callback => callback(), useId: () => 'compression-options', onActivated: noop, onDeactivated: noop }),
    '../utils/domHandler': mock({ absolutePosition: noop }),
})[key])
await selectorModule.evaluate()
const selector = selectorModule.namespace
const press = key => { let prevented = false; selector.handleKeydown({ key, preventDefault() { prevented = true } }); return prevented }
assert.equal(selector.current.value.label, '关闭')
assert.equal(press('Enter'), true); assert.equal(selector.option.value, true)
press('ArrowDown'); press('Enter')
assert.equal(selectorProps.modelValue, 1); assert.equal(selector.current.value.label, '轻度（推荐）')
assert.equal(selector.option.value, false)
press('End'); assert.equal(selector.activeIndex.value, 3); press(' ')
assert.equal(selectorProps.modelValue, 3)
press('Home'); assert.equal(selector.activeIndex.value, 0); press('Escape')
assert.equal(selector.option.value, false)
press('Enter'); assert.equal(press('Tab'), false); assert.equal(selector.option.value, false)
console.log('loudness normalization and dynamic compression: presets, metadata, playback paths, bypass, independent volume, fallback, lifecycle, migrated settings and dropdown keyboard checks passed')
