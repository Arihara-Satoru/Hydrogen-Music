import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [home, player, playerVideo, videoPlayer] = await Promise.all([
  readFile('src/views/Home.vue', 'utf8'),
  readFile('src/utils/player.js', 'utf8'),
  readFile('src/components/PlayerVideo.vue', 'utf8'),
  readFile('src/components/VideoPlayer.vue', 'utf8'),
])

assert.match(home, /<keep-alive :max="3">/)
assert.match(player, /export function pauseMusic[\s\S]*?stopProgressSampling\(\);\s*\/\/ ponytail: paused playback[\s\S]*?clearGaplessPreload\(\);/)
assert.match(player, /if \(document\.hidden\) \{\s*musicVideoDOM\.value\.pause\?\.\(\);/)
assert.match(playerVideo, /visibilitychange.*handleVisibilityChange/)
assert.match(videoPlayer, /onBeforeUnmount\([\s\S]*?plyr\?\.destroy\(\)/)

console.log('background memory check passed')
