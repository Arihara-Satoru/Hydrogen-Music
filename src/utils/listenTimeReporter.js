import { watch } from 'vue'
import { getUserGradeInfo } from '../api/user'
import pinia from '../store/pinia'
import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'
import { isLogin } from './authority'
import {
    calculateListenedSeconds,
    LISTEN_REPORT_STEP_SECONDS,
    takeReportableSeconds,
} from './listenTimeMath.mjs'

const playerStore = usePlayerStore(pinia)
const userStore = useUserStore(pinia)

let tickTimer = null
let unwatchAccount = null
let lastTickAt = 0
let pendingSeconds = 0
let reporting = false
let gradeRequestPromise = null

function nowMilliseconds() {
    return globalThis.performance?.now?.() ?? Date.now()
}

function currentUserId() {
    const userId = userStore.user?.userId ?? userStore.user?.userid
    return userId === undefined || userId === null || userId === '' ? null : String(userId)
}

function hasExpectedGradeFields(value) {
    return value && typeof value == 'object' && [
        'd_sec',
        'duration',
        'p_grade',
        'p_current_point',
        'p_next_grade',
    ].some(key => value[key] !== undefined && value[key] !== null)
}

export function normalizeGradeInfo(result) {
    if (!result || typeof result != 'object') return null
    if (Number(result.status) === 0 || (result.error_code !== undefined && Number(result.error_code) !== 0)) return null

    const candidates = [result?.data?.data, result?.data, result]
    const raw = candidates.find(hasExpectedGradeFields)
    if (!raw) return null

    const normalizeNumber = value => {
        const number = Number(value)
        return Number.isFinite(number) ? number : value
    }

    return {
        ...raw,
        d_sec: Math.max(0, Number(raw.d_sec) || 0),
        duration: normalizeNumber(raw.duration),
        p_grade: normalizeNumber(raw.p_grade),
        p_current_point: normalizeNumber(raw.p_current_point),
        p_grade_point: normalizeNumber(raw.p_grade_point),
        p_next_grade: normalizeNumber(raw.p_next_grade),
        p_next_grade_point: normalizeNumber(raw.p_next_grade_point),
    }
}

export function refreshListenGradeInfo() {
    const requestUserId = currentUserId()
    if (!requestUserId || !isLogin()) return Promise.resolve(null)
    if (gradeRequestPromise) return gradeRequestPromise

    gradeRequestPromise = getUserGradeInfo()
        .then(result => {
            if (currentUserId() !== requestUserId) return null
            const gradeInfo = normalizeGradeInfo(result)
            if (gradeInfo) userStore.updateGradeInfo(gradeInfo)
            return gradeInfo
        })
        .catch(error => {
            console.error('加载听歌等级失败:', error)
            return null
        })
        .finally(() => {
            gradeRequestPromise = null
        })

    return gradeRequestPromise
}

async function reportPendingListenTime() {
    if (reporting || !isLogin()) return

    const diffSeconds = takeReportableSeconds(pendingSeconds)
    const requestUserId = currentUserId()
    if (!requestUserId || diffSeconds < LISTEN_REPORT_STEP_SECONDS) return

    let reportedTotal = null
    reporting = true
    try {
        let gradeInfo = userStore.gradeInfo
        if (!Number.isFinite(Number(gradeInfo?.d_sec))) {
            gradeInfo = await refreshListenGradeInfo()
        }
        if (currentUserId() !== requestUserId || !gradeInfo) return

        reportedTotal = Math.max(0, Number(gradeInfo.d_sec) || 0) + diffSeconds
        const result = await getUserGradeInfo({
            d_sec: reportedTotal,
            diff_sec: diffSeconds,
        })
        if (currentUserId() !== requestUserId) return

        const nextGradeInfo = normalizeGradeInfo(result)
        if (!nextGradeInfo) throw new Error(result?.msg || result?.message || 'listen-time-report-failed')

        pendingSeconds = Math.max(0, pendingSeconds - diffSeconds)
        userStore.updateGradeInfo({
            ...nextGradeInfo,
            d_sec: Math.max(reportedTotal, Number(nextGradeInfo.d_sec) || 0),
        })
    } catch (error) {
        console.error('上报听歌时长失败:', error)
        const reconciledGradeInfo = await refreshListenGradeInfo()
        // 请求可能已被服务端接收、但响应在途中丢失；对账成功时不重复累计。
        if (
            currentUserId() === requestUserId
            && reportedTotal !== null
            && Number(reconciledGradeInfo?.d_sec) >= reportedTotal
        ) {
            pendingSeconds = Math.max(0, pendingSeconds - diffSeconds)
        }
    } finally {
        reporting = false
    }
}

function tickListenTime() {
    const now = nowMilliseconds()
    const active = !!playerStore.playing && !!currentUserId() && isLogin()
    pendingSeconds += calculateListenedSeconds(lastTickAt, now, active)
    lastTickAt = now

    if (pendingSeconds >= LISTEN_REPORT_STEP_SECONDS) {
        void reportPendingListenTime()
    }
}

export function initListenTimeReporter() {
    if (tickTimer) return

    lastTickAt = nowMilliseconds()
    tickTimer = setInterval(tickListenTime, 1000)
    unwatchAccount = watch(
        () => currentUserId(),
        (nextUserId, previousUserId) => {
            if (nextUserId === previousUserId) return
            pendingSeconds = 0
            lastTickAt = nowMilliseconds()
            userStore.updateGradeInfo(null)
            if (nextUserId && isLogin()) void refreshListenGradeInfo()
        },
        { immediate: true },
    )
}

export function destroyListenTimeReporter() {
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = null
    if (unwatchAccount) unwatchAccount()
    unwatchAccount = null
    lastTickAt = 0
    pendingSeconds = 0
    reporting = false
}
