import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const records = new Map()
const storageKey = 'hydrogenmusic:daily-vip:test-user'
const serverTime = Date.UTC(2026, 8, 30, 4)
const claimDay = '2026-09-30'
let claimCalls = 0
let responder = async () => ({ status: 1, error_code: 0, data: {} })

async function loadClaimModule() {
    const context = createContext({
        Date, console,
        localStorage: {
            getItem: key => records.get(key) ?? null,
            setItem: (key, value) => records.set(key, value),
        },
    })
    const mocks = {
        vue: { reactive: value => value },
        '../api/user': {
            getServerNow: async () => ({ status: 1, data: { timestamp: serverTime / 1000 } }),
            getYouthVipMonthRecord: async () => ({ status: 1, data: [] }),
            claimYouthDailyVip: async day => {
                assert.equal(day, claimDay)
                claimCalls += 1
                return responder()
            },
        },
        './authority': { getCookie: () => 'test-user', isLogin: () => true },
        './dialog': { noticeOpen: () => {} },
    }
    const filePath = resolve('src/utils/dailyVipClaim.js')
    const module = new SourceTextModule(await readFile(filePath, 'utf8'), { context, identifier: filePath })
    await module.link(specifier => {
        const exports = mocks[specifier]
        assert.ok(exports, `Unexpected import: ${specifier}`)
        return new SyntheticModule(Object.keys(exports), function () {
            for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
        }, { context, identifier: `mock:${specifier}` })
    })
    await module.evaluate()
    return module.namespace
}

// A failure saved by an older version must not prevent today's request.
records.set(storageKey, JSON.stringify({ claimDay, status: 'failed', message: '今日 VIP 领取失败' }))
let { runDailyVipAutoClaim } = await loadClaimModule()
assert.equal((await runDailyVipAutoClaim('startup')).status, 'success')
assert.equal(claimCalls, 1)
assert.equal(JSON.parse(records.get(storageKey)).status, 'success')
assert.equal((await runDailyVipAutoClaim('login')).skipped, true)
assert.equal(claimCalls, 1)

for (const failure of [
    async () => ({ status: 0, error_code: 1, data: {} }),
    async () => { throw new Error('network timeout') },
]) {
    records.clear()
    claimCalls = 0
    responder = failure
    ;({ runDailyVipAutoClaim } = await loadClaimModule())
    assert.equal((await runDailyVipAutoClaim('startup')).status, 'failed')
    assert.equal(JSON.parse(records.get(storageKey)).status, 'failed')

    // A login in the same process must retry after failure.
    assert.equal((await runDailyVipAutoClaim('login')).status, 'failed')
    assert.equal(claimCalls, 2)

    // A restart reloads the same storage and must still retry.
    responder = async () => ({ status: 1, error_code: 0, data: {} })
    ;({ runDailyVipAutoClaim } = await loadClaimModule())
    const [first, concurrent] = await Promise.all([
        runDailyVipAutoClaim('startup'),
        runDailyVipAutoClaim('login'),
    ])
    assert.equal(first.status, 'success')
    assert.equal(first, concurrent)
    assert.equal(claimCalls, 3)
}

for (const status of ['success', 'already']) {
    records.set(storageKey, JSON.stringify({ claimDay, status }))
    claimCalls = 0
    ;({ runDailyVipAutoClaim } = await loadClaimModule())
    assert.equal((await runDailyVipAutoClaim('startup')).skipped, true)
    assert.equal(claimCalls, 0)

    records.set(storageKey, JSON.stringify({ claimDay: '2026-09-29', status }))
    assert.equal((await runDailyVipAutoClaim('day-rollover')).status, 'success')
    assert.equal(claimCalls, 1)
}

console.log('daily VIP claim check passed')
