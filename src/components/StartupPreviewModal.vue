<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { noticeOpen } from "@/utils/dialog";

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  modelValue: {
    type: String,
    default: "dynamic",
  },
});

const emit = defineEmits(["update:modelValue", "update:show", "close"]);

const THEME_OPTIONS = [
  {
    key: "dynamic",
    label: "动态自适应",
    code: "DYNAMIC",
    color: "#18d1ff",
    badge: "自适应光影",
    desc: "跟随当前播放歌曲封面色彩与深浅模式，动态衍生环境光晕与声学共振频谱动效。",
  },
  {
    key: "ark",
    label: "工业",
    code: "ARK",
    color: "#18d1ff",
    badge: "明日方舟",
    desc: "明日方舟硬核工业战术信息系统，深色网格底图、多段式启动阶段轨与青色雷达回波。",
  },
  {
    key: "endfield",
    label: "工程",
    code: "ENDFIELD",
    color: "#f9d800",
    badge: "终末地",
    desc: "终末地工程工业美学，白灰质感底色与高辨识度明黄技术警示色块、精密刻度网格。",
  },
  {
    key: "exa",
    label: "星空",
    code: "EX ASTRIS",
    color: "#43e5c9",
    badge: "来自星尘",
    desc: "来自星尘幽邃宇宙观测系统，午夜靛蓝、双环天体轨道引力波与古典衬线标题排版。",
  },
  {
    key: "corporate",
    label: "黑白",
    code: "CORPORATE",
    color: "#ffffff",
    badge: "包豪斯极简",
    desc: "纯粹包豪斯黑白极简主义，高反差黑白对比、克制几何构图与严谨排版韵律。",
  },
  {
    key: "popucom",
    label: "缤纷",
    code: "POPUCOM",
    color: "#ff5c39",
    badge: "泡泡聚会",
    desc: "泡泡聚会鲜活多元潮流动感色彩，高饱和明快跳跃节奏、圆润波形与活力元气视觉。",
  },
];

const selectedThemeKey = ref(props.modelValue || "dynamic");
const isClosing = ref(false);
const replayKey = ref(Date.now());
const stageViewportRef = ref(null);
const iframeRef = ref(null);
const scale = ref(0.68);
const currentStageStatus = ref("正在准备播放器...");
const currentProgress = ref(16);
const isIframeLoading = ref(true);

let sequenceTimers = [];
let resizeObserver = null;

const currentThemeInfo = computed(() => {
  return (
    THEME_OPTIONS.find((item) => item.key === selectedThemeKey.value) ||
    THEME_OPTIONS[0]
  );
});

const isCurrentlyApplied = computed(() => {
  return selectedThemeKey.value === props.modelValue;
});

function getDynamicSplashParams() {
  const root = document.documentElement;
  const isDark = root.classList.contains("dark");
  const style = getComputedStyle(root);
  const hue = parseFloat(style.getPropertyValue("--ambient-hue")) || 210;
  const sat = parseFloat(style.getPropertyValue("--ambient-saturation")) || 28;
  const secHue = parseFloat(style.getPropertyValue("--ambient-hue-secondary")) || 252;
  const secSat = parseFloat(style.getPropertyValue("--ambient-saturation-secondary")) || 36;
  const secStr = parseFloat(style.getPropertyValue("--ambient-secondary-strength")) || 1;
  const terHue = parseFloat(style.getPropertyValue("--ambient-hue-tertiary")) || 210;
  const terSat = parseFloat(style.getPropertyValue("--ambient-saturation-tertiary")) || 28;
  const terStr = parseFloat(style.getPropertyValue("--ambient-tertiary-strength")) || 1;
  const priX = parseFloat(style.getPropertyValue("--ambient-primary-x")) || 12;
  const priY = parseFloat(style.getPropertyValue("--ambient-primary-y")) || 8;
  const secX = parseFloat(style.getPropertyValue("--ambient-secondary-x")) || 92;
  const secY = parseFloat(style.getPropertyValue("--ambient-secondary-y")) || 96;
  const terX = parseFloat(style.getPropertyValue("--ambient-tertiary-x")) || 52;
  const terY = parseFloat(style.getPropertyValue("--ambient-tertiary-y")) || 54;
  const gradAngle = parseFloat(style.getPropertyValue("--ambient-gradient-angle")) || 160;

  return new URLSearchParams({
    dynamic: "1",
    dark: isDark ? "1" : "0",
    hue: String(hue),
    sat: String(sat),
    secHue: String(secHue),
    secSat: String(secSat),
    secStr: String(secStr),
    terHue: String(terHue),
    terSat: String(terSat),
    terStr: String(terStr),
    priX: String(priX),
    priY: String(priY),
    secX: String(secX),
    secY: String(secY),
    terX: String(terX),
    terY: String(terY),
    gradAngle: String(gradAngle),
  }).toString();
}

