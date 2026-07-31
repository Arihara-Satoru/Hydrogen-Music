<template>
  <section
    class="personal-fm"
    :class="{ 'fm-cover-interrupting': coverInterrupting }"
    data-ark-theme="adaptive"
    data-ark-light-theme="endfield"
    data-ark-dark-theme="exa"
    data-ark-depth="moderate"
    aria-labelledby="personal-fm-title"
  >
    <div class="fm-stage">
      <div
        class="fm-panel"
        :class="{
          'fm-panel-intro-active': isPanelIntroActive,
          'fm-panel-outline-ready': isPanelOutlineReady,
        }"
      >
        <div class="fm-outline-draw" aria-hidden="true">
          <span class="outline-seg top"></span>
          <span class="outline-seg right"></span>
          <span class="outline-seg bottom"></span>
          <span class="outline-seg left"></span>
        </div>
        <aside class="fm-archive-rail" aria-label="私人漫游档案">
          <span class="archive-index">01</span>
          <span class="archive-rule" aria-hidden="true"></span>
          <span class="archive-name">PERSONAL FM</span>
          <span class="archive-status">PRIVATE ROAMING</span>
        </aside>
        <div
          class="fm-mode-floating"
          ref="modePanelRef"
          :class="{ open: modePanelOpen }"
        >
          <button
            type="button"
            class="fm-mode-trigger"
            :disabled="loading || modeSwitching"
            :aria-expanded="modePanelOpen"
            aria-controls="fm-mode-options"
            @click.stop="toggleModePanel"
          >
            <span class="mode-trigger-code">ROAMING MODE</span>
            <span class="mode-trigger-value">{{ selectedFmModeSummary }}</span>
            <svg
              class="mode-trigger-arrow"
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M7 10l5 5 5-5z" />
            </svg>
          </button>
          <Transition name="fm-mode-float">
            <div
              v-if="modePanelOpen"
              id="fm-mode-options"
              class="fm-mode-dropdown"
              role="group"
              aria-label="私人漫游模式"
              @click.stop
            >
              <div class="fm-mode-title">
                <span class="fm-mode-title-code">SELECT ROUTE</span>
                <span class="fm-mode-title-text">{{
                  selectedFmModeSummary
                }}</span>
              </div>
              <div class="fm-mode-grid">
                <button
                  v-for="mode in FM_MODE_OPTIONS"
                  :key="mode.value"
                  type="button"
                  class="fm-mode-btn"
                  :class="{ active: selectedFmMode === mode.value }"
                  :aria-pressed="selectedFmMode === mode.value"
                  :disabled="loading || modeSwitching"
                  @click="changeFmMode(mode.value)"
                >
                  <span class="mode-code">{{ mode.value }}</span>
                  <span class="mode-label">{{ mode.label }}</span>
                </button>
              </div>
              <div v-if="selectedFmMode === 'ai_pool'" class="fm-submode-grid">
                <button
                  v-for="scene in FM_SCENE_SUBMODE_OPTIONS"
                  :key="scene.value"
                  type="button"
                  class="fm-submode-btn"
                  :class="{ active: selectedFmSubmode === scene.value }"
                  :aria-pressed="selectedFmSubmode === scene.value"
                  :disabled="loading || modeSwitching"
                  @click="changeFmSubmode(scene.value)"
                >
                  <span class="mode-code">{{ scene.value }}</span>
                  <span class="mode-label">{{ scene.label }}</span>
                </button>
              </div>
            </div>
          </Transition>
        </div>

        <div class="fm-header">
          <p class="fm-headline">PERSONAL ARCHIVE / 01</p>
          <h1 id="personal-fm-title">
            私人
            <em>漫游</em>
          </h1>
          <p class="fm-subtitle">沿着你的听觉轨迹，抵达下一首音乐。</p>
        </div>

        <div class="fm-content" v-if="currentSong && !loading">
          <div class="fm-main">
            <div class="fm-cover-carousel" aria-label="漫游歌曲序列">
              <TransitionGroup
                :name="coverTransitionName"
                :css="!modeSwitching"
                tag="div"
                class="fm-cover-track"
              >
                <button
                  v-for="item in coverTrackItems"
                  :key="item.key"
                  type="button"
                  class="fm-cover-slot"
                  :class="[
                    `slot-${item.role}`,
                    {
                      'slot-center': item.role === 'center',
                      'slot-side': item.role !== 'center',
                      'slot-placeholder': item.isPlaceholder,
                      'slot-clickable': item.clickable,
                    },
                  ]"
                  :disabled="!item.clickable"
                  :aria-label="
                    item.role === 'center'
                      ? isPlaying
                        ? '暂停当前歌曲'
                        : '播放当前歌曲'
                      : item.role === 'left'
                        ? '播放上一首'
                        : '播放下一首'
                  "
                  :aria-pressed="item.role === 'center' ? isPlaying : undefined"
                  @click="handleCoverSlotClick(item)"
                >
                  <template v-if="item.song && !item.isPlaceholder">
                    <img
                      :src="
                        getFmSongCover(item.song) ||
                        '/src/assets/img/default-cover.svg'
                      "
                      :alt="
                        item.role === 'center'
                          ? `${item.song.name || '当前歌曲'}封面`
                          : ''
                      "
                    />
                    <span v-if="item.role === 'center'" class="fm-play-overlay">
                      <svg
                        v-if="!isPlaying"
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                      <svg
                        v-else
                        width="40"
                        height="40"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                      </svg>
                    </span>
                    <span v-else class="slot-side-overlay" aria-hidden="true"></span>
                  </template>
                  <template v-else>
                    <span class="slot-placeholder-text">
                      {{ item.placeholderText }}
                    </span>
                  </template>
                </button>
              </TransitionGroup>
            </div>

            <article class="fm-dossier" aria-labelledby="fm-current-song">
              <div class="fm-info">
              <p class="fm-record-kicker">
                CURRENT RECORD / {{ currentIndex + 1 }}
              </p>
              <h2 id="fm-current-song" class="song-name">
                {{ getSongDisplayName(currentSong, "", showSongTranslation) }}
              </h2>
              <p class="artist-name">
                <template
                  v-for="(artist, index) in currentSongArtists"
                  :key="artist?.id || artist?.name || index"
                >
                  <button
                    v-if="canOpenArtist(artist)"
                    type="button"
                    class="artist-link clickable"
                    @click="openArtist(artist)"
                  >
                    {{ artist?.name || "" }}
                  </button>
                  <span v-else class="artist-link">
                    {{ artist?.name || "" }}
                  </span>
                  <span
                    v-if="index != currentSongArtists.length - 1"
                    class="artist-separator"
                    >/</span
                  >
                </template>
              </p>
              <button
                v-if="canOpenAlbum(currentSongAlbum)"
                type="button"
                class="album-name clickable"
                @click="openAlbum(currentSongAlbum)"
              >
                {{ getFmSongAlbumName(currentSong) }}
              </button>
              <p v-else class="album-name">
                {{ getFmSongAlbumName(currentSong) }}
              </p>
              </div>

            <div class="fm-actions" aria-label="播放决策">
            <button
              type="button"
              class="action-btn prev"
              :disabled="currentIndex <= 0"
              @click="goPrev"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
              </svg>
              <span><small>PREV</small>上一首</span>
            </button>

            <button
              type="button"
              class="action-btn trash"
              @click="trashSong"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                />
              </svg>
              <span><small>SKIP</small>不喜欢</span>
            </button>

            <button
              type="button"
              class="action-btn like"
              @click="likeSong"
              :class="{ active: isCurrentSongLiked }"
              :aria-pressed="isCurrentSongLiked"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
                />
              </svg>
              <span><small>SAVE</small>喜欢</span>
            </button>

            <button type="button" class="action-btn next" @click="goNext">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
              <span><small>NEXT</small>下一首</span>
            </button>
            </div>
            </article>
          </div>
          <div class="fm-status-strip" aria-label="漫游状态">
            <span>
              <small>ARCHIVE POSITION</small>
              <strong>{{ currentIndex + 1 }} / {{ playedSongs.length }}</strong>
            </span>
            <span>
              <small>NEXT RECORD</small>
              <strong>{{
                isPrefetching
                  ? "检索中"
                  : nextCandidateSong
                    ? "已就绪"
                    : "待检索"
              }}</strong>
            </span>
          </div>
        </div>

        <div class="fm-loading" v-else-if="loading" aria-live="polite">
          <div class="loading-spinner" aria-hidden="true"></div>
          <p class="state-kicker">RECONSTRUCTING ROUTE</p>
          <p>正在为你准备音乐...</p>
        </div>

        <div class="fm-empty" v-else>
          <div class="empty-icon" aria-hidden="true">
            <svg width="60" height="60" viewBox="0 0 24 24" fill="currentColor">
              <path
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
              />
            </svg>
          </div>
          <p class="state-kicker">ROUTE UNAVAILABLE</p>
          <p>无法加载漫游歌曲</p>
          <p class="error-hint">请检查网络连接或稍后重试</p>
          <button type="button" class="refresh-button" @click="refreshFM()">
            重新检索
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import {
  ref,
  onMounted,
  onUnmounted,
  onActivated,
  onDeactivated,
  computed,
  watch,
} from "vue";
import { useRouter } from "vue-router";
import {
  getPersonalFM,
  getPersonalFMByMode,
  fmTrash,
  getLyric,
  likeMusic,
} from "../api/song";
import { getRecommendSongs, normalizePlaylistSong } from "../api/playlist";
import { usePlayerStore } from "../store/playerStore";
import { useUserStore } from "../store/userStore";
import { useLibraryStore } from "../store/libraryStore";
import { noticeOpen } from "../utils/dialog";
import { mapSongsPlayableStatus } from "../utils/songStatus";
import {
  applyOptimisticLikeState,
  createLikeActionToken,
  getFavoritePlaylistNoticeText,
  getLikeActionErrorMessage,
  isActiveLikeActionToken,
  play,
  playCurrentSongChorus,
  pauseMusic,
  queueLikeRequest,
  setSongLevel,
  startMusic,
  syncLikelistAfterLikeAction,
  updateFavoritePlaylistTrack,
} from "../utils/player";
import { schedulePlaylistCacheInvalidation } from "../utils/cacheInvalidation";
import { storeToRefs } from "pinia";
import { getPreferredQuality } from "../utils/quality";
import { resolveTrackByQualityPreference } from "../utils/musicUrlResolver";
import { getSongDisplayName } from "../utils/songName";

const router = useRouter();
const playerStore = usePlayerStore();
const userStore = useUserStore();
const libraryStore = useLibraryStore();
const { songId, playing, progress, quality, showSongTranslation, time, chorusMode } =
  storeToRefs(playerStore);
const { likelist } = storeToRefs(userStore);

// 创建一个计算属性来实时判断当前歌曲是否被喜欢
const isCurrentSongLiked = computed(() => {
  if (!currentSong.value || !likelist.value) {
    return false;
  }
  return likelist.value.includes(currentSong.value.id);
});
const currentSongArtists = computed(() => getFmSongArtists(currentSong.value));
const currentSongAlbum = computed(() => getFmSongAlbum(currentSong.value));

const fmSongs = ref([]);
const playedSongs = ref([]); // 已播放的歌曲历史（用于前后切换浏览）
const lastLoadedUserId = ref(null);
// 去重与“近期不重复”控制
const fmPoolIds = new Set(); // 当前候选池中的歌曲ID，避免同一池内重复（仅内存，用于本次池）
const recentPlayedSet = new Set(); // 近期播放过的歌曲集合（窗口集合）
const recentPlayedQueue = []; // 维护顺序的队列，配合 recentPlayedSet 形成滑动窗口
const RECENT_WINDOW = 300; // 近期去重窗口大小，避免短期内重复
const FM_REFRESH_SOURCE = Object.freeze({
  PERSONAL_FM: "personal_fm",
  FM_MODE_RESCUE: "fm_mode_rescue",
  DAILY_RECOMMEND: "daily_recommend",
});
// 酷狗文档中的私人漫游模式只有 normal / small / peak，
// 另外 song_pool_id 可切换 3 组 AI 推荐池。
const FM_MODE_RESCUE_OPTIONS = Object.freeze({ mode: "small" });
const DEFAULT_FM_MODE = "normal";
const DEFAULT_SCENE_SUBMODE = "0";
const FM_MODE_OPTIONS = Object.freeze([
  { value: "normal", label: "发现推荐" },
  { value: "small", label: "小众模式" },
  { value: "peak", label: "30秒高潮" },
  { value: "ai_pool", label: "AI推荐池" },
]);
const FM_SCENE_SUBMODE_OPTIONS = Object.freeze([
  { value: "0", label: "Alpha 相似口味" },
  { value: "1", label: "Beta 相似风格" },
  { value: "2", label: "Gamma 推荐池" },
]);
const lastRefreshSource = ref(FM_REFRESH_SOURCE.PERSONAL_FM);
const selectedFmMode = ref(DEFAULT_FM_MODE);
const selectedFmSubmode = ref(DEFAULT_SCENE_SUBMODE);
const modeSwitching = ref(false);
const modePanelOpen = ref(false);
const modePanelRef = ref(null);
const awaitingSceneSubmodePick = ref(false);

// 仅持久化“近期去重队列”（按账号隔离）
function getRecentQueueKey() {
  const uid = userStore?.user?.userId || "guest";
  return `hm.fm.recentPlayedQueue:${uid}`;
}

