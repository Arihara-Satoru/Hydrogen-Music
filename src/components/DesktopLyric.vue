<template>
    <div
        class="endfield-lyric"
        data-ark-theme="endfield"
        data-ark-depth="maximal"
        :class="rootClasses"
        :style="rootStyle"
        role="region"
        aria-label="桌面歌词"
        @contextmenu.prevent.stop="openControlDock"
    >
        <div class="field-shell">
            <aside
                class="field-rail drag-zone"
                :class="{ 'native-drag': nativeDragEnabled }"
                aria-label="歌词窗口状态"
                @mousedown="onDragStart"
            >
                <div class="rail-brand" aria-label="Hydrogen Music Lyrics">
                    <strong aria-hidden="true">H<sub>2</sub></strong>
                    <span>LYRIC</span>
                </div>

                <div class="rail-index" aria-hidden="true">{{ formattedLineNumber }}</div>
                <p class="rail-count" :aria-label="`第 ${currentLineNumber} 行，共 ${lyricsArray.length} 行`">
                    <span>LINE</span>
                    {{ formattedTotalLines }}
                </p>

                <div class="rail-status" :aria-label="playing ? '正在播放' : '已暂停'">
                    <span class="rail-status__mark" aria-hidden="true"></span>
                    <span>{{ playing ? '播放中' : '已暂停' }}</span>
                </div>

                <p class="rail-position">{{ locked ? 'POSITION LOCKED' : 'DRAG SURFACE' }}</p>
            </aside>

            <header class="field-header">
                <div
                    class="header-drag drag-zone"
                    :class="{ 'native-drag': nativeDragEnabled }"
                    @mousedown="onDragStart"
                >
                    <div class="header-kicker">
                        <span>NOW PLAYING / 当前音轨</span>
                        <span>{{ activeLyricType.code }}</span>
                    </div>
                    <div class="track-lockup">
                        <h1 :title="trackTitle">{{ trackTitle }}</h1>
                        <p :title="artistNames">{{ artistNames }}</p>
                    </div>
                </div>

                <div class="header-actions" @mousedown.stop>
                    <button
                        type="button"
                        class="header-action"
                        :class="{ 'is-active': locked }"
                        :aria-label="locked ? '解锁歌词窗口位置' : '锁定歌词窗口位置'"
                        :aria-pressed="locked"
                        @pointerdown.stop
                        @click="toggleLock"
                    >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path
                                v-if="locked"
                                d="M7 10V7a5 5 0 0 1 10 0v3M6 10h12v10H6z"
                            />
                            <path
                                v-else
                                d="M17 10V7a5 5 0 0 0-9.5-2M6 10h12v10H6z"
                            />
                        </svg>
                        <span class="action-label">{{ locked ? '解锁' : '锁定' }}</span>
                    </button>

                    <button
                        id="lyric-settings-trigger"
                        ref="settingsButtonRef"
                        type="button"
                        class="header-action"
                        :class="{ 'is-active': controlDockVisible }"
                        aria-label="打开桌面歌词设置"
                        aria-controls="lyric-control-dock"
                        :aria-expanded="controlDockVisible"
                        @pointerdown.stop
                        @click="toggleControlDock"
                    >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M7 14v6" />
                        </svg>
                        <span class="action-label">设置</span>
                    </button>
                </div>
            </header>

            <main
                class="lyric-stage"
                :class="{ 'native-drag': nativeDragEnabled && (compactMode || transparentMode) }"
                @mousedown="onCompactDragStart"
            >
                <div class="stage-guides" aria-hidden="true"></div>

                <div class="lyric-stack">
                    <Transition name="line-wipe" mode="out-in">
                        <article
                            :key="lineKey"
                            class="current-line"
                            aria-live="polite"
                            aria-atomic="true"
                        >
                            <div class="current-line__header">
                                <span>CURRENT LINE / 当前歌词</span>
                                <span>{{ lineProgressRounded }}%</span>
                            </div>
                            <p class="current-line__text" :data-text="currentLyricText">
                                {{ currentLyricText }}
                            </p>
                            <div
                                class="line-meter"
                                role="progressbar"
                                aria-label="当前句播放进度"
                                aria-valuemin="0"
                                aria-valuemax="100"
                                :aria-valuenow="lineProgressRounded"
                            >
                                <span></span>
                            </div>
                        </article>
                    </Transition>

                    <Transition name="next-shift" mode="out-in">
                        <section v-if="nextLyricText" :key="`next-${lineKey}`" class="next-line">
                            <span class="next-line__label">NEXT / 下一句</span>
                            <p>{{ nextLyricText }}</p>
                        </section>
                    </Transition>
                </div>
            </main>

            <aside class="media-field" :class="{ 'has-media': coverUrl }" aria-label="当前音轨封面">
                <Transition name="cover-wipe" mode="out-in">
                    <img
                        v-if="coverUrl"
                        :key="coverUrl"
                        :src="coverUrl"
                        :alt="`《${trackTitle}》封面`"
                        @error="coverFailed = true"
                    />
                    <div v-else key="fallback" class="media-fallback" aria-hidden="true">
                        <strong>FIELD</strong>
                        <span>NO COVER</span>
                    </div>
                </Transition>
                <div class="media-segments" aria-hidden="true"></div>
                <nav
                    v-if="!locked && !compactMode && currentSong"
                    class="media-controls"
                    aria-label="歌曲播放控制"
                    @pointerdown.stop
                    @mousedown.stop
                >
                    <button type="button" aria-label="上一首" title="上一首" @click="controlPlayback('previous')">
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M6 5v14M18 6l-9 6 9 6z" />
                        </svg>
                    </button>
                    <button
                        type="button"
                        class="media-control--primary"
                        :aria-label="playing ? '暂停' : '播放'"
                        :title="playing ? '暂停' : '播放'"
                        @click="controlPlayback('playpause')"
                    >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path v-if="playing" d="M7 5h4v14H7zM13 5h4v14h-4z" />
                            <path v-else d="m8 5 11 7-11 7z" />
                        </svg>
                    </button>
                    <button type="button" aria-label="下一首" title="下一首" @click="controlPlayback('next')">
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M18 5v14M6 6l9 6-9 6z" />
                        </svg>
                    </button>
                </nav>
                <div class="media-caption">
                    <span>COVER FIELD</span>
                    <strong>{{ trackOrigin }}</strong>
                </div>
            </aside>

            <footer class="timeline-dock">
                <div class="time-readout">
                    <span>ELAPSED</span>
                    <strong>{{ formattedCurrentTime }}</strong>
                </div>
                <div class="track-meter">
                    <span class="track-meter__fill"></span>
                    <span class="track-meter__cursor" aria-hidden="true"></span>
                    <input
                        class="track-meter__input"
                        type="range"
                        min="0"
                        :max="duration"
                        step="0.1"
                        :value="displayedCurrentTime"
                        :disabled="locked || duration <= 0"
                        aria-label="歌曲播放进度"
                        :aria-valuetext="timelineValueText"
                        @pointerdown.stop
                        @input="previewTimelineSeek"
                        @change="commitTimelineSeek"
                    />
                </div>
                <div class="time-readout time-readout--end">
                    <span>DURATION</span>
                    <strong>{{ formattedDuration }}</strong>
                </div>
            </footer>
        </div>

        <Transition name="dock-reveal">
            <section
                v-if="controlDockVisible"
                id="lyric-control-dock"
                ref="controlDockRef"
                class="control-dock"
                role="dialog"
                aria-modal="false"
                aria-labelledby="lyric-control-title"
                @pointerdown.stop
                @click.stop
            >
                <header class="control-dock__header">
                    <div>
                        <p>LYRIC CONTROL</p>
                        <h2 id="lyric-control-title">桌面歌词设置</h2>
                    </div>
                    <button type="button" class="panel-close" aria-label="关闭歌词设置" @click="hideControlDock(true)">
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="m6 6 12 12M18 6 6 18" />
                        </svg>
                    </button>
                </header>

                <fieldset class="control-group">
                    <legend>
                        歌词来源
                        <span>SOURCE</span>
                    </legend>
                    <div class="source-options">
                        <label
                            v-for="option in availableLyricTypes"
                            :key="option.value"
                            class="source-option"
                        >
                            <input v-model="selectedLyricType" type="radio" name="lyric-source" :value="option.value" />
                            <span class="source-option__glyph" aria-hidden="true">{{ option.glyph }}</span>
                            <span class="source-option__label">
                                <strong>{{ option.label }}</strong>
                                <small>{{ option.code }}</small>
                            </span>
                            <span class="source-option__check" aria-hidden="true"></span>
                        </label>
                    </div>
                </fieldset>

                <fieldset class="control-group">
                    <legend>
                        显示模式
                        <span>VIEW MODE</span>
                    </legend>
                    <label class="mode-option">
                        <span class="mode-option__label">
                            <strong>精简模式</strong>
                            <small>仅显示当前歌词与下一句</small>
                        </span>
                        <input
                            v-model="compactMode"
                            type="checkbox"
                            role="switch"
                            :aria-checked="compactMode"
                            @change="handleViewModeChange('compact')"
                        />
                        <span class="mode-switch" aria-hidden="true">
                            <span></span>
                        </span>
                    </label>
                    <label class="mode-option">
                        <span class="mode-option__label">
                            <strong>透明模式</strong>
                            <small>隐藏面板背景，仅保留悬浮歌词</small>
                        </span>
                        <input
                            v-model="transparentMode"
                            type="checkbox"
                            role="switch"
                            :aria-checked="transparentMode"
                            @change="handleViewModeChange('transparent')"
                        />
                        <span class="mode-switch" aria-hidden="true">
                            <span></span>
                        </span>
                    </label>
                </fieldset>

                <fieldset class="control-group">
                    <legend>
                        字体尺寸
                        <span>TYPE SCALE</span>
                    </legend>
                    <div class="font-stepper">
                        <button type="button" aria-label="减小歌词字体" @click="adjustFontSize(-2)">−</button>
                        <output aria-live="polite">{{ lyricFontSize }} px</output>
                        <button type="button" aria-label="增大歌词字体" @click="adjustFontSize(2)">＋</button>
                    </div>
                </fieldset>

                <div class="dock-actions">
                    <button type="button" class="dock-action" @click="toggleLock">
                        <span aria-hidden="true">{{ locked ? '↗' : '⌖' }}</span>
                        <span>
                            <strong>{{ locked ? '解锁位置' : '锁定位置' }}</strong>
                            <small>{{ locked ? 'UNLOCK POSITION' : 'LOCK POSITION' }}</small>
                        </span>
                    </button>
                    <button type="button" class="dock-action dock-action--danger" @click="closeLyric">
                        <span aria-hidden="true">×</span>
                        <span>
                            <strong>关闭桌面歌词</strong>
                            <small>CLOSE LYRIC</small>
                        </span>
                    </button>
                </div>
            </section>
        </Transition>
    </div>
