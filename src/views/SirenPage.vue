<script setup>
import { computed, watch, nextTick, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { storeToRefs } from 'pinia'
import { applyPlayMode, playAll } from '../utils/player'
import { useSirenStore } from '../store/sirenStore'
import { runWithConcurrency } from '../utils/runWithConcurrency.mjs'
import { buildSirenPlaybackQueue } from '../utils/sirenPlayback.mjs'
import { noticeOpen } from '../utils/dialog'
import LibrarySongList from '../components/LibrarySongList.vue'
import BaseModal from '../components/base/BaseModal.vue'

const route = useRoute()
const router = useRouter()
const sirenStore = useSirenStore()
const { albums, albumsLoading, albumsError, albumDetailsById, albumLoadingById, albumErrorById, keyword } = storeToRefs(sirenStore)

const currentAlbumId = computed(() => String(route.params.id || '').trim())
const isAlbumRoute = computed(() => currentAlbumId.value !== '')
const currentAlbum = computed(() => {
    if (!currentAlbumId.value) return null
    return albumDetailsById.value[currentAlbumId.value] || null
})
const currentAlbumLoading = computed(() => !!albumLoadingById.value[currentAlbumId.value])
const currentAlbumError = computed(() => albumErrorById.value[currentAlbumId.value] || '')
const playModeDialogShow = ref(false)
const allAlbumsLoading = ref(false)

const normalizedKeyword = computed(() => String(keyword.value || '').trim().toLocaleLowerCase())
const visibleAlbums = computed(() => {
    const targetAlbums = Array.isArray(albums.value) ? albums.value : []
    if (!normalizedKeyword.value) return targetAlbums

    return targetAlbums.filter(album => {
        const haystack = [
            album?.name,
            album?.artistNames,
            ...(Array.isArray(album?.artistes) ? album.artistes : []),
        ].join('\n').toLocaleLowerCase()
        return haystack.includes(normalizedKeyword.value)
    })
})
const visibleSongs = computed(() => {
    const songs = Array.isArray(currentAlbum.value?.songs) ? currentAlbum.value.songs : []
    if (!normalizedKeyword.value) return songs

    return songs.filter(song => {
        const haystack = [
            song?.name,
            ...(Array.isArray(song?.ar) ? song.ar.map(artist => artist?.name) : []),
        ].join('\n').toLocaleLowerCase()
        return haystack.includes(normalizedKeyword.value)
    })
})

const loadPageData = async (force = false) => {
    await sirenStore.ensureAlbums(force)
    if (isAlbumRoute.value) {
        await sirenStore.ensureAlbumDetail(currentAlbumId.value, force)
    }
}

let savedScrollTop = 0
let shouldRestoreScroll = false

const getScrollContainer = () => document.querySelector('.home-content')

const openAlbum = albumId => {
    const normalizedAlbumId = String(albumId || '').trim()
    if (!normalizedAlbumId) return
    const container = getScrollContainer()
    if (container) savedScrollTop = container.scrollTop
    shouldRestoreScroll = true
    router.push(`/siren/album/${normalizedAlbumId}`)
}

const backToAlbums = () => {
    router.push('/siren')
}

const reloadPage = () => {
    loadPageData(true)
}

const playAllSongs = () => {
    if (!visibleSongs.value.length) return
    playAll('siren', visibleSongs.value, { id: currentAlbumId.value || 'siren' })
}

const playAllAlbums = async randomize => {
    const targetAlbums = visibleAlbums.value.slice()
    if (!targetAlbums.length || allAlbumsLoading.value) return

    allAlbumsLoading.value = true
    const detailsById = {}
    try {
        // ponytail: four concurrent detail requests match the existing Siren preloader ceiling; raise only if API profiling supports it.
        await runWithConcurrency(targetAlbums, 4, async album => {
            const albumId = String(album?.id || '').trim()
            if (!albumId) return
            detailsById[albumId] = await sirenStore.ensureAlbumDetail(albumId)
        })

        const queue = buildSirenPlaybackQueue(targetAlbums, detailsById)
        if (!queue.length) {
            noticeOpen('没有可播放的曲目', 2)
            return
        }

        applyPlayMode(randomize ? 3 : 0, { inFM: false })
        playAll('siren', queue, { id: 'siren-all' })
        playModeDialogShow.value = false
    } finally {
        allAlbumsLoading.value = false
    }
}

watch(
    () => route.fullPath,
    (newPath, oldPath) => {
        sirenStore.setKeyword('')
        loadPageData(false)

        // 仅从专辑详情点击返回时恢复滚动位置
        if (!isAlbumRoute.value && shouldRestoreScroll) {
            shouldRestoreScroll = false
            nextTick(() => {
                const container = getScrollContainer()
                if (container) container.scrollTop = savedScrollTop
            })
        } else if (!isAlbumRoute.value) {
            nextTick(() => {
                const container = getScrollContainer()
                if (container) container.scrollTop = 0
            })
        }
    },
    { immediate: true }
)
</script>

<template>
    <section
        class="siren-page"
        data-ark-depth="moderate"
        data-ark-theme-light="endfield"
        data-ark-theme-dark="ark"
        :data-view="isAlbumRoute ? 'album' : 'archive'"
    >
        <div class="stage-grid" aria-hidden="true"></div>
        <div class="stage-mark" aria-hidden="true"></div>

        <header class="page-header">
            <div class="page-title-group">
                <button v-if="isAlbumRoute" class="header-back" type="button" @click="backToAlbums">
                    <span aria-hidden="true">←</span>
                    返回目录
                </button>
                <div class="title-instrument">
                    <span class="section-index" aria-hidden="true">{{ isAlbumRoute ? '02' : '01' }}</span>
                    <div class="page-title-block">
                        <span class="page-kicker">{{ isAlbumRoute ? 'ALBUM DOSSIER' : 'RELEASE INDEX' }}</span>
                        <h1 class="page-title">{{ isAlbumRoute ? (currentAlbum?.name || '塞壬唱片') : '塞壬唱片' }}</h1>
                        <p class="page-subtitle">
                            {{ isAlbumRoute ? (currentAlbum?.artistNames || '官方音源专区') : 'Monster Siren 官方音源专区' }}
                        </p>
                    </div>
                </div>
            </div>

            <div class="page-actions">
                <label class="search-control">
                    <span class="control-label">FILTER / 检索</span>
                    <input
                        v-model="keyword"
                        class="page-search"
                        :placeholder="isAlbumRoute ? '搜索当前专辑曲目' : '搜索专辑'"
                        type="search"
                    />
                </label>
                <button
                    v-if="!isAlbumRoute"
                    class="action-button primary"
                    type="button"
                    :disabled="visibleAlbums.length === 0 || albumsLoading"
                    @click="playModeDialogShow = true"
                >
                    随机播放全部
                </button>
                <button v-if="isAlbumRoute" class="action-button primary" type="button" :disabled="visibleSongs.length === 0" @click="playAllSongs">
                    播放全部
                </button>
                <button class="action-button" type="button" @click="reloadPage">刷新数据</button>
            </div>
        </header>

        <div class="page-status" aria-label="目录状态">
            <span class="status-signal" aria-hidden="true"></span>
            <span class="status-cell">
                <small>VIEW</small>
                <strong>{{ isAlbumRoute ? 'ALBUM DETAIL' : 'RELEASE ARCHIVE' }}</strong>
            </span>
            <span class="status-cell">
                <small>VISIBLE</small>
                <strong>
                    {{ isAlbumRoute
                        ? `${visibleSongs.length} ${visibleSongs.length === 1 ? 'TRACK' : 'TRACKS'}`
                        : `${visibleAlbums.length} ${visibleAlbums.length === 1 ? 'RELEASE' : 'RELEASES'}` }}
                </strong>
            </span>
            <span class="status-cell">
                <small>SOURCE</small>
                <strong>{{ normalizedKeyword ? 'FILTER ACTIVE' : 'MONSTER SIREN' }}</strong>
            </span>
        </div>

        <div v-if="!isAlbumRoute" class="page-body">
            <div v-if="albumsLoading" class="state-block" role="status">专辑列表加载中...</div>
            <div v-else-if="albumsError" class="state-block state-error" role="alert">
                <span>{{ albumsError }}</span>
                <button class="inline-button" type="button" @click="reloadPage">重试连接</button>
            </div>
            <div v-else-if="visibleAlbums.length === 0" class="state-block">没有匹配的专辑</div>
            <div v-else class="album-grid" aria-label="专辑目录">
                <button
                    v-for="(album, index) in visibleAlbums"
                    :key="album.id"
                    class="album-card"
                    type="button"
                    :style="{ '--album-order': index }"
                    :aria-label="`打开专辑 ${album.name}`"
                    @click="openAlbum(album.id)"
                >
                    <div class="album-cover">
                        <span class="album-index" aria-hidden="true">{{ String(index + 1).padStart(2, '0') }}</span>
                        <img v-lazy :src="album.coverUrl" :alt="album.name" />
                    </div>
                    <span class="album-meta">
                        <span class="album-name">{{ album.name }}</span>
                        <span class="album-artist">{{ album.artistNames || '塞壬唱片' }}</span>
                        <span class="album-open">OPEN / 打开 <span aria-hidden="true">↗</span></span>
                    </span>
                </button>
            </div>
        </div>

        <div v-else class="page-body">
            <div v-if="currentAlbumLoading && !currentAlbum" class="state-block" role="status">专辑详情加载中...</div>
            <div v-else-if="currentAlbumError && !currentAlbum" class="state-block state-error" role="alert">
                <span>{{ currentAlbumError }}</span>
                <button class="inline-button" type="button" @click="reloadPage">重试连接</button>
            </div>
            <template v-else-if="currentAlbum">
                <article class="album-detail">
                    <div class="album-detail-cover">
                        <img v-lazy :src="currentAlbum.coverUrl" :alt="currentAlbum.name" />
                        <span class="cover-caption">ALBUM / {{ currentAlbumId }}</span>
                    </div>
                    <div class="album-detail-info">
                        <span class="detail-kicker">MONSTER SIREN / AUDIO ARCHIVE</span>
                        <h2 class="detail-title">{{ currentAlbum.name }}</h2>
                        <div class="detail-meta">
                            <span>{{ currentAlbum.artistNames || '塞壬唱片' }}</span>
                            <span v-if="currentAlbum.belong">{{ currentAlbum.belong }}</span>
                            <span>{{ currentAlbum.songs.length }} 首曲目</span>
                        </div>
                        <p v-if="currentAlbum.intro" class="detail-intro">{{ currentAlbum.intro }}</p>
                    </div>
                </article>

                <section class="song-panel" aria-labelledby="track-list-title">
                    <header class="song-panel-header">
                        <div>
                            <span class="detail-kicker">TRACK MANIFEST</span>
                            <h2 id="track-list-title">曲目列表</h2>
                        </div>
                        <strong>{{ String(visibleSongs.length).padStart(2, '0') }}</strong>
                    </header>
                    <div v-if="visibleSongs.length === 0" class="state-block">没有匹配的曲目</div>
                    <LibrarySongList
                        v-else
                        :songlist="visibleSongs"
                        :queue-songlist="visibleSongs"
                        :queue-list-type="'siren'"
                        :queue-meta="{ id: currentAlbumId }"
                        :artist-route-enabled="false"
                        :context-menu-mode="'siren'"
                    ></LibrarySongList>
                </section>
            </template>
        </div>

        <BaseModal
            :show="playModeDialogShow"
            title="播放全部专辑"
            size="small"
            :loading="allAlbumsLoading"
            loading-text="正在载入全部专辑..."
            @close="playModeDialogShow = false"
        >
            <p class="play-mode-copy">随机播放会打乱全部曲目，下一首可能来自另一张专辑；顺序播放会播完当前专辑后进入下一张。</p>
            <div class="play-mode-options">
                <button class="play-mode-button primary" type="button" @click="playAllAlbums(true)">随机播放</button>
                <button class="play-mode-button" type="button" @click="playAllAlbums(false)">顺序播放</button>
            </div>
        </BaseModal>
    </section>
</template>

<style scoped lang="scss">
:global(#app:has(.siren-page) .home-content) {
    position: fixed;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    padding: 0;
}

.siren-page {
    --siren-ink: #191919;
    --siren-paper: #f2f2f0;
    --siren-panel: #e2e3df;
    --siren-control: #f8f8f5;
    --siren-signal: #fffa00;
    --siren-muted: rgba(25, 25, 25, 0.62);
    --siren-rule: rgba(25, 25, 25, 0.26);
    --siren-grid: rgba(25, 25, 25, 0.055);
    --siren-error: #a21f2a;

    position: relative;
    isolation: isolate;
    width: 100%;
    min-height: 100vh;
    margin: 0;
    padding: 104px 45px 140px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    color: var(--siren-ink);
    background: var(--siren-paper);
    text-align: left;
}

:global(html.dark .siren-page) {
    --siren-ink: #f4f6f6;
    --siren-paper: #080a0b;
    --siren-panel: #111619;
    --siren-control: #0d1113;
    --siren-signal: #18d1ff;
    --siren-muted: rgba(244, 246, 246, 0.62);
    --siren-rule: rgba(244, 246, 246, 0.2);
    --siren-grid: rgba(24, 209, 255, 0.075);
    --siren-error: #ff8d96;
}

.stage-grid,
.stage-mark {
    position: absolute;
    z-index: -1;
    pointer-events: none;
}

.stage-grid {
    inset: 0;
    background-image:
        linear-gradient(var(--siren-grid) 1px, transparent 1px),
        linear-gradient(90deg, var(--siren-grid) 1px, transparent 1px);
    background-size: 72px 72px;
    mask-image: linear-gradient(to bottom, black, transparent 78%);
}

.stage-mark {
    top: 0;
    right: -7%;
    width: 42%;
    height: 210px;
    opacity: 0.94;
    background: var(--siren-signal);
    clip-path: polygon(38% 0, 100% 0, 100% 100%, 0 100%);
}

:global(html.dark .siren-page .stage-mark) {
    top: -145px;
    right: -40px;
    width: 420px;
    height: 420px;
    border: 1px solid var(--siren-signal);
    border-radius: 50%;
    opacity: 0.22;
    background:
        linear-gradient(90deg, transparent 49.8%, var(--siren-signal) 50%, transparent 50.2%),
        linear-gradient(transparent 49.8%, var(--siren-signal) 50%, transparent 50.2%);
    clip-path: none;
}

.page-header {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 28px;
    align-items: end;
    padding-bottom: 22px;
    border-bottom: 1px solid var(--siren-ink);
    animation: siren-reveal 0.58s cubic-bezier(0.22, 0.8, 0.2, 1) both;
}

.page-title-group,
.title-instrument,
.page-actions {
    display: flex;
}

.page-title-group {
    min-width: 0;
    gap: 18px;
    align-items: flex-start;
}

.title-instrument {
    min-width: 0;
    gap: 18px;
    align-items: flex-end;
}

.section-index {
    font: 82px/0.74 Gilroy-ExtraBold;
    letter-spacing: -0.08em;
    color: transparent;
    -webkit-text-stroke: 1px var(--siren-ink);
}

:global(html.dark .siren-page .section-index) {
    width: 54px;
    height: 54px;
    display: inline-grid;
    place-items: center;
    flex: 0 0 54px;
    font: 24px/1 Bender-Bold;
    letter-spacing: 0;
    color: #080a0b;
    background: var(--siren-signal);
    -webkit-text-stroke: 0;
}

.page-title-block {
    min-width: 0;
}

.page-kicker,
.control-label,
.detail-kicker,
.cover-caption,
.album-open,
.status-cell small {
    font-family: Bender-Bold, Geometos, sans-serif;
    letter-spacing: 0.12em;
}

.page-kicker {
    display: block;
    margin-bottom: 5px;
    font-size: 11px;
}

.page-title {
    max-width: 720px;
    margin: 0;
    overflow: hidden;
    font: clamp(34px, 4.4vw, 62px) / 0.9 SourceHanSansCN-Heavy;
    letter-spacing: -0.045em;
    color: var(--siren-ink);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.page-subtitle {
    margin: 10px 0 0;
    font: 13px/1.4 SourceHanSansCN-Bold;
    color: var(--siren-muted);
}

.header-back,
.action-button,
.inline-button,
.album-card {
    border-radius: 0;
    outline: none;
}

.header-back,
.action-button,
.inline-button {
    min-height: 42px;
    border: 1px solid var(--siren-ink);
    color: var(--siren-ink) !important;
    background-color: transparent !important;
    font: 13px SourceHanSansCN-Bold;
    transition: transform 0.2s, color 0.2s, background-color 0.2s;
}

.header-back {
    padding: 0 14px;
    white-space: nowrap;
}

.page-actions {
    position: relative;
    z-index: 1;
    gap: 10px;
    align-items: end;
}

.search-control {
    display: grid;
    gap: 6px;
}

.control-label {
    font-size: 9px;
}

.page-search {
    width: clamp(180px, 18vw, 260px);
    min-height: 42px;
    padding: 0 12px;
    border: 1px solid var(--siren-ink) !important;
    border-radius: 0;
    outline: none;
    color: var(--siren-ink) !important;
    background-color: var(--siren-control) !important;
    font: 13px SourceHanSansCN-Bold;
}

.action-button {
    padding: 0 16px;
    white-space: nowrap;
}

.action-button.primary {
    position: relative;
    padding-left: 21px;
    color: var(--siren-paper) !important;
    background-color: var(--siren-ink) !important;
}

.action-button.primary::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 7px;
    background: var(--siren-signal);
}

.play-mode-copy {
    margin: 0;
    color: #555;
    font: 14px/1.7 SourceHanSansCN-Regular, sans-serif;
}

.play-mode-options {
    margin-top: 22px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
}

.play-mode-button {
    min-height: 44px;
    border: 1px solid #191919;
    border-radius: 0;
    color: #191919;
    background: transparent;
    font: 13px SourceHanSansCN-Bold;
    cursor: pointer;
}

.play-mode-button.primary,
.play-mode-button:hover {
    color: #fff;
    background: #191919;
}

:global(html.dark) .play-mode-copy {
    color: #c4c8ca;
}

:global(html.dark) .play-mode-button {
    border-color: #18d1ff;
    color: #f4f6f6;
}

:global(html.dark) .play-mode-button.primary,
:global(html.dark) .play-mode-button:hover {
    color: #080a0b;
    background: #18d1ff;
}

:global(html.dark .siren-page .action-button.primary) {
    color: #080a0b !important;
    background-color: var(--siren-signal) !important;
}

.header-back:hover,
.action-button:hover:not(:disabled),
.inline-button:hover {
    cursor: pointer;
    color: var(--siren-paper) !important;
    background-color: var(--siren-ink) !important;
    transform: translateY(-2px);
}

:global(html.dark .siren-page .header-back:hover),
:global(html.dark .siren-page .action-button:hover:not(:disabled)),
:global(html.dark .siren-page .inline-button:hover) {
    color: #080a0b !important;
    border-color: var(--siren-signal) !important;
    background-color: var(--siren-signal) !important;
}

.action-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.header-back:active,
.action-button:active:not(:disabled),
.inline-button:active {
    transform: translateY(0);
}

.header-back:focus-visible,
.action-button:focus-visible,
.inline-button:focus-visible,
.album-card:focus-visible,
.page-search:focus-visible {
    outline: 2px solid var(--siren-signal);
    outline-offset: 3px;
}

.album-card:focus-visible {
    outline-offset: -4px;
}

.page-status {
    min-height: 48px;
    margin: 14px 0 28px;
    display: flex;
    align-items: stretch;
    color: var(--siren-paper);
    background: var(--siren-ink);
    animation: siren-reveal 0.58s 0.07s cubic-bezier(0.22, 0.8, 0.2, 1) both;
}

:global(html.dark .siren-page .page-status) {
    color: var(--siren-ink);
    border: 1px solid var(--siren-rule);
    background: rgba(17, 22, 25, 0.82);
}

.status-signal {
    width: 10px;
    flex: 0 0 10px;
    background: var(--siren-signal);
}

.status-cell {
    min-width: 150px;
    padding: 8px 18px;
    display: grid;
    gap: 2px;
    border-right: 1px solid color-mix(in srgb, var(--siren-paper), transparent 74%);
}

:global(html.dark .siren-page .status-cell) {
    border-right-color: var(--siren-rule);
}

.status-cell small {
    font-size: 8px;
    opacity: 0.58;
}

.status-cell strong {
    font: 11px Bender-Bold;
    letter-spacing: 0.05em;
}

.page-body {
    position: relative;
    width: 100%;
    animation: siren-reveal 0.62s 0.13s cubic-bezier(0.22, 0.8, 0.2, 1) both;
}

.state-block {
    min-height: 220px;
    display: flex;
    flex-direction: column;
    gap: 14px;
    justify-content: center;
    align-items: center;
    border: 1px solid var(--siren-rule);
    color: var(--siren-muted);
    background: color-mix(in srgb, var(--siren-panel), transparent 26%);
    font: 14px SourceHanSansCN-Bold;
}

.state-error {
    color: var(--siren-error);
}

.inline-button {
    min-height: 38px;
    padding: 0 14px;
}

.album-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr));
    gap: clamp(14px, 1.5vw, 22px);
}