function safeParseArray(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function normalizeSongId(id) {
  if (id === null || id === undefined || id === "") return null;
  return String(id);
}

function getPrimarySongId(song) {
  if (!song || typeof song != "object") return null;
  if (
    song.album_audio_id !== undefined &&
    song.album_audio_id !== null &&
    song.album_audio_id !== ""
  )
    return song.album_audio_id;
  if (
    song.mixsongid !== undefined &&
    song.mixsongid !== null &&
    song.mixsongid !== ""
  )
    return song.mixsongid;
  if (
    song.mixsong_id !== undefined &&
    song.mixsong_id !== null &&
    song.mixsong_id !== ""
  )
    return song.mixsong_id;
  if (
    song.audio_id !== undefined &&
    song.audio_id !== null &&
    song.audio_id !== ""
  )
    return song.audio_id;
  if (song.songid !== undefined && song.songid !== null && song.songid !== "")
    return song.songid;
  if (song.id !== undefined && song.id !== null && song.id !== "")
    return song.id;
  if (song.songId !== undefined && song.songId !== null && song.songId !== "")
    return song.songId;
  if (
    song.trackId !== undefined &&
    song.trackId !== null &&
    song.trackId !== ""
  )
    return song.trackId;
  const nestedSong = song.song;
  if (nestedSong && typeof nestedSong == "object") {
    if (
      nestedSong.id !== undefined &&
      nestedSong.id !== null &&
      nestedSong.id !== ""
    )
      return nestedSong.id;
    if (
      nestedSong.songId !== undefined &&
      nestedSong.songId !== null &&
      nestedSong.songId !== ""
    )
      return nestedSong.songId;
    if (
      nestedSong.trackId !== undefined &&
      nestedSong.trackId !== null &&
      nestedSong.trackId !== ""
    )
      return nestedSong.trackId;
  }
  return null;
}

function getFmSongArtists(song) {
  if (!song || typeof song != "object") return [];
  if (Array.isArray(song.singerinfo) && song.singerinfo.length > 0)
    return song.singerinfo;
  if (Array.isArray(song.artists) && song.artists.length > 0)
    return song.artists;
  if (Array.isArray(song.ar) && song.ar.length > 0) return song.ar;
  const nestedSong = song.song;
  if (nestedSong && typeof nestedSong == "object") {
    if (Array.isArray(nestedSong.artists) && nestedSong.artists.length > 0)
      return nestedSong.artists;
    if (Array.isArray(nestedSong.ar) && nestedSong.ar.length > 0)
      return nestedSong.ar;
  }
  return [];
}

function hasSongMetaObject(value) {
  return !!(
    value &&
    typeof value == "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function getFmSongAlbum(song) {
  if (!song || typeof song != "object") return null;
  if (hasSongMetaObject(song.albuminfo)) return song.albuminfo;
  if (hasSongMetaObject(song.album)) return song.album;
  if (hasSongMetaObject(song.al)) return song.al;
  const nestedSong = song.song;
  if (nestedSong && typeof nestedSong == "object") {
    if (hasSongMetaObject(nestedSong.album)) return nestedSong.album;
    if (hasSongMetaObject(nestedSong.al)) return nestedSong.al;
  }
  return null;
}

function getFmSongCover(song) {
  if (!song || typeof song != "object") return null;
  if (song.album_sizable_cover)
    return String(song.album_sizable_cover).replace("{size}", "480");
  if (song.trans_param?.union_cover)
    return String(song.trans_param.union_cover).replace("{size}", "480");
  if (song.cover) return String(song.cover).replace("{size}", "480");
  if (song.coverUrl) return song.coverUrl;
  if (song.al?.picUrl) return song.al.picUrl;
  if (song.album?.picUrl) return song.album.picUrl;
  if (song.blurPicUrl) return song.blurPicUrl;
  if (song.img1v1Url) return song.img1v1Url;
  const nestedSong = song.song;
  if (nestedSong && typeof nestedSong == "object") {
    if (nestedSong.coverUrl) return nestedSong.coverUrl;
    if (nestedSong.al?.picUrl) return nestedSong.al.picUrl;
    if (nestedSong.album?.picUrl) return nestedSong.album.picUrl;
    if (nestedSong.blurPicUrl) return nestedSong.blurPicUrl;
    if (nestedSong.img1v1Url) return nestedSong.img1v1Url;
  }
  return null;
}

function getFmSongArtistsText(song) {
  return getFmSongArtists(song)
    .map((artist) => artist?.name || "")
    .filter(Boolean)
    .join(" / ");
}

function getFmSongAlbumName(song) {
  return (
    song?.album?.name ||
    song?.al?.name ||
    song?.song?.album?.name ||
    song?.song?.al?.name ||
    ""
  );
}

function getArtistId(artist) {
  if (!artist || typeof artist != "object") return null;
  if (artist.id !== undefined && artist.id !== null && artist.id !== "")
    return artist.id;
  if (
    artist.artistId !== undefined &&
    artist.artistId !== null &&
    artist.artistId !== ""
  )
    return artist.artistId;
  return null;
}

function getAlbumId(album) {
  if (!album || typeof album != "object") return null;
  if (album.id !== undefined && album.id !== null && album.id !== "")
    return album.id;
  if (
    album.albumId !== undefined &&
    album.albumId !== null &&
    album.albumId !== ""
  )
    return album.albumId;
  return null;
}

function canOpenArtist(artist) {
  return !!getArtistId(artist);
}

function canOpenAlbum(album) {
  return !!getAlbumId(album);
}

function openArtist(artist) {
  const artistId = getArtistId(artist);
  if (!artistId) return;
  playerStore.forbidLastRouter = true;
  router.push("/mymusic/artist/" + artistId);
}

function openAlbum(album) {
  const albumId = getAlbumId(album);
  if (!albumId) return;
  playerStore.forbidLastRouter = true;
  router.push("/mymusic/album/" + albumId);
}

function normalizeFmSong(song) {
  if (!song || typeof song != "object") return null;
  // 复用全局酷狗歌曲标准化，保证私人漫游与其他歌单字段保持一致。
  const normalizedSong = normalizePlaylistSong(song);
  const primaryId = getPrimarySongId(normalizedSong);
  const normalizedId = normalizeSongId(primaryId);
  if (!normalizedId) return null;

  const artists = getFmSongArtists(normalizedSong).map((artist) => ({
    ...(artist || {}),
  }));
  const rawAlbum = getFmSongAlbum(normalizedSong);
  const album = rawAlbum && typeof rawAlbum == "object" ? { ...rawAlbum } : {};
  const coverUrl = getFmSongCover(normalizedSong);

  if (coverUrl && !album.picUrl) album.picUrl = coverUrl;

  const parsedDuration = Number(
    normalizedSong.dt ??
      normalizedSong.duration ??
      normalizedSong.timelength ??
      (Number(normalizedSong.time_length || 0) > 0
        ? Number(normalizedSong.time_length) * 1000
        : 0),
  );
  const duration =
    Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : 0;
  const tns = Array.isArray(normalizedSong.tns)
    ? [...normalizedSong.tns]
    : Array.isArray(normalizedSong.song?.tns)
      ? [...normalizedSong.song.tns]
      : [];
  const transNames = Array.isArray(normalizedSong.transNames)
    ? [...normalizedSong.transNames]
    : Array.isArray(normalizedSong.song?.transNames)
      ? [...normalizedSong.song.transNames]
      : [];

  return {
    ...normalizedSong,
    ...song,
    id: normalizedId,
    hash: normalizedSong.hash || song.hash || song.hash_128 || "",
    songid:
      song.songid ||
      song.songId ||
      normalizedSong.songid ||
      normalizedSong.songId ||
      normalizedId,
    mixsongid:
      song.mixsongid ||
      song.mixsong_id ||
      song.album_audio_id ||
      normalizedSong.mixsongid ||
      normalizedSong.album_audio_id ||
      "",
    album_audio_id:
      song.album_audio_id ||
      song.mixsongid ||
      song.mixsong_id ||
      normalizedSong.album_audio_id ||
      normalizedSong.mixsongid ||
      "",
    name:
      normalizedSong.name ||
      song.songname ||
      song.name ||
      song.song?.name ||
      "",
    artists,
    ar: artists,
    album,
    al: album,
    dt: duration,
    duration,
    coverUrl: coverUrl || null,
    tns,
    transNames,
    type: "fm",
    source: "personalfm",
  };
}

function loadPersistentRecent() {
  // 清空并加载“近期播放队列”（按账号隔离）
  recentPlayedQueue.length = 0;
  recentPlayedSet.clear();
  const recentArr = safeParseArray(localStorage.getItem(getRecentQueueKey()));
  for (const rawId of recentArr) {
    const id = normalizeSongId(rawId);
    if (!id) continue;
    recentPlayedQueue.push(id);
    recentPlayedSet.add(id);
  }
}

function persistRecent() {
  // 将近期播放队列持久化（用于跨会话恢复“近期不重复”）
  try {
    localStorage.setItem(
      getRecentQueueKey(),
      JSON.stringify(recentPlayedQueue),
    );
  } catch (e) {
    console.warn("Persist recent FM queue failed:", e);
  }
}

function rememberRecent(id) {
  const normalizedId = normalizeSongId(id);
  if (!normalizedId) return;
  const existingIndex = recentPlayedQueue.indexOf(normalizedId);
  if (existingIndex !== -1) {
    recentPlayedQueue.splice(existingIndex, 1);
  }
  recentPlayedQueue.push(normalizedId);
  recentPlayedSet.add(normalizedId);
  // 控制窗口大小，超过阈值就移除最早的一首
  if (recentPlayedQueue.length > RECENT_WINDOW) {
    const old = recentPlayedQueue.shift();
    if (old && !recentPlayedQueue.includes(old)) {
      recentPlayedSet.delete(old);
    }
  }
  // 持久化近期队列（账号隔离）
  persistRecent();
}

function addToFmPoolUnique(songs, source = FM_REFRESH_SOURCE.PERSONAL_FM) {
  if (!Array.isArray(songs) || songs.length === 0) {
    const emptyStats = {
      source,
      input: 0,
      added: 0,
      filteredByRecent: 0,
      filteredByPool: 0,
      invalid: 0,
      poolBefore: fmSongs.value.length,
      poolAfter: fmSongs.value.length,
    };
    console.log("[FM Dedup]", emptyStats);
    return emptyStats;
  }
  const before = fmSongs.value.length;
  const deduped = [];
  let filteredByRecent = 0;
  let filteredByPool = 0;
  let invalid = 0;
  for (const s of songs) {
    const normalizedSong = normalizeFmSong(s);
    const id = normalizeSongId(normalizedSong?.id);
    if (!id) {
      invalid++;
      continue;
    }
    // 过滤：近期播放过、池中已有 → 不再加入
    if (recentPlayedSet.has(id)) {
      filteredByRecent++;
      continue;
    }
    if (fmPoolIds.has(id)) {
      filteredByPool++;
      continue;
    }
    fmPoolIds.add(id);
    deduped.push(normalizedSong);
  }
  if (deduped.length) fmSongs.value.push(...deduped);
  const stats = {
    source,
    input: songs.length,
    added: deduped.length,
    filteredByRecent,
    filteredByPool,
    invalid,
    poolBefore: before,
    poolAfter: fmSongs.value.length,
  };
  console.log("[FM Dedup]", stats);
  return stats;
}

function takeNextFromPool() {
  while (fmSongs.value.length > 0) {
    const s = fmSongs.value.shift();
    const id = normalizeSongId(s && s.id);
    if (id) fmPoolIds.delete(id);
    // 若近期播放过，则跳过，继续取下一首
    if (id && recentPlayedSet.has(id)) continue;
    return s || null;
  }
  return null;
}

function bootstrapFromPoolIfNeeded(source) {
  if (playedSongs.value.length !== 0 || fmSongs.value.length === 0)
    return false;
  const firstSong = takeNextFromPool();
  if (!firstSong) return false;
  playedSongs.value.push(firstSong);
  rememberRecent(firstSong.id);
  currentIndex.value = 0;
  console.log(`[FM] Started with first ${source} song:`, firstSong.name);
  return true;
}
const currentIndex = ref(0);
const loading = ref(false);
const isPrefetching = ref(false);
const isPanelIntroActive = ref(false);
const isPanelOutlineReady = ref(false);
const coverNavigating = ref(false);
const coverInterrupting = ref(false);
const coverTransitionDirection = ref("neutral");
const queuedDirections = ref([]);
const COVER_TRANSITION_FALLBACK_MS = 2500;
const COVER_RELEASE_RATIO_FALLBACK = 0.45;
const COVER_RELEASE_MIN_MS = 180;
const COVER_RELEASE_BUFFER_MS = 16;
const COVER_INTERRUPT_RELEASE_MS = 180;
const MAX_QUEUED_COVER_DIRECTIONS = 6;
const PANEL_INTRO_DURATION_MS = 1500;
const PANEL_INTRO_BUFFER_MS = 40;
let fmRefreshToken = 0;
let coverReleaseTimer = null;
let panelIntroTimer = null;
let panelIntroFrame = null;
let skipIntroOnNextActivated = true;

// ponytail: dev-only, non-persistent screenshot fixture; use API mocks if QA expands to playback.
function isFmQaPreview() {
  return (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.hash.split("?")[1] || "").get(
      "fm-qa",
    ) === "1"
  );
}
const FM_QA_SONGS = Object.freeze([
  {
    id: "fm-qa-01",
    name: "远星来信",
    artists: [{ name: "Hydrogen Archive" }],
    album: { name: "夜航记录" },
  },
  {
    id: "fm-qa-02",
    name: "潮汐引力",
    artists: [{ name: "林间信号" }],
    album: { name: "漫游样本 II" },
  },
  {
    id: "fm-qa-03",
    name: "晨昏边界",
    artists: [{ name: "North Window" }],
    album: { name: "静默轨道" },
  },
]);

function loadFmQaPreview() {
  playedSongs.value = FM_QA_SONGS.map((song) => ({
    ...song,
    artists: song.artists.map((artist) => ({ ...artist })),
    album: { ...song.album },
  }));
  fmSongs.value = [];
  currentIndex.value = 1;
  loading.value = false;
  isPrefetching.value = false;
}

if (isFmQaPreview()) loadFmQaPreview();

function getCurrentFmUserId() {
  const userId = userStore?.user?.userId;
  return userId === undefined || userId === null || userId === ""
    ? null
    : String(userId);
}

function isActiveFmRefresh(token, userId) {
  return token === fmRefreshToken && getCurrentFmUserId() === userId;
}

function resetFmAccountState() {
  fmRefreshToken += 1;
  fmSongs.value = [];
  playedSongs.value = [];
  fmPoolIds.clear();
  currentIndex.value = 0;
  loading.value = false;
  isPrefetching.value = false;
  modeSwitching.value = false;
  modePanelOpen.value = false;
  awaitingSceneSubmodePick.value = false;
  lastRefreshSource.value = FM_REFRESH_SOURCE.PERSONAL_FM;
  lastLoadedUserId.value = null;
  clearCoverReleaseTimer();
  coverNavigating.value = false;
  coverInterrupting.value = false;
  queuedDirections.value = [];
}

const currentSong = computed(() => {
  // 先从已播放历史中查找
  if (currentIndex.value < playedSongs.value.length) {
    return playedSongs.value[currentIndex.value] || null;
  }
  return null;
});

const isPlaying = computed(() => {
  return (
    playing.value && isSameSongId(songId.value, currentSong.value?.id)
  );
});

function isSameSongId(left, right) {
  return String(left || "") === String(right || "");
}

const prevCandidateSong = computed(() => {
  if (currentIndex.value > 0) {
    return playedSongs.value[currentIndex.value - 1] || null;
  }
  return null;
});

const nextCandidateSong = computed(() => {
  const historyCandidate = playedSongs.value[currentIndex.value + 1];
  if (historyCandidate) return historyCandidate;
  return fmSongs.value[0] || null;
});

const rightPlaceholderText = computed(() => {
  return isPrefetching.value ? "NEXT LOADING" : "NO NEXT";
});

const activeFmModeOption = computed(() => {
  return (
    FM_MODE_OPTIONS.find((mode) => mode.value === selectedFmMode.value) ||
    FM_MODE_OPTIONS[0]
  );
});

const activeFmSubmodeOption = computed(() => {
  return (
    FM_SCENE_SUBMODE_OPTIONS.find(
      (scene) => scene.value === selectedFmSubmode.value,
    ) || FM_SCENE_SUBMODE_OPTIONS[1]
  );
});

const selectedFmModeSummary = computed(() => {
  if (selectedFmMode.value === "ai_pool") {
    return `${activeFmModeOption.value.label} · ${activeFmSubmodeOption.value.label}`;
  }
  return activeFmModeOption.value.label;
});

const isDefaultFmModeSelected = computed(
  () => selectedFmMode.value === DEFAULT_FM_MODE,
);

function buildCurrentFmRequestContext(extraParams = {}) {
  const current = currentSong.value || {};
  const playtimeSeconds = Number(time.value || 0);
  const remainSongcnt = Math.max(0, fmSongs.value.length);
  const params = {
    remain_songcnt: remainSongcnt,
    ...extraParams,
  };

  if (selectedFmMode.value === "ai_pool") {
    params.mode = "normal";
    params.song_pool_id = selectedFmSubmode.value;
  } else {
    params.mode = selectedFmMode.value;
  }

  if (current?.hash) params.hash = current.hash;
  if (current?.songid || current?.id)
    params.songid = current.songid || current.id;
  if (Number.isFinite(playtimeSeconds) && playtimeSeconds >= 0) {
    // 接口文档要求的是“已播放时间”，播放器状态里保存的是秒。
    params.playtime = Math.floor(playtimeSeconds);
  }

  return params;
}

function buildSelectedModeRequest() {
  if (isDefaultFmModeSelected.value) {
    return buildCurrentFmRequestContext({ mode: DEFAULT_FM_MODE });
  }
  return buildCurrentFmRequestContext();
}

function trimFmCandidatesForModeSwitch() {
  fmSongs.value = [];
  fmPoolIds.clear();
  if (!playedSongs.value.length) {
    currentIndex.value = 0;
    return;
  }
  const keepUntil = Math.max(
    0,
    Math.min(currentIndex.value, playedSongs.value.length - 1),
  );
  playedSongs.value = playedSongs.value.slice(0, keepUntil + 1);
  currentIndex.value = keepUntil;
}

const refreshBySelectedMode = async () => {
  if (modeSwitching.value) return;
  modeSwitching.value = true;
  try {
    trimFmCandidatesForModeSwitch();
    await refreshFM({ silent: !!currentSong.value });
  } finally {
    modeSwitching.value = false;
  }
};

const changeFmMode = async (mode) => {
  if (!mode || modeSwitching.value || loading.value) return;
  if (selectedFmMode.value === mode) return;
  selectedFmMode.value = mode;
  if (mode === "ai_pool") {
    // AI 推荐池需要二次选择 Alpha/Beta/Gamma，保持面板展开等待用户继续点选。
    awaitingSceneSubmodePick.value = true;
    modePanelOpen.value = true;
    return;
  }
  awaitingSceneSubmodePick.value = false;
  selectedFmSubmode.value = DEFAULT_SCENE_SUBMODE;
  modePanelOpen.value = false;
  await refreshBySelectedMode();
};

const changeFmSubmode = async (submode) => {
  if (!submode || modeSwitching.value || loading.value) return;
  if (selectedFmMode.value !== "ai_pool") return;
  if (selectedFmSubmode.value === submode && !awaitingSceneSubmodePick.value)
    return;
  selectedFmSubmode.value = submode;
  awaitingSceneSubmodePick.value = false;
  modePanelOpen.value = false;
  await refreshBySelectedMode();
};

const toggleModePanel = () => {
  if (loading.value || modeSwitching.value) return;
  modePanelOpen.value = !modePanelOpen.value;
};

const handleModePanelClickOutside = (event) => {
  if (!modePanelOpen.value) return;
  const host = modePanelRef.value;
  if (!host || host.contains(event.target)) return;
  modePanelOpen.value = false;
};

const coverTrackItems = computed(() => {
  const currentId = currentSong.value?.id || "none";
  const leftItem = prevCandidateSong.value
    ? {
        key: `song-${prevCandidateSong.value.id}`,
        role: "left",
        song: prevCandidateSong.value,
        isPlaceholder: false,
        placeholderText: "",
        clickable: true,
      }
    : {
        key: `placeholder-left-${currentId}`,
        role: "left",
        song: null,
        isPlaceholder: true,
        placeholderText: "NO PREV",
        clickable: false,
      };

  const centerItem = {
    key: `song-${currentSong.value?.id || "center"}`,
    role: "center",
    song: currentSong.value,
    isPlaceholder: false,
    placeholderText: "",
    clickable: true,
  };

  const rightItem = nextCandidateSong.value
    ? {
        key: `song-${nextCandidateSong.value.id}`,
        role: "right",
        song: nextCandidateSong.value,
        isPlaceholder: false,
        placeholderText: "",
        clickable: true,
      }
    : {
        key: `placeholder-right-${currentId}`,
        role: "right",
        song: null,
        isPlaceholder: true,
        placeholderText: rightPlaceholderText.value,
        clickable: false,
      };

  return [leftItem, centerItem, rightItem];
});

const coverTransitionName = computed(() => {
  if (coverTransitionDirection.value === "next") return "fm-shift-next";
  if (coverTransitionDirection.value === "prev") return "fm-shift-prev";
  return "fm-shift-neutral";
});

const setCoverTransitionDirection = (direction) => {
  coverTransitionDirection.value = direction;
};

const parseDurationToMs = (rawValue) => {
  if (!rawValue) return NaN;
  const value = rawValue.trim();
  if (!value) return NaN;
  if (value.endsWith("ms")) return Number.parseFloat(value);
  if (value.endsWith("s")) return Number.parseFloat(value) * 1000;
  return Number.parseFloat(value);
};

const getCoverTransitionDurationMs = () => {
  if (typeof window === "undefined") return COVER_TRANSITION_FALLBACK_MS;
  const host = document.querySelector(".personal-fm");
  const durationValue = host
    ? window
        .getComputedStyle(host)
        .getPropertyValue("--fm-cover-transition-duration")
    : "";
  const durationMs = parseDurationToMs(durationValue);
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return COVER_TRANSITION_FALLBACK_MS;
  }
  return durationMs;
};

