<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { matchAudio } from '../api/audioRecognition'
import { addToNext, isSongLiked, updateFavoritePlaylistTrack } from '../utils/player'
import { useUserStore } from '../store/userStore'
import { usePlayerStore } from '../store/playerStore'
import { useListenTogetherStore } from '../store/listenTogetherStore'
import { noticeOpen } from '../utils/dialog'
import { resolveImageUrl } from '../utils/imageUtils'
import { extractDynamicPalette } from '../utils/dynamicTheme'
import { decodeRecording, normalizeRecognitionResults, readRecognitionHistory, recordAudioSample,
    recognitionErrorMessage, RECOGNITION_HISTORY_KEY, RECOGNITION_SECONDS, saveRecognitionHistory } from '../utils/audioRecognition.mjs'

const emit = defineEmits(['close'])
const router = useRouter()
const userStore = useUserStore()
const playerStore = usePlayerStore()
const togetherStore = useListenTogetherStore()

const panel = ref(null)
const waveRef = ref(null)
const timeFillRef = ref(null)
const source = ref(globalThis.process?.platform === 'win32' ? 'system' : 'microphone')
const device = ref('')
const devices = ref([])
const phase = ref('idle')
const elapsed = ref(0)
const errorText = ref('')
const results = ref([])
const history = ref(readRecognitionHistory())
const showHistory = ref(false)
const favoriteBusy = ref(false)

const dynamicHue = ref(null)
const dynamicSat = ref(null)

const panelStyle = computed(() => {
    if (!Number.isFinite(dynamicHue.value)) return {}
    return {
        '--ambient-hue': String(dynamicHue.value),
        '--ambient-saturation': `${dynamicSat.value ?? 60}%`,
    }
})

async function refreshDynamicTheme() {
    if (typeof document !== 'undefined') {
        const rootStyle = getComputedStyle(document.documentElement)
        const ambientHue = parseFloat(rootStyle.getPropertyValue('--ambient-hue'))
        const ambientSat = parseFloat(rootStyle.getPropertyValue('--ambient-saturation'))
        if (Number.isFinite(ambientHue) && ambientHue > 0) {
            dynamicHue.value = Math.round(ambientHue)
            dynamicSat.value = Number.isFinite(ambientSat) ? Math.round(ambientSat) : 60
            return
        }
    }

    const cover = playerStore.currentMusic?.al?.picUrl || playerStore.currentMusic?.coverUrl
    if (cover) {
        try {
            const palette = await extractDynamicPalette(cover)
            if (Number.isFinite(palette?.hue)) {
                dynamicHue.value = Math.round(palette.hue)
                dynamicSat.value = Number.isFinite(palette.saturation) ? Math.round(palette.saturation) : 60
                return
            }
        } catch (_) {}
    }

    dynamicHue.value = null
    dynamicSat.value = null
}

watch(
    () => [playerStore.currentMusic, playerStore.dynamicTheme],
    () => { void refreshDynamicTheme() },
    { immediate: true }
)

const busy = computed(() => ['permission', 'recording', 'processing', 'matching'].includes(phase.value))
const heading = computed(() => ({ idle: '让声音告诉你歌名', permission: '等待录音授权', recording: '正在聆听', processing: '正在处理音频', matching: '正在寻找匹配', success: '找到这些歌曲', empty: '暂未找到匹配', error: '这次没能完成识别' }[phase.value]))
const helper = computed(() => {
    if (errorText.value) return errorText.value
    if (phase.value === 'recording') return '请保持音乐播放，采集完成后自动识别。'
    if (phase.value === 'permission') return '请完成系统弹出的授权；取消可随时停止本次操作。'
    if (phase.value === 'empty') return '试试更清晰的片段，或避开人声解说后重新识别。'
    if (phase.value === 'success') return '选择歌曲播放或收藏，播放权限以当前账号为准。'
    if (busy.value) return '采集已结束，录音设备已释放。'
    return source.value === 'system' ? '识别浏览器、视频或其他应用正在播放的音乐。' : '识别身边播放的音乐，也可选择虚拟声卡输入。'
})

