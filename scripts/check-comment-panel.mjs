import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [playerSource, commentsSource] = await Promise.all([
  readFile('src/views/MusicPlayer.vue', 'utf8'),
  readFile('src/components/Comments.vue', 'utf8'),
])

const commentsTag = playerSource.match(/<Comments\b[^>]*>/s)?.[0] || ''
assert.match(commentsTag, /\bkey="comments"/)
assert.doesNotMatch(commentsTag, /:key=/)
assert.match(playerSource, /<Transition name="panel-switch" mode="out-in"/)
assert.match(playerSource, /class="right-panel-content" :key="rightPanelMode"/)
assert.match(playerSource, /commentCount\.value = 0;/)
assert.match(playerSource, /isNumericId\(target\.id\)/)
assert.match(playerSource, /getMusicComments\(\{/)
assert.match(playerSource, /getDjProgramCommentsNew/)
assert.match(commentsSource, /const requestSerial = \+\+commentRequestSerial/)
assert.match(commentsSource, /requestTargetKey === commentTargetKey\.value/)

console.log('comment panel check passed')
