import { getCloudDiskSongUrl } from '../api/cloud'
import { getMusicPlaybackAuth, getMusicUrlAuth, getMusicUrl, getMusicUrlNew, getSongPrivilegeLite } from '../api/song'
import { getPreferredQuality } from './quality'
import { getCookie, updateStoredAuthCookies } from './authority'
import request, { invalidateNcmApiCookieCache } from './request'

const QUALITY_FALLBACK_ORDER = ['high', 'flac', '320', '128']
const PLAYBACK_PPAGE_ID = 356753938
const QUALITY_BY_LEVEL = {
    2: '128',
    4: '320',
    5: 'flac',
    6: 'high',
}
const QUALITY_ALIASES = {
    128: '128',
    320: '320',
    hq: '320',
    flac: 'flac',
    sq: 'flac',
    lossless: 'flac',
    high: 'high',
    hires: 'high',
    'hi-res': 'high',
}

let deviceRegistered = false
let deviceRegistrationPromise = null

/**
 * 注册设备（酷狗要求播放前先注册设备）
 * 仅在首次调用时执行一次，后续复用设备标识。
 */
export async function ensureDeviceRegistered() {
    if (deviceRegistered || getCookie('dfid')) {
        deviceRegistered = true
        return
    }
    if (deviceRegistrationPromise) return deviceRegistrationPromise

    deviceRegistrationPromise = request({
        url: '/register/dev',
        method: 'get',
    }).then((response) => {
        const dfid = String(
            response?.body?.data?.dfid
            || response?.data?.dfid
            || response?.dfid
            || ''
        ).trim()
        if (!dfid) return

        updateStoredAuthCookies({ cookie: `dfid=${dfid}` })
        invalidateNcmApiCookieCache()
        deviceRegistered = true
    }).catch((error) => {
        console.warn('设备注册失败，继续尝试播放:', error)
    }).finally(() => {
        deviceRegistrationPromise = null
    })

    return deviceRegistrationPromise
}

function extractPlayableUrl(value) {
    if (!value) return ''
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
        for (const item of value) {
            const url = extractPlayableUrl(item)
            if (url) return url
        }
        return ''
    }
    if (typeof value !== 'object') return ''
    const direct = value.url || value.play_url || value.playurl || value.music_url || value.downurl
    if (direct) return extractPlayableUrl(direct)
    if (Array.isArray(value.backupdownurl) && value.backupdownurl[0]) return value.backupdownurl[0]
    if (Array.isArray(value.tracker_url) && value.tracker_url[0]) return value.tracker_url[0]
    return extractPlayableUrl(value.data)
}

function buildQualityHashMap(response) {
    const body = response?.body || response
    const songs = Array.isArray(body?.data) ? body.data : []
    const firstSong = songs[0]
    if (!firstSong) return null

    const relatedSongs = Array.isArray(firstSong?.relate_goods) ? firstSong.relate_goods : []
    const qualityHashes = new Map()

    for (const item of [firstSong, ...relatedSongs]) {
        if (Number(item?.level) === 0) continue
        const hash = String(item?.hash || '').trim()
        if (!/^[A-Fa-f0-9]{32}$/.test(hash)) continue

        const qualityName = String(item?.quality || '').toLowerCase()
        const quality = QUALITY_ALIASES[qualityName] || QUALITY_BY_LEVEL[Number(item?.level)]
        if (quality && !qualityHashes.has(quality)) qualityHashes.set(quality, hash)
    }

    return qualityHashes.size ? qualityHashes : null
}

function withSongHash(song, hash) {
    return song && typeof song === 'object' ? { ...song, hash } : hash
}

async function getQualityHashes(song) {
    if (song && typeof song === 'object' && song.source === 'cloud') return null

    try {
        return buildQualityHashMap(await getSongPrivilegeLite(song))
    } catch (error) {
        console.warn('获取歌曲音质信息失败，使用原始 hash 继续尝试:', error)
        return null
    }
}

/**
 * 尝试用指定品质获取歌曲播放地址
 */
