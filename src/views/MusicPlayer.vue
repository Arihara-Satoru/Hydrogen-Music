<script setup>
import Player from '../components/Player.vue';
import Lyric from '../components/Lyric.vue';
import LyricSelector from '../components/LyricSelector.vue';
import ProgramIntro from '../components/ProgramIntro.vue';
import Comments from '../components/Comments.vue';
import MusicVideo from '../components/MusicVideo.vue';
import PlayerVideo from '../components/PlayerVideo.vue';
import { ref, watch, nextTick, computed } from 'vue';
import { usePlayerStore } from '../store/playerStore';
import { useListenTogetherStore } from '../store/listenTogetherStore';
import { getMusicCommentCount, getMusicComments } from '../api/song';
import { getDjProgramComments, getDjProgramCommentsNew } from '../api/dj';
import { resolveImageUrl } from '../utils/imageUtils';
const playerStore = usePlayerStore();

// 右侧内容切换状态 (0: 歌词, 1: 评论, 2: 歌词候选)
const rightPanelMode = ref(0);
const lyricKey = ref(0);

// 监听面板模式变化，当切换到歌词时刷新歌词组件
watch(rightPanelMode, (newMode, oldMode) => {
    if (newMode === 0 && oldMode !== 0) {
        // 从其它右侧面板切回歌词时，强制刷新歌词组件
        lyricKey.value++;
        
        // 确保 lyricShow 状态正确，具体定位交给歌词运行时和组件挂载流程处理
        nextTick(() => {
            playerStore.lyricShow = true;
        });
    }
});

// 当播放电台节目时，右侧显示电台简介而非歌词
const isDj = computed(() => playerStore.listInfo && playerStore.listInfo.type === 'dj');

const withCoverParam = (url) => resolveImageUrl(url || '')

const coverBgUrl = computed(() => {
    const list = playerStore.songList || [];
    const idx = typeof playerStore.currentIndex === 'number' ? playerStore.currentIndex : 0;
    const song = list[idx] || null;
    if (!song) return null;
    if (song.type === 'local') return playerStore.localBase64Img || null;
    let url = song.coverUrl || song.al?.picUrl || song.blurPicUrl || song.img1v1Url || null;
    if (!url && playerStore.listInfo?.type === 'together') {
        const togetherSong = useListenTogetherStore().playback?.song;
        url = togetherSong?.coverUrl || togetherSong?.al?.picUrl || null;
    }
    return withCoverParam(url, 512);
});

const showCoverBackdrop = computed(() => {
    return !!playerStore.coverBlur && !!coverBgUrl.value && !playerStore.videoIsPlaying;
});

// 当切到本地歌曲时，若右侧是评论区则自动切回歌词，避免无按钮无法关闭
const currentTrack = computed(() => {
    const list = playerStore.songList || [];
    const idx = typeof playerStore.currentIndex === 'number' ? playerStore.currentIndex : 0;
    return list[idx] || null;
});

const commentCount = ref(0);
const commentCountRequestSerial = ref(0);

const isNumericId = value => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0;
    if (typeof value === 'string') return /^\d+$/.test(value.trim());
    return false;
};

const commentTarget = computed(() => {
    const track = currentTrack.value;
    if (!track || track.type === 'local' || track.source === 'siren') return null;

    if (isDj.value) {
        const programId = track && (track.programId || track.programID || track.programid);
        if (!programId) return null;
        return {
            key: `dj:${programId}`,
            type: 'dj',
            id: programId,
        };
    }

    const musicId = (track && (track.mixsongid || track.mixsong_id || track.album_audio_id || track.MixSongID || track.id || track.songId || track.musicId)) || playerStore.songId;
    if (!musicId) return null;
    return {
        key: `song:${musicId}`,
        type: 'song',
        id: musicId,
        hash: track?.hash || track?.Hash || track?.FileHash || track?.file_hash || '',
        specialId: track?.special_child_id || track?.specialChildId || track?.special_id || track?.specialId || track?.scid || track?.Scid || '',
    };
});

const formatCommentCount = total => {
    const count = Number(total);
    if (!Number.isFinite(count) || count <= 0) return '0';
    if (count < 10000) return `${Math.floor(count)}`;
    return `${Math.floor(count / 10000)}w+`;
};

const commentCountBadge = computed(() => formatCommentCount(commentCount.value));

