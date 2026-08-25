import { get, getById, getWithPagination, operationRequest } from "./base";
import { buildIdWithTimestamp, buildOperationParams, buildPaginationParams } from "./params";
import { normalizeKugouKrcLyric } from "../utils/kugouLyric";
import { findRememberedLyricCandidate, rememberLyricCandidate as saveRememberedLyricCandidate } from "../utils/lyricPreference";
import { parseCommentReply } from "../utils/commentReplies";

/**
 * 获取推荐新音乐
 * @param {number} limit - 取出数量，默认10
 */
function normalizeNewestSongArtists(song = {}) {
    const authors = Array.isArray(song?.authors) ? song.authors : []
    if (authors.length > 0) {
        return authors
            .map(item => {
                const name = item?.author_name || item?.name || ''
                if (!name) return null
                return {
                    id: item?.author_id ?? item?.id ?? null,
                    name,
                }
            })
            .filter(Boolean)
    }

    const fallbackName = song?.author_name || ''
    if (!fallbackName) return []

    return fallbackName
        .split(/、|\/|,|，/)
        .map(name => name.trim())
        .filter(Boolean)
        .map(name => ({ id: null, name }))
}

function normalizeNewestSongItem(song = {}) {
    const artists = normalizeNewestSongArtists(song)
    const cover = song?.album_sizable_cover || song?.trans_param?.union_cover || song?.sizable_cover || song?.picUrl || song?.blurPicUrl || ''
    const coverUrl = typeof cover === 'string' ? cover.replace('{size}', '480') : cover
    const duration = Number(song?.timelength ?? song?.duration ?? song?.dt ?? 0) || 0

    return {
        ...song,
        id: song?.audio_id ?? song?.album_audio_id ?? song?.id ?? null,
        hash: song?.hash || '',
        name: song?.songname || song?.name || song?.filename || '',
        ar: artists,
        artists,
        al: {
            id: song?.album_id ?? null,
            name: song?.album_name || '',
            picUrl: coverUrl,
        },
        album: {
            id: song?.album_id ?? null,
            name: song?.album_name || '',
            picUrl: coverUrl,
        },
        picUrl: coverUrl,
        blurPicUrl: coverUrl,
        coverUrl,
        dt: duration,
        duration,
        source: 'top-song',
        type: 'song',
    }
}

export function getNewestSong(limit = 10) {
    return get('/top/song', { pagesize: limit }).then(result => {
        const rawList = Array.isArray(result?.data) ? result.data : Array.isArray(result?.result) ? result.result : []
        return {
            ...result,
            result: rawList.map(item => normalizeNewestSongItem(item)).filter(item => item.id && item.name),
        }
    });
}

/**
 * 获取歌曲详情
 * @param {string|array} ids - 歌曲ID，可以是单个ID或ID数组
 */
export function getSongDetail(ids) {
    const idsParam = Array.isArray(ids) ? ids.join(',') : ids;
    return get('/song/detail', { ids: idsParam });
}

/**
 * 检查音乐是否可用
 * @param {string|number} id - 音乐ID
 */
export function checkMusic(id) {
    return Promise.resolve({ success: true, message: 'ok' });
}

/**
 * 获取音乐播放URL
 * @param {string|number} id - 音乐ID
 * @param {string} level - 播放音质等级：standard/higher/exhigh/lossless/hires/jyeffect/sky/dolby/jymaster
 * @param {object} requestParams - 额外透传给 /song/url/v1 的请求参数（如 ua、cookie）
 */
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
    // 部分响应结构将有效地址嵌套在 data 字段内，递归兜底
    if (value.data) return extractPlayableUrl(value.data)
    return ''
}

