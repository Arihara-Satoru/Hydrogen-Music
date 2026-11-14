import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'
import { nextTick, watch } from 'vue'
import { createPinia, defineStore, storeToRefs } from 'pinia'

const mainSource = await readFile('src/main.js', 'utf8')
const mediaSource = await readFile('src/utils/mediaSession.js', 'utf8')
const mock = (context, exports = {}) => new SyntheticModule(Object.keys(exports), function () {
  for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
}, { context })

// Exercise the actual startup module: Windows must reach the same idle registration.
for (const platform of ['win32', 'darwin', 'linux', 'browser']) {
  for (const hasIdleCallback of [true, false]) {
    let idleCallback, initializations = 0
    const app = { use() {}, directive() {}, mount() {} }
    const context = createContext({
      console,
      window: { process: { platform }, addEventListener() {},
        ...(hasIdleCallback ? { requestIdleCallback: callback => { idleCallback = callback } } : {}) },
      setTimeout: (callback, delay) => { assert.equal(delay, 500); idleCallback = callback },
    })
    const modules = {
      vue: mock(context, { createApp: () => app, nextTick }),
      'motion-v': mock(context, { MotionPlugin: {} }),
      './router/router.js': mock(context, { default: { isReady: async () => {}, currentRoute: { value: { name: 'homepage' } } } }),
      './utils/theme': mock(context, { initTheme() {} }),
      './utils/dynamicTheme': mock(context, { initDynamicTheme() {} }),
    }
    const media = mock(context, { initMediaSession: () => { initializations++ } })
    const init = mock(context, { init() {} })
    for (const module of [media, init]) { await module.link(() => {}); await module.evaluate() }
    const main = new SourceTextModule(mainSource, {
      context,
      initializeImportMeta: meta => { meta.env = { DEV: false } },
      importModuleDynamically: key => {
        if (key === './utils/initApp') return init
        assert.equal(key, './utils/mediaSession')
        return media
      },
    })
    await main.link(key => modules[key] || mock(context, { default: {} }))
    await main.evaluate()
    assert.equal(typeof idleCallback, 'function', `${platform}: schedule system media controls, including on Windows`)
    assert.equal(initializations, 0, 'Keep registration off the initial render path')
    await idleCallback()
    assert.equal(initializations, 1, `${platform}: initialize exactly once, with or without requestIdleCallback`)
  }
}

async function createSession({ platform = 'Win32', bridge = true, unsupported = [], available = true } = {}) {
  const pinia = createPinia()
  const store = defineStore('media-session-check', { state: () => ({
    songList: [{ id: 1, name: '佩戴检测测试', ar: [{ name: 'Hydrogen' }], al: { name: '测试专辑' }, coverUrl: 'https://example.test/cover.jpg' }],
    currentIndex: 0, playing: true, progress: 12, time: 180, playbackRate: 1,
    localBase64Img: null, showSongTranslation: true,
  }) })(pinia)
  const handlers = new Map(), calls = [], positions = [], listeners = new Map(), warnings = [], watches = []
  const metadata = [], trackTimes = []
  const session = {
    setActionHandler(action, handler) {
      if (unsupported.includes(action)) throw new TypeError(`Unsupported action: ${action}`)
      handlers.set(action, handler)
    },
    setPositionState: value => positions.push(value),
  }
  const context = createContext({
    console: { warn: (...args) => warnings.push(args) },
    navigator: { platform, ...(available ? { mediaSession: session } : {}) },
    window: {
      MediaMetadata: class { constructor(value) { Object.assign(this, value) } },
      addEventListener: (name, handler) => listeners.set(name, handler),
      ...(bridge ? { playerApi: { sendMetaData: value => metadata.push(value), sendPlayerCurrentTrackTime: value => trackTimes.push(value) } } : {}),
    },
  })
  const modules = {
    '../store/pinia': mock(context, { default: pinia }),
    vue: mock(context, { watch: (...args) => { const stop = watch(...args); watches.push(stop); return stop } }),
    pinia: mock(context, { storeToRefs }),
    '../store/playerStore': mock(context, { usePlayerStore: () => store }),
    './player': mock(context, {
      startMusic: options => { calls.push({ action: 'play', options }); store.playing = true },
      pauseMusic: () => { calls.push({ action: 'pause' }); store.playing = false },
      playNext: options => calls.push({ action: 'next', options }),
      playLast: options => calls.push({ action: 'previous', options }),
      changeProgress: position => { calls.push({ action: 'seek', position }); store.progress = position },
    }),
    './songName': mock(context, { getSongDisplayName: track => track.name }),
    './imageUtils': mock(context, { resolveImageUrl: url => url }),
  }
  const module = new SourceTextModule(mediaSource, { context })
  await module.link(key => { assert.ok(modules[key], `Unexpected import: ${key}`); return modules[key] })
  await module.evaluate()
  module.namespace.initMediaSession()
  return { store, session, handlers, calls, positions, listeners, warnings, metadata, trackTimes,
    dispose() { watches.forEach(stop => stop()); store.$dispose() } }
}

