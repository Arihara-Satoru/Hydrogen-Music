import workletUrl from './adaptiveLoudness.worklet.js?url'

export const PROTECTED_LOUDNESS_GAIN = 0.25 // about -12 dB until the source can be measured
const moduleLoads = new WeakMap()
const estimates = new Map()
const MAX_ESTIMATES = 128

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

export async function createAdaptiveLoudness(context, key) {
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
                processorOptions: { initialGain },
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
    if (realtime) {
        node.port.onmessage = ({ data }) => {
            if (disposed || !cacheKey || !Number.isFinite(data?.gain) || data.gain < 0.01 || data.gain > 3) return
            estimates.delete(cacheKey)
            estimates.set(cacheKey, data.gain)
            if (estimates.size > MAX_ESTIMATES) estimates.delete(estimates.keys().next().value)
        }
    }
    return {
        node,
        realtime,
        setRunning(value) { if (realtime && !disposed) node.port.postMessage({ type: 'running', value }) },
        reset() { if (realtime && !disposed) node.port.postMessage({ type: 'reset' }) },
        dispose() {
            if (disposed) return
            disposed = true
            if (realtime) {
                node.port.postMessage({ type: 'dispose' })
                node.port.onmessage = null
                node.port.close()
            }
            node.disconnect()
        },
    }
}