async function requestTrack(song, level, getPlaybackAuth, requireCurrentSession) {
    let lastError = null
    let fallbackTrack = null
    const rememberFallbackTrack = trackInfo => {
        const index = QUALITY_FALLBACK_ORDER.indexOf(trackInfo?.level)
        if (!trackInfo?.url || index < QUALITY_FALLBACK_ORDER.indexOf(level)) return
        if (!fallbackTrack || index < QUALITY_FALLBACK_ORDER.indexOf(fallbackTrack.level)) fallbackTrack = trackInfo
    }

    // 云盘歌曲优先走酷狗专用接口，拿不到时再回退到普通歌曲地址接口。
    if (song && typeof song === 'object' && song.source === 'cloud') {
        const cloudHash = song?.hash || song?.cloudUrlParams?.hash
        if (cloudHash) {
            try {
                const cloudUrlResult = await getCloudDiskSongUrl({
                    hash: cloudHash,
                    album_id: song?.cloudUrlParams?.album_id,
                    album_audio_id: song?.album_audio_id || song?.cloudUrlParams?.album_audio_id,
                    audio_id: song?.audio_id || song?.cloudUrlParams?.audio_id,
                    name: song?.cloudUrlParams?.name || song?.name,
                })
                requireCurrentSession()
                const cloudUrl = extractPlayableUrl(cloudUrlResult?.data || cloudUrlResult)
                if (cloudUrl) {
                    return {
                        url: cloudUrl,
                        level,
                        type: cloudUrlResult?.data?.extName || cloudUrlResult?.data?.ext || cloudUrlResult?.extName || 'mp3',
                    }
                }
            } catch (error) {
                requireCurrentSession()
                console.warn('云盘专用地址获取失败，回退到普通歌曲接口:', error)
            }
        }
    }

    // 优先使用用户授权 + 歌曲授权的聚合接口，高音质不再直接走旧 tracker。
    try {
        const auth = await getPlaybackAuth()
        requireCurrentSession()
        const songInfo = await getMusicUrlAuth(song, level, { auth })
        requireCurrentSession()
        const trackInfo = songInfo?.data?.[0]
        if (trackInfo?.url && trackInfo.level === level) return trackInfo
        rememberFallbackTrack(trackInfo)
    } catch (error) {
        requireCurrentSession()
        lastError = error
    }

    // Auth 链路不可用时，保留 /song/url（基础接口）兼容兜底。
    try {
        const songInfo = await getMusicUrl(song, level)
        requireCurrentSession()
        const trackInfo = songInfo?.data?.[0]
        if (trackInfo?.url && trackInfo.level === level) return trackInfo
        rememberFallbackTrack(trackInfo)
    } catch (error) {
        requireCurrentSession()
        lastError ||= error
    }

    // 部分版权资源只有使用概念版播放页 ID 时才会返回 URL。
    try {
        const songInfo = await getMusicUrl(song, level, {
            ppage_id: PLAYBACK_PPAGE_ID,
        })
        requireCurrentSession()
        const trackInfo = songInfo?.data?.[0]
        if (trackInfo?.url && trackInfo.level === level) return trackInfo
        rememberFallbackTrack(trackInfo)
    } catch (error) {
        requireCurrentSession()
        lastError ||= error
    }

    if (fallbackTrack) return fallbackTrack
    if (lastError) throw lastError
    return null
}

function buildQualityFallbackLevels(preferredLevel) {
    const normalizedLevel = getPreferredQuality(preferredLevel)
    const preferredIndex = QUALITY_FALLBACK_ORDER.indexOf(normalizedLevel)
    if (preferredIndex === -1) return ['flac', '320', '128']

    return QUALITY_FALLBACK_ORDER.slice(preferredIndex)
}

export async function resolveTrackByQualityPreference(song, preferredLevel) {
    const fallbackLevels = buildQualityFallbackLevels(preferredLevel)
    let lastError = null
    let fallbackTrack = null
    let playbackAuthPromise = null
    const account = [getCookie('token'), getCookie('userid')]
    const requireCurrentSession = () => {
        if (account[0] !== getCookie('token') || account[1] !== getCookie('userid')) {
            throw new Error('登录状态已变化，请重新获取播放地址')
        }
    }
    const getPlaybackAuth = () => {
        // 一次解析（含音质降级）只获取一次授权，不跨播放请求或账号缓存 auth。
        playbackAuthPromise ||= getMusicPlaybackAuth()
        return playbackAuthPromise
    }
    const rememberFallbackTrack = trackInfo => {
        const index = fallbackLevels.indexOf(trackInfo?.level)
        if (!trackInfo?.url || index < 0) return
        if (!fallbackTrack || index < fallbackLevels.indexOf(fallbackTrack.level)) fallbackTrack = trackInfo
    }

    // 在发起首次音质请求前确保设备已注册
    await ensureDeviceRegistered()
    requireCurrentSession()
    const qualityHashes = await getQualityHashes(song)
    requireCurrentSession()

    for (const level of fallbackLevels) {
        const qualityHash = qualityHashes?.get(level)
        if (qualityHashes && !qualityHash) continue

        try {
            const trackInfo = await requestTrack(
                qualityHash ? withSongHash(song, qualityHash) : song,
                level,
                getPlaybackAuth,
                requireCurrentSession
            )
            rememberFallbackTrack(trackInfo)
            if (trackInfo?.url && trackInfo.level === level) return fallbackTrack
        } catch (error) {
            requireCurrentSession()
            // 记录最后一次错误，继续尝试更低一档音质。
            lastError = error
        }
    }

    // 新接口自身会返回所有可用音质，只需要在单音质请求全部失败后请求一次。
    try {
        const songInfoNew = await getMusicUrlNew(song, fallbackLevels[0])
        requireCurrentSession()
        rememberFallbackTrack(songInfoNew?.data?.[0])
    } catch (fallbackError) {
        requireCurrentSession()
        console.warn('/song/url/new 降级请求也失败:', fallbackError)
    }

    if (fallbackTrack) return fallbackTrack
    if (lastError) throw lastError
    return null
}
