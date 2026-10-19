const axios = require('axios')
const { parseBuffer } = require('./musicMetadata')

const HEADER_LIMIT = 1024 * 1024
const CACHE_LIMIT = 32
const metadataCache = new Map()

async function fetchRemoteAudioMetadata(url) {
    const response = await axios.get(url, {
        responseType: 'stream',
        timeout: 10000,
        headers: {
            Range: `bytes=0-${HEADER_LIMIT - 1}`,
            'Accept-Encoding': 'identity',
        },
    })
    const stream = response.data
    const chunks = []
    let length = 0
    try {
        // Also bound reads when a CDN ignores Range. Never download the whole song to inspect it.
        for await (const chunk of stream) {
            const part = chunk.subarray(0, HEADER_LIMIT - length)
            chunks.push(part)
            length += part.length
            if (length >= HEADER_LIMIT) break
        }
        // Sniff the actual bytes: CDN extensions and Content-Type can describe another format.
        const metadata = await parseBuffer(Buffer.concat(chunks, length), undefined, {
            duration: false,
            skipCovers: true,
            skipPostHeaders: true,
        })
        const format = metadata.format || {}
        let bitrate = format.bitrate
        // Range 头部探测时仅下载了截断 Buffer（HEADER_LIMIT）。
        // music-metadata 在缺失文件总大小时，会用截断 Buffer 长度除以音频总时长，
        // 导致计算出的码率极大偏小（如 FLAC 计算出 26 kbps）。
        // 当响应头包含 Content-Range 或真实 Content-Length 时，若拿到了有效时长，用总大小重新计算真实码率；
        // 否则如果在截断场景下码率明显偏低，则将其置为 undefined 避免污染上层数据。
        const contentRange = response.headers?.['content-range']
        const totalSize = contentRange
            ? Number(String(contentRange).split('/')[1])
            : Number(response.headers?.['content-length'])
        if (Number.isFinite(totalSize) && totalSize > 0 && Number.isFinite(format.duration) && format.duration > 0) {
            bitrate = Math.round((totalSize * 8) / format.duration)
        } else if (length >= HEADER_LIMIT || (contentRange && totalSize > length)) {
            // Buffer 被截断且无法根据总大小重算：
            // 无损音频正常码率通常远高于 200 kbps，若计算值极低则属于误算，丢弃该伪值
            if (format.lossless && bitrate && bitrate < 200000) {
                bitrate = undefined
            }
        }
        return {
            sampleRate: format.sampleRate,
            bitsPerSample: format.bitsPerSample,
            bitrate,
            container: format.container,
            codec: format.codec,
            lossless: format.lossless,
        }
    } finally {
        stream?.destroy?.()
    }
}

function loadRemoteAudioMetadata(options = {}) {
    let url
    try {
        url = new URL(String(options.url || '').trim())
        if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('音频地址必须使用 HTTP(S)')
    } catch (error) {
        return Promise.reject(error)
    }
    // Use the actual stream URL, not the song ID: each quality can be a different file.
    const key = url.toString()
    if (metadataCache.has(key)) return metadataCache.get(key)
    const request = fetchRemoteAudioMetadata(key).catch(error => {
        if (metadataCache.get(key) === request) metadataCache.delete(key)
        throw error
    })
    metadataCache.set(key, request)
    while (metadataCache.size > CACHE_LIMIT) metadataCache.delete(metadataCache.keys().next().value)
    return request
}

module.exports = { loadRemoteAudioMetadata, HEADER_LIMIT }
