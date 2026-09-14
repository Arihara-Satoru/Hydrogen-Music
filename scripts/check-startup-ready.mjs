import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const home = readFileSync(new URL('../src/views/HomePage.vue', import.meta.url), 'utf8')
const code = home.slice(home.indexOf('  const homeElement'), home.indexOf('  const userStore'))
let ready
let notifications = 0
let releaseImage
const image = new Promise(resolve => { releaseImage = resolve })
vm.runInNewContext(code, {
  ref: () => ({ value: { querySelectorAll: () => [
    { getAttribute: () => 'cover.jpg', decode: () => image },
    { getAttribute: () => 'broken.jpg', decode: () => Promise.reject(new Error('image failed')) },
    { getAttribute: () => '', decode: () => { throw Error('Lazy image must not block startup') } },
  ] } }),
  provide: (_key, callback) => { ready = callback },
  nextTick: async () => {},
  window: { windowApi: { notifyStartupReady: () => notifications++ } },
})
for (const section of ['songs', '0', 'banner', '2', '1']) await ready(section)
assert.equal(notifications, 0, 'Wait for every section, regardless of completion order')
await ready('songs')
assert.equal(notifications, 0, 'Duplicate completion must not release startup')
const finished = ready('3')
await Promise.resolve()
assert.equal(notifications, 0, 'Wait for image decoding after data is ready')
releaseImage()
await finished
assert.equal(notifications, 1, 'Broken images must not prevent startup')
await ready('3')
assert.equal(notifications, 1, 'Notify only once')

const background = readFileSync(new URL('../background.js', import.meta.url), 'utf8')
const handler = background.slice(background.indexOf('  const onStartupReady ='), background.indexOf('  win.webContents.on("render-process-gone"'))
const sender = {}
let listener
let shows = 0
vm.runInNewContext(handler, {
  win: { webContents: sender, once: () => {} },
  ipcMain: { on: (_event, callback) => { listener = callback } },
  showMainWindow: () => shows++, initPostShowFeatures: () => {},
})
listener({ sender: {} })
assert.equal(shows, 0, 'Ignore other renderer windows')
listener({ sender })
assert.equal(shows, 1, 'Only the main renderer can release startup')
assert.ok(background.includes('}, 30000);'), 'Keep a bounded startup fallback')
console.log('Startup readiness checks passed')
