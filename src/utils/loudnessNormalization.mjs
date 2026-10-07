import { getAudioContext, configureDynamicCompression } from './webAudioGapless'

function metadataNumber(value) {
    return typeof value === 'number' || (typeof value === 'string' && value.trim())
        ? Number(value) : NaN
}

export function calculateLoudnessGain(metadata) {
    const volume = metadataNumber(metadata?.volume)
    const gain = metadataNumber(metadata?.gain)
    const peak = metadataNumber(metadata?.peak)
    if (!Number.isFinite(volume) || volume < -100 || volume > 0
        || !Number.isFinite(gain) || Math.abs(gain) > 60
        || !Number.isFinite(peak) || peak <= 0) return 1

    // ponytail: use the upstream dB gain as documented; revisit if Kugou defines it as an already-applied correction.
    const linearGain = 10 ** ((-14 - volume + gain) / 20)
    // Peak protection takes priority over the minimum gain for unusually large upstream peaks.
    return Math.min(3, Math.max(0.01, linearGain), 0.95 / peak)
}

export function prepareHowlAudioProcessing(playback) {
    // ponytail: the main player uses one HTML5 sound per Howl; route new sounds at creation if concurrent instances are added.
    const elements = (playback._sounds || []).map(sound => sound._node).filter(Boolean)
    const graphs = []
    let desiredGain = 1
    let desiredCompression = 0
    let unloaded = false
    playback.__hmAudioProcessingPrepared = true

    playback.setAudioProcessing = async (value, compressionLevel = 0) => {
        desiredGain = value
        desiredCompression = compressionLevel
        if (unloaded || (value === 1 && !compressionLevel && graphs.length === 0)) return
        const context = getAudioContext()
        if (context.state === 'suspended') await context.resume()
        if (unloaded) return
        if (graphs.length === 0) {
            for (const element of elements) {
                const gain = context.createGain()
                const volumeGain = context.createGain()
                volumeGain.gain.value = element.volume
                volumeGain.connect(context.destination)
                try {
                    const source = context.createMediaElementSource(element)
                    graphs.push({ source, gain, volumeGain, compression: null, compressionLevel: 0 })
                    source.connect(gain)
                    gain.connect(volumeGain)
                    // Howler writes this property for volume and fades; keep those controls after compression.
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
            graph.gain.gain.setValueAtTime(desiredGain, context.currentTime)
            if (graph.compressionLevel === desiredCompression) continue
            if (desiredCompression) graph.compression = configureDynamicCompression(context, desiredCompression, graph.compression)
            graph.gain.disconnect()
            graph.compression?.makeupGain.disconnect()
            if (desiredCompression) {
                graph.gain.connect(graph.compression.compressor)
                graph.compression.makeupGain.connect(graph.volumeGain)
            } else {
                graph.gain.connect(graph.volumeGain)
            }
            graph.compressionLevel = desiredCompression
        }
    }

    const unload = playback.unload
    playback.unload = function (...args) {
        unloaded = true
        for (const { source, gain, volumeGain, compression } of graphs) {
            source.disconnect()
            gain.disconnect()
            volumeGain.disconnect()
            compression?.compressor.disconnect()
            compression?.makeupGain.disconnect()
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