const getCoverReleaseDelayMs = () => {
  const transitionDurationMs = getCoverTransitionDurationMs();
  if (typeof window === "undefined") return transitionDurationMs;

  const host = document.querySelector(".personal-fm");
  const ratioValue = host
    ? window
        .getComputedStyle(host)
        .getPropertyValue("--fm-cover-overlap-release-ratio")
    : "";
  const ratio = Number.parseFloat((ratioValue || "").trim());

  const releaseRatio =
    Number.isFinite(ratio) && ratio > 0 && ratio < 1
      ? ratio
      : COVER_RELEASE_RATIO_FALLBACK;

  return Math.max(COVER_RELEASE_MIN_MS, transitionDurationMs * releaseRatio);
};

const queueCoverDirection = (direction) => {
  queuedDirections.value = [
    ...queuedDirections.value,
    direction,
  ].slice(-MAX_QUEUED_COVER_DIRECTIONS);
};

const interruptCoverNavigation = () => {
  if (typeof window === "undefined") {
    void releaseCoverNavigation();
    return;
  }
  if (coverInterrupting.value && coverReleaseTimer) return;

  coverInterrupting.value = true;
  clearCoverReleaseTimer();
  coverReleaseTimer = window.setTimeout(() => {
    coverReleaseTimer = null;
    void releaseCoverNavigation();
  }, COVER_INTERRUPT_RELEASE_MS);
};

const clearCoverReleaseTimer = () => {
  if (coverReleaseTimer) {
    clearTimeout(coverReleaseTimer);
    coverReleaseTimer = null;
  }
};

const clearPanelIntroSchedule = () => {
  if (panelIntroFrame !== null) {
    cancelAnimationFrame(panelIntroFrame);
    panelIntroFrame = null;
  }
  if (panelIntroTimer) {
    clearTimeout(panelIntroTimer);
    panelIntroTimer = null;
  }
};

const startPanelIntro = () => {
  if (typeof window === "undefined") return;

  clearPanelIntroSchedule();
  isPanelIntroActive.value = false;
  isPanelOutlineReady.value = false;

  panelIntroFrame = requestAnimationFrame(() => {
    panelIntroFrame = null;
    isPanelIntroActive.value = true;
    panelIntroTimer = window.setTimeout(() => {
      isPanelOutlineReady.value = true;
      isPanelIntroActive.value = false;
      panelIntroTimer = null;
    }, PANEL_INTRO_DURATION_MS + PANEL_INTRO_BUFFER_MS);
  });
};

const releaseCoverNavigation = async () => {
  coverNavigating.value = false;
  coverInterrupting.value = false;
  setCoverTransitionDirection("neutral");

  const [nextDirection, ...restDirections] = queuedDirections.value;
  queuedDirections.value = restDirections;

  if (!nextDirection) return;

  if (nextDirection === "next") {
    await goNext();
    return;
  }
  await goPrev();
};

const scheduleCoverRelease = () => {
  clearCoverReleaseTimer();

  if (typeof window === "undefined") {
    void releaseCoverNavigation();
    return;
  }

  const releaseDelay = getCoverReleaseDelayMs() + COVER_RELEASE_BUFFER_MS;
  coverReleaseTimer = window.setTimeout(() => {
    coverReleaseTimer = null;
    void releaseCoverNavigation();
  }, releaseDelay);
};

const togglePlay = async (options = {}) => {
  const playbackOptions = {
    userInitiated: options?.userInitiated !== false,
  };
  console.log("togglePlay clicked!");
  console.log("currentSong:", currentSong.value);

  if (!currentSong.value) {
    console.log("No current song available");
    return;
  }

  // 如果当前歌曲已经在播放，只需要切换播放状态
  if (
    isSameSongId(songId.value, currentSong.value.id) &&
    playerStore.currentMusic
  ) {
    if (playing.value) {
      console.log("Pausing current FM song");
      pauseMusic();
    } else {
      console.log("Resuming current FM song");
      startMusic(playbackOptions);
    }
    return;
  }

  // 播放新的FM歌曲
  console.log("Playing new FM song:", currentSong.value.name);

  try {
    // 获取歌曲URL
    console.log("Getting music URL for:", currentSong.value.id);
    const preferredQuality = getPreferredQuality(quality.value);
    // 传递完整歌曲对象以确保 hash 和 album_audio_id 都可用
    const trackInfo = await resolveTrackByQualityPreference(
      currentSong.value,
      preferredQuality,
    );
    console.log("Music URL response:", trackInfo);
    if (trackInfo && trackInfo.url) {
      const musicUrl = trackInfo.url;
      const targetSongId = currentSong.value.id;
      console.log("Playing music from URL:", musicUrl);
      const normalizedCurrentSong = normalizeFmSong(currentSong.value);
      if (!normalizedCurrentSong) {
        console.error("Invalid current FM song shape:", currentSong.value);
        return;
      }
      const durationSeconds = Math.floor(
        Number(
          normalizedCurrentSong.dt || normalizedCurrentSong.duration || 0,
        ) / 1000,
      );

      // 创建一个临时的单曲列表用于FM播放（不影响用户的真实播放列表）
      const fmSongList = [
        {
          ...normalizedCurrentSong,
          type: "fm",
        },
      ];

      // 设置播放器状态
      playerStore.songId = currentSong.value.id;
      playerStore.currentIndex = 0;
      playerStore.songList = fmSongList;
      playerStore.listInfo = {
        id: "personalfm",
        type: "personalfm",
        name: "私人漫游",
      };
      playerStore.lyric = null;
      playerStore.lyricsObjArr = null;
      playerStore.currentLyricIndex = -1;
      setSongLevel(trackInfo.level, trackInfo);
      progress.value = 0;
      time.value = Number.isFinite(durationSeconds) ? durationSeconds : 0;

      // 直接播放音乐
      play(musicUrl, true, null, null, playbackOptions);
      if (chorusMode.value) {
        const startChorusPlayback = () => {
          if (
            !chorusMode.value ||
            !isSameSongId(playerStore.songId, targetSongId)
          )
            return;
          void playCurrentSongChorus({
            showNotice: false,
            suppressUnsupportedNotice: true,
          });
        };
        const playback = playerStore.currentMusic;
        if (playback?.state?.() === "loaded")
          setTimeout(startChorusPlayback, 0);
        else playback?.once?.("load", startChorusPlayback);
      }

      // 获取歌词
      try {
        const lyricResponse = await getLyric(currentSong.value);
        if (
          playerStore.songId === targetSongId &&
          lyricResponse &&
          lyricResponse.lrc
        ) {
          playerStore.lyric = lyricResponse;
        }
      } catch (lyricError) {
        console.warn("Failed to load lyrics:", lyricError);
      }

      console.log("FM song started playing successfully");
    } else {
      console.error("No valid music URL found");
    }
  } catch (error) {
    console.error("Error playing FM song:", error);
  }
};