</template>

<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { getSongDisplayName } from '../utils/songName';
import { calculateLyricLineProgress, clampPercentage } from '../utils/desktopLyricTiming.mjs';

const LYRIC_TYPE_OPTIONS = Object.freeze([
    { value: 'auto', label: '自动选择', code: 'AUTO SELECT', glyph: 'A' },
    { value: 'original', label: '原文', code: 'ORIGINAL', glyph: '原' },
    { value: 'trans', label: '翻译', code: 'TRANSLATION', glyph: '译' },
    { value: 'roma', label: '罗马音', code: 'ROMANIZATION', glyph: 'R' },
]);

const WINDOW_LIMITS = Object.freeze({
    expanded: { minWidth: 520, minHeight: 280, maxWidth: 1200, maxHeight: 640 },
    compact: { targetWidth: 500, targetHeight: 220 },
    free: { minWidth: 0, minHeight: 0, maxWidth: 0, maxHeight: 0 },
});

const DESKTOP_LYRIC_CONFIG_KEY = 'hydrogen:desktop-lyric-config:v1';

const normalizeSavedBounds = value => {
    const bounds = ['x', 'y', 'width', 'height'].reduce((result, key) => {
        result[key] = Number(value?.[key]);
        return result;
    }, {});
    return Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0
        ? bounds
        : null;
};

const loadDesktopLyricConfig = () => {
    try {
        const value = JSON.parse(localStorage.getItem(DESKTOP_LYRIC_CONFIG_KEY) || '{}');
        const lyricType = LYRIC_TYPE_OPTIONS.some(option => option.value === value.selectedLyricType)
            ? value.selectedLyricType
            : 'auto';
        const fontSize = Number(value.lyricFontSize);
        return {
            locked: value.locked === true,
            lyricFontSize: Number.isFinite(fontSize) ? Math.max(18, Math.min(52, fontSize)) : 28,
            selectedLyricType: lyricType,
            compactMode: value.compactMode === true,
            transparentMode: value.transparentMode === true,
            bounds: normalizeSavedBounds(value.bounds),
        };
    } catch (_) {
        return {};
    }
};

const savedConfig = loadDesktopLyricConfig();

const currentSong = ref(null);
const lyricsArray = ref([]);
const currentLyricIndex = ref(-1);
const trackProgress = ref(0);
const currentTime = ref(0);
const duration = ref(0);
const playing = ref(false);
const locked = ref(savedConfig.locked ?? false);
const seekPreviewTime = ref(null);
const lyricFontSize = ref(savedConfig.lyricFontSize ?? 28);
const selectedLyricType = ref(savedConfig.selectedLyricType ?? 'auto');
const compactMode = ref(savedConfig.compactMode ?? false);
const transparentMode = ref(savedConfig.transparentMode ?? false);
const coverFailed = ref(false);
const controlDockVisible = ref(false);
const isClosing = ref(false);
const settingsButtonRef = ref(null);
const controlDockRef = ref(null);

const platform = window.process?.platform || '';
const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
const isMac = platform === 'darwin' || /Macintosh|Mac OS X|MacOS|Darwin/i.test(userAgent);
const isWinOrLinux =
    platform === 'win32' ||
    platform === 'linux' ||
    (!isMac && /(Windows|Linux|X11|Wayland)/i.test(userAgent));

const isDragging = ref(false);
const dragStartScreen = ref({ x: 0, y: 0 });
const dragStartSize = ref({ width: 0, height: 0 });
const dragCurrentPosition = ref({ x: 0, y: 0 });
const originalMinMax = ref(null);

let removeLyricListener = null;
let closingTimer = null;
let expandedWindowSize = null;
let mouseEventsIgnored = false;
let savedWindowBounds = savedConfig.bounds || null;
let boundsSaveTimer = null;

const persistDesktopLyricConfig = bounds => {
    const normalizedBounds = normalizeSavedBounds(bounds);
    if (normalizedBounds) savedWindowBounds = normalizedBounds;
    try {
        localStorage.setItem(
            DESKTOP_LYRIC_CONFIG_KEY,
            JSON.stringify({
                locked: locked.value,
                lyricFontSize: lyricFontSize.value,
                selectedLyricType: selectedLyricType.value,
                compactMode: compactMode.value,
                transparentMode: transparentMode.value,
                bounds: savedWindowBounds,
            }),
        );
    } catch (_) {}
};

watch(
    [locked, lyricFontSize, selectedLyricType, compactMode, transparentMode],
    () => persistDesktopLyricConfig(),
    { flush: 'sync' },
);

const qaEnabled =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('qa') === 'desktop-lyric';

const hasLyricType = type => {
    if (!Array.isArray(lyricsArray.value) || lyricsArray.value.length === 0) return false;
    const field = type === 'original' ? 'lyric' : type === 'trans' ? 'tlyric' : 'rlyric';
    return lyricsArray.value.some(row => String(row?.[field] || '').trim());
};

const availableLyricTypes = computed(() =>
    LYRIC_TYPE_OPTIONS.filter(option => option.value === 'auto' || hasLyricType(option.value)),
);

const activeLyricType = computed(
    () => LYRIC_TYPE_OPTIONS.find(option => option.value === selectedLyricType.value) || LYRIC_TYPE_OPTIONS[0],
);

const displayedLyricIndex = computed(() => {
    if (!lyricsArray.value.length) return -1;
    if (currentLyricIndex.value >= 0 && currentLyricIndex.value < lyricsArray.value.length) {
        return currentLyricIndex.value;
    }
    return 0;
});

const formatLyricText = row => {
    if (!row) return '—';
    const original = String(row.lyric || '').trim();
    const translation = String(row.tlyric || '').trim();
    const romanization = String(row.rlyric || '').trim();

    if (selectedLyricType.value === 'original') return original || translation || romanization || '—';
    if (selectedLyricType.value === 'trans') return translation || original || romanization || '—';
    if (selectedLyricType.value === 'roma') return romanization || original || translation || '—';
    return translation || original || romanization || '—';
};

const currentLyricText = computed(() => {
    if (!currentSong.value) return '等待播放';
    if (!lyricsArray.value.length) return '当前歌曲暂无歌词';
    return formatLyricText(lyricsArray.value[displayedLyricIndex.value]);
});