const currentSplashUrl = computed(() => {
  const key = selectedThemeKey.value;
  const isThemeFamily = ["ark", "endfield", "exa", "corporate", "popucom"].includes(key);
  const targetFile = isThemeFamily ? "splash-theme.html" : "splash.html";
  const query = isThemeFamily
    ? `?family=${key}&_t=${replayKey.value}`
    : `?${getDynamicSplashParams()}&_t=${replayKey.value}`;

  const href = window.location.href;
  if (href.startsWith("file:")) {
    const base = href.split("#")[0];
    const hasDist = /[/\\\\]dist[/\\\\]/i.test(base);
    return new URL((hasDist ? "../" : "./") + targetFile + query, base).href;
  }
  return new URL("/" + targetFile + query, window.location.origin).href;
});

const scalerStyle = computed(() => ({
  width: "1080px",
  height: "672px",
  transform: `scale(${scale.value})`,
  transformOrigin: "center center",
}));

const updateScale = () => {
  if (!stageViewportRef.value) return;
  const rect = stageViewportRef.value.getBoundingClientRect();
  const availableW = Math.max(200, rect.width - 24);
  const availableH = Math.max(150, rect.height - 24);
  const sX = availableW / 1080;
  const sY = availableH / 672;
  scale.value = Math.min(sX, sY);
};

const clearSequence = () => {
  sequenceTimers.forEach((timer) => clearTimeout(timer));
  sequenceTimers = [];
};

const postMessageToIframe = (type, payload = {}) => {
  const win = iframeRef.value?.contentWindow;
  if (!win) return;
  try {
    if (type === "status") {
      win.setSplashStatus?.(payload.status, payload.progress);
    } else if (type === "finish") {
      win.finishSplash?.();
    }
  } catch (_) {}
  try {
    win.postMessage(
      {
        type: type === "status" ? "setSplashStatus" : "finishSplash",
        ...payload,
      },
      "*",
    );
  } catch (_) {}
};

const runSimulation = () => {
  clearSequence();
  currentStageStatus.value = "正在准备播放器...";
  currentProgress.value = 16;
  postMessageToIframe("status", { status: "正在准备播放器...", progress: 16 });

  const phases = [
    { delay: 500, progress: 38, status: "正在检查本地数据..." },
    { delay: 1100, progress: 65, status: "正在启动音乐服务..." },
    { delay: 1700, progress: 85, status: "正在加载播放器..." },
    { delay: 2300, progress: 100, status: "准备就绪" },
  ];

  phases.forEach(({ delay, progress, status }) => {
    const timer = setTimeout(() => {
      currentStageStatus.value = status;
      currentProgress.value = progress;
      postMessageToIframe("status", { status, progress });
    }, delay);
    sequenceTimers.push(timer);
  });
};

const handleIframeLoaded = () => {
  isIframeLoading.value = false;
  runSimulation();
};

const selectTheme = (key) => {
  if (selectedThemeKey.value === key) return;
  isIframeLoading.value = true;
  selectedThemeKey.value = key;
  replayKey.value = Date.now();
};

const replay = () => {
  isIframeLoading.value = true;
  clearSequence();
  replayKey.value = Date.now();
};

const applyTheme = () => {
  emit("update:modelValue", selectedThemeKey.value);
  noticeOpen(`已设为启动动画「${currentThemeInfo.value.label}」（下次启动生效）`, 2);
};