const nextSong = async (options = {}) => {
  // 如果有下一首已播放的歌曲，直接播放
  if (currentIndex.value < playedSongs.value.length - 1) {
    currentIndex.value++;
    if (currentSong.value) {
      console.log("Playing next FM song from history:", currentSong.value.name);
      await togglePlay(options);
    }
    return;
  }

  // 如果没有下一首，需要获取新歌曲
  if (fmSongs.value.length === 0) {
    await refreshFM({ silent: true });
  }

  // 从未播放的歌曲中取下一首
  let nextSongFromPool = takeNextFromPool();
  if (nextSongFromPool) {
    // 添加到播放历史并记录近期去重
    playedSongs.value.push(nextSongFromPool);
    rememberRecent(nextSongFromPool.id);
    currentIndex.value = playedSongs.value.length - 1;

    console.log("Playing new FM song:", nextSongFromPool.name);
    await togglePlay(options);
    // 低水位预取，保持池内始终有歌可播
    if (fmSongs.value.length < 2) {
      refreshFM({ silent: true });
    }
  } else {
    console.log("No more FM songs available");
    // 如果歌曲池为空，尝试再次刷新
    if (fmSongs.value.length === 0) {
      await refreshFM({ silent: true });
      // 再次尝试获取歌曲
      nextSongFromPool = takeNextFromPool();
      if (nextSongFromPool) {
        playedSongs.value.push(nextSongFromPool);
        rememberRecent(nextSongFromPool.id);
        currentIndex.value = playedSongs.value.length - 1;
        console.log("Playing retry FM song:", nextSongFromPool.name);
        await togglePlay(options);
        if (fmSongs.value.length < 2) {
          refreshFM({ silent: true });
        }
      }
    }
  }
};

const prevSong = async (options = {}) => {
  if (currentIndex.value > 0) {
    currentIndex.value--;
    if (currentSong.value) {
      console.log("Playing previous FM song:", currentSong.value.name);
      await togglePlay(options);
    }
  } else {
    console.log("Already at first song, cannot go to previous");
  }
};

const goNext = async (options = {}) => {
  const playbackOptions = {
    userInitiated: options?.userInitiated !== false,
  };
  if (coverNavigating.value) {
    queueCoverDirection("next");
    interruptCoverNavigation();
    return;
  }

  coverNavigating.value = true;
  coverInterrupting.value = false;
  clearCoverReleaseTimer();
  setCoverTransitionDirection("next");

  try {
    await nextSong(playbackOptions);
  } finally {
    scheduleCoverRelease();
  }
};

const goPrev = async (options = {}) => {
  const playbackOptions = {
    userInitiated: options?.userInitiated !== false,
  };
  if (coverNavigating.value) {
    queueCoverDirection("prev");
    interruptCoverNavigation();
    return;
  }
  if (currentIndex.value <= 0) return;

  coverNavigating.value = true;
  coverInterrupting.value = false;
  clearCoverReleaseTimer();
  setCoverTransitionDirection("prev");

  try {
    await prevSong(playbackOptions);
  } finally {
    scheduleCoverRelease();
  }
};

const handleCoverSlotClick = async (item) => {
  if (!item || !item.clickable) return;

  if (item.role === "center") {
    if (coverNavigating.value) return;
    await togglePlay();
    return;
  }
  if (item.role === "left") {
    await goPrev();
    return;
  }
  if (item.role === "right") {
    if (nextCandidateSong.value) {
      await goNext();
    } else {
      prefetchNextCandidate();
    }
  }
};

const trashSong = async () => {
  if (!currentSong.value) return;

  try {
    // 使用文档中的 action=garbage 标记“不喜欢”，并顺手把下一批推荐预热进候选池。
    const response = await fmTrash(
      currentSong.value,
      buildCurrentFmRequestContext({ action: "garbage" }),
    );
    const songs = Array.isArray(response?.data) ? response.data : [];
    if (songs.length > 0) {
      addToFmPoolUnique(songs, FM_REFRESH_SOURCE.PERSONAL_FM);
    }
    await goNext();
  } catch (error) {
    console.warn("FM trash failed, skipping to next song:", error);
    await goNext();
  }
};

const likeSong = async () => {
  if (!currentSong.value) return;
  if (!Array.isArray(likelist.value)) return;

  const actionToken = createLikeActionToken();

  try {
    // 使用计算属性来判断当前的操作是“喜欢”还是“取消喜欢”
    const isLiked = !isCurrentSongLiked.value;
    console.log("PersonalFM开始喜欢操作:", {
      songId: currentSong.value.id,
      like: isLiked,
    });

    // 1) 优先使用官方 /like 接口
    try {
      const result = await queueLikeRequest(actionToken, () =>
        likeMusic(currentSong.value.id, isLiked),
      );
      if (result?.skipped) return;
      if (result && result.code === 200) {
        if (!isActiveLikeActionToken(actionToken)) return;
        const fallbackLikelist = applyOptimisticLikeState(
          currentSong.value.id,
          isLiked,
          likelist.value,
        );
        userStore.updateLikelist(fallbackLikelist);
        noticeOpen(await getFavoritePlaylistNoticeText(isLiked), 2);
        await syncLikelistAfterLikeAction({
          songId: currentSong.value.id,
          like: isLiked,
          actionToken,
          fallbackLikelist,
        });
        if (!isActiveLikeActionToken(actionToken)) return;
        schedulePlaylistCacheInvalidation();
        return;
      }
      throw new Error(getLikeActionErrorMessage(result, "likeMusic 返回异常"));
    } catch (apiErr) {
      console.warn(
        "PersonalFM likeMusic 失败，尝试使用歌单 tracks:",
        apiErr.message,
      );
    }

    // 2) 降级：使用“我喜欢的音乐”歌单 tracks
    try {
      const fallbackResult = await updateFavoritePlaylistTrack(
        currentSong.value.id,
        isLiked,
      );
      if (fallbackResult.success) {
        if (!isActiveLikeActionToken(actionToken)) return;
        const fallbackLikelist = applyOptimisticLikeState(
          currentSong.value.id,
          isLiked,
          likelist.value,
        );
        userStore.updateLikelist(fallbackLikelist);
        noticeOpen(
          isLiked
            ? `已添加到${fallbackResult.favoritePlaylist?.name || "我喜欢的音乐"}`
            : "已取消喜欢",
          2,
        );
        await syncLikelistAfterLikeAction({
          songId: currentSong.value.id,
          like: isLiked,
          actionToken,
          fallbackLikelist,
        });
        if (!isActiveLikeActionToken(actionToken)) return;
        schedulePlaylistCacheInvalidation();
        return;
      }
      throw new Error(fallbackResult.message || "歌单 tracks 返回异常");
    } catch (playlistError) {
      console.error("PersonalFM 歌单 tracks 也失败:", playlistError);
    }
  } catch (error) {
    console.error("Failed to like song:", error);
  }
};

const refreshFM = async ({ silent = false } = {}) => {
  const requestUserId = getCurrentFmUserId();
  if (!requestUserId) {
    resetFmAccountState();
    return false;
  }

  const requestToken = ++fmRefreshToken;
  if (!silent) {
    loading.value = true;
  }
  try {
    const selectedModeRequest = buildSelectedModeRequest();
    const usingDefaultMode = isDefaultFmModeSelected.value;
    const selectedModeLabel =
      selectedModeRequest.song_pool_id !== undefined
        ? `${selectedModeRequest.mode}/pool-${selectedModeRequest.song_pool_id}`
        : selectedModeRequest.mode;
    console.log("[FM] Requesting Personal FM data, mode:", selectedModeLabel);
    let shouldTryModeRescue = false;

    // 1) 主流程：统一走酷狗 /personal/fm，只是参数按当前模式切换。
    try {
      let songs = [];
      let primarySource = FM_REFRESH_SOURCE.PERSONAL_FM;
      const response = usingDefaultMode
        ? await getPersonalFM(selectedModeRequest)
        : await getPersonalFMByMode(selectedModeRequest);
      if (!isActiveFmRefresh(requestToken, requestUserId)) return false;
      songs = Array.isArray(response?.data) ? response.data : [];
      if (!usingDefaultMode) primarySource = FM_REFRESH_SOURCE.FM_MODE_RESCUE;
      console.log(
        "[FM] personal/fm response size:",
        songs.length,
        selectedModeRequest,
      );

      if (songs.length > 0) {
        if (!isActiveFmRefresh(requestToken, requestUserId)) return false;
        const stats = addToFmPoolUnique(songs, primarySource);
        if (stats.added > 0) {
          lastRefreshSource.value = primarySource;
          lastLoadedUserId.value = requestUserId;
          bootstrapFromPoolIfNeeded(primarySource);
          console.log("[FM] refresh source:", lastRefreshSource.value);
          return true;
        }
        // 仅在“去重后无新增 + 当前无可播下一首”时触发模式救援
        if (!nextCandidateSong.value && usingDefaultMode) {
          shouldTryModeRescue = true;
          console.log(
            "[FM] personal/fm deduped to empty and no next candidate, try mode rescue",
          );
        } else if (!nextCandidateSong.value) {
          console.log(
            "[FM] selected mode deduped to empty, fallback to daily recommendations",
          );
        } else {
          console.log(
            "[FM] primary source deduped to empty, but next candidate already exists; skip fallback",
          );
          return;
        }
      } else if (!nextCandidateSong.value && usingDefaultMode) {
        shouldTryModeRescue = true;
        console.log("[FM] personal/fm returned empty list, try mode rescue");
      } else if (!nextCandidateSong.value) {
        console.log(
          "[FM] selected mode returned empty list, fallback to daily recommendations",
        );
      } else {
        return;
      }
    } catch (fmError) {
      console.warn("Primary FM API failed, fallback path starts:", fmError);
      if (usingDefaultMode) {
        shouldTryModeRescue = true;
      }
    }

    // 2) 救援流程：改走文档支持的小众模式，尽量从同一套私人漫游数据源补歌。
    if (shouldTryModeRescue) {
      try {
        const modeResponse = await getPersonalFMByMode({
          ...buildCurrentFmRequestContext(),
          ...FM_MODE_RESCUE_OPTIONS,
        });
        if (!isActiveFmRefresh(requestToken, requestUserId)) return false;
        const modeSongs = Array.isArray(modeResponse?.data)
          ? modeResponse.data
          : [];
        console.log(
          "[FM] fm_mode_rescue response size:",
          modeSongs.length,
          FM_MODE_RESCUE_OPTIONS,
        );
        if (modeSongs.length > 0) {
          if (!isActiveFmRefresh(requestToken, requestUserId)) return false;
          const modeStats = addToFmPoolUnique(
            modeSongs,
            FM_REFRESH_SOURCE.FM_MODE_RESCUE,
          );
          if (modeStats.added > 0) {
            lastRefreshSource.value = FM_REFRESH_SOURCE.FM_MODE_RESCUE;
            lastLoadedUserId.value = requestUserId;
            bootstrapFromPoolIfNeeded(FM_REFRESH_SOURCE.FM_MODE_RESCUE);
            console.log("[FM] refresh source:", lastRefreshSource.value);
            return true;
          }
        }
      } catch (modeError) {
        console.warn(
          "FM mode rescue failed, trying daily recommendations:",
          modeError,
        );
      }
    }

    // 3) 最终回退：每日推荐
    try {
      const recResponse = await getRecommendSongs();
      if (!isActiveFmRefresh(requestToken, requestUserId)) return false;
      console.log("Daily recommendations response:", recResponse);

      if (recResponse && recResponse.data && recResponse.data.dailySongs) {
        const songs = mapSongsPlayableStatus(recResponse.data.dailySongs);
        const shuffledSongs = songs.sort(() => Math.random() - 0.5);
        if (!isActiveFmRefresh(requestToken, requestUserId)) return false;
        const dailyStats = addToFmPoolUnique(
          shuffledSongs,
          FM_REFRESH_SOURCE.DAILY_RECOMMEND,
        );
        if (dailyStats.added > 0) {
          lastRefreshSource.value = FM_REFRESH_SOURCE.DAILY_RECOMMEND;
          lastLoadedUserId.value = requestUserId;
          bootstrapFromPoolIfNeeded(FM_REFRESH_SOURCE.DAILY_RECOMMEND);
          console.log("[FM] refresh source:", lastRefreshSource.value);
          return true;
        }
        console.log("[FM] daily_recommend deduped to empty");
      }
    } catch (recError) {
      console.warn("Daily recommendations also failed:", recError);
    }

    console.error("All FM data sources failed or yielded no new songs");
  } catch (error) {
    console.error("All FM data sources failed:", error);
  } finally {
    if (!silent && isActiveFmRefresh(requestToken, requestUserId)) {
      loading.value = false;
    }
  }
  return false;
};

const prefetchNextCandidate = async () => {
  if (isPrefetching.value || loading.value || coverNavigating.value) return;
  if (!currentSong.value) return;
  // 历史尾部且右侧无候选时，静默预取下一首
  if (currentIndex.value < playedSongs.value.length - 1) return;
  if (nextCandidateSong.value) return;

  isPrefetching.value = true;
  try {
    await refreshFM({ silent: true });
  } finally {
    isPrefetching.value = false;
  }
};

onMounted(() => {
  startPanelIntro();
  if (isFmQaPreview()) {
    loadFmQaPreview();
  } else {
    // 恢复持久化的“近期去重队列”（按账号隔离）
    loadPersistentRecent();
    // 只有在FM列表为空时才加载新歌
    if (playedSongs.value.length === 0) {
      refreshFM();
    }
  }

  // 监听播放器控制事件
  window.addEventListener("fmPlayModeResponse", handleFMPlayModeResponse);
  window.addEventListener("fmPreviousResponse", handleFMPreviousResponse);
  window.addEventListener("fmNextResponse", handleFMNextResponse);
  window.addEventListener("fmClearRecent", handleFmClearRecent);
  window.addEventListener("mousedown", handleModePanelClickOutside);
  window.addEventListener("touchstart", handleModePanelClickOutside);
});