const nextLyricText = computed(() => {
    const nextIndex = displayedLyricIndex.value + 1;
    if (nextIndex <= 0 || nextIndex >= lyricsArray.value.length) return '';
    return formatLyricText(lyricsArray.value[nextIndex]);
});

const trackTitle = computed(() => getSongDisplayName(currentSong.value, 'HYDROGEN MUSIC') || 'HYDROGEN MUSIC');

const artistNames = computed(() => {
    const artists = currentSong.value?.ar;
    if (!Array.isArray(artists)) return '等待音轨';
    const names = artists
        .map(artist => (typeof artist === 'string' ? artist : artist?.name))
        .filter(Boolean);
    return names.join(' / ') || '未知艺术家';
});

const trackOrigin = computed(() => {
    const type = String(currentSong.value?.type || '').toLowerCase();
    if (type === 'local') return 'LOCAL FILE';
    if (type === 'radio' || type === 'dj') return 'RADIO';
    return currentSong.value ? 'ONLINE STREAM' : 'STANDBY';
});

const coverUrl = computed(() => {
    const value = currentSong.value?.coverUrl;
    return !coverFailed.value && typeof value === 'string' ? value.trim() : '';
});

const currentLineNumber = computed(() => (displayedLyricIndex.value >= 0 ? displayedLyricIndex.value + 1 : 0));
const formattedLineNumber = computed(() => String(currentLineNumber.value).padStart(2, '0'));
const formattedTotalLines = computed(() => String(lyricsArray.value.length).padStart(2, '0'));

const lineProgress = computed(() =>
    calculateLyricLineProgress(
        lyricsArray.value,
        currentLyricIndex.value,
        currentTime.value,
        duration.value,
    ),
);

const lineProgressRounded = computed(() => Math.round(lineProgress.value));
const displayedCurrentTime = computed(() => seekPreviewTime.value ?? currentTime.value);
const displayedTrackProgress = computed(() =>
    duration.value > 0
        ? clampPercentage((displayedCurrentTime.value / duration.value) * 100)
        : trackProgress.value,
);

const formatClock = seconds => {
    const value = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remainder = value % 60;
    return hours > 0
        ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
        : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};

const formattedCurrentTime = computed(() => formatClock(displayedCurrentTime.value));
const formattedDuration = computed(() => formatClock(duration.value));
const timelineValueText = computed(() => `${formattedCurrentTime.value} / ${formattedDuration.value}`);
const lineKey = computed(
    () => `${currentSong.value?.name || 'idle'}-${displayedLyricIndex.value}-${selectedLyricType.value}`,
);

const rootClasses = computed(() => ({
    'is-playing': playing.value,
    'is-paused': !playing.value,
    'is-locked': locked.value,
    'is-dragging': isDragging.value,
    'is-seeking': seekPreviewTime.value !== null,
    'has-cover': Boolean(coverUrl.value),
    'is-empty': !currentSong.value || lyricsArray.value.length === 0,
    'is-compact': compactMode.value,
    'is-transparent': transparentMode.value,
    'is-closing': isClosing.value,
}));

const rootStyle = computed(() => ({
    '--line-progress': `${lineProgress.value}%`,
    '--track-progress': `${displayedTrackProgress.value}%`,
    '--lyric-size': `${lyricFontSize.value}px`,
}));

const nativeDragEnabled = computed(() => isMac && !locked.value);

const ensureAvailableLyricType = () => {
    if (
        selectedLyricType.value !== 'auto' &&
        !availableLyricTypes.value.some(option => option.value === selectedLyricType.value)
    ) {
        selectedLyricType.value = 'auto';
    }
};

const handleLyricUpdate = (_event, data) => {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'song-change') {
        currentSong.value =
            data.song && typeof data.song === 'object'
                ? {
                      name: String(data.song.name || ''),
                      ar: Array.isArray(data.song.ar) ? data.song.ar : [],
                      coverUrl: String(data.song.coverUrl || ''),
                      type: String(data.song.type || 'online'),
                  }
                : null;
        lyricsArray.value = Array.isArray(data.lyrics)
            ? data.lyrics.map(row => ({
                  lyric: String(row?.lyric || ''),
                  tlyric: String(row?.tlyric || ''),
                  rlyric: String(row?.rlyric || ''),
                  time: Number.isFinite(Number(row?.time)) ? Number(row.time) : 0,
              }))
            : [];
        currentLyricIndex.value = -1;
        currentTime.value = 0;
        duration.value = 0;
        trackProgress.value = 0;
        seekPreviewTime.value = null;
        coverFailed.value = false;
        ensureAvailableLyricType();
        return;
    }

    if (data.type === 'lyric-progress') {
        const nextIndex = Number(data.currentIndex);
        currentLyricIndex.value = Number.isInteger(nextIndex) ? nextIndex : -1;
        currentTime.value = Math.max(0, Number(data.currentTime) || 0);
        duration.value = Math.max(0, Number(data.duration) || 0);
        trackProgress.value =
            duration.value > 0
                ? clampPercentage((currentTime.value / duration.value) * 100)
                : clampPercentage(data.progress);
        return;
    }

    if (data.type === 'play-state') playing.value = Boolean(data.playing);
};

const applyQaState = () => {
    // QA state is component-local and deliberately never reads or writes Electron state or storage.
    currentSong.value = {
        name: '灰域回路 / Ashen Circuit',
        ar: [{ name: 'Hydrogen Field Unit' }],
        coverUrl: new URL('../assets/img/default-cover.svg', import.meta.url).href,
        type: 'local',
    };
    lyricsArray.value = [
        { lyric: '夜色在边界之外沉降', tlyric: 'Night settles beyond the boundary', rlyric: '', time: 8 },
        { lyric: '沿着信号的边界，确认下一个坐标', tlyric: 'Follow the signal and confirm the next point', rlyric: '', time: 34 },
        { lyric: '让每一次回响都返回原点', tlyric: 'Let every echo return to its origin', rlyric: '', time: 42 },
        { lyric: '我们仍在同一条轨道上', tlyric: 'We are still on the same route', rlyric: '', time: 50 },
    ];
    currentLyricIndex.value = 1;
    currentTime.value = 37;
    duration.value = 186;
    trackProgress.value = clampPercentage((currentTime.value / duration.value) * 100);
    playing.value = true;
};

const openControlDock = async event => {
    event?.preventDefault?.();
    controlDockVisible.value = true;
    await nextTick();
    controlDockRef.value?.querySelector('input, button')?.focus();
};

const hideControlDock = (restoreFocus = false) => {
    controlDockVisible.value = false;
    nextTick(syncLockedMousePassthrough);
    if (restoreFocus) nextTick(() => settingsButtonRef.value?.focus());
};

const toggleControlDock = () => {
    if (controlDockVisible.value) {
        hideControlDock(false);
        return;
    }
    openControlDock();
};

const setMouseEventsIgnored = ignored => {
    if (mouseEventsIgnored === ignored) return;
    mouseEventsIgnored = ignored;
    window.electronAPI?.setLyricWindowIgnoreMouseEvents?.(ignored);
};

const isLockedInteractiveTarget = target =>
    target instanceof Element && Boolean(target.closest('.current-line__text, .next-line p, .control-dock'));

const syncLockedMousePassthrough = target => {
    setMouseEventsIgnored(transparentMode.value && locked.value && !isLockedInteractiveTarget(target));
};

const handleWindowMouseMove = event => {
    if (!transparentMode.value || !locked.value) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    syncLockedMousePassthrough(target);
};

