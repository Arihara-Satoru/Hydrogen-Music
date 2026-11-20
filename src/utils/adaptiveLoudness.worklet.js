// This file is also imported on the main thread to analyze already decoded PCM.
function createWeighting(rate) {
    const k = Math.tan(Math.PI * 1681.974450955533 / rate)
    const q = 0.7071752369554196
    const vh = 10 ** (3.999843853973347 / 20)
    const vb = vh ** 0.4996667741545416
    const a0 = 1 + k / q + k * k
    const r = Math.tan(Math.PI * 38.13547087602444 / rate)
    const rq = 0.5003270373238773
    const ra0 = 1 + r / rq + r * r
    return {
        shelf: [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0,
            (vh - vb * k / q + k * k) / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0],
        highpass: [2 * (r * r - 1) / ra0, (1 - r / rq + r * r) / ra0],
    }
}

function weightedSample(sample, state, offset, shelf, hp) {
    const weighted = shelf[0] * sample + state[offset]
    state[offset] = shelf[1] * sample - shelf[3] * weighted + state[offset + 1]
    state[offset + 1] = shelf[2] * sample - shelf[4] * weighted
    const filtered = weighted + state[offset + 2]
    state[offset + 2] = -2 * weighted - hp[0] * filtered + state[offset + 3]
    state[offset + 3] = weighted - hp[1] * filtered
    return filtered
}

const toLoudness = energy => -0.691 + 10 * Math.log10(Math.max(1e-12, energy))
const toBin = loudness => Math.max(0, Math.min(140, Math.floor((loudness + 70) * 2)))
const gainFor = (loudness, peak) => Math.max(0.01, Math.min(3, 10 ** ((-14 - loudness) / 20), 0.95 / Math.max(0.001, peak)))
const framesPerStep = rate => Math.max(1, Math.round(rate * 0.1))

class StartupMeter {
    constructor() {
        this.loudest = -Infinity
        this.energy = 0
        this.consecutive = 0
    }

    add(energy, peak) {
        if (this.consecutive === 6) return null // A probe publishes at most one estimate.
        const loudness = toLoudness(energy)
        this.loudest = Math.max(this.loudest, loudness)
        if (loudness < -35) {
            this.consecutive = this.energy = 0
            return null
        }
        this.energy += energy
        return ++this.consecutive === 6
            ? { gain: gainFor(this.loudest, peak), energy: this.energy / 6, peak }
            : null
    }
}

