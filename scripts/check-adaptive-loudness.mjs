import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { performance } from 'node:perf_hooks'

const source = await readFile('src/utils/adaptiveLoudness.worklet.js', 'utf8')

function createProcessor(sampleRate = 48000, initialGain = 0.25) {
    let Processor
    const messages = []
    const context = createContext({
        sampleRate,
        AudioWorkletProcessor: class { constructor() { this.port = { onmessage: null, postMessage: message => messages.push(message) } } },
        registerProcessor: (_name, constructor) => { Processor = constructor },
    })
    runInContext(source, context)
    const processor = new Processor({ processorOptions: { initialGain } })
    const input = [new Float32Array(128), new Float32Array(128)]
    const output = input.map(() => new Float32Array(128))
    let frame = 0
    return {
        processor, messages,
        render(seconds, amplitude = 0, frequency = 1000) {
            let peak = 0
            let energy = 0
            let count = 0
            for (let block = 0; block < Math.ceil(seconds * sampleRate / 128); block++) {
                for (let i = 0; i < 128; i++, frame++) {
                    const sample = amplitude * Math.sin(2 * Math.PI * frequency * frame / sampleRate)
                    input[0][i] = input[1][i] = sample
                }
                assert.equal(processor.process([input], [output]), true)
                for (let i = 0; i < 128; i++) {
                    assert.ok(Number.isFinite(output[0][i]))
                    peak = Math.max(peak, Math.abs(output[0][i]))
                    energy += output[0][i] ** 2
                    count++
                }
            }
            return { peak, rms: Math.sqrt(energy / count) }
        },
    }
}