const handleKeydown = (event) => {
  if (!props.show) return;
  if (event.key === "Escape") {
    close();
    return;
  }
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const currentIndex = THEME_OPTIONS.findIndex(
      (item) => item.key === selectedThemeKey.value,
    );
    if (currentIndex >= 0) {
      event.preventDefault();
      const delta = event.key === "ArrowLeft" ? -1 : 1;
      const nextIndex =
        (currentIndex + delta + THEME_OPTIONS.length) % THEME_OPTIONS.length;
      selectTheme(THEME_OPTIONS[nextIndex].key);
    }
  }
};

const close = () => {
  if (isClosing.value) return;
  clearSequence();
  isClosing.value = true;
  setTimeout(() => {
    isClosing.value = false;
    emit("close");
  }, 380);
};

watch(
  () => props.show,
  (val) => {
    if (val) {
      isClosing.value = false;
      selectedThemeKey.value = props.modelValue || "dynamic";
      isIframeLoading.value = true;
      replayKey.value = Date.now();
      nextTick(() => {
        updateScale();
      });
      // 在展开动画完成（约 750ms）后再次校验视口缩放尺寸
      setTimeout(() => {
        updateScale();
      }, 760);
    } else {
      clearSequence();
    }
  },
);

watch(
  () => props.modelValue,
  (newVal) => {
    if (newVal && !props.show) {
      selectedThemeKey.value = newVal;
    }
  },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      updateScale();
    });
    if (stageViewportRef.value) {
      resizeObserver.observe(stageViewportRef.value);
    }
  }
  window.addEventListener("resize", updateScale);
});

onBeforeUnmount(() => {
  clearSequence();
  window.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("resize", updateScale);
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="show"
      class="startup-preview-overlay"
      :class="{ 'is-closing': isClosing }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="startup-preview-title"
      @click.self="close"
    >
      <div class="dialog-container startup-dialog-container">
        <!-- 4 corner styles matching GlobalDialog confirmation box -->
        <span class="dialog-style dialog-style1"></span>
        <span class="dialog-style dialog-style2"></span>
        <span class="dialog-style dialog-style3"></span>
        <span class="dialog-style dialog-style4"></span>

        <div class="dialog">
          <div class="dialog-layout">
            <!-- Background Grid Texture -->
            <div class="panel-tech-grid" aria-hidden="true"></div>

            <!-- Header -->
            <header class="preview-header">
              <div class="brand-group">
                <img
                  src="../assets/icon/icon.ico"
                  alt="Hydrogen Music"
                  class="brand-logo"
                />
                <div class="brand-text">
                  <span class="brand-sub">HYDROGEN MUSIC // SYSTEM PREVIEW</span>
                  <h2 id="startup-preview-title" class="brand-title">启动动画预览</h2>
                </div>
              </div>

              <div class="header-right">
                <div class="status-indicator">
                  <span class="status-dot" aria-hidden="true"></span>
                  <span class="status-label">PREVIEW ACTIVE</span>
                </div>
                <button
                  class="close-button"
                  type="button"
                  @click="close"
                  title="关闭预览 (ESC)"
                  aria-label="关闭预览"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            </header>

            <!-- Theme Tabs Switcher -->
            <nav class="theme-nav" aria-label="启动动画样式选项">
              <button
                v-for="item in THEME_OPTIONS"
                :key="item.key"
                type="button"
                class="theme-tab-btn"
                :class="{
                  'is-active': selectedThemeKey === item.key,
                  'is-current-active': props.modelValue === item.key,
                }"
                @click="selectTheme(item.key)"
              >
                <span
                  class="color-pill"
                  :style="{ backgroundColor: item.color }"
                  aria-hidden="true"
                ></span>
                <div class="tab-label-group">
                  <span class="tab-label">{{ item.label }}</span>
                  <span class="tab-code">{{ item.code }}</span>
                </div>
                <span
                  v-if="props.modelValue === item.key"
                  class="current-badge"
                  title="当前正在使用的启动动画"
                >
                  当前生效
                </span>
              </button>
            </nav>

            <!-- Preview Stage -->
            <main class="preview-stage-container">
              <div class="stage-telemetry-bar">
                <div class="telemetry-left">
                  <span class="telemetry-tag">STAGE</span>
                  <span class="telemetry-res">1080 × 672</span>
                  <span class="telemetry-sep">//</span>
                  <span class="telemetry-desc">{{ currentThemeInfo.label }}</span>
                </div>
                <div class="telemetry-right">
                  <span class="telemetry-status">{{ currentStageStatus }}</span>
                  <span class="telemetry-progress">{{ currentProgress }}%</span>
                  <div class="mini-progress-meter">
                    <div
                      class="mini-progress-bar"
                      :style="{
                        width: `${currentProgress}%`,
                        backgroundColor: currentThemeInfo.color,
                      }"
                    ></div>
                  </div>
                </div>
              </div>

              <div
                class="stage-viewport"
                ref="stageViewportRef"
                :style="{ '--theme-accent': currentThemeInfo.color }"
              >
                <!-- Tech Corner Brackets -->
                <span class="stage-bracket b-tl" aria-hidden="true"></span>
                <span class="stage-bracket b-tr" aria-hidden="true"></span>
                <span class="stage-bracket b-bl" aria-hidden="true"></span>
                <span class="stage-bracket b-br" aria-hidden="true"></span>

                <!-- Scaled Iframe Viewport -->
                <div class="stage-scaler" :style="scalerStyle">
                  <iframe
                    ref="iframeRef"
                    :src="currentSplashUrl"
                    class="splash-iframe"
                    title="启动动画实时预览"
                    @load="handleIframeLoaded"
                  ></iframe>
                </div>

                <!-- Loading overlay -->
                <div v-if="isIframeLoading" class="stage-loading-overlay">
                  <div class="spinner"></div>
                  <span>加载动画资源...</span>
                </div>
              </div>
            </main>

            <!-- Footer Action Bar -->
            <footer class="preview-footer">
              <div class="footer-dossier">
                <div class="dossier-title">
                  <strong>{{ currentThemeInfo.label }}</strong>
                  <span class="dossier-code">[{{ currentThemeInfo.code }}]</span>
                  <span class="dossier-badge">{{ currentThemeInfo.badge }}</span>
                </div>
                <p class="dossier-desc">{{ currentThemeInfo.desc }}</p>
              </div>

              <div class="footer-actions">
                <button
                  type="button"
                  class="action-btn replay-btn"
                  @click="replay"
                  title="重新播放入场动画"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                  <span>重新播放</span>
                </button>

                <button
                  type="button"
                  class="action-btn apply-btn"
                  :class="{ 'is-applied': isCurrentlyApplied }"
                  :disabled="isCurrentlyApplied"
                  @click="applyTheme"
                >
                  <svg
                    v-if="isCurrentlyApplied"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                  <span>{{ isCurrentlyApplied ? "当前使用中" : "设为启动动画" }}</span>
                </button>

                <button
                  type="button"
                  class="action-btn close-btn"
                  @click="close"
                >
                  <span>完成</span>
                </button>
              </div>
            </footer>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
