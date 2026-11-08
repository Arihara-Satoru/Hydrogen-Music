import { getAudioContext } from './webAudioGapless'
import { createAdaptiveLoudness, PROTECTED_LOUDNESS_GAIN } from './adaptiveLoudness.mjs'

export function prepareHowlAudioProcessing(playback) {
    // ponytail: the main player uses one HTML5 sound per Howl; route new sounds at creation if concurrent instances are added.
    const elements = (playback._sounds || []).map(sound => sound._node).filter(Boolean)
    const graphs = []
    let revision = 0
    let unloaded = false
    playback.__hmAudioProcessingPrepared = true
    const setRunning = value => graphs.forEach(graph => graph.adaptive?.setRunning(value))
    playback.on?.('play', () => setRunning(true))
    playback.on?.('pause', () => setRunning(false))
    playback.on?.('end', () => setRunning(false))
    playback.on?.('seek', () => graphs.forEach(graph => graph.adaptive?.reset()))

    playback.setLoudnessNormalization = async (enabled) => {
        const request = ++revision
        if (unloaded || (!enabled && graphs.length === 0)) return
        const context = getAudioContext()
        if (context.state === 'suspended') await context.resume()
        if (unloaded || request !== revision) return
        if (graphs.length === 0) {
            for (const element of elements) {
                const gain = context.createGain()
                const volumeGain = context.createGain()
                volumeGain.gain.value = element.volume
                volumeGain.connect(context.destination)
                try {
                    const source = context.createMediaElementSource(element)
                    graphs.push({ source, gain, volumeGain, adaptive: null })
                    source.connect(gain)
                    gain.connect(volumeGain)
                    // Keep Howler's volume and fades after local loudness processing.
                    const nativeVolume = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'volume')
                    nativeVolume.set.call(element, 1)
                    Object.defineProperty(element, 'volume', {
                        configurable: true,
                        get: () => volumeGain.gain.value,
                        set: (value) => {
                            const volume = Number(value)
                            if (!Number.isFinite(volume) || volume < 0 || volume > 1) throw new RangeError('音量必须在 0 到 1 之间')
                            volumeGain.gain.setValueAtTime(volume, context.currentTime)
                        },
                    })
                } catch (error) {
                    gain.disconnect()
                    volumeGain.disconnect()
                    throw error
                }
            }
        }
        for (const graph of graphs) {
            if (enabled && !graph.adaptive) {
                graph.gain.gain.setValueAtTime(PROTECTED_LOUDNESS_GAIN, context.currentTime)
                const key = Array.isArray(playback._src) ? playback._src[0] : playback._src
                const adaptive = await createAdaptiveLoudness(context, key)
                if (unloaded || request !== revision) {
                    adaptive.dispose()
                    return
                }
                graph.adaptive = adaptive
                adaptive.setRunning(playback.playing?.() === true)
            }
            if (!enabled && graph.adaptive) {
                graph.adaptive.dispose()
                graph.adaptive = null
            }
            graph.gain.gain.setValueAtTime(1, context.currentTime)
            graph.gain.disconnect()
            graph.adaptive?.node.disconnect()
            const output = graph.adaptive?.node || graph.gain
            if (graph.adaptive) graph.gain.connect(graph.adaptive.node)
            output.connect(graph.volumeGain)
        }
        playback.__hmLoudnessMode = enabled
            ? (graphs.every(graph => graph.adaptive?.realtime) ? 'realtime' : 'protected') : 'off'
    }

    const unload = playback.unload
    playback.unload = function (...args) {
        unloaded = true
        for (const { source, gain, volumeGain, adaptive } of graphs) {
            adaptive?.dispose()
            source.disconnect()
            gain.disconnect()
            volumeGain.disconnect()
        }
        // Howler 2.2 pools HTML5 elements; a routed element cannot be detached from its MediaElementSource.
        for (const element of elements) element._unlocked = false
        return unload.apply(this, args)
    }

    for (const element of elements) {
        element.crossOrigin = 'anonymous'
        element.load()
    }
}

// CORS can prevent Web Audio routing. Keep the native volume/fades under a conservative
// ceiling instead of silently returning to a much louder, unprocessed stream.
export function prepareProtectedPlayback(playback) {
    const nativeVolume = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'volume')
    for (const { _node: element } of playback._sounds || []) {
        let userVolume = element.volume
        let protection = 1
        Object.defineProperty(element, 'volume', {
            configurable: true,
            get: () => userVolume,
            set(value) {
                const next = Number(value)
                if (!Number.isFinite(next) || next < 0 || next > 1) throw new RangeError('音量必须在 0 到 1 之间')
                userVolume = next
                nativeVolume.set.call(element, userVolume * protection)
            },
        })
        element.setLoudnessProtection = value => {
            protection = value
            nativeVolume.set.call(element, userVolume * protection)
        }
    }
    playback.setLoudnessProtection = value => {
        for (const { _node } of playback._sounds || []) _node.setLoudnessProtection?.(value)
    }
    const unload = playback.unload
    playback.unload = function (...args) {
        // These elements have per-playback volume descriptors; never return them to the pool.
        for (const { _node } of this._sounds || []) _node._unlocked = false
        return unload.apply(this, args)
    }
}
