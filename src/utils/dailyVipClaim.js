import { reactive } from 'vue'
import { claimYouthDailyVip, getServerNow, getYouthVipMonthRecord, upgradeYouthDailyVip } from '../api/user'
import { getCookie, isLogin } from './authority'
import { noticeOpen } from './dialog'

const STORAGE_PREFIX = 'hydrogenmusic:daily-vip'
const SHANGHAI_TIME_ZONE = 'Asia/Shanghai'
const SHANGHAI_UTC_OFFSET = 8 * 60 * 60 * 1000
const DAY_ROLLOVER_BUFFER = 1000

export const dailyVipClaimState = reactive({
    running: false,
    status: 'idle',
    userId: '',
    claimDay: '',
    message: '',
    source: '',
    updatedAt: 0,
    serverTime: 0,
})

let claimPromise = null
let rolloverTimer = null

function getCurrentUserId() {
    return String(getCookie('userid') || '').trim()
}

function isCurrentAccount(userId, token) {
    return isLogin() && getCurrentUserId() === userId && getCookie('token') === token
}

function getStorageKey(userId) {
    return `${STORAGE_PREFIX}:${userId}`
}

function readStoredRecord(userId) {
    if (!userId || typeof localStorage === 'undefined') return null

    try {
        const raw = localStorage.getItem(getStorageKey(userId))
        if (!raw) return null
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? parsed : null
    } catch (_) {
        return null
    }
}

function writeStoredRecord(userId, record) {
    if (!userId || typeof localStorage === 'undefined') return

    try {
        localStorage.setItem(getStorageKey(userId), JSON.stringify(record))
    } catch (_) {}
}

function updateState(partial = {}) {
    Object.assign(dailyVipClaimState, partial, {
        updatedAt: Date.now(),
    })
}

function toDateString(value) {
    return String(value || '').trim()
}