.album-card {
    position: relative;
    min-width: 0;
    padding: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--siren-ink);
    color: var(--siren-ink) !important;
    background-color: var(--siren-panel) !important;
    text-align: left;
    clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%);
    transition: transform 0.25s cubic-bezier(0.22, 0.8, 0.2, 1), box-shadow 0.25s, border-color 0.25s;
    animation: album-enter 0.48s both;
    animation-delay: calc(0.15s + min(var(--album-order), 8) * 0.035s);
}

.album-card::after {
    content: '';
    position: absolute;
    top: 0;
    right: 0;
    width: 18px;
    height: 18px;
    background: var(--siren-signal);
}

:global(html.dark .siren-page .album-card) {
    padding: 8px;
    border-color: var(--siren-rule) !important;
    background-color: rgba(8, 10, 11, 0.72) !important;
    clip-path: none;
}

:global(html.dark .siren-page .album-card::after) {
    inset: auto 8px 0 8px;
    width: auto;
    height: 2px;
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 0.25s;
}

.album-card:hover {
    cursor: pointer;
    z-index: 1;
    transform: translate(-3px, -3px);
    box-shadow: 7px 7px 0 var(--siren-ink);
}

:global(html.dark .siren-page .album-card:hover) {
    border-color: var(--siren-signal) !important;
    box-shadow: none;
}