function extractStreamMeta(body = {}, fallback = {}) {
    return {
        sr: body?.sr || body?.sampleRate || body?.sample_rate || fallback?.sr || fallback?.sampleRate || fallback?.sample_rate,
        br: body?.br || body?.bitrate || body?.bitRate || fallback?.br || fallback?.bitrate || fallback?.bitRate,
        bitsPerSample: body?.bitsPerSample || body?.bitDepth || body?.bit_depth || body?.bits_per_sample || fallback?.bitsPerSample || fallback?.bitDepth || fallback?.bit_depth || fallback?.bits_per_sample,
        size: body?.size || body?.fileSize || body?.filesize || fallback?.size || fallback?.fileSize || fallback?.filesize,
        volume: body?.volume ?? fallback?.volume,
        volumeGain: body?.volume_gain ?? body?.volumeGain ?? fallback?.volume_gain ?? fallback?.volumeGain,
        volumePeak: body?.volume_peak ?? body?.volumePeak ?? fallback?.volume_peak ?? fallback?.volumePeak,
    }
}

const STREAM_QUALITY_BY_LEVEL = {
    2: '128',
    4: '320',
    5: 'flac',
    6: 'high',
}

const STREAM_QUALITY_ALIASES = {
    hq: '320',
    sq: 'flac',
    lossless: 'flac',
    hires: 'high',
    'hi-res': 'high',
}

function normalizeStreamQuality(item, fallback = '') {
    const quality = String(item?.quality || '').toLowerCase()
    return STREAM_QUALITY_ALIASES[quality] || quality || STREAM_QUALITY_BY_LEVEL[Number(item?.level)] || fallback
}

function selectStreamByQuality(body, preferredQuality) {
    const roots = Array.isArray(body) ? body : [body]
    const candidates = roots.flatMap(item => [item, ...(Array.isArray(item?.relate_goods) ? item.relate_goods : [])])
    const playable = candidates.map(item => {
        const info = item?.info || item || {}
        const url = extractPlayableUrl(info) || extractPlayableUrl(item)
        if (!url) return null

        const level = normalizeStreamQuality(item, preferredQuality)
        return {
            url,
            level,
            type: info?.extname || info?.extName || info?.ext || item?.extname || item?.extName || item?.ext
                || (level === 'flac' || level === 'high' ? 'flac' : 'mp3'),
            ...extractStreamMeta(info, item),
        }
    }).filter(Boolean)

    return playable.find(item => item.level === preferredQuality) || playable[0] || null
}

function isHashLike(value) {
    return typeof value === 'string' && /^[A-Fa-f0-9]{32}$/.test(value.trim())
}

function buildSongUrlParams(input, quality, requestParams = {}) {
    const source = input && typeof input === 'object' ? input : {}
    const primitiveValue = input && typeof input !== 'object' ? String(input) : ''
    const hash = String(
        source?.hash ||
        source?.FileHash ||
        source?.file_hash ||
        source?.deprecated?.hash ||
        source?.audio_info?.hash_128 ||
        source?.audio_info?.hash_320 ||
        (isHashLike(primitiveValue) ? primitiveValue : '')
    ).trim()
    const albumAudioId = source?.album_audio_id || source?.mixsongid || source?.mixsong_id || (!isHashLike(primitiveValue) ? primitiveValue : '')

    const params = { ...requestParams, quality }
    if (hash) params.hash = hash
    if (albumAudioId) params.album_audio_id = albumAudioId
    return params
}

export async function getMusicUrl(input, quality = 'flac', requestParams = {}) {
    const raw = await get('/song/url', buildSongUrlParams(input, quality, requestParams))
    const body = raw?.body || raw?.data || raw || {}
    const url = extractPlayableUrl(body)
    const type = body?.extName || body?.ext || 'mp3'
    return { data: [{ url: url || null, level: quality, type, ...extractStreamMeta(body) }] }
}

/**
 * 获取音乐播放URL（新接口，支持 VIP 凭证）
 * 当 /song/url 无法返回有效地址时降级使用此接口。
 * @param {object|string} input - 歌曲对象或 ID
 * @param {string} quality - 音质
 * @param {object} requestParams - 额外参数
 */
export async function getMusicUrlNew(input, quality = 'flac', requestParams = {}) {
    const raw = await get('/song/url/new', buildSongUrlParams(input, quality, requestParams))
    const body = raw?.body || raw?.data || raw || {}
    const stream = selectStreamByQuality(body, quality)
    return { data: [stream || { url: null, level: quality, type: quality === 'flac' || quality === 'high' ? 'flac' : 'mp3' }] }
}

