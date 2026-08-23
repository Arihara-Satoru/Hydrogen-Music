import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [radio, otherStore, libraryStore, localStore, libraryDetail, ipcMain] = await Promise.all([
  readFile('src/components/RadioDetail.vue', 'utf8'),
  readFile('src/store/otherStore.js', 'utf8'),
  readFile('src/store/libraryStore.js', 'utf8'),
  readFile('src/store/localStore.js', 'utf8'),
  readFile('src/components/LibraryDetail.vue', 'utf8'),
  readFile('src/electron/ipcMain.js', 'utf8'),
])

assert.match(radio, /requestToken !== detailRequestToken/)
assert.match(otherStore, /this\.mvRequestToken !== requestToken/)
assert.match(libraryStore, /this\.libraryDetailToken != requestToken/)
assert.match(localStore, /this\.localDetailToken === requestToken/)
assert.match(libraryDetail, /libraryInfo\.value !== targetInfo/)
assert.match(libraryDetail, /if \(itemIndex >= 0\) libraryList\.value\.splice/)
assert.match(ipcMain, /if \(manualUpdateCheckRunning\) return/)
assert.match(ipcMain, /cleanupManualUpdateListeners\(\)/)

console.log('logic race check passed')
