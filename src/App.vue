<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, watch } from 'vue';
import Home from './views/Home.vue';
import Title from './components/Title.vue';
import SearchInput from './components/SearchInput.vue';
import AudioVisualizer from './components/AudioVisualizer.vue';
import WindowControl from './components/WindowControl.vue';
import MusicWidget from './components/MusicWidget.vue';
import { destroyDesktopLyric, initDesktopLyric } from './utils/desktopLyric';
import { destroyLyricRuntime, initLyricRuntime } from './composables/usePlayerRuntime';

import { usePlayerStore } from './store/playerStore';
import { useOtherStore } from './store/otherStore';
import { useUserStore } from './store/userStore';
import { useSirenStore } from './store/sirenStore';
import { applyCustomTheme, applyDynamicTheme, clearDynamicTheme } from './utils/dynamicTheme';
import { resolveImageUrl } from './utils/imageUtils';

const MusicPlayer = defineAsyncComponent(() => import('./views/MusicPlayer.vue'));
const VideoPlayer = defineAsyncComponent(() => import('./components/VideoPlayer.vue'));
const ContextMenu = defineAsyncComponent(() => import('./components/ContextMenu.vue'));
const GlobalDialog = defineAsyncComponent(() => import('./components/GlobalDialog.vue'));
const GlobalNotice = defineAsyncComponent(() => import('./components/GlobalNotice.vue'));
const Update = defineAsyncComponent(() => import('./components/Update.vue'));

const playerStore = usePlayerStore();
const otherStore = useOtherStore();
const userStore = useUserStore();
const sirenStore = useSirenStore();
let removeShutdownAnimationListener = null;
let shutdownAppElement = null;
let shutdownStarted = false;
let shutdownCompleted = false;

const completeShutdownAnimation = () => {
    if (shutdownCompleted) return;
    shutdownCompleted = true;
    windowApi.completeShutdownAnimation?.();
};

const handleShutdownAnimationEnd = (event) => {
    if (event.target !== shutdownAppElement) return;
    if (!['crt-window-collapse', 'crt-window-fade'].includes(event.animationName)) return;
    completeShutdownAnimation();
};

const startShutdownAnimation = () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    shutdownAppElement = document.getElementById('app');
    if (!shutdownAppElement) {
        completeShutdownAnimation();
        return;
    }

    shutdownAppElement.addEventListener('animationend', handleShutdownAnimationEnd);
    document.body.classList.add('crt-shutdown-active');
};

const visualizerActive = computed(() => {
    return playerStore.audioVisualizer && playerStore.playerShow && !playerStore.widgetState && !!playerStore.currentMusic;
});
const currentCoverUrl = computed(() => {
    const song = playerStore.songList?.[playerStore.currentIndex];
    if (!song) return '';
    if (song.type === 'local') return playerStore.localBase64Img || '';

    const url = song.coverUrl || song.al?.picUrl || song.blurPicUrl || song.img1v1Url;
    return url ? resolveImageUrl(url) : '';
});

watch([() => playerStore.dynamicTheme, () => playerStore.customThemeColor, currentCoverUrl], ([enabled, customColor, coverUrl]) => {
    if (customColor) applyCustomTheme(customColor);
    else if (enabled && coverUrl) applyDynamicTheme(coverUrl);
    else clearDynamicTheme();
}, { immediate: true });

onMounted(() => {
    removeShutdownAnimationListener = windowApi.onShutdownAnimation?.(startShutdownAnimation) || null;
    initLyricRuntime();
    initDesktopLyric();

    // 塞壬唱片开启时，空闲预加载所有专辑歌曲时长
    if (userStore.sirenPage) {
        const startPreload = () => sirenStore.preloadAllDurations()
        if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(startPreload, { timeout: 10000 })
        } else {
            setTimeout(startPreload, 5000)
        }
    }
});

onUnmounted(() => {
    removeShutdownAnimationListener?.();
    removeShutdownAnimationListener = null;
    shutdownAppElement?.removeEventListener('animationend', handleShutdownAnimationEnd);
    shutdownAppElement = null;
    document.body.classList.remove('crt-shutdown-active');
    clearDynamicTheme();
    destroyDesktopLyric();
    destroyLyricRuntime();
});

windowApi.checkUpdate((event, version) => {
    otherStore.toUpdate = true;
    otherStore.newVersion = version;
});