for (const platform of ['Win32', 'MacIntel', 'Linux x86_64']) {
  const test = await createSession({ platform })
  try {
    assert.equal(test.handlers.size, 8, `${platform}: register playback, track and seek actions`)
    assert.equal(test.session.metadata.title, '佩戴检测测试')
    assert.equal(test.session.playbackState, 'playing')
    assert.equal(test.positions.at(-1).position, 12)
    assert.equal(test.trackTimes.at(-1), 12)
    assert.equal(test.metadata.at(-1).trackId, 1, 'Keep the Linux metadata bridge working')

    // Explicit pause/play, rather than toggle, preserves repeated headset commands.
    for (const action of ['pause', 'pause', 'play', 'play', 'stop']) {
      test.handlers.get(action)()
      await nextTick()
      assert.equal(test.session.playbackState, action === 'play' ? 'playing' : 'paused')
      assert.equal(test.calls.at(-1).action, action === 'stop' ? 'pause' : action)
      if (action === 'play') assert.equal(test.calls.at(-1).options.userInitiated, true)
    }
    for (const [action, expected] of [['nexttrack', 'next'], ['previoustrack', 'previous']]) {
      test.handlers.get(action)()
      assert.equal(test.calls.at(-1).action, expected)
      assert.equal(test.calls.at(-1).options.userInitiated, true)
    }
    test.handlers.get('seekto')({ seekTime: 999 })
    assert.equal(test.calls.at(-1).position, 180)
    test.handlers.get('seekbackward')({ seekOffset: 999 })
    assert.equal(test.calls.at(-1).position, 0)
    test.handlers.get('seekforward')({})
    assert.equal(test.calls.at(-1).position, 5)
    await nextTick()
    test.store.playing = true
    test.store.playbackRate = 1.5
    await nextTick()
    assert.equal(test.session.playbackState, 'playing', 'In-app playback also updates system controls')
    assert.equal(test.positions.at(-1).playbackRate, 1.5)
    test.listeners.get('mediaSession:seeked')({ detail: { duration: 200, toTime: 30 } })
    assert.equal(test.positions.at(-1).position, 30)
    assert.equal(test.positions.at(-1).duration, 200)
  } finally { test.dispose() }
}

const browser = await createSession({ bridge: false })
try {
  assert.equal(browser.positions.at(-1)?.position, 12, 'Missing Electron IPC must not prevent system position updates')
  browser.handlers.get('pause')()
  await nextTick()
  assert.equal(browser.session.playbackState, 'paused')
} finally { browser.dispose() }

const partial = await createSession({ unsupported: ['seekto'] })
try {
  assert.ok(partial.handlers.has('play') && partial.handlers.has('pause'))
  assert.ok(partial.handlers.has('seekforward') && partial.handlers.has('seekbackward'), 'One unsupported action must not skip later handlers')
  assert.equal(partial.warnings.length, 1, 'Unsupported action is reported rather than silently hiding failures')
} finally { partial.dispose() }

const unavailable = await createSession({ available: false })
assert.equal(unavailable.handlers.size, 0, 'Unsupported environments gracefully skip registration')
unavailable.dispose()
console.log('Media Session checks passed: Windows startup, headset actions, state/position sync, Linux bridge and browser fallbacks')