function resolveSongHash(input) {
    if (input && typeof input === 'object') {
        return String(
            input?.hash
            || input?.FileHash
            || input?.file_hash
            || input?.deprecated?.hash
            || input?.audio_info?.hash_128
            || input?.audio_info?.hash_320
            || input?.hash_128
            || input?.hash_high
            || input?.hash_flac
            || ''
        ).trim()
    }

    return String(input || '').trim()
}

/**
 * 获取歌曲各音质对应的资源哈希。
 * 酷狗不同音质使用不同 hash，不能只修改 quality 后复用原始 hash。
 */
export function getSongPrivilegeLite(input) {
    const hash = resolveSongHash(input)
    if (!isHashLike(hash)) return Promise.resolve(null)

    const source = input && typeof input === 'object' ? input : {}
    const albumId = source?.album_id || source?.albumid || source?.albumId || source?.al?.id || source?.album?.id
    return get('/privilege/lite', {
        hash,
        ...(albumId ? { album_id: albumId } : {}),
    })
}

function normalizeLyricDuration(value) {
    const duration = Number(value)
    if (!Number.isFinite(duration) || duration <= 0) return 0
    return Math.floor(duration > 1000 ? duration / 1000 : duration)
}

function normalizeLyricCandidates(response) {
    const candidates = Array.isArray(response?.candidates)
        ? response.candidates
        : Array.isArray(response?.body?.candidates)
            ? response.body.candidates
            : Array.isArray(response?.data?.candidates)
                ? response.data.candidates
                : []

    return candidates.filter(item => item && item.id && item.accesskey)
}

function buildLyricKeywords(song = {}) {
    const songName = song?.songname || song?.name || song?.filename || ''
    const artists = Array.isArray(song?.ar)
        ? song.ar
        : Array.isArray(song?.artists)
            ? song.artists
            : Array.isArray(song?.authors)
                ? song.authors
                : []
    const artistNames = artists
        .map(item => item?.name || item?.author_name || '')
        .filter(Boolean)
        .join(' ')
    return [songName, artistNames].filter(Boolean).join(' ').trim()
}

function buildLyricSearchParams(input, options = {}) {
    const source = input && typeof input === 'object' ? input : null
    const params = { ...options }
    const hash = source ? resolveSongHash(source) : String(input || '').trim()

    if (hash) params.hash = hash
    if (source) {
        const albumAudioId = source.album_audio_id || source.mixsongid || source.mixsong_id || source.audio_id || ''
        const duration = normalizeLyricDuration(source.dt || source.duration || source.timelength || options.duration)
        const keywords = options.keywords || buildLyricKeywords(source)
        if (albumAudioId) params.album_audio_id = albumAudioId
        if (duration) params.duration = duration
        if (keywords) params.keywords = keywords
    }

    return params
}

/**
 * 获取歌曲副歌时间段
 * @param {object|string} input - 歌曲对象或歌曲 hash
 * @returns {Promise<object>} 酷狗高潮接口原始响应
 */
export function getSongClimax(input) {
    const hash = resolveSongHash(input)
    return get('/song/climax', { hash })
}

/**
 * 喜欢/取消喜欢音乐
 * @param {string|number} id - 歌曲ID
 * @param {boolean} like - true为喜欢，false为取消喜欢
 */
export function likeMusic(id, like = true) {
    const params = buildIdWithTimestamp(id, { like });
    return get('/like', params);
}

/**
 * 搜索当前歌曲的可用歌词候选
 * @param {object|string|number} input - 歌曲对象或歌曲 hash
 */
export async function searchLyricCandidates(input, options = {}) {
    const params = buildLyricSearchParams(input, { ...options, man: options.man || 'yes' })
    const searchRes = await get('/search/lyric', params)
    return normalizeLyricCandidates(searchRes)
}

export function getRememberedLyricCandidate(input, candidates, options = {}) {
    return findRememberedLyricCandidate(buildLyricSearchParams(input, options), candidates)
}

export function rememberLyricCandidate(input, candidate, options = {}) {
    return saveRememberedLyricCandidate(buildLyricSearchParams(input, options), candidate)
}

