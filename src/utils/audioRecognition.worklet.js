/* makeResampler 由 audioRecognitionCapture.mjs 注入；不依赖外部模块或网络资源。 */
class RecognitionProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super()
        this.resampler = makeResampler(sampleRate, 8000)
        this.limit = options.processorOptions.maxSamples
        this.count = 0
        this.chunk = new Float32Array(800)
        this.used = 0
        this.stopped = false
        this.port.onmessage = event => {
            if (event.data === 'stop') this.stopped = true
        }
    }
    flush(done) {
        const samples = this.chunk.slice(0, this.used)
        this.port.postMessage({ samples, done }, [samples.buffer])
        this.used = 0
    }
    process(inputs) {
        if (this.stopped) return false
        const channels = inputs[0]
        if (!channels?.length) return true
        const samples = this.resampler.push(channels)
        for (const sample of samples) {
            this.chunk[this.used++] = sample
            this.count++
            if (this.count >= this.limit) {
                this.flush(true)
                return false
            }
            if (this.used === this.chunk.length) this.flush(false)
        }
        return true
    }
}
registerProcessor('hydrogen-recognition', RecognitionProcessor)
