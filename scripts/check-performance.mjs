import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { getBoundedCacheValue, setBoundedCacheValue } from '../src/utils/boundedCache.mjs'

const cache = new Map()
setBoundedCacheValue(cache, 'a', 1, 2)
setBoundedCacheValue(cache, 'b', 2, 2)
assert.equal(getBoundedCacheValue(cache, 'a'), 1)
setBoundedCacheValue(cache, 'c', 3, 2)
assert.deepEqual([...cache.keys()], ['a', 'c'])

const [ipcMain, preload, desktopLyric, app, main, diagnostics] = await Promise.all([
  readFile('src/electron/ipcMain.js', 'utf8'),
  readFile('src/electron/preload.js', 'utf8'),
  readFile('src/utils/desktopLyric.js', 'utf8'),
  readFile('src/App.vue', 'utf8'),
  readFile('src/main.js', 'utf8'),
  readFile('src/utils/performanceDiagnostics.js', 'utf8'),
])

assert.match(ipcMain, /removeListener\("cancel-download-music-video", cancelListener\)/)
assert.doesNotMatch(ipcMain, /ipcMain\.on\("cancel-download-music-video", \(\) =>/)
assert.match(ipcMain, /ipcMain\.listenerCount\(channel\)/)
assert.match(preload, /removeListener\("get-current-lyric-data", callback\)/)
assert.match(preload, /removeListener\("desktop-lyric-closed", callback\)/)
assert.match(desktopLyric, /disposeCurrentLyricData\?\.\(\)/)
assert.match(desktopLyric, /disposeDesktopLyricClosed\?\.\(\)/)
assert.match(app, /disposeCheckUpdate\?\.\(\)/)
assert.match(main, /if \(import\.meta\.env\.DEV\) \{[\s\S]*?import\('\.\/utils\/performanceDiagnostics'\)/)
assert.match(diagnostics, /if \(!import\.meta\.env\.DEV\) return/)
assert.match(diagnostics, /PerformanceObserver/)
assert.match(diagnostics, /document\.querySelectorAll\('\*'\)\.length/)

console.log('performance lifecycle check passed')
