<script setup>
  import { ref, watch, nextTick } from 'vue'
  import { preventPlaybackTextSelection } from '../utils/songTextInteraction.mjs'
  import { RecycleScroller } from 'vue-virtual-scroller'
  import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
  import { pauseMusic } from '../utils/player';
  import { addSong, findSongIndexById, setShuffledList } from '../utils/player'
  import { useRouter } from 'vue-router';
  import { usePlayerStore } from '../store/playerStore'
  import { storeToRefs } from 'pinia'
  import { getSongDisplayName } from '../utils/songName'
  const router = useRouter()
  const playerStore = usePlayerStore()
  const { playing, progress, playMode, currentMusic, currentIndex, listInfo, songList, shuffledList, shuffleIndex, songId, widgetState, playlistWidgetShow, lyricShow, showSongTranslation } = storeToRefs(playerStore)
  const playlistScroller = ref(null)

  const clearPlaylist = () => {
    playlistWidgetShow.value = false
    pauseMusic()
    const clearMusic = setTimeout(() => {
      songList.value = null
      listInfo.value = null
      songId.value = null
      shuffledList.value = null
      currentIndex.value = 0
      shuffleIndex.value = 0
      currentMusic.value?.unload?.()
      currentMusic.value = null
      progress.value = 0
      if(!widgetState.value) {
        widgetState.value = true;
        lyricShow.value = false
      }
      windowApi.setWindowTile('Hydrogen Music')
      clearTimeout(clearMusic)
    }, 200);
  }

  const checkArtist = (artistId) => {
    if(!artistId) return
    if(songList.value[currentIndex.value].type != 'local') {
      router.push('/mymusic/artist/' + artistId)
      playerStore.forbidLastRouter = true
      if(!widgetState.value) {widgetState.value = true;playlistWidgetShow.value = false;lyricShow.value = false}
    }
  }

  const play = (id, index) => {
    addSong(id, index, true, undefined, { userInitiated: true })
  }

  const delCurrentSong = async (index, id) => {
    if (!songList.value) return
    //·删除的是当前播放歌曲之前的
    if(index < currentIndex.value) {
      songList.value.splice(index, 1)
      currentIndex.value--
      if(playMode.value == 3) setShuffledList()
      return
    }
    //·删除的是当前播放歌曲之后的
    if(index > currentIndex.value) {
      songList.value.splice(index, 1)
      if(playMode.value == 3) setShuffledList()
      return
    }
    //·删除的是当前播放歌曲
    if(index == currentIndex.value) {
      let id = null
      let curIndex = null
      //·如果是最后一首
      if(index == songList.value.length - 1) {
        //且只有一首歌
        if(songList.value.length == 1) {clearPlaylist();return}
        //且不只有一首歌
        curIndex = index - 1
        id = songList.value[curIndex].id
        addSong(id, curIndex, playing.value)
        songList.value.splice(index, 1)
        if(playMode.value == 3) setShuffledList()
      } else {
      //·如果不是最后一首
        curIndex = currentIndex.value + 1
        id = songList.value[curIndex].id
        addSong(id, curIndex, playing.value)
        songList.value.splice(index, 1)
        currentIndex.value--
        if(playMode.value == 3) setShuffledList()
      }
    }
  }

  const locateCurrentSong = (smooth = true) => {
    const currentSong = songList.value?.[currentIndex.value]
    const targetIndex = findSongIndexById(songId.value, songList.value, currentSong)
    if(targetIndex < 0) return
    playlistScroller.value?.scrollToItem(targetIndex, { align: 'center', smooth })
  }

  // 展开面板时自动定位到当前播放歌曲（极速无动画对齐，不消耗展开时算力）
  watch(playlistWidgetShow, (show) => {
    if (show) {
      nextTick(() => {
        locateCurrentSong(false)
      })
    }
  })
</script>