export async function getLyricByCandidate(info) {
    if (!info) return { lrc: { lyric: '' } };
    const lyric = await get('/lyric', { id: info.id, accesskey: info.accesskey, fmt: 'krc', decode: true });
    const lyricText = lyric?.decodeContent || lyric?.body?.decodeContent || lyric?.lrc?.lyric || '';
    const { originalLyricText, translatedLyricText, romanizedLyricText } = normalizeKugouKrcLyric(lyricText);
    return {
        lrc: { lyric: originalLyricText || lyricText },
        ...(translatedLyricText ? { tlyric: { lyric: translatedLyricText } } : {}),
        ...(romanizedLyricText ? { romalrc: { lyric: romanizedLyricText } } : {}),
    };
}

/**
 * 获取音乐歌词
 * @param {object|string|number} input - 歌曲对象或歌曲 hash
 */
export async function getLyric(input) {
    const candidates = await searchLyricCandidates(input, { man: 'no' });
    return getLyricByCandidate(getRememberedLyricCandidate(input, candidates) || candidates[0]);
}

/**
 * 统一整理酷狗私人漫游接口的返回结构。
 * 酷狗接口真实歌曲列表位于 data.song_list，旧前端仍按网易云 data 数组读取，
 * 这里做一层兼容，避免页面端重复判断返回结构。
 * @param {object} response - 原始接口响应
 * @returns {object} 兼容后的响应对象，data 恒为歌曲数组
 */
function normalizePersonalFMResponse(response) {
    const songList = Array.isArray(response?.data?.song_list)
        ? response.data.song_list
        : Array.isArray(response?.song_list)
            ? response.song_list
            : Array.isArray(response?.data)
                ? response.data
                : []

    return {
        ...response,
        data: songList,
        fmMeta: response?.data && typeof response.data === 'object' && !Array.isArray(response.data)
            ? response.data
            : {},
    }
}

/**
 * 获取私人漫游歌曲列表。
 * 文档地址：/personal/fm
 * @param {object} params - 酷狗私人漫游接口参数
 * @returns {Promise<object>} 兼容后的响应对象，data 为歌曲数组
 */
export function getPersonalFM(params = {}) {
    return get('/personal/fm', {
        timestamp: new Date().getTime(),
        ...params,
    }).then(normalizePersonalFMResponse)
}

/**
 * 按模式获取私人漫游。
 * 旧前端沿用了网易云的 /personal/fm/mode，这里改为对接酷狗文档中的 /personal/fm。
 * @param {object} options - 选项
 * @param {string} options.mode - 漫游模式：normal/small/peak
 * @param {number|string} options.song_pool_id - AI 推荐池：0/1/2
 * @param {string} options.hash - 当前歌曲 hash
 * @param {string|number} options.songid - 当前歌曲 songid
 * @param {string|number} options.playtime - 当前歌曲已播放秒数
 * @param {string} options.action - play 或 garbage
 * @param {boolean|number} options.is_overplay - 是否完整播放
 * @param {number} options.remain_songcnt - 剩余未播放歌曲数
 */
export function getPersonalFMByMode(options = {}) {
    return getPersonalFM(options)
}

/**
 * 将私人漫游中的当前歌曲标记为“不喜欢”。
 * 酷狗文档使用 /personal/fm?action=garbage，而不是网易云的 /fm_trash。
 * @param {object|string|number} song - 当前歌曲对象或歌曲ID
 * @param {object} extraParams - 额外的上下文参数，用于提升下一批推荐的准确度
 */
export function fmTrash(song, extraParams = {}) {
    const source = song && typeof song === 'object' ? song : { id: song }
    return getPersonalFM({
        action: 'garbage',
        hash: source?.hash || '',
        songid: source?.songid || source?.songId || source?.id || '',
        ...extraParams,
    });
}

function toPositiveNumber(value, fallback = 0) {
    const num = Number(value)
    return Number.isFinite(num) && num >= 0 ? num : fallback
}

function resolveMixsongId(input) {
    if (input && typeof input === 'object') {
        return input.mixsongid || input.mixsong_id || input.album_audio_id || input.id || input.songId || input.musicId || null
    }
    return input || null
}