@use "../assets/styles/dialog-entry" as entry;
@include entry.keyframes;

.startup-preview-overlay {
  --ark-ink: #080a0b;
  --ark-paper: #f4f6f6;
  --ark-signal: #18d1ff;
  --ark-muted: rgba(244, 246, 246, 0.58);
  --ark-rule: rgba(244, 246, 246, 0.16);

  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(6px);
  user-select: none;
  animation: overlay-fade-in 0.25s ease both;

  &.is-closing {
    pointer-events: none;
    animation: overlay-fade-out 0.38s ease forwards;

    .dialog-container {
      animation: dialog-container-in 0.38s reverse forwards;
    }
  }
}

.dialog-container {
  z-index: 1000;
  --dialog-width: min(1040px, 94vw);
  --dialog-height: min(672px, 92vh);
  width: var(--dialog-width);
  height: var(--dialog-height);
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-image: url("../assets/img/halftone.png");
  background-size: 40%;
  background-repeat: repeat;
  background-color: rgb(14, 14, 14);
  border: 1px solid rgba(244, 246, 246, 0.2);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.75);
  animation: dialog-container-in 0.4s entry.$prepare-duration both;

  .dialog {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .dialog-layout {
    // 内容锚定中心，外框改变尺寸时只裁切，不带着文字平移。
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: var(--dialog-width);
    height: var(--dialog-height);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .dialog-style {
    width: 9px;
    height: 9px;
    background-color: rgb(247, 247, 247);
    position: absolute;
    z-index: 12;
    @include entry.cue;
  }

  $position: -4px;
  .dialog-style1 {
    top: $position;
    left: $position;
  }
  .dialog-style2 {
    top: $position;
    right: $position;
  }
  .dialog-style3 {
    bottom: $position;
    right: $position;
  }
  .dialog-style4 {
    bottom: $position;
    left: $position;
  }
}

.panel-tech-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.28;
  background-image:
    linear-gradient(rgba(244, 246, 246, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(244, 246, 246, 0.05) 1px, transparent 1px),
    url("../assets/img/halftone.png");
  background-size: 48px 48px, 48px 48px, 280px 280px;
  mask-image: linear-gradient(180deg, #000 60%, transparent);
}

/* Header */
.preview-header {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 clamp(16px, 2.5vw, 28px);
  border-bottom: 1px solid var(--ark-rule);
  background: rgba(12, 15, 18, 0.6);
}

.brand-group {
  display: flex;
  align-items: center;
  gap: 12px;

  .brand-logo {
    width: 30px;
    height: 30px;
    object-fit: contain;
  }

  .brand-text {
    display: flex;
    flex-direction: column;
    text-align: left;
  }

  .brand-sub {
    font: 10px Bender-Bold, Consolas, monospace;
    color: var(--ark-muted);
    letter-spacing: 0.12em;
  }

  .brand-title {
    margin: 0;
    font: 16px SourceHanSansCN-Bold, sans-serif;
    color: var(--ark-paper);
    letter-spacing: 0.04em;
  }
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 7px;
  font: 10px Bender-Bold, Consolas, monospace;
  color: var(--ark-signal);
  letter-spacing: 0.08em;

  .status-dot {
    width: 7px;
    height: 7px;
    background: var(--ark-signal);
    border-radius: 50%;
    box-shadow: 0 0 8px var(--ark-signal);
    animation: status-pulse 2s infinite ease-in-out;
  }
}

.close-button {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid rgba(244, 246, 246, 0.15);
  color: var(--ark-paper);
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: var(--ark-paper);
    transform: rotate(90deg);
  }
}

/* Theme Navigation Bar */
.theme-nav {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 1px;
  background: var(--ark-rule);
  border-bottom: 1px solid var(--ark-rule);
}

.theme-tab-btn {
  position: relative;
  height: 48px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(14, 18, 22, 0.85);
  border: none;
  cursor: pointer;
  color: var(--ark-muted);
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);

  .color-pill {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
    box-shadow: 0 0 4px currentColor;
  }

  .tab-label-group {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 0;
  }

  .tab-label {
    font: 12px SourceHanSansCN-Bold, sans-serif;
    color: inherit;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-code {
    font: 9px Bender-Bold, Consolas, monospace;
    opacity: 0.65;
    letter-spacing: 0.06em;
  }

  .current-badge {
    position: absolute;
    top: 3px;
    right: 3px;
    font: 9px SourceHanSansCN-Bold;
    padding: 1px 4px;
    background: rgba(24, 209, 255, 0.18);
    color: var(--ark-signal);
    border: 1px solid rgba(24, 209, 255, 0.4);
    letter-spacing: 0.02em;
  }

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--ark-paper);
  }

  &.is-active {
    background: rgba(25, 32, 40, 0.95);
    color: var(--ark-paper);

    &::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 2px;
      background: var(--ark-signal);
    }
  }

  &.is-current-active:not(.is-active) {
    color: #e2e8f0;
  }
}

