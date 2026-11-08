import workletSource from './audioRecognition.worklet.js?raw'
import { createRecognitionResampler } from './audioRecognitionDSP.mjs'
import { RECOGNITION_RATE, RECOGNITION_SECONDS } from './audioRecognition.mjs'

export class RecognitionCaptureUnavailable extends Error {}

// 初始化不接入输入；失败可复用同一条 MediaStream 降级到整段录音。
export async function createRecognitionCapture(stream, { signal, onSamples, onLevel = () => {}, onEnd, onError }) {
    let context, node, source, analyser, mute, timer, deadline, stopped = false
    const tracks = stream.getTracks()
    const detach = () => {
        signal?.removeEventListener('abort', abort)
        tracks.forEach(track => track.removeEventListener('ended', ended))
    }
    const release = (stopTracks = true) => {
        if (stopped) return
        stopped = true
        clearInterval(timer)
        clearTimeout(deadline)
        detach()
        if (node) {
            node.port.onmessage = null
            node.port.postMessage('stop')
            node.port.close()
            node.disconnect()
        }
        source?.disconnect()
        analyser?.disconnect()
        mute?.disconnect()
        if (stopTracks) tracks.forEach(track => track.stop())
        if (context) void context.close().catch(() => {})
        onLevel([])
    }
    const abort = () => release()
    const ended = () => { release(); onError(new Error('音频采集已被系统或设备中断，请检查权限后重试')) }
    const waitForSetup = promise => new Promise((resolve, reject) => {
        const cancelled = () => finish(new DOMException('已取消识别', 'AbortError'))
        const timeout = setTimeout(() => finish(new Error('连续采样初始化超时')), 5000)
        const finish = (error, value) => {
            clearTimeout(timeout)
            signal?.removeEventListener('abort', cancelled)
            if (error) reject(error)
            else resolve(value)
        }
        signal?.addEventListener('abort', cancelled, { once: true })
        Promise.resolve(promise).then(value => finish(null, value), finish)
        if (signal?.aborted) cancelled()
    })
    try {
        if (signal?.aborted) throw new DOMException('已取消识别', 'AbortError')
        context = new AudioContext()
        if (!context.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('AudioWorklet 不可用')
        const code = `const makeResampler = ${createRecognitionResampler.toString()};\n${workletSource}`
        const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
        try { await waitForSetup(context.audioWorklet.addModule(url)) } finally { URL.revokeObjectURL(url) }
        if (signal?.aborted) throw new DOMException('已取消识别', 'AbortError')
        node = new AudioWorkletNode(context, 'hydrogen-recognition', {
            processorOptions: { maxSamples: RECOGNITION_RATE * RECOGNITION_SECONDS },
        })
        source = context.createMediaStreamSource(stream)
        analyser = context.createAnalyser()
        analyser.fftSize = 128
        analyser.smoothingTimeConstant = 0.8
        mute = context.createGain()
        mute.gain.value = 0
        // 输出为零，且另有静音增益：只让音频图持续处理，不回放输入。
        node.connect(mute).connect(context.destination)
        await waitForSetup(context.resume())
        if (signal?.aborted) throw new DOMException('已取消识别', 'AbortError')
    } catch (error) {
        release(false)
        if (signal?.aborted || error?.name === 'AbortError') throw new DOMException('已取消识别', 'AbortError')
        throw new RecognitionCaptureUnavailable('连续采样不可用，将使用完整片段识别', { cause: error })
    }
    return {
        start() {
            if (stopped) return
            signal?.addEventListener('abort', abort, { once: true })
            if (signal?.aborted) { abort(); return }
            tracks.forEach(track => track.addEventListener('ended', ended, { once: true }))
            if (!stream.getAudioTracks().some(track => track.readyState === 'live')) { ended(); return }
            node.onprocessorerror = () => { release(); onError(new Error('音频处理器异常，请重新识别')) }
            node.port.onmessage = event => {
                if (stopped) return
                const { samples, done } = event.data
                onSamples(samples)
                if (done && !stopped) { release(); onEnd() }
            }
            const levels = new Uint8Array(64)
            source.connect(analyser)
            source.connect(node)
            timer = setInterval(() => { analyser.getByteFrequencyData(levels); onLevel(levels) }, 16)
            // 采样数量严格封顶；墙钟保护处理停滞，不延长录音等待“有效声音”。
            deadline = setTimeout(() => { release(); onEnd() }, RECOGNITION_SECONDS * 1000)
        },
        stop: release,
    }
}