function normalizeCommentTimestamp(value) {
    if (!value) return Date.now()
    const num = Number(value)
    if (Number.isFinite(num) && num > 0) {
        return num < 1e12 ? num * 1000 : num
    }
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? Date.now() : parsed
}

function normalizeCommentUser(item = {}) {
    return {
        userId: item.user_id || item.userid || item.userId || 0,
        nickname: item.user_name || item.nickname || '酷狗用户',
        avatarUrl: item.user_pic || item.avatarUrl || item.avatar || '',
    }
}

function normalizeCommentImages(images) {
    if (!Array.isArray(images)) return []
    return images
        .map(image => {
            if (!image) return null
            const url = typeof image === 'string' ? image : image.url
            if (!url) return null
            return {
                url,
                width: toPositiveNumber(image.width, 0),
                height: toPositiveNumber(image.height, 0),
                label: image.label || '评论图片',
            }
        })
        .filter(Boolean)
}

function normalizeCommentItem(item = {}) {
    const commentId = Number(item.id || item.commentId || item.tid || 0)
    const likedCount = toPositiveNumber(item?.like?.count ?? item?.like?.likenum ?? item?.likedCount, 0)
    const replyCount = toPositiveNumber(item.reply_num ?? item.comments_num ?? item.replyCount, 0)
    const specialChildId = item.special_child_id || item.special_id || item.specialChildId || ''
    const mixsongid = item.album_audio_id || item.mixsongid || item.mixsong_id || ''
    const parsedContent = parseCommentReply(item.content, {
        userId: item.puser_id,
        userName: item.puser_name,
        content: item.pcontent,
    })

    return {
        commentId,
        content: parsedContent.content,
        time: normalizeCommentTimestamp(item.addtime || item.time || item.createTime || item.timestamp),
        liked: !!(item?.like?.haslike ?? item?.liked),
        likedCount,
        parentCommentId: Number(item.parentCommentId || item.parent_comment_id || item.parent_id || item.pid || 0),
        replyTo: parsedContent.replyTo,
        replyCount,
        showFloorComment: {
            replyCount,
        },
        special_child_id: specialChildId,
        special_id: item.special_id || '',
        specialId: item.special_id || '',
        special_child_name: item.special_child_name || '',
        specialChildId: specialChildId,
        specialChildName: item.special_child_name || '',
        mixsongid,
        album_audio_id: mixsongid,
        user: normalizeCommentUser(item),
        ipLocation: { location: item.location || '' },
        images: normalizeCommentImages(item.images),
        likedUsers: [],
        beReplied: [],
        raw: item,
    }
}

function getCommentResponseCode(response) {
    const errorCode = Number(response?.err_code ?? response?.error_code ?? 0)
    const status = Number(response?.status ?? 1)
    return errorCode === 0 && status !== 0 ? 200 : (errorCode || 500)
}

function normalizeMusicCommentsResponse(response, pageSize = 20) {
    const rawList = Array.isArray(response?.list) ? response.list : Array.isArray(response?.data?.list) ? response.data.list : []
    const comments = rawList.map(item => normalizeCommentItem(item))
    const total = toPositiveNumber(response?.count ?? response?.combine_count ?? response?.data?.count, comments.length)
    const currentPage = toPositiveNumber(response?.current_page ?? response?.page ?? response?.p ?? response?.data?.current_page, 1) || 1
    const normalizedPageSize = toPositiveNumber(pageSize, 20) || 20
    const maxPage = toPositiveNumber(response?.maxPage ?? response?.max_page ?? response?.data?.maxPage, 0)
    const hasMore = maxPage > 0
        ? currentPage < maxPage
        : currentPage * normalizedPageSize < total
    const rawClassifyList = Array.isArray(response?.classify_list) ? response.classify_list : []
    const rawHotwordList = Array.isArray(response?.hot_word_list) ? response.hot_word_list : []

    return {
        ...(response || {}),
        code: getCommentResponseCode(response),
        comments,
        total,
        hasMore,
        cursor: String(currentPage + 1),
        currentPage,
        classifyList: rawClassifyList.map(item => ({
            id: item.id,
            label: item.label || '',
            count: toPositiveNumber(item.cnt ?? item.count, 0),
            icon: item.icon || '',
        })).filter(item => item.id && item.label),
        hotwordList: rawHotwordList.map(item => ({
            content: item.content || item.hot_word || '',
            count: toPositiveNumber(item.count, 0),
        })).filter(item => item.content),
        specialChildId: response?.childrenid || '',
    }
}