const BAR_COUNT = 40
const currentLevels = new Float32Array(BAR_COUNT).fill(0.04)
const targetLevels = new Float32Array(BAR_COUNT).fill(0.04)
let animId = null

function updateVisualizerTarget(rawLevels) {
    const len = rawLevels?.length || 0
    if (!len) {
        targetLevels.fill(0.04)
        return
    }
    for (let i = 0; i < BAR_COUNT; i++) {
        const srcIdx = Math.floor((i / BAR_COUNT) * Math.min(len, 48))
        const raw = rawLevels[srcIdx] || 0
        const normalized = Math.max(0.04, Math.pow(raw / 255, 1.25))
        targetLevels[i] = normalized
    }
}

function tickVisualizer(now) {
    animId = requestAnimationFrame(tickVisualizer)
    const bars = waveRef.value?.children
    if (!bars || bars.length < BAR_COUNT) return

    const isRecording = phase.value === 'recording'

    for (let i = 0; i < BAR_COUNT; i++) {
        let target = 0.04
        if (isRecording) {
            target = targetLevels[i]
        } else {
            // Idle breathing sine wave
            const wave = Math.sin(now * 0.003 + i * 0.25) * 0.5 + 0.5
            target = 0.04 + wave * 0.08
        }
        if (target > currentLevels[i]) {
            currentLevels[i] += (target - currentLevels[i]) * 0.42
        } else {
            currentLevels[i] += (target - currentLevels[i]) * 0.16
        }
        const val = Math.max(0.04, Math.min(1, currentLevels[i]))
        bars[i].style.transform = `scaleY(${val.toFixed(3)})`
    }

    if (isRecording && timeFillRef.value) {
        const ratio = Math.min(1, Math.max(0, elapsed.value / RECOGNITION_SECONDS))
        timeFillRef.value.style.transform = `scaleX(${ratio.toFixed(3)})`
    }
}

let controller = null
let requestId = null
let attempt = 0
let alive = true
let previousFocus = null
let appWasInert = false

async function refreshDevices() {
    try { devices.value = (await navigator.mediaDevices.enumerateDevices()).filter(item => item.kind === 'audioinput') } catch { devices.value = [] }
}

function cancel() {
    attempt++
    controller?.abort()
    controller = null
    void globalThis.windowApi?.cancelAudioRecognition?.(requestId).catch(() => {})
    requestId = null
    elapsed.value = 0
    targetLevels.fill(0.04)
    if (busy.value) phase.value = 'idle'
}

function close() { cancel(); emit('close') }

function chooseSource(value) {
    if (busy.value) return
    source.value = value
    phase.value = 'idle'
    errorText.value = ''
    results.value = []
}