:global(html.dark .siren-page .album-card:hover::after) {
    transform: scaleX(1);
}

.album-card:active {
    transform: translate(0, 0);
    box-shadow: none;
}

.album-cover {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    overflow: hidden;
    background: color-mix(in srgb, var(--siren-ink), transparent 92%);
}

.album-cover::after {
    content: '';
    position: absolute;
    inset: 0;
    border-bottom: 1px solid var(--siren-ink);
    background: linear-gradient(135deg, transparent 72%, color-mix(in srgb, var(--siren-signal), transparent 76%));
    pointer-events: none;
}

:global(html.dark .siren-page .album-cover::after) {
    border: 1px solid rgba(244, 246, 246, 0.08);
    background: linear-gradient(to top, rgba(8, 10, 11, 0.45), transparent 32%);
}

.album-cover img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    transition: transform 0.5s cubic-bezier(0.22, 0.8, 0.2, 1);
}

.album-card:hover .album-cover img {
    transform: scale(1.035);
}

.album-index {
    position: absolute;
    z-index: 2;
    top: 9px;
    left: 9px;
    min-width: 34px;
    padding: 5px 7px 4px;
    color: var(--siren-paper);
    background: var(--siren-ink);
    font: 12px Bender-Bold;
    letter-spacing: 0.08em;
}

