import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appVue = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8');
const homeVue = readFileSync(new URL('../src/views/Home.vue', import.meta.url), 'utf8');
const windowControlVue = readFileSync(new URL('../src/components/WindowControl.vue', import.meta.url), 'utf8');

// 1. 验证 dragBar 与 window-control 层级高于常规页面内容（1000）
const dragBarMatch = appVue.match(/\.dragBar\s*\{[\s\S]*?z-index:\s*(\d+);[\s\S]*?\.window-control\s*\{[\s\S]*?z-index:\s*(\d+);/);
assert.ok(dragBarMatch, 'App.vue 中必须包含 dragBar 与 window-control 的 z-index 规则');
const dragBarZIndex = Number(dragBarMatch[1]);
const windowControlZIndex = Number(dragBarMatch[2]);
assert.ok(dragBarZIndex > 1000, `dragBar 的 z-index (${dragBarZIndex}) 必须大于 1000，以防被内容遮挡`);
assert.ok(windowControlZIndex > 1000, `window-control 的 z-index (${windowControlZIndex}) 必须大于 1000，以防被内容遮挡`);

// 2. 验证 home-header 透明区域不阻挡点击，内部路由区接收点击
assert.match(
  homeVue,
  /\.home-header\s*\{[\s\S]*?pointer-events:\s*none;[\s\S]*?\.header-router\s*\{[\s\S]*?pointer-events:\s*auto;/,
  'home-header 必须 pointer-events: none，header-router 必须 pointer-events: auto，防止透明空白区遮挡窗口控件',
);

// 3. 验证 WindowControl 防止拖拽拦截与双击击穿
assert.match(windowControlVue, /@dblclick\.stop/, 'WindowControl 根节点必须阻断双击冒泡');
assert.match(windowControlVue, /-webkit-app-region:\s*no-drag;/, 'WindowControl 必须显式声明 no-drag');
assert.match(windowControlVue, /svg\s*\{[\s\S]*?pointer-events:\s*none;/, 'WindowControl 中的 svg 必须 pointer-events: none 确保按钮容器稳定接收点击');

console.log('Window controls hitbox and layering checks passed.');