async function start() {
    if (busy.value) return
    const token = ++attempt
    const abort = new AbortController()
    const captureId = crypto.randomUUID()
    requestId = captureId
    controller = abort
    const current = () => alive && token === attempt && !abort.signal.aborted
    let stream = null
    errorText.value = ''
    results.value = []
    showHistory.value = false
    elapsed.value = 0
    phase.value = 'permission'
    try {
        if (!navigator.mediaDevices || typeof MediaRecorder === 'undefined') throw new DOMException('不支持录音', 'NotSupportedError')
        await globalThis.windowApi?.prepareAudioRecognition?.(source.value, captureId)
        if (!current()) return
        if (source.value === 'system') {
            stream = await navigator.mediaDevices.getDisplayMedia({
                audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
                video: { width: 320, height: 180, frameRate: 1 },
            })
            if (!current()) return
            if (!stream.getAudioTracks().some(track => track.readyState === 'live')) {
                throw new Error('系统没有提供可用的音频轨道。请检查系统音频录制权限，或切换麦克风选择监听输入 / 虚拟声卡。')
            }
        } else {
            stream = await navigator.mediaDevices.getUserMedia({ audio: {
                ...(device.value ? { deviceId: { exact: device.value } } : {}),
                echoCancellation: false, noiseSuppression: false, autoGainControl: false,
            }, video: false })
            if (!current()) return
            void refreshDevices()
        }
        // 授权与采集获取后立即撤销临时权限。不上传或编码任何视频轨道；
        // 保留系统采集的伴随视频轨道至录音结束，避免部分平台停止音频。
        void globalThis.windowApi?.cancelAudioRecognition?.(captureId).catch(() => {})
        phase.value = 'recording'
        const blob = await recordAudioSample(stream, {
            signal: abort.signal,
            onProgress: value => { if (current()) elapsed.value = value },
            onLevel: value => { if (current()) updateVisualizerTarget(value) },
        })
        if (!current()) return
        phase.value = 'processing'
        const pcm = await decodeRecording(blob)
        if (!current()) return
        phase.value = 'matching'
        const response = await matchAudio(pcm, abort.signal)
        if (!current()) return
        results.value = normalizeRecognitionResults(response)
        phase.value = results.value.length ? 'success' : 'empty'
        if (results.value.length) history.value = saveRecognitionHistory(history.value, results.value[0], source.value)
    } catch (error) {
        if (!current()) return
        errorText.value = recognitionErrorMessage(error, source.value)
        phase.value = 'error'
    } finally {
        stream?.getTracks().forEach(track => track.stop())
        if (token === attempt) {
            controller = null
            requestId = null
            void globalThis.windowApi?.cancelAudioRecognition?.(captureId).catch(() => {})
        }
    }
}

function searchSong(song) {
    router.push({ name: 'search', query: { keywords: `${song.name} ${song.ar.map(item => item.name).join(' ')}`, type: 1 } })
    close()
}

function playSong(song, autoplay) {
    if (togetherStore.room) { noticeOpen('一起听期间请在房间内点歌，或离开房间后播放', 2); return }
    // FM 当前页的 addToNext(true) 会切到下一首 FM；识曲点播需先退出该路由。
    const action = async () => {
        if (autoplay && router.currentRoute.value.name === 'personalfm') await router.push('/')
        addToNext(song, autoplay)
        if (autoplay) close()
    }
    void action().catch(error => noticeOpen(error.message || '播放失败', 2))
}

async function favorite(song) {
    if (!userStore.user?.userId) { noticeOpen('请先登录账号再收藏', 2); return }
    if (favoriteBusy.value) return
    favoriteBusy.value = true
    try {
        const liked = isSongLiked(song)
        const result = await updateFavoritePlaylistTrack(song, !liked)
        noticeOpen(result.success ? (liked ? '已取消喜欢' : '已添加到我喜欢') : (result.message || '收藏失败'), 2)
    } catch (error) { noticeOpen(error.message || '收藏失败', 2) }
    finally { favoriteBusy.value = false }
}

function clearHistory() {
    history.value = []
    try { localStorage.removeItem(RECOGNITION_HISTORY_KEY) } catch {}
}

function handleKey(event) {
    if (!['Escape', 'Tab'].includes(event.key)) return
    event.stopPropagation()
    if (event.key === 'Escape') { event.preventDefault(); close(); return }
    if (event.key !== 'Tab') return
    const focusable = Array.from(panel.value?.querySelectorAll('button:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') || []).filter(element => element.getClientRects().length)
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}

function handleWindowPointerDown(e) {
    if (!panel.value) return
    if (!panel.value.contains(e.target) && !e.target.closest('.recognition-launcher')) {
        close()
    }
}

onMounted(async () => {
    previousFocus = document.activeElement
    appWasInert = document.getElementById('app')?.inert || false
    if (document.getElementById('app')) document.getElementById('app').inert = true
    await nextTick()
    panel.value?.focus()
    void refreshDevices()
    void refreshDynamicTheme()
    navigator.mediaDevices?.addEventListener('devicechange', refreshDevices)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('keydown', handleKey, true)
    window.addEventListener('pointerdown', handleWindowPointerDown, true)
    animId = requestAnimationFrame(tickVisualizer)
})

