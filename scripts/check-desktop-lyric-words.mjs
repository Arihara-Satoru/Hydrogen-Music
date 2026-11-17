import assert from 'node:assert/strict';
import { normalizeKugouKrcLyric } from '../src/utils/kugouLyric.js';
import { buildLyricsTimeline } from '../src/utils/lyricCore.js';
import {
    calculateLyricWordProgress, interpolateLyricTime, normalizeLyricWords, resolveDesktopLyricLine,
} from '../src/utils/desktopLyricTiming.mjs';

const language = Buffer.from(JSON.stringify({ content: [
    { type: 0, lyricContent: [['ni hao'], ['ni hao']] },
    { type: 1, lyricContent: [['Hello'], ['Hello again']] },
] })).toString('base64');
const normalized = normalizeKugouKrcLyric([
    `[language:${language}]`,
    '[10009,2000]<0,100,0>你<500,700,0>好',
    '[20009,3000]<0,800,0>你<1500,1200,0>好',
].join('\n'));
assert.equal(normalized.wordTimings.length, 2);
assert.deepEqual(normalized.wordTimings[0].words, [
    { text: '你', startTime: 10.009, duration: 0.1 },
    { text: '好', startTime: 10.509, duration: 0.7 },
]);
const payload = {
    lrc: { lyric: normalized.originalLyricText },
    tlyric: { lyric: normalized.translatedLyricText },
    romalrc: { lyric: normalized.romanizedLyricText },
    wordTimings: normalized.wordTimings,
};
for (const isLocal of [false, true]) {
    const timeline = buildLyricsTimeline(payload, { songDurationSec: 30, isLocal });
    assert.equal(timeline.length, 2);
    assert.equal(timeline[0].time, 10);
    assert.equal(timeline[0].words[0].startTime, 10.009, 'centisecond LRC must preserve millisecond word start');
    assert.equal(timeline[1].words[0].startTime, 20.009, 'repeated text must keep its own timings');
    assert.equal(timeline[0].tlyric, 'Hello');
    assert.equal(timeline[0].rlyric, 'ni hao');
    assert.equal(resolveDesktopLyricLine(timeline[0]).text, '你好', 'auto prioritizes timed original');
    assert.equal(resolveDesktopLyricLine(timeline[0], 'trans').text, 'Hello');
    assert.deepEqual(resolveDesktopLyricLine(timeline[0], 'trans').words, []);
    assert.equal(resolveDesktopLyricLine(timeline[0], 'roma').text, 'ni hao');
    assert.deepEqual(resolveDesktopLyricLine(timeline[0], 'roma').words, []);
}

const word = { text: '好', startTime: 10, duration: 2 };
assert.equal(calculateLyricWordProgress(word, 9), 0);
assert.equal(calculateLyricWordProgress(word, 11), 50);
assert.equal(calculateLyricWordProgress(word, 13), 100);
assert.equal(calculateLyricWordProgress({ ...word, duration: 0 }, 10), 100);
assert.equal(calculateLyricWordProgress(word, NaN), 0);
assert.deepEqual(normalizeLyricWords([word], '不同的文本'), []);
assert.deepEqual(normalizeLyricWords([{ ...word, duration: -1 }], '好'), []);
assert.deepEqual(normalizeLyricWords([{ ...word, startTime: Infinity }], '好'), []);
assert.deepEqual(normalizeLyricWords([word, { ...word, startTime: 9 }], '好好'), []);

const spaced = normalizeKugouKrcLyric('[1000,3000]<0,500,0>  Hello <1000,1200,0>world  ');
assert.equal(spaced.wordTimings[0].words.map(item => item.text).join(''), 'Hello world');
for (const line of [
    '[1000,3000]<0,-50,0>你<500,700,0>好',
    '[1000,3000]<500,50,0>你<0,700,0>好',
    '[1000,3000]前缀<0,100,0>你<500,700,0>好',
]) {
    assert.deepEqual(normalizeKugouKrcLyric(line).wordTimings, [], 'bad timing falls back to readable line');
}
const ordinary = buildLyricsTimeline({ lrc: { lyric: '[00:01.00]你好' }, tlyric: { lyric: '[00:01.00]Hello' } });
assert.equal(resolveDesktopLyricLine(ordinary[0]).text, 'Hello', 'ordinary auto behavior unchanged');
assert.deepEqual(resolveDesktopLyricLine(ordinary[0], 'original').words, []);
assert.deepEqual(buildLyricsTimeline({ lrc: { lyric: '纯文本歌词' } })[0].lyric, '纯文本歌词');
assert.equal(normalizeKugouKrcLyric('[00:01.00]你好').originalLyricText, '[00:01.00]你好');

const clock = { currentTime: 10, receivedAt: 1000, playbackRate: 2, advancing: true };
assert.equal(interpolateLyricTime(clock, 1250, true, 30), 10.5);
assert.equal(interpolateLyricTime(clock, 1250, false, 30), 10);
assert.equal(interpolateLyricTime({ ...clock, advancing: false }, 1250, true, 30), 10);
assert.equal(interpolateLyricTime(clock, 5000, true, 30), 11.2, 'lost IPC must not extrapolate forever');
assert.equal(interpolateLyricTime(clock, 1250, true, 10.25), 10.25);
assert.equal(interpolateLyricTime({ ...clock, currentTime: 2 }, 1000, true, 30), 2, 'backward seeks reset the anchor');

console.log('desktop lyric word timing check passed');