<template>
    <div class="playlist-widget" :inert="!playlistWidgetShow" :aria-hidden="!playlistWidgetShow">
      <!-- 4 战术拐角标尺 (Arknights Frame Corner Ticks) -->
      <span class="frame-corner frame-tl" aria-hidden="true"></span>
      <span class="frame-corner frame-tr" aria-hidden="true"></span>
      <span class="frame-corner frame-bl" aria-hidden="true"></span>
      <span class="frame-corner frame-br" aria-hidden="true"></span>

      <!-- 顶栏区域 -->
      <div class="playlist-widget-header">
        <div class="playlist-widget-info">
          <span class="info-title">当前播放</span>
          <span class="info-sub">// QUEUE</span>
          <span class="info-badge">
            <span class="badge-bracket">[</span>
            <span class="badge-count">{{ songList?.length || 0 }}</span>
            <span class="badge-bracket">]</span>
          </span>
        </div>
        <div class="playlist-widget-actions">
          <!-- 定位按钮 (战术准心) -->
          <button
            type="button"
            class="playlist-btn locate-btn"
            @click="locateCurrentSong(true)"
            @keydown.enter.prevent="locateCurrentSong(true)"
            @keydown.space.prevent="locateCurrentSong(true)"
            v-delayed-tooltip="'定位当前歌曲'"
            aria-label="定位到当前歌曲"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.6" fill="none" />
              <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
              <line x1="12" y1="1" x2="12" y2="4" />
              <line x1="12" y1="20" x2="12" y2="23" />
              <line x1="1" y1="12" x2="4" y2="12" />
              <line x1="20" y1="12" x2="23" y2="12" />
            </svg>
          </button>

          <!-- 清空按钮 (战术清空) -->
          <button
            type="button"
            class="playlist-btn clear-btn"
            @click="clearPlaylist()"
            v-delayed-tooltip="'清空播放列表'"
            aria-label="清空播放列表"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M19 6l-1 14H6L5 6" />
              <path d="M10 11v5" />
              <path d="M14 11v5" />
            </svg>
          </button>
        </div>
      </div>

      <!-- 战术指示分割线 -->
      <div class="header-divider" aria-hidden="true">
        <span class="divider-mark">PRTS // 01</span>
      </div>

      <!-- 队列为空状态 -->
      <div v-if="!songList?.length" class="playlist-empty">
        <div class="empty-code">// QUEUE.EMPTY</div>
        <div class="empty-text">当前播放列表为空</div>
      </div>

      <!-- 虚拟歌曲列表 -->
      <RecycleScroller
        v-else
        ref="playlistScroller"
        class="playlist-widget-item"
        :items="songList"
        :item-size="36"
        key-field="id"
        v-slot="{ item, index }"
      >
        <div
          class="list-item"
          :class="{
            'list-item-playing': songId == item.id,
            'list-item-disabled': item.playable !== undefined && !item.playable
          }"
          @dblclick="play(item.id, index)"
          @mousedown="preventPlaybackTextSelection"
        >
          <!-- 正在播放时左侧实体战术指示条 -->
          <span class="active-indicator" aria-hidden="true"></span>
          <div class="item-info">
            <span v-if="songId != item.id" class="item-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <div class="playing-eq" v-show="(songId == item.id)" :class="{ 'is-paused': !playing }" aria-hidden="true">
              <span class="bar"></span>
              <span class="bar"></span>
              <span class="bar"></span>
              <span class="bar"></span>
            </div>
            <span class="item-name" :title="getSongDisplayName(item, '', showSongTranslation)">
              {{ getSongDisplayName(item, '', showSongTranslation) }}
            </span>
            <span class="item-separator">//</span>
            <span class="item-artists">
              <span
                class="item-author"
                @dblclick.stop
                @click="checkArtist(singer.id)"
                v-for="(singer, i) in item.ar"
                :key="singer.id ?? i"
              >
                {{ singer.name }}{{ i == item.ar.length - 1 ? '' : ' / ' }}
              </span>
            </span>
          </div>

          <button
            type="button"
            class="item-delete"
            @dblclick.stop
            @click.stop="delCurrentSong(index, item.id)"
            v-delayed-tooltip="'从队列移除'"
            aria-label="从列表移除"
          >
            <svg class="item-delete-svg" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
        </div>
      </RecycleScroller>
    </div>
</template>