function normalizeMusicCommentFloorResponse(response, pageSize = 20, requestPage = 1) {
    const rawList = Array.isArray(response?.list) ? response.list : Array.isArray(response?.data?.list) ? response.data.list : []
    const comments = rawList.map(item => normalizeCommentItem(item))
    const normalizedPageSize = toPositiveNumber(pageSize, 20) || 20
    const lastItem = rawList[rawList.length - 1] || {}
    const nextTime = toPositiveNumber(lastItem.loadoffset ?? response?.time ?? response?.data?.time, -1)
    const currentPage = toPositiveNumber(response?.current_page ?? response?.page ?? requestPage, requestPage) || 1
    const totalCount = toPositiveNumber(response?.comments_num ?? response?.count ?? response?.data?.comments_num, comments.length)

    return {
        code: getCommentResponseCode(response),
        data: {
            comments,
            totalCount,
            hasMore: currentPage * normalizedPageSize < totalCount,
            time: nextTime,
            page: currentPage,
            nextPage: currentPage + 1,
        },
    }
}

function normalizeMusicCommentCountResponse(response, lookupKey) {
    const source = response?.data && typeof response.data === 'object' ? response.data : response
    const directValue = source && lookupKey ? source[lookupKey] : undefined
    const fallbackValue = source && typeof source === 'object' ? Object.values(source).find(value => Number.isFinite(Number(value))) : 0
    return {
        code: getCommentResponseCode(response),
        total: toPositiveNumber(directValue ?? fallbackValue, 0),
    }
}

/**
 * 获取音乐评论数。优先使用 hash，也可传评论中的 special_child_id。
 * @param {object|string|number} input - 歌曲对象、hash 或 special_child_id
 */
export function getMusicCommentCount(input) {
    const source = input && typeof input === 'object' ? input : {}
    const primitive = input && typeof input !== 'object' ? `${input}` : ''
    const hash = source.hash || (/^[a-f\d]{32}$/i.test(primitive) ? primitive : '')
    const specialId = source.special_child_id || source.specialChildId || source.special_id || source.specialId || (!hash ? primitive : '')
    const lookupKey = `${hash || specialId || ''}`
    if (!lookupKey) throw new TypeError('获取歌曲评论数需要 hash 或 special_id')

    return get('/comment/count', hash ? { hash } : { special_id: specialId })
        .then(response => normalizeMusicCommentCountResponse(response, lookupKey))
}

function buildUnsupportedCommentActionResponse(action = '操作') {
    return Promise.resolve({
        code: 501,
        unsupported: true,
        message: `当前酷狗后端暂不支持歌曲评论${action}`,
    })
}

/**
 * 获取音乐评论
 * @param {string|number} id - 音乐ID
 * @param {object} options - 选项
 * @param {number} options.limit - 取出评论数量，默认20
 * @param {number} options.offset - 偏移数量，默认0
 * @param {number} options.before - 分页参数，用于获取超过5000条评论
 */
export function getMusicComments(id, { limit = 20, offset = 0, ...extraParams } = {}) {
    const source = typeof id === 'object' ? id : { id, limit, offset, ...extraParams }
    const mixsongid = resolveMixsongId(source)
    if (!mixsongid) throw new TypeError('获取歌曲评论需要 mixsongid')
    const requestLimit = toPositiveNumber(source.limit ?? limit, 20) || 20
    const requestOffset = toPositiveNumber(source.offset ?? offset, 0)
    const page = toPositiveNumber(source.page, 0) || Math.floor(requestOffset / requestLimit) + 1

    return get('/comment/music', {
        mixsongid,
        page,
        pagesize: requestLimit,
        show_classify: source.show_classify ?? 1,
        show_hotword_list: source.show_hotword_list ?? 1,
    }).then(response => normalizeMusicCommentsResponse(response, requestLimit))
}