// 双击标题栏最大化窗口的处理函数
const handleTitleBarDoubleClick = () => {
    windowApi.windowMax('window-max');
};
</script>

<template>
    <div class="mainWindow">
        <Transition name="home">
            <Home class="home" v-show="playerStore.widgetState"></Home>
        </Transition>
    </div>
    <div class="globalWidget" :class="{ 'visualizer-active': visualizerActive }">
        <Title class="widget-title"></Title>
        <AudioVisualizer class="widget-visualizer"></AudioVisualizer>
        <div class="widget-search">
            <SearchInput></SearchInput>
        </div>
    </div>
    <div class="dragBar" @dblclick="handleTitleBarDoubleClick">
        <WindowControl></WindowControl>
    </div>
    <Transition name="widget">
        <div class="musicWidget" v-if="playerStore.songList" v-show="playerStore.widgetState">
            <MusicWidget></MusicWidget>
        </div>
    </Transition>
    <Transition name="player">
        <div class="musicPlayer" v-if="playerStore.songList" v-show="!playerStore.widgetState">
            <MusicPlayer></MusicPlayer>
        </div>
    </Transition>
    <Transition name="video">
        <div class="videoPlayer" v-if="otherStore.videoPlayerShow">
            <VideoPlayer></VideoPlayer>
        </div>
    </Transition>
    <div class="contextMune">
        <ContextMenu></ContextMenu>
    </div>
    <div class="globalDialog">
        <GlobalDialog></GlobalDialog>
    </div>
    <div class="globalNotice">
        <GlobalNotice v-if="otherStore.noticeShow"></GlobalNotice>
    </div>
    <Transition name="fade">
        <div class="update" v-if="otherStore.toUpdate">
            <Update></Update>
        </div>
    </Transition>
</template>

<style lang="scss">
#app {
    user-select: none;
    margin: 0;
    padding: 0;
    max-width: 100%;
    position: fixed;
    left: 0;
    right: 0;
    top: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
}

body.crt-shutdown-active {
    overflow: hidden;
    background: transparent !important;
    cursor: none;
}

body.crt-shutdown-active #app {
    transform-origin: 50% 50%;
    background: transparent !important;
    -webkit-mask-image: repeating-linear-gradient(
        to bottom,
        #000 0,
        #000 2px,
        rgba(0, 0, 0, 0.82) 2px,
        rgba(0, 0, 0, 0.82) 3px
    );
    mask-image: repeating-linear-gradient(
        to bottom,
        #000 0,
        #000 2px,
        rgba(0, 0, 0, 0.82) 2px,
        rgba(0, 0, 0, 0.82) 3px
    );
    animation: crt-window-collapse 1000ms linear both;
    will-change: transform, filter, opacity;
}

body.crt-shutdown-active::before,
body.crt-shutdown-active::after {
    content: '';
    position: fixed;
    z-index: 2147483647;
    pointer-events: none;
}

body.crt-shutdown-active::before {
    top: 50%;
    left: 50%;
    width: calc(100vw - 2px);
    height: 1px;
    opacity: 0;
    background: linear-gradient(
        to right,
        transparent 0,
        rgba(255, 255, 255, 0.72) 3%,
        #fff 12%,
        #fff 88%,
        rgba(255, 255, 255, 0.72) 97%,
        transparent 100%
    );
    box-shadow:
        0 -1px 1px rgba(145, 223, 255, 0.7),
        0 1px 1px rgba(255, 188, 190, 0.4),
        0 0 4px 1px #fff,
        0 0 12px 3px rgba(213, 247, 255, 0.95),
        0 0 34px 9px rgba(126, 211, 225, 0.58);
    transform: translate3d(-50%, -50%, 0) scaleX(1) scaleY(0.2);
    transform-origin: center;
    will-change: transform, opacity, filter;
    animation: crt-beam-collapse 1000ms linear both;
}