export function measureDecodedLoudness(buffer, offset) {
    if (!buffer?.numberOfChannels) return null
    const rate = buffer.sampleRate
    const step = framesPerStep(rate)
    const start = Math.floor(offset * rate)
    const end = Math.min(buffer.length, start + 8 * step)
    if (end - start < 6 * step) return null
    const channels = Array.from({ length: Math.min(8, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i))
    const state = new Float64Array(channels.length * 4)
    const { shelf, highpass } = createWeighting(rate)
    const meter = new StartupMeter()
    let peak = 0
    for (let block = start; block + step <= end; block += step) {
        let energy = 0
        for (let frame = block; frame < block + step; frame++) {
            for (let channel = 0; channel < channels.length; channel++) {
                const sample = channels[channel][frame]
                peak = Math.max(peak, Math.abs(sample))
                const filtered = weightedSample(sample, state, channel * 4, shelf, highpass)
                energy += filtered * filtered
            }
        }
        const seed = meter.add(energy / step, peak)
        if (seed) return seed
    }
    return null
}

// Unified local leveling and dynamic control share ONE gain envelope (no second compressor).
// A streaming estimate, not an offline EBU R128 scan. No PCM buffers or per-render allocations.
class AdaptiveLoudnessProcessor extends (globalThis.AudioWorkletProcessor ?? class {}) {
    constructor(options) {
        super()
        const initialGain = options.processorOptions?.initialGain ?? 0.25
        this.protectedGain = Math.max(0.01, Math.min(1, initialGain))
        this.gain = this.protectedGain
        this.targetGain = this.gain
        this.calibrating = true
        this.hasEstimate = false
        this.running = options.processorOptions?.running ?? true
        this.disposed = false
        this.framesPerStep = framesPerStep(sampleRate)
        this.frames = 0
        this.energy = 0
        this.steps = 0
        this.activeSteps = 0
        this.signalSteps = 0
        this.peak = 0
        this.channelCount = 0
        this.recentEnergy = new Float64Array(4)
        this.histogramCount = new Uint32Array(141)
        this.histogramEnergy = new Float64Array(141)
        this.filterState = new Float64Array(8 * 4)
        this.down = Math.exp(-1 / (sampleRate * 0.025))
        // Acquire once, quickly; the slow release is only for later programme changes.
        this.startupUp = Math.exp(-1 / (sampleRate * 0.08))
        this.up = Math.exp(-1 / (sampleRate * 4))
        const { shelf, highpass } = createWeighting(sampleRate)
        this.shelf = shelf
        this.highpass = highpass
        this.probeId = null
        this.probeMeter = null
        this.port.onmessage = ({ data }) => {
            if (data.type === 'dispose') this.disposed = true
            if (data.type === 'probe') {
                this.applySeed(null)
                this.probeId = data.id
                this.probeMeter = new StartupMeter()
                this.running = true
            }
            if (data.type === 'startup') {
                this.probeId = null
                this.probeMeter = null
                this.applySeed(data.seed)
                this.running = false
            }
            if (data.type === 'running') {
                if (this.running === data.value) return
                this.running = data.value
                this.resetWindow()
                this.targetGain = this.gain
            }
            if (data.type === 'reset') {
                // A seek invalidates the measurement, not the already audible volume.
                // The downward safety path remains active while the new segment is acquired.
                this.resetStats()
                this.calibrating = true
                this.targetGain = this.gain
            }
        }
    }

    resetStats() {
        this.resetWindow()
        this.histogramCount.fill(0)
        this.histogramEnergy.fill(0)
        this.activeSteps = 0
        this.peak = 0
    }

    applySeed(seed) {
        this.resetStats()
        this.gain = this.targetGain = seed?.gain ?? this.protectedGain
        this.calibrating = !seed
        if (!seed) return
        this.peak = seed.peak
        const bin = toBin(toLoudness(seed.energy))
        this.histogramCount[bin] = 1
        this.histogramEnergy[bin] = seed.energy
    }

    resetWindow() {
        this.hasEstimate = false
        this.frames = 0
        this.energy = 0
        this.steps = 0
        this.signalSteps = 0
        this.recentEnergy.fill(0)
        this.filterState.fill(0)
    }

    updateEstimate() {
        const blockEnergy = this.energy / this.framesPerStep
        this.recentEnergy[this.steps % 4] = blockEnergy
        this.frames = 0
        this.energy = 0
        // Fast downward-only check also protects a loud chorus after a quiet introduction.
        const blockLoudness = toLoudness(blockEnergy)
        this.hasEstimate = false
        this.signalSteps = blockLoudness >= -35 ? this.signalSteps + 1 : 0
        this.targetGain = Math.min(this.targetGain, 10 ** ((-14 - blockLoudness) / 20))
        if (++this.steps < 4) return
        const energy = (this.recentEnergy[0] + this.recentEnergy[1] + this.recentEnergy[2] + this.recentEnergy[3]) / 4
        const momentary = toLoudness(energy)
        // Silence/noise gates: never chase a fade-out or amplify an almost silent intro.
        if (momentary < -50) {
            this.signalSteps = 0
            this.targetGain = Math.min(this.targetGain, this.gain)
            return
        }
        this.activeSteps++
        const bin = toBin(momentary)
        this.histogramCount[bin]++
        this.histogramEnergy[bin] += energy
        let sum = 0
        let count = 0
        for (let i = 0; i < 141; i++) {
            sum += this.histogramEnergy[i]
            count += this.histogramCount[i]
        }
        const relativeGate = -0.691 + 10 * Math.log10(sum / count) - 10
        sum = 0
        count = 0
        for (let i = Math.max(0, Math.floor((relativeGate + 70) * 2)); i < 141; i++) {
            sum += this.histogramEnergy[i]
            count += this.histogramCount[i]
        }
        if (!count) return
        const integrated = -0.691 + 10 * Math.log10(sum / count)
        // A loud new section can reduce gain immediately; quiet passages cannot demand a boost.
        let target = Math.min(3, 10 ** ((-14 - Math.max(integrated, momentary, blockLoudness)) / 20), 0.95 / Math.max(0.001, this.peak))
        // Require six valid 100 ms blocks (~600 ms from signal onset), not
        // 2 s of waiting followed by a 12 s boost cap. The current block must also
        // contain signal so a trailing window cannot keep boosting a fading intro.
        if (momentary < -35 || this.signalSteps < 6) {
            target = Math.min(this.gain, this.targetGain, target)
        } else {
            this.hasEstimate = true
        }
        // Ignore sub-0.25 dB upward corrections once acquired: do not audibly crawl
        // towards a negligible statistical change for the rest of a steady track.
        if (!this.calibrating && target > this.gain && target < this.gain * 1.0292) target = this.gain
        this.targetGain = Math.max(0.01, target)
        // Only a tiny scalar message once per second, and only after useful signal was measured.
        if (this.activeSteps >= 80 && this.activeSteps % 10 === 0) {
            this.port.postMessage({ gain: this.targetGain })
        }
    }

    updateProbe() {
        const seed = this.probeMeter.add(this.energy / this.framesPerStep, this.peak)
        this.frames = this.energy = 0
        if (seed) this.port.postMessage({ probeId: this.probeId, seed })
    }

    process(inputs, outputs) {
        if (this.disposed) return false
        if (!this.running) return true
        const input = inputs[0]
        const output = outputs[0]
        if (!input?.length || !output?.length) return true
        const channels = Math.min(input.length, output.length, 8)
        if (channels !== this.channelCount) {
            this.resetWindow()
            this.channelCount = channels
        }
        const shelf = this.shelf
        const hp = this.highpass
        const state = this.filterState
        for (let frame = 0; frame < output[0].length; frame++) {
            let peak = 0
            for (let channel = 0; channel < channels; channel++) {
                const sample = input[channel][frame] || 0
                peak = Math.max(peak, Math.abs(sample))
                const offset = channel * 4
                const filtered = weightedSample(sample, state, offset, shelf, hp)
                this.energy += filtered * filtered
            }
            this.peak = Math.max(this.peak, peak)
            if (++this.frames >= this.framesPerStep) {
                if (this.probeId !== null) this.updateProbe()
                else this.updateEstimate()
            }
            if (this.probeId !== null) continue // The worklet outputs silence while inspecting the start.
            const smoothing = this.targetGain < this.gain ? this.down : (this.calibrating ? this.startupUp : this.up)
            this.gain = this.targetGain + smoothing * (this.gain - this.targetGain)
            if (this.calibrating && this.hasEstimate && Math.abs(this.gain - this.targetGain) <= this.targetGain * 0.01) {
                this.gain = this.targetGain
                this.calibrating = false
            }
            // Linked-channel sample-peak safety, not an oversampled true-peak limiter.
            const gain = Math.min(this.gain, 0.95 / Math.max(0.001, peak))
            for (let channel = 0; channel < channels; channel++) output[channel][frame] = (input[channel][frame] || 0) * gain
        }
        return true
    }
}

if (typeof registerProcessor === 'function') registerProcessor('hydrogen-adaptive-loudness', AdaptiveLoudnessProcessor)