onBeforeUnmount(() => {
    alive = false
    if (animId) cancelAnimationFrame(animId)
    cancel()
    navigator.mediaDevices?.removeEventListener('devicechange', refreshDevices)
    window.removeEventListener('pagehide', cancel)
    window.removeEventListener('keydown', handleKey, true)
    window.removeEventListener('pointerdown', handleWindowPointerDown, true)
    if (document.getElementById('app')) document.getElementById('app').inert = appWasInert
    previousFocus?.focus?.()
})
</script>

<template>
    <Teleport to="body">
        <div class="recognition-shade" @mousedown.self="close" @keydown.stop>
            <section
                ref="panel"
                class="recognition-panel"
                :style="panelStyle"
                role="dialog"
                aria-modal="true"
                aria-labelledby="recognition-title"
                tabindex="-1"
                data-ark-theme="corporate"
                data-ark-depth="minimal"
            >
                <span class="panel-corner corner-tl" aria-hidden="true"></span>
                <span class="panel-corner corner-tr" aria-hidden="true"></span>
                <span class="panel-corner corner-bl" aria-hidden="true"></span>
                <span class="panel-corner corner-br" aria-hidden="true"></span>

                <header class="recognition-header">
                    <div>
                        <span class="recognition-eyebrow">AUDIO MATCH</span>
                        <h2 id="recognition-title">听歌识曲</h2>
                    </div>
                    <button class="recognition-close" type="button" aria-label="关闭听歌识曲" @click="close">×</button>
                </header>

                <div class="recognition-sources" role="group" aria-label="音频来源">
                    <button type="button" :aria-pressed="source === 'system'" :disabled="busy" @click="chooseSource('system')">电脑声音</button>
                    <button type="button" :aria-pressed="source === 'microphone'" :disabled="busy" @click="chooseSource('microphone')">麦克风 / 音频输入</button>
                </div>

                <label v-if="source === 'microphone'" class="recognition-device">输入设备
                    <select v-model="device" :disabled="busy">
                        <option value="">系统默认输入</option>
                        <option v-for="(item, index) in devices" :key="item.deviceId || index" :value="item.deviceId">
                            {{ item.label || `音频输入 ${index + 1}（授权后显示名称）` }}
                        </option>
                    </select>
                </label>

                <div class="recognition-stage" :class="{ 'is-listening': phase === 'recording', 'has-results': results.length }">
                    <div v-if="!results.length" ref="waveRef" class="recognition-wave" aria-hidden="true">
                        <i v-for="index in 40" :key="index"></i>
                    </div>
                    <div class="recognition-status" role="status" aria-live="polite">
                        <h3>{{ heading }}</h3>
                        <p>{{ helper }}</p>
                    </div>
                    <div v-if="phase === 'recording'" class="recognition-time" role="progressbar" aria-label="录音进度" :aria-valuenow="Math.floor(elapsed)" :aria-valuemin="0" :aria-valuemax="RECOGNITION_SECONDS">
                        <span>{{ elapsed.toFixed(1) }} / {{ RECOGNITION_SECONDS }} s</span>
                        <div><i ref="timeFillRef"></i></div>
                    </div>
                    <button v-if="busy" type="button" class="recognition-primary recognition-busy-btn" @click="cancel">
                        取消{{ phase === 'recording' ? '录音' : '识别' }}
                    </button>
                    <button v-else type="button" class="recognition-primary" @click="start">
                        {{ phase === 'idle' ? '开始识别' : '重新识别' }} <span aria-hidden="true">↗</span>
                    </button>
                    <button v-if="phase === 'error' && source === 'system'" type="button" class="recognition-fallback" @click="chooseSource('microphone')">
                        改用麦克风 / 虚拟声卡输入
                    </button>
                </div>

                <div v-if="results.length" class="recognition-results" aria-label="识别结果">
                    <article v-for="song in results" :key="song.hash || song.id || song.name" class="recognition-song">
                        <div class="recognition-cover">
                            <img v-if="song.coverUrl" :src="resolveImageUrl(song.coverUrl)" alt="" loading="lazy" @error="$event.target.hidden = true">
                            <span v-else aria-hidden="true">♪</span>
                        </div>
                        <div class="recognition-song-body">
                            <strong>{{ song.name }}</strong>
                            <p>{{ song.ar.map(item => item.name).join(' / ') }}<template v-if="song.al.name"> · {{ song.al.name }}</template></p>
                            <div class="recognition-actions">
                                <template v-if="song.hash">
                                    <button type="button" @click="playSong(song, true)">播放</button>
                                    <button type="button" :disabled="favoriteBusy" :aria-pressed="isSongLiked(song)" @click="favorite(song)">
                                        {{ isSongLiked(song) ? '取消喜欢' : '收藏' }}
                                    </button>
                                </template>
                                <button type="button" @click="searchSong(song)">搜索</button>
                            </div>
                        </div>
                    </article>
                </div>

                <footer class="recognition-footer" v-if="history.length || showHistory">
                    <div class="recognition-history-header">
                        <button type="button" :aria-expanded="showHistory" @click="showHistory = !showHistory">
                            最近识别 <span>[{{ history.length }}]</span>
                        </button>
                        <button v-if="showHistory && history.length" type="button" @click="clearHistory">清空记录</button>
                    </div>
                    <div v-if="showHistory" class="recognition-history">
                        <p v-if="!history.length">还没有识别记录，找到歌曲后会保存在这里。</p>
                        <button v-for="item in history" :key="item.time" type="button" @click="results = [item.song]; phase = 'success'; errorText = ''; showHistory = false" :disabled="busy">
                            <span>{{ item.song.name }}<small>{{ item.song.ar.map(artist => artist.name).join(' / ') }}</small></span>
                            <time>{{ new Date(item.time).toLocaleDateString() }}</time>
                        </button>
                    </div>
                </footer>
            </section>
        </div>
    </Teleport>
