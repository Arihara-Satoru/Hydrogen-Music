import request from '../utils/request'

export function matchAudio(pcm, signal) {
    return request({
        url: '/audio/match', method: 'post', data: pcm,
        headers: { 'Content-Type': 'application/octet-stream' },
        // 后端有基于 URL 的缓存，不同录音必须使用不同 URL。
        params: { timestamp: `${Date.now()}-${Math.random().toString(36).slice(2)}` },
        signal, timeout: 30000,
    })
}
