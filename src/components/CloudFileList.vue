<script setup>
  import { computed, ref, watch } from 'vue'
  import { formatTime } from '../utils/time'
  import { dialogOpen, noticeOpen } from '../utils/dialog'
  import { deleteCloudSong } from '../api/cloud'
  import { addSong, setShuffledList } from '../utils/player'
  import { usePlayerStore } from '../store/playerStore'
  import { useLocalStore } from '../store/localStore'
  import { resolveImageUrl } from '../utils/imageUtils'

  const props = defineProps({
    items: {
      type: Array,
      default: () => [],
    },
    categoryKey: {
      type: [Number, String],
      default: 1,
    },
    categoryName: {
      type: String,
      default: '全部',
    },
  })

  const emit = defineEmits(['refresh'])

  const playerStore = usePlayerStore()
  const localStore = useLocalStore()

  const selectedSongIds = ref([])
  const isDeleting = ref(false)
  const visibleItems = computed(() => Array.isArray(props.items) ? props.items : [])
  const hasSelection = computed(() => selectedSongIds.value.length != 0)
  const emptyTitle = computed(() => `${props.categoryName || '当前分类'}暂无文件`)

  watch(() => props.categoryKey, () => {
    clearSelect()
  })

  watch(visibleItems, (items) => {
    const visibleSongIds = new Set(items.map(item => getSongId(item)).filter(Boolean))
    selectedSongIds.value = selectedSongIds.value.filter(id => visibleSongIds.has(id))
  }, { immediate: true })

  function getSongId(item) {
    // kv_id 是云盘文件的稳定标识，也是删除接口要求的 fileid。
    const songId = item?.kv_id || item?.simpleSong?.id || item?.album_audio_id || item?.hash || item?.id
    return songId === undefined || songId === null || songId === '' ? '' : String(songId)
  }

  function canSelectItem(item) {
    return !!getSongId(item)
  }

  function isSelected(item) {
    const songId = getSongId(item)
    return !!songId && selectedSongIds.value.includes(songId)
  }

  function getItemKey(item, index) {
    return String(getSongId(item) || item?.songId || item?.fileName || `cloud-${index}`)
  }

  function getItemCover(item) {
    const picUrl = item?.simpleSong?.al?.picUrl || item?.simpleSong?.album?.picUrl || ''
    return picUrl ? resolveImageUrl(picUrl) : ''
  }

  function getItemTitle(item) {
    return item?.songName || item?.simpleSong?.name || item?.fileName || '未知文件'
  }

  function getItemSecondaryName(item) {
    const fileName = String(item?.fileName || '').trim()
    const title = String(getItemTitle(item) || '').trim()
    if (!fileName || fileName == title) return ''
    return `(${fileName})`
  }

  function getItemFileSize(item) {
    const fileSize = Number(item?.fileSize || 0)
    return `${(fileSize / 1024 / 1024).toFixed(1)}MB`
  }

  function fileEdit(item) {
    const songId = getSongId(item)
    if (!songId) return

    const targetIndex = selectedSongIds.value.findIndex(id => id == songId)
    if (targetIndex == -1) {
      selectedSongIds.value.push(songId)
      return
    }

    selectedSongIds.value.splice(targetIndex, 1)
  }

  function clearSelect() {
    selectedSongIds.value = []
  }

  function getSelectedSongs() {
    return visibleItems.value
      .filter(item => selectedSongIds.value.includes(getSongId(item)))
      .map(item => ({
        ...(item?.simpleSong || {}),
        // 下载器优先依赖 hash，这里把云盘外层字段并回歌曲对象。
        hash: item?.simpleSong?.hash || item?.hash || '',
        album_audio_id: item?.simpleSong?.album_audio_id || item?.album_audio_id || '',
        id: item?.simpleSong?.id || getSongId(item),
      }))
      .filter(Boolean)
  }

  function downloadFile() {
    const selectedSongs = getSelectedSongs()
    if (selectedSongs.length == 0) return
    localStore.updateDownloadList(selectedSongs)
    clearSelect()
  }

  async function deleteFile(flag, selectedItems = visibleItems.value.filter(item => selectedSongIds.value.includes(getSongId(item)))) {
    if (!flag || isDeleting.value || selectedItems.length == 0) return

    if (selectedItems.some(item => !item?.kv_id)) {
      noticeOpen('部分文件缺少云盘 ID，请刷新后重试', 2)
      return
    }

    try {
      isDeleting.value = true
      await deleteCloudSong({
        fileid: selectedItems.map(item => item.kv_id).join(','),
        album_audio_id: selectedItems.map(item => item?.album_audio_id || 0).join(','),
      })
      const deletedSongIds = new Set(selectedItems.map(item => getSongId(item)))
      selectedSongIds.value = selectedSongIds.value.filter(id => !deletedSongIds.has(id))
      emit('refresh')
      noticeOpen(selectedItems.length > 1 ? `已删除 ${selectedItems.length} 首歌曲` : '删除成功', 2)
    } catch (error) {
      console.error('删除云盘歌曲失败:', error)
      noticeOpen(error?.message || '删除失败', 2)
    } finally {
      isDeleting.value = false
    }
  }

  function deleteFileConfirm() {
    if (!hasSelection.value || isDeleting.value) return
    dialogOpen('确认删除', `您确定要从云盘中删除选中的 ${selectedSongIds.value.length} 首歌曲吗？`, deleteFile)
  }

  function deleteSingleFileConfirm(item) {
    if (isDeleting.value) return
    if (!item?.kv_id) {
      noticeOpen('该文件缺少云盘 ID，请刷新后重试', 2)
      return
    }

    dialogOpen('确认删除', `您确定要从云盘中删除“${getItemTitle(item)}”吗？`, flag => deleteFile(flag, [item]))
  }

  function addTime(time) {
    if (!time) return '时间未知'
    return formatTime(time, 'YYYY-MM-DD HH:mm:ss')
  }

  function play(item) {
    const songId = getSongId(item)
    if (!songId) return

    const playableItems = visibleItems.value.filter(entry => canSelectItem(entry))
    const playIndex = playableItems.findIndex(entry => getSongId(entry) == songId)
    if (playIndex == -1) return

    playerStore.songList = playableItems
      .map(entry => ({
        ...(entry?.simpleSong || {}),
        // 统一补全云盘歌曲的关键字段，确保播放器能按酷狗 hash 取流。
        id: entry?.simpleSong?.id || getSongId(entry),
        hash: entry?.simpleSong?.hash || entry?.hash || '',
        album_audio_id: entry?.simpleSong?.album_audio_id || entry?.album_audio_id || '',
        source: 'cloud',
        type: 'cloud',
      }))
      .filter(Boolean)
    addSong(songId, playIndex, true, undefined, { userInitiated: true })
    if (playerStore.playMode == 3) setShuffledList()
  }