</template>

<style scoped>
/* 遮罩透明且不遮挡顶部导航栏，无模糊滤镜，保持页面完全自然清晰 */
.recognition-shade {
    position: fixed;
    top: 55px;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 998;
    background: transparent;
    -webkit-app-region: no-drag;
    color: var(--text);
    font-family: SourceHanSansCN-Regular, sans-serif;
}

.recognition-panel {
    position: absolute;
    top: 6px;
    left: clamp(20px, 200px, calc(100vw - 440px));
    width: 416px;
    max-width: calc(100vw - 32px);
    max-height: calc(100dvh - 72px);
    overflow: hidden; /* 彻底移除原生侧边滚动条 */
    box-sizing: border-box;
    padding: 20px 22px;
    background: var(--panel);
    border: 1px solid var(--border);
    box-shadow: 0 16px 36px rgba(0, 0, 0, 0.12);
    border-radius: 0;
    outline: none;
    animation: recognition-reveal 180ms cubic-bezier(0.16, 1, 0.3, 1);
    transition: background-color 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease;
}

.recognition-panel * {
    box-sizing: border-box;
}

.panel-corner {
    width: 8px;
    height: 8px;
    position: absolute;
    pointer-events: none;
    box-sizing: border-box;
    border-color: var(--text);
    opacity: 0.85;
    transition: border-color 0.4s ease;
}
.corner-tl {
    top: -1px;
    left: -1px;
    border-top: 2px solid;
    border-left: 2px solid;
}
.corner-tr {
    top: -1px;
    right: -1px;
    border-top: 2px solid;
    border-right: 2px solid;
}
.corner-bl {
    bottom: -1px;
    left: -1px;
    border-bottom: 2px solid;
    border-left: 2px solid;
}
.corner-br {
    bottom: -1px;
    right: -1px;
    border-bottom: 2px solid;
    border-right: 2px solid;
}

