import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const lyricSource = await readFile('src/components/Lyric.vue', 'utf8')

assert.match(lyricSource, /const showLyricPlaceholder = ref\(showLyricNoData\.value\)/)
assert.match(lyricSource, /showLyricPlaceholder\.value = false/)
assert.match(lyricSource, /v-show="showLyricPlaceholder"/)
assert.match(lyricSource, /'reveal-active': lyricAreaReady/)
assert.match(lyricSource, /function startLyricEntry\(token\)/)
assert.match(lyricSource, /class="lyric-entry-track"/)
assert.doesNotMatch(lyricSource, /lyric-scan|lyric-panel-reveal/)
assert.match(lyricSource, /@keyframes lyric-placeholder-line1-exit/)
assert.match(lyricSource, /\.lyric-placeholder-leave-active/)
assert.match(lyricSource, /@media \(prefers-reduced-motion: reduce\)/)

console.log('lyric reveal check passed')