const fetchCommentCount = async target => {
    const serial = ++commentCountRequestSerial.value;

    if (!target) {
        commentCount.value = 0;
        return;
    }

    // 切换歌曲时立即清空旧评论数，避免请求等待期间残留上一首歌的数值
    commentCount.value = 0;

    try {
        let response = null;
        if (target.type === 'dj') {
            try {
                response = await getDjProgramCommentsNew({ id: target.id, pageSize: 1, pageNo: 1 });
            } catch (_) {
                response = await getDjProgramComments(target.id, { limit: 1, offset: 0 }).catch(() => null);
            }
        } else if (isNumericId(target.id)) {
            // 歌曲评论聚合总数：优先按 mixsongid 获取完整聚合评论数
            try {
                response = await getMusicComments({
                    id: target.id,
                    limit: 1,
                    offset: 0,
                    show_classify: 0,
                    show_hotword_list: 0,
                });
            } catch (_) {
                response = null;
            }

            // 若按 mixsongid 获取失败，尝试降级到 comment/count
            if ((!response || response.code !== 200) && (target.hash || target.specialId)) {
                try {
                    response = await getMusicCommentCount({
                        hash: target.hash,
                        special_child_id: target.specialId,
                    });
                } catch (_) {
                    response = null;
                }
            }
        } else if (target.hash || target.specialId) {
            try {
                response = await getMusicCommentCount({
                    hash: target.hash,
                    special_child_id: target.specialId,
                });
            } catch (_) {
                response = null;
            }
        }

        if (serial !== commentCountRequestSerial.value) return;

        if (response && response.code === 200) {
            const total = Number(response.total);
            commentCount.value = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
        } else {
            commentCount.value = 0;
        }
    } catch (_) {
        if (serial !== commentCountRequestSerial.value) return;
        commentCount.value = 0;
    }
};

const handleCommentTotalChange = payload => {
    const currentTarget = commentTarget.value;
    if (!currentTarget || !payload || payload.targetKey !== currentTarget.key) return;

    const total = Number(payload.total);
    commentCount.value = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
};

watch(
    () => (commentTarget.value ? commentTarget.value.key : ''),
    () => {
        fetchCommentCount(commentTarget.value);
    },
    { immediate: true }
);

const commentPanelKey = computed(() => {
    const track = currentTrack.value;
    const idx = typeof playerStore.currentIndex === 'number' ? playerStore.currentIndex : 0;
    if (isDj.value) {
        const pid = track && (track.programId || track.programID || track.programid);
        return `comments-dj-${pid || 'none'}-${idx}`;
    }
    const sid = (track && (track.mixsongid || track.mixsong_id || track.album_audio_id || track.MixSongID || track.id || track.songId || track.musicId)) || playerStore.songId || 'none';
    return `comments-song-${sid}-${idx}`;
});

watch([currentTrack, isDj], ([song, djMode]) => {
    try {
        if ((djMode || (song && (song.type === 'local' || song.source === 'siren'))) && rightPanelMode.value === 2) {
            rightPanelMode.value = 0;
            return;
        }
        if (song && (song.type === 'local' || song.source === 'siren') && rightPanelMode.value === 1) {
            rightPanelMode.value = 0;
        }
    } catch (_) {}
});
</script>

<template>
    <div class="music-player">
        <Transition name="fade3">
            <div
                v-if="showCoverBackdrop"
                :key="coverBgUrl"
                class="back-drop"
                :style="{ backgroundImage: coverBgUrl ? `url(${coverBgUrl})` : 'none' }"
            ></div>
        </Transition>
        <Player
            data-tour="player-cover"
            class="player-container"
            :class="{
                'player-hide': playerStore.videoIsPlaying && !playerStore.playerShow,
                'player-blur': playerStore.videoIsPlaying,
                'cover-blur': showCoverBackdrop,
            }"
            :comment-count-badge="commentCountBadge"
            v-model:rightPanelMode="rightPanelMode"
        ></Player>

        <!-- 右侧面板 -->
        <div class="right-panel" data-tour="player-lyrics" :class="{ 'panel-hide': playerStore.videoIsPlaying && !playerStore.playerShow }">
            <Transition name="panel-switch" mode="out-in" :duration="{ enter: 400, leave: 300 }">
                <div class="right-panel-content" :key="rightPanelMode">
                    <ProgramIntro v-if="rightPanelMode === 0 && isDj" key="program-intro" />
                    <Lyric class="lyric-container" v-else-if="rightPanelMode === 0" :key="`lyric-${lyricKey}`"></Lyric>
                    <Comments class="comments-container" v-else-if="rightPanelMode === 1" key="comments" @total-change="handleCommentTotalChange"></Comments>
                    <LyricSelector class="lyric-selector-container" v-else-if="rightPanelMode === 2" :key="`lyric-selector-${commentPanelKey}`"></LyricSelector>
                </div>
            </Transition>
        </div>

        <Transition name="fade">
            <MusicVideo
                class="music-video"
                v-if="playerStore.addMusicVideo && playerStore.musicVideoMode !== 'pool'"
            ></MusicVideo>
        </Transition>
        <Transition name="fade2">
            <PlayerVideo
                class="back-video"
                v-show="playerStore.videoIsPlaying"
                v-if="playerStore.currentMusicVideo && playerStore.musicVideo"
                :key="`${playerStore.currentMusicVideo.id}-${playerStore.currentMusicVideo.path}`"
            ></PlayerVideo>
        </Transition>
    </div>
</template>