/**
 * 按分类获取音乐评论。
 */
export function getMusicCommentsByClassify({ id, typeId, type_id, pageSize = 20, pagesize, pageNo = 1, page, sort = 1 } = {}) {
    const mixsongid = resolveMixsongId(id)
    const classifyId = typeId || type_id
    const requestPageSize = pagesize || pageSize
    const requestPage = page || pageNo
    if (!mixsongid || !classifyId) throw new TypeError('分类评论需要 mixsongid 和 type_id')

    return get('/comment/music/classify', {
        mixsongid,
        type_id: classifyId,
        page: requestPage,
        pagesize: requestPageSize,
        sort,
    }).then(response => normalizeMusicCommentsResponse(response, requestPageSize))
}

/**
 * 按热词获取音乐评论。
 */
export function getMusicCommentsByHotword({ id, hotWord, hot_word, pageSize = 20, pagesize, pageNo = 1, page } = {}) {
    const mixsongid = resolveMixsongId(id)
    const keyword = hotWord || hot_word
    const requestPageSize = pagesize || pageSize
    const requestPage = page || pageNo
    if (!mixsongid || !keyword) throw new TypeError('热词评论需要 mixsongid 和 hot_word')

    return get('/comment/music/hotword', {
        mixsongid,
        hot_word: keyword,
        page: requestPage,
        pagesize: requestPageSize,
    }).then(response => normalizeMusicCommentsResponse(response, requestPageSize))
}

/**
 * 获取音乐评论，并按需切换到分类/热词接口。
 * @param {object} params
 * @param {string|number} params.id - 音乐ID
 * @param {number|string} params.pageSize - 每页数量
 * @param {number|string} params.pageNo - 页码
 */
export async function getMusicCommentsNew({ id, pageSize = 20, pageNo = 1, typeId, hotWord, sort = 1 } = {}) {
    if (typeId) return getMusicCommentsByClassify({ id, typeId, pageSize, pageNo, sort })
    if (hotWord) return getMusicCommentsByHotword({ id, hotWord, pageSize, pageNo })
    return getMusicComments({ id, limit: pageSize, page: pageNo, show_classify: 1, show_hotword_list: 1 })
}

/**
 * 获取音乐评论楼层回复（comment/floor）
 * @param {object} params
 * @param {string|number} params.id - 音乐ID
 * @param {string|number} params.parentCommentId - 父评论ID
 * @param {number|string} params.limit - 分页数量
 * @param {number|string} params.page - 页码
 */
export function getMusicCommentFloor({ id, parentCommentId, limit = 20, page = 1 } = {}) {
    const mixsongid = resolveMixsongId(id)
    const commentTid = Number(parentCommentId)
    const specialId = id && typeof id === 'object'
        ? (id.special_id || id.special_child_id || id.specialId || id.specialChildId || '')
        : ''
    if (!mixsongid || !specialId || !commentTid) throw new TypeError('楼层评论需要 mixsongid、special_id 和 tid')

    return get('/comment/floor', {
        mixsongid,
        special_id: specialId,
        tid: commentTid,
        page,
        pagesize: limit,
    }).then(response => normalizeMusicCommentFloorResponse(response, limit, page))
}

/**
 * 发送音乐评论
 * @param {string|number} id - 音乐ID
 * @param {string} content - 评论内容
 * @param {string|number} commentId - 回复的评论ID（可选）
 * @param {object} extraParams - 额外参数
 */
export function postMusicComment(id, content, commentId = null, extraParams = {}) {
    return buildUnsupportedCommentActionResponse(commentId ? '回复' : '发送')
}

/**
 * 给音乐评论点赞/取消点赞
 * @param {string|number} id - 音乐ID
 * @param {string|number} cid - 评论ID
 * @param {boolean} isLike - true为点赞，false为取消点赞
 * @param {object} extraParams - 额外参数
 */
export function likeMusicComment(id, cid, isLike = true, extraParams = {}) {
    return buildUnsupportedCommentActionResponse(isLike ? '点赞' : '取消点赞')
}