const handleViewModeChange = async changedMode => {
    hideControlDock(false);
    syncLockedMousePassthrough(document.querySelector(':hover'));

    const getBounds = window.electronAPI?.getLyricWindowBounds;
    const setLimits = window.electronAPI?.setLyricWindowMinMax;
    const resizeWindow = window.electronAPI?.resizeWindow;
    if (typeof getBounds !== 'function' || typeof setLimits !== 'function' || typeof resizeWindow !== 'function') {
        return;
    }

    try {
        const bounds = await getBounds();
        if (compactMode.value || transparentMode.value) {
            if (!expandedWindowSize && bounds) {
                expandedWindowSize = { width: bounds.width, height: bounds.height };
            }
            await setLimits(
                WINDOW_LIMITS.free.minWidth,
                WINDOW_LIMITS.free.minHeight,
                WINDOW_LIMITS.free.maxWidth,
                WINDOW_LIMITS.free.maxHeight,
            );
            if (changedMode === 'compact' && compactMode.value) {
                await nextTick();
                await resizeWindow(
                    Math.min(WINDOW_LIMITS.compact.targetWidth, bounds?.width || WINDOW_LIMITS.compact.targetWidth),
                    Math.min(WINDOW_LIMITS.compact.targetHeight, bounds?.height || WINDOW_LIMITS.compact.targetHeight),
                );
            }
            return;
        }

        await setLimits(
            WINDOW_LIMITS.expanded.minWidth,
            WINDOW_LIMITS.expanded.minHeight,
            WINDOW_LIMITS.expanded.maxWidth,
            WINDOW_LIMITS.expanded.maxHeight,
        );
        await resizeWindow(
            Math.max(WINDOW_LIMITS.expanded.minWidth, expandedWindowSize?.width || 760),
            Math.max(WINDOW_LIMITS.expanded.minHeight, expandedWindowSize?.height || 360),
        );
        expandedWindowSize = null;
    } catch (_) {
        // Keep the CSS mode switch usable when the native window rejects a resize.
    }
};

const handleDocumentPointerDown = event => {
    if (!controlDockVisible.value) return;
    if (controlDockRef.value?.contains(event.target) || settingsButtonRef.value?.contains(event.target)) return;
    hideControlDock(false);
};

const handleGlobalKeydown = event => {
    if (event.key === 'Escape' && controlDockVisible.value) {
        event.preventDefault();
        hideControlDock(true);
    }
};

const adjustFontSize = delta => {
    lyricFontSize.value = Math.max(18, Math.min(52, lyricFontSize.value + delta));
};

const clampTimelineTime = value => {
    const nextTime = Number(value);
    if (!Number.isFinite(nextTime) || duration.value <= 0) return 0;
    return Math.max(0, Math.min(duration.value, nextTime));
};

const previewTimelineSeek = event => {
    if (locked.value || duration.value <= 0) return;
    seekPreviewTime.value = clampTimelineTime(event.currentTarget.value);
};

const commitTimelineSeek = event => {
    if (locked.value || duration.value <= 0) {
        seekPreviewTime.value = null;
        return;
    }

    const targetTime = clampTimelineTime(seekPreviewTime.value ?? event.currentTarget.value);
    currentTime.value = targetTime;
    trackProgress.value = clampPercentage((targetTime / duration.value) * 100);
    seekPreviewTime.value = null;
    window.electronAPI?.seekDesktopLyric?.(targetTime)?.catch?.(() => {});
};

const controlPlayback = action => {
    window.electronAPI?.controlDesktopLyricPlayback?.(action)?.catch?.(() => {});
};

const saveCurrentWindowBounds = async () => {
    try {
        persistDesktopLyricConfig(await window.electronAPI?.getLyricWindowBounds?.());
    } catch (_) {
        persistDesktopLyricConfig();
    }
};

const scheduleWindowBoundsSave = () => {
    if (boundsSaveTimer) window.clearTimeout(boundsSaveTimer);
    boundsSaveTimer = window.setTimeout(saveCurrentWindowBounds, 150);
};

const persistCurrentBrowserBounds = () => {
    persistDesktopLyricConfig({
        x: window.screenX,
        y: window.screenY,
        width: window.outerWidth,
        height: window.outerHeight,
    });
};

const restoreDesktopLyricConfig = async () => {
    window.electronAPI?.setLyricWindowMovable?.(!locked.value);
    syncLockedMousePassthrough(null);

    const setLimits = window.electronAPI?.setLyricWindowMinMax;
    const resizeWindow = window.electronAPI?.resizeWindow;
    if (typeof setLimits !== 'function' || typeof resizeWindow !== 'function') return;

    const limits = compactMode.value || transparentMode.value ? WINDOW_LIMITS.free : WINDOW_LIMITS.expanded;
    await setLimits(limits.minWidth, limits.minHeight, limits.maxWidth, limits.maxHeight);

    const fallbackBounds = compactMode.value
        ? { width: WINDOW_LIMITS.compact.targetWidth, height: WINDOW_LIMITS.compact.targetHeight }
        : null;
    const bounds = savedWindowBounds || fallbackBounds;
    if (!bounds) return;

    const freelyResizable = compactMode.value || transparentMode.value;
    const width = freelyResizable
        ? Math.max(1, Math.round(bounds.width))
        : Math.max(limits.minWidth, Math.min(limits.maxWidth, Math.round(bounds.width)));
    const height = freelyResizable
        ? Math.max(1, Math.round(bounds.height))
        : Math.max(limits.minHeight, Math.min(limits.maxHeight, Math.round(bounds.height)));
    await resizeWindow(width, height);
    if (Number.isFinite(bounds.x) && Number.isFinite(bounds.y)) {
        window.electronAPI?.moveLyricWindow?.(Math.round(bounds.x), Math.round(bounds.y));
    }
};

const finishDrag = () => {
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', finishDrag);
    if (!isDragging.value) return;

    isDragging.value = false;
    document.body.style.userSelect = '';

    if (originalMinMax.value) {
        const { minWidth, minHeight, maxWidth, maxHeight } = originalMinMax.value;
        window.electronAPI
            ?.setLyricWindowMinMax?.(minWidth, minHeight, maxWidth, maxHeight)
            ?.catch?.(() => {});
    }
    window.electronAPI?.setLyricWindowResizable?.(true);
    saveCurrentWindowBounds();
};

const onDragStart = async event => {
    if (
        !isWinOrLinux ||
        locked.value ||
        event.button !== 0 ||
        typeof window.electronAPI?.getLyricWindowBounds !== 'function'
    ) {
        return;
    }

    event.preventDefault();
    event.stopPropagation();

    try {
        const bounds = await window.electronAPI.getLyricWindowBounds();
        if (!bounds) return;
        const contentBounds = await window.electronAPI.getLyricWindowContentBounds?.();
        const activeBounds = contentBounds || bounds;

        dragStartSize.value = { width: activeBounds.width, height: activeBounds.height };
        dragCurrentPosition.value = { x: activeBounds.x, y: activeBounds.y };
        dragStartScreen.value = { x: event.screenX, y: event.screenY };
        isDragging.value = true;
        document.body.style.userSelect = 'none';

        window.electronAPI.setLyricWindowResizable?.(false);
        originalMinMax.value = await window.electronAPI.getLyricWindowMinMax?.();
        await window.electronAPI.setLyricWindowMinMax?.(
            activeBounds.width,
            activeBounds.height,
            activeBounds.width,
            activeBounds.height,
        );

        document.addEventListener('mousemove', onDragMove);
        document.addEventListener('mouseup', finishDrag);
    } catch (_) {
        finishDrag();
    }
};

const onCompactDragStart = event => {
    if (compactMode.value || transparentMode.value) onDragStart(event);
};

const onDragMove = event => {
    if (!isDragging.value) return;
    const deltaX = event.movementX ?? event.screenX - dragStartScreen.value.x;
    const deltaY = event.movementY ?? event.screenY - dragStartScreen.value.y;
    const x = Math.round(dragCurrentPosition.value.x + deltaX);
    const y = Math.round(dragCurrentPosition.value.y + deltaY);
    dragCurrentPosition.value = { x, y };

    if (event.movementX == null || event.movementY == null) {
        dragStartScreen.value = { x: event.screenX, y: event.screenY };
    }

    window.electronAPI?.moveLyricWindowContentTo?.(
        x,
        y,
        dragStartSize.value.width,
        dragStartSize.value.height,
    );
};

const toggleLock = event => {
    if (isDragging.value) finishDrag();
    seekPreviewTime.value = null;
    locked.value = !locked.value;
    syncLockedMousePassthrough(event?.target);
    window.electronAPI?.setLyricWindowMovable?.(!locked.value);
};

const closeLyric = async () => {
    if (qaEnabled) {
        hideControlDock(false);
        return;
    }
    if (isClosing.value) return;

    hideControlDock(false);
    await saveCurrentWindowBounds();
    isClosing.value = true;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    closingTimer = window.setTimeout(() => {
        window.electronAPI?.notifyLyricWindowClosed?.();
        window.electronAPI?.closeLyricWindow?.();
    }, reducedMotion ? 0 : 180);
};

onMounted(() => {
    if (qaEnabled) {
        applyQaState();
    } else {
        const unsubscribe = window.electronAPI?.onLyricUpdate?.(handleLyricUpdate);
        if (typeof unsubscribe === 'function') removeLyricListener = unsubscribe;
        window.electronAPI?.requestLyricData?.();
    }

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    window.addEventListener('beforeunload', persistCurrentBrowserBounds);
    window.addEventListener('resize', scheduleWindowBoundsSave);
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('keydown', handleGlobalKeydown);
    restoreDesktopLyricConfig().catch(() => {});
});