<style scoped lang="scss">
@media screen and (max-aspect-ratio: 5/6) {
    .player-container {
        display: none;
    }
    .right-panel {
        width: 100% !important;
    }
}
.music-player {
    padding: 95px 45px 60px 45px;
    width: 100%;
    height: 100%;
    background: linear-gradient(rgba(176, 209, 217, 0.9) -20%, rgba(176, 209, 217, 0.4) 50%, rgba(176, 209, 217, 0.9) 120%);
    background-color: rgb(255, 255, 255);
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    transition: 0.2s;
    position: relative;
    overflow: hidden;

    .back-drop {
        position: absolute;
        top: 0;
        left: 0;
        z-index: 0;
        width: 120%;
        height: 120%;
        pointer-events: none;
        background-repeat: no-repeat;
        background-position: center;
        background-size: cover;
        filter: blur(50px) saturate(120%);
        transform: translate3d(-10%, -10%, 0);
        will-change: transform, opacity;
        contain: strict;
        transition: 0.3s;
    }

    .back-drop::before {
        content: '';
        display: block;
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: var(--cover-backdrop-overlay, rgba(255, 255, 255, 0.3));
    }

    .player-container {
        padding: 16px 12px;
        padding-bottom: 4vh;
        width: 0;
        height: 0;
        background-color: rgba(255, 255, 255, 0.35);
        opacity: 0;
        animation: player-in 0.7s 0.2s cubic-bezier(0.4, 0, 0.12, 1) forwards;
        position: relative;
        z-index: 1;
        // 工具栏和播放列表浮层位于播放器右侧，不能裁切外溢内容。
        contain: layout;
        will-change: width, height, opacity;
        @keyframes player-in {
            0% {
                height: 0;
                opacity: 0;
            }
            35% {
                width: 42vh;
                height: 0;
            }
            100% {
                width: 42vh;
                height: 100%;
                opacity: 1;
            }
        }
    }
    .player-hide {
        width: 42vh;
        height: 100%;
        animation: player-hide 0.4s cubic-bezier(0.3, 0.79, 0.55, 0.99) forwards;
        @keyframes player-hide {
            0% {
                opacity: 1;
            }
            100% {
                transform: scale(0.85);
                opacity: 0;
                visibility: hidden;
            }
        }
    }
    .player-blur {
        background-color: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(4px);
    }
    .cover-blur {
        background-color: rgba(255, 255, 255, 0.2);
        transform: translateZ(0);
    }
    .right-panel {
        margin-left: 50px;
        width: calc(100% - 42vh - 50px);
        height: 100%;
        transition: transform 0.6s cubic-bezier(0.3, 0.79, 0.55, 0.99), opacity 0.6s cubic-bezier(0.3, 0.79, 0.55, 0.99);
        position: relative;
        z-index: 1;
        // 四角装饰和音质信息伸出面板，不能在外壳裁切绘制内容。
        // 歌词滚动的裁切由内部 lyric-area 负责。
        contain: layout;
        will-change: transform, opacity;
        .right-panel-content,
        .lyric-container,
        .comments-container,
        .lyric-selector-container {
            width: 100%;
            height: 100%;
        }
    }
    .panel-hide {
        transform: scale(0.85);
        opacity: 0;
        visibility: hidden;
    }

    // 只让稳定外壳参与过渡，避免评论内容刷新打断 out-in 的离场回调
    .panel-switch-enter-active {
        transition: all 0.4s cubic-bezier(0.4, 0, 0.12, 1);
    }
    .panel-switch-leave-active {
        transition: all 0.3s cubic-bezier(0.3, 0.79, 0.55, 0.99);
    }
    .panel-switch-enter-from {
        opacity: 0;
        transform: translateX(30px) scale(0.95);
    }
    .panel-switch-leave-to {
        opacity: 0;
        transform: translateX(-30px) scale(0.95);
    }

    .music-video {
        position: absolute;
        z-index: 999;
    }
}
.back-video {
    width: 100%;
    height: 100%;
    background: black;
    position: fixed;
    top: 0;
    left: 0;
    z-index: 0;
    pointer-events: none;
    .video-player {
        width: 100%;
        height: 100%;
    }
}
.fade-enter-active,
.fade-leave-active {
    transition: 0.1s;
}
.fade-enter-from,
.fade-leave-to {
    transform: scale(0.95);
    opacity: 0;
}
.fade2-enter-active {
    transition: 1s;
}
.fade2-leave-active {
    transition: 0.4s;
}
.fade2-enter-from,
.fade2-leave-to {
    opacity: 0;
}

.fade3-enter-active,
.fade3-leave-active {
    transition: opacity 0.35s ease;
}
.fade3-enter-from,
.fade3-leave-to {
    opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
    .music-player .player-container {
        animation: none;
        width: 42vh;
        height: 100%;
        opacity: 1;
        transform: none;
    }
    .music-player .player-hide {
        opacity: 0;
        visibility: hidden;
    }
    .panel-switch-enter-active,
    .panel-switch-leave-active {
        transition-duration: 0.01ms;
    }

    .panel-switch-enter-from,
    .panel-switch-leave-to {
        transform: none;
    }
}

</style>
