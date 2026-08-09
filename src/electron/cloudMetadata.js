const axios = require('axios')
const path = require('path')
const { parseStream } = require('./musicMetadata')
const {
    collectEmbeddedLyricCandidates,
    selectBestLyricCandidate,
} = require('./localLyrics')

const CACHE_LIMIT = 32
const metadataCache = new Map()

function normalizeRemoteUrl(value) {
    const url = new URL(String(value || '').trim())
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new TypeError('云盘音频地址必须使用 HTTP(S)')
    }
    return url.toString()
}

function inferAudioMime(extension, contentType) {
    const responseMime = String(contentType || '').split(';')[0].trim().toLowerCase()
    const extensionMime = ({
        mp3: 'audio/mpeg',
        flac: 'audio/flac',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        ogg: 'audio/ogg',
        opus: 'audio/ogg',
        wav: 'audio/wav',
        wma: 'audio/x-ms-wma',
        ape: 'audio/ape',
        aiff: 'audio/aiff',
        aif: 'audio/aiff',
        dsf: 'audio/x-dsf',
    })[extension]
    return extensionMime || responseMime || 'application/octet-stream'
}

function inferPictureMime(picture) {
    const declared = String(picture?.format || '').trim().toLowerCase()
    if (declared.startsWith('image/')) return declared === 'image/jpg' ? 'image/jpeg' : declared

    const data = Buffer.from(picture?.data || [])
    if (data.length > 8 && data[0] === 0x89 && data.toString('ascii', 1, 4) === 'PNG') return 'image/png'
    if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
    if (data.length > 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
    return declared || 'image/jpeg'
}

async function serializeCloudMusicMetadata(metadata) {
    const common = metadata?.common || {}
    const picture = Array.isArray(common.picture) ? common.picture.find(item => item?.data?.length) : null
    const embeddedLyrics = await collectEmbeddedLyricCandidates('', {
        parseMetadata: async () => metadata,
    })
    const selectedLyric = selectBestLyricCandidate(embeddedLyrics)

    return {
        coverUrl: picture
            ? `data:${inferPictureMime(picture)};base64,${Buffer.from(picture.data).toString('base64')}`
            : '',
        lyric: selectedLyric?.text ? { lrc: { lyric: selectedLyric.text } } : null,
        title: String(common.title || '').trim(),
        artists: (Array.isArray(common.artists) ? common.artists : [common.artist])
            .map(value => String(value || '').trim())
            .filter(Boolean),
        album: String(common.album || '').trim(),
    }
}

function rememberMetadata(key, promise) {
    if (metadataCache.has(key)) metadataCache.delete(key)
    metadataCache.set(key, promise)
    while (metadataCache.size > CACHE_LIMIT) {
        metadataCache.delete(metadataCache.keys().next().value)
    }
}

async function fetchCloudMusicMetadata(options = {}) {
    const url = normalizeRemoteUrl(options.url)
    const extension = String(options.extension || path.extname(String(options.fileName || '')).slice(1))
        .replace(/^\./, '')
        .toLowerCase()
    const fileName = String(options.fileName || `cloud.${extension || 'mp3'}`)
    const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 30000,
        headers: {
            // MP3/FLAC tags live at the beginning; this also bounds the fallback request on compliant CDNs.
            Range: 'bytes=0-16777215',
            'Accept-Encoding': 'identity',
        },
    })
    const stream = response.data

    try {
        const size = Number(response.headers?.['content-length'])
        const metadata = await parseStream(stream, {
            path: fileName,
            url,
            mimeType: inferAudioMime(extension, response.headers?.['content-type']),
            ...(Number.isFinite(size) && size > 0 ? { size } : {}),
        }, {
            duration: false,
            skipCovers: false,
            // ponytail: cloud tags are expected in the leading metadata block; remove this when end-of-file APE tags are required.
            skipPostHeaders: true,
        })
        return serializeCloudMusicMetadata(metadata)
    } finally {
        stream?.destroy?.()
    }
}

function loadCloudMusicMetadata(options = {}) {
    const cacheKey = String(options.cacheKey || options.url || '').trim()
    if (!cacheKey) return Promise.reject(new TypeError('云盘歌曲缺少缓存键'))
    if (metadataCache.has(cacheKey)) return metadataCache.get(cacheKey)

    const request = fetchCloudMusicMetadata(options).catch(error => {
        metadataCache.delete(cacheKey)
        throw error
    })
    rememberMetadata(cacheKey, request)
    return request
}

module.exports = {
    loadCloudMusicMetadata,
    serializeCloudMusicMetadata,
}
