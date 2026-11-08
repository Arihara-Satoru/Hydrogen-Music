import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRecognitionResampler } from '../src/utils/audioRecognitionDSP.mjs'
import { createProgressiveRecognition } from '../src/utils/progressiveRecognition.mjs'

const wave = (seconds, rate = 8000, frequency = 440) => Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => 0.3 * Math.sin(2 * Math.PI * frequency * i / rate))
const rms = data => Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length)
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const empty = { status: 1, data: [] }
const success = { status: 1, data: [{ songname: '测试', hash_128: 'abcdef0123456789abcdef0123456789' }] }

// 真实采集适配器生命周期（模拟 Web Audio，而非只检查源码）。
let audioContexts = [], setupMode = 'ok', createdNode
class Track extends EventTarget { readyState = 'live'; stop() { this.readyState = 'ended' } }
const stream = () => { const audio = new Track(), video = new Track(); return { audio, video, getTracks: () => [audio, video], getAudioTracks: () => [audio] } }
const graphNode = () => ({ connect() { return this }, disconnect() { this.disconnected = true }, gain: {} })
class Context {
    constructor() { audioContexts.push(this) }
    audioWorklet = { addModule: () => setupMode === 'hang' ? new Promise(() => {}) : setupMode === 'fail' ? Promise.reject(new Error('no worklet')) : Promise.resolve() }
    destination = {}
    resume = async () => {}
    close() { this.closed = true; return Promise.resolve() }
    createMediaStreamSource = graphNode
    createGain = graphNode
    createAnalyser() { return { ...graphNode(), getByteFrequencyData() {} } }
}
const captureVM = vm.createContext({ AudioContext: Context,
    AudioWorkletNode: class { constructor() { createdNode = this } port = { postMessage() {}, close() { this.closed = true } }; connect() { return graphNode() }; disconnect() { this.disconnected = true } },
    URL, Blob, DOMException, Error, Uint8Array, setInterval, clearInterval, setTimeout, clearTimeout,
    workletSource: '', createRecognitionResampler, RECOGNITION_RATE: 8000, RECOGNITION_SECONDS: 10,
})
const captureCode = readFileSync(new URL('../src/utils/audioRecognitionCapture.mjs', import.meta.url), 'utf8')
    .replace(/^import .*\n/gm, '').replace(/export /g, '')
vm.runInContext(`${captureCode}\nglobalThis.makeCapture = createRecognitionCapture;`, captureVM)
{
    const input = stream(), abort = new AbortController()
    let endCount = 0, sampleCount = 0
    const capture = await captureVM.makeCapture(input, { signal: abort.signal, onSamples: s => { sampleCount += s.length }, onEnd: () => endCount++, onError: e => { throw e } })
    capture.start()
    createdNode.port.onmessage({ data: { samples: wave(0.1), done: true } })
    assert.equal(sampleCount, 800)
    assert.equal(endCount, 1)
    assert.equal(input.audio.readyState, 'ended')
    assert.equal(input.video.readyState, 'ended')
    assert.ok(createdNode.port.closed && createdNode.disconnected && audioContexts.at(-1).closed)
    capture.stop()
}
for (const mode of ['abort', 'ended', 'processor']) {
    const input = stream(), abort = new AbortController()
    let error
    const capture = await captureVM.makeCapture(input, { signal: abort.signal, onSamples() {}, onEnd() {}, onError: e => { error = e } })
    capture.start()
    if (mode === 'abort') abort.abort()
    if (mode === 'ended') input.audio.dispatchEvent(new Event('ended'))
    if (mode === 'processor') createdNode.onprocessorerror()
    assert.equal(input.video.readyState, 'ended')
    assert.ok(audioContexts.at(-1).closed)
    if (mode !== 'abort') assert.ok(error)
}
{
    setupMode = 'fail'
    const input = stream()
    await assert.rejects(captureVM.makeCapture(input, {}), /完整片段/)
    assert.equal(input.audio.readyState, 'live', '仅初始化不支持时保留原音频流用于降级')
    assert.ok(audioContexts.at(-1).closed)
    input.getTracks().forEach(t => t.stop())
    setupMode = 'hang'
    const abort = new AbortController(), input2 = stream()
    const pending = captureVM.makeCapture(input2, { signal: abort.signal })
    abort.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.ok(audioContexts.at(-1).closed, '初始化挂起时取消也必须释放 AudioContext')
    input2.getTracks().forEach(t => t.stop())
    setupMode = 'ok'
}

