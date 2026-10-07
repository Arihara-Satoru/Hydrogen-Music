import { watch } from 'vue'
import { getUserGradeInfo, reportSongListen } from '../api/user'
import pinia from '../store/pinia'
import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'
import { isLogin, getCookie } from './authority'
import { getKugouApiDeviceIdentity } from './request'
import { calculatePlaybackMilliseconds } from './listenTimeMath.mjs'

const playerStore = usePlayerStore(pinia)
const userStore = useUserStore(pinia)

let tickTimer = null
let unwatchAccount = null
let unwatchPlayback = null
let detachPlayback = null
let session = null
let reportQueue = Promise.resolve()
let gradeRequestPromise = null
let gradeRequestUserId = null

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
    if (gradeRequestPromise && gradeRequestUserId === requestUserId) return gradeRequestPromise
    gradeRequestUserId = requestUserId

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
            if (gradeRequestUserId === requestUserId) gradeRequestPromise = null
        })

    return gradeRequestPromise
}

// ponytail: serialize events in memory; do not retry ambiguous failures or persist public playback events.
function enqueueReport(data, accountId) {
    reportQueue = reportQueue.then(async () => {
        if (currentUserId() !== accountId || !isLogin()) return
        try {
            if (data.event === 'end' && Number.isFinite(Number(userStore.gradeInfo?.d_sec))) {
                data.d_sec = Math.max(0, Number(userStore.gradeInfo.d_sec))
                data.diff_sec = Math.floor(data.duration / 1000)
            }
            const result = await reportSongListen(data)
            if (currentUserId() !== accountId) return
            const grade = normalizeGradeInfo(result?.data?.grade)
            if (grade) userStore.updateGradeInfo(grade)
        } catch (error) {
            // Do not print request configs: they can contain authentication credentials.
            console.warn('听歌上报失败:', error?.response?.data?.msg || error?.message || 'request-failed')
        }
    })
}

function sampleSession() {
    if (!session) return
    const now = nowMilliseconds()
    let seek
    let rate
    try {
        if (session.playback.state?.() === 'unloaded') {
            session.lastAt = now
            return
        }
        seek = Number(session.playback.seek?.())
        rate = Number(session.playback.rate?.()) || 1
    } catch (_) {
        session.lastAt = now
        return
    }
    session.duration += calculatePlaybackMilliseconds(session.lastAt, now, session.lastSeek, seek, rate)
    session.lastAt = now
    session.lastSeek = seek
}

function endSession(state) {
    if (!session) return
    sampleSession()
    const ended = session
    session = null
    const duration = Math.floor(ended.duration)
    enqueueReport({
        ...ended.identity, event: 'end', mixsongid: ended.mixsongid, duration, state,
    }, ended.accountId)
}

function startSession(playback, mixsongid) {
    if (session?.playback === playback) return
    endSession('切歌')
    const accountId = currentUserId()
    if (!accountId || !isLogin() || !/^[1-9]\d*$/.test(String(mixsongid || ''))) return
    const device = getKugouApiDeviceIdentity()
    const identity = { userid: accountId, token: getCookie('token'), ...(device ? { uuid: device.guid, mid: device.mid, device_model: device.dev } : {}) }
    session = { playback, mixsongid, accountId, identity, duration: 0, lastAt: nowMilliseconds(), lastSeek: Number(playback.seek?.()) }
    enqueueReport({ ...identity, event: 'start', mixsongid }, accountId)
}

function bindPlayback(playback) {
    endSession('切歌')
    detachPlayback?.()
    detachPlayback = null
    if (!playback?.on) return
    const track = playerStore.songList?.[playerStore.currentIndex]
    if (!track || track.type === 'local' || track.dirPath || track.source === 'siren' || playerStore.listInfo?.type === 'dj') return
    const mixsongid = track.mixsongid || track.mixsong_id || track.album_audio_id || track.id
    const start = () => { if (playerStore.currentMusic === playback) startSession(playback, mixsongid) }
    const pause = () => { if (session?.playback === playback) endSession('暂停') }
    const end = () => { if (session?.playback === playback) endSession('完整播放'); if (playback.playing?.()) start() }
    const stop = () => { if (session?.playback === playback) endSession('停止') }
    playback.on('play', start)
    playback.on('pause', pause)
    playback.on('end', end)
    playback.on('stop', stop)
    detachPlayback = () => {
        playback.off?.('play', start); playback.off?.('pause', pause)
        playback.off?.('end', end); playback.off?.('stop', stop)
    }
    if (playback.playing?.()) start()
}

export function initListenTimeReporter() {
    if (tickTimer) return
    tickTimer = setInterval(() => {
        sampleSession()
        // A preloaded player can emit play before it becomes the current playback.
        if (!session && playerStore.playing && playerStore.currentMusic?.playing?.()) bindPlayback(playerStore.currentMusic)
    }, 1000)
    unwatchAccount = watch(() => currentUserId(), (nextUserId, previousUserId) => {
        if (nextUserId === previousUserId) return
        session = null
        userStore.updateGradeInfo(null)
        if (nextUserId && isLogin()) {
            void refreshListenGradeInfo()
            bindPlayback(playerStore.currentMusic)
        }
    }, { immediate: true, flush: 'sync' })
    unwatchPlayback = watch(() => playerStore.currentMusic, bindPlayback, { flush: 'sync' })
}

export function destroyListenTimeReporter() {
    endSession('关闭播放器')
    if (tickTimer) clearInterval(tickTimer)
    tickTimer = null
    unwatchAccount?.(); unwatchAccount = null
    unwatchPlayback?.(); unwatchPlayback = null
    detachPlayback?.(); detachPlayback = null
}