const convergence = []
for (const rate of [44100, 48000, 96000]) {
    for (const amplitude of [0.95, 0.4, 0.1, 0.02]) {
        const startup = createProcessor(rate)
        startup.render(0.5, amplitude)
        if (amplitude <= 0.4) assert.ok(startup.processor.gain <= 0.25001, 'no boost before signal confirmation')
        startup.render(0.7, amplitude)
        const acquiredGain = startup.processor.gain
        assert.equal(startup.processor.calibrating, false, `startup must finish within 1.2s at ${rate} Hz / ${amplitude}`)
        startup.render(4, amplitude)
        const differenceDb = Math.abs(20 * Math.log10(startup.processor.gain / acquiredGain))
        assert.ok(differenceDb < 0.25, `steady signal cannot keep audibly rising: ${differenceDb} dB`)
        convergence.push({ rate, amplitude, gainAt1_2s: Number(acquiredGain.toFixed(3)), laterDriftDb: Number(differenceDb.toFixed(3)) })
    }
    const loud = createProcessor(rate)
    assert.equal(loud.processor.gain, 0.25)
    const silence = loud.render(3)
    assert.equal(silence.peak, 0)
    assert.equal(loud.processor.gain, 0.25)
    assert.equal(loud.messages.length, 0)
    loud.render(12, 0.95)
    assert.ok(loud.processor.gain < 0.23, `loud track must attenuate at ${rate} Hz: ${loud.processor.gain}`)
    assert.ok(loud.processor.gain > 0.1)
    assert.ok(loud.messages.length <= 6, 'at most one scalar message per second after warmup')
    const delayedStart = createProcessor(rate)
    delayedStart.render(2)
    delayedStart.render(0.5, 0.4)
    assert.ok(delayedStart.processor.gain <= 0.25001, 'preceding silence must not count towards signal confirmation')
    delayedStart.render(0.7, 0.4)
    assert.equal(delayedStart.processor.calibrating, false)
    assert.ok(delayedStart.processor.gain > 0.49 && delayedStart.processor.gain < 0.51)
    const quiet = createProcessor(rate)
    quiet.render(1.2, 0.02)
    assert.ok(quiet.processor.gain > 2.9 && quiet.processor.gain <= 3)
    const jump = quiet.render(0.25, 0.95)
    assert.ok(jump.peak <= 0.950001, 'a loud section following fast boost must remain peak protected')
    assert.ok(quiet.processor.gain < 0.23, 'fast startup cannot delay downward protection')
    quiet.processor.port.onmessage({ data: { type: 'reset' } })
    quiet.render(1.2, 0.02)
    const beforeSilence = quiet.processor.gain
    quiet.render(8)
    assert.ok(quiet.processor.gain <= beforeSilence + 0.01, 'silence must not increase gain')
    const beforeSeek = quiet.processor.gain
    quiet.processor.port.onmessage({ data: { type: 'reset' } })
    assert.equal(quiet.processor.gain, beforeSeek, 'seek must not mechanically duck to 0.25')
    quiet.render(0.25, 0.95)
    assert.ok(quiet.processor.gain < 0.23, 'loud section after seek must attenuate')
    const attenuated = quiet.processor.gain
    quiet.processor.port.onmessage({ data: { type: 'reset' } })
    assert.equal(quiet.processor.gain, attenuated)
    quiet.render(1.2, 0.1)
    assert.equal(quiet.processor.calibrating, false, 'seek to a quieter section re-acquires quickly')
    assert.ok(quiet.processor.gain > 1 && quiet.processor.gain <= 3)
    const gated = createProcessor(rate)
    gated.render(20, 0.002)
    assert.equal(gated.processor.gain, 0.25, 'quiet intro cannot demand a boost')
    const gain = gated.processor.gain
    gated.processor.port.onmessage({ data: { type: 'running', value: false } })
    gated.render(2, 0.95)
    assert.equal(gated.processor.gain, gain, 'paused playback cannot update the estimate')
    gated.processor.port.onmessage({ data: { type: 'running', value: true } })
    gated.render(2, 0.95)
    assert.ok(gated.processor.gain < gain)
    const intro = createProcessor(rate)
    intro.render(5, 0.002)
    assert.equal(intro.processor.calibrating, true, 'almost silent intro must not consume fast calibration')
    intro.render(1.2, 0.1)
    assert.equal(intro.processor.calibrating, false)
    assert.ok(intro.processor.gain > 1, 'normal signal after a quiet intro acquires without a long ramp')
    const interrupted = createProcessor(rate)
    interrupted.render(0.7, 0.02)
    interrupted.render(0.5)
    const silenceGain = interrupted.processor.gain
    interrupted.render(2)
    assert.ok(interrupted.processor.gain <= silenceGain + 1e-6, 'startup must not continue rising through silence')
    const resume = createProcessor(rate)
    resume.render(1.2, 0.1)
    const beforePause = resume.processor.gain
    resume.processor.port.onmessage({ data: { type: 'running', value: false } })
    resume.processor.port.onmessage({ data: { type: 'running', value: true } })
    assert.equal(resume.processor.gain, beforePause)
    assert.equal(resume.processor.calibrating, false, 'resume must not repeat startup ramp')
    resume.render(1.2, 0.1)
    assert.ok(Math.abs(20 * Math.log10(resume.processor.gain / beforePause)) < 0.25)
    const boosted = createProcessor(rate, 1)
    assert.ok(boosted.render(0.1, 2).peak <= 0.950001, 'linked sample-peak safety')
    boosted.processor.port.onmessage({ data: { type: 'dispose' } })
    assert.equal(boosted.processor.process([], []), false)
}

// An indicative DSP benchmark only; excludes browser scheduling, decoding and audio drivers.
const benchmark = createProcessor(48000)
const input = [new Float32Array(128).fill(0.25), new Float32Array(128).fill(0.25)]
const output = input.map(() => new Float32Array(128))
const inputs = [input]
const outputs = [output]
const seconds = 60
const start = performance.now()
for (let i = 0; i < seconds * 48000 / 128; i++) benchmark.processor.process(inputs, outputs)
const elapsed = performance.now() - start
console.log('Fast calibration (steady synthetic tones, not arbitrary music):', JSON.stringify(convergence))
console.log(`adaptive loudness: <=1.2s acquisition, steady-level drift, silence/intro gates, seek/pause, boost cap and sample peaks passed; 60s stereo DSP took ${elapsed.toFixed(0)}ms (${(elapsed / (seconds * 1000) * 100).toFixed(2)}% of realtime, indicative Node benchmark)`)
