<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useOtherStore } from '../store/otherStore';
import { normalizeReleaseNotes } from '../utils/releaseNotes.mjs';

const RELEASES_URL = 'https://github.com/Arihara-Satoru/Hydrogen-Music/releases';
const otherStore = useOtherStore();
const show = ref(true);
const primaryAction = ref(null);

const updateInfo = computed(() => otherStore.updateInfo || {});
const version = computed(() => updateInfo.value.version || '--');
const releaseGroups = computed(() => normalizeReleaseNotes(updateInfo.value.releaseNotes));
const releaseDate = computed(() => {
  const value = updateInfo.value.releaseDate;
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
});

const toUpdate = () => windowApi.toRegister(RELEASES_URL);

const close = () => {
  if (!show.value) return;
  show.value = false;
  setTimeout(() => {
    otherStore.toUpdate = false;
    otherStore.updateInfo = null;
  }, 420);
};

const handleKeydown = (event) => {
  if (event.key === 'Escape') close();
};

onMounted(() => {
  document.addEventListener('keydown', handleKeydown);
  nextTick(() => primaryAction.value?.focus());
});

onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown));
</script>

<template>
  <div class="update-page">
    <section
      class="update-panel"
      :class="{ 'update-panel-close': !show }"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-heading"
      aria-describedby="update-summary"
    >
      <div class="stage-grid" aria-hidden="true"></div>

      <header class="update-header">
        <div class="brand-lockup">
          <img src="../assets/icon/icon.ico" alt="" />
          <div>
            <strong>HYDROGEN MUSIC</strong>
            <span>APPLICATION UPDATE</span>
          </div>
        </div>
        <div class="status-lockup">
          <span class="status-dot" aria-hidden="true"></span>
          <span>NEW RELEASE DETECTED</span>
        </div>
      </header>

      <div class="update-layout">
        <aside class="signal-stage" aria-hidden="true">
          <span class="stage-index">UP / 01</span>
          <div class="uplink-mark">
            <span class="uplink-shaft"></span>
            <span class="uplink-head"></span>
          </div>
          <strong>UPDATE</strong>
          <span class="stage-caption">READY FOR TRANSFER</span>
        </aside>

        <main class="update-information">
          <div class="title-row">
            <div>
              <p class="eyebrow">VERSION INFORMATION</p>
              <h1 id="update-heading">发现新版本</h1>
            </div>
            <div class="version-badge" aria-label="新版本号">
              <span>VERSION</span>
              <strong>V{{ version }}</strong>
            </div>
          </div>

          <p id="update-summary" class="summary">
            Hydrogen Music 有新的可用版本。请先查看本次变化，再决定是否前往下载。
          </p>

          <section class="release-notes" aria-labelledby="release-notes-heading">
            <header class="notes-header">
              <div>
                <span>RELEASE NOTES</span>
                <h2 id="release-notes-heading">更新日志</h2>
              </div>
              <time v-if="releaseDate" :datetime="updateInfo.releaseDate">{{ releaseDate }}</time>
            </header>

            <div v-if="releaseGroups.length" class="notes-scroll" tabindex="0">
              <section v-for="(group, groupIndex) in releaseGroups" :key="`${group.version}-${groupIndex}`" class="notes-group">
                <h3 v-if="group.version">V{{ group.version }}</h3>
                <ul>
                  <li v-for="(note, noteIndex) in group.notes" :key="`${noteIndex}-${note}`">
                    {{ note }}
                  </li>
                </ul>
              </section>
            </div>
            <p v-else class="notes-empty">该版本暂未提供详细更新日志，可前往发布页面查看完整信息。</p>
          </section>

          <footer class="update-actions">
            <button ref="primaryAction" type="button" class="primary-action" autofocus @click="toUpdate">
              <span>查看并下载更新</span>
              <span aria-hidden="true">↗</span>
            </button>
            <button type="button" class="secondary-action" @click="close">稍后提醒</button>
          </footer>
        </main>
      </div>
    </section>
  </div>
</template>

<style scoped lang="scss">
.update-page {
  --ark-ink: #080a0b;
  --ark-paper: #f4f6f6;
  --ark-signal: #18d1ff;
  --ark-muted: rgba(244, 246, 246, 0.58);
  --ark-rule: rgba(244, 246, 246, 0.2);
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 32px;
  color: var(--ark-paper);
  background: rgba(8, 10, 11, 0.72);
}

.update-panel {
  position: relative;
  width: min(1120px, 100%);
  height: min(680px, calc(100vh - 64px));
  min-height: 460px;
  overflow: hidden;
  background: linear-gradient(112deg, rgba(255, 255, 255, 0.035), transparent 38%), var(--ark-ink);
  border-block: 1px solid rgba(244, 246, 246, 0.72);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.48);
  transform-origin: center;
  animation: panel-reveal 650ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.update-panel::before,