<style scoped lang="scss">
  .playlist-widget {
    position: relative;
    width: 320Px;
    height: 460Px;
    max-width: calc(100vw - 32Px);
    max-height: calc(100vh - 180Px);
    background-color: var(--panel, var(--bg));
    backdrop-filter: blur(16Px);
    color: var(--text);
    border: 1Px solid var(--border);
    box-shadow: 0 12Px 32Px rgba(0, 0, 0, 0.16), 0 2Px 6Px rgba(0, 0, 0, 0.06);
    display: flex;
    flex-direction: column;
    overflow: hidden;

    // GPU 合成层加速：彻底解决 clip-path 逐帧重绘卡顿
    transform-origin: bottom right;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(10Px) scale(0.97);
    transition:
      opacity 0.14s cubic-bezier(0.4, 0, 1, 1),
      transform 0.14s cubic-bezier(0.4, 0, 1, 1),
      visibility 0.14s cubic-bezier(0.4, 0, 1, 1);
    will-change: transform, opacity;

    &.playlist-widget-open {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0) scale(1);
      transition:
        opacity 0.18s cubic-bezier(0.16, 1, 0.3, 1),
        transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
    }

    // 四角战术拐角标尺
    .frame-corner {
      position: absolute;
      width: 6Px;
      height: 6Px;
      pointer-events: none;
      z-index: 2;
      border-color: var(--text);
      opacity: 0.85;

      &.frame-tl {
        top: -1Px;
        left: -1Px;
        border-top: 2Px solid currentColor;
        border-left: 2Px solid currentColor;
      }
      &.frame-tr {
        top: -1Px;
        right: -1Px;
        border-top: 2Px solid currentColor;
        border-right: 2Px solid currentColor;
      }
      &.frame-bl {
        bottom: -1Px;
        left: -1Px;
        border-bottom: 2Px solid currentColor;
        border-left: 2Px solid currentColor;
      }
      &.frame-br {
        bottom: -1Px;
        right: -1Px;
        border-bottom: 2Px solid currentColor;
        border-right: 2Px solid currentColor;
      }
    }

    .playlist-widget-header {
      padding: 12Px 12Px 10Px 14Px;
      flex-shrink: 0;
      width: 100%;
      display: flex;
      flex-direction: row;
      justify-content: space-between;
      align-items: center;

      .playlist-widget-info {
        display: flex;
        align-items: baseline;
        gap: 6Px;

        .info-title {
          font: 15Px/1.4 SourceHanSansCN-Bold;
          color: var(--text);
          letter-spacing: 0.5Px;
        }
        .info-sub {
          font: 10Px/1.4 Bender-Bold, monospace;
          color: var(--muted-text);
          letter-spacing: 0.1em;
          opacity: 0.8;
        }
        .info-badge {
          display: inline-flex;
          align-items: baseline;
          font: 11Px/1.4 Bender-Bold, monospace;
          color: var(--text);
          margin-left: 2Px;
          .badge-bracket {
            color: var(--muted-text);
            font-size: 10Px;
          }
          .badge-count {
            padding: 0 2Px;
            font-variant-numeric: tabular-nums;
          }
        }
      }

      .playlist-widget-actions {
        display: flex;
        align-items: center;
        gap: 4Px;
        flex-shrink: 0;
      }

      .playlist-btn {
        width: 28Px;
        height: 28Px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: 1Px solid transparent;
        border-radius: 0;
        color: var(--muted-text);
        cursor: pointer;
        transition:
          color 0.12s ease,
          background-color 0.12s ease,
          border-color 0.12s ease,
          transform 0.12s ease;

        svg {
          display: block;
        }

        &:hover {
          color: var(--text);
          background-color: color-mix(in srgb, var(--text) 8%, transparent);
          border-color: color-mix(in srgb, var(--text) 18%, transparent);
        }

        &:active {
          transform: scale(0.92);
        }

        &:focus-visible {
          outline: 1Px solid var(--text);
          outline-offset: -1Px;
        }
      }
    }

    .header-divider {
      position: relative;
      width: calc(100% - 24Px);
      margin: 0 12Px 6Px;
      height: 1Px;
      background-color: var(--border);
      flex-shrink: 0;
      display: flex;
      justify-content: flex-end;

      .divider-mark {
        position: absolute;
        right: 0;
        top: -4Px;
        padding: 0 4Px;
        background-color: var(--panel, var(--bg));
        font: 8Px/1 Bender-Bold, monospace;
        letter-spacing: 0.12em;
        color: var(--muted-text);
        opacity: 0.7;
        pointer-events: none;
      }
    }

    .playlist-empty {
      flex: 1;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6Px;
      color: var(--muted-text);
      user-select: none;

      .empty-code {
        font: 11Px Bender-Bold, monospace;
        letter-spacing: 0.15em;
        opacity: 0.6;
      }

      .empty-text {
        font: 13Px SourceHanSansCN-Bold;
      }
    }

    .playlist-widget-item {
      width: 100%;
      flex: 1;
      min-height: 0;
      margin-bottom: 4Px;
      overflow-x: hidden;
      overflow-y: auto;

      &::-webkit-scrollbar {
        width: 4Px;
        background: transparent;
      }
      &::-webkit-scrollbar-thumb {
        background: transparent;
        border-radius: 0;
        transition: background 0.15s;
      }
      &::-webkit-scrollbar-track {
        background: transparent;
      }
      &:hover::-webkit-scrollbar-thumb {
        background: var(--border);
      }

      .list-item {
        position: relative;
        width: 100%;
        height: 36Px;
        padding: 0 10Px 0 12Px;
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        gap: 8Px;
        cursor: default;
        user-select: none;
        transition: background-color 0.1s ease;

        .active-indicator {
          position: absolute;
          left: 0;
          top: 0;
          bottom: 0;
          width: 3Px;
          background-color: transparent;
          transition: background-color 0.12s ease;
        }

        &:hover {
          background-color: color-mix(in srgb, var(--text) 6%, transparent);
        }

        .item-info {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          white-space: nowrap;
          overflow: hidden;
          gap: 6Px;

          .item-index {
            width: 20Px;
            flex-shrink: 0;
            font: 11Px/1.4 Bender-Bold, monospace;
            font-variant-numeric: tabular-nums;
            color: var(--muted-text);
            text-align: left;
          }

          .playing-eq {
            width: 20Px;
            height: 12Px;
            flex-shrink: 0;
            display: inline-flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 2Px;
            margin-right: 0;

            .bar {
              width: 2.5Px;
              border-radius: 0;
              background-color: var(--text);
            }
          }

          .item-name {
            font: 13Px/1.4 SourceHanSansCN-Bold;
            color: var(--text);
            min-width: 0;
            flex: 0 1 auto;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .item-separator {
            font: 10Px/1.4 Bender-Bold, monospace;
            color: var(--muted-text);
            opacity: 0.6;
            flex-shrink: 0;
          }

          .item-artists {
            flex: 0 2 auto;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
          }

          .item-author {
            font: 12Px/1.4 SourceHanSansCN-Bold;
            color: var(--muted-text);
            transition: color 0.15s ease;
            overflow: hidden;
            text-overflow: ellipsis;

            &:hover {
              cursor: pointer;
              color: var(--text);
              text-decoration: underline;
              text-underline-offset: 2Px;
            }
          }
        }

        .item-delete {
          width: 22Px;
          height: 22Px;
          padding: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          background: transparent;
          border: 1Px solid transparent;
          border-radius: 0;
          color: var(--muted-text);
          opacity: 0;
          cursor: pointer;
          transition:
            opacity 0.12s ease,
            color 0.12s ease,
            background-color 0.12s ease,
            border-color 0.12s ease;

          &:hover {
            color: var(--text);
            background-color: color-mix(in srgb, var(--text) 10%, transparent);
            border-color: color-mix(in srgb, var(--text) 20%, transparent);
          }

          &:focus-visible {
            opacity: 1;
            outline: 1Px solid var(--text);
            outline-offset: -1Px;
          }
        }

        &:hover .item-delete {
          opacity: 0.65;
          &:hover {
            opacity: 1;
          }
        }

        &.list-item-playing {
          background-color: color-mix(in srgb, var(--text) 8%, transparent);

          .active-indicator {
            background-color: var(--text);
          }

          .item-name {
            color: var(--text);
          }
        }

        &.list-item-disabled {
          opacity: 0.55;
          .item-info {
            .item-name, .item-author {
              color: var(--muted-text);
            }
          }
        }
      }
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .playlist-widget,
    .playlist-widget * {
      transition: none !important;
      transform: none !important;
    }
    .playlist-widget .playing-eq .bar {
      animation: none !important;
      transform: scaleY(0.6);
    }
  }
</style>
