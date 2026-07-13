import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const values = new Map()
globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
}
globalThis.document = { cookie: '' }
globalThis.location = { hostname: 'localhost' }

const source = (await readFile(new URL('../src/utils/authority.js', import.meta.url), 'utf8'))
    .replace('import Cookies from "js-cookie";', 'const Cookies = { get: () => undefined };')
const { getCookie, setCookies, updateStoredAuthCookies } = await import(`data:text/javascript,${encodeURIComponent(source)}`)

setCookies({ token: 'old-token', userid: '42', t1: 'old-t1' })
updateStoredAuthCookies({ cookie: 'KUGOU_API_GUID=device-only' })
assert.equal(getCookie('token'), 'old-token')
assert.equal(getCookie('userid'), '42')

updateStoredAuthCookies({ cookie: 't1=fresh-t1' })
assert.equal(getCookie('token'), 'old-token')
assert.equal(getCookie('userid'), '42')
assert.equal(getCookie('t1'), 'fresh-t1')

const clearOptions = []
globalThis.__accountSessionMocks = {
    pinia: {},
    getUserPlaylist: async () => ({}),
    getUserProfile: async () => { throw new Error('backend temporarily unavailable') },
    logout: async () => {},
    refreshLoginToken: async () => {},
    useUserStore: () => ({}),
    resolveFavoritePlaylistMeta: () => null,
    isLogin: () => true,
    setCookies: () => {},
    getCookie: key => key === 'token' ? 'old-token' : '42',
    clearAccountScopedState: async options => clearOptions.push(options),
    invalidateNcmApiCookieCache: () => {},
    runDailyVipAutoClaim: () => {},
    dialogOpen: () => {},
    noticeOpen: () => {},
}
const accountSource = (await readFile(new URL('../src/utils/accountSession.js', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
const accountImports = `const { pinia, getUserPlaylist, getUserProfile, logout, refreshLoginToken, useUserStore, resolveFavoritePlaylistMeta, isLogin, setCookies, getCookie, clearAccountScopedState, invalidateNcmApiCookieCache, runDailyVipAutoClaim, dialogOpen, noticeOpen } = globalThis.__accountSessionMocks;\n`
const { initializeCurrentAccountSession } = await import(`data:text/javascript,${encodeURIComponent(accountImports + accountSource)}`)

await assert.rejects(initializeCurrentAccountSession(), /backend temporarily unavailable/)
assert.deepEqual(clearOptions, [{ clearCookies: false, clearSessionCookies: true }])
console.log('account session persistence ok')