body.crt-shutdown-active::after {
    top: 50%;
    left: 50%;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    opacity: 0;
    background: #fff;
    box-shadow:
        0 0 3px 2px #fff,
        0 0 13px 6px rgba(220, 249, 255, 0.95),
        0 0 34px 12px rgba(118, 207, 222, 0.62);
    transform: translate3d(-50%, -50%, 0) scale(0.15);
    will-change: transform, opacity;
    animation: crt-dot-afterglow 1000ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes crt-window-collapse {
    0% {
        transform: translate3d(0, 0, 0) scaleY(1);
        filter: brightness(1) contrast(1) saturate(1);
        opacity: 1;
    }
    4% {
        transform: translate3d(0, -0.5px, 0) scaleY(0.998);
        filter: brightness(1.16) contrast(1.08) saturate(0.9);
    }
    8% {
        transform: translate3d(0, 0.6px, 0) scaleY(0.992);
        filter: brightness(0.8) contrast(1.22) saturate(0.78);
    }
    12% {
        transform: translate3d(0, -0.25px, 0) scaleY(0.985);
        filter: brightness(1.3) contrast(1.12) saturate(0.7);
    }
    16% {
        transform: translate3d(0, 0, 0) scaleY(0.96);
        filter: brightness(1.08) contrast(1.15) saturate(0.62);
    }
    24% {
        transform: translate3d(0, 0, 0) scaleY(0.66);
        filter: brightness(1.28) contrast(1.22) saturate(0.46);
    }
    31% {
        transform: translate3d(0, 0, 0) scaleY(0.18);
        filter: brightness(1.9) contrast(1.34) saturate(0.25);
    }
    36% {
        transform: translate3d(0, 0, 0) scaleY(0.006);
        filter: brightness(4) contrast(1.5) saturate(0);
        opacity: 1;
    }
    40%,
    100% {
        transform: translate3d(0, 0, 0) scaleY(0.002);
        filter: brightness(5) contrast(1.5) saturate(0);
        opacity: 0;
    }
}

@keyframes crt-beam-collapse {
    0%,
    29% {
        opacity: 0;
        transform: translate3d(-50%, -50%, 0) scaleX(1) scaleY(0.2);
        filter: brightness(1);
    }
    33% {
        opacity: 0.35;
        transform: translate3d(-50%, -50%, 0) scaleX(1) scaleY(0.5);
        filter: brightness(1.5);
    }
    36% {
        opacity: 1;
        transform: translate3d(-50%, -50%, 0) scaleX(1) scaleY(1);
        filter: brightness(2.4);
    }
    43% {
        opacity: 1;
        transform: translate3d(-50%, -50%, 0) scaleX(1) scaleY(1.25);
        filter: brightness(3.2);
    }
    52% {
        opacity: 0.96;
        transform: translate3d(-50%, -50%, 0) scaleX(1) scaleY(0.9);
        filter: brightness(2.2);
    }
    60% {
        opacity: 0.94;
        transform: translate3d(-50%, -50%, 0) scaleX(0.72) scaleY(0.82);
        filter: brightness(2.5);
    }
    70% {
        opacity: 0.9;
        transform: translate3d(-50%, -50%, 0) scaleX(0.22) scaleY(0.72);
        filter: brightness(3);
    }
    77% {
        opacity: 0.86;
        transform: translate3d(-50%, -50%, 0) scaleX(0.008) scaleY(0.68);
        filter: brightness(3.4);
    }
    80%,
    100% {
        opacity: 0;
        transform: translate3d(-50%, -50%, 0) scaleX(0.002) scaleY(0.5);
        filter: brightness(1);
    }
}

@keyframes crt-dot-afterglow {
    0%,
    72% {
        opacity: 0;
        transform: translate3d(-50%, -50%, 0) scale(0.15);
    }
    76% {
        opacity: 1;
        transform: translate3d(-50%, -50%, 0) scale(1.35);
    }
    82% {
        opacity: 1;
        transform: translate3d(-50%, -50%, 0) scale(0.9);
    }
    90% {
        opacity: 0.5;
        transform: translate3d(-50%, -50%, 0) scale(0.45);
    }
    100% {
        opacity: 0;
        transform: translate3d(-50%, -50%, 0) scale(0.08);
    }
}

@keyframes crt-window-fade {
    from { opacity: 1; }
    to { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
    body.crt-shutdown-active #app {
        -webkit-mask-image: none;
        mask-image: none;
        animation: crt-window-fade 150ms ease-out both;
        filter: none;
    }

    body.crt-shutdown-active::before,
    body.crt-shutdown-active::after {
        display: none;
    }
}

.mainWindow {
    width: 100%;
    height: 100%;
    background: linear-gradient(rgba(176, 209, 217, 0.9) -20%, rgba(176, 209, 217, 0.4) 50%, rgba(176, 209, 217, 0.9) 120%);
    opacity: 0;
    animation: mainWindows-starting 0.8s cubic-bezier(0.14, 0.91, 0.58, 1) forwards;
    @keyframes mainWindows-starting {
        0% {
            background-color: rgba(222, 235, 239, 1);
            opacity: 0;
            transform: scale(1.3);
        }
        100% {
            background-color: rgb(255, 255, 255);
            opacity: 1;
            transform: scale(1);
        }
    }
    .home {
        height: calc(100% - 78px);
    }
}
.globalWidget {
    --visualizer-width: clamp(260px, 28vw, 340px);
    --visualizer-gap: 24px;
    --visualizer-shift: calc(var(--visualizer-width) + var(--visualizer-gap));

    display: flex;
    flex-direction: row;
    align-items: center;
    position: absolute;
    top: 22px;
    z-index: 999;
    left: 45px; // 所有平台保持统一的布局位置
    pointer-events: none;

    .widget-title {
        pointer-events: auto;

        &:hover {
            cursor: pointer;
        }
    }
    .widget-search {
        margin-left: 30px;
        transform: translate3d(calc(-1 * var(--visualizer-shift)), 0, 0);
        transition: transform 0.72s cubic-bezier(0.16, 1, 0.3, 1);
        will-change: transform;
        pointer-events: auto;
    }
    .widget-visualizer {
        flex-shrink: 0;
    }
    &.visualizer-active {
        .widget-search {
            transform: translate3d(0, 0, 0);
        }
    }
}
.dragBar {
    width: 100%;
    height: 35px;
    background: transparent;
    position: fixed;
    top: 0;
    z-index: 999;
    -webkit-app-region: drag;
    .window-control {
        position: fixed;
        top: 13px;
        -webkit-app-region: no-drag;
        z-index: 999;

        // macOS 按钮在左侧
        &.macos {
            left: 15px;
            top: 11px; // 稍微调整高度使其更居中
        }

        // Windows/Linux 按钮在右侧
        &.windows {
            right: 15px;
        }
    }
}
.musicWidget {
    width: 680px;
    height: 65px;
    position: fixed;
    left: 50%;
    bottom: 35px;
    transform: translate3d(-50%, 0, 0);
    box-shadow: 0 0 15px 2px rgba(189, 189, 189, 0.1);
}
.musicPlayer {
    width: 100%;
    height: 100%;
    position: absolute;
    top: 0;
    left: 0;
}
.videoPlayer {
    width: 100%;
    height: 100%;
    position: fixed;
    pointer-events: none;
    z-index: 999;
}
.globalNotice {
    bottom: 120px;
    position: fixed;
    z-index: 999;
}
.update {
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.1);
    position: fixed;
    z-index: 999;
}

