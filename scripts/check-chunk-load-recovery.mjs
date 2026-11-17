import assert from 'node:assert/strict'
import { installChunkLoadRecovery } from '../src/utils/chunkLoadRecovery.js'

const values = new Map()
let reloads = 0
const target = new EventTarget()
target.sessionStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
}
target.location = { reload: () => reloads++ }

const dispatch = message => {
  const event = new Event('vite:preloadError', { cancelable: true })
  event.payload = new TypeError(message)
  target.dispatchEvent(event)
  return event.defaultPrevented
}

let uninstall = installChunkLoadRecovery(target)
const missing = 'Failed to fetch dynamically imported module: file:///app/dist/assets/SirenPage-old.js'
assert.equal(dispatch(missing), true)
assert.equal(reloads, 1)
uninstall()

// 模拟刷新后重新注册：同一个资源仍缺失时不得无限刷新。
uninstall = installChunkLoadRecovery(target)
assert.equal(dispatch(missing), false)
assert.equal(reloads, 1)
assert.equal(dispatch('Cannot access initialization before declaration'), false)
assert.equal(reloads, 1)
assert.equal(dispatch(missing.replace('old.js', 'next.js')), true)
assert.equal(reloads, 2)

target.sessionStorage.setItem = () => { throw new Error('Storage unavailable') }
assert.equal(dispatch(missing), false)
assert.equal(reloads, 2)
uninstall()
assert.equal(dispatch(missing), false)
console.log('chunk load recovery checks passed')
