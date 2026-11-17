import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import pinia from '../store/pinia';
import { usePlayerStore } from '../store/playerStore';
import { getSongDisplayName } from './songName';
import { normalizeLyricWords } from './desktopLyricTiming.mjs';

let lyricProgressInterval = null;
let songChangeTimer = null;
let progressTimer = null;
let bridgeInitialized = false;
let windowStateRevision = 0;
let lyricWindowOperation = null;

let lastSongPayload = null;
let lastProgressPayload = null;
let lastPlayStatePayload = null;

let unwatchPlaying = null;
let unwatchIsDesktopLyricOpen = null;
let unwatchSongSnapshot = null;
let unwatchProgress = null;
let unwatchCurrentLyricIndex = null;
let disposeCurrentLyricData = null;
let disposeDesktopLyricClosed = null;

const playerStore = usePlayerStore(pinia);
const {
    currentIndex,
    currentMusic,
    currentLyricIndex,
    isDesktopLyricOpen,
    localBase64Img,
    lyricsObjArr,
    playing,
    playbackRate,
    progress,
    showSongTranslation,
    songId,
    songList,
    time,
} = storeToRefs(playerStore);

function clearSongChangeTimer() {
    if (!songChangeTimer) return;

    clearTimeout(songChangeTimer);
    songChangeTimer = null;
}

function clearProgressTimer() {
    if (!progressTimer) return;

    clearTimeout(progressTimer);
    progressTimer = null;
}

function stopDesktopLyricSync() {
    if (!lyricProgressInterval) return;

    clearInterval(lyricProgressInterval);
    lyricProgressInterval = null;
}

function startDesktopLyricSync() {
    stopDesktopLyricSync();
    if (!isDesktopLyricOpen.value || !playing.value) return;

    lyricProgressInterval = setInterval(() => {
        sendLyricProgress();
    }, 300);
}

function serializePayload(payload) {
    try {
        return JSON.stringify(payload);
    } catch (_) {
        return '';
    }
}

function pushPayload(payload, { force = false } = {}) {
    if (!window.electronAPI || !payload || !payload.type) return;

    const serialized = serializePayload(payload);
    let lastSnapshot = null;

    if (payload.type === 'song-change') lastSnapshot = lastSongPayload;
    if (payload.type === 'lyric-progress') lastSnapshot = lastProgressPayload;
    if (payload.type === 'play-state') lastSnapshot = lastPlayStatePayload;

    if (!force && serialized && serialized === lastSnapshot) return;

    if (payload.type === 'song-change') lastSongPayload = serialized;
    if (payload.type === 'lyric-progress') lastProgressPayload = serialized;
    if (payload.type === 'play-state') lastPlayStatePayload = serialized;

    window.electronAPI.updateLyricData(payload);
}

function buildSongChangePayload() {
    const list = Array.isArray(songList.value) ? songList.value : [];
    const index = Number.isInteger(currentIndex.value) ? currentIndex.value : -1;
    const currentSong = index >= 0 && index < list.length ? list[index] : null;
    const rawArtists = currentSong?.ar || currentSong?.artist;
    const artists = Array.isArray(rawArtists) ? rawArtists : [rawArtists].filter(Boolean);

    return {
        type: 'song-change',
        song: currentSong
            ? {
                  name: String(getSongDisplayName(currentSong, '未知歌曲', showSongTranslation.value)),
                  ar: artists.length
                      ? artists.map(artist => ({
                            name: String(typeof artist === 'string' ? artist : artist?.name || '未知艺术家'),
                        }))
                      : [{ name: '未知艺术家' }],
                  coverUrl: String(
                      currentSong.coverUrl ||
                          currentSong.al?.picUrl ||
                          currentSong.blurPicUrl ||
                          currentSong.img1v1Url ||
                          localBase64Img.value ||
                          '',
                  ),
                  type: String(currentSong.type || 'online'),
              }
            : null,
        lyrics: Array.isArray(lyricsObjArr.value)
            ? lyricsObjArr.value.map(row => ({
                  lyric: String(row?.lyric || ''),
                  tlyric: String(row?.tlyric || ''),
                  rlyric: String(row?.rlyric || ''),
                  time: Number(row?.time || 0),
                  words: normalizeLyricWords(row?.words, row?.lyric),
              }))
            : [],
    };
}

