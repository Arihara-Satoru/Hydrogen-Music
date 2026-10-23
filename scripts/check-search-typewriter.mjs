import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const searchInputVue = readFileSync(new URL('../src/components/SearchInput.vue', import.meta.url), 'utf8');

// 1. 验证打字机相关常量与响应式变量定义
assert.match(
    searchInputVue,
    /const MIN_TYPEWRITER_HOLD_MS\s*=\s*3000/,
    '必须定义 MIN_TYPEWRITER_HOLD_MS 停顿展示最小时间 (3000ms)',
);
assert.match(
    searchInputVue,
    /const MAX_TYPEWRITER_HOLD_MS\s*=\s*5000/,
    '必须定义 MAX_TYPEWRITER_HOLD_MS 停顿展示最大时间 (5000ms)',
);
assert.match(
    searchInputVue,
    /function getRandomHoldDuration\(\)/,
    '必须提供 getRandomHoldDuration 获取 3-5 秒随机展示时长的函数',
);
assert.match(
    searchInputVue,
    /const TYPEWRITER_FLASH_MS\s*=\s*\d+/,
    '必须定义 TYPEWRITER_FLASH_MS 删完后光标快速闪烁时间',
);
assert.match(
    searchInputVue,
    /const displayedText\s*=\s*ref\(['"]SEARCH['"]\)/,
    '默认展示文本必须为 SEARCH 作为演示',
);
assert.match(
    searchInputVue,
    /const cursorPhase\s*=\s*ref\(['"]blink['"]\)/,
    '必须包含光标状态管理 (blink / solid / fast-blink)',
);

// 2. 验证目标文本与演示模式逻辑
assert.match(
    searchInputVue,
    /const currentTargetText\s*=\s*computed\(/,
    '必须包含当前目标文本计算属性，支持默认 SEARCH 或用户当前输入词',
);
assert.match(
    searchInputVue,
    /const isDefaultPlaceholder\s*=\s*computed\(/,
    '必须区分默认演示 SEARCH 与自定义词的字体展示',
);

// 3. 验证打字机阶段循环函数
assert.match(
    searchInputVue,
    /function startTypewriter\(/,
    '必须包含 startTypewriter 启动函数',
);
assert.match(
    searchInputVue,
    /function stopTypewriter\(/,
    '必须包含 stopTypewriter 停止函数',
);
assert.match(
    searchInputVue,
    /function runDeletePhase\(/,
    '必须包含 runDeletePhase 删除阶段（逐字删除）',
);
assert.match(
    searchInputVue,
    /function runFlashPhase\(/,
    '必须包含 runFlashPhase 闪烁阶段（删完后光标快速闪烁两下）',
);
assert.match(
    searchInputVue,
    /function runRestorePhase\(/,
    '必须包含 runRestorePhase 恢复阶段（类似打字机快速恢复）',
);

// 4. 验证聚焦与失焦时停止与启动
assert.match(
    searchInputVue,
    /if\s*\(\s*state\s*===\s*['"]focus['"]\s*\)\s*\{[\s\S]*?stopTypewriter\(\)/,
    '用户聚焦时必须立即调用 stopTypewriter 停止效果以防影响输入',
);
assert.match(
    searchInputVue,
    /startTypewriter\(\)/,
    '失焦时必须调用 startTypewriter 恢复打字机展示',
);

// 5. 验证模板包含 typewriter-display 及其光标
assert.match(
    searchInputVue,
    /v-if="!searchShow"\s+class="typewriter-display"/,
    '模板必须在未聚焦 (!searchShow) 时渲染 typewriter-display',
);
assert.match(
    searchInputVue,
    /<span class="typewriter-text">\{\{\s*displayedText\s*\}\}<\/span>/,
    '必须渲染动态展示文字 span',
);
assert.match(
    searchInputVue,
    /class="typewriter-cursor"/,
    '必须渲染光标元素 span',
);

// 6. 验证样式包含快闪与慢闪 keyframes 及未聚焦防文字重叠
assert.match(
    searchInputVue,
    /@keyframes typewriter-cursor-blink/,
    '必须定义 typewriter-cursor-blink 正常闪烁动画',
);
assert.match(
    searchInputVue,
    /@keyframes typewriter-cursor-flash/,
    '必须定义 typewriter-cursor-flash 快速闪烁两下动画',
);
assert.match(
    searchInputVue,
    /&:not\(\.search-container-foucs\)\s+\.search-input\s*\{[\s\S]*?color:\s*transparent\s*!important/,
    '未聚焦时原生 input 文字必须透明，防止与打字机效果重叠',
);

// 7. 验证暗黑主题兼容性
assert.match(
    searchInputVue,
    /:global\((?:html\.dark|\.dark) \.search-container \.typewriter-display\)/,
    '必须适配暗黑主题字体颜色',
);

// 8. 验证生命周期监听与清理
assert.match(
    searchInputVue,
    /document\.addEventListener\(['"]visibilitychange['"],\s*handleVisibilityChange\)/,
    '必须在页面可见性变化时暂停/恢复打字机，避免后台空转',
);
assert.match(
    searchInputVue,
    /document\.removeEventListener\(['"]visibilitychange['"],\s*handleVisibilityChange\)/,
    '组件销毁时必须注销 visibilitychange 监听',
);

// 9. 验证对 Windows 11 等系统“减少动效 / 关闭动画” (prefers-reduced-motion: reduce) 的适配
assert.match(
    searchInputVue,
    /prefers-reduced-motion:\s*reduce/,
    'JS 中必须检测 prefers-reduced-motion: reduce',
);
assert.match(
    searchInputVue,
    /isReducedMotion\(\)/,
    '启动打字机前必须检查系统减少动效偏好',
);
assert.match(
    searchInputVue,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)/,
    'CSS 中必须提供 @media (prefers-reduced-motion: reduce) 样式适配',
);
assert.match(
    searchInputVue,
    /reduceMotionQuery\.(?:addEventListener|addListener)/,
    '必须实时监听系统动效偏好的变更事件',
);

console.log('All search typewriter checks passed successfully.');
