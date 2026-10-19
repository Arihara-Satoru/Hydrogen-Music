export const DEFAULT_QUALITY_LEVEL = 'flac'

export const QUALITY_LEVELS = [
    '128',
    '320',
    'flac',
    'high',
]

export function getPreferredQuality(level) {
    return QUALITY_LEVELS.includes(level) ? level : DEFAULT_QUALITY_LEVEL
}

export function buildLevelInfoFromStream(streamInfo = {}) {
    const [sr, br, bitsPerSample, size] = [
        streamInfo.sr || streamInfo.sampleRate || streamInfo.sample_rate,
        streamInfo.br || streamInfo.bitrate || streamInfo.bitRate,
        streamInfo.bitsPerSample || streamInfo.bitDepth || streamInfo.bit_depth || streamInfo.bits_per_sample,
        streamInfo.size,
    ].map(value => ['number', 'string'].includes(typeof value) ? Number(value) : NaN)
    const type = String(streamInfo.type || streamInfo.extname || streamInfo.container || '').trim().toLowerCase()
    const codec = String(streamInfo.codec || '').trim().toLowerCase()
    return {
        ...Object.fromEntries(Object.entries({
            sr,
            br,
            bitsPerSample,
            size,
        }).filter(([, value]) => Number.isFinite(value) && value > 0)),
        ...(type ? { type: type === 'wave' ? 'wav' : type } : {}),
        ...(codec ? { codec } : {}),
        ...(typeof streamInfo.lossless === 'boolean' ? { lossless: streamInfo.lossless } : {}),
    }
}

export function isLossyStream(streamInfo = {}) {
    const { type, codec, lossless } = buildLevelInfoFromStream(streamInfo)
    return lossless === false || ['mp3', 'mpeg', 'aac', 'opus', 'vorbis'].includes(type)
        || /vorbis|opus|\baac\b|mpeg.*layer/i.test(codec || '')
}

export function formatAudioInfo(streamInfo = {}) {
    const { sr, br, bitsPerSample, type, size } = buildLevelInfoFromStream(streamInfo)
    const isLossless = !isLossyStream(streamInfo)
    // 针对截断探测导致误算出的极低码率（如无损 FLAC 显示几十 kbps）做兜底过滤
    let displayBitrate = br
    if (isLossless && displayBitrate && displayBitrate < 200000) {
        displayBitrate = undefined
    }
    return {
        format: type ? type.toUpperCase() : '未知',
        sampleRate: sr ? `${Number((sr / 1000).toFixed(3))} kHz` : '未知',
        bitDepth: !isLossless
            ? '不适用' : bitsPerSample ? `${bitsPerSample} bit` : '未知',
        bitrate: displayBitrate ? `${Math.round(displayBitrate / 1000)} kbps` : '未知',
    }
}

export function formatDownloadQuality(streamInfo = {}, preferredQuality = '') {
    const info = buildLevelInfoFromStream(streamInfo)
    let actualLevel = streamInfo.level || ''
    if (info.type === 'mp3' && info.br) actualLevel = info.br >= 256000 ? '320' : '128'
    if (['flac', 'wav'].includes(info.type) && !['flac', 'high'].includes(actualLevel)) actualLevel = 'flac'
    const actualIndex = QUALITY_LEVELS.indexOf(actualLevel)
    const downgraded = (isLossyStream(streamInfo)
        && ['flac', 'high'].includes(preferredQuality))
        || (actualIndex >= 0 && QUALITY_LEVELS.indexOf(preferredQuality) > actualIndex)
    const audio = formatAudioInfo(streamInfo)
    const requested = ['128', '320'].includes(preferredQuality) ? `${preferredQuality} kbps`
        : preferredQuality === 'high' ? 'Hi-Res' : preferredQuality.toUpperCase()
    return {
        downgraded,
        text: `${requested ? `请求 ${requested} → ` : ''}${audio.format} / ${audio.bitrate === '未知' ? '码率未知' : audio.bitrate}${downgraded ? '（已降级）' : ''}`,
    }
}