for (const rate of [8000, 44100, 48000, 96000]) {
    const input = wave(1, rate)
    const whole = createRecognitionResampler(rate).push([input])
    const chunked = createRecognitionResampler(rate)
    const blocks = []
    for (let i = 0; i < input.length; i += 127) blocks.push(...chunked.push([input.subarray(i, i + 127)]))
    assert.equal(whole.length, 8000, `${rate}Hz 时长正确`)
    assert.deepEqual(whole, Float32Array.from(blocks), '分块不得改变采样结果')
    assert.ok(Math.abs(rms(whole.subarray(100)) - 0.3 / Math.sqrt(2)) < 0.01)
    const cancelled = createRecognitionResampler(rate).push([input, input.map(x => -x)])
    assert.equal(rms(cancelled), 0, '声道取平均')
}
for (const rate of [44100, 48000]) {
    const filtered = createRecognitionResampler(rate).push([wave(1, rate, 9000)])
    assert.ok(rms(filtered.subarray(100)) < 0.002, '抗混叠滤波必须抑制 Nyquist 以上信号')
}

// 实际执行 Worklet 类，验证最后一批样本、封顶、可中断且输出不回放。
let Processor
const messages = []
const context = vm.createContext({ sampleRate: 48000, Float32Array, makeResampler: createRecognitionResampler,
    AudioWorkletProcessor: class { port = { postMessage: message => messages.push(message) } },
    registerProcessor: (name, cls) => { Processor = cls },
})
vm.runInContext(readFileSync(new URL('../src/utils/audioRecognition.worklet.js', import.meta.url), 'utf8'), context)
const processor = new Processor({ processorOptions: { maxSamples: 80000 } })
let running = true
for (let i = 0; i < 4000 && running; i++) running = processor.process([[wave(128 / 48000, 48000)]])
assert.equal(running, false)
assert.equal(messages.reduce((n, m) => n + m.samples.length, 0), 80000)
assert.equal(messages.at(-1).done, true)
const interrupted = new Processor({ processorOptions: { maxSamples: 80000 } })
interrupted.port.onmessage({ data: 'stop' })
assert.equal(interrupted.process([]), false)

