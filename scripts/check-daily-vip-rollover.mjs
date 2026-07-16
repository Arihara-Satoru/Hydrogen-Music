import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

let now = Date.parse('2026-07-16T15:59:30Z')
let timerCallback
let timerDelay
const claimedDays = []
const values = new Map()

globalThis.window = {
    setTimeout(callback, delay) {
        timerCallback = callback
        timerDelay = delay
        return 1
    },
    clearTimeout() {},
}
globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
}
globalThis.__dailyVipClaimMocks = {
    reactive: value => value,
    claimYouthDailyVip: async day => {
        claimedDays.push(day)
        return { code: 200 }
    },
    getServerNow: async () => ({ timestamp: Math.floor(now / 1000) }),
    getYouthVipMonthRecord: async () => ({}),
    getCookie: key => key === 'userid' ? '42' : '',
    isLogin: () => true,
    noticeOpen: () => {},
}

const source = (await readFile(new URL('../src/utils/dailyVipClaim.js', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
const imports = 'const { reactive, claimYouthDailyVip, getServerNow, getYouthVipMonthRecord, getCookie, isLogin, noticeOpen } = globalThis.__dailyVipClaimMocks;\n'
const { runDailyVipAutoClaim } = await import(`data:text/javascript,${encodeURIComponent(imports + source)}`)
const originalDateNow = Date.now
Date.now = () => now

try {
    await runDailyVipAutoClaim('startup')
    assert.equal(timerDelay, 31_000)
    assert.deepEqual(claimedDays, ['2026-07-16'])

    now = Date.parse('2026-07-16T16:00:01Z')
    timerCallback()
    await new Promise(setImmediate)
    assert.deepEqual(claimedDays, ['2026-07-16', '2026-07-17'])

    timerCallback()
    await new Promise(setImmediate)
    assert.deepEqual(claimedDays, ['2026-07-16', '2026-07-17'])
} finally {
    Date.now = originalDateNow
}

console.log('daily VIP rollover ok')
