import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const modalVue = readFileSync(new URL('../src/components/StartupPreviewModal.vue', import.meta.url), 'utf8');
const settingsVue = readFileSync(new URL('../src/views/Settings.vue', import.meta.url), 'utf8');
const splashJs = readFileSync(new URL('../splash.js', import.meta.url), 'utf8');
const splashThemeJs = readFileSync(new URL('../splash-theme.js', import.meta.url), 'utf8');

// 1. 验证启动动画预览弹窗组件已导入并在 Settings.vue 中挂载
assert.match(settingsVue, /import StartupPreviewModal from ["']\.\.\/components\/StartupPreviewModal\.vue["']/);
assert.match(settingsVue, /<StartupPreviewModal/);
assert.match(settingsVue, /openStartupPreview/);
assert.match(settingsVue, /startup-preview-trigger/);

// 2. 验证所有 6 种启动动画主题定义完整
const requiredKeys = ['dynamic', 'ark', 'endfield', 'exa', 'corporate', 'popucom'];
for (const key of requiredKeys) {
  assert.match(modalVue, new RegExp(`key:\\s*["']${key}["']`));
}

// 3. 验证 1080x672 视口比例与缩放自适应逻辑
assert.match(modalVue, /1080/);
assert.match(modalVue, /672/);
assert.match(modalVue, /updateScale/);
assert.match(modalVue, /ResizeObserver/);

// 4. 验证重新播放与设为启动动画操作
assert.match(modalVue, /replay/);
assert.match(modalVue, /applyTheme/);
assert.match(modalVue, /postMessageToIframe/);

// 5. 验证 splash.js 与 splash-theme.js 具备 message 事件监听
assert.match(splashJs, /window\.addEventListener\(["']message["']/);
assert.match(splashThemeJs, /window\.addEventListener\(["']message["']/);

// 6. 验证确认框同款角标与分步展开入场动效（cue 闪烁 + 水平向外铺展 + 垂直展开）
assert.match(modalVue, /dialog-style1/);
assert.match(modalVue, /dialog-style4/);
assert.match(modalVue, /@include entry\.cue/);
assert.match(modalVue, /dialog-container-in/);

console.log('Startup preview modal check passed successfully.');