onUnmounted(() => {
    persistCurrentBrowserBounds();
    setMouseEventsIgnored(false);
    finishDrag();
    removeLyricListener?.();
    document.removeEventListener('pointerdown', handleDocumentPointerDown);
    window.removeEventListener('beforeunload', persistCurrentBrowserBounds);
    window.removeEventListener('resize', scheduleWindowBoundsSave);
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('keydown', handleGlobalKeydown);
    if (boundsSaveTimer) window.clearTimeout(boundsSaveTimer);
    if (closingTimer) window.clearTimeout(closingTimer);
});
</script>

<style scoped>
.endfield-lyric[data-ark-theme='endfield'] {
    --ef-paper: #ecece6;
    --ef-surface: #f6f6f1;
    --ef-rail: #e2e2db;
    --ef-ink: #191919;
    --ef-dock: #191919;
    --ef-on-dock: #f4f4ee;
    --ef-signal: #fffa00;
    --ef-on-signal: #191919;
    --ef-muted: #666761;
    --ef-rule: rgb(25 25 25 / 18%);
    --ef-rule-strong: rgb(25 25 25 / 48%);
    --ef-grid: rgb(25 25 25 / 8%);
    --ef-danger: #b63a31;
    --ef-shadow: 0 18px 44px rgb(0 0 0 / 30%);
    position: fixed;
    inset: 0;
    padding: 8px;
    overflow: hidden;
    color: var(--ef-ink);
    background: transparent;
    font-family: 'SourceHanSansCN-Bold', 'Microsoft YaHei', sans-serif;
    user-select: none;
    -webkit-app-region: no-drag;
    filter: drop-shadow(var(--ef-shadow));
}

:global(html.dark .endfield-lyric[data-ark-theme='endfield']) {
    --ef-paper: #181916;
    --ef-surface: #22231f;
    --ef-ink: #f1f1eb;
    --ef-rail: #deded6;
    --ef-on-dock: #f4f4ee;
    --ef-muted: #a4a59e;
    --ef-rule: rgb(255 255 255 / 18%);
    --ef-rule-strong: rgb(255 255 255 / 46%);
    --ef-grid: rgb(255 255 255 / 7%);
    --ef-danger: #f06d61;
    --ef-shadow: 0 18px 48px rgb(0 0 0 / 48%);
}

.endfield-lyric,
.endfield-lyric * {
    box-sizing: border-box;
}

.field-shell {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr) clamp(138px, 22vw, 190px);
    grid-template-rows: 76px minmax(0, 1fr) 48px;
    overflow: hidden;
    background: var(--ef-surface);
    border: 1px solid var(--ef-rule-strong);
    clip-path: polygon(0 0, calc(100% - 26px) 0, 100% 26px, 100% 100%, 18px 100%, 0 calc(100% - 18px));
    animation: shell-enter 640ms cubic-bezier(.2, .78, .18, 1) both;
}

.field-shell::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 30;
    pointer-events: none;
    background: var(--ef-signal);
    transform: translateX(105%);
    animation: signal-wipe 720ms cubic-bezier(.72, 0, .18, 1) both;
}

.field-rail {
    position: relative;
    z-index: 4;
    grid-column: 1;
    grid-row: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 0;
    padding: 12px 7px 10px;
    color: #191919;
    background: var(--ef-rail);
    border-right: 1px solid rgb(25 25 25 / 32%);
    cursor: move;
}

.field-rail::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 5px;
    background: var(--ef-signal);
    transform-origin: top;
    transition: transform 260ms ease;
}

.is-paused .field-rail::before {
    transform: scaleY(.22);
}

.rail-brand {
    display: grid;
    justify-items: center;
    gap: 1px;
    width: 100%;
    padding-bottom: 9px;
    border-bottom: 1px solid rgb(25 25 25 / 24%);
    font-family: 'Bender-Bold', Consolas, monospace;
}

.rail-brand strong {
    font: 22px/.9 'Gilroy-ExtraBold', 'Arial Narrow', sans-serif;
    letter-spacing: -.08em;
}

.rail-brand sub {
    font-size: .48em;
}

.rail-brand span,
.rail-count span {
    font-size: 7px;
    letter-spacing: .16em;
}

.rail-index {
    width: 100%;
    margin-top: auto;
    overflow: hidden;
    font: clamp(48px, 7.5vw, 78px)/.78 'Gilroy-ExtraBold', 'Arial Narrow', sans-serif;
    letter-spacing: -.1em;
    text-align: center;
}

.rail-count {
    display: grid;
    justify-items: center;
    gap: 1px;
    margin: 7px 0 auto;
    font: 12px/1 'Bender-Bold', Consolas, monospace;
    font-variant-numeric: tabular-nums;
}

.rail-status {
    display: grid;
    justify-items: center;
    gap: 5px;
    margin-bottom: 12px;
    font-size: 9px;
    white-space: nowrap;
}

.rail-status__mark {
    width: 10px;
    height: 10px;
    background: var(--ef-signal);
    border: 1px solid #191919;
}

.is-playing .rail-status__mark {
    animation: state-breathe 1.8s ease-in-out infinite;
}

.rail-position {
    margin: 0;
    font: 7px/1 'Bender-Bold', Consolas, monospace;
    letter-spacing: .13em;
    writing-mode: vertical-rl;
}

.field-header {
    position: relative;
    z-index: 5;
    grid-column: 2 / 4;
    grid-row: 1;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-width: 0;
    background: var(--ef-surface);
    border-bottom: 1px solid var(--ef-rule-strong);
}

.header-drag {
    min-width: 0;
    padding: 10px 18px 9px;
    cursor: move;
}

.native-drag {
    -webkit-app-region: drag;
}

.header-kicker {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    color: var(--ef-muted);
    font: 8px/1 'Bender-Bold', Consolas, monospace;
    letter-spacing: .14em;
}

.header-kicker span:last-child {
    color: var(--ef-ink);
}

.track-lockup {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: baseline;
    gap: 12px;
    margin-top: 8px;
    min-width: 0;
}

.track-lockup h1,
.track-lockup p {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.track-lockup h1 {
    font: 19px/1.05 'SourceHanSansCN-Heavy', 'Arial Narrow', sans-serif;
    letter-spacing: -.02em;
}

.track-lockup p {
    max-width: 200px;
    color: var(--ef-muted);
    font-size: 10px;
}

.header-actions {
    display: flex;
    min-width: 0;
    background: var(--ef-dock);
    -webkit-app-region: no-drag;
}

.header-action {
    display: grid;
    align-content: center;
    justify-items: center;
    gap: 4px;
    min-width: 62px;
    min-height: 44px;
    padding: 7px 10px;
    color: var(--ef-on-dock) !important;
    background-color: var(--ef-dock) !important;
    border: 0;
    border-left: 1px solid rgb(255 255 255 / 16%);
    border-radius: 0;
    font: 9px/1 'SourceHanSansCN-Bold', sans-serif;
    cursor: pointer;
    transition: color 180ms ease, background-color 180ms ease, transform 180ms ease;
    -webkit-app-region: no-drag;
}

.header-action svg,
.panel-close svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: square;
    stroke-linejoin: miter;
}

.header-action:hover {
    transform: translateY(-2px);
}

.header-action.is-active {
    color: var(--ef-on-signal) !important;
    background-color: var(--ef-signal) !important;
}

.lyric-stage {
    position: relative;
    z-index: 2;
    grid-column: 2;
    grid-row: 2;
    min-width: 0;
    min-height: 0;
    display: grid;
    align-items: center;
    overflow: hidden;
    padding: clamp(14px, 2.4vw, 24px);
    background-color: var(--ef-surface);
    background-image:
        linear-gradient(var(--ef-grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--ef-grid) 1px, transparent 1px);
    background-size: 36px 36px;
}

.lyric-stage::before {
    content: '';
    position: absolute;
    inset: 0;
    background: var(--ef-signal);
    opacity: .12;
    clip-path: polygon(66% 0, 100% 0, 100% 100%, 86% 100%);
    transform: translateX(calc((100% - var(--line-progress)) * .08));
    transition: transform 280ms linear;
}

.stage-guides {
    position: absolute;
    inset: 13px;
    pointer-events: none;
    border-top: 1px solid var(--ef-rule);
    border-bottom: 1px solid var(--ef-rule);
}

