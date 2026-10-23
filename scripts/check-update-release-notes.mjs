import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/components/UpdateReleaseNotes.vue', import.meta.url), 'utf8');

// 1. 验证 autofocus 已移除，改由受控 focus 传入 preventScroll: true
assert.doesNotMatch(source, /<button[^>]+autofocus/i, '原生 autofocus 会导致浏览器不受控滚动，必须移除');
assert.match(source, /primaryAction\.value\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/, '必须使用 preventScroll: true 聚焦以避免容器滚动');
assert.match(source, /panelRef\.value\.scrollTop\s*=\s*0/, '挂载后必须确保 panel scrollTop 重置到顶部');

// 2. 验证容器垂直 flex 布局与高度约束
assert.match(source, /\.update-panel\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;[\s\S]*?overflow:\s*hidden;/, 'update-panel 必须为 flex column 且 overflow: hidden');
assert.match(source, /\.update-header\s*\{[\s\S]*?flex-shrink:\s*0;/, 'update-header 必须 flex-shrink: 0');
assert.match(source, /\.update-layout\s*\{[\s\S]*?flex:\s*1;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/, 'update-layout 必须 flex: 1 且 min-height: 0');

// 3. 验证信息展示区与更新日志滚动区约束
assert.match(source, /\.update-information\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/, 'update-information 必须设置 min-height: 0, height: 100% 和 overflow: hidden');
assert.match(source, /\.release-notes\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?height:\s*100%;[\s\S]*?overflow:\s*hidden;/, 'release-notes 必须设置 min-height: 0, height: 100% 和 overflow: hidden');
assert.match(source, /\.notes-scroll\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?height:\s*100%;[\s\S]*?overflow-y:\s*auto;/, 'notes-scroll 必须在受控高度内纵向滚动');

console.log('UpdateReleaseNotes layout and scroll-prevention checks passed.');
