import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
  /el\.style\.width\s*=\s*`\$\{rect\.width\}px`/,
  'handleEnter 必须将下拉框实际宽度与选择框精确对齐',
);

// 3. 验证生命周期监听包含 onMounted 与 onBeforeUnmount
assert.match(
  selectorVue,
  /onMounted\(\s*\(\)\s*=>\s*\{\s*window\.addEventListener\("click",\s*clickOutside\);?\s*\}\)/,
  'Selector 必须在 onMounted 监听 clickOutside，确保非 keep-alive 弹窗内正常工作',
);
assert.match(
  selectorVue,
  /onBeforeUnmount\(\s*\(\)\s*=>\s*\{\s*window\.removeEventListener\("click",\s*clickOutside\);?\s*stopPositionTracking\(\);?\s*\}\)/,
  'Selector 必须在 onBeforeUnmount 移除 clickOutside 监听',
);

// 4. 动画与列表样式必须处于同一 scoped 样式中，避免 overflow-y 的优先级覆盖。
const scopedStyle = selectorVue.match(/<style scoped lang="scss">([\s\S]*?)<\/style>/)?.[1];
assert.ok(scopedStyle, 'Selector 必须包含 scoped 样式');
assert.match(scopedStyle, /\.selector-option\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/,
  '下拉列表应仅在垂直内容实际溢出时允许滚动');
assert.match(scopedStyle, /\.selector-enter-active,\s*\.selector-leave-active\s*\{[^}]*overflow:\s*hidden;/,
  '展开和收起期间应在同等 scoped 优先级下隐藏溢出，避免滚动条闪现');
assert.doesNotMatch(scopedStyle, /box-sizing:\s*content-box/,
  '动画期间不应切换盒模型，避免 maxHeight 扣除 padding 后发生裁切');
assert.match(scopedStyle, /transition:\s*clip-path/,
  '展开动画应仅裁剪，不逐帧改变布局高度');
assert.doesNotMatch(scopedStyle, /transition:\s*(height|padding)/);
assert.match(selectorVue, /v-show="option"/, '快速开关时应复用浮层节点');
assert.doesNotMatch(selectorVue, /scrollIntoView/, '选项定位不应滚动页面祖先');

// 两侧留白必须在原生滚动区域内；使用 padding 保持原有内容宽度。
const settingsVue = readFileSync(new URL('../src/views/Settings.vue', import.meta.url), 'utf8');
const scrollContainer = settingsVue.match(/\.settings-container\s*\{([^}]+)/)?.[1];
assert.ok(scrollContainer);
assert.match(scrollContainer, /width:\s*100%/);
assert.match(scrollContainer, /padding:\s*0 10% 140px/);
assert.match(scrollContainer, /box-sizing:\s*border-box/);
assert.match(scrollContainer, /overflow:\s*auto/);
assert.match(settingsVue, /input,\s*\.selector\s*\{[^}]*padding:\s*0;/,
  '选择框外层不得继承输入框内边距，否则可见 head 会越过定位边界');
