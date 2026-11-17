import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const source = (await readFile('src/components/Lyric.vue', 'utf8')).replace(/\r\n/g, '\n');
const before = execFileSync('git', ['show', 'HEAD:src/components/Lyric.vue'], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
// This optimization must not change the authored entry animation or any template/CSS animation.
assert.equal(section(source, 'function startLyricEntry(token)', '// 在高频同步中避免并发测量'),
    section(before, 'function startLyricEntry(token)', '// 在高频同步中避免并发测量'));
assert.equal(source.slice(source.indexOf('<template>')), before.slice(before.indexOf('<template>')));

let reads = 0;
const ref = value => ({ value });
const context = vm.createContext({
    lyricsObjArr: ref([{ lyric: '歌词', tlyric: 'Translation' }]),
    lyricType: ref(['original', 'trans']), lyricSize: ref(20), tlyricSize: ref(14), rlyricSize: ref(12),
    size: 0, initMax: 0, initOffset: 0, heightVal: ref(0), lineOffset: ref(0),
    minHeightVal: ref(0), maxHeightVal: ref(0), lycCurrentIndex: ref(0),
    lyricScrollArea: ref({ style: {} }), lyricEle: ref([{}]), isLyricActive: ref(false),
    getMeasuredLyricMetrics() { reads++; return { offset: 40, total: 500 }; },
});
vm.runInContext(
    section(source, 'const setMaxHeight =', 'const setDefaultStyle =') +
    section(source, 'const syncLyricPosition =', '// 检测大幅进度跳转') +
    '\nglobalThis.layout = setMaxHeight; globalThis.sync = syncLyricPosition;', context);

const metrics = context.layout(true);
context.sync(metrics);
assert.equal(reads, 1, 'Initial layout and synchronization share one measurement');
assert.equal(context.lineOffset.value, -280);
assert.equal(context.maxHeightVal.value, 540);
assert.equal(context.lyricScrollArea.value.style.height, '500Px');
assert.equal(context.heightVal.value, 500);
assert.equal(context.isLyricActive.value, true);
context.sync();
assert.equal(reads, 2, 'Normal playback still reads fresh metrics');
assert.equal(context.lineOffset.value, -280);

for (const path of ['src/components/Player.vue', 'src/components/MusicWidget.vue']) {
    const component = await readFile(path, 'utf8');
    assert.match(component, /:duration="0\.7"/);
    assert.match(component, /:interval="0\.01"/);
    assert.match(component, /@pointerdown\.capture="beginProgressSeek"/);
    assert.match(component, /@drag-end="finishProgressSeek"/);
    assert.match(component, /transition-timing-function: cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
}
console.log('Lyric layout reuse passed; lyric entry, template and CSS unchanged; progress easing verified.');