</script>

<template>
  <div class="file-container">
    <div class="file-list" :class="{ 'file-list-selected': hasSelection }">
      <template v-if="visibleItems.length">
        <div class="list-item" @dblclick="play(item)" v-for="(item, index) in visibleItems" :key="getItemKey(item, index)">
          <div class="item-info">
            <div class="item-img" :class="{ disabled: !canSelectItem(item) }" @click="fileEdit(item)">
              <img v-if="getItemCover(item)" v-lazy :src="getItemCover(item)" alt="">
              <div v-else class="item-img-empty">NO COVER</div>
            </div>
            <div class="info">
              <div class="item-name">{{ getItemTitle(item) }}
                <span class="item-name2" v-if="getItemSecondaryName(item)">&nbsp;{{ getItemSecondaryName(item) }}</span>
              </div>
              <div class="item-other">
                <span class="item-time">{{ addTime(item.addTime) }}</span>
                <span class="item-size">{{ getItemFileSize(item) }}</span>
              </div>
            </div>
          </div>
          <div v-if="canSelectItem(item)" class="item-actions">
            <button
              type="button"
              class="item-delete-button"
              :disabled="isDeleting || !item?.kv_id"
              :aria-label="`删除 ${getItemTitle(item)}`"
              :title="item?.kv_id ? `删除 ${getItemTitle(item)}` : '缺少云盘 ID，刷新后重试'"
              @dblclick.stop
              @click.stop="deleteSingleFileConfirm(item)"
            >
              <svg aria-hidden="true" viewBox="0 0 1024 1024">
                <path d="M224.56 320v576h553.55V320h-65.13v512h-423.3V320h-65.12zm162.81.66h65.12v448h-65.12v-448zm162.81 0h65.12v448h-65.12v-448zM387.37 192H192v64h618.67v-64H647.86v-64H387.37v64z"></path>
              </svg>
              <span>删除</span>
            </button>
            <div
              class="item-check"
              :class="{ 'item-check-selected': isSelected(item) }"
              title="选择歌曲"
              @click="fileEdit(item)"
            >
              <svg t="1671452723182" class="icon" viewBox="0 0 1498 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="1965" width="200" height="200"><path d="M618.396098 1024L0 403.605854l140.862439-141.861464 477.533659 479.531708L1357.674146 0 1498.536585 140.862439l-880.140487 883.137561z" p-id="1966" fill="#ffffff"></path></svg>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="file-empty">
        <span class="empty-title">{{ emptyTitle }}</span>
      </div>
    </div>
    <div class="file-edit" :class="{ 'file-edit-selected': hasSelection }">
      <div class="edit-item" @click="clearSelect()">
        <svg t="1669029682779" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="6239" width="200" height="200"><path d="M837.665426 907.48291 139.516188 907.48291c-12.852708 0-23.272495-10.419786-23.272495-23.272495L116.243694 186.062201c0-12.852708 10.419786-23.272495 23.272495-23.272495l442.156917 0c12.852708 0 23.272495 10.419786 23.272495 23.272495s-10.419786 23.272495-23.272495 23.272495L162.788683 209.334696l0 651.605273 651.605273 0L814.393955 442.043258c0-12.852708 10.419786-23.272495 23.272495-23.272495s23.272495 10.418762 23.272495 23.272495l0 442.168181C860.937921 897.064147 850.518134 907.48291 837.665426 907.48291z" p-id="6240"></path><path d="M395.758354 651.80904c-5.955334 0-11.911692-2.272161-16.456013-6.815458-9.087618-9.088642-9.087618-23.824407 0-32.91305l488.745937-488.745937c9.089666-9.088642 23.824407-9.088642 32.912026 0 9.088642 9.087618 9.088642 23.823383 0.001024 32.912026L412.214367 644.993582C407.670046 649.536879 401.714712 651.80904 395.758354 651.80904z" p-id="6241"></path></svg>
        <span class="item-name">全部取消</span>
      </div>
      <div class="edit-item" @click="downloadFile()">
        <svg t="1669030443895" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10347" width="200" height="200"><path d="M921.6 563.2c-9.6-9.6-25.6-9.6-35.2 0L544 896l0-822.4c0-12.8-9.6-22.4-25.6-22.4s-25.6 9.6-25.6 22.4L492.8 896l-342.4-339.2c-9.6-9.6-25.6-9.6-35.2 0-9.6 9.6-9.6 22.4 0 32l384 377.6c6.4 6.4 12.8 6.4 19.2 6.4 0 0 0 0 0 0 3.2 0 3.2 0 6.4 0 0 0 0 0 3.2 0 3.2 0 6.4-3.2 9.6-6.4l380.8-371.2C931.2 588.8 931.2 572.8 921.6 563.2z" p-id="10348"></path></svg>
        <span class="item-name">下载</span>
      </div>
      <div class="edit-item" @click="deleteFileConfirm()">
        <svg t="1669033713486" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="11464" width="200" height="200"><path d="M851.416 217.84l-45.256-45.248L512 466.744l-294.152-294.16-45.256 45.256L466.744 512l-294.152 294.16 45.248 45.256L512 557.256l294.16 294.16 45.256-45.256L557.256 512z" fill="#272536" p-id="11465"></path></svg>
        <span class="item-name">删除</span>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .file-container{
    height: 100%;
    display: flex;
    flex-direction: row;
    position: relative;
    .file-list{
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        overflow: auto;
        transition: 0.3s;
        &::-webkit-scrollbar{
            display: none;
        }
        .list-item{
            width: 100%;
            margin-bottom: 10Px;
            padding-bottom: 10Px;
            border-bottom: 1Px solid black;
            display: flex;
            flex-direction: row;
            justify-content: space-between;
            align-items: center;
            &:last-child{
                margin-bottom: 0;
                padding-bottom: 0;
                border-bottom: none;
            }
            .item-info{
                min-width: 0;
                flex: 1;
                display: flex;
                flex-direction: row;
                align-items: center;
                .item-img{
                    margin-right: 10PX;
                    width: 40Px;
                    height: 40Px;
                    border: 0.5Px solid rgba(0, 0, 0, 0.1);
                    overflow: hidden;
                    &.disabled{
                        cursor: default;
                    }
                    &:not(.disabled){
                        cursor: pointer;
                    }
                    img{
                        width: 100%;
                        height: 100%;
                    }
                    .item-img-empty{
                        width: 100%;
                        height: 100%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        background: rgba(0, 0, 0, 0.06);
                        font: 8Px Geometos;
                        color: rgba(0, 0, 0, 0.55);
                    }
                }
                .info{
                    width: calc(100% - 40Px - 10Px);
                    text-align: left;
                    .item-name{
                        font: 15Px SourceHanSansCN-Bold;
                        color: black;
                        overflow: hidden;
                        display: -webkit-box;
                        -webkit-box-orient: vertical;
                        -webkit-line-clamp: 1;
                        word-break: break-all;
                        .item-name2{
                            font: 12Px SourceHanSansCN-Bold;
                            color: rgb(110, 110, 110);
                        }
                    }
                    .item-other{
                        font: 10Px Geometos;
                        color: rgb(123, 123, 123);
                        .item-time{
                            margin-right: 10Px;
                        }
                    }
                }
            }
            .item-actions{
                margin-left: 12Px;
                display: flex;
                align-items: center;
                gap: 12Px;
                flex-shrink: 0;
            }
            .item-delete-button{
                min-width: 62Px;
                height: 34Px;
                padding: 0 9Px;
                border: 1Px solid var(--text);
                border-radius: 0;
                color: var(--text);
                background: transparent;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 5Px;
                font: 12Px SourceHanSansCN-Bold;
                line-height: 1;
                transition: opacity 0.2s, background-color 0.2s;
                svg{
                    width: 14Px;
                    height: 14Px;
                    fill: currentColor;
                    flex-shrink: 0;
                }
                &:hover:not(:disabled){
                    opacity: 0.55;
                }
                &:active:not(:disabled){
                    opacity: 1;
                    background-color: var(--layer);
                }
                &:focus-visible{
                    outline: 2Px solid var(--text);
                    outline-offset: 2Px;
                }
                &:disabled{
                    cursor: not-allowed;
                    opacity: 0.3;
                }
            }
            .item-check{
                width: 10Px;
                height: 10Px;
                border: 1Px solid black;
                position: relative;
                &:hover{
                    cursor: pointer;
                }
                svg{
                    width: 100%;
                    height: 100%;
                    position: absolute;
                    top: 0;
                    left: 0;
                    opacity: 0;
                }
            }
            .item-check-selected{
                background-color: black;
                svg{
                    opacity: 1;
                }
            }
        }
        .file-empty{
            width: 100%;
            height: 100%;
            min-height: 180Px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: black;
            .empty-title{
                font: 18Px SourceHanSansCN-Bold;
            }
        }
    }
    .file-list-selected{
        width: calc(100% - 110Px);
        transition: 0.3s;
    }
    .file-edit{
        padding-top: 10Px;
        position: absolute;
        right: -140Px;
        transition: 0.3s;
        .edit-item{
            margin-bottom: 15Px;
            display: flex;
            flex-direction: row;
            justify-content: start;
            align-items: center;
            transition: 0.2s;
            &:hover{
                cursor: pointer;
                opacity: 0.5;
            }
            .icon{
                margin-right: 8Px;
                width: 22Px;
                height: 22Px;
            }
            .item-name{
                font: 16Px SourceHanSansCN-Bold;
                color: black;
                white-space: nowrap;
            }
        }
    }
    .file-edit-selected{
        right: -10Px;
    }
    @media (prefers-reduced-motion: reduce){
        .file-list,
        .file-edit,
        .item-delete-button{
            transition: none;
        }
    }
  }
</style>