.home-enter-active,
.home-leave-active {
    transition: transform 0.4s cubic-bezier(0.14, 0.91, 0.58, 1), opacity 0.4s cubic-bezier(0.14, 0.91, 0.58, 1);
    will-change: transform, opacity;
}

.home-enter-from,
.home-leave-to {
    transform: scale(0.9);
    opacity: 0;
}

.widget-enter-active,
.widget-leave-active {
    transition: transform 0.5s cubic-bezier(0.14, 0.91, 0.58, 1);
    will-change: transform;
}

.widget-enter-from,
.widget-leave-to {
    transform: translate3d(-50%, 105px, 0);
}

.player-enter-active,
.player-leave-active {
    transition: transform 0.5s cubic-bezier(0.14, 0.91, 0.58, 1);
    will-change: transform;
}

.player-enter-from,
.player-leave-to {
    transform: translateY(100%);
}
.video-enter-active,
.video-leave-active {
    transition: transform 0.1s, opacity 0.1s;
    will-change: transform, opacity;
}

.video-enter-from,
.video-leave-to {
    transform: scale(0.8);
    opacity: 0;
}
.fade-enter-active {
    transition: opacity 0.4s;
    will-change: opacity;
}
.fade-leave-active {
    transition: opacity 0.3s;
    will-change: opacity;
}

.fade-enter-from,
.fade-leave-to {
    opacity: 0;
}
</style>
