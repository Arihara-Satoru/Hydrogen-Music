import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [localStore, localMusic, preload, downloadList, musicVideo, settings, updateDialog] = await Promise.all([
  readFile('src/store/localStore.js', 'utf8'),
  readFile('src/utils/locaMusic.js', 'utf8'),
  readFile('src/electron/preload.js', 'utf8'),
  readFile('src/components/DownloadList.vue', 'utf8'),
  readFile('src/components/MusicVideo.vue', 'utf8'),
  readFile('src/views/Settings.vue', 'utf8'),
  readFile('src/components/UpdateDialog.vue', 'utf8'),
])

assert.doesNotMatch(localStore, /downloadedFiles|localMusicList/)
assert.match(localMusic, /foldersByName\[node\.name\] = folderEntry/)
assert.match(preload, /removeListener\("download-progress", callback\)/)
assert.match(preload, /removeListener\("manual-update-available", listener\)/)
assert.match(downloadList, /onUnmounted\(\(\) => disposeDownloadProgress\?\.\(\)\)/)
assert.match(musicVideo, /disposeDownloadVideoProgress\?\.\(\)/)
assert.match(settings, /onUnmounted\(\(\) => disposeManualUpdateAvailable\?\.\(\)\)/)
assert.match(updateDialog, /updateListenerDisposers\.forEach\(dispose => dispose\?\.\(\)\)/)

console.log('foreground memory check passed')
