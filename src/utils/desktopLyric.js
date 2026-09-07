import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import pinia from '../store/pinia';
import { usePlayerStore } from '../store/playerStore';
import { getSongDisplayName } from './songName';

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
let disposeCurrentLyricData = null;
let disposeDesktopLyricClosed = null;

const playerStore = usePlayerStore(pinia);
const {
    currentIndex,
    currentLyricIndex,
    isDesktopLyricOpen,
    localBase64Img,
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
    const currentTime = Math.max(0, Number(progress.value) || 0);
    const duration = Math.max(0, Number(time.value) || 0);

    return {
        type: 'lyric-progress',
        currentIndex: Number.isInteger(currentLyricIndex.value) ? currentLyricIndex.value : -1,
        progress: duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0,
        currentTime,
        duration,
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
    if (!window.electronAPI) return;

    try {
        if (isDesktopLyricOpen.value) {
            const result = await window.electronAPI.closeLyricWindow();
            if (result?.success) {
                playerStore.isDesktopLyricOpen = false;
            }
            return;
        }

        const result = await window.electronAPI.createLyricWindow();
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

    if (window.electronAPI) {
        window.electronAPI.isLyricWindowVisible().then(isVisible => {
            playerStore.isDesktopLyricOpen = isVisible;
        });

        disposeCurrentLyricData = window.electronAPI.getCurrentLyricData(() => {
            sendCurrentLyricData({ force: true });
            sendPlayState({ force: true });
            sendLyricProgress({ force: true });
        });

        disposeDesktopLyricClosed = window.electronAPI.onDesktopLyricClosed(() => {
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
};

export const destroyDesktopLyric = () => {
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
