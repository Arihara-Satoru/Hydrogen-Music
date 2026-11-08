export const RECOGNITION_SECONDS = 10
export const RECOGNITION_RATE = 8000
export const RECOGNITION_HISTORY_KEY = 'hydrogen-audio-recognition-history'

export function normalizeRecognitionResults(response) {
    if (response?.error_code !== undefined && Number(response.error_code) !== 0) {
        throw new Error(response.error_msg || response.msg || response.message || '识曲服务暂不可用，请稍后重试')
    }
    if (response?.status !== undefined && Number(response.status) !== 1) {
        throw new Error(response.msg || response.message || response.error || '识曲服务暂不可用，请稍后重试')
    }
    if (!Array.isArray(response?.data)) throw new Error('识曲服务返回了无法解析的结果')
    const seen = new Set()
    return response.data.filter(item => item && typeof item === 'object').map(item => {
        const album = Array.isArray(item.album) ? item.album[0] || {} : item.album || {}
        const hash = [item.hash, item.hash_128, item.file_hash, item.FileHash, item.audio_info?.hash]
            .find(value => typeof value === 'string' && /^[\da-f]{32}$/i.test(value)) || ''
        const mixsongid = String(item.album_audio_id || item.mixsongid || album.album_audio_id || album.mixsongid || '')
        const id = mixsongid || String(item.audio_id || '') || hash
        const name = String(item.songname || item.song_name || item.name || '').trim()
        const suffix = String(item.songNameSuffix || '')
        const artists = [{ name: String(item.singername || item.author_name || '未知歌手') }]
        const coverUrl = String(item.union_cover || item.trans_param?.union_cover || '').replace('{size}', '240')
        const duration = Number(item.timelength_128 || item.timelength || 0) || 0
        return {
            id, hash, mixsongid, album_audio_id: mixsongid,
            name: suffix && !name.includes(suffix) ? `${name} (${suffix})` : name,
            ar: artists, artists, al: { id: String(album.album_id || item.album_id || ''), name: String(album.albumname || item.album_name || ''), picUrl: coverUrl },
            coverUrl, picUrl: coverUrl, dt: duration, duration,
            source: 'kugou', type: 'search',
        }
    }).filter(song => {
        const key = song.hash.toLowerCase() || song.id || `${song.name}:${song.ar[0].name}`
        if (!song.name || seen.has(key)) return false
        seen.add(key)
        return true
    }).slice(0, 8)
}

export function encodePCM(samples) {
    const buffer = new ArrayBuffer(samples.length * 2)
    const view = new DataView(buffer)
    for (let i = 0; i < samples.length; i++) {
        const value = Math.max(-1, Math.min(1, samples[i] || 0))
        view.setInt16(i * 2, value < 0 ? value * 32768 : value * 32767, true)
    }
    return buffer
}

