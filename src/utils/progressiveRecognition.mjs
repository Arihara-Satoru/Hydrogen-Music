import { encodePCM, normalizeRecognitionResults, RECOGNITION_RATE, RECOGNITION_SECONDS } from './audioRecognition.mjs'

export const RECOGNITION_STAGES = [3, 6, 10]
export const RECOGNITION_TIMEOUT_MS = 30000

// 与 DOM、Web Audio 无关；采集和 HTTP 可同时进行，但请求严格串行。
export function createProgressiveRecognition({ match, signal, onState = () => {}, onProgress = () => {},
    stopCapture = () => {}, stages = RECOGNITION_STAGES, timeoutMs = RECOGNITION_TIMEOUT_MS }) {
    const buffer = new Float32Array(RECOGNITION_RATE * RECOGNITION_SECONDS)
    const requestAbort = new AbortController()
    const expiresAt = Date.now() + timeoutMs
    let count = 0, sent = 0, requests = 0, inFlight = false, ended = false, settled = false
    let resolve, reject, deadline
    const result = new Promise((yes, no) => { resolve = yes; reject = no })
    const state = () => onState({ capturing: !ended, matching: inFlight, requests })
    const finish = (error, songs) => {
        if (settled) return
        settled = true
        ended = true
        clearTimeout(deadline)
        signal?.removeEventListener('abort', abort)
        requestAbort.abort()
        stopCapture()
        buffer.fill(0)
        if (error) reject(error)
        else resolve(songs)
    }
    const abort = () => finish(new DOMException('已取消识别', 'AbortError'))
    const hasSound = () => {
        let energy = 0
        for (let i = 0; i < count; i++) energy += buffer[i] * buffer[i]
        return count > 0 && Math.sqrt(energy / count) >= 0.0002
    }
    const pump = async () => {
        if (settled || inFlight) return
        const nextStage = stages.find(seconds => seconds * RECOGNITION_RATE > sent)
        const ready = count > sent && count >= (ended ? RECOGNITION_RATE * 2 : nextStage * RECOGNITION_RATE)
        if (!ready || requests >= stages.length) {
            if (ended) finish(null, [])
            return
        }
        if (!hasSound()) {
            if (ended) finish(new Error('没有采集到有效声音，请检查音量、输入设备或录音权限'))
            return
        }
        sent = count
        requests++
        inFlight = true
        state()
        try {
            const pcm = encodePCM(buffer.subarray(0, count))
            const response = await match(pcm, requestAbort.signal, Math.max(1, expiresAt - Date.now()))
            if (settled) return
            const songs = normalizeRecognitionResults(response)
            inFlight = false
            if (songs.length) { finish(null, songs); return }
            state()
            void pump()
        } catch (error) { if (!settled) finish(error) }
    }
    signal?.addEventListener('abort', abort, { once: true })
    deadline = setTimeout(() => finish(new Error('识曲等待超时，请检查网络后重试')), timeoutMs)
    if (signal?.aborted) abort()
    return {
        result,
        push(samples) {
            if (settled || ended) return
            const length = Math.min(samples.length, buffer.length - count)
            buffer.set(samples.subarray(0, length), count)
            count += length
            onProgress(count / RECOGNITION_RATE)
            if (count === buffer.length) { this.end(); return }
            void pump()
        },
        end() {
            if (settled || ended) return
            ended = true
            stopCapture()
            state()
            if (count < RECOGNITION_RATE * 2) { finish(new Error('录音数据不足，请检查音频设备后重试')); return }
            void pump()
        },
        fail(error) { finish(error) },
    }
}