.stage-guides::before {
    content: '';
    position: absolute;
    top: 18%;
    right: 7%;
    width: 24%;
    height: 64%;
    border: 1px solid var(--ef-rule);
    border-right-width: 5px;
}

.stage-guides::after {
    content: '';
    position: absolute;
    top: 50%;
    right: 0;
    width: 38%;
    border-top: 1px solid var(--ef-rule-strong);
}

.lyric-stack {
    position: relative;
    z-index: 2;
    display: grid;
    gap: 11px;
    min-width: 0;
}

.current-line {
    position: relative;
    min-width: 0;
    min-height: 102px;
    display: grid;
    align-content: center;
    gap: 10px;
    padding: 14px 20px 16px 23px;
    overflow: hidden;
    color: var(--ef-on-dock);
    background: var(--ef-dock);
    clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);
}

.current-line::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 6px;
    background: var(--ef-signal);
}

.current-line__header {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    color: rgb(244 244 238 / 62%);
    font: 8px/1 'Bender-Bold', Consolas, monospace;
    font-variant-numeric: tabular-nums;
    letter-spacing: .14em;
}

.current-line__text {
    position: relative;
    z-index: 1;
    margin: 0;
    overflow: hidden;
    color: rgb(244 244 238 / 36%);
    font: var(--lyric-size)/1.28 'SourceHanSansCN-Heavy', 'Microsoft YaHei', sans-serif;
    letter-spacing: -.025em;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}

.current-line__text::after {
    content: attr(data-text);
    position: absolute;
    inset: 0;
    color: var(--ef-on-dock);
    clip-path: inset(0 calc(100% - var(--line-progress)) 0 0);
    transition: clip-path 280ms linear;
    pointer-events: none;
}

.line-meter {
    position: absolute;
    inset: auto 0 0 0;
    height: 3px;
    overflow: hidden;
    background: rgb(255 255 255 / 12%);
}

.line-meter span {
    display: block;
    width: var(--line-progress);
    height: 100%;
    background: var(--ef-signal);
    transition: width 280ms linear;
}

.next-line {
    display: grid;
    grid-template-columns: 76px minmax(0, 1fr);
    align-items: start;
    gap: 12px;
    min-width: 0;
    padding: 8px 12px 8px 0;
    border-top: 1px solid var(--ef-rule-strong);
}

.next-line__label {
    padding: 3px 0 3px 9px;
    color: var(--ef-muted);
    border-left: 3px solid var(--ef-signal);
    font: 8px/1.2 'Bender-Bold', Consolas, monospace;
    letter-spacing: .09em;
}

.next-line p {
    margin: 0;
    color: var(--ef-muted);
    font-size: max(13px, calc(var(--lyric-size) * .56));
    line-height: 1.35;
    overflow-wrap: anywhere;
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}

.media-field {
    position: relative;
    z-index: 3;
    grid-column: 3;
    grid-row: 2;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    color: var(--ef-on-dock);
    background: var(--ef-dock);
    border-left: 1px solid var(--ef-rule-strong);
}

.media-field img,
.media-fallback {
    width: 100%;
    height: 100%;
}

.media-field img {
    object-fit: cover;
    filter: grayscale(.75) contrast(1.08);
    transform: scale(1.04);
}

.media-fallback {
    display: grid;
    place-content: center;
    gap: 4px;
    color: rgb(244 244 238 / 34%);
    background-image:
        linear-gradient(135deg, transparent 47%, rgb(255 255 255 / 10%) 48%, rgb(255 255 255 / 10%) 52%, transparent 53%),
        linear-gradient(rgb(255 255 255 / 7%) 1px, transparent 1px);
    background-size: 100% 100%, 100% 24px;
    font-family: 'Bender-Bold', Consolas, monospace;
    text-align: center;
}

.media-fallback strong {
    font-size: 30px;
    letter-spacing: -.04em;
}

.media-fallback span {
    font-size: 8px;
    letter-spacing: .18em;
}

.media-segments {
    position: absolute;
    inset: 0;
    background:
        linear-gradient(90deg, transparent 33%, rgb(255 255 255 / 20%) 33%, rgb(255 255 255 / 20%) calc(33% + 1px), transparent calc(33% + 1px)),
        linear-gradient(90deg, transparent 72%, rgb(255 250 0 / 42%) 72%, rgb(255 250 0 / 42%) calc(72% + 4px), transparent calc(72% + 4px)),
        linear-gradient(0deg, rgb(0 0 0 / 82%) 0, transparent 64%);
    pointer-events: none;
}

.media-field::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 42%;
    height: 36%;
    background: var(--ef-signal);
    clip-path: polygon(55% 0, 100% 0, 100% 100%);
    opacity: .88;
    transform-origin: top right;
    transition: transform 280ms ease;
}

.is-paused .media-field::after {
    transform: scale(.56);
}

.media-caption {
    position: absolute;
    z-index: 2;
    inset: auto 0 0 0;
    display: grid;
    gap: 3px;
    padding: 9px 11px 10px;
    background: rgb(15 15 14 / 78%);
    border-top: 1px solid rgb(255 255 255 / 20%);
    font-family: 'Bender-Bold', Consolas, monospace;
}

.media-caption span {
    color: rgb(244 244 238 / 54%);
    font-size: 7px;
    letter-spacing: .16em;
}

.media-caption strong {
    font-size: 9px;
    letter-spacing: .1em;
}

.media-controls {
    position: absolute;
    z-index: 4;
    inset: 0 0 42px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    margin: 0;
    padding: 5px;
    background: rgb(15 15 14 / 64%);
    opacity: 0;
    pointer-events: none;
    transform: translateY(6px);
    transition:
        opacity 180ms ease,
        transform 180ms ease;
    -webkit-app-region: no-drag;
}

.media-field:hover .media-controls,
.media-controls:focus-within {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
}

.media-controls button {
    display: grid;
    place-items: center;
    width: clamp(28px, 4.5vw, 34px);
    height: clamp(32px, 4.8vw, 36px);
    flex: 0 0 auto;
    padding: 0;
    color: var(--ef-on-dock);
    background: rgb(15 15 14 / 84%);
    border: 1px solid rgb(255 255 255 / 38%);
    border-radius: 0;
    cursor: pointer;
    transition:
        color 150ms ease,
        background-color 150ms ease,
        border-color 150ms ease,
        transform 150ms ease;
}

.media-controls button:hover,
.media-controls button:focus-visible {
    color: var(--ef-on-signal);
    background: var(--ef-on-dock);
    border-color: var(--ef-on-dock);
    outline: 0;
    transform: translateY(-2px);
}

.media-controls .media-control--primary {
    color: var(--ef-on-signal);
    background: var(--ef-signal);
    border-color: var(--ef-signal);
}

.media-controls svg {
    width: 17px;
    height: 17px;
    fill: currentColor;
}

.timeline-dock {
    position: relative;
    z-index: 5;
    grid-column: 2 / 4;
    grid-row: 3;
    display: grid;
    grid-template-columns: 66px minmax(0, 1fr) 66px;
    align-items: center;
    gap: 12px;
    padding: 6px 15px;
    color: var(--ef-on-dock);
    background: var(--ef-dock);
    border-top: 1px solid rgb(255 255 255 / 12%);
}

.time-readout {
    display: grid;
    gap: 2px;
    font-family: 'Bender-Bold', Consolas, monospace;
    font-variant-numeric: tabular-nums;
}

.time-readout span {
    color: rgb(244 244 238 / 46%);
    font-size: 6px;
    letter-spacing: .14em;
}

.time-readout strong {
    font-size: 12px;
}

.time-readout--end {
    justify-items: end;
}

.track-meter {
    position: relative;
    height: 10px;
    overflow: visible;
    background:
        repeating-linear-gradient(90deg, rgb(255 255 255 / 20%) 0 1px, transparent 1px 10%),
        linear-gradient(rgb(255 255 255 / 14%), rgb(255 255 255 / 14%)) center / 100% 2px no-repeat;
}

.track-meter:focus-within {
    outline: 1px solid var(--ef-signal);
    outline-offset: 3px;
}

.track-meter__fill {
    position: absolute;
    top: 4px;
    left: 0;
    width: var(--track-progress);
    height: 2px;
    background: var(--ef-signal);
    transition: width 280ms linear;
}

.track-meter__cursor {
    position: absolute;
    top: 1px;
    left: var(--track-progress);
    width: 4px;
    height: 8px;
    background: var(--ef-signal);
    transform: translateX(-2px);
    transition: left 280ms linear;
}

