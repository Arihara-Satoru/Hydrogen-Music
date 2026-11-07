import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { preventPlaybackTextSelection } from '../src/utils/songTextInteraction.mjs'

for (const [button, detail, editable, expected] of [
    [0, 1, false, false], // native drag selection for copy
    [0, 2, false, true], // double click playback
    [0, 3, false, true],
    [2, 2, false, false], // context menu
    [1, 2, false, false],
    [0, 2, true, false], // editing retains normal double click selection
]) {
    let prevented = false
    preventPlaybackTextSelection({ button, detail, target: { closest: () => editable }, preventDefault() { prevented = true } })
    assert.equal(prevented, expected)
}
for (const name of ['LibrarySongList', 'LocalMusicDetail', 'CloudFileList', 'NewestSong', 'PlayList']) {
    const source = await readFile(`src/components/${name}.vue`, 'utf8')
    assert.match(source, /@mousedown="preventPlaybackTextSelection"/)
    assert.match(source, /@dblclick="/)
}
const library = await readFile('src/components/LibrarySongList.vue', 'utf8')
assert.match(library, /user-select: text/)
const home = await readFile('src/views/Home.vue', 'utf8')
assert.match(home, /@dragstart\.prevent/)
const links = [...home.matchAll(/<router-link\b[^>]*>/g)].map(match => match[0])
assert.equal(links.length, 6)
assert.ok(links.every(link => link.includes('draggable="false"')))
assert.match(home, /-webkit-user-drag: none/)
assert.match(home, /-webkit-app-region: no-drag/)
console.log('Song text interaction checks passed: double-click guard, native copy selection, editable controls and non-draggable navigation')
