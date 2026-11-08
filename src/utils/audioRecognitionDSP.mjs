// 自包含函数：同时用于主线程单测和 AudioWorklet（以源码注入，避免 file:// 模块依赖）。
export function createRecognitionResampler(inputRate, outputRate = 8000) {
    if (!Number.isFinite(inputRate) || inputRate < outputRate || outputRate <= 0) throw new Error('不支持的音频采样率')
    const taps = 95, half = (taps - 1) / 2, phases = 256
    const ring = new Float32Array(128)
    const kernels = []
    const cutoff = 0.44 * outputRate / inputRate
    for (let p = 0; p <= phases; p++) {
        const kernel = new Float64Array(taps)
        let sum = 0
        for (let j = 0; j < taps; j++) {
            const x = j - half - p / phases
            const sinc = Math.abs(x) < 1e-9 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
            const window = 0.42 - 0.5 * Math.cos(2 * Math.PI * j / (taps - 1)) + 0.08 * Math.cos(4 * Math.PI * j / (taps - 1))
            kernel[j] = sinc * window
            sum += kernel[j]
        }
        for (let j = 0; j < taps; j++) kernel[j] /= sum
        kernels.push(kernel)
    }
    let frame = -1, outputCount = 0
    return {
        push(channels) {
            const length = channels[0]?.length || 0
            const output = []
            for (let i = 0; i < length; i++) {
                let mono = 0
                for (const channel of channels) mono += channel[i] || 0
                ring[++frame & 127] = mono / channels.length
                const time = outputCount * inputRate / outputRate
                if (frame >= Math.ceil(time - 1e-8)) {
                    const fraction = Math.max(0, Math.min(phases, Math.round((frame - time) * phases)))
                    const kernel = kernels[fraction]
                    let value = 0
                    for (let j = 0; j < taps; j++) value += ring[(frame - j) & 127] * kernel[j]
                    output.push(value)
                    outputCount++
                }
            }
            return Float32Array.from(output)
        },
    }
}
