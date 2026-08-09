import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule } from 'node:vm'

const context = createContext({ console })
const devicesPath = resolve('src/utils/loginDevices.js')
const devicesModule = new SourceTextModule(await readFile(devicesPath, 'utf8'), {
  context,
  identifier: devicesPath,
})
await devicesModule.link(() => { throw new Error('loginDevices must not import dependencies') })
await devicesModule.evaluate()

const { buildKugouDeviceCookieString, normalizeLoginDevices } = devicesModule.namespace
const currentDevice = {
  guid: '0123456789abcdef0123456789abcdef',
  mid: '127040673209007890703439899469936035904',
  dev: 'LPREY5G0Q4',
}
const response = {
  data: {
    li: [
      {
        ver: 11440,
        mid: currentDevice.mid,
        loc: '本机地址 本机地址 ',
        t: 1786282851,
        app: '安卓酷狗概念版',
        appid: 3116,
        dev: currentDevice.dev,
      },
      {
        ver: 10790,
        mid: '17cb987c5d742220feaaf92026136f1b',
        loc: '中国 浙江 温州',
        t: 1786272432,
        app: '安卓酷狗概念版',
        appid: 3116,
        dev: '21051182C',
      },
    ],
  },
  status: 1,
  error_code: 0,
}

const devices = normalizeLoginDevices(response, currentDevice)
assert.equal(devices.length, 2)
assert.equal(devices[0].name, 'LPREY5G0Q4')
assert.equal(devices[0].platformName, '安卓酷狗概念版')
assert.equal(devices[0].location, '本机地址')
assert.equal(devices[0].isCurrent, true)
assert.equal(devices[0].canKick, false)
assert.equal(devices[1].location, '中国 · 浙江 · 温州')
assert.equal(devices[1].canKick, true)
assert.equal(
  buildKugouDeviceCookieString(currentDevice),
  `KUGOU_API_MID=${currentDevice.mid};KUGOU_API_GUID=${currentDevice.guid};KUGOU_API_DEV=${currentDevice.dev}`,
)

const require = createRequire(import.meta.url)
const { createKugouDeviceIdentity } = require('../src/electron/kugouDeviceIdentity')
const fixedGuid = '0123456789abcdef0123456789abcdef'
const identity = createKugouDeviceIdentity({ guid: fixedGuid }, {})
const expectedMid = BigInt(`0x${createHash('md5').update(fixedGuid).digest('hex')}`).toString()
assert.deepEqual(identity, { guid: fixedGuid, dev: 'HYDRO01234', mid: expectedMid })

console.log('login devices check passed')