export async function decodeRecording(blob) {
    const decoder = new OfflineAudioContext(1, 1, RECOGNITION_RATE)
    const decoded = await decoder.decodeAudioData(await blob.arrayBuffer())
    const length = Math.min(Math.ceil(decoded.duration * RECOGNITION_RATE), RECOGNITION_RATE * RECOGNITION_SECONDS)
    if (length < RECOGNITION_RATE * 2) throw new Error('录音过短，请让音乐播放后重试')
    const offline = new OfflineAudioContext(1, length, RECOGNITION_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const samples = (await offline.startRendering()).getChannelData(0)
    let energy = 0
    for (const sample of samples) energy += sample * sample
    if (Math.sqrt(energy / samples.length) < 0.0002) throw new Error('没有采集到有效声音，请检查音量、输入设备或录音权限')
    return encodePCM(samples)
}

export function recordAudioSample(stream, { signal, onProgress = () => {}, onLevel = () => {}, durationMs = RECOGNITION_SECONDS * 1000 } = {}) {
    return new Promise((resolve, reject) => {
        let recorder, context, source, analyser, timer, deadline
        let settled = false
        const chunks = []
        let bytes = 0
        const tracks = stream.getTracks()
        const finish = (error, blob) => {
            if (settled) return
            settled = true
            clearInterval(timer)
            clearTimeout(deadline)
            signal?.removeEventListener('abort', abort)
            for (const track of tracks) track.removeEventListener('ended', ended)
            if (recorder?.state !== 'inactive') { try { recorder?.stop() } catch {} }
            tracks.forEach(track => track.stop())
            source?.disconnect()
            if (context) void context.close().catch(() => {})
            onLevel([])
            if (error) reject(error)
            else resolve(blob)
        }
        const abort = () => finish(new DOMException('已取消识别', 'AbortError'))
        const ended = () => finish(new Error('音频采集已被系统或设备中断，请检查权限后重试'))
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) { abort(); return }
        try {
            const audioTracks = stream.getAudioTracks()
            if (!audioTracks.length || audioTracks.every(track => track.readyState === 'ended')) throw new Error('音频轨道不可用，请检查系统录音权限或选择其他输入设备')
            tracks.forEach(track => track.addEventListener('ended', ended, { once: true }))
            const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type))
            recorder = new MediaRecorder(new MediaStream(audioTracks), mimeType ? { mimeType } : undefined)
            recorder.ondataavailable = event => {
                if (event.data.size) { chunks.push(event.data); bytes += event.data.size }
                if (bytes > 8 * 1024 * 1024) finish(new Error('录音数据过大，已停止采集'))
            }
            recorder.onerror = () => finish(new Error('录音失败，请尝试其他输入设备'))
            recorder.onstop = () => {
                if (!chunks.length) finish(new Error('没有录制到音频，请重试'))
                else finish(null, new Blob(chunks, { type: recorder.mimeType }))
            }
            // 仅分析输入，不连接扬声器，避免回授及重复播放。
            try {
                context = new AudioContext()
                source = context.createMediaStreamSource(stream)
                analyser = context.createAnalyser()
                analyser.fftSize = 128
                analyser.smoothingTimeConstant = 0.8
                source.connect(analyser)
                void context.resume().catch(() => {})
            } catch { /* 频谱不可用不影响录音 */ }
            const levels = new Uint8Array(64)
            const started = performance.now()
            recorder.start(250)
            onProgress(0)
            timer = setInterval(() => {
                const elapsed = Math.min(durationMs, performance.now() - started)
                onProgress(elapsed / 1000)
                if (analyser) { analyser.getByteFrequencyData(levels); onLevel(levels) }
                if (elapsed >= durationMs && recorder.state === 'recording') recorder.stop()
            }, 16)
            deadline = setTimeout(() => finish(new Error('录音超时，请重新选择输入设备')), durationMs + 5000)
        } catch (error) { finish(error) }
    })
}

export function recognitionErrorMessage(error, source) {
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return source === 'system'
        ? '未能取得电脑声音采集权限，可能是系统限制、授权取消或采集适配失败。请重试；macOS 请检查屏幕 / 系统音频录制权限。'
        : '未能取得麦克风权限。请在系统隐私设置中允许应用使用麦克风，或检查是否取消了授权。'
    if (error?.name === 'NotFoundError') return '未找到可用音频设备，请检查系统音频设备与内录支持情况。'
    if (error?.name === 'NotReadableError') return '无法访问音频设备，可能被占用或未获得系统权限。'
    if (error?.name === 'NotSupportedError' || error?.name === 'TypeError') return source === 'system'
        ? '当前系统无法直接采集电脑声音，请检查系统版本与内录支持情况。'
        : '当前环境不支持录音，请使用桌面客户端或检查输入设备。'
    return error?.message || '识别失败，请稍后重试'
}

export function readRecognitionHistory(storage = globalThis.localStorage) {
    try {
        const list = JSON.parse(storage.getItem(RECOGNITION_HISTORY_KEY) || '[]')
        return Array.isArray(list) ? list.filter(item => item?.song?.name && Array.isArray(item.song.ar)).slice(0, 12) : []
    } catch { return [] }
}

export function saveRecognitionHistory(history, song, source, storage = globalThis.localStorage) {
    const key = song.hash || song.id || song.name
    const next = [{ song, source, time: Date.now() }, ...history.filter(item => (item.song.hash || item.song.id || item.song.name) !== key)].slice(0, 12)
    try { storage.setItem(RECOGNITION_HISTORY_KEY, JSON.stringify(next)) } catch { /* 禁用存储时仍可识曲 */ }
    return next
}
