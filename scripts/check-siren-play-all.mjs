import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { buildSirenPlaybackQueue } from '../src/utils/sirenPlayback.mjs'

const albums = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
const details = {
    a: { songs: ['a1', 'a2'] },
    b: { songs: ['b1'] },
    c: { songs: ['c1', 'c2'] },
}

assert.deepEqual(buildSirenPlaybackQueue(albums, details), ['a1', 'a2', 'b1', 'c1', 'c2'])
assert.deepEqual(albums, [{ id: 'a' }, { id: 'b' }, { id: 'c' }])

const pageSource = await readFile('src/views/SirenPage.vue', 'utf8')
assert.match(pageSource, /applyPlayMode\(randomize \? 3 : 0/)
assert.match(pageSource, /随机播放会打乱全部曲目/)

console.log('siren play-all check passed')
