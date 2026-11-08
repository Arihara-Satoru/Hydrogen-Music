// Unified local leveling and dynamic control share ONE gain envelope (no second compressor).
// A streaming estimate, not an offline EBU R128 scan. No PCM buffers or per-render allocations.
class AdaptiveLoudnessProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super()
        const initialGain = options.processorOptions?.initialGain ?? 0.25
        this.gain = Math.max(0.01, Math.min(1, initialGain))
        this.targetGain = this.gain
        this.calibrating = true
        this.hasEstimate = false
        this.running = true
        this.disposed = false
        this.framesPerStep = Math.max(1, Math.round(sampleRate * 0.1))
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
        // BS.1770 K-weighting coefficients, calculated for the actual device sample rate.
        const k = Math.tan(Math.PI * 1681.974450955533 / sampleRate)
        const q = 0.7071752369554196
        const vh = 10 ** (3.999843853973347 / 20)
        const vb = vh ** 0.4996667741545416
        const a0 = 1 + k / q + k * k
        this.shelf = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0,
            (vh - vb * k / q + k * k) / a0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
        const r = Math.tan(Math.PI * 38.13547087602444 / sampleRate)
        const rq = 0.5003270373238773
        const ra0 = 1 + r / rq + r * r
        this.highpass = [2 * (r * r - 1) / ra0, (1 - r / rq + r * r) / ra0]
        this.port.onmessage = ({ data }) => {
            if (data.type === 'dispose') this.disposed = true
            if (data.type === 'running') {
                if (this.running === data.value) return
                this.running = data.value
                this.resetWindow()
                this.targetGain = this.gain
            }
            if (data.type === 'reset') {
                this.resetWindow()
                // A seek invalidates the measurement, not the already audible volume.
                // The downward safety path remains active while the new segment is acquired.
                this.histogramCount.fill(0)
                this.histogramEnergy.fill(0)
                this.activeSteps = 0
                this.peak = 0
                this.calibrating = true
                this.hasEstimate = false
                this.targetGain = this.gain
            }
        }
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
        const blockLoudness = -0.691 + 10 * Math.log10(Math.max(1e-12, blockEnergy))
        this.hasEstimate = false
        this.signalSteps = blockLoudness >= -35 ? this.signalSteps + 1 : 0
        this.targetGain = Math.min(this.targetGain, 10 ** ((-14 - blockLoudness) / 20))
        if (++this.steps < 4) return
        const energy = (this.recentEnergy[0] + this.recentEnergy[1] + this.recentEnergy[2] + this.recentEnergy[3]) / 4
        const momentary = -0.691 + 10 * Math.log10(Math.max(1e-12, energy))
        // Silence/noise gates: never chase a fade-out or amplify an almost silent intro.
        if (momentary < -50) {
            this.signalSteps = 0
            this.targetGain = Math.min(this.targetGain, this.gain)
            return
        }
        this.activeSteps++
        const bin = Math.max(0, Math.min(140, Math.floor((momentary + 70) * 2)))
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
                const weighted = shelf[0] * sample + state[offset]
                state[offset] = shelf[1] * sample - shelf[3] * weighted + state[offset + 1]
                state[offset + 1] = shelf[2] * sample - shelf[4] * weighted
                const filtered = weighted + state[offset + 2]
                state[offset + 2] = -2 * weighted - hp[0] * filtered + state[offset + 3]
                state[offset + 3] = weighted - hp[1] * filtered
                this.energy += filtered * filtered
            }
            this.peak = Math.max(this.peak, peak)
            if (++this.frames >= this.framesPerStep) this.updateEstimate()
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

registerProcessor('hydrogen-adaptive-loudness', AdaptiveLoudnessProcessor)