function formatShanghaiDate(timestamp) {
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''

    try {
        const formatter = new Intl.DateTimeFormat('en', {
            timeZone: SHANGHAI_TIME_ZONE,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        })
        const parts = formatter.formatToParts(date)
        const year = parts.find(item => item.type === 'year')?.value
        const month = parts.find(item => item.type === 'month')?.value
        const day = parts.find(item => item.type === 'day')?.value
        if (year && month && day) return `${year}-${month}-${day}`
    } catch (_) {}

    // 兜底：用 UTC+8 手动拼接，避免本地时区影响领取日期。
    const shanghai = new Date(date.getTime() + SHANGHAI_UTC_OFFSET)
    const year = shanghai.getUTCFullYear()
    const month = String(shanghai.getUTCMonth() + 1).padStart(2, '0')
    const day = String(shanghai.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

function triggerDailyVipRollover() {
    if (claimPromise) {
        rolloverTimer = window.setTimeout(triggerDailyVipRollover, DAY_ROLLOVER_BUFFER)
        return
    }

    rolloverTimer = null
    void runDailyVipAutoClaim('day-rollover')
}

function scheduleNextDailyVipClaim(serverTime) {
    if (typeof window === 'undefined' || typeof window.setTimeout !== 'function') return

    const shanghai = new Date(serverTime + SHANGHAI_UTC_OFFSET)
    const nextMidnight = Date.UTC(
        shanghai.getUTCFullYear(),
        shanghai.getUTCMonth(),
        shanghai.getUTCDate() + 1,
    ) - SHANGHAI_UTC_OFFSET
    const delay = Math.max(0, nextMidnight - serverTime) + DAY_ROLLOVER_BUFFER

    if (rolloverTimer !== null) window.clearTimeout(rolloverTimer)
    rolloverTimer = window.setTimeout(triggerDailyVipRollover, delay)
}

function pickNumber(...values) {
    for (const value of values) {
        const number = Number(value)
        if (Number.isFinite(number)) return number
    }
    return NaN
}

function extractResponsePayload(result) {
    return result?.data ?? result?.result ?? result ?? {}
}

function normalizeTimestamp(ts) {
    // KuGou API 返回的时间戳可能是秒级（< 1e12），需要转成毫秒
    if (Number.isFinite(ts) && ts > 0 && ts < 1_000_000_000_000) {
        return ts * 1000
    }
    return ts
}

function extractServerTimestamp(result) {
    const payload = extractResponsePayload(result)
    const candidates = [
        payload?.timestamp,
        payload?.serverTime,
        payload?.server_time,
        payload?.now,
        payload?.time,
        payload?.data?.timestamp,
        payload?.data?.serverTime,
        payload?.data?.server_time,
        payload?.data?.now,
        payload?.data?.time,
    ]

    const resolved = pickNumber(...candidates)
    const normalized = normalizeTimestamp(resolved)
    return Number.isFinite(normalized) ? normalized : Date.now()
}

function normalizeText(value) {
    return toDateString(value)
}

function walkPayload(payload, visitor, seen = new Set()) {
    if (payload == null) return
    if (typeof payload !== 'object') {
        visitor(payload)
        return
    }

    if (seen.has(payload)) return
    seen.add(payload)

    if (Array.isArray(payload)) {
        payload.forEach(item => walkPayload(item, visitor, seen))
        return
    }

    visitor(payload)
    Object.values(payload).forEach(item => walkPayload(item, visitor, seen))
}

function hasClaimDayInPayload(payload, claimDay) {
    let matched = false

    walkPayload(payload, (item) => {
        if (matched || item == null) return

        if (typeof item === 'string') {
            if (item === claimDay || item.includes(claimDay)) {
                matched = true
            }
            return
        }

        if (typeof item !== 'object') return

        const directDay = toDateString(item.receive_day || item.receiveDay || item.day || item.date || item.claim_day)
        if (directDay && directDay.includes(claimDay)) {
            matched = true
            return
        }

        const claimFlags = [
            item.received,
            item.is_received,
            item.isReceive,
            item.has_received,
            item.hasReceive,
            item.already_received,
            item.alreadyReceive,
        ]

        if (claimFlags.some(flag => flag === true || flag === 1 || flag === '1' || String(flag).toLowerCase() === 'true')) {
            matched = true
        }
    })

    return matched
}

function isClaimedText(text) {
    if (/未领取|没有领取|未领过|未曾领取/i.test(text)) return false
    return /已领取|已经领取|今日已领|今天已领|重复领取|领取过|already\s*claimed|claimed\s*today/i.test(text)
}

function isLoginErrorText(text) {
    return /需要登录|请先登录|not\s*login|invalid\s*session|登录状态已失效|登录已过期/i.test(text)
}

function isSuccessResponse(result) {
    const payload = extractResponsePayload(result)
    const status = pickNumber(payload?.status, payload?.data?.status, result?.status, result?.data?.status)
    const code = pickNumber(payload?.code, payload?.data?.code, result?.code, result?.data?.code)
    const success = payload?.success ?? payload?.data?.success ?? result?.success ?? result?.data?.success
    const errorCode = pickNumber(payload?.error_code, payload?.data?.error_code, result?.error_code, result?.data?.error_code)
    const text = normalizeText(
        payload?.msg || payload?.message || payload?.desc || payload?.data?.msg || payload?.data?.message
        || result?.msg || result?.message || result?.desc || result?.data?.msg || result?.data?.message
    )

    if (Number.isFinite(errorCode) && errorCode !== 0) return false
    if (success === true) return true
    if (status === 1 || status === 200) return true
    if (code === 0 || code === 200) return true
    return /成功|领取成功|操作成功/i.test(text) && !/失败|error|错误/i.test(text)
}

function hasVipUpgradeAttempt(record) {
    return record?.vipUpgradeAttempted === true || record?.vipUpgradeStatus === 'success'
}

function isClaimRecordComplete(record, claimDay) {
    return record?.claimDay === claimDay
        && ['success', 'already'].includes(record?.status)
        && hasVipUpgradeAttempt(record)
}

function storeClaimResult(userId, claimDay, status, message, extra = {}) {
    const record = {
        userId,
        claimDay,
        status,
        message: message || '',
        source: extra.source || '',
        serverTime: extra.serverTime || 0,
        vipUpgradeAttempted: extra.vipUpgradeAttempted === true,
        vipUpgradeStatus: extra.vipUpgradeStatus || 'not-attempted',
        vipUpgradeMessage: extra.vipUpgradeMessage || '',
        vipUpgradeAttemptedAt: extra.vipUpgradeAttemptedAt || 0,
        updatedAt: Date.now(),
    }

    writeStoredRecord(userId, record)
    updateState(record)
    return record
}

function storeVipUpgradeResult(record, status, message) {
    const nextRecord = {
        ...record,
        vipUpgradeAttempted: true,
        vipUpgradeStatus: status,
        vipUpgradeMessage: message || '',
        vipUpgradeAttemptedAt: Date.now(),
        updatedAt: Date.now(),
    }
    writeStoredRecord(record.userId, nextRecord)
    updateState(nextRecord)
    return nextRecord
}

async function upgradeClaimedVip(record, source, serverTime, token) {
    const userId = record?.userId || getCurrentUserId()
    const claimDay = record?.claimDay || ''
    if (!userId || !claimDay || hasVipUpgradeAttempt(record)) return record
    if (!isCurrentAccount(userId, token)) return null

    updateState({
        running: true,
        status: 'upgrading',
        userId,
        claimDay,
        message: '正在升级概念版畅听 VIP',
        source,
        serverTime,
    })

    try {
        const result = await upgradeYouthDailyVip()
        const payload = extractResponsePayload(result)
        const message = normalizeText(
            payload?.msg || payload?.message || payload?.desc || payload?.data?.msg || payload?.data?.message
            || result?.msg || result?.message || result?.desc || result?.data?.msg || result?.data?.message
        )

        if (!isCurrentAccount(userId, token)) return null

        if (isSuccessResponse(result)) {
            const upgradedRecord = storeVipUpgradeResult({ ...record, userId }, 'success', message || '概念版畅听 VIP 升级成功')
            noticeOpen('概念版畅听 VIP 升级成功', 2)
            return upgradedRecord
        }

        const failedRecord = storeVipUpgradeResult({ ...record, userId }, 'failed', message || '概念版畅听 VIP 升级失败')
        noticeOpen(`概念版 VIP 升级失败：${failedRecord.vipUpgradeMessage}`, 2)
        return failedRecord
    } catch (error) {
        const failureMessage = normalizeText(error?.response?.data?.msg || error?.response?.data?.message || error?.message) || '未知错误'
        if (isLoginErrorText(failureMessage) || !isCurrentAccount(userId, token)) return null
        const failedRecord = storeVipUpgradeResult({ ...record, userId }, 'failed', failureMessage)
        noticeOpen(`概念版 VIP 升级失败：${failureMessage}`, 2)
        return failedRecord
    }
}

async function resolveClaimDay() {
    try {
        const result = await getServerNow()
        const serverTime = extractServerTimestamp(result)
        return {
            claimDay: formatShanghaiDate(serverTime),
            serverTime,
        }
    } catch (_) {
        const fallbackTime = Date.now()
        return {
            claimDay: formatShanghaiDate(fallbackTime),
            serverTime: fallbackTime,
        }
    }
}

async function precheckClaimed(claimDay) {
    const monthRecord = await getYouthVipMonthRecord().catch(() => null)
    if (monthRecord && hasClaimDayInPayload(monthRecord, claimDay)) {
        return true
    }
    return false
}

/**
 * 自动领取当天 VIP。
 * - 只对登录用户生效
 * - 同一用户当天领取成功后不再重复请求
 * - 领取失败保留记录，下次登录或启动时可重试
 * - 手动重试可绕过当天尝试记录，重新检查领取并升级
 * @param {string} source - 触发来源，便于调试和状态展示
 * @param {object} options
 * @returns {Promise<object|null>}
 */
export function runDailyVipAutoClaim(source = 'startup', { force = false } = {}) {
    if (claimPromise) return claimPromise

    claimPromise = (async () => {
        const userId = getCurrentUserId()
        if (!isLogin() || !userId) {
            updateState({
                running: false,
                status: 'idle',
                userId: '',
                claimDay: '',
                message: '',
                source,
            })
            return null
        }

        const token = getCookie('token')
        updateState({
            running: true,
            status: 'checking',
            userId,
            claimDay: '',
            message: '正在检查今日 VIP 领取状态',
            source,
        })
        const { claimDay, serverTime } = await resolveClaimDay()
        if (!isCurrentAccount(userId, token)) return null
        scheduleNextDailyVipClaim(serverTime)
        const storedRecord = readStoredRecord(userId)

        if (!force && isClaimRecordComplete(storedRecord, claimDay)) {
            updateState({
                running: false,
                ...storedRecord,
                userId,
                claimDay,
                source,
            })
            return {
                ...storedRecord,
                status: storedRecord.status,
                claimDay,
                message: storedRecord.message || '',
                skipped: true,
            }
        }

        // 兼容旧版本已经领取成功但尚未调用 upgrade 的记录；只补一次升级请求。
        if (!force && storedRecord?.claimDay === claimDay && ['success', 'already'].includes(storedRecord?.status)) {
            return upgradeClaimedVip({ ...storedRecord, userId }, source, serverTime, token)
        }

        updateState({
            running: true,
            status: 'checking',
            userId,
            claimDay,
            message: '正在检查今日 VIP 领取状态',
            source,
            serverTime,
        })

        try {
            const alreadyClaimed = await precheckClaimed(claimDay)
            if (!isCurrentAccount(userId, token)) {
                updateState({
                    running: false,
                    status: 'idle',
                    userId: getCurrentUserId(),
                    claimDay: '',
                    message: '',
                    source,
                })
                return null
            }

            if (alreadyClaimed) {
                const record = storeClaimResult(userId, claimDay, 'already', '今日已领取', {
                    source,
                    serverTime,
                })
                const upgradedRecord = await upgradeClaimedVip(record, source, serverTime, token)
                return {
                    ...(upgradedRecord || record),
                    alreadyClaimed: true,
                }
            }

            updateState({
                running: true,
                status: 'claiming',
                message: '正在领取今日 VIP',
            })

            const result = await claimYouthDailyVip(claimDay)
            const payload = extractResponsePayload(result)
            const message = normalizeText(
                payload?.msg || payload?.message || payload?.desc || payload?.data?.msg || payload?.data?.message
                || result?.msg || result?.message || result?.desc || result?.data?.msg || result?.data?.message
            )

            if (isLoginErrorText(message) || !isCurrentAccount(userId, token)) {
                updateState({
                    running: false,
                    status: 'idle',
                    userId: getCurrentUserId(),
                    claimDay: '',
                    message: '',
                    source,
                })
                return null
            }

            if (isSuccessResponse(result)) {
                const record = storeClaimResult(userId, claimDay, 'success', message || '今日 VIP 领取成功', {
                    source,
                    serverTime,
                })
                noticeOpen('今日 VIP 领取成功', 2)
                return upgradeClaimedVip(record, source, serverTime, token)
            }

            if (isClaimedText(message)) {
                const record = storeClaimResult(userId, claimDay, 'already', message || '今日已领取', {
                    source,
                    serverTime,
                })
                noticeOpen('今日 VIP 已领取', 2)
                return upgradeClaimedVip(record, source, serverTime, token)
            }

            const failureMessage = message || '今日 VIP 领取失败'
            const record = storeClaimResult(userId, claimDay, 'failed', failureMessage, {
                source,
                serverTime,
            })
            noticeOpen(`今日 VIP 领取失败：${failureMessage}`, 2)
            return record
        } catch (error) {
            const failureMessage = normalizeText(error?.response?.data?.msg || error?.response?.data?.message || error?.message) || '未知错误'
            if (isLoginErrorText(failureMessage) || !isCurrentAccount(userId, token)) {
                updateState({
                    running: false,
                    status: 'idle',
                    userId: getCurrentUserId(),
                    claimDay: '',
                    message: '',
                    source,
                })
                return null
            }
            if (isClaimedText(failureMessage)) {
                const record = storeClaimResult(userId, claimDay, 'already', failureMessage, { source, serverTime })
                return upgradeClaimedVip(record, source, serverTime, token)
            }
            const record = storeClaimResult(userId, claimDay, 'failed', failureMessage, {
                source,
                serverTime,
            })
            noticeOpen(`今日 VIP 领取失败：${failureMessage}`, 2)
            return record
        }
    })().finally(() => {
        claimPromise = null
        updateState({ running: false, source })
    })

    return claimPromise
}

/** 用户主动重试领取和升级；并发点击仍复用正在执行的任务。 */
export function retryDailyVipClaim() {
    return runDailyVipAutoClaim('manual-retry', { force: true })
}

/**
 * 供设置页等位置展示当前领取状态。
 * @param {string} userId
 * @returns {string}
 */
export function getDailyVipClaimText(userId = getCurrentUserId()) {
    const targetUserId = String(userId || '').trim()
    if (!isLogin() || !targetUserId) return '未登录'

    if (dailyVipClaimState.userId === targetUserId) {
        if (dailyVipClaimState.running || dailyVipClaimState.status === 'checking' || dailyVipClaimState.status === 'claiming') {
            return '自动检查中'
        }
        if (dailyVipClaimState.vipUpgradeStatus === 'failed') {
            return 'VIP 升级失败'
        }
        if (dailyVipClaimState.status === 'success' || dailyVipClaimState.status === 'already') {
            return '今日已领取'
        }
        if (dailyVipClaimState.status === 'failed') {
            return '今日领取失败'
        }
    }

    const storedRecord = readStoredRecord(targetUserId)
    if (!storedRecord) return '未领取'

    if (storedRecord.status === 'success' || storedRecord.status === 'already') {
        if (storedRecord.vipUpgradeStatus === 'failed') return 'VIP 升级失败'
        return '今日已领取'
    }

    if (storedRecord.status === 'failed') {
        return '今日已尝试'
    }

    return '未领取'
}