.recognition-panel button,
.recognition-panel select,
.recognition-panel summary {
    font: inherit;
    color: var(--text) !important;
    cursor: pointer;
    -webkit-app-region: no-drag;
}

.recognition-panel button {
    border: 0;
    border-radius: 0;
    background: transparent !important;
    padding: 0;
    transition: opacity 140ms ease, background-color 140ms ease, transform 140ms ease, color 140ms ease;
}

.recognition-panel button:focus-visible,
.recognition-panel select:focus-visible,
.recognition-panel summary:focus-visible {
    outline: 2px solid currentColor !important;
    outline-offset: 3px;
    opacity: 1;
}

.recognition-panel button:disabled,
.recognition-panel select:disabled {
    cursor: not-allowed;
    opacity: .45;
}

.recognition-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 1.5px solid var(--border);
    transition: border-bottom-color 0.4s ease;
}

.recognition-eyebrow {
    font: 10px Geometos, sans-serif;
    letter-spacing: .14em;
    color: var(--muted-text);
    display: block;
    transition: color 0.4s ease;
}

.recognition-header h2 {
    margin: 4px 0 0;
    font: 22px SourceHanSansCN-Bold, sans-serif;
    letter-spacing: 0.5px;
}

.recognition-panel .recognition-close {
    width: 26px;
    height: 26px;
    font: 24px sans-serif;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    opacity: 0.6;
    transition: opacity 0.2s ease, transform 0.2s ease;
}
.recognition-panel .recognition-close:hover {
    opacity: 1;
    transform: scale(1.1);
}

.recognition-sources {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 2px;
    margin-top: 14px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 0;
    background: transparent;
}

.recognition-sources button {
    min-height: 36px;
    font-size: 13px;
    font-family: SourceHanSansCN-Bold, sans-serif;
    border-radius: 0;
    color: var(--text) !important;
    transition: opacity 120ms ease;
}

.recognition-sources button:hover {
    opacity: 0.8;
}

.recognition-sources button[aria-pressed="true"] {
    background: var(--text) !important;
    color: var(--bg) !important;
    opacity: 1;
}

.recognition-device {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    margin-top: 10px;
    font-size: 12px;
    color: var(--muted-text);
}

.recognition-device select {
    width: 100%;
    min-height: 30px;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    background: var(--bg);
    color: var(--text);
}

.recognition-stage {
    padding: 14px 0 6px;
}

.recognition-wave {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    overflow: hidden;
    padding: 2px 0;
}

.recognition-wave i {
    height: 100%;
    width: 3px;
    flex-shrink: 0;
    transform: scaleY(0.04);
    transform-origin: center;
    border-radius: 1px;
    background: var(--muted-text);
    opacity: 0.35;
    will-change: transform;
    transition: opacity 0.2s ease;
}

.is-listening .recognition-wave i {
    background: var(--text);
    opacity: 0.95;
}

.recognition-status {
    text-align: center;
    min-height: 68px;
    padding-top: 8px;
}

.recognition-status h3 {
    font: 16px SourceHanSansCN-Bold, sans-serif;
    margin: 0 0 6px;
    letter-spacing: 0.3px;
}

.recognition-status p {
    font-size: 12px;
    color: var(--muted-text);
    line-height: 1.6;
    margin: 0 auto 10px;
    max-width: 320px;
    overflow-wrap: anywhere;
}

.recognition-panel .recognition-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 32px;
    min-height: 44px;
    width: 100%;
    border: 1px solid var(--text);
    border-radius: 0;
    background: var(--text) !important;
    color: var(--bg) !important;
    font: 14px SourceHanSansCN-Bold, sans-serif;
    letter-spacing: 1px;
    box-sizing: border-box;
    transition: transform 0.12s ease, opacity 0.12s ease;
}