.update-panel::after {
  content: '';
  position: absolute;
  z-index: 3;
  width: 48px;
  height: 4px;
  background: var(--ark-signal);
}

.update-panel::before { top: -1px; left: 0; }
.update-panel::after { right: 0; bottom: -1px; }

.update-panel-close {
  pointer-events: none;
  animation: panel-close 420ms cubic-bezier(0.5, 0, 0.15, 1) forwards;
}

.stage-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.38;
  background-image:
    linear-gradient(rgba(244, 246, 246, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(244, 246, 246, 0.06) 1px, transparent 1px),
    url('../assets/img/halftone.png');
  background-size: 64px 64px, 64px 64px, 320px 320px;
  mask-image: linear-gradient(90deg, #000, rgba(0, 0, 0, 0.12) 66%, transparent);
}

.update-header {
  position: relative;
  z-index: 1;
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-inline: clamp(22px, 3vw, 40px);
  border-bottom: 1px solid var(--ark-rule);
}

.brand-lockup,
.status-lockup { display: flex; align-items: center; }
.brand-lockup img { width: 38px; height: 38px; margin-right: 12px; }
.brand-lockup div { display: grid; gap: 3px; text-align: left; }

.brand-lockup strong,
.brand-lockup span,
.status-lockup,
.eyebrow,
.version-badge span,
.notes-header span,
.stage-index,
.stage-caption {
  font-family: Bender-Bold, Consolas, monospace;
  letter-spacing: 0.12em;
}

.brand-lockup strong { font-size: 12px; }
.brand-lockup span,
.status-lockup { color: var(--ark-muted); font-size: 9px; }

.status-dot {
  width: 7px;
  height: 7px;
  margin-right: 9px;
  background: var(--ark-signal);
  box-shadow: 0 0 0 4px rgba(24, 209, 255, 0.12);
}

.update-layout {
  position: relative;
  z-index: 1;
  height: calc(100% - 72px);
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(440px, 1.45fr);
}

.signal-stage {
  position: relative;
  min-width: 0;
  overflow: hidden;
  padding: clamp(24px, 3vw, 42px);
  border-right: 1px solid var(--ark-rule);
}

.signal-stage::after {
  content: '';
  position: absolute;
  right: -1px;
  bottom: 68px;
  width: 28px;
  height: 1px;
  background: var(--ark-signal);
}

.stage-index,
.stage-caption { position: absolute; color: var(--ark-muted); font-size: 10px; }
.stage-index { top: 30px; left: 34px; }
.stage-caption { left: 34px; bottom: 30px; }

.signal-stage > strong {
  position: absolute;
  left: 25px;
  bottom: 62px;
  font: clamp(56px, 7vw, 100px) / 0.78 Bender-Bold, SourceHanSansCN-Heavy, sans-serif;
  letter-spacing: -0.07em;
  color: rgba(244, 246, 246, 0.08);
  transform: rotate(-90deg) translateY(100%);
  transform-origin: left bottom;
}

.uplink-mark {
  position: absolute;
  inset: 50% auto auto 50%;
  width: min(18vw, 180px);
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
}

.uplink-mark::before,
.uplink-mark::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 1px solid rgba(244, 246, 246, 0.16);
  border-radius: 50%;
}

.uplink-mark::after { inset: 20%; border-style: dashed; }

.uplink-shaft {
  position: absolute;
  left: calc(50% - 2px);
  top: 28%;
  width: 4px;
  height: 52%;
  background: var(--ark-paper);
}

.uplink-head {
  position: absolute;
  left: 50%;
  top: 20%;
  width: 36%;
  aspect-ratio: 1;
  border-top: 4px solid var(--ark-paper);
  border-left: 4px solid var(--ark-paper);
  transform: translateX(-50%) rotate(45deg);
}

.update-information {
  min-width: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 18px;
  padding: clamp(28px, 4vw, 52px);
}

.title-row { display: flex; align-items: end; justify-content: space-between; gap: 24px; }
.eyebrow { margin: 0 0 8px; color: var(--ark-signal); font-size: 10px; }
h1, h2, h3, p { margin-block: 0; }

h1 {
  font: clamp(36px, 4.5vw, 64px) / 0.92 SourceHanSansCN-Heavy, sans-serif;
  letter-spacing: -0.05em;
}

.version-badge {
  flex: 0 0 auto;
  min-width: 126px;
  padding: 10px 14px;
  color: var(--ark-ink);
  background: var(--ark-paper);
  text-align: left;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
}

.version-badge span { display: block; margin-bottom: 3px; font-size: 9px; }
.version-badge strong { font: 24px/1 Bender-Bold, Consolas, monospace; font-variant-numeric: tabular-nums; }
.summary { max-width: 580px; color: var(--ark-muted); font: 13px/1.65 SourceHanSansCN-Regular, sans-serif; }

