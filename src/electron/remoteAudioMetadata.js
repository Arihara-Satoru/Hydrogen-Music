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
        return {
            sampleRate: format.sampleRate,
            bitsPerSample: format.bitsPerSample,
            bitrate: format.bitrate,
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
