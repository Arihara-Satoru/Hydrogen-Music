const TARGET_LOUDNESS_DB = -14
const OUTPUT_PEAK_LIMIT = 0.95
const MIN_GAIN = 0.01
const MAX_GAIN = 3

const finiteNumber = value => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function calculateLoudnessGain(metadata) {
  const volume = finiteNumber(metadata?.volume)
  if (volume === null) return 1

  const suggestedGain = finiteNumber(metadata?.volumeGain ?? metadata?.volume_gain) ?? 0
  const peak = finiteNumber(metadata?.volumePeak ?? metadata?.volume_peak)
  let gain = 10 ** ((TARGET_LOUDNESS_DB - volume + suggestedGain) / 20)

  if (peak !== null && peak > 0 && peak * gain > OUTPUT_PEAK_LIMIT) {
    gain = OUTPUT_PEAK_LIMIT / peak
  }

  return Math.max(MIN_GAIN, Math.min(MAX_GAIN, gain))
}

export function getAdjustedPlaybackVolume(userVolume, loudnessGain, enabled) {
  const volume = finiteNumber(userVolume) ?? 0
  const gain = enabled ? finiteNumber(loudnessGain) ?? 1 : 1
  return Math.max(0, Math.min(1, volume * gain))
}
