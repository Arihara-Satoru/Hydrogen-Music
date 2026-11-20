import workletUrl from './adaptiveLoudness.worklet.js?url'
export { measureDecodedLoudness } from './adaptiveLoudness.worklet.js'

export const PROTECTED_LOUDNESS_GAIN = 0.25 // about -12 dB until the source can be measured
const moduleLoads = new WeakMap()
const estimates = new Map()
const startupEstimates = new Map()
const MAX_ESTIMATES = 128
export const LOUDNESS_PROBE_TIMEOUT_MS = 900

function startupKey(url, offset, rate) {
    return url ? JSON.stringify([url, Math.round(offset * 1000), rate]) : ''
}

export function getStartupLoudness(url, offset, rate) {
    const key = startupKey(url, offset, rate)
    const seed = startupEstimates.get(key)
    if (seed) rememberStartupLoudness(url, offset, rate, seed)
    return seed ?? null
}

export function rememberStartupLoudness(url, offset, rate, seed) {
    const key = startupKey(url, offset, rate)
    if (!key || !seed) return
    startupEstimates.delete(key)
    startupEstimates.set(key, seed)
    if (startupEstimates.size > MAX_ESTIMATES) startupEstimates.delete(startupEstimates.keys().next().value)
}

async function loadWorklet(context) {
    if (!context.audioWorklet || !window.AudioWorkletNode) return false
    if (!moduleLoads.has(context)) {
        moduleLoads.set(context, context.audioWorklet.addModule(workletUrl).then(() => true).catch(error => {
            console.warn('实时响度分析不可用，使用保守音量保护', error)
            return false
        }))
    }
    return moduleLoads.get(context)
}

export async function createAdaptiveLoudness(context, key, running = true) {
    // Keep exact URLs separate (including quality/signatures); do not persist URLs or PCM data.
    const cacheKey = typeof key === 'string' ? key : ''
    // A cached quiet passage must not make a later loud intro (or resumed position) start hot.
    const initialGain = Math.min(PROTECTED_LOUDNESS_GAIN, estimates.get(cacheKey) ?? PROTECTED_LOUDNESS_GAIN)
    let node
    let realtime = false
    if (await loadWorklet(context)) {
        try {
            node = new window.AudioWorkletNode(context, 'hydrogen-adaptive-loudness', {
                numberOfInputs: 1, numberOfOutputs: 1,
                processorOptions: { initialGain, running },
            })
            realtime = true
        } catch (error) {
            console.warn('无法创建实时响度节点，使用保守音量保护', error)
        }
    }
    if (!node) {
        node = context.createGain()
        node.gain.value = PROTECTED_LOUDNESS_GAIN
    }
    let disposed = false
    let probe = null
    let probeId = 0
    const finishProbe = seed => {
        if (!probe) return
        clearTimeout(probe.timer)
        const { resolve } = probe
        probe = null
        resolve(seed)
    }
    if (realtime) {
        node.port.onmessage = ({ data }) => {
            if (disposed) return
            if (probe && probe.id === data?.probeId) {
                finishProbe(data.seed)
                return
            }
            if (!cacheKey || !Number.isFinite(data?.gain) || data.gain < 0.01 || data.gain > 3) return
            estimates.delete(cacheKey)
            estimates.set(cacheKey, data.gain)
            if (estimates.size > MAX_ESTIMATES) estimates.delete(estimates.keys().next().value)
        }
    }
    return {
        node,
        realtime,
        probe() {
            if (!realtime || disposed) return Promise.resolve(null)
            finishProbe(null)
            const id = ++probeId
            return new Promise(resolve => {
                probe = { id, resolve, timer: setTimeout(() => finishProbe(null), LOUDNESS_PROBE_TIMEOUT_MS) }
                node.port.postMessage({ type: 'probe', id })
            })
        },
        startup(seed) {
            finishProbe(null)
            if (realtime && !disposed) node.port.postMessage({ type: 'startup', seed })
        },
        setRunning(value) { if (realtime && !disposed) node.port.postMessage({ type: 'running', value }) },
        reset() { if (realtime && !disposed) node.port.postMessage({ type: 'reset' }) },
        dispose() {
            if (disposed) return
            disposed = true
            finishProbe(null)
            if (realtime) {
                node.port.postMessage({ type: 'dispose' })
                node.port.onmessage = null
                node.port.close()
            }
            node.disconnect()
        },
    }
}