function buildPlayStatePayload() {
    return {
        type: 'play-state',
        playing: !!playing.value,
    };
}

function buildLyricProgressPayload() {
    // The store samples progress once a second; word sync needs the live audio clock.
    let currentTime = Math.max(0, Number(progress.value) || 0);
    let advancing = !!playing.value;
    try {
        const seek = currentMusic.value?.seek?.();
        if (typeof seek === 'number' && Number.isFinite(seek)) currentTime = Math.max(0, seek);
        if (typeof currentMusic.value?.playing === 'function') advancing &&= !!currentMusic.value.playing();
    } catch (_) {}
    const duration = Math.max(0, Number(time.value) || 0);

    return {
        type: 'lyric-progress',
        currentIndex: Number.isInteger(currentLyricIndex.value) ? currentLyricIndex.value : -1,
        progress: duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0,
        currentTime,
        duration,
        playbackRate: Number(playbackRate.value) || 1,
        advancing,
    };
}

function sendCurrentLyricData(options = {}) {
    if (!isDesktopLyricOpen.value || !window.electronAPI) return;
    pushPayload(buildSongChangePayload(), options);
}

function sendPlayState(options = {}) {
    if (!isDesktopLyricOpen.value || !window.electronAPI) return;
    pushPayload(buildPlayStatePayload(), options);
}

function sendLyricProgress(options = {}) {
    if (!isDesktopLyricOpen.value || !window.electronAPI) return;
    pushPayload(buildLyricProgressPayload(), options);
}

function scheduleSongChangePush(delayMs = 0, options = {}) {
    if (!isDesktopLyricOpen.value) return;

    clearSongChangeTimer();
    songChangeTimer = setTimeout(() => {
        songChangeTimer = null;
        sendCurrentLyricData(options);
        sendLyricProgress({ force: true });
    }, delayMs);
}

function scheduleProgressPush(delayMs = 0, options = {}) {
    if (!isDesktopLyricOpen.value) return;

    clearProgressTimer();
    progressTimer = setTimeout(() => {
        progressTimer = null;
        sendLyricProgress(options);
    }, delayMs);
}

function rememberDesktopLyricState(enabled) {
    if (playerStore.desktopLyricEnabled === enabled) return;
    playerStore.desktopLyricEnabled = enabled;
    // 不等下一次播放进度保存，手动切换后立即退出也应保留选择。
    playerStore.$persist?.();
}

async function runLyricWindowOperation(action) {
    if (lyricWindowOperation) return;
    const operation = action();
    lyricWindowOperation = operation;
    try {
        await operation;
    } catch (_) {
        // 窗口失败只影响本次实际状态，不清除下次启动的恢复偏好。
    } finally {
        if (lyricWindowOperation === operation) lyricWindowOperation = null;
    }
}

async function openDesktopLyricWindow(revision) {
    const result = await window.electronAPI.createLyricWindow();
    if (revision !== windowStateRevision || !result?.success) return;

    rememberDesktopLyricState(true);
    playerStore.isDesktopLyricOpen = true;
    // 已加载的窗口立即同步；新窗口还会在挂载后 requestLyricData 获取完整快照。
    sendCurrentLyricData({ force: true });
    sendPlayState({ force: true });
    sendLyricProgress({ force: true });
}

async function restoreDesktopLyricWindow(revision) {
    try {
        const isVisible = await window.electronAPI.isLyricWindowVisible();
        if (revision !== windowStateRevision || !bridgeInitialized) return;

        playerStore.isDesktopLyricOpen = Boolean(isVisible);
        if (isVisible) {
            rememberDesktopLyricState(true);
        } else if (playerStore.desktopLyricEnabled === true) {
            await runLyricWindowOperation(() => openDesktopLyricWindow(revision));
        }
    } catch (_) {
        // 原生桥接不可用时保留偏好，不影响播放器启动。
    }
}

