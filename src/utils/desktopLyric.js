import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import pinia from '../store/pinia';
import { usePlayerStore } from '../store/playerStore';
import { getSongDisplayName } from './songName';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';

let lyricProgressInterval = null;
let songChangeTimer = null;
let progressTimer = null;
let bridgeInitialized = false;

let lastSongPayload = null;
let lastProgressPayload = null;
let lastPlayStatePayload = null;

let unwatchPlaying = null;
let unwatchIsDesktopLyricOpen = null;
let unwatchSongSnapshot = null;
let unwatchProgress = null;
let unwatchCurrentLyricIndex = null;

const playerStore = usePlayerStore(pinia);
const {
    currentIndex,
    currentLyricIndex,
    isDesktopLyricOpen,
    lyricsObjArr,
    playing,
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
    if (!payload || !payload.type) return;

    const serialized = serializePayload(payload);
    let lastSnapshot = null;

    if (payload.type === 'song-change') lastSnapshot = lastSongPayload;
    if (payload.type === 'lyric-progress') lastSnapshot = lastProgressPayload;
    if (payload.type === 'play-state') lastSnapshot = lastPlayStatePayload;

    if (!force && serialized && serialized === lastSnapshot) return;

    if (payload.type === 'song-change') lastSongPayload = serialized;
    if (payload.type === 'lyric-progress') lastProgressPayload = serialized;
    if (payload.type === 'play-state') lastPlayStatePayload = serialized;

    emit('lyric-update', payload).catch(() => {});
}

function buildSongChangePayload() {
    const list = Array.isArray(songList.value) ? songList.value : [];
    const index = Number.isInteger(currentIndex.value) ? currentIndex.value : -1;
    const currentSong = index >= 0 && index < list.length ? list[index] : null;

    return {
        type: 'song-change',
        song: currentSong
            ? {
                  name: String(getSongDisplayName(currentSong, '未知歌曲', showSongTranslation.value)),
                  ar: Array.isArray(currentSong.ar)
                      ? currentSong.ar.map(artist => ({ name: String(artist?.name || '未知艺术家') }))
                      : [{ name: '未知艺术家' }],
                  type: String(currentSong.type || 'online'),
              }
            : null,
        lyrics: Array.isArray(lyricsObjArr.value)
            ? lyricsObjArr.value.map(row => ({
                  lyric: String(row?.lyric || ''),
                  tlyric: String(row?.tlyric || ''),
                  rlyric: String(row?.rlyric || ''),
                  time: Number(row?.time || 0),
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
    return {
        type: 'lyric-progress',
        currentIndex: Number.isInteger(currentLyricIndex.value) ? currentLyricIndex.value : -1,
        progress: Number(progress.value || 0),
        currentTime: Number((progress.value / 100) * time.value || 0),
    };
}

function sendCurrentLyricData(options = {}) {
    if (!isDesktopLyricOpen.value) return;
    pushPayload(buildSongChangePayload(), options);
}

function sendPlayState(options = {}) {
    if (!isDesktopLyricOpen.value) return;
    pushPayload(buildPlayStatePayload(), options);
}

function sendLyricProgress(options = {}) {
    if (!isDesktopLyricOpen.value) return;
    pushPayload(buildLyricProgressPayload(), options);
}

function scheduleSongChangePush(delayMs = 0, options = {}) {
    if (!isDesktopLyricOpen.value) return;

    clearSongChangeTimer();
    songChangeTimer = setTimeout(() => {
        songChangeTimer = null;
        sendCurrentLyricData(options);
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

export const toggleDesktopLyric = async () => {
    try {
        if (isDesktopLyricOpen.value) {
            const result = await invoke('close_lyric_window');
            if (result?.success) {
                playerStore.isDesktopLyricOpen = false;
            }
            return;
        }

        const result = await invoke('create_lyric_window');
        if (result?.success) {
            playerStore.isDesktopLyricOpen = true;
            setTimeout(() => {
                sendCurrentLyricData({ force: true });
                sendPlayState({ force: true });
                sendLyricProgress({ force: true });
            }, 200);
        }
    } catch (_) {
        // ignore window bridge errors
    }
};

export const initDesktopLyric = () => {
    if (bridgeInitialized) return;
    bridgeInitialized = true;

    // 恢复歌词窗口状态
    invoke('is_lyric_window_visible').then(isVisible => {
        playerStore.isDesktopLyricOpen = isVisible;
    }).catch(() => {});

    // 监听主窗口请求当前歌词数据
    listen('request-lyric-data', () => {
        sendCurrentLyricData({ force: true });
        sendPlayState({ force: true });
        sendLyricProgress({ force: true });
    });

    // 监听桌面歌词窗口关闭事件
    listen('desktop-lyric-closed', () => {
        playerStore.isDesktopLyricOpen = false;
    });

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
        () => [songId.value, currentIndex.value, lyricsObjArr.value, showSongTranslation.value],
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
};

export const destroyDesktopLyric = () => {
    stopDesktopLyricSync();
    clearSongChangeTimer();
    clearProgressTimer();

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
