<script setup>
  import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import Plyr from 'plyr'
  import '../assets/css/plyr.css'
  import { handleMusicVideoPlaybackError, musicVideoCheck } from '../utils/player';
  import { usePlayerStore } from '../store/playerStore';
  const playerStore = usePlayerStore()
  const videoInfo = playerStore.currentMusicVideo
  const isPoolVideo = videoInfo?.source === 'local-pool'
  const videoElementRef = ref(null)
  let player = null
  let stopPlayingWatch = null
  let playbackErrorHandled = false

  const getVideoMimeType = path => {
    const normalizedPath = String(path || '').split(/[?#]/)[0].toLowerCase()
    if (normalizedPath.endsWith('.webm')) return 'video/webm'
    if (normalizedPath.endsWith('.mov')) return 'video/quicktime'
    return 'video/mp4'
  }

  const playPoolVideo = () => {
    if (!isPoolVideo || !playerStore.playing || !player || document.hidden) return
    const playResult = player.play()
    if (playResult?.catch) playResult.catch(() => {})
  }

  const handleVisibilityChange = () => {
    if (!player) return
    if (document.hidden) {
      player.pause()
      return
    }
    if (!playerStore.playing) return
    if (isPoolVideo) playPoolVideo()
    else {
      const seek = playerStore.currentMusic?.seek?.()
      if (Number.isFinite(seek)) musicVideoCheck(seek, true)
    }
  }

  const handlePlaybackError = event => {
    console.error('视频播放错误:', event)
    if (playbackErrorHandled || !isPoolVideo) return
    playbackErrorHandled = true
    handleMusicVideoPlaybackError(videoInfo?.path)
  }

  onMounted(() => {
    console.log('PlayerVideo onMounted, currentMusicVideo:', playerStore.currentMusicVideo)

    const config = {
      autoplay: false,
      controls: []
    };
    player = new Plyr(videoElementRef.value, config)
    playerStore.musicVideoDOM = player

    let sources = []
    let videoPath = videoInfo?.path
    console.log('原始视频文件路径:', videoPath)

    // 处理本地文件路径，确保使用 file:// 协议
    if (videoPath && !videoPath.startsWith('http')) {
      videoPath = windowApi?.toFileUrl ? windowApi.toFileUrl(videoPath) : videoPath
    }

    console.log('处理后的视频文件路径:', videoPath)

    sources.push({
      src: videoPath,
      type: getVideoMimeType(videoPath),
    })

    player.source = {
      type: 'video',
      sources: sources,
    }

    // 添加视频事件监听
    player.on('ready', () => {
      console.log('视频播放器已准备就绪')
      playPoolVideo()
    })

    player.on('loadstart', () => {
      console.log('开始加载视频文件')
    })

    player.on('loadeddata', () => {
      console.log('视频数据已加载')
    })

    player.on('canplay', () => {
      console.log('视频可以开始播放')
      playPoolVideo()
    })

    player.on('error', handlePlaybackError)

    player.on('play', () => {
      console.log('视频开始播放')
      const seek = playerStore.currentMusic?.seek?.()
      if (Number.isFinite(seek)) musicVideoCheck(seek, true)
    })

    player.on('pause', () => {
      console.log('视频暂停播放')
    })

    // 检查视频元素
    const videoElement = player.media
    if (videoElement) {
      videoElement.muted = true
      videoElement.defaultMuted = true
      videoElement.loop = isPoolVideo
      console.log('视频元素信息:', {
        src: videoElement.src,
        readyState: videoElement.readyState,
        networkState: videoElement.networkState,
        error: videoElement.error
      })
      
      // 监听原生视频元素的错误事件
      videoElement.onerror = function(e) {
        console.error('错误详情:', {
          code: videoElement.error?.code,
          message: videoElement.error?.message
        })
        handlePlaybackError(e)
      }
    }

    stopPlayingWatch = watch(
      () => playerStore.playing,
      playing => {
        if (!isPoolVideo || !player) return
        if (playing) playPoolVideo()
        else player.pause()
      },
    )
    document.addEventListener('visibilitychange', handleVisibilityChange)
  })

  onBeforeUnmount(() => {
    stopPlayingWatch?.()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    if (playerStore.musicVideoDOM === player) playerStore.musicVideoDOM = null
    try {
      player?.destroy()
    } catch (_) {}
    player = null
  })
</script>

<template>
    <div class="back-video">
        <video
          ref="videoElementRef"
          class="video-player"
          playsinline
          muted
          aria-hidden="true"
          tabindex="-1"
        ></video>
    </div>
</template>

<style scoped lang="scss">
.back-video {
    width: 100%;
    height: 100%;
    background: black;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 0;
    pointer-events: none;
}

.video-player {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover; /* 确保视频填满容器 */
    background: black;
}

/* 覆盖 Plyr 的默认样式 */
:deep(.plyr) {
    width: 100% !important;
    height: 100% !important;
}

:deep(.plyr__video-wrapper) {
    width: 100% !important;
    height: 100% !important;
}

:deep(.plyr video) {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover !important;
}
</style>