:global(html.dark .siren-page .album-index) {
    color: #080a0b;
    background: var(--siren-signal);
}

.album-meta {
    min-height: 106px;
    padding: 13px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

:global(html.dark .siren-page .album-meta) {
    min-height: 102px;
    padding-inline: 4px;
}

.album-name {
    overflow: hidden;
    font: 15px/1.3 SourceHanSansCN-Bold;
    color: var(--siren-ink);
    text-overflow: ellipsis;
    white-space: nowrap;
}

.album-artist {
    overflow: hidden;
    color: var(--siren-muted);
    font: 11px/1.4 SourceHanSansCN-Bold;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.album-open {
    margin-top: auto;
    padding-top: 7px;
    display: flex;
    justify-content: space-between;
    border-top: 1px solid var(--siren-rule);
    color: var(--siren-muted);
    font-size: 9px;
}

.album-detail {
    margin-bottom: 30px;
    display: grid;
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    gap: clamp(24px, 4vw, 56px);
    align-items: stretch;
}

.album-detail-cover {
    position: relative;
    padding: 10px;
    border: 1px solid var(--siren-ink);
    background: var(--siren-panel);
}

:global(html.dark .siren-page .album-detail-cover) {
    border-color: var(--siren-rule);
}

.album-detail-cover img {
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
    display: block;
}

.cover-caption {
    padding: 9px 2px 0;
    display: block;
    overflow: hidden;
    color: var(--siren-muted);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.album-detail-info {
    min-width: 0;
    padding: clamp(18px, 3vw, 42px) 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 13px;
    border-block: 1px solid var(--siren-rule);
}

.detail-kicker {
    color: var(--siren-muted);
    font-size: 10px;
}

.detail-title {
    max-width: 850px;
    margin: 0;
    font: clamp(30px, 4.2vw, 58px) / 0.98 SourceHanSansCN-Heavy;
    letter-spacing: -0.035em;
    color: var(--siren-ink);
}

.detail-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.detail-meta span {
    padding: 6px 9px;
    border: 1px solid var(--siren-rule);
    color: var(--siren-muted);
    font: 11px SourceHanSansCN-Bold;
}

.detail-intro {
    max-width: 760px;
    margin: 3px 0 0;
    color: var(--siren-muted);
    font: 13px/1.75 SourceHanSansCN-Bold;
    white-space: pre-wrap;
}

.song-panel {
    border-top: 1px solid var(--siren-ink);
}

.song-panel-header {
    min-height: 70px;
    padding: 12px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--siren-rule);
}

.song-panel-header h2 {
    margin: 3px 0 0;
    font: 21px SourceHanSansCN-Heavy;
}

.song-panel-header > strong {
    color: var(--siren-muted);
    font: 42px/1 Gilroy-ExtraBold;
}

.song-panel :deep(.library-content) {
    height: min(48vh, 500px);
}

.song-panel :deep(.library-song-list .list-item) {
    border-bottom: 1px solid var(--siren-rule);
}

.song-panel :deep(.library-song-list .list-item:hover),
.song-panel :deep(.library-song-list .list-item-playing) {
    background-color: color-mix(in srgb, var(--siren-signal), transparent 88%) !important;
}

.song-panel :deep(.library-song-list .list-item-playing) {
    box-shadow: inset 3px 0 var(--siren-signal);
}

.song-panel :deep(.item-name),
.song-panel :deep(.item-other span),
.song-panel :deep(.item-play-btn) {
    color: var(--siren-ink) !important;
}

.song-panel :deep(.item-num) {
    color: var(--siren-muted) !important;
}

@keyframes siren-reveal {
    from {
        clip-path: inset(0 100% 0 0);
        transform: translateX(-10px);
    }
    to {
        clip-path: inset(0);
        transform: none;
    }
}

@keyframes album-enter {
    from {
        opacity: 0;
        transform: translateY(12px);
    }
    to {
        opacity: 1;
        transform: none;
    }
}

@media screen and (max-width: 1000px) {
    .page-header {
        grid-template-columns: 1fr;
        align-items: start;
    }

    .page-actions {
        width: 100%;
    }

    .search-control {
        flex: 1 1 240px;
    }

    .page-search {
        width: 100%;
    }
}

@media screen and (max-width: 760px), (orientation: portrait) and (max-width: 900px) {
    :global(#app:has(.siren-page) .globalWidget) {
        top: 17px;
        left: 20px;
    }

    :global(#app:has(.siren-page) .globalWidget .widget-search),
    :global(#app:has(.siren-page) .globalWidget .widget-visualizer) {
        display: none;
    }

    :global(#app:has(.siren-page) .home-header) {
        margin: 72px 20px 16px;
        justify-content: flex-start;
    }

    :global(#app:has(.siren-page) .home-header .header-router) {
        width: 100%;
        margin-left: 0 !important;
        padding-bottom: 8px;
        display: flex !important;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: none;
    }

    :global(#app:has(.siren-page) .home-header .header-router::-webkit-scrollbar) {
        display: none;
    }

    :global(#app:has(.siren-page) .home-header .header-router-right) {
        position: static !important;
        flex: 0 0 auto;
    }

    :global(#app:has(.siren-page) .home-header .primary-nav) {
        flex: 0 0 auto;
    }

    :global(#app:has(.siren-page) .home-header .primary-nav a),
    :global(#app:has(.siren-page) .home-header .header-router-right a) {
        margin-right: 26px !important;
    }

    :global(#app:has(.siren-page) .home-header .router-tracker) {
        display: none;
    }

    :global(#app:has(.siren-page) .home-content) {
        padding: 0;
    }

    .siren-page {
        width: 100%;
        min-height: 100vh;
        margin: 0;
        padding: 148px 20px 130px;
    }

    .stage-mark {
        width: 58%;
        height: 160px;
    }

    .page-title-group {
        flex-direction: column;
    }

    .title-instrument {
        align-items: center;
    }

    .section-index {
        font-size: 62px;
    }

    :global(html.dark .siren-page .section-index) {
        width: 46px;
        height: 46px;
        flex-basis: 46px;
        font-size: 20px;
    }

    .page-title {
        font-size: clamp(31px, 9vw, 48px);
    }

    .page-actions {
        display: grid;
        grid-template-columns: 1fr auto;
    }

    .search-control {
        grid-column: 1 / -1;
    }

    .page-status {
        display: grid;
        grid-template-columns: 8px repeat(3, minmax(0, 1fr));
    }

    .status-signal {
        width: 8px;
        grid-row: 1;
    }

    .status-cell {
        min-width: 0;
        padding-inline: 10px;
    }

    .status-cell strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .album-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .album-detail {
        grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
        gap: 22px;
    }
}

@media screen and (max-width: 520px) {
    .stage-mark {
        display: none;
    }

    .title-instrument {
        gap: 12px;
    }

    .page-actions {
        grid-template-columns: 1fr 1fr;
    }

    .page-status {
        grid-template-columns: 7px 1fr;
    }

    .status-signal {
        grid-row: 1 / 4;
    }

    .status-cell {
        border-right: 0;
        border-bottom: 1px solid color-mix(in srgb, var(--siren-paper), transparent 74%);
    }

    .status-cell:last-child {
        border-bottom: 0;
    }

    .album-grid,
    .album-detail {
        grid-template-columns: 1fr;
    }

    .album-detail-cover {
        width: min(100%, 320px);
    }
}

@media (prefers-reduced-motion: reduce) {
    .page-header,
    .page-status,
    .page-body,
    .album-card {
        animation: none;
    }

    .album-card,
    .album-cover img,
    .header-back,
    .action-button,
    .inline-button {
        transition: none;
    }
}
</style>
