import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule, SyntheticModule, runInContext } from 'node:vm'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { parse } from '@vue/compiler-sfc'
import { extractVipInfo, getCurrentVipLevel } from '../src/utils/vipStatus.mjs'

const records = new Map()
const storageKey = 'hydrogenmusic:daily-vip:test-user'
const serverTime = Date.UTC(2026, 8, 30, 4)
const claimDay = '2026-09-30'
let claimCalls = 0
let upgradeCalls = 0
let monthRecordCalls = 0
let currentUserId = 'test-user'
let currentToken = 'test-token'
let responder = async () => ({ status: 1, error_code: 0, data: {} })
let upgradeResponder = async () => ({ status: 1, error_code: 0, data: {} })
let monthRecordResponder = async () => ({ status: 1, data: [] })
let serverTimeResponder = async () => ({ status: 1, data: { timestamp: serverTime / 1000 } })
const deferred = () => {
    let resolve, reject
    const promise = new Promise((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
}

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
            getServerNow: () => serverTimeResponder(),
            getYouthVipMonthRecord: async () => {
                monthRecordCalls += 1
                return monthRecordResponder()
            },
            claimYouthDailyVip: async day => {
                assert.equal(day, claimDay)
                claimCalls += 1
                return responder()
            },
            upgradeYouthDailyVip: async () => {
                upgradeCalls += 1
                return upgradeResponder()
            },
        },
        './authority': { getCookie: key => key === 'userid' ? currentUserId : currentToken, isLogin: () => !!currentUserId && !!currentToken },
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
assert.equal(upgradeCalls, 1)
assert.equal(JSON.parse(records.get(storageKey)).status, 'success')
assert.equal(JSON.parse(records.get(storageKey)).vipUpgradeStatus, 'success')
assert.equal((await runDailyVipAutoClaim('login')).skipped, true)
assert.equal(claimCalls, 1)
assert.equal(upgradeCalls, 1)

for (const failure of [
    async () => ({ status: 0, error_code: 1, data: {} }),
    async () => { throw new Error('network timeout') },
]) {
    records.clear()
    claimCalls = 0
    upgradeCalls = 0
    responder = failure
    ;({ runDailyVipAutoClaim } = await loadClaimModule())
    assert.equal((await runDailyVipAutoClaim('startup')).status, 'failed')
    assert.equal(JSON.parse(records.get(storageKey)).status, 'failed')
    assert.equal(upgradeCalls, 0)

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
    assert.equal(upgradeCalls, 1)
}

for (const status of ['success', 'already']) {
    records.set(storageKey, JSON.stringify({ claimDay, status }))
    claimCalls = 0
    upgradeCalls = 0
    ;({ runDailyVipAutoClaim } = await loadClaimModule())
    const initialRecord = await runDailyVipAutoClaim('startup')
    assert.equal(initialRecord.vipUpgradeStatus, 'success')
    assert.equal(initialRecord.skipped, undefined)
    assert.equal(claimCalls, 0)
    assert.equal(upgradeCalls, 1)
    assert.equal((await runDailyVipAutoClaim('login')).skipped, true)
    assert.equal(upgradeCalls, 1)

    records.set(storageKey, JSON.stringify({ claimDay: '2026-09-29', status }))
    assert.equal((await runDailyVipAutoClaim('day-rollover')).status, 'success')
    assert.equal(claimCalls, 1)
    assert.equal(upgradeCalls, 2)
}

// A record created before the upgrade flow must receive one upgrade request without re-claiming VIP.
records.set(storageKey, JSON.stringify({ claimDay, status: 'success', message: '今日 VIP 领取成功' }))
claimCalls = 0
upgradeCalls = 0
upgradeResponder = async () => ({ status: 1, error_code: 0, data: {} })
;({ runDailyVipAutoClaim } = await loadClaimModule())
assert.equal((await runDailyVipAutoClaim('startup')).vipUpgradeStatus, 'success')
assert.equal(claimCalls, 0)
assert.equal(upgradeCalls, 1)
assert.equal((await runDailyVipAutoClaim('login')).skipped, true)
assert.equal(upgradeCalls, 1)

// A failed upgrade is recorded as attempted so startup/login do not hammer the test endpoint.
records.set(storageKey, JSON.stringify({ claimDay, status: 'success', message: '今日 VIP 领取成功' }))
claimCalls = 0
upgradeCalls = 0
upgradeResponder = async () => ({ status: 0, error_code: 1001, msg: 'upgrade failed' })
;({ runDailyVipAutoClaim } = await loadClaimModule())
assert.equal((await runDailyVipAutoClaim('startup')).vipUpgradeStatus, 'failed')
assert.equal(claimCalls, 0)
assert.equal(upgradeCalls, 1)
assert.equal((await runDailyVipAutoClaim('login')).vipUpgradeStatus, 'failed')
assert.equal(upgradeCalls, 1)

// Manual retries bypass a previous upgrade attempt, and concurrent clicks share one workflow.
let claimModule = await loadClaimModule()
monthRecordCalls = 0
responder = async () => ({ status: 0, msg: '今日已领取' })
const pendingUpgrade = deferred()
upgradeResponder = () => pendingUpgrade.promise
const retry = claimModule.retryDailyVipClaim()
assert.equal(claimModule.dailyVipClaimState.running, true)
assert.equal(claimModule.retryDailyVipClaim(), retry)
pendingUpgrade.resolve({ status: 1, error_code: 0, data: {} })
const retriedRecord = await retry
assert.equal(retriedRecord.vipUpgradeStatus, 'success')
assert.equal(monthRecordCalls, 1)
assert.equal(claimCalls, 1)
assert.equal(upgradeCalls, 2)
assert.equal(claimModule.dailyVipClaimState.running, false)
assert.equal((await claimModule.runDailyVipAutoClaim('login')).skipped, true)
assert.equal(upgradeCalls, 2, 'automatic requests must still obey the daily attempt guard')

// If the server already confirms today's claim, manual retry upgrades without claiming twice.
monthRecordResponder = async () => ({ status: 1, data: [{ receive_day: claimDay }] })
upgradeResponder = async () => ({ status: 1, error_code: 0, data: {} })
assert.equal((await claimModule.retryDailyVipClaim()).vipUpgradeStatus, 'success')
assert.equal(claimCalls, 1)
assert.equal(upgradeCalls, 3)

// Duplicate-claim HTTP errors also permit the upgrade; ordinary claim errors never do.
monthRecordResponder = async () => ({ status: 1, data: [] })
responder = async () => { throw Object.assign(new Error('request failed'), { response: { data: { msg: '今日已领取' } } }) }
assert.equal((await claimModule.retryDailyVipClaim()).vipUpgradeStatus, 'success')
assert.equal(upgradeCalls, 4)
responder = async () => ({ status: 0, error_code: 1, msg: '领取失败' })
assert.equal((await claimModule.retryDailyVipClaim()).status, 'failed')
assert.equal(upgradeCalls, 4)
assert.equal(claimModule.dailyVipClaimState.running, false)
responder = async () => { throw new Error('未领取过当天 VIP') }
assert.equal((await claimModule.retryDailyVipClaim()).status, 'failed')
assert.equal(upgradeCalls, 4)
responder = async () => ({ status: 1, error_code: 0, data: {} })
assert.equal((await claimModule.retryDailyVipClaim()).vipUpgradeStatus, 'success')
assert.equal(upgradeCalls, 5)

// Account/session changes during a retry must not mutate another account's records.
const delayedTime = deferred()
serverTimeResponder = () => delayedTime.promise
const callsBeforeSwitch = claimCalls
const switchedRetry = claimModule.retryDailyVipClaim()
currentUserId = 'another-user'
delayedTime.resolve({ status: 1, data: { timestamp: serverTime / 1000 } })
assert.equal(await switchedRetry, null)
assert.equal(claimCalls, callsBeforeSwitch)
assert.equal(records.has('hydrogenmusic:daily-vip:another-user'), false)
assert.equal(claimModule.dailyVipClaimState.running, false)
currentUserId = 'test-user'
serverTimeResponder = async () => ({ status: 1, data: { timestamp: serverTime / 1000 } })
const beforeStaleUpgrade = records.get(storageKey)
const delayedUpgrade = deferred()
const upgradeStarted = deferred()
upgradeResponder = () => { upgradeStarted.resolve(); return delayedUpgrade.promise }
const staleUpgradeRetry = claimModule.retryDailyVipClaim()
await upgradeStarted.promise
const beforeUpgradeResponse = records.get(storageKey)
assert.notEqual(beforeUpgradeResponse, beforeStaleUpgrade)
currentToken = 'new-session-token'
delayedUpgrade.resolve({ status: 1, error_code: 0, data: {} })
assert.equal(await staleUpgradeRetry, null)
assert.equal(records.get(storageKey), beforeUpgradeResponse, 'an expired session must not save its upgrade response')
assert.equal(claimModule.dailyVipClaimState.running, false)

// Actual levels come from account entitlements, not local claim/upgrade success flags.
const vipProduct = (type, active = 1, expiry) => ({ product_type: type, is_vip: active, vip_end_time: expiry })
for (const [payload, tier, isHighest] of [
    [{ vip_type: 0, busi_vip: [] }, 'none', false],
    [{ vip_type: 1 }, 'vip', false],
    [{ busi_vip: [vipProduct('svip', '1')] }, 'concept', false],
    [{ busi_vip: [vipProduct('svip'), vipProduct('tvip', true)] }, 'music', true],
    [{ vip_type: '6' }, 'deluxe', true],
    [{ vip_type: 6, user_type: 16 }, 'super', true],
    [{ busi_vip: [vipProduct('dvip')] }, 'deluxe', true],
    [{ vip_type: 0, busi_vip: [vipProduct('tvip', 0)] }, 'none', false],
    [{ vip_type: 6, vip_end_time: (serverTime - 1000) / 1000 }, 'none', false],
    [{ busi_vip: [vipProduct('tvip', 1, serverTime - 1000)] }, 'none', false],
    [{ busi_vip: [vipProduct('tvip', 1, '2026-09-29 23:59:59')] }, 'none', false],
    [{ busi_vip: [vipProduct('tvip', 1, '2026-09-30')] }, 'music', true],
]) {
    const level = getCurrentVipLevel({ status: 1, data: { data: payload } }, serverTime)
    assert.equal(level.tier, tier)
    assert.equal(level.isHighest, isHighest)
}
assert.equal(getCurrentVipLevel(null).tier, 'unknown')
assert.equal(getCurrentVipLevel({ status: 0, msg: 'error' }).tier, 'unknown')
assert.equal(getCurrentVipLevel({ status: 0, data: { vip_type: 6 } }).tier, 'unknown')
assert.equal(getCurrentVipLevel({ status: 1, data: { error_code: 1001, vip_type: 6 } }).tier, 'unknown')

const apiRequests = []
let apiResponse = { status: 1, data: { vip_type: 6 } }
const apiContext = createContext({ Date })
const apiModule = new SourceTextModule(await readFile(resolve('src/api/user.js'), 'utf8'), { context: apiContext })
await apiModule.link(() => new SyntheticModule(['default'], function () {
    this.setExport('default', async config => { apiRequests.push(config); return apiResponse })
}, { context: apiContext }))
await apiModule.evaluate()
await apiModule.namespace.getVipInfo()
assert.equal(apiRequests.at(-1).url, '/user/vip/detail')
assert.ok(apiRequests.at(-1).params.timestamp > 0)
apiResponse = { status: 0, msg: '会员查询失败' }
await assert.rejects(apiModule.namespace.getVipInfo(), /会员查询失败/)

// Run Settings.vue's actual setup with Vue reactivity to verify retry and refresh behavior.
const { descriptor: settings } = parse(await readFile(resolve('src/views/Settings.vue'), 'utf8'))
const script = settings.scriptSetup.content.replace(/import[\s\S]*?from ['"][^'"]+['"];?\s*\n/g, '')
const userStore = reactive({ user: { userId: 'test-user' } })
const claimState = reactive({ running: false, userId: 'test-user', status: 'idle' })
let vipResponse = { status: 1, data: { vip_type: 0, busi_vip: [vipProduct('svip')] } }
let vipRequests = 0, uiRetries = 0
let vipResponder = async () => vipResponse
let uiRetryResponder = async () => {
    vipResponse = { status: 1, data: { vip_type: 0, busi_vip: [vipProduct('tvip')] } }
}
const settingsContext = createContext({
    console: { ...console, error() {} }, Date, ref, computed, watch, extractVipInfo, getCurrentVipLevel,
    useRouter: () => ({}), useUserStore: () => userStore, usePlayerStore: () => reactive({}),
    useOtherStore: () => reactive({}), useAppUpdate: () => ({ state: ref({ status: 'idle', version: '' }) }),
    window: {}, windowApi: {}, isLogin: () => !!userStore.user,
    onActivated() {}, onUnmounted() {}, onBeforeRouteLeave() {},
    dailyVipClaimState: claimState,
    retryDailyVipClaim: () => { uiRetries += 1; return uiRetryResponder() },
    getVipInfo: () => { vipRequests += 1; return vipResponder() },
    getLoginDevices: async () => ({ status: 1, data: [] }), normalizeLoginDevices: () => [],
    getKugouApiDeviceIdentity: () => null, refreshListenGradeInfo: async () => {}, noticeOpen() {},
})
const vueScope = effectScope()
vueScope.run(() => runInContext(script, settingsContext))
const settingsValue = expression => runInContext(expression, settingsContext)
const settle = async () => { for (let i = 0; i < 10; i++) await nextTick() }
try {
    await settingsValue('loadVipInfo()')
    assert.equal(settingsValue('profileDetailList.value.find(item => item.isVipLevel).label'), '当前 VIP 等级')
    assert.equal(settingsValue('vipLevelText.value'), '概念版 VIP')
    assert.equal(settingsValue('currentVipLevel.value.isHighest'), false)
    const pendingUiRetry = deferred()
    uiRetryResponder = () => pendingUiRetry.promise
    const uiRetry = settingsValue('retryVipClaim()')
    assert.equal(settingsValue('vipRetryDisabled.value'), true)
    assert.equal(settingsValue('vipRetryText.value'), '重试中…')
    await settingsValue('retryVipClaim()')
    assert.equal(uiRetries, 1)
    vipResponse = { status: 1, data: { vip_type: 0, busi_vip: [vipProduct('tvip')] } }
    pendingUiRetry.resolve({ vipUpgradeStatus: 'success' })
    await uiRetry
    assert.equal(vipRequests, 2)
    assert.equal(settingsValue('vipLevelText.value'), '畅听 VIP')
    assert.equal(settingsValue('currentVipLevel.value.isHighest'), true)
    assert.equal(settingsValue('vipRetrying.value'), false)
    await settingsValue('retryVipClaim()')
    assert.equal(uiRetries, 1, 'an account at the target level must not retry')

    vipResponse = { status: 1, data: { vip_type: 0, busi_vip: [] } }
    await settingsValue('loadVipInfo()')
    uiRetryResponder = async () => ({ vipUpgradeStatus: 'success' })
    await settingsValue('retryVipClaim()')
    assert.equal(settingsValue('vipLevelText.value'), '普通用户', 'request success alone must not be displayed as a VIP level')
    assert.equal(settingsValue('currentVipLevel.value.isHighest'), false)
    assert.equal(settingsValue('vipRetryDisabled.value'), false)

    claimState.running = true
    claimState.status = 'upgrading'
    await settle()
    assert.equal(settingsValue('vipRetryDisabled.value'), true)
    assert.equal(settingsValue('vipRetryText.value'), '升级中…')
    vipResponse = { status: 1, data: { vip_type: 6 } }
    claimState.running = false
    await settle()
    assert.equal(settingsValue('vipLevelText.value'), '豪华 VIP', 'automatic claim completion must also refresh entitlements')

    const delayedVip = deferred()
    vipResponder = () => delayedVip.promise
    const staleLoad = settingsValue('loadVipInfo()')
    vipResponder = async () => ({ status: 1, data: { vip_type: 0, busi_vip: [] } })
    userStore.user = { userId: 'another-user' }
    await settle()
    delayedVip.resolve({ status: 1, data: { vip_type: 6, user_type: 16 } })
    await staleLoad
    assert.equal(settingsValue('vipLevelText.value'), '普通用户', 'a previous account must not overwrite the new account level')

    const delayedUiRetry = deferred()
    uiRetryResponder = () => delayedUiRetry.promise
    const staleUiRetry = settingsValue('retryVipClaim()')
    userStore.user = { userId: 'third-user' }
    await settle()
    const requestsAfterAccountChange = vipRequests
    delayedUiRetry.resolve({ vipUpgradeStatus: 'success' })
    await staleUiRetry
    assert.equal(vipRequests, requestsAfterAccountChange, 'a previous account retry must not refresh the new account')
    assert.equal(settingsValue('vipRetrying.value'), false)

    vipResponder = async () => { throw new Error('network timeout') }
    await settingsValue('loadVipInfo()')
    assert.equal(settingsValue('vipLevelText.value'), '暂不可用')
    assert.equal(settingsValue('currentVipLevel.value.isHighest'), false)
    assert.equal(settingsValue('vipRetryDisabled.value'), false)
} finally {
    vueScope.stop()
}

console.log('daily VIP claim, manual retry and current VIP level checks passed')