onActivated(() => {
  if (skipIntroOnNextActivated) {
    skipIntroOnNextActivated = false;
    return;
  }
  startPanelIntro();
  if (isFmQaPreview()) return;
  if (getCurrentFmUserId() && lastLoadedUserId.value !== getCurrentFmUserId()) {
    void refreshFM({ silent: true });
  }
});

onDeactivated(() => {
  clearPanelIntroSchedule();
  isPanelIntroActive.value = false;
  modePanelOpen.value = false;
});

onUnmounted(() => {
  // 清理所有事件监听器
  window.removeEventListener("fmPlayModeResponse", handleFMPlayModeResponse);
  window.removeEventListener("fmPreviousResponse", handleFMPreviousResponse);
  window.removeEventListener("fmNextResponse", handleFMNextResponse);
  window.removeEventListener("fmClearRecent", handleFmClearRecent);
  window.removeEventListener("mousedown", handleModePanelClickOutside);
  window.removeEventListener("touchstart", handleModePanelClickOutside);
  clearCoverReleaseTimer();
  clearPanelIntroSchedule();
  isPanelIntroActive.value = false;
  skipIntroOnNextActivated = true;
  coverInterrupting.value = false;
  queuedDirections.value = [];
});

// 监听账号切换：按账号隔离“近期去重队列”
watch(
  () => userStore?.user?.userId,
  (nextUserId, previousUserId) => {
    if (nextUserId === previousUserId) return;
    if (isFmQaPreview()) {
      loadFmQaPreview();
      return;
    }
    resetFmAccountState();
    loadPersistentRecent();
    if (nextUserId) {
      void refreshFM({
        silent: router.currentRoute.value?.name !== "personalfm",
      });
    }
  },
);

watch(
  [
    () => currentSong.value?.id,
    currentIndex,
    () => playedSongs.value.length,
    () => fmSongs.value.length,
    loading,
    coverNavigating,
  ],
  () => {
    prefetchNextCandidate();
  },
  { immediate: true },
);

// 处理播放模式响应
const handleFMPlayModeResponse = async (event) => {
  const { action } = event.detail;
  console.log("Received FM play mode response:", action);

  if (action === "loop") {
    // 单曲循环模式：重新播放当前歌曲
    console.log("Loop mode: replaying current song");
    await togglePlay({ userInitiated: false });
  } else if (action === "next") {
    // FM模式：播放下一首漫游歌曲
    console.log("FM mode: playing next song");
    await goNext({ userInitiated: false });
  }
};

// 处理上一首FM歌曲响应
const handleFMPreviousResponse = async (event) => {
  const { action } = event.detail;
  console.log("Received FM previous response:", action);

  if (action === "previous") {
    console.log("Playing previous FM song from player controls");
    await goPrev({
      userInitiated: event.detail?.userInitiated === true,
    });
  }
};

// 处理下一首FM歌曲响应
const handleFMNextResponse = async (event) => {
  const { action } = event.detail;
  console.log("Received FM next response:", action);

  if (action === "next") {
    console.log("Playing next FM song from player controls");
    await goNext({
      userInitiated: event.detail?.userInitiated === true,
    });
  }
};

// 处理设置页触发的清空漫游缓存事件
const handleFmClearRecent = () => {
  console.log(
    "Received fmClearRecent event from Settings, reloading recent queue",
  );
  loadPersistentRecent();
};
</script>

<style scoped lang="scss">
.personal-fm {
  --ark-ink: #080914;
  --ark-paper: #f3f2ef;
  --ark-signal: #46f6e6;
  --fm-ink: var(--ark-ink);
  --fm-paper: var(--ark-paper);
  --fm-signal: var(--ark-signal);
  --fm-stage-bg: transparent;
  --fm-panel-bg: linear-gradient(
    132deg,
    rgba(14, 16, 34, 0.98),
    rgba(8, 9, 20, 0.995) 56%,
    rgba(12, 21, 34, 0.98)
  );
  --fm-panel-border: rgba(243, 242, 239, 0.2);
  --fm-panel-overlay:
    radial-gradient(circle at 18% 23%, rgba(70, 246, 230, 0.8) 0 1px, transparent 1.6px),
    radial-gradient(circle at 72% 17%, rgba(243, 242, 239, 0.44) 0 1px, transparent 1.6px),
    radial-gradient(circle at 84% 68%, rgba(70, 246, 230, 0.52) 0 1px, transparent 1.6px),
    radial-gradient(circle at 38% 82%, rgba(243, 242, 239, 0.34) 0 1px, transparent 1.6px);
  --fm-panel-overlay-opacity: 0.72;
  --fm-text: var(--fm-paper);
  --fm-muted: rgba(243, 242, 239, 0.68);
  --fm-subtle: rgba(243, 242, 239, 0.42);
  --fm-primary-btn-bg: var(--fm-signal);
  --fm-primary-btn-text: var(--fm-ink);
  --fm-primary-btn-border: rgba(70, 246, 230, 0.8);
  --fm-primary-btn-hover-bg: #77fff1;
  --fm-ghost-btn-bg: rgba(243, 242, 239, 0.045);
  --fm-ghost-btn-hover-bg: rgba(70, 246, 230, 0.09);
  --fm-mode-bg: rgba(8, 9, 20, 0.78);
  --fm-mode-hover-bg: rgba(70, 246, 230, 0.08);
  --fm-mode-panel-bg: rgba(12, 14, 29, 0.98);
  --fm-mode-panel-bg-soft: rgba(8, 9, 20, 0.98);
  --fm-mode-active-bg: var(--fm-signal);
  --fm-mode-active-text: var(--fm-ink);
  --fm-mode-active-border: var(--fm-signal);
  --fm-play-overlay-bg: rgba(8, 9, 20, 0.84);
  --fm-play-overlay-hover-bg: rgba(8, 9, 20, 0.96);
  --fm-play-overlay-border: rgba(70, 246, 230, 0.72);
  --fm-play-overlay-icon: var(--fm-signal);
  --fm-danger: #ff8d8d;
  --fm-danger-bg: rgba(255, 141, 141, 0.1);
  --fm-spinner-track: rgba(243, 242, 239, 0.14);
  --fm-slot-bg: rgba(243, 242, 239, 0.035);
  --fm-slot-hover-border: var(--fm-signal);
  --fm-side-opacity: 0.36;
  --fm-placeholder-bg: rgba(243, 242, 239, 0.025);
  --fm-placeholder-text: rgba(243, 242, 239, 0.38);
  --fm-intro-line-color: rgba(70, 246, 230, 0.42);
  --fm-intro-line-width: 1px;
  --fm-intro-content-offset: 12px;
  --fm-cover-transition-duration: 0.72s;
  --fm-cover-transition-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --fm-cover-ghost-fade-duration: 0.1s;
  --fm-cover-ghost-fade-delay: calc(
    var(--fm-cover-transition-duration) - var(--fm-cover-ghost-fade-duration)
  );
  --fm-cover-placeholder-fade-duration: 0.12s;
  --fm-cover-overlap-release-ratio: 0.45;
  --fm-cover-overlap-fade-duration: 0.14s;
  --fm-cover-overlap-release-delay: calc(
    var(--fm-cover-transition-duration) * var(--fm-cover-overlap-release-ratio)
  );
  --fm-cover-z-leaving: 1;
  --fm-cover-z-side: 2;
  --fm-cover-z-side-moving: 3;
  --fm-cover-z-center: 4;
  --fm-cover-z-prev-new-center-top: calc(var(--fm-cover-z-center) + 2);
  --fm-cover-z-prev-old-center-mid: calc(var(--fm-cover-z-center) + 1);
  --fm-cover-z-prev-right-leave-bottom: var(--fm-cover-z-leaving);

  height: 100%;
  overflow: auto;
  padding: 8px 0 10px;
  color: var(--fm-text);
  color-scheme: dark;

  &::-webkit-scrollbar {
    display: none;
  }
}

.personal-fm.fm-cover-interrupting {
  --fm-cover-transition-duration: 0.18s;
  --fm-cover-transition-ease: cubic-bezier(0.22, 0.78, 0.28, 1);
  --fm-cover-ghost-fade-duration: 0.08s;
}

.fm-stage {
  height: 100%;
  min-height: 100%;
  display: flex;
  justify-content: center;
  align-items: stretch;
  padding: 0;
  background: var(--fm-stage-bg) !important;
}

.fm-panel {
  width: 100%;
  max-width: 100%;
  min-height: max(600px, 100%);
  padding: 32px 38px 24px 112px;
  box-sizing: border-box;
  position: relative;
  overflow: hidden;
  isolation: isolate;
  background: var(--fm-panel-bg);
  border: 1px solid var(--fm-panel-border);
  box-shadow:
    inset 0 0 80px rgba(70, 246, 230, 0.025),
    0 18px 54px rgba(8, 9, 20, 0.18);
}

.fm-panel::before {
  content: "";
  position: absolute;
  inset: 1px;
  pointer-events: none;
  background-image: var(--fm-panel-overlay);
  opacity: var(--fm-panel-overlay-opacity);
  clip-path: inset(0 0 0 0);
  z-index: -1;
}

.fm-outline-draw {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 1;
  z-index: 3;
}

.outline-seg {
  position: absolute;
  background: var(--fm-intro-line-color);
  opacity: 1;
}

.outline-seg.top,
.outline-seg.bottom {
  left: 0;
  right: 0;
  height: var(--fm-intro-line-width);
  transform: scaleX(0);
}

.outline-seg.top {
  top: 0;
  transform-origin: left center;
}

.outline-seg.bottom {
  bottom: 0;
  transform-origin: right center;
}

.outline-seg.left,
.outline-seg.right {
  top: 0;
  bottom: 0;
  width: var(--fm-intro-line-width);
  transform: scaleY(0);
}

.outline-seg.left {
  left: 0;
  transform-origin: bottom center;
}

.outline-seg.right {
  right: 0;
  transform-origin: top center;
}

.fm-panel-intro-active .fm-outline-draw {
  opacity: 1;
}

.fm-panel-intro-active .outline-seg.top,
.fm-panel-intro-active .outline-seg.bottom {
  animation: fm-outline-grow-x 0.64s cubic-bezier(0.25, 0.9, 0.3, 1) both;
}

.fm-panel-intro-active .outline-seg.left,
.fm-panel-intro-active .outline-seg.right {
  animation: fm-outline-grow-y 0.64s cubic-bezier(0.25, 0.9, 0.3, 1) both;
}

.fm-panel-outline-ready .outline-seg.top,
.fm-panel-outline-ready .outline-seg.bottom,
.fm-panel-outline-ready .outline-seg.left,
.fm-panel-outline-ready .outline-seg.right {
  transform: none;
}

.fm-panel-intro-active::before {
  opacity: 0;
  clip-path: inset(0 100% 0 0);
  animation: fm-overlay-reveal 0.72s cubic-bezier(0.25, 0.9, 0.3, 1) 0.12s both;
}

.fm-panel-intro-active .fm-archive-rail,
.fm-panel-intro-active .fm-mode-floating,
.fm-panel-intro-active .fm-header,
.fm-panel-intro-active .fm-content,
.fm-panel-intro-active .fm-loading,
.fm-panel-intro-active .fm-empty {
  animation: fm-content-reveal 0.72s cubic-bezier(0.18, 0.92, 0.28, 1) 0.42s both;
}

.fm-archive-rail {
  position: absolute;
  inset: 0 auto 0 0;
  width: 76px;
  padding: 28px 0 22px;
  border-right: 1px solid var(--fm-panel-border);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  z-index: 2;
  color: var(--fm-muted);
  background: rgba(8, 9, 20, 0.36);
}

.archive-index {
  font: 28px/1 Bender-Bold, Consolas, monospace;
  color: var(--fm-signal);
  font-variant-numeric: tabular-nums;
}

.archive-rule {
  width: 1px;
  flex: 1 1 auto;
  min-height: 64px;
  background: linear-gradient(
    180deg,
    var(--fm-signal),
    rgba(70, 246, 230, 0.06)
  );
}

.archive-name,
.archive-status {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  font: 9px/1 Geometos, sans-serif;
  letter-spacing: 0.16em;
}

.archive-status {
  color: var(--fm-subtle);
}

.fm-header {
  width: min(56%, 620px);
  margin-bottom: 18px;
  text-align: left;
  position: relative;
  z-index: 1;

  h1 {
    margin: 10px 0 0;
    display: flex;
    gap: 0.16em;
    font-family:
      "Noto Serif SC", "Source Han Serif SC", STSong, serif;
    font-size: clamp(44px, 4.4vw, 68px);
    font-weight: 600;
    line-height: 0.92;
    letter-spacing: -0.055em;
    color: var(--fm-text) !important;

    em {
      color: var(--fm-signal);
      font-style: normal;
      font-weight: 400;
    }
  }
}

.fm-headline {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  font: 10px/1 Geometos, sans-serif;
  letter-spacing: 0.16em;
  color: var(--fm-signal) !important;

  &::before {
    content: "";
    width: 26px;
    height: 1px;
    background: currentColor;
  }
}

.fm-subtitle {
  margin: 14px 0 0;
  font: 13px/1.7 SourceHanSansCN-Bold, sans-serif;
  color: var(--fm-muted) !important;
  display: block;
}

