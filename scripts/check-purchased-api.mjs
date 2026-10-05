import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const context = createContext({ console, Date })
const requests = []
let responder = async () => ({ status: 1, data: { info: [] } })

const requestModule = new SyntheticModule(['default'], function setRequestExport() {
  this.setExport('default', config => {
    requests.push(config)
    return responder(config)
  })
}, { context, identifier: 'mock:request' })

const userPath = resolve('src/api/user.js')
const userModule = new SourceTextModule(await readFile(userPath, 'utf8'), {
  context,
  identifier: userPath,
})

await userModule.link(specifier => {
  if (specifier === '../utils/request') return requestModule
  throw new Error(`Unexpected import: ${specifier}`)
})
await userModule.evaluate()

const { extractPurchasedItems, getPurchasedAlbums, getPurchasedSongs } = userModule.namespace

responder = async ({ url, params }) => {
  assert.equal(url, '/user/purchased/songs')
  return params.page === 1
    ? { status: 1, data: { total: 3, info: [{ id: 's1' }, { id: 's2' }] } }
    : { status: 1, data: { total: 3, info: [{ id: 's3' }] } }
}

const songsResult = await getPurchasedSongs({ pagesize: 2 })
assert.deepEqual(
  requests.map(({ params }) => [params.page, params.pagesize]),
  [[1, 2], [2, 2]],
)
assert.deepEqual(extractPurchasedItems(songsResult, ['info']).map(({ id }) => id), ['s1', 's2', 's3'])

requests.length = 0
responder = async ({ url, params }) => {
  assert.equal(url, '/user/purchased/albums')
  const offset = (params.page - 1) * params.pagesize
  return {
    status: 1,
    data: {
      total: 4,
      goods: { list: [{ id: `a${offset + 1}` }, { id: `a${offset + 2}` }] },
    },
  }
}

const albumsResult = await getPurchasedAlbums({ pagesize: 2 })
assert.deepEqual(requests.map(({ params }) => params.page), [1, 2])
assert.deepEqual(extractPurchasedItems(albumsResult, ['goods']).map(({ id }) => id), ['a1', 'a2', 'a3', 'a4'])

requests.length = 0
responder = async () => ({ status: 1, data: { info: [] } })
await getPurchasedSongs({ pagesize: 500 })
assert.equal(requests.length, 1)
assert.equal(requests[0].params.pagesize, 50)

requests.length = 0
await getPurchasedSongs({ pagesize: 0.5 })
assert.equal(requests[0].params.pagesize, 1)

responder = async () => ({ status: 0, error_code: 20010, message: 'param error' })
await assert.rejects(() => getPurchasedAlbums(), /param error/)

responder = async () => ({ status: 0, error_code: 20010, errmsg: 'error appid', data: {} })
await assert.rejects(() => userModule.namespace.getListeningPreference(), /error appid/)
await assert.rejects(() => userModule.namespace.updateListeningPreference({ mode: '1' }), /error appid/)

// 执行共享拦截器，确保 HTTP 502 的 errmsg 能被所有调用方读取。
let rejectResponse
const notices = []
const mock = exports => new SyntheticModule(Object.keys(exports), function () {
  for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
}, { context })
const axios = mock({ default: { create: () => ({ interceptors: {
  request: { use() {} }, response: { use(success, failure) { rejectResponse = failure } },
} }) } })
const auth = mock({ getCookie() {}, isLogin: () => false, updateStoredAuthCookies: () => ({}) })
const dependencies = {
  axios,
  '../utils/authority': auth,
  '../store/pinia': mock({ default: {} }),
  '../store/libraryStore': mock({ useLibraryStore: () => ({ needTimestamp: [] }) }),
  '../store/userStore': mock({ useUserStore: () => ({}) }),
  './accountState': mock({ clearAccountScopedState: async () => {} }),
  './loginDevices': mock({ buildKugouDeviceCookieString: () => '' }),
  './dialog': mock({ noticeOpen: text => notices.push(text) }),
}
const realRequestModule = new SourceTextModule(await readFile('src/utils/request.js', 'utf8'), { context })
await realRequestModule.link(name => {
  assert.ok(dependencies[name], `Unexpected import: ${name}`)
  return dependencies[name]
})
await realRequestModule.evaluate()
const httpError = Object.assign(new Error('Request failed with status code 502'), { config: { url: '/user/preference' },
  response: { status: 502, data: { error_code: 20010, errmsg: 'error appid', data: {}, status: 0 } } })
await assert.rejects(rejectResponse(httpError), /error appid/)
assert.equal(notices.at(-1), '请求错误：error appid')

console.log('purchased API check passed')