/* Stage Area */
.preview-stage-container {
  position: relative;
  z-index: 2;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 16px;
  background: #080a0c;
  overflow: hidden;
}

.stage-telemetry-bar {
  flex-shrink: 0;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px 6px;
  font: 11px Bender-Bold, Consolas, monospace;
  color: var(--ark-muted);

  .telemetry-left,
  .telemetry-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .telemetry-tag {
    color: var(--ark-signal);
    font-weight: bold;
  }

  .telemetry-desc {
    color: var(--ark-paper);
    font-family: SourceHanSansCN-Bold, sans-serif;
  }

  .telemetry-status {
    color: var(--ark-paper);
    font-family: SourceHanSansCN-Bold, sans-serif;
  }

  .telemetry-progress {
    color: var(--ark-signal);
    font-weight: bold;
  }

  .mini-progress-meter {
    width: 60px;
    height: 4px;
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .mini-progress-bar {
    height: 100%;
    transition: width 0.3s ease-out;
  }
}

.stage-viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #040507;
  border: 1px solid rgba(255, 255, 255, 0.08);
  overflow: hidden;
  box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.8);

  .stage-bracket {
    position: absolute;
    width: 10px;
    height: 10px;
    z-index: 3;
    pointer-events: none;
    border-color: var(--theme-accent, var(--ark-signal));
  }

  .b-tl {
    top: 4px;
    left: 4px;
    border-top: 2px solid;
    border-left: 2px solid;
  }
  .b-tr {
    top: 4px;
    right: 4px;
    border-top: 2px solid;
    border-right: 2px solid;
  }
  .b-bl {
    bottom: 4px;
    left: 4px;
    border-bottom: 2px solid;
    border-left: 2px solid;
  }
  .b-br {
    bottom: 4px;
    right: 4px;
    border-bottom: 2px solid;
    border-right: 2px solid;
  }
}