.track-meter__input {
    position: absolute;
    z-index: 2;
    inset: -8px 0;
    width: 100%;
    height: 26px;
    margin: 0;
    appearance: none;
    background: transparent;
    cursor: ew-resize;
    outline: 0;
}

.track-meter__input::-webkit-slider-runnable-track {
    height: 26px;
    background: transparent;
}

.track-meter__input::-webkit-slider-thumb {
    width: 16px;
    height: 26px;
    appearance: none;
    background: transparent;
}

.track-meter__input:disabled {
    cursor: default;
}

.is-seeking .track-meter__fill,
.is-seeking .track-meter__cursor {
    transition: none;
}

.control-dock {
    position: absolute;
    z-index: 50;
    top: 14px;
    right: 14px;
    bottom: 14px;
    width: min(310px, calc(100% - 28px));
    overflow: auto;
    color: var(--ef-ink);
    background: var(--ef-paper);
    border: 1px solid var(--ef-rule-strong);
    box-shadow: -16px 18px 40px rgb(0 0 0 / 28%);
    clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);
    -webkit-app-region: no-drag;
}

.control-dock::before {
    content: '';
    position: absolute;
    z-index: 2;
    inset: 0 auto auto 0;
    width: 74px;
    height: 5px;
    background: var(--ef-signal);
}

.control-dock__header {
    position: sticky;
    z-index: 3;
    top: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 68px;
    padding: 14px 14px 11px 16px;
    background: var(--ef-paper);
    border-bottom: 1px solid var(--ef-rule-strong);
}

.control-dock__header p,
.control-dock__header h2 {
    margin: 0;
}

.control-dock__header p {
    color: var(--ef-muted);
    font: 7px/1 'Bender-Bold', Consolas, monospace;
    letter-spacing: .16em;
}

.control-dock__header h2 {
    margin-top: 5px;
    font: 16px/1 'SourceHanSansCN-Heavy', sans-serif;
}

.panel-close,
.font-stepper button {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: 0 0 auto;
    padding: 0;
    color: var(--ef-ink) !important;
    background-color: transparent !important;
    border: 1px solid var(--ef-rule-strong);
    border-radius: 0;
    cursor: pointer;
}

.control-group {
    min-width: 0;
    margin: 0;
    padding: 13px 14px 15px;
    border: 0;
    border-bottom: 1px solid var(--ef-rule);
}

.control-group legend {
    width: 100%;
    padding: 0;
    color: var(--ef-ink);
    font-size: 11px;
}

.control-group legend span {
    float: right;
    color: var(--ef-muted);
    font: 7px/1.5 'Bender-Bold', Consolas, monospace;
    letter-spacing: .14em;
}

.source-options {
    display: grid;
    gap: 5px;
    margin-top: 10px;
}

.source-option {
    position: relative;
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr) 12px;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 6px 11px 6px 8px;
    background: var(--ef-surface);
    border: 1px solid var(--ef-rule);
    cursor: pointer;
    transition: color 180ms ease, background-color 180ms ease, transform 180ms ease;
}

.source-option:hover {
    transform: translateX(-3px);
}

.source-option input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
}

.source-option__glyph {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: #191919;
    background: var(--ef-signal);
    font: 13px/1 'SourceHanSansCN-Heavy', sans-serif;
}

.source-option__label {
    display: grid;
    gap: 3px;
    min-width: 0;
}

.source-option__label strong {
    font-size: 11px;
}

.source-option__label small {
    overflow: hidden;
    color: var(--ef-muted);
    font: 7px/1 'Bender-Bold', Consolas, monospace;
    letter-spacing: .12em;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.source-option__check {
    width: 8px;
    height: 8px;
    border: 1px solid currentColor;
}

.source-option:has(input:checked) {
    color: var(--ef-on-dock);
    background: var(--ef-dock);
    border-color: var(--ef-dock);
}

.source-option:has(input:checked)::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 4px;
    background: var(--ef-signal);
}

.source-option:has(input:checked) .source-option__label small {
    color: rgb(244 244 238 / 58%);
}

.source-option:has(input:checked) .source-option__check {
    background: var(--ef-signal);
    border-color: var(--ef-signal);
}

.source-option:has(input:focus-visible) {
    outline: 2px solid var(--ef-signal);
    outline-offset: 2px;
}

.mode-option {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    min-height: 56px;
    margin-top: 10px;
    padding: 9px 11px;
    background: var(--ef-surface);
    border: 1px solid var(--ef-rule);
    cursor: pointer;
}

.mode-option input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
}

.mode-option__label {
    display: grid;
    gap: 4px;
    min-width: 0;
}

.mode-option__label strong {
    font-size: 11px;
}

.mode-option__label small {
    color: var(--ef-muted);
    font-size: 9px;
    line-height: 1.35;
}

.mode-switch {
    position: relative;
    width: 44px;
    height: 24px;
    background: var(--ef-paper);
    border: 1px solid var(--ef-rule-strong);
    transition: background-color 180ms ease;
}

.mode-switch span {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    background: var(--ef-ink);
    transition: transform 180ms cubic-bezier(.22, .8, .2, 1);
}

.mode-option:has(input:checked) .mode-switch {
    background: var(--ef-signal);
    border-color: var(--ef-ink);
}

.mode-option:has(input:checked) .mode-switch span {
    transform: translateX(20px);
}

.mode-option:has(input:focus-visible) {
    outline: 2px solid var(--ef-signal);
    outline-offset: 2px;
}

.font-stepper {
    display: grid;
    grid-template-columns: 40px minmax(0, 1fr) 40px;
    gap: 7px;
    margin-top: 10px;
}

.font-stepper output {
    display: grid;
    place-items: center;
    min-height: 40px;
    color: var(--ef-on-dock);
    background: var(--ef-dock);
    font: 14px/1 'Bender-Bold', Consolas, monospace;
    font-variant-numeric: tabular-nums;
}

.dock-actions {
    display: grid;
    gap: 6px;
    padding: 14px;
}

.dock-action {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: 7px 10px;
    color: var(--ef-on-dock) !important;
    background-color: var(--ef-dock) !important;
    border: 1px solid var(--ef-dock);
    border-radius: 0;
    text-align: left;
    cursor: pointer;
}

.dock-action > span:first-child {
    color: var(--ef-signal);
    font: 20px/1 'Bender-Bold', Consolas, monospace;
    text-align: center;
}

.dock-action > span:last-child {
    display: grid;
    gap: 3px;
}

.dock-action strong {
    font-size: 11px;
}

.dock-action small {
    color: rgb(244 244 238 / 54%);
    font: 7px/1 'Bender-Bold', Consolas, monospace;
    letter-spacing: .12em;
}

.dock-action--danger {
    color: var(--ef-danger) !important;
    background-color: transparent !important;
    border-color: color-mix(in srgb, var(--ef-danger), transparent 42%);
}

.dock-action--danger > span:first-child,
.dock-action--danger small {
    color: inherit;
}

.header-action:focus-visible,
.panel-close:focus-visible,
.font-stepper button:focus-visible,
.dock-action:focus-visible {
    outline: 2px solid var(--ef-signal);
    outline-offset: 2px;
}

.line-wipe-enter-active,
.line-wipe-leave-active,
.next-shift-enter-active,
.next-shift-leave-active,
.cover-wipe-enter-active,
.cover-wipe-leave-active,
.dock-reveal-enter-active,
.dock-reveal-leave-active {
    transition:
        clip-path 360ms cubic-bezier(.22, .8, .2, 1),
        transform 360ms cubic-bezier(.22, .8, .2, 1),
        opacity 220ms ease;
}

.line-wipe-enter-from {
    opacity: 0;
    clip-path: inset(0 100% 0 0);
    transform: translateX(-12px);
}

.line-wipe-leave-to {
    opacity: 0;
    clip-path: inset(0 0 0 100%);
    transform: translateX(12px);
}

.next-shift-enter-from,
.next-shift-leave-to {
    opacity: 0;
    transform: translateY(8px);
}

.cover-wipe-enter-from,
.cover-wipe-leave-to {
    opacity: 0;
    clip-path: inset(0 100% 0 0);
    transform: translateX(-10px) scale(1.04);
}

.dock-reveal-enter-from,
.dock-reveal-leave-to {
    opacity: 0;
    clip-path: inset(0 0 0 100%);
    transform: translateX(22px);
}

.is-closing .field-shell {
    opacity: 0;
    clip-path: inset(48% 0);
    transform: translateX(12px);
    transition:
        clip-path 180ms ease,
        opacity 150ms ease,
        transform 180ms ease;
}

.is-locked .drag-zone {
    cursor: default;
}