.fm-mode-floating {
  position: absolute;
  top: 30px;
  right: 36px;
  z-index: 8;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.fm-mode-trigger {
  border: 1px solid rgba(70, 246, 230, 0.42);
  min-height: 42px;
  min-width: 236px;
  max-width: 280px;
  padding: 0 16px;
  border-radius: 999px;
  background-color: var(--fm-mode-bg) !important;
  color: var(--fm-text) !important;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  cursor: pointer;
  box-shadow: none;
  appearance: none;
  -webkit-appearance: none;
  -webkit-tap-highlight-color: transparent;
  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;

  &:hover:not(:disabled) {
    background-color: var(--fm-mode-hover-bg) !important;
    border-color: var(--fm-signal);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.58;
    cursor: not-allowed;
    transform: none;
  }

  &:active {
    outline: none;
    box-shadow: none;
  }

  &:focus-visible {
    outline: 2px solid var(--fm-signal);
    outline-offset: 3px;
  }
}

.mode-trigger-code {
  flex: 0 0 auto;
  font: 9px/1 Geometos, sans-serif;
  letter-spacing: 0.12em;
  color: var(--fm-signal);
}

.mode-trigger-value {
  flex: 1 1 auto;
  min-width: 0;
  text-align: left;
  font: 12px SourceHanSansCN-Bold, sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mode-trigger-arrow {
  flex: 0 0 auto;
  transition: transform 0.2s ease;
}

.fm-mode-floating.open .mode-trigger-arrow {
  transform: rotate(180deg);
}

.fm-mode-dropdown {
  margin-top: 10px;
  width: min(400px, calc(100vw - 72px));
  padding: 16px;
  border: 1px solid rgba(70, 246, 230, 0.36);
  border-radius: 16px 2px 16px 2px;
  background: linear-gradient(
    180deg,
    var(--fm-mode-panel-bg) 0%,
    var(--fm-mode-panel-bg-soft) 100%
  );
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.38);
  backdrop-filter: blur(18px);
}

.fm-mode-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}

.fm-mode-title-code {
  font: 9px/1 Geometos, sans-serif;
  letter-spacing: 0.14em;
  color: var(--fm-signal) !important;
}

.fm-mode-title-text {
  font: 12px SourceHanSansCN-Bold, sans-serif;
  color: var(--fm-muted) !important;
}

.fm-mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.fm-submode-grid {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--fm-panel-border);
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.fm-mode-btn,
.fm-submode-btn {
  border: 1px solid var(--fm-panel-border);
  border-radius: 999px;
  background-color: var(--fm-mode-bg) !important;
  color: var(--fm-text) !important;
  padding: 7px 10px;
  min-height: 44px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
  cursor: pointer;
  box-shadow: none;
  appearance: none;
  -webkit-appearance: none;
  -webkit-tap-highlight-color: transparent;

  .mode-code {
    font: 8px/1 Bender-Bold, Consolas, monospace;
    letter-spacing: 0.1em;
    line-height: 1.1;
    color: var(--fm-subtle);
  }

  .mode-label {
    font: 11px SourceHanSansCN-Bold, sans-serif;
    line-height: 1.15;
    white-space: nowrap;
  }

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    background-color: var(--fm-mode-hover-bg) !important;
    border-color: rgba(70, 246, 230, 0.64);
  }

  &.active {
    background-color: var(--fm-mode-active-bg) !important;
    color: var(--fm-mode-active-text) !important;
    border-color: var(--fm-mode-active-border);

    .mode-code {
      color: var(--fm-mode-active-text);
    }
  }

  &.active:hover:not(:disabled) {
    transform: none;
    background-color: var(--fm-mode-active-bg) !important;
    color: var(--fm-mode-active-text) !important;
    border-color: var(--fm-mode-active-border);
  }

  &:disabled {
    opacity: 0.58;
    cursor: not-allowed;
    transform: none;
  }

  &:active {
    outline: none;
    box-shadow: none;
  }

  &:focus-visible {
    outline: 2px solid var(--fm-signal);
    outline-offset: 2px;
  }
}

.fm-mode-float-enter-active,
.fm-mode-float-leave-active {
  transition:
    opacity 0.16s ease,
    transform 0.16s ease;
}

.fm-mode-float-enter-from,
.fm-mode-float-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.fm-content {
  width: 100%;
  display: grid;
  gap: 18px;
  position: relative;
  z-index: 1;
}

.fm-main {
  min-height: 390px;
  display: grid;
  grid-template-columns: minmax(430px, 1.45fr) minmax(260px, 0.72fr);
  align-items: center;
  gap: clamp(28px, 4vw, 64px);
}

.fm-cover-carousel {
  width: 100%;
  min-width: 0;
  padding: 30px 0;
  position: relative;
  overflow: hidden;

  &::before {
    content: "";
    position: absolute;
    width: 340px;
    height: 340px;
    left: 50%;
    top: 50%;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    border: 1px solid rgba(70, 246, 230, 0.26);
    box-shadow:
      0 0 0 14px rgba(70, 246, 230, 0.018),
      inset 0 0 36px rgba(70, 246, 230, 0.025);
    opacity: 0.9;
    pointer-events: none;
  }

  &::after {
    content: "";
    position: absolute;
    width: 5px;
    height: 5px;
    left: 50%;
    top: 50%;
    margin: -2px 0 0 167px;
    border-radius: 50%;
    background: var(--fm-signal);
    box-shadow: 0 0 12px rgba(70, 246, 230, 0.62);
    transform-origin: -167px 2px;
    pointer-events: none;
    animation: fm-orbit-drift 24s linear infinite;
  }
}

.fm-cover-track {
  min-height: 286px;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(16px, 2.2vw, 34px);
  isolation: isolate;
}

.fm-cover-slot {
  position: relative;
  width: 132px;
  height: 132px;
  padding: 5px;
  border: 1px solid var(--fm-panel-border);
  border-radius: 2px;
  background-color: var(--fm-slot-bg) !important;
  color: var(--fm-text) !important;
  appearance: none;
  transition:
    border-color 0.2s ease,
    opacity 0.2s ease;
  will-change: transform, opacity;
  backface-visibility: hidden;

  img {
    width: 100%;
    height: 100%;
    border-radius: 2px;
    object-fit: cover;
    background: var(--fm-slot-bg);
    border: 0;
    display: block;
    transform: translateZ(0);
  }
}

.fm-cover-slot.slot-center {
  width: 258px;
  height: 258px;
  padding: 7px;
  opacity: 1;
  z-index: var(--fm-cover-z-center);
  border-color: rgba(70, 246, 230, 0.54);
  box-shadow:
    0 0 0 1px rgba(8, 9, 20, 0.9),
    0 22px 58px rgba(0, 0, 0, 0.34);
}

.fm-cover-slot.slot-side {
  opacity: var(--fm-side-opacity);
  z-index: var(--fm-cover-z-side);
}

.fm-cover-slot.slot-clickable:hover {
  cursor: pointer;
  border-color: var(--fm-slot-hover-border);
}

.fm-cover-slot:focus-visible {
  outline: 2px solid var(--fm-signal);
  outline-offset: 4px;
}

.fm-cover-slot:disabled {
  cursor: default;
}

.fm-cover-slot.slot-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--fm-placeholder-bg) !important;
  border-style: solid;
}

.slot-placeholder-text {
  font: 10px/1 Bender-Bold, Consolas, monospace;
  letter-spacing: 0.12em;
  color: var(--fm-placeholder-text) !important;
}

.slot-side-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    rgba(8, 9, 20, 0.58),
    rgba(8, 9, 20, 0.18)
  );
  pointer-events: none;
}

.fm-play-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 1px solid var(--fm-play-overlay-border);
  background-color: var(--fm-play-overlay-bg) !important;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--fm-play-overlay-icon) !important;
  opacity: 0.86;
  transition:
    transform 0.2s ease,
    opacity 0.2s ease,
    background-color 0.2s ease;
  z-index: 10;
  pointer-events: none;
  -webkit-backdrop-filter: blur(6px);
  backdrop-filter: blur(6px);
}

.fm-cover-slot.slot-center:hover .fm-play-overlay {
  opacity: 1;
  background-color: var(--fm-play-overlay-hover-bg) !important;
  transform: translate(-50%, -50%) scale(1.04);
}

.fm-dossier {
  min-width: 0;
  min-height: 318px;
  margin: 0;
  padding: 24px 0 6px 30px;
  border-left: 1px solid var(--fm-panel-border);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 28px;
}

.fm-info {
  min-width: 0;
  text-align: left;

  .fm-record-kicker {
    margin: 0 0 18px;
    font: 9px/1 Geometos, sans-serif;
    letter-spacing: 0.16em;
    color: var(--fm-signal) !important;
  }

  .song-name {
    max-width: 13ch;
    margin: 0 0 18px;
    font-family:
      "Noto Serif SC", "Source Han Serif SC", STSong, serif;
    font-size: clamp(27px, 2.4vw, 38px);
    font-weight: 600;
    line-height: 1.14;
    letter-spacing: -0.035em;
    color: var(--fm-text) !important;
    overflow-wrap: anywhere;
  }

  .artist-name {
    font: 13px/1.6 SourceHanSansCN-Bold, sans-serif;
    color: var(--fm-muted) !important;
    margin: 0 0 6px;

    .artist-link {
      margin: 0;
      padding: 0;
      border: 0;
      background-color: transparent !important;
      color: inherit !important;
      font: inherit;
      transition: color 0.2s ease;

      &.clickable {
        cursor: pointer;

        &:hover {
          color: var(--fm-signal) !important;
        }
      }

      &:focus-visible {
        outline: 2px solid var(--fm-signal);
        outline-offset: 3px;
      }
    }

    .artist-separator {
      margin: 0 0.45em;
      color: var(--fm-subtle);
    }
  }

  .album-name {
    width: fit-content;
    padding: 0;
    border: 0;
    background-color: transparent !important;
    font: 11px/1.6 SourceHanSansCN-Bold, sans-serif;
    color: var(--fm-subtle) !important;
    margin: 0;

    &.clickable {
      cursor: pointer;
      transition: color 0.2s ease;

      &:hover {
        color: var(--fm-signal) !important;
      }
    }

    &:focus-visible {
      outline: 2px solid var(--fm-signal);
      outline-offset: 3px;
    }
  }
}

.fm-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.action-btn {
  min-width: 0;
  min-height: 54px;
  padding: 0 16px;
  border: 1px solid var(--fm-panel-border);
  border-radius: 999px;
  background-color: var(--fm-ghost-btn-bg) !important;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 11px;
  cursor: pointer;
  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    color 0.2s ease,
    border-color 0.2s ease;
  color: var(--fm-text) !important;
  font: 12px/1 SourceHanSansCN-Bold, sans-serif;

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
  }

  span {
    display: grid;
    gap: 3px;
    text-align: left;
  }

  small {
    font: 8px/1 Geometos, sans-serif;
    letter-spacing: 0.12em;
    color: var(--fm-subtle);
  }

  &:hover:not(:disabled) {
    transform: translateY(-1px);
    background-color: var(--fm-ghost-btn-hover-bg) !important;
    border-color: rgba(70, 246, 230, 0.52);
  }

  &.trash:hover {
    background-color: var(--fm-danger-bg) !important;
    border-color: var(--fm-danger);
    color: var(--fm-danger) !important;
  }

  &.like.active {
    background-color: rgba(70, 246, 230, 0.11) !important;
    border-color: var(--fm-signal);
    color: var(--fm-signal) !important;
  }

  &.like:hover {
    background-color: rgba(70, 246, 230, 0.11) !important;
    border-color: var(--fm-signal);
  }

  &.next {
    background-color: var(--fm-primary-btn-bg) !important;
    color: var(--fm-primary-btn-text) !important;
    border-color: var(--fm-primary-btn-border);

    small {
      color: rgba(8, 9, 20, 0.62);
    }

    &:hover {
      background-color: var(--fm-primary-btn-hover-bg) !important;
    }
  }

  &:focus-visible {
    outline: 2px solid var(--fm-signal);
    outline-offset: 3px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.34;
  }
}

.fm-status-strip {
  min-height: 54px;
  padding: 10px 0 0;
  border-top: 1px solid var(--fm-panel-border);
  display: flex;
  justify-content: flex-end;
  gap: clamp(30px, 5vw, 76px);
  color: var(--fm-muted);
  -webkit-mask-image: linear-gradient(
    90deg,
    transparent,
    #000 7%,
    #000 96%,
    transparent
  );
  mask-image: linear-gradient(
    90deg,
    transparent,
    #000 7%,
    #000 96%,
    transparent
  );

  span {
    min-width: 112px;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    gap: 14px;
  }

  small {
    font: 8px/1 Geometos, sans-serif;
    letter-spacing: 0.12em;
    color: var(--fm-subtle);
  }

  strong {
    font: 11px/1.2 Bender-Bold, Consolas, monospace;
    color: var(--fm-text);
    font-variant-numeric: tabular-nums;
  }
}

.fm-loading,
.fm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 380px;
  position: relative;
  z-index: 1;
  color: var(--fm-muted) !important;
}

.loading-spinner {
  width: 52px;
  height: 52px;
  border: 1px solid var(--fm-spinner-track);
  border-top-color: var(--fm-signal);
  border-right-color: rgba(70, 246, 230, 0.46);
  border-radius: 50%;
  animation: spin 1.2s linear infinite;
  margin-bottom: 20px;
}

.fm-loading p,
.fm-empty p {
  color: var(--fm-muted) !important;
}