.stage-scaler {
  flex-shrink: 0;
  position: relative;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
}

.splash-iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  pointer-events: none;
  background: #080a0b;
}

.stage-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 4;
  background: rgba(5, 6, 8, 0.85);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--ark-muted);
  font: 12px SourceHanSansCN-Bold, sans-serif;

  .spinner {
    width: 28px;
    height: 28px;
    border: 2px solid rgba(24, 209, 255, 0.2);
    border-top-color: var(--ark-signal);
    border-radius: 50%;
    animation: spinner-rotate 0.8s linear infinite;
  }
}

/* Footer Dossier & Actions */
.preview-footer {
  position: relative;
  z-index: 2;
  flex-shrink: 0;
  min-height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px clamp(16px, 2.5vw, 28px);
  border-top: 1px solid var(--ark-rule);
  background: rgba(12, 15, 18, 0.85);
}

.footer-dossier {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  text-align: left;

  .dossier-title {
    display: flex;
    align-items: center;
    gap: 8px;

    strong {
      font: 14px SourceHanSansCN-Bold, sans-serif;
      color: var(--ark-paper);
    }

    .dossier-code {
      font: 11px Bender-Bold, Consolas, monospace;
      color: var(--ark-signal);
    }

    .dossier-badge {
      font: 10px SourceHanSansCN-Bold, sans-serif;
      padding: 1px 6px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--ark-muted);
      border-radius: 2px;
    }
  }

  .dossier-desc {
    margin: 0;
    font: 12px/1.4 SourceHanSansCN-Regular, sans-serif;
    color: var(--ark-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.action-btn {
  height: 36px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font: 13px SourceHanSansCN-Bold, sans-serif;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  border: none;
  border-radius: 0;

  &.replay-btn {
    background: rgba(255, 255, 255, 0.08);
    color: var(--ark-paper);
    border: 1px solid rgba(255, 255, 255, 0.18);

    &:hover {
      background: rgba(255, 255, 255, 0.15);
      border-color: var(--ark-paper);
    }
  }

  &.apply-btn {
    background: var(--ark-signal);
    color: var(--ark-ink);
    font-weight: 800;

    &:hover:not(:disabled) {
      filter: brightness(1.15);
      box-shadow: 0 0 16px rgba(24, 209, 255, 0.4);
    }

    &.is-applied {
      background: rgba(255, 255, 255, 0.08);
      color: var(--ark-muted);
      cursor: default;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
  }

  &.close-btn {
    background: transparent;
    color: var(--ark-paper);
    border: 1px solid rgba(255, 255, 255, 0.24);

    &:hover {
      background: rgba(255, 255, 255, 0.1);
      border-color: var(--ark-paper);
    }
  }
}

/* Animations */
@keyframes dialog-container-in {
  0% {
    width: 0;
    height: 0;
  }
  50% {
    width: min(1040px, 94vw);
    height: 0;
  }
  100% {
    width: min(1040px, 94vw);
    height: min(672px, 92vh);
  }
}

@keyframes spinner-rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes status-pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.85);
  }
}

@keyframes overlay-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes overlay-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dialog-container,
  .dialog-container .dialog-style {
    animation-duration: 0.01ms !important;
    animation-delay: 0ms !important;
  }
}
</style>