.release-notes {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  border-top: 1px solid var(--ark-rule);
  border-bottom: 1px solid var(--ark-rule);
}

.notes-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  min-height: 60px;
  padding-block: 11px 10px;
}

.notes-header span { display: block; color: var(--ark-signal); font-size: 8px; }
.notes-header h2 { margin-top: 3px; font: 18px SourceHanSansCN-Bold, sans-serif; }
.notes-header time { color: var(--ark-muted); font: 10px Bender-Bold, Consolas, monospace; font-variant-numeric: tabular-nums; }

.notes-scroll {
  min-height: 0;
  overflow: auto;
  padding: 4px 18px 16px 0;
  scrollbar-width: thin;
  scrollbar-color: var(--ark-signal) rgba(244, 246, 246, 0.08);
}

.notes-scroll:focus-visible,
.primary-action:focus-visible,
.secondary-action:focus-visible { outline: 2px solid var(--ark-signal); outline-offset: 3px; }
.notes-group + .notes-group { margin-top: 18px; }
.notes-group h3 { margin-bottom: 8px; color: var(--ark-signal); font: 11px Bender-Bold, Consolas, monospace; }
.notes-group ul { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }

.notes-group li {
  position: relative;
  padding-left: 18px;
  color: rgba(244, 246, 246, 0.88);
  font: 13px/1.55 SourceHanSansCN-Regular, sans-serif;
  text-align: left;
  user-select: text;
}

.notes-group li::before {
  content: '';
  position: absolute;
  top: 0.65em;
  left: 1px;
  width: 7px;
  height: 2px;
  background: var(--ark-signal);
}

.notes-empty { align-self: start; padding: 8px 0 18px; color: var(--ark-muted); font: 13px/1.6 SourceHanSansCN-Regular, sans-serif; text-align: left; }
.update-actions { display: flex; align-items: center; gap: 12px; }

.update-actions button {
  min-height: 42px;
  padding: 0 18px;
  border-radius: 0;
  font: 13px SourceHanSansCN-Bold, sans-serif;
  cursor: pointer;
  transition: transform 180ms ease, background-color 180ms ease, color 180ms ease;
}

.update-actions button:hover { transform: translateY(-2px); }

.update-page .primary-action {
  min-width: 188px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  color: var(--ark-ink) !important;
  background: var(--ark-signal) !important;
  border: 1px solid var(--ark-signal) !important;
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
}

.update-page .secondary-action {
  color: var(--ark-paper) !important;
  background: transparent !important;
  border: 1px solid rgba(244, 246, 246, 0.5) !important;
}

.update-page .secondary-action:hover { color: var(--ark-ink) !important; background: var(--ark-paper) !important; }

@keyframes panel-reveal {
  from { opacity: 0; transform: translateY(12px) scaleY(0.02); }
  to { opacity: 1; transform: none; }
}

@keyframes panel-close { to { opacity: 0; transform: scaleY(0.02); } }

@media (max-width: 760px), (orientation: portrait) {
  .update-page { padding: 16px; }
  .update-panel { height: calc(100vh - 32px); min-height: 0; }
  .update-header { height: 60px; }
  .status-lockup { display: none; }
  .update-layout { height: calc(100% - 60px); grid-template-columns: 1fr; grid-template-rows: 72px minmax(0, 1fr); }
  .signal-stage { border-right: 0; border-bottom: 1px solid var(--ark-rule); padding: 0 22px; }
  .signal-stage > strong, .uplink-mark, .stage-caption { display: none; }
  .stage-index { top: 50%; left: 22px; transform: translateY(-50%); }
  .signal-stage::before { content: 'UPDATE CHANNEL'; position: absolute; top: 50%; right: 22px; color: rgba(244, 246, 246, 0.26); font: 22px Bender-Bold, Consolas, monospace; transform: translateY(-50%); }
  .update-information { gap: 14px; padding: 22px; }
  .title-row { align-items: start; }
  h1 { font-size: clamp(32px, 9vw, 46px); }
  .version-badge { min-width: 104px; }
  .summary { display: none; }
}

@media (max-width: 480px) {
  .brand-lockup img { width: 32px; height: 32px; }
  .version-badge { min-width: 90px; padding: 9px 10px; }
  .version-badge strong { font-size: 19px; }
  .update-actions { align-items: stretch; flex-direction: column; }
  .update-actions button { width: 100%; }
}

@media (max-height: 560px) and (orientation: landscape) {
  .update-page { padding: 14px; }
  .update-panel { height: calc(100vh - 28px); min-height: 0; }
  .update-header { height: 56px; }
  .update-layout { height: calc(100% - 56px); }
  .update-information { gap: 10px; padding-block: 20px; }
  .summary { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .update-panel, .update-panel-close { animation-duration: 1ms; }
  .update-actions button { transition: none; }
  .update-actions button:hover { transform: none; }
}
</style>