export const toggleDesktopLyric = async () => {
    if (!window.electronAPI || lyricWindowOperation) return;
    const revision = ++windowStateRevision;

    await runLyricWindowOperation(async () => {
        if (isDesktopLyricOpen.value) {
            const result = await window.electronAPI.closeLyricWindow();
            if (revision === windowStateRevision && result?.success) {
                rememberDesktopLyricState(false);
                playerStore.isDesktopLyricOpen = false;
            }
            return;
        }

        await openDesktopLyricWindow(revision);
    });
};

export const initDesktopLyric = () => {
    if (bridgeInitialized) return;
    bridgeInitialized = true;
    const revision = ++windowStateRevision;

    if (window.electronAPI) {
        disposeCurrentLyricData = window.electronAPI.getCurrentLyricData(() => {
            sendCurrentLyricData({ force: true });
            sendPlayState({ force: true });
            sendLyricProgress({ force: true });
        });

        disposeDesktopLyricClosed = window.electronAPI.onDesktopLyricClosed(() => {
            // 该通知来自歌词窗口里的手动关闭按钮，不是应用退出时的窗口销毁。
            windowStateRevision += 1;
            rememberDesktopLyricState(false);
            playerStore.isDesktopLyricOpen = false;
        });
    }

    unwatchPlaying = watch(
        () => playing.value,
        isPlaying => {
            sendPlayState({ force: true });

            if (isPlaying) {
                startDesktopLyricSync();
                sendLyricProgress({ force: true });
                return;
            }

            stopDesktopLyricSync();
            sendLyricProgress({ force: true });
        },
        { immediate: true }
    );

    unwatchIsDesktopLyricOpen = watch(
        () => isDesktopLyricOpen.value,
        isOpen => {
            if (isOpen) {
                sendCurrentLyricData({ force: true });
                sendPlayState({ force: true });
                sendLyricProgress({ force: true });
                startDesktopLyricSync();
                return;
            }

            stopDesktopLyricSync();
            clearSongChangeTimer();
            clearProgressTimer();
        },
        { immediate: true }
    );

    unwatchSongSnapshot = watch(
        () => [songId.value, currentIndex.value, lyricsObjArr.value, showSongTranslation.value, localBase64Img.value],
        () => {
            scheduleSongChangePush(0);
        }
    );

    unwatchProgress = watch(
        () => progress.value,
        (nextProgress, previousProgress) => {
            if (!isDesktopLyricOpen.value) return;
            if (!playing.value) {
                scheduleProgressPush(0, { force: true });
                return;
            }

            if (typeof previousProgress !== 'number' || Math.abs(nextProgress - previousProgress) > 1.2) {
                scheduleProgressPush(0, { force: true });
            }
        }
    );

    unwatchCurrentLyricIndex = watch(
        () => currentLyricIndex.value,
        () => {
            if (!isDesktopLyricOpen.value || playing.value) return;
            scheduleProgressPush(0, { force: true });
        }
    );

    if (window.electronAPI) void restoreDesktopLyricWindow(revision);
};

export const destroyDesktopLyric = () => {
    // 失效启动期间仍未返回的 IPC；退出时只清理运行态，不改用户开关偏好。
    windowStateRevision += 1;
    lyricWindowOperation = null;
    stopDesktopLyricSync();
    clearSongChangeTimer();
    clearProgressTimer();

    disposeCurrentLyricData?.();
    disposeCurrentLyricData = null;
    disposeDesktopLyricClosed?.();
    disposeDesktopLyricClosed = null;

    if (unwatchPlaying) {
        unwatchPlaying();
        unwatchPlaying = null;
    }
    if (unwatchIsDesktopLyricOpen) {
        unwatchIsDesktopLyricOpen();
        unwatchIsDesktopLyricOpen = null;
    }
    if (unwatchSongSnapshot) {
        unwatchSongSnapshot();
        unwatchSongSnapshot = null;
    }
    if (unwatchProgress) {
        unwatchProgress();
        unwatchProgress = null;
    }
    if (unwatchCurrentLyricIndex) {
        unwatchCurrentLyricIndex();
        unwatchCurrentLyricIndex = null;
    }

    lastSongPayload = null;
    lastProgressPayload = null;
    lastPlayStatePayload = null;
    bridgeInitialized = false;
};
