// 全局下载管理器初始化
import { useLocalStore } from '../store/localStore'
import { usePlayerStore } from '../store/playerStore'
import { storeToRefs } from 'pinia'
import { checkMusic, getLyric } from '../api/song'
import { getSirenLyricText, getSirenSong } from '../api/siren'
import { noticeOpen } from './dialog'
import { scanMusic } from './locaMusic'
import { getPreferredQuality } from './quality'
import { resolveTrackByQualityPreference } from './musicUrlResolver'
import { getSirenAudioExtension, getSirenSourceId, SIREN_SOURCE } from './siren'

let isInitialized = false

export const initDownloadManager = () => {
    if (isInitialized) return
    
    const localStore = useLocalStore()
    const playerStore = usePlayerStore()
    const { downloadList, isDownloading, isFirstDownload } = storeToRefs(localStore)
    const { quality } = storeToRefs(playerStore)
    
    let currentIndex = -1

    const getItemArtists = item => {
        const artists = Array.isArray(item?.ar) && item.ar.length ? item.ar : item?.artists
        if (Array.isArray(artists)) {
            return artists
                .map(artist => typeof artist === 'string' ? artist : artist?.name || artist?.author_name || '')
                .filter(Boolean)
        }
        return String(item?.artist || item?.artistName || item?.author_name || '')
            .split(/[、,/&]/)
            .map(name => name.trim())
            .filter(Boolean)
    }

    const getItemCoverUrl = item => {
        const coverUrl = item?.coverUrl
            || item?.al?.picUrl
            || item?.album?.picUrl
            || item?.picUrl
            || item?.blurPicUrl
            || item?.album_sizable_cover
            || item?.sizable_cover
            || item?.cover
            || item?.trans_param?.union_cover
            || null
        if (typeof coverUrl !== 'string') return coverUrl
        const resolvedCoverUrl = coverUrl.replace('{size}', '480')
        return resolvedCoverUrl.startsWith('//') ? `https:${resolvedCoverUrl}` : resolvedCoverUrl
    }

    const getItemAlbum = item => {
        if (typeof item?.album === 'string') return item.album
        return item?.al?.name || item?.album?.name || item?.album?.title || item?.album_name || null
    }

    const downloadSirenTrack = async item => {
        try {
            const sourceId = getSirenSourceId(item)
            if (!sourceId) throw new Error('缺少塞壬歌曲 ID')

            const songData = await getSirenSong(sourceId)
            const streamUrl = songData?.sourceUrl || item?.streamUrl || item?.sourceUrl || ''
            const lyricUrl = songData?.lyricUrl || item?.lyricUrl || ''

            if (!streamUrl) throw new Error('该歌曲无法下载')

            if (streamUrl) {
                item.streamUrl = streamUrl
                item.sourceUrl = streamUrl
            }
            if (lyricUrl) item.lyricUrl = lyricUrl

            let lyricPayload = null
            try {
                const lyricText = lyricUrl ? await getSirenLyricText(lyricUrl) : ''
                lyricPayload = {
                    id: sourceId,
                    lrc: lyricText || null,
                    tlyric: null,
                    romalrc: null,
                }
            } catch (_) {
                lyricPayload = null
            }

            const coverUrl = getItemCoverUrl(item)
            const artists = getItemArtists(item)
            const album = getItemAlbum(item)

            windowApi.download({
                url: streamUrl,
                name: item?.name,
                type: getSirenAudioExtension(streamUrl),
                id: item?.id || `siren:${sourceId}`,
                lyrics: lyricPayload,
                coverUrl,
                artists,
                album,
            })
        } catch (error) {
            console.error('塞壬歌曲下载失败:', error)
            noticeOpen("该歌曲无法下载！", 2)
            downloadList.value.splice(currentIndex, 1)
            downNext()
        }
    }
    
    const download = async () => {
        if (currentIndex < 0 || currentIndex >= downloadList.value.length) return

        const currentItem = downloadList.value[currentIndex] || {}
        if (currentItem.source === SIREN_SOURCE) {
            await downloadSirenTrack(currentItem)
            return
        }

        const id = currentItem.hash || currentItem.id
        checkMusic(id).then(async result => {
            if(result.success == true) {
                const preferredQuality = getPreferredQuality(quality.value)
                resolveTrackByQualityPreference(currentItem, preferredQuality).then(async trackInfo => {
                    if (!trackInfo || !trackInfo.url) {
                        noticeOpen("该歌曲无法下载！", 2)
                        downloadList.value.splice(currentIndex, 1)
                        downNext()
                        return
                    }
                    // 获取歌词（不阻塞音频下载；即使失败也继续）
                    let lyricPayload = null
                    try {
                        const lyr = await getLyric(currentItem)
                        lyricPayload = {
                            id,
                            lrc: lyr && lyr.lrc && lyr.lrc.lyric ? lyr.lrc.lyric : null,
                            tlyric: lyr && lyr.tlyric && lyr.tlyric.lyric ? lyr.tlyric.lyric : null,
                            romalrc: lyr && lyr.romalrc && lyr.romalrc.lyric ? lyr.romalrc.lyric : null,
                        }
                    } catch (_) {
                        // ignore lyric fetch errors
                    }
                    const item = currentItem
                    const coverUrl = getItemCoverUrl(item)
                    const artists = getItemArtists(item)
                    const album = getItemAlbum(item)

                    let fileObj = {
                        url: trackInfo.url,
                        name: item.name,
                        type: trackInfo.type,
                        id,
                        lyrics: lyricPayload,
                        coverUrl,
                        artists,
                        album
                    }
                    windowApi.download(fileObj)
                }).catch(error => {
                    console.error('获取下载地址失败:', error)
                    noticeOpen("该歌曲无法下载！", 2)
                    downloadList.value.splice(currentIndex, 1)
                    downNext()
                })
            } else {
                noticeOpen("该歌曲无法下载！", 2)
                downloadList.value.splice(currentIndex, 1)
                downNext()
            }
        })
    }

    const downNext = () => {
        if(downloadList.value.length != 0) {
            download()
        } else {
            isDownloading.value = false
            currentIndex = -1
            downloadList.value = []
            isFirstDownload.value = true
            noticeOpen("全部下载完毕", 2)
            
            // 下载完成后自动刷新下载目录
            setTimeout(() => {
                if (localStore.downloadedFolderSettings) {
                    noticeOpen("正在刷新下载目录...", 2)
                    // 延迟一点时间再扫描，确保用户能看到"全部下载完毕"的提示
                    setTimeout(() => {
                        scanMusic({type:'downloaded', refresh:true})
                    }, 500)
                }
            }, 1500) // 延迟1.5秒确保文件系统更新完成
        }
    }

    // 注册全局下载回调
    windowApi.downloadNext(() => {
        if(isDownloading.value && downloadList.value.length != 0) {
            downloadList.value.splice(currentIndex, 1)
            downNext()
        } else {
            if(downloadList.value.length != 0) {
                isDownloading.value = true
                currentIndex = 0
                download()
            }
        }
    })
    
    isInitialized = true
}
