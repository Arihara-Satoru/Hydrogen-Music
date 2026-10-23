import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const selectorVue = readFileSync(new URL('../src/components/Selector.vue', import.meta.url), 'utf8');

// 1. 验证 z-index 设置高于模态框（BaseModal 1000）
const zIndexMatch = selectorVue.match(/\.selector-option\s*\{[\s\S]*?z-index:\s*(\d+);/);
assert.ok(zIndexMatch, 'Selector.vue 中 .selector-option 必须明确定义 z-index');
const zIndex = Number(zIndexMatch[1]);
assert.ok(zIndex > 1000, `Selector 的 z-index (${zIndex}) 必须大于 1000，防止在弹窗内被遮挡`);

// 2. 验证 @enter 设置 minWidth 并挂载绝对定位
assert.match(
  selectorVue,
  /@enter="handleEnter"/,
  'Selector 必须在 @enter 时执行 handleEnter 动态定位与自适应宽度',
);
assert.match(
  selectorVue,
  /el\.style\.minWidth\s*=\s*`\$\{select\.value\.offsetWidth\}px`/,
  'handleEnter 必须将下拉框 minWidth 与选择框宽度对齐',
);

// 3. 验证生命周期监听包含 onMounted 与 onBeforeUnmount
assert.match(
  selectorVue,
  /onMounted\(\s*\(\)\s*=>\s*\{\s*window\.addEventListener\("click",\s*clickOutside\);?\s*\}\)/,
  'Selector 必须在 onMounted 监听 clickOutside，确保非 keep-alive 弹窗内正常工作',
);
assert.match(
  selectorVue,
  /onBeforeUnmount\(\s*\(\)\s*=>\s*\{\s*window\.removeEventListener\("click",\s*clickOutside\);?\s*\}\)/,
  'Selector 必须在 onBeforeUnmount 移除 clickOutside 监听',
);

console.log('Selector component overlay and positioning checks passed.');