.recognition-primary span {
    color: inherit !important;
    font-size: 15px;
}

.recognition-primary:hover {
    opacity: 0.88;
    transform: translateY(-1px);
}
.recognition-primary:active {
    transform: translateY(1px);
}

.recognition-busy-btn {
    border: 1px solid var(--text) !important;
    background: transparent !important;
    color: var(--text) !important;
    box-shadow: none !important;
}

.recognition-stage.has-results .recognition-status {
    min-height: auto;
    padding-top: 0;
    text-align: left;
}

.recognition-stage.has-results .recognition-status p {
    max-width: none;
    margin-left: 0;
}

.recognition-panel .recognition-fallback {
    display: block;
    margin: 10px auto 0;
    text-decoration: underline;
    text-underline-offset: 3px;
    font-size: 12px;
}

.recognition-time {
    font: 12px Bender-Bold, monospace;
    text-align: right;
    margin: 0 0 10px;
}

.recognition-time > div {
    height: 2px;
    margin-top: 6px;
    background: var(--border);
    overflow: hidden;
    border-radius: 1px;
}

.recognition-time i {
    display: block;
    height: 100%;
    background: var(--text);
    transform: scaleX(0);
    transform-origin: left;
    will-change: transform;
}

.recognition-results {
    border-top: 1px solid var(--border);
    margin-top: 4px;
    max-height: 220px;
    overflow-y: auto;
    scrollbar-width: none;
}
.recognition-results::-webkit-scrollbar {
    display: none;
    width: 0;
}

.recognition-song {
    display: flex;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
}

.recognition-cover {
    display: grid;
    place-items: center;
    width: 50px;
    height: 50px;
    flex-shrink: 0;
    background: var(--layer);
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 20px;
    overflow: hidden;
}

.recognition-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.recognition-song-body {
    min-width: 0;
    flex: 1;
}

.recognition-song strong {
    font-size: 13px;
    overflow-wrap: anywhere;
    line-height: 1.4;
}

.recognition-song p {
    margin: 3px 0 8px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted-text);
    overflow-wrap: anywhere;
}

.recognition-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.recognition-actions button {
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 11px;
    min-height: 26px;
    transition: all 0.16s ease;
}

.recognition-actions button:hover {
    border-color: var(--text);
}

.recognition-footer {
    border-top: 1px solid var(--border);
    padding-top: 8px;
    margin-top: 6px;
}

.recognition-history-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 10px;
    font-size: 12px;
}

.recognition-history-header span {
    color: var(--muted-text);
    margin-left: 3px;
}

.recognition-history {
    margin-top: 8px;
    max-height: 150px;
    overflow-y: auto;
    scrollbar-width: none;
}
.recognition-history::-webkit-scrollbar {
    display: none;
    width: 0;
}

.recognition-history > button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 8px 0;
    text-align: left;
    gap: 14px;
    border-bottom: 1px solid var(--border);
    font-size: 12px;
}

.recognition-history > button:hover {
    color: var(--text) !important;
}

.recognition-history > button span {
    min-width: 0;
    overflow-wrap: anywhere;
}

.recognition-history small {
    display: block;
    color: var(--muted-text);
    margin-top: 2px;
}

.recognition-history time {
    color: var(--muted-text);
    flex-shrink: 0;
    font: 11px monospace;
}

/* Dark mode overrides */
:global(.dark) .recognition-panel {
    background: var(--panel);
    border-color: var(--border);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
}

@keyframes recognition-reveal {
    from {
        opacity: 0;
        transform: translateY(-8px) scale(0.98);
    }
    to {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

@media (max-width: 760px) {
    .recognition-panel {
        left: 50%;
        top: 10px;
        transform: translateX(-50%);
        max-height: calc(100dvh - 75px);
        padding: 18px;
        animation: none;
    }
}

@media (prefers-reduced-motion: reduce) {
    .recognition-panel { animation: none; }
    .recognition-wave i { transition: none !important; }
}
</style>
