<script setup>
  import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
  import { onBeforeRouteLeave, useRouter } from 'vue-router'
  import { useLibraryStore } from '../store/libraryStore'
  import { usePlayerStore } from '../store/playerStore';
  import { useOtherStore } from '../store/otherStore';
  import { resolveImageUrl } from '../utils/imageUtils'
  import { addSong, addToList, setShuffledList } from '../utils/player'
  import { noticeOpen } from '../utils/dialog'
  import { storeToRefs } from 'pinia'
  const libraryStore = useLibraryStore()
  const { libraryList, libraryInfo, listType1, listType2, lastLibraryRoute, restoreLibraryScrollOnActivate, purchaseLoadError } = storeToRefs(libraryStore)
  const playerStore = usePlayerStore()
  const otherStore = useOtherStore()
  const normalizeRouteName = routeName => {
    const normalized = String(routeName || '')
    if (!normalized) return ''
    return normalized.startsWith('~') ? normalized.slice(1) : normalized
  }
  const isRestorableLibraryRouteName = routeName => {
    const normalized = normalizeRouteName(routeName)
    return normalized == 'playlist' || normalized == 'album' || normalized == 'artist'
  }
  
  const listScroll = ref(null)
  const cubeViewport = ref(null)
  let cubeAnimation = null
  let cubeRun = 0

  function finishCube() {
    cubeRun++
    cubeAnimation?.cancel()
    cubeAnimation = null
    cubeViewport.value?.replaceChildren()
    libraryStore.playlistCubeBusy = false
  }

  // ponytail: temporary DOM snapshots reuse the existing row markup and handlers.
  // Only the visible viewport is painted; very large DOM lists should use virtualization.
  function snapshotFace(angle, depth) {
    const face = document.createElement('div')
    face.className = 'playlist-cube-face'
    face.style.transform = `rotateY(${angle}deg) translateZ(${depth}px)`
    const content = listScroll.value.cloneNode(true)
    content.removeAttribute('id')
    content.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'))
    content.style.cssText = 'height:100%;overflow:hidden;scrollbar-gutter:auto;'
    face.append(content)
    return { face, content, scroll: listScroll.value.scrollTop }
  }

  watch([listType1, listType2], async ([section, tab], [previousSection, previousTab]) => {
    if (section !== 0 || previousSection !== 0 || tab > 1 || previousTab > 1) {
      finishCube()
      return
    }
    if (tab === previousTab || !listScroll.value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    finishCube()
    const run = cubeRun
    const width = listScroll.value.clientWidth
    if (!width || !listScroll.value.clientHeight) return
    libraryStore.playlistCubeBusy = true
    const direction = tab > previousTab ? 1 : -1
    const depth = width / 2
    const outgoing = snapshotFace(0, depth)
    try {
      await nextTick()
      if (run !== cubeRun) return
      listScroll.value.scrollTop = 0
      const incoming = snapshotFace(direction * 90, depth)
      const cube = document.createElement('div')
      cube.className = 'playlist-cube'
      cube.style.width = `${width}px`
      cube.append(outgoing.face, incoming.face)
      cubeViewport.value.append(cube)
      outgoing.content.scrollTop = outgoing.scroll
      incoming.content.scrollTop = 0
      cubeAnimation = cube.animate([
        { transform: `translateZ(${-depth}px) rotateY(0deg)` },
        { transform: `translateZ(${-depth}px) rotateY(${-direction * 90}deg)` },
      ], { duration: 500, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' })
      await cubeAnimation.finished
    } catch (error) {
      if (error.name !== 'AbortError') console.error('歌单切换动画失败:', error)
    } finally {
      if (run === cubeRun) finishCube()
    }
  }, { flush: 'pre' })
  onDeactivated(finishCube)
  onBeforeUnmount(finishCube)

  const scrollTop = ref()
  const currentSelected = ref(null)
  const router = useRouter()
  const isPurchasedList = computed(() => listType1.value == 0 && listType2.value == 2)
  const isLibraryLoading = computed(() => libraryList.value === null)
  const hasEmptyLibraryList = computed(() => Array.isArray(libraryList.value) && libraryList.value.length == 0)
  const emptyLibraryText = computed(() => {
    if (isPurchasedList.value && purchaseLoadError.value) return '已购内容加载失败，请切换页面后重试'
    if (isPurchasedList.value) return '暂无已购单曲或专辑'
    if (listType1.value == 1 && listType2.value == 0) return '当前版本暂不支持读取收藏专辑'
    if (listType1.value == 1 && listType2.value == 1) return '暂无收藏歌手'
    if (listType1.value == 1 && listType2.value == 2) return '暂无收藏 MV'
    if (listType1.value == 1 && listType2.value == 3) return '暂无收藏电台'
    if (listType1.value == 0 && listType2.value == 0) return '暂无创建歌单'
    if (listType1.value == 0 && listType2.value == 1) return '暂无收藏歌单'
    return '暂无内容'
  })

  const playPurchasedSong = async item => {
    const songs = (Array.isArray(libraryList.value) ? libraryList.value : [])
      .filter(entry => entry?.purchaseKind == 'song')
    const index = songs.findIndex(song => String(song?.id) === String(item?.id))
    if (index < 0) return

    try {
      await addToList('purchased', songs, { id: 'purchased', name: '我购买的' })
      await addSong(item.id, index, true, undefined, { userInitiated: true })
      if (playerStore.playMode == 3) await setShuffledList()
    } catch (error) {
      console.error('播放已购单曲失败:', error)
      noticeOpen('播放已购单曲失败', 2)
    }
  }

  const showDetail = async (selectedId, item) => {
    if (isPurchasedList.value) {
      if (item?.purchaseKind == 'album') router.push('/mymusic/album/' + item.id)
      else await playPurchasedSong(item)
      currentSelected.value = selectedId
      return
    }
    if(listType1.value == 0) router.push('/mymusic/playlist/' + item.id)
    if(listType1.value == 1 && listType2.value == 0) router.push('/mymusic/album/' + item.id)
    if(listType1.value == 1 && listType2.value == 1) router.push('/mymusic/artist/' + item.id)
    if(listType1.value == 1 && listType2.value == 2) {
      otherStore.getMvData(item)
    }
    if(listType1.value == 1 && listType2.value == 3) {
      // 收藏-电台：优先使用 rid（API 使用 rid 作为电台ID）
      const djId = item?.rid || item?.id
      if (djId) router.push('/mymusic/dj/' + djId)
    }
    currentSelected.value = selectedId
  }

  const isSelectedItem = item => {
    if (isPurchasedList.value && item?.purchaseKind == 'song') {
      return String(playerStore.songId ?? '') === String(item?.id ?? '')
    }
    if (isPurchasedList.value && item?.purchaseKind == 'album') {
      return router.currentRoute.value.name == 'album'
        && String(router.currentRoute.value.params?.id ?? '') === String(item?.id ?? '')
    }
    return (item.id == router.currentRoute.value.fullPath.split('/')[3] && listType2.value != 2)
      || (otherStore.currentVideoId == item.vid && listType2.value == 2)
  }

  onActivated(() => {
    const isMyMusicRoot = router.currentRoute.value && router.currentRoute.value.name == 'mymusic'
    const lastRouteName = normalizeRouteName(lastLibraryRoute.value?.name)
    const shouldRestoreLibraryDetail = isMyMusicRoot && isRestorableLibraryRouteName(lastRouteName) && lastLibraryRoute.value && libraryInfo.value && !playerStore.forbidLastRouter
    if (shouldRestoreLibraryDetail) {
      restoreLibraryScrollOnActivate.value = true
      router.push(lastLibraryRoute.value.fullPath)
    } else {
      restoreLibraryScrollOnActivate.value = false
    }
    if(document.getElementById('libraryListScroll'))
      document.getElementById('libraryListScroll').scrollTop = scrollTop.value || 0
  })
  onBeforeRouteLeave((to, from) => {
    const fromRouteName = normalizeRouteName(from.name)
    if(isRestorableLibraryRouteName(fromRouteName)) {
      lastLibraryRoute.value = {
        name: fromRouteName,
        fullPath: from.fullPath
      }
    } else {
      lastLibraryRoute.value = null
    }
    if(!from.params.id && from.name != 'rec') {
      libraryInfo.value = null
    }

    if(document.getElementById('libraryListScroll'))
      scrollTop.value = document.getElementById('libraryListScroll').scrollTop
    playerStore.forbidLastRouter = false
  })
  const openMenu = (e, item) => {
    e.preventDefault()
    e.stopPropagation()
    if(listType1.value != 0 || listType2.value != 0) return
    otherStore.contextMenuShow = true
    otherStore.selectedItem = item
    otherStore.menuTree = otherStore.tree3
    
    const { clientX, clientY } = e
    const menuList = document.getElementById('menu')
    const screenWidth = document.body.clientWidth
    const screenHeight = document.body.clientHeight
    if(screenWidth - clientX < 120) {
      menuList.style.left = screenWidth - 120 + 'Px'
      menuList.style.right = null
    } else {
      menuList.style.right = null
      menuList.style.left = clientX + 'Px'
    }
    if(screenHeight - clientY < 240) {
      menuList.style.top = screenHeight - 200 + 'Px'
      menuList.style.bottom = null
    } else {
      menuList.style.bottom = null
      menuList.style.top = clientY + 'Px'
    }
  }

  const openCreatePlaylistDialog = () => {
    // 左侧“我创建的”顶部直接打开全局新建歌单弹窗，避免再绕右键菜单。
    otherStore.contextMenuShow = false
    otherStore.justNewPlaylist = true
    otherStore.addPlaylistShow = true
  }
</script>

<template>
  <div class="playlist-list-frame" :class="{ 'cube-active': libraryStore.playlistCubeBusy }">
  <div ref="listScroll" id="libraryListScroll" class="library-list" :inert="libraryStore.playlistCubeBusy">
    <div v-if="listType1 == 0 && listType2 == 0" class="create-playlist-entry" @click="openCreatePlaylistDialog()">
      <div class="create-icon">+</div>
      <span class="create-name">创建歌单</span>
    </div>
    <div
      class="list-item"
      :class="{'list-item-selected': isSelectedItem(item)}"
      v-for="(item, index) in libraryList"
      :key="`${item.purchaseKind || 'library'}-${item.id || index}`"
      role="button"
      tabindex="0"
      @click="showDetail(index, item)"
      @keydown.enter.prevent="showDetail(index, item)"
      @keydown.space.prevent="showDetail(index, item)"
      @contextmenu.prevent="openMenu($event,item)"
    >
        <div class="item-img">
            <img :src="resolveImageUrl(item.coverImgUrl || item.img1v1Url || item.picUrl || item.coverUrl)" alt="">
        </div>
        <div class="item-other">
            <span class="item-name">{{(item.name ?? item.title)}}</span>
            <div class="item-info" :class="{ 'purchased-item-info': isPurchasedList }">
              <template v-if="isPurchasedList">
                <span class="purchase-kind">{{ item.purchaseKind == 'album' ? '专辑' : '单曲' }}</span>
                <div class="item-artist" v-if="item.artists?.length">
                  <span class="artist" v-for="(artist, artistIndex) in item.artists" :key="`${artist.id || artist.name}-${artistIndex}`">{{ artist.name }}{{ artistIndex == item.artists.length - 1 ? '' : '/' }}</span>
                </div>
                <span class="item-size" v-if="item.purchaseKind == 'album' && item.trackCount">{{ item.trackCount }}首</span>
              </template>
              <div class="item-artist" v-show="(listType1 == 1 && listType2 == 0)">
                <span class="artist"  v-for="(artists, index) in item.artists">{{artists.name}}{{index == item.artists.length -1 ? '' : '/'}}</span>
              </div>
              <div class="item-artist" v-if="listType1 == 1 && listType2 == 2">
                <span class="artist"  v-for="(creator, index) in item.creator">{{creator.userName}}{{index == item.creator.length -1 ? '' : '/'}}</span>
              </div>
              <div class="item-artist" v-if="listType1 == 1 && listType2 == 3">
                <span class="artist">{{ item.dj?.nickname }}</span>
              </div>
              <span class="item-size" v-if="listType1 == 1 && listType2 == 3">{{ item.programCount || 0 }}期</span>
              <span class="item-size" v-if="!isPurchasedList && !(listType1 == 1 && listType2 == 1) && !(listType1 == 1 && listType2 == 2) && !(listType1 == 1 && listType2 == 3)">{{(item.trackCount ?? item.size)}}首</span>
            </div>
        </div>
    </div>
    <div v-if="isLibraryLoading" class="library-status" aria-live="polite">正在加载…</div>
    <div v-if="hasEmptyLibraryList" class="library-empty">{{ emptyLibraryText }}</div>
    <div v-if="isPurchasedList && purchaseLoadError && libraryList?.length" class="library-status library-warning">部分已购内容加载失败</div>
  </div>
  <div ref="cubeViewport" class="playlist-cube-viewport" aria-hidden="true" inert></div>
  </div>
</template>

<style scoped lang="scss">
  .playlist-list-frame {
    position: relative;
    min-height: 0;
    overflow: hidden;
  }
  .playlist-cube-viewport {
    position: absolute;
    inset: 0;
    perspective: 850px;
    perspective-origin: 50% 50%;
    pointer-events: none;
    visibility: hidden;
  }
  .cube-active {
    > .library-list > * { visibility: hidden; }
    .playlist-cube-viewport { visibility: visible; }
  }
  :deep(.playlist-cube) {
    position: absolute;
    height: 100%;
    transform-style: preserve-3d;
    will-change: transform;
  }
  :deep(.playlist-cube-face) {
    position: absolute;
    inset: 0;
    backface-visibility: hidden;
    overflow: hidden;
  }
  .library-list{
    height: 100%;
    overflow: auto;
    scrollbar-gutter: stable;
    > * { flex-shrink: 0; }
    display: flex;
    flex-direction: column;
    .create-playlist-entry{
      margin-bottom: 8Px;
      padding: 10Px 8Px;
      border: 1Px dashed rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: row;
      align-items: center;
      transition: 0.2s;
      &:hover{
        cursor: pointer;
        background-color: rgba(0, 0, 0, 0.04);
        border-color: rgba(0, 0, 0, 0.45);
      }
      .create-icon{
        margin-right: 10Px;
        width: 28Px;
        height: 28Px;
        border: 1Px solid rgba(0, 0, 0, 0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        font: 18Px Gilroy-ExtraBold;
        color: black;
      }
      .create-name{
        font: 14Px SourceHanSansCN-Bold;
        color: black;
      }
    }
    .list-item{
        padding: 8Px;
        display: flex;
        flex-direction: row;
        align-items: center;
        position: relative;
        &:focus-visible{
          outline: 2Px solid var(--text);
          outline-offset: -2Px;
        }
        &::after{
          content: '';
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.05);
          position: absolute;
          top: 0;
          left: 0;
          transform: translateX(-100%);
          will-change: transform, opacity;
          transition: transform 1s cubic-bezier(0.22, 0.61, 0.36, 1), opacity 1s ease;
          transition-delay: 0s;
          pointer-events: none;
        }
        &:hover{
          cursor: pointer;
          &::after{
            transition-delay: 0.2s;
            transform: translateX(0);
          }
        }
        .item-img{
          margin-right: 10Px;
          width: 50Px;
          height: 50Px;
          border: 0.5Px solid rgb(233, 233, 233);
          img{
              width: 100%;
              height: 100%;
          }
        }
        .item-other{
          width: calc(100% - 56Px);
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          .item-name{
            font: 15Px SourceHanSansCN-Bold;
            color: black;
            text-align: left;
            overflow: hidden;
            display: -webkit-box;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 1;
            word-break: break-all;
          }
          .item-info{
            font: 11Px SourceHanSansCN-Bold;
            color: rgb(107, 107, 107);
            display: flex;
            flex-direction: row;
            align-items: center;
            .item-artist{
              margin-right: 5Px;
              max-width: 100%;
              text-align: left;
              overflow: hidden;
              display: -webkit-box;
              -webkit-box-orient: vertical;
              -webkit-line-clamp: 1;
              word-break: break-all;
            }
            .purchase-kind{
              margin-right: 6Px;
              padding: 1Px 4Px;
              border: 1Px solid var(--border);
              color: var(--muted-text);
              white-space: nowrap;
            }
            &.purchased-item-info{
              color: var(--muted-text);
            }
            .item-size{
              white-space: nowrap;
            }
          }
        }
    }
    .list-item:last-child{
        margin-bottom: 15Px;
      }
    .list-item-selected{
      &::after{
        transform: translateX(0);
      }
    }
    .library-empty{
      padding: 16Px 8Px;
      font: 13Px SourceHanSansCN-Bold;
      color: rgb(105, 105, 105);
      text-align: left;
    }
    .library-status{
      padding: 16Px 8Px;
      font: 13Px SourceHanSansCN-Bold;
      color: var(--muted-text);
      text-align: left;
    }
    .library-warning{
      color: rgb(137, 91, 42);
    }
  }
</style>