// 首次命中：立即停止，不再提交。
{
    const calls = [], wait = deferred()
    let stops = 0
    const session = createProgressiveRecognition({ match: (pcm, signal) => { calls.push({ pcm, signal }); return wait.promise }, stopCapture: () => stops++ })
    session.push(wave(3))
    assert.equal(calls[0].pcm.byteLength, 48000)
    wait.resolve(success)
    assert.equal((await session.result).length, 1)
    session.push(wave(7))
    assert.equal(calls.length, 1)
    assert.equal(stops, 1)
}
// 正常三阶段，无并发、无重复末段。
{
    const lengths = []
    const session = createProgressiveRecognition({ match: async pcm => { lengths.push(pcm.byteLength); return empty } })
    session.push(wave(3)); await tick()
    session.push(wave(3)); await tick()
    session.push(wave(4))
    assert.deepEqual(await session.result, [])
    assert.deepEqual(lengths, [48000, 96000, 160000])
}
// 第二阶段命中，以及采集上限后等待中的响应。
for (const finishAt of [6, 10]) {
    const lengths = [], wait = deferred(), states = []
    const session = createProgressiveRecognition({
        match: pcm => { lengths.push(pcm.byteLength); return lengths.length === 1 && finishAt === 6 ? Promise.resolve(empty) : wait.promise },
        onState: state => states.push(state),
    })
    session.push(wave(3)); await tick()
    session.push(wave(finishAt - 3))
    if (finishAt === 10) {
        assert.deepEqual(states.at(-1), { capturing: false, matching: true, requests: 1 })
        assert.equal(lengths.length, 1, '达到录音上限不能与在途请求重叠')
    }
    wait.resolve(success)
    assert.equal((await session.result).length, 1)
    assert.equal(lengths.length, finishAt === 6 ? 2 : 1)
}
// 慢请求跳过 6 秒旧阶段，结束后仍能提交最终片段。
{
    const calls = [], pending = []
    const session = createProgressiveRecognition({ match: pcm => { calls.push(pcm.byteLength); const wait = deferred(); pending.push(wait); return wait.promise } })
    session.push(wave(3))
    session.push(wave(5))
    assert.equal(calls.length, 1)
    pending[0].resolve(empty); await tick()
    assert.deepEqual(calls, [48000, 128000])
    session.push(wave(2))
    pending[1].resolve(empty); await tick()
    assert.deepEqual(calls, [48000, 128000, 160000])
    pending[2].resolve(success)
    assert.equal((await session.result).length, 1)
}
// 迟响应不得覆盖取消结果，也不再启动后续请求。
{
    const abort = new AbortController(), wait = deferred()
    let requestSignal, calls = 0, stops = 0
    const session = createProgressiveRecognition({ signal: abort.signal, match: (pcm, signal) => { calls++; requestSignal = signal; return wait.promise }, stopCapture: () => stops++ })
    session.push(wave(3))
    const rejected = assert.rejects(session.result, { name: 'AbortError' })
    abort.abort()
    await rejected
    assert.equal(requestSignal.aborted, true)
    wait.resolve(success); await tick()
    session.push(wave(7))
    assert.equal(calls, 1)
    assert.equal(stops, 1)
}
// 静音不上传，设备故障/服务异常不当成无匹配。
{
    let calls = 0
    const session = createProgressiveRecognition({ match: () => { calls++ } })
    session.push(new Float32Array(80000))
    await assert.rejects(session.result, /有效声音/)
    assert.equal(calls, 0)
}
for (const error of [new Error('网络失败'), Object.assign(new Error('限流'), { status: 429 })]) {
    let calls = 0
    const session = createProgressiveRecognition({ match: async () => { calls++; throw error } })
    session.push(wave(3))
    await assert.rejects(session.result, e => e === error)
    session.push(wave(7))
    assert.equal(calls, 1)
}
{
    const session = createProgressiveRecognition({ match: async () => ({ status: 0, msg: '服务故障' }) })
    session.push(wave(3))
    await assert.rejects(session.result, /服务故障/)
}
{
    const session = createProgressiveRecognition({ match: async () => ({ status: 1, error_code: 429, error_msg: '请求过于频繁', data: [] }) })
    session.push(wave(3))
    await assert.rejects(session.result, /请求过于频繁/)
}
{
    const session = createProgressiveRecognition({ match: () => new Promise(() => {}), timeoutMs: 10 })
    session.push(wave(3))
    await assert.rejects(session.result, /超时/)
}
{
    const session = createProgressiveRecognition({ match: () => new Promise(() => {}) })
    session.fail(new Error('设备断开'))
    await assert.rejects(session.result, /设备断开/)
}
{
    const lengths = []
    const session = createProgressiveRecognition({ match: async pcm => { lengths.push(pcm.byteLength); return empty } })
    session.push(wave(2.5)); session.end()
    await session.result
    assert.deepEqual(lengths, [40000], '墙钟保护结束时仍发送已收集的有效末段')
}
console.log('渐进识曲检查通过：降采样/混音/抗混叠、Worklet 封顶、串行调度、提前停止、慢请求、静音、超时及取消。')