assert.match(scopedStyle, /background:\s*var\(--panel\)/);
assert.match(scopedStyle, /color:\s*var\(--text\)/);
assert.match(scopedStyle, /position:\s*fixed/);
assert.match(scopedStyle, /backdrop-filter:\s*blur\(18px\)/);
assert.match(scopedStyle, /scrollbar-width:\s*none/);
assert.match(scopedStyle, /\.selector-option::-webkit-scrollbar\s*\{\s*display:\s*none/,
  '隐藏滚动条但保留 overflow-y: auto 以支持滚轮和键盘');
assert.doesNotMatch(scopedStyle, /rgb\(228,\s*240,\s*240\)/);
const themeCss = readFileSync(new URL('../src/assets/css/theme.css', import.meta.url), 'utf8');
assert.match(themeCss, /\.dark \.selector-option\s*\{\s*background:\s*var\(--panel\)/,
  '深色模式不应把下拉框重新覆盖成固定实色');

// 5. 运行组件逻辑，验证嵌套滚动跟随、按帧合并、关闭清理及选项内部滚动。
const script = selectorVue.match(/<script setup>([\s\S]*?)<\/script>/)[1]
  .replace(/^import .*;\s*$/gm, '');
const listeners = new Map();
const frames = new Map();
const watchers = [];
const hooks = {};
let frameId = 0;
let positionCalls = 0;
const context = vm.createContext({
  defineProps: () => ({ options: [{ value: 'a' }], modelValue: 'a', maxItems: 4 }),
  defineEmits: () => () => {},
  ref: (value) => ({ value }),
  computed: (fn) => ({ get value() { return fn(); } }),
  useId: () => 'test-list',
  nextTick: (fn) => Promise.resolve().then(fn),
  watch: (source, callback) => watchers.push(callback),
  onMounted: (fn) => { hooks.mount = fn; },
  onBeforeUnmount: (fn) => { hooks.unmount = fn; },
  onActivated: () => {},
  onDeactivated: (fn) => { hooks.deactivate = fn; },
  getComputedStyle: () => ({ overflowY: 'auto' }),
  requestAnimationFrame: (fn) => { frames.set(++frameId, fn); return frameId; },
  cancelAnimationFrame: (id) => frames.delete(id),
  window: {
    innerWidth: 1000, innerHeight: 700,
    addEventListener: (type, fn, options) => listeners.set(type, { fn, options }),
    removeEventListener: (type) => listeners.delete(type),
  },
});
vm.runInContext(`${script}\nglobalThis.test = { option, overlay, select, scrollActiveOption };`, context);
const component = context.test;
component.select.value = {
  offsetWidth: 200, top: 100,
  parentElement: { parentElement: null, getBoundingClientRect: () => ({ top: 50, bottom: 650 }) },
  getBoundingClientRect() { positionCalls++; return { top: this.top, bottom: this.top + 34, left: 600, width: 200 }; },
};
component.overlay.value = {
  style: {}, dataset: {}, offsetWidth: 200, scrollTop: 0, clientHeight: 152,
  children: [{ offsetTop: 200, offsetHeight: 34 }],
};
hooks.mount();
for (let i = 0; i < 30; i++) {
  component.option.value = true;
  watchers[0](true);
  assert.equal(listeners.get('scroll').options.capture, true);
  const scroll = listeners.get('scroll').fn;
  scroll({ target: component.overlay.value });
  assert.equal(frames.size, 0, '选项内部滚动不应重新定位');
  scroll({ target: {} });
  scroll({ target: {} });
  assert.equal(frames.size, 1, '同帧多个滚动事件只能安排一次定位');
  component.select.value.top = 100 - i;
  const pending = [...frames.values()][0];
  frames.clear();
  pending();
  assert.equal(component.overlay.value.style.top, `${134 - i}px`);
  assert.equal(component.overlay.value.style.width, '200px');
  scroll({ target: {} });
  component.option.value = false;
  watchers[0](false);
  assert.equal(frames.size, 0, '关闭时必须取消待执行帧');
  assert.ok(!listeners.has('scroll') && !listeners.has('resize'));
}
assert.equal(positionCalls, 30);
component.option.value = true;
component.select.value.top = 610;
vm.runInContext('handleEnter(overlay.value)', context);
assert.equal(component.overlay.value.dataset.placement, 'top');
assert.equal(component.overlay.value.style.top, '576px');
component.select.value.top = 20;
vm.runInContext('handleEnter(overlay.value)', context);
assert.equal(component.option.value, false, '选择框滚出内容边界时应关闭，不能钉在顶部');
component.option.value = true;
watchers[0](true);
await component.scrollActiveOption();
assert.equal(component.overlay.value.scrollTop, 82, '仅调整列表自身的 scrollTop');
listeners.get('resize').fn();
hooks.deactivate();
assert.equal(component.option.value, false);
assert.equal(frames.size, 0);
hooks.unmount();
assert.equal(listeners.size, 0);

console.log('Selector overlay, transition, rapid toggling, scroll tracking and cleanup checks passed.');
