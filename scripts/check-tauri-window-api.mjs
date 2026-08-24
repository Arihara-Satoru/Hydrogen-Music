import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createTauriWindowApi, matchesShortcut, openExternalUrl, versionIsNewer } from '../src/utils/tauriWindowApi.mjs'

const capability = JSON.parse(await readFile(new URL('../src-tauri/capabilities/default.json', import.meta.url)))
for (const permission of [
  'core:window:allow-close',
  'core:window:allow-is-maximized',
  'core:window:allow-minimize',
  'core:window:allow-set-title',
  'core:window:allow-start-dragging',
  'core:window:allow-toggle-maximize',
]) assert.ok(capability.permissions.includes(permission), `missing Tauri permission: ${permission}`)

const calls = []
let resized
let stopped = false
const api = createTauriWindowApi({
  minimize: async () => calls.push('minimize'),
  toggleMaximize: async () => calls.push('toggleMaximize'),
  close: async () => calls.push('close'),
  isMaximized: async () => true,
  onResized: async (callback) => {
    resized = callback
    return () => { stopped = true }
  },
})

await api.windowMin()
await api.windowMax()
await api.windowClose()
assert.deepEqual(calls, ['minimize', 'toggleMaximize', 'close'])
assert.equal(await api.getWindowMaximizedState(), true)

let maximized = false
const unsubscribe = api.onWindowMaximizedChange((value) => { maximized = value })
await Promise.resolve()
resized()
await Promise.resolve()
await Promise.resolve()
assert.equal(maximized, true)
unsubscribe()
await Promise.resolve()
assert.equal(stopped, true)
assert.throws(() => openExternalUrl('file:///C:/Windows/System32'), /Unsupported external URL protocol/)
assert.equal(matchesShortcut({ key: 'ArrowLeft', code: 'ArrowLeft', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, 'CommandOrControl+Left'), true)
assert.equal(matchesShortcut({ key: 'p', code: 'KeyP', ctrlKey: true, metaKey: false, altKey: true, shiftKey: false }, 'CommandOrControl+Alt+P'), true)
assert.equal(versionIsNewer('v0.7.0', '0.6.6'), true)
assert.equal(versionIsNewer('0.6.6', '0.6.6'), false)
assert.equal(versionIsNewer('0.6.5', '0.6.6'), false)

globalThis.window = globalThis
await import('../src/utils/windowApiStub.mjs')
assert.equal(typeof globalThis.windowApi.getSystemFonts, 'function')
assert.equal(typeof globalThis.windowApi.saveLastPlaybackProgress, 'function')
assert.equal(typeof globalThis.windowApi.scanLocalMusic, 'function')
assert.equal(typeof globalThis.windowApi.getLocalMusicImage, 'function')
assert.equal(typeof globalThis.windowApi.getLocalMusicLyric, 'function')
assert.equal(typeof globalThis.windowApi.downloadProgress, 'function')
assert.equal(typeof globalThis.windowApi.downloadPause, 'function')
let downloadStarted = false
const stopDownloadNext = api.downloadNext(() => { downloadStarted = true })
api.startDownload()
assert.equal(downloadStarted, true)
stopDownloadNext()
assert.equal(typeof globalThis.electronAPI.isLyricWindowVisible, 'function')
assert.equal(await globalThis.electronAPI.isLyricWindowVisible(), false)
assert.equal(typeof globalThis.playerApi.onSetPosition, 'function')

console.log('Tauri window API check passed')