.fm-loading .state-kicker,
.fm-empty .state-kicker {
  margin: 0 0 10px;
  font: 9px/1 Geometos, sans-serif;
  letter-spacing: 0.16em;
  color: var(--fm-signal) !important;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

@keyframes fm-orbit-drift {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes fm-outline-grow-x {
  0% {
    transform: scaleX(0);
  }
  99% {
    transform: scaleX(1);
  }
  100% {
    transform: none;
  }
}

@keyframes fm-outline-grow-y {
  0% {
    transform: scaleY(0);
  }
  99% {
    transform: scaleY(1);
  }
  100% {
    transform: none;
  }
}

@keyframes fm-overlay-reveal {
  from {
    opacity: 0;
    clip-path: inset(0 100% 0 0);
  }
  to {
    opacity: var(--fm-panel-overlay-opacity);
    clip-path: inset(0 0 0 0);
  }
}

@keyframes fm-content-reveal {
  from {
    opacity: 0;
    transform: translateY(var(--fm-intro-content-offset));
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fm-content-reveal-reduced {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.empty-icon {
  margin-bottom: 16px;
  color: var(--fm-subtle) !important;
}

.error-hint {
  font-size: 12px;
  color: var(--fm-danger) !important;
  margin: 5px 0;
}

.refresh-button {
  margin-top: 18px;
  min-width: 132px;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid var(--fm-signal);
  border-radius: 999px;
  background-color: transparent !important;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    transform 0.2s ease,
    background-color 0.2s ease;
  font: 13px SourceHanSansCN-Bold, sans-serif;
  color: var(--fm-signal) !important;

  &:hover {
    transform: translateY(-1px);
    background-color: rgba(70, 246, 230, 0.1) !important;
  }

  &:focus-visible {
    outline: 2px solid var(--fm-signal);
    outline-offset: 3px;
  }
}

.fm-shift-next-move,
.fm-shift-prev-move,
.fm-shift-neutral-move {
  transition: transform var(--fm-cover-transition-duration)
    var(--fm-cover-transition-ease);
}

.fm-cover-slot.slot-side.fm-shift-next-move {
  transition: transform var(--fm-cover-transition-duration)
    var(--fm-cover-transition-ease);
  opacity: 1;
  z-index: var(--fm-cover-z-side-moving);
  animation: fm-cover-side-overlap-release var(--fm-cover-overlap-fade-duration)
    linear var(--fm-cover-overlap-release-delay) both;
}

.fm-cover-slot.slot-center.fm-shift-next-move,
.fm-cover-slot.slot-center.fm-shift-neutral-move {
  opacity: 1;
  z-index: var(--fm-cover-z-center);
}

/* goPrev 三层顺序：新中间 > 旧中间 > right->leave（最低） */
.fm-cover-slot.slot-side.fm-shift-prev-move {
  transition: transform var(--fm-cover-transition-duration)
    var(--fm-cover-transition-ease);
  opacity: 1;
  z-index: var(--fm-cover-z-prev-right-leave-bottom);
  animation: fm-cover-side-overlap-release var(--fm-cover-overlap-fade-duration)
    linear var(--fm-cover-overlap-release-delay) both;
}

.fm-cover-slot.slot-right.fm-shift-prev-move {
  z-index: var(--fm-cover-z-prev-old-center-mid);
}

.fm-cover-slot.slot-center.fm-shift-prev-move {
  opacity: 1;
  z-index: var(--fm-cover-z-prev-new-center-top);
}

.fm-cover-slot.slot-center.fm-shift-prev-enter-active,
.fm-cover-slot.slot-center.fm-shift-prev-enter-from,
.fm-cover-slot.slot-center.fm-shift-prev-enter-to,
.fm-cover-slot.slot-left.fm-shift-prev-enter-active,
.fm-cover-slot.slot-left.fm-shift-prev-enter-from,
.fm-cover-slot.slot-left.fm-shift-prev-enter-to {
  z-index: var(--fm-cover-z-prev-right-leave-bottom);
}

.fm-shift-next-enter-active,
.fm-shift-prev-enter-active,
.fm-shift-neutral-enter-active {
  transition:
    transform var(--fm-cover-transition-duration)
      var(--fm-cover-transition-ease),
    opacity var(--fm-cover-transition-duration) var(--fm-cover-transition-ease);
}

.fm-shift-next-leave-active,
.fm-shift-prev-leave-active,
.fm-shift-neutral-leave-active {
  transition:
    transform var(--fm-cover-transition-duration)
      var(--fm-cover-transition-ease),
    opacity var(--fm-cover-ghost-fade-duration) linear
      var(--fm-cover-ghost-fade-delay);
}

.fm-cover-slot.slot-placeholder.fm-shift-next-leave-active,
.fm-cover-slot.slot-placeholder.fm-shift-prev-leave-active,
.fm-cover-slot.slot-placeholder.fm-shift-neutral-leave-active {
  transition: opacity var(--fm-cover-placeholder-fade-duration) linear;
}

.fm-cover-slot.fm-shift-next-leave-active,
.fm-cover-slot.fm-shift-prev-leave-active,
.fm-cover-slot.fm-shift-neutral-leave-active {
  position: absolute;
  pointer-events: none;
  z-index: var(--fm-cover-z-leaving);
}

.fm-shift-next-leave-from,
.fm-shift-prev-leave-from,
.fm-shift-neutral-leave-from {
  opacity: 1;
}

.fm-cover-slot.slot-right.fm-shift-prev-leave-active,
.fm-cover-slot.slot-right.fm-shift-prev-leave-from,
.fm-cover-slot.slot-right.fm-shift-prev-leave-to {
  z-index: var(--fm-cover-z-prev-right-leave-bottom);
}

.fm-shift-next-enter-from {
  opacity: 0;
  transform: translateX(20px) scale(0.97);
}

.fm-shift-next-leave-to {
  opacity: 0;
  transform: translateX(-20px) scale(0.97);
}

.fm-shift-prev-enter-from {
  opacity: 0;
  transform: translateX(-20px) scale(0.97);
}

.fm-shift-prev-leave-to {
  opacity: 0;
  transform: translateX(20px) scale(0.97);
}

.fm-shift-neutral-enter-from,
.fm-shift-neutral-leave-to {
  opacity: 0;
  transform: scale(0.97);
}

.fm-cover-slot.slot-placeholder.fm-shift-next-leave-to,
.fm-cover-slot.slot-placeholder.fm-shift-prev-leave-to,
.fm-cover-slot.slot-placeholder.fm-shift-neutral-leave-to {
  opacity: 0;
  transform: none;
}

@keyframes fm-cover-side-overlap-release {
  from {
    opacity: 1;
  }
  to {
    opacity: var(--fm-side-opacity);
  }
}

@media (prefers-reduced-motion: reduce) {
  .fm-panel-intro-active,
  .fm-panel-intro-active::before,
  .fm-panel-intro-active .fm-outline-draw,
  .fm-panel-intro-active .outline-seg,
  .fm-cover-carousel::after {
    animation: none !important;
  }

  .fm-panel-intro-active::before {
    opacity: 1 !important;
    clip-path: inset(0 0 0 0) !important;
  }

  .fm-panel-intro-active .fm-outline-draw {
    opacity: 1 !important;
  }

  .fm-panel-intro-active .outline-seg,
  .fm-panel-outline-ready .outline-seg {
    transform: none !important;
  }

  .fm-panel-intro-active .fm-archive-rail,
  .fm-panel-intro-active .fm-mode-floating,
  .fm-panel-intro-active .fm-header,
  .fm-panel-intro-active .fm-content,
  .fm-panel-intro-active .fm-loading,
  .fm-panel-intro-active .fm-empty {
    animation: fm-content-reveal-reduced 0.12s linear both;
  }
}

@media (max-width: 1180px) {
  .fm-panel {
    padding: 28px 28px 22px 94px;
  }

  .fm-archive-rail {
    width: 64px;
  }

  .fm-main {
    grid-template-columns: minmax(390px, 1.25fr) minmax(250px, 0.75fr);
    gap: 24px;
  }

  .fm-cover-carousel::before {
    width: 300px;
    height: 300px;
  }

  .fm-cover-carousel::after {
    margin-left: 147px;
    transform-origin: -147px 2px;
  }

  .fm-cover-slot {
    width: 108px;
    height: 108px;
  }

  .fm-cover-slot.slot-center {
    width: 220px;
    height: 220px;
  }

  .action-btn {
    padding-inline: 12px;
  }
}

@media (max-width: 900px), (orientation: portrait) {
  .fm-panel {
    min-height: 0;
    padding: 20px;
    display: flex;
    flex-direction: column;
  }

  .fm-archive-rail {
    position: relative;
    inset: auto;
    order: 1;
    width: 100%;
    min-height: 34px;
    padding: 0 0 12px;
    border-right: 0;
    border-bottom: 1px solid var(--fm-panel-border);
    flex-direction: row;
    align-items: center;
    gap: 12px;
    background: transparent;
  }

  .archive-index {
    font-size: 22px;
  }

  .archive-rule {
    width: auto;
    height: 1px;
    min-height: 1px;
    min-width: 36px;
    background: linear-gradient(
      90deg,
      var(--fm-signal),
      rgba(70, 246, 230, 0.06)
    );
  }

  .archive-name,
  .archive-status {
    writing-mode: horizontal-tb;
    transform: none;
  }

  .fm-header {
    order: 2;
    width: 100%;
    margin: 22px 0 0;

    h1 {
      font-size: clamp(42px, 10vw, 58px);
    }
  }

  .fm-mode-floating {
    position: relative;
    inset: auto;
    order: 3;
    margin: 22px 0 8px;
    align-items: flex-start;
  }

  .fm-mode-trigger {
    min-width: min(300px, 100%);
  }

  .fm-mode-dropdown {
    width: min(400px, calc(100vw - 82px));
  }

  .fm-content {
    order: 4;
  }

  .fm-main {
    min-height: 0;
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .fm-cover-carousel {
    padding-block: 22px;
  }

  .fm-dossier {
    min-height: 0;
    padding: 24px 0 0;
    border-left: 0;
    border-top: 1px solid var(--fm-panel-border);
  }

  .fm-info .song-name {
    max-width: none;
  }

  .fm-actions {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .action-btn {
    justify-content: center;
  }

  .fm-status-strip {
    justify-content: space-between;
  }

  .fm-loading,
  .fm-empty {
    order: 4;
  }
}

@media (max-width: 600px) {
  .fm-panel {
    padding: 12px 16px;
  }

  .fm-archive-rail {
    min-height: 28px;
    padding-bottom: 8px;
    gap: 8px;
  }

  .archive-index {
    font-size: 18px;
  }

  .archive-name {
    font-size: 8px;
  }

  .archive-status {
    display: none;
  }

  .fm-header {
    margin-top: 12px;

    h1 {
      margin-top: 8px;
      font-size: 34px;
    }
  }

  .fm-headline {
    font-size: 8px;
  }

  .fm-subtitle {
    margin-top: 8px;
    font-size: 12px;
  }

  .fm-mode-floating {
    margin: 12px 0 4px;
  }

  .fm-mode-trigger,
  .fm-mode-dropdown {
    width: 100%;
    max-width: none;
    min-width: 0;
  }

  .fm-mode-trigger {
    min-height: 40px;
  }

  .fm-mode-dropdown {
    padding: 12px;
  }

  .fm-submode-grid {
    grid-template-columns: 1fr;
  }

  .fm-cover-carousel {
    margin-inline: -4px;
    width: calc(100% + 8px);
    padding-block: 10px;

    &::before {
      width: 210px;
      height: 210px;
    }

    &::after {
      margin-left: 103px;
      transform-origin: -103px 2px;
    }
  }

  .fm-cover-track {
    min-height: 184px;
    gap: 8px;
  }

  .fm-cover-slot {
    width: 50px;
    height: 50px;
    padding: 3px;
  }

  .fm-cover-slot.slot-center {
    width: 156px;
    height: 156px;
    padding: 5px;
  }

  .fm-play-overlay {
    width: 46px;
    height: 46px;
  }

  .fm-dossier {
    padding-top: 16px;
    gap: 16px;
  }

  .fm-info {
    .fm-record-kicker {
      margin-bottom: 10px;
      font-size: 8px;
    }

    .song-name {
      margin-bottom: 10px;
      font-size: 26px;
    }

    .artist-name {
      margin-bottom: 2px;
      font-size: 12px;
    }

    .album-name {
      font-size: 10px;
    }
  }

  .fm-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .action-btn {
    min-height: 44px;
    padding-inline: 12px;
    justify-content: flex-start;
  }

  .fm-status-strip {
    min-height: 44px;
    padding-top: 8px;
    align-items: center;
    flex-direction: row;
    gap: 10px;

    span {
      width: auto;
      min-width: 0;
      flex: 1 1 0;
      gap: 6px;
    }

    small {
      font-size: 7px;
    }

    strong {
      font-size: 10px;
    }
  }
}

@media (max-height: 720px) and (min-width: 901px) {
  .fm-panel {
    min-height: 560px;
    padding-block: 22px 18px;
  }

  .fm-header {
    margin-bottom: 8px;

    h1 {
      font-size: 44px;
    }
  }

  .fm-main {
    min-height: 328px;
  }

  .fm-cover-carousel {
    padding-block: 16px;
  }

  .fm-cover-track {
    min-height: 236px;
  }

  .fm-cover-carousel::before {
    width: 288px;
    height: 288px;
  }

  .fm-cover-carousel::after {
    margin-left: 141px;
    transform-origin: -141px 2px;
  }

  .fm-cover-slot {
    width: 106px;
    height: 106px;
  }

  .fm-cover-slot.slot-center {
    width: 218px;
    height: 218px;
  }

  .fm-dossier {
    min-height: 280px;
    padding-top: 16px;
    gap: 18px;
  }
}
</style>

<style lang="scss">
html:not(.dark) .personal-fm {
  --ark-ink: #191919;
  --ark-paper: #f4f4ee;
  --ark-signal: #fffa00;
  --fm-ink: var(--ark-ink);
  --fm-paper: var(--ark-paper);
  --fm-signal: var(--fm-ink);
  --fm-rail: #e2e2db;
  --fm-field: #d6d8d4;
  --fm-yellow: var(--ark-signal);
  --fm-stage-bg: transparent;
  --fm-panel-bg:
    linear-gradient(90deg, transparent 0 71%, rgb(25 25 25 / 5%) 71% 71.1%, transparent 71.1%),
    linear-gradient(135deg, transparent 0 77%, rgb(226 226 219 / 72%) 77% 100%),
    var(--fm-paper);
  --fm-panel-border: var(--fm-ink);
  --fm-panel-overlay: none;
  --fm-panel-overlay-opacity: 0.3;
  --fm-text: var(--fm-ink);
  --fm-muted: #595a56;
  --fm-subtle: #73746e;
  --fm-primary-btn-bg: var(--fm-yellow);
  --fm-primary-btn-text: var(--fm-ink);
  --fm-primary-btn-border: var(--fm-ink);
  --fm-primary-btn-hover-bg: #ffff52;
  --fm-ghost-btn-bg: var(--fm-paper);
  --fm-ghost-btn-hover-bg: #e2e2db;
  --fm-mode-bg: var(--fm-paper);
  --fm-mode-hover-bg: var(--fm-rail);
  --fm-mode-panel-bg: var(--fm-paper);
  --fm-mode-panel-bg-soft: #e2e2db;
  --fm-mode-active-bg: var(--fm-yellow);
  --fm-mode-active-text: var(--fm-ink);
  --fm-mode-active-border: var(--fm-ink);
  --fm-play-overlay-bg: var(--fm-yellow);
  --fm-play-overlay-hover-bg: #ffff52;
  --fm-play-overlay-border: var(--fm-ink);
  --fm-play-overlay-icon: var(--fm-ink);
  --fm-danger: #a22f26;
  --fm-danger-bg: #f1ddd8;
  --fm-spinner-track: #c5c6bf;
  --fm-slot-bg: var(--fm-paper);
  --fm-slot-hover-border: var(--fm-ink);
  --fm-side-opacity: 0.52;
  --fm-placeholder-bg: #d8dad5;
  --fm-placeholder-text: #53554f;
  --fm-intro-line-color: var(--fm-ink);
  color-scheme: light;

  .fm-stage {
    align-items: stretch;
    padding: 0;
    box-sizing: border-box;
  }

  .fm-panel {
    width: 100%;
    max-width: 100%;
    min-height: max(600px, 100%);
    padding: 32px 38px 24px 112px;
    border: 1px solid var(--fm-ink);
    border-radius: 0;
    box-shadow: 0 18px 42px rgb(25 25 25 / 12%);
  }

  .fm-panel::before {
    inset: 0;
    z-index: 0;
    background-image:
      linear-gradient(90deg, transparent 0 24%, rgb(25 25 25 / 8%) 24% calc(24% + 1px), transparent calc(24% + 1px)),
      linear-gradient(180deg, transparent 0 64%, rgb(25 25 25 / 8%) 64% calc(64% + 1px), transparent calc(64% + 1px));
    background-size: auto;
    opacity: 1;
    -webkit-mask-image: none;
    mask-image: none;
  }

  .fm-panel::after {
    content: "";
    position: absolute;
    right: 34px;
    bottom: 22px;
    width: 72px;
    height: 12px;
    z-index: 0;
    pointer-events: none;
    background: var(--fm-yellow);
    clip-path: polygon(0 0, 100% 0, 82% 100%, 0 100%);
  }

  .fm-archive-rail {
    inset: 0 auto 0 0;
    width: 76px;
    height: auto;
    padding: 28px 0 22px;
    border: 0;
    border-right: 1px solid var(--fm-ink);
    flex-direction: column;
    gap: 16px;
    color: var(--fm-ink);
    background: var(--fm-rail);
  }

  .archive-index {
    padding: 8px 7px 5px;
    border: 1px solid var(--fm-ink);
    border-radius: 0;
    background: var(--fm-ink);
    color: var(--fm-paper);
    box-shadow: inset 0 -7px 0 var(--fm-yellow);
    font-size: 22px;
  }

  .archive-rule {
    width: 1px;
    height: auto;
    min-height: 64px;
    flex: 1 1 auto;
    background: linear-gradient(180deg, var(--fm-ink), transparent);
  }

  .archive-name,
  .archive-status {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    color: var(--fm-ink);
    font-family: SourceHanSansCN-Bold, sans-serif;
    font-size: 9px;
    letter-spacing: 0.1em;
  }

  .archive-status {
    margin-left: 0;
    color: var(--fm-subtle);
  }

  .fm-header {
    width: min(60%, 680px);
    margin-bottom: 20px;

    h1 {
      margin-top: 8px;
      gap: 0.12em;
      font-family:
        SourceHanSansCN-Heavy, SourceHanSansCN-Bold, "Microsoft YaHei",
        sans-serif;
      font-size: clamp(44px, 4.4vw, 68px);
      font-weight: 900;
      line-height: 0.92;
      letter-spacing: -0.055em;

      em {
        position: relative;
        padding-inline: 0.06em;
        color: var(--fm-ink);
        font-weight: 900;
        box-shadow: inset 0 -0.2em 0 var(--fm-yellow);
      }
    }
  }

  .fm-headline {
    color: var(--fm-ink) !important;
    font-family: Bender-Bold, Consolas, monospace;
    font-size: 10px;

    &::before {
      width: 34px;
      height: 4px;
      background: var(--fm-yellow);
      box-shadow: inset 0 0 0 1px var(--fm-ink);
    }
  }

  .fm-subtitle {
    color: var(--fm-muted) !important;
  }

  .fm-mode-trigger {
    min-height: 44px;
    border: 1px solid var(--fm-ink);
    border-radius: 2px;
    background-color: var(--fm-yellow) !important;
    color: var(--fm-ink) !important;
  }

  .mode-trigger-code,
  .mode-trigger-value {
    color: var(--fm-ink);
  }

  .fm-mode-dropdown {
    border: 1px solid var(--fm-ink);
    border-radius: 2px;
    box-shadow: 8px 8px 0 rgb(25 25 25 / 22%);
    backdrop-filter: none;
  }

  .fm-mode-btn,
  .fm-submode-btn {
    border: 1px solid var(--fm-ink);
    border-radius: 2px;

    &:hover:not(:disabled) {
      border-color: var(--fm-ink);
    }

    &.active,
    &.active:hover:not(:disabled) {
      background-color: var(--fm-mode-active-bg) !important;
      color: var(--fm-mode-active-text) !important;
      border-color: var(--fm-mode-active-border);

      .mode-code,
      .mode-label {
        color: var(--fm-mode-active-text);
      }
    }
  }

  .fm-main {
    gap: clamp(24px, 3vw, 52px);
  }

  .fm-cover-carousel {
    padding: 34px 18px;
    border: 1px solid var(--fm-ink);
    border-radius: 0;
    background:
      linear-gradient(90deg, #c9ccca 0 22%, transparent 22% 24%, #e8e8e1 24% 68%, transparent 68% 70%, #bfc5c4 70% 100%),
      var(--fm-field);

    &::before {
      width: min(330px, 58vw);
      height: auto;
      aspect-ratio: 1;
      border: 1px solid var(--fm-ink);
      border-radius: 0;
      background:
        linear-gradient(135deg, rgb(244 244 238 / 76%) 0 48%, transparent 48%),
        rgb(25 25 25 / 7%);
      box-shadow: inset 0 0 0 12px rgb(244 244 238 / 22%);
      clip-path: polygon(0 10%, 90% 0, 100% 90%, 10% 100%);
      opacity: 0.9;
      animation: fm-endfield-breathe 4.8s ease-in-out infinite alternate;
    }

    &::after {
      width: 68px;
      height: 12px;
      top: 12%;
      right: 8%;
      left: auto;
      margin: 0;
      border: 0;
      border-radius: 0;
      background: var(--fm-yellow);
      box-shadow: inset 0 0 0 1px var(--fm-ink);
      clip-path: polygon(0 0, 100% 0, 82% 100%, 0 100%);
      transform-origin: center;
      animation: none;
    }
  }

  .fm-cover-slot {
    border: 1px solid var(--fm-ink);
    border-radius: 0;

    img {
      border-radius: 0;
    }
  }

  .fm-cover-slot.slot-center {
    border-color: var(--fm-ink);
    border-radius: 0;
    background: var(--fm-paper) !important;
    box-shadow:
      0 0 0 1px var(--fm-paper),
      0 16px 28px rgb(25 25 25 / 22%);
  }

  .slot-side-overlay {
    border-radius: 0;
    background: linear-gradient(
      90deg,
      rgb(25 25 25 / 48%),
      rgb(25 25 25 / 10%)
    );
  }

  .fm-play-overlay {
    border-width: 1px;
    border-radius: 2px;
    backdrop-filter: none;
  }

  .fm-dossier {
    padding: 24px;
    border: 1px solid var(--fm-ink);
    border-radius: 0;
    background: rgb(244 244 238 / 92%);
  }

  .fm-info {
    .fm-record-kicker {
      color: var(--fm-ink) !important;
    }

    .song-name {
      font-family:
        SourceHanSansCN-Heavy, SourceHanSansCN-Bold, "Microsoft YaHei",
        sans-serif;
      font-weight: 900;
      letter-spacing: -0.045em;
    }
  }

  .action-btn {
    border: 1px solid var(--fm-ink);
    border-radius: 2px;

    &:hover:not(:disabled) {
      border-color: var(--fm-ink);
    }

    &.trash:hover {
      border-color: var(--fm-ink);
      color: var(--fm-danger) !important;
    }

    &.like.active,
    &.like:hover {
      border-color: var(--fm-ink);
    }

    &.like.active {
      background-color: var(--fm-yellow) !important;
      color: var(--fm-ink) !important;

      small {
        color: rgb(25 25 25 / 62%);
      }
    }
  }

  .fm-status-strip {
    min-height: 52px;
    padding: 10px 14px;
    border: 1px solid var(--fm-ink);
    border-radius: 0;
    background:
      linear-gradient(90deg, var(--fm-yellow) 0 8px, transparent 8px),
      var(--fm-rail);
    -webkit-mask-image: none;
    mask-image: none;
  }

  .refresh-button {
    border-width: 1px;
    border-color: var(--fm-ink);
    border-radius: 2px;
    color: var(--fm-ink) !important;
    background-color: var(--fm-yellow) !important;
  }
}

@keyframes fm-endfield-breathe {
  from {
    transform: translate(-50%, -50%) scale(0.985);
    opacity: 0.76;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 0.92;
  }
}

@media (max-width: 1180px) {
  html:not(.dark) .personal-fm {
    .fm-panel {
      padding: 28px 28px 22px 94px;
    }

    .fm-archive-rail {
      width: 64px;
    }
  }
}

@media (max-width: 900px), (orientation: portrait) {
  html:not(.dark) .personal-fm {
    .fm-panel {
      min-height: 0;
      padding: 20px;
    }

    .fm-panel::before {
      inset: 0;
    }

    .fm-panel::after {
      right: 20px;
      bottom: 18px;
      width: 62px;
      height: 10px;
    }

    .fm-archive-rail {
      position: relative;
      inset: auto;
      order: 1;
      width: calc(100% + 40px);
      height: auto;
      min-height: 48px;
      margin: -20px -20px 0;
      padding: 10px 20px;
      border-right: 0;
      border-bottom: 1px solid var(--fm-ink);
      flex-direction: row;
      gap: 12px;
    }

    .archive-rule {
      width: auto;
      height: 1px;
      min-height: 1px;
      min-width: 36px;
      background: linear-gradient(90deg, var(--fm-ink), transparent);
    }

    .archive-name,
    .archive-status {
      writing-mode: horizontal-tb;
      transform: none;
    }

    .archive-status {
      margin-left: auto;
    }

    .fm-header {
      width: 100%;
      margin: 22px 0 0;

      h1 {
        font-size: clamp(38px, 9vw, 54px);
      }
    }

    .fm-cover-carousel {
      padding-block: 26px;
    }

    .fm-dossier {
      padding: 22px;
      border-top: 1px solid var(--fm-ink);
    }
  }
}

@media (max-width: 600px) {
  html:not(.dark) .personal-fm {
    .fm-stage {
      padding: 0;
    }

    .fm-panel {
      width: 100%;
      max-width: 100%;
      padding: 12px 16px;
      border-radius: 0;
      box-shadow: 0 12px 28px rgb(25 25 25 / 10%);
    }

    .fm-panel::before {
      inset: 0;
    }

    .fm-panel::after {
      right: 14px;
      bottom: 12px;
      width: 52px;
      height: 9px;
    }

    .fm-archive-rail {
      width: calc(100% + 32px);
      min-height: 44px;
      margin: -12px -16px 0;
      padding: 8px 16px;
      gap: 8px;
    }

    .archive-index {
      padding: 5px 8px 4px;
      font-size: 16px;
    }

    .archive-rule {
      min-width: 20px;
    }

    .archive-status {
      display: none;
    }

    .archive-name {
      font-size: 8px;
    }

    .fm-header {
      margin-top: 8px;

      h1 {
        font-size: 34px;
      }
    }

    .fm-cover-carousel {
      padding-block: 18px;
      border-radius: 0;

      &::before {
        width: min(230px, 60vw);
      }

      &::after {
        width: 52px;
        height: 10px;
        top: 10%;
        right: 6%;
      }
    }

    .fm-dossier {
      padding: 18px;
      border-radius: 0;
    }

    .fm-status-strip {
      padding-inline: 10px;
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  html:not(.dark) .personal-fm .fm-cover-carousel::before,
  html:not(.dark) .personal-fm .fm-cover-carousel::after {
    animation: none !important;
  }
}

.dark .personal-fm .fm-mode-trigger,
.dark .personal-fm .fm-mode-btn,
.dark .personal-fm .fm-submode-btn,
.dark .personal-fm .fm-cover-slot,
.dark .personal-fm .action-btn,
.dark .personal-fm .artist-link,
.dark .personal-fm .album-name,
.dark .personal-fm .refresh-button {
  background-color: var(--fm-ghost-btn-bg) !important;
}

.dark .personal-fm .fm-mode-trigger,
.dark .personal-fm .fm-mode-btn,
.dark .personal-fm .fm-submode-btn {
  background-color: var(--fm-mode-bg) !important;
}

.dark .personal-fm .artist-link,
.dark .personal-fm .album-name,
.dark .personal-fm .refresh-button {
  background-color: transparent !important;
}

.dark .personal-fm .fm-mode-btn.active,
.dark .personal-fm .fm-submode-btn.active {
  background-color: var(--fm-mode-active-bg) !important;
  color: var(--fm-mode-active-text) !important;
  border-color: var(--fm-mode-active-border) !important;
}

.dark .personal-fm .fm-mode-btn.active .mode-code,
.dark .personal-fm .fm-mode-btn.active .mode-label,
.dark .personal-fm .fm-submode-btn.active .mode-code,
.dark .personal-fm .fm-submode-btn.active .mode-label {
  color: var(--fm-mode-active-text) !important;
}

.dark .personal-fm .action-btn.next {
  background-color: var(--fm-primary-btn-bg) !important;
  color: var(--fm-primary-btn-text) !important;
}

.dark .personal-fm .action-btn.next svg path {
  fill: var(--fm-primary-btn-text) !important;
  stroke: var(--fm-primary-btn-text) !important;
}

.dark .personal-fm .action-btn.like.active svg path,
.dark .personal-fm .fm-play-overlay svg path {
  fill: var(--fm-signal) !important;
  stroke: var(--fm-signal) !important;
}
</style>