.is-dragging .field-shell {
    outline: 2px solid var(--ef-signal);
    outline-offset: -3px;
}

@keyframes shell-enter {
    from {
        opacity: 0;
        clip-path: polygon(0 0, 0 0, 0 26px, 0 100%, 0 100%, 0 calc(100% - 18px));
        transform: translateX(-14px);
    }
}

@keyframes signal-wipe {
    0% {
        transform: translateX(-105%);
    }
    46% {
        transform: translateX(0);
    }
    100% {
        transform: translateX(105%);
    }
}

@keyframes state-breathe {
    50% {
        opacity: .42;
        transform: scale(.76);
    }
}

@media (max-width: 680px) {
    .field-shell {
        grid-template-columns: 52px minmax(0, 1fr) 112px;
        grid-template-rows: 68px minmax(0, 1fr) 44px;
    }

    .field-rail {
        padding-inline: 5px;
    }

    .rail-position {
        display: none;
    }

    .header-drag {
        padding-inline: 12px;
    }

    .track-lockup {
        display: block;
    }

    .track-lockup h1 {
        font-size: 16px;
    }

    .track-lockup p {
        margin-top: 4px;
        max-width: none;
        font-size: 9px;
    }

    .header-action {
        min-width: 50px;
        padding-inline: 7px;
    }

    .action-label {
        display: none;
    }

    .lyric-stage {
        padding: 13px;
    }

    .current-line {
        min-height: 96px;
        padding-inline: 18px 14px;
    }

    .next-line {
        grid-template-columns: 66px minmax(0, 1fr);
    }

    .timeline-dock {
        grid-template-columns: 58px minmax(0, 1fr) 58px;
        gap: 8px;
        padding-inline: 10px;
    }
}

@media (max-width: 520px), (orientation: portrait) {
    .endfield-lyric[data-ark-theme='endfield'] {
        padding: 6px;
    }

    .field-shell {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: 52px 68px minmax(160px, 1fr) minmax(82px, 18vh) 46px;
        clip-path: polygon(0 0, calc(100% - 20px) 0, 100% 20px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
    }

    .field-rail {
        grid-column: 1;
        grid-row: 1;
        flex-direction: row;
        gap: 12px;
        padding: 6px 12px 6px 10px;
        border-right: 0;
        border-bottom: 1px solid rgb(25 25 25 / 32%);
    }

    .rail-brand {
        width: auto;
        min-width: 42px;
        padding: 0 10px 0 0;
        border-right: 1px solid rgb(25 25 25 / 24%);
        border-bottom: 0;
    }

    .rail-brand strong {
        font-size: 18px;
    }

    .rail-index {
        width: auto;
        margin: 0;
        font-size: 32px;
        line-height: .9;
    }

    .rail-count {
        display: flex;
        align-items: baseline;
        gap: 4px;
        margin: 0 auto 0 0;
    }

    .rail-status {
        display: flex;
        gap: 6px;
        margin: 0;
    }

    .rail-position {
        display: none;
    }

    .field-header {
        grid-column: 1;
        grid-row: 2;
    }

    .lyric-stage {
        grid-column: 1;
        grid-row: 3;
    }

    .media-field {
        grid-column: 1;
        grid-row: 4;
        border-top: 1px solid var(--ef-rule-strong);
        border-left: 0;
    }

    .media-field img {
        object-position: center 42%;
    }

    .media-caption {
        inset: 0 0 0 auto;
        width: 132px;
        align-content: end;
        background: rgb(15 15 14 / 82%);
        border-top: 0;
        border-left: 1px solid rgb(255 255 255 / 20%);
    }

    .media-controls {
        inset: 0 132px 0 0;
    }

    .timeline-dock {
        grid-column: 1;
        grid-row: 5;
    }

    .control-dock {
        top: auto;
        right: 10px;
        bottom: 10px;
        left: 10px;
        width: auto;
        max-height: calc(100% - 20px);
    }
}

@media (max-height: 310px) and (min-aspect-ratio: 3 / 2) {
    .field-shell {
        grid-template-rows: 58px minmax(0, 1fr) 40px;
    }

    .header-drag {
        padding-block: 7px;
    }

    .header-kicker {
        font-size: 7px;
    }

    .track-lockup {
        margin-top: 5px;
    }

    .lyric-stage {
        padding-block: 9px;
    }

    .current-line {
        min-height: 82px;
        gap: 6px;
        padding-block: 10px 12px;
    }

    .current-line__header,
    .next-line__label {
        font-size: 7px;
    }

    .next-line {
        padding-block: 5px;
    }

    .rail-status {
        margin-bottom: 5px;
    }

    .control-dock {
        top: 8px;
        right: 8px;
        bottom: 8px;
    }
}

.endfield-lyric.is-compact .field-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
}

.endfield-lyric.is-compact .field-rail,
.endfield-lyric.is-compact .field-header,
.endfield-lyric.is-compact .media-field,
.endfield-lyric.is-compact .timeline-dock {
    display: none;
}

.endfield-lyric.is-compact .lyric-stage {
    grid-column: 1;
    grid-row: 1;
    padding: clamp(9px, 2vw, 14px);
    cursor: move;
}

.endfield-lyric.is-compact.is-locked .lyric-stage {
    cursor: default;
}

.endfield-lyric.is-compact .lyric-stack {
    gap: 7px;
    -webkit-app-region: no-drag;
}

.endfield-lyric.is-compact .current-line {
    min-height: 76px;
    gap: 6px;
    padding: 10px 16px 12px 19px;
}

.endfield-lyric.is-compact .next-line {
    grid-template-columns: 72px minmax(0, 1fr);
    gap: 8px;
    padding-block: 5px;
}

.endfield-lyric.is-transparent {
    filter: none;
}

.endfield-lyric.is-transparent .field-shell {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr);
    background: transparent;
    border: 0;
    clip-path: none;
    animation: none;
    transition: background-color 160ms ease;
}

.endfield-lyric.is-transparent:not(.is-locked):hover .field-shell {
    background: color-mix(in srgb, var(--ef-surface) 22%, transparent);
}

.endfield-lyric.is-transparent .field-shell::after,
.endfield-lyric.is-transparent .stage-guides,
.endfield-lyric.is-transparent .lyric-stage::before,
.endfield-lyric.is-transparent .current-line::before,
.endfield-lyric.is-transparent .line-meter {
    display: none;
}

.endfield-lyric.is-transparent .field-rail,
.endfield-lyric.is-transparent .field-header,
.endfield-lyric.is-transparent .media-field,
.endfield-lyric.is-transparent .timeline-dock {
    display: none;
}

.endfield-lyric.is-transparent .lyric-stage {
    grid-column: 1;
    grid-row: 1;
    padding: clamp(9px, 2vw, 14px);
    background: transparent;
    cursor: move;
}

.endfield-lyric.is-transparent.is-locked .lyric-stage {
    cursor: default;
}

.endfield-lyric.is-transparent .lyric-stack {
    gap: 7px;
    -webkit-app-region: no-drag;
}

.endfield-lyric.is-transparent .current-line {
    min-height: 0;
    padding: 8px 12px;
    background: transparent;
    clip-path: none;
}

.endfield-lyric.is-transparent .current-line__header,
.endfield-lyric.is-transparent .next-line__label {
    display: none;
}

.endfield-lyric.is-transparent .current-line__text,
.endfield-lyric.is-transparent .current-line__text::after,
.endfield-lyric.is-transparent .next-line p {
    color: #fff;
    text-shadow: 0 2px 8px rgb(0 0 0 / 80%);
}

.endfield-lyric.is-transparent .current-line__text,
.endfield-lyric.is-transparent .next-line p {
    width: fit-content;
    max-width: 100%;
}

.endfield-lyric.is-transparent .next-line {
    display: block;
    padding: 0 12px;
    border: 0;
}

@media (prefers-contrast: more) {
    .field-shell,
    .current-line,
    .control-dock,
    .source-option {
        border-color: currentColor;
    }
}

@media (prefers-reduced-motion: reduce) {
    .endfield-lyric *,
    .endfield-lyric *::before,
    .endfield-lyric *::after {
        scroll-behavior: auto !important;
        animation: none !important;
        transition-duration: .001ms !important;
    }

    .field-shell::after {
        display: none;
    }
}

@media (update: slow) {
    .endfield-lyric[data-ark-theme='endfield'] {
        filter: none;
    }

    .stage-guides {
        display: none;
    }

    .media-field img {
        filter: grayscale(.35);
        transform: none;
    }
}
</style>
