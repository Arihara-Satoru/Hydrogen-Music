import assert from 'node:assert/strict';
import { normalizeReleaseNotes } from '../src/utils/releaseNotes.mjs';

assert.deepEqual(
  normalizeReleaseNotes('## 更新日志\n- 新增本地音乐搜索\n- 修复 [`abc1234`](https://example.com) 崩溃'),
  [{ version: '', notes: ['新增本地音乐搜索', '修复 abc1234 崩溃'] }],
);

assert.deepEqual(
  normalizeReleaseNotes('<h2>更新日志</h2><ul><li>优化启动速度</li><li>修复播放异常 &amp; 卡顿</li></ul>'),
  [{ version: '', notes: ['优化启动速度', '修复播放异常 & 卡顿'] }],
);

assert.deepEqual(
  normalizeReleaseNotes([{ version: '0.7.0', note: '- 新增功能' }, { version: '0.6.9', note: '' }]),
  [{ version: '0.7.0', notes: ['新增功能'] }],
);

assert.deepEqual(normalizeReleaseNotes(null), []);
assert.deepEqual(
  normalizeReleaseNotes('<script>ignored()</script><li>保留内容 &#99999999;</li>'),
  [{ version: '', notes: ['保留内容 �'] }],
);
console.log('release notes normalization checks passed');
