import assert from 'node:assert/strict'
import {
  calculateLoudnessGain,
  getAdjustedPlaybackVolume,
} from '../src/utils/loudnessNormalization.mjs'

assert.equal(calculateLoudnessGain(), 1)
assert.equal(calculateLoudnessGain({ volume: undefined, volumePeak: 1 }), 1)
assert.equal(calculateLoudnessGain({ volume: -14, volumePeak: 1 }), 0.95)
assert.equal(calculateLoudnessGain({ volume: -20, volumePeak: 0.4 }).toFixed(3), '1.995')
assert.equal(calculateLoudnessGain({ volume: -20, volumeGain: 2, volumePeak: 1 }), 0.95)
assert.equal(getAdjustedPlaybackVolume(0.3, 2, true), 0.6)
assert.equal(getAdjustedPlaybackVolume(0.8, 2, true), 1)
assert.equal(getAdjustedPlaybackVolume(0.3, 2, false), 0.3)

console.log('loudness normalization checks passed')
