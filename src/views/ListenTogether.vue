<script setup>
import { computed, onActivated, onDeactivated, reactive, ref, watch } from 'vue'
import BaseButton from '../components/base/BaseButton.vue'
import BaseModal from '../components/base/BaseModal.vue'
import SkeletonBox from '../components/base/SkeletonBox.vue'
import Selector from '../components/Selector.vue'
import TogetherSongList from '../components/TogetherSongList.vue'
import { useListenTogetherStore } from '../store/listenTogetherStore'
import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'
import { ROOM_BIZ, togetherRequest } from '../api/listenTogether'
import { search } from '../api/other'
import { normalizeRoom, normalizeRoomSong, roomItems, roomAudio, loadDistinctRoomPages } from '../utils/listenTogetherData.mjs'
import { enterTogetherRoom, leaveTogetherRoom, refreshRoomDetails, loadMoreRoomSongs, roomAction, sendRoomMessage, setLocalListening, resetTogetherSession } from '../utils/listenTogetherSession'
import { copyToClipboard } from '../utils/clipboard'
import { dialogOpen, noticeOpen } from '../utils/dialog'
import { getCookie } from '../utils/authority'
import { resolveImageUrl } from '../utils/imageUtils'

const together = useListenTogetherStore(), player = usePlayerStore(), user = useUserStore()
const kind = ref('music'), source = ref('recommend'), rooms = ref([]), page = ref(1), loading = ref(false)
const roomId = ref(''), keyword = ref(''), songKeyword = ref(''), results = ref([]), searching = ref(false)
const channels = ref([])
const hasMoreRooms = ref(false), listFeedback = ref('')
const error = ref(''), feedback = ref(''), draft = ref(''), sending = ref(false), tab = ref('playlist')
const showCreate = ref(false), configuring = ref(false), olderLoading = ref(false), hasOlder = ref(true)
const copied = ref(false)
let copyResetTimer = null
const form = reactive({ room_name: '', room_notice: '', room_privacy: 2, capacity: 5, global_collection_id: '', allow_chat: 1, music_type: 1, white_noise_type: 1 })
const kindOptions = [{ label: '众乐房', value: 'music' }, { label: '自习室', value: 'study' }]
const sourceOptions = computed(() => [{ label: '推荐房间', value: 'recommend' }, { label: '最近访问', value: 'recent' },
    ...(kind.value === 'study' ? [{ label: '我创建的', value: 'created' }] : [])])
const selectedSongs = ref([])
const seedSongs = computed(() => (configuring.value ? together.songs : player.songList || []).filter(song => roomAudio(song)).slice(0, 50))
const pending = computed(() => together.busy || together.joining)
const roomTabs = computed(() => ({ playlist: '房间歌单', ...(together.room?.kind === 'music' ? { order: '点歌', requests: '点歌列表' } : {}), members: '房间成员', chat: '聊天' }))
let active = false, listVersion = 0, searchVersion = 0
const identity = () => String(getCookie('userid') || '')

async function run(fn) {
    const owner = identity()
    error.value = ''; feedback.value = ''
    try { return await fn() } catch (cause) { if (owner === identity()) error.value = cause?.message || '操作失败，请重试' }
}

async function loadRooms(append = false) {
    if (!active || together.room) return
    if (append && (loading.value || !hasMoreRooms.value)) return
    const version = ++listVersion, owner = identity(), requestedKind = kind.value
    loading.value = true; error.value = ''; listFeedback.value = ''
    if (!append) hasMoreRooms.value = false
    const isCurrent = () => active && version === listVersion && owner === identity() && !together.room
    const targetPage = append ? page.value + 1 : 1
    try {
        let domain = requestedKind, operation = 'list', data = { page: targetPage, pagesize: 20 }
        if (source.value === 'recent') { domain = 'discovery'; operation = 'recent_rooms' }
        else if (source.value === 'created') { domain = 'study'; operation = 'created_rooms' }
        else if (keyword.value.trim()) { domain = 'discovery'; operation = 'channel_search'; data.keyword = keyword.value.trim() }
        if (operation === 'list') {
            const result = await loadDistinctRoomPages({
                fetchPage: page => togetherRequest(domain, operation, { ...data, page }),
                previous: append ? rooms.value : [], startPage: targetPage, kind: requestedKind, isCurrent,
            })
            if (!result || !isCurrent()) return
            rooms.value = result.rooms
            channels.value = []
            page.value = result.page
            hasMoreRooms.value = result.hasMore
            if (append && !result.added) listFeedback.value = '暂时没有更多新房间，可以稍后刷新。'
            else if (!result.hasMore && result.rooms.length) listFeedback.value = '已显示当前可获取的房间。'
            return
        }
        const result = await togetherRequest(domain, operation, data)
        if (!isCurrent()) return
        const rawItems = roomItems(result, ['rooms', 'room_list', 'list', 'info', 'channel_list'])
        channels.value = operation === 'channel_search' ? rawItems.filter(item => item.global_collection_id).map(item => ({
            id: String(item.global_collection_id), name: String(item.name || '音乐频道').replace(/<[^>]*>/g, ''), cover: item.channel_cover || item.pic || '',
        })) : []
        const found = rawItems.map(item => normalizeRoom(item, requestedKind))
            .filter(room => room.id && room.kind === requestedKind)
        rooms.value = [...new Map([...(append ? rooms.value : []), ...found].map(room => [room.id, room])).values()]
        page.value = targetPage
    } catch (cause) { if (active && version === listVersion && owner === identity()) error.value = cause.message }
    finally { if (version === listVersion) loading.value = false }
}

async function recoverRoom() {
    await run(async () => {
        const owner = identity()
        const result = await togetherRequest('room', 'status', { biz: ROOM_BIZ[kind.value] })
        if (owner !== identity() || !active) return
        const room = normalizeRoom(result.group || result.room || result, kind.value)
        if (!room.id) { feedback.value = '当前账号没有正在加入的房间'; return }
        await join(room)
    })
}

function deleteStudy(room) {
    dialogOpen('删除自习室', `确定删除“${room.name}”吗？`, confirmed => {
        if (confirmed) void run(async () => {
            await togetherRequest('study', 'delete_created_room', { room_id: room.id, global_collection_id: room.global_collection_id || '' })
            await loadRooms()
        })
    })
}

function openCreate(edit = false) {
    configuring.value = edit
    Object.assign(form, { room_name: edit ? together.room.name : `${user.user?.nickname || '我'}的音乐室`,
        room_notice: edit ? together.room.notice : '', room_privacy: 2, capacity: 5,
        global_collection_id: edit ? together.room.global_collection_id || '' : '', allow_chat: together.chatEnabled ? 1 : 0,
        music_type: edit ? Number(together.room.music_type || 1) : 1, white_noise_type: edit ? Number(together.room.white_noise_type || 1) : 1 })
    selectedSongs.value = seedSongs.value.map(song => song.hash)
    showCreate.value = true
}

async function createRoom() {
    await run(async () => {
        if (!form.room_name.trim()) throw new Error('请输入房间名称')
        const audios = seedSongs.value.filter(song => selectedSongs.value.includes(song.hash)).map(roomAudio).filter(Boolean)
        if (kind.value === 'music' && form.room_privacy === 1 && !form.global_collection_id.trim()) throw new Error('公开众乐房需要填写频道 ID')
        const data = { ...form, room_name: form.room_name.trim(), audios, room_privacy: kind.value === 'study' ? 3 : form.room_privacy,
            ...(configuring.value ? { room_tag: together.room.room_tag, music_style: together.room.music_style } : {}) }
        if (configuring.value) await roomAction('study', 'configure', { ...data, type: 2 })
        else await enterTogetherRoom(null, kind.value, data)
        showCreate.value = false
    })
}

async function join(room = roomId.value) {
    await run(() => enterTogetherRoom(room, kind.value))
}

function leave(dismiss = false) {
    dialogOpen(dismiss ? '解散房间' : '离开一起听', dismiss ? '房间内所有人将结束本次一起听，确定解散吗？' : '离开后恢复你原来的播放队列，保持暂停。', confirmed => {
        if (confirmed) void run(async () => { await leaveTogetherRoom(dismiss); await loadRooms() })
    })
}

async function findSongs() {
    if (!songKeyword.value.trim() || searching.value) return
    const version = ++searchVersion, owner = identity(), id = together.room?.id
    searching.value = true
    await run(async () => {
        const result = await search({ keywords: songKeyword.value.trim(), type: 1, limit: 30 })
        if (!active || version !== searchVersion || owner !== identity() || id !== together.room?.id) return
        results.value = roomItems(result.result || result, ['songs', 'list']).map(normalizeRoomSong).filter(Boolean)
    })
    if (version === searchVersion) searching.value = false
}

async function order(song) {
    await run(async () => { await roomAction('music', 'order_song', roomAudio(song)); feedback.value = '点歌已提交' })
}

async function send() {
    if (!draft.value.trim() || sending.value) return
    sending.value = true
    const text = draft.value, id = together.room?.id
    await run(async () => {
        await sendRoomMessage(text)
        if (id === together.room?.id && draft.value === text) draft.value = ''
        feedback.value = '消息已发送'
    })
    sending.value = false
}

async function loadOlder() {
    const room = together.room
    if (!room || olderLoading.value) return
    olderLoading.value = true
    const owner = identity(), cursor = together.messages[0]?.id || '0'
    await run(async () => {
        const data = await togetherRequest('chat', 'history', { room_id: room.id, groupid: room.groupId, biz: room.biz, maxid: cursor, pagesize: 30 })
        if (owner !== identity() || together.room?.id !== room.id) return
        const { normalizeRoomMessage, mergeRoomMessages } = await import('../utils/listenTogetherData.mjs')
        const messages = roomItems(data, ['messages', 'msg_list', 'msglist', 'list', 'info']).map(normalizeRoomMessage).filter(Boolean)
        hasOlder.value = messages.length >= 30 && messages.some(message => !together.messages.some(old => old.id === message.id))
        together.messages = mergeRoomMessages(messages, together.messages)
    })
    olderLoading.value = false
}

async function copyRoomNumber() {
    const id = together.room?.id
    if (!id) return
    const success = await copyToClipboard(id)
    if (!success) {
        noticeOpen('复制失败', 2)
        return
    }
    copied.value = true
    feedback.value = '房间号已复制'
    noticeOpen('房间号已复制', 2)
    clearTimeout(copyResetTimer)
    copyResetTimer = setTimeout(() => {
        copied.value = false
    }, 1500)
}

watch([kind, source], () => { rooms.value = []; channels.value = []; void loadRooms() })
watch(kind, () => { if (kind.value !== 'study' && source.value === 'created') source.value = 'recommend' })
watch(() => together.room?.id, () => { results.value = []; draft.value = ''; tab.value = 'playlist'; hasOlder.value = true; error.value = '' })
watch(() => user.user?.userId, () => { listVersion++; searchVersion++; rooms.value = []; channels.value = []; hasMoreRooms.value = false; listFeedback.value = ''; results.value = []; draft.value = ''; error.value = ''; feedback.value = ''; loading.value = false; searching.value = false; showCreate.value = false; if (active && user.user) void loadRooms() })
onActivated(() => { active = true; void loadRooms() })
onDeactivated(() => { active = false; listVersion++; searchVersion++; loading.value = false; searching.value = false; showCreate.value = false; clearTimeout(copyResetTimer) })
</script>

<template>
    <div class="together-page">
        <header class="page-heading">
            <div>
                <p class="eyebrow">LISTEN TOGETHER</p>
                <h1>{{ together.room?.name || '一起听' }}</h1>
                <p class="muted">{{ together.room ? `${together.room.kind === 'music' ? '众乐房' : '自习室'} · ${together.connection}` : '把喜欢的音乐，分享给此刻在线的人。' }}</p>
            </div>
            <div v-if="together.room" class="actions">
                <BaseButton variant="secondary" size="small" @click="copyRoomNumber">复制房间号</BaseButton>
                <BaseButton variant="secondary" size="small" :disabled="pending" @click="leave()">离开房间</BaseButton>
            </div>
            <div v-else class="actions">
                <BaseButton variant="secondary" :disabled="pending" @click="recoverRoom">恢复房间</BaseButton>
                <BaseButton :disabled="pending" @click="openCreate()">创建房间</BaseButton>
            </div>
        </header>

        <p v-if="error || together.error" role="alert" class="message error">{{ error || together.error }}</p>
        <BaseButton v-if="together.room && (error || together.error)" class="disconnect" variant="secondary" size="small" @click="resetTogetherSession(); feedback = '已断开本地连接，服务端将在心跳超时后离房'">断开本地连接</BaseButton>
        <p v-if="feedback" role="status" class="message">{{ feedback }}</p>

        <!-- 房间大厅模式 -->
        <template v-if="!together.room">
            <!-- 醒目的主模式切换标签：众乐房 / 自习室 -->
            <nav class="lobby-mode-tabs" aria-label="房间类型">
                <button
                    v-for="opt in kindOptions"
                    :key="opt.value"
                    type="button"
                    class="lobby-tab-btn"
                    :class="{ active: kind === opt.value }"
                    :aria-pressed="kind === opt.value"
                    @click="kind = opt.value"
                >
                    {{ opt.label }}
                </button>
            </nav>

            <section class="join-panel panel">
                <div class="card-frame" aria-hidden="true">
                    <div class="frame-corner frame-tl"></div>
                    <div class="frame-corner frame-tr"></div>
                    <div class="frame-corner frame-bl"></div>
                    <div class="frame-corner frame-br"></div>
                </div>
                <form class="inline-form" @submit.prevent="join()">
                    <label class="sr-only" for="room-number">房间号</label>
                    <input
                        id="room-number"
                        v-model="roomId"
                        :placeholder="kind === 'music' ? '输入众乐房房间号，与朋友一起听' : '输入自习室房间号，进入自习室'"
                        maxlength="80"
                        spellcheck="false"
                    />
                    <BaseButton type="submit" :loading="together.joining" :disabled="!roomId.trim()">加入房间</BaseButton>
                </form>
            </section>

            <section class="panel discovery">
                <div class="card-frame" aria-hidden="true">
                    <div class="frame-corner frame-tl"></div>
                    <div class="frame-corner frame-tr"></div>
                    <div class="frame-corner frame-bl"></div>
                    <div class="frame-corner frame-br"></div>
                </div>
                <div class="section-heading">
                    <div class="heading-left">
                        <div class="source-tabs" role="tablist">
                            <button
                                v-for="opt in sourceOptions"
                                :key="opt.value"
                                type="button"
                                class="source-tab"
                                :class="{ active: source === opt.value }"
                                :aria-pressed="source === opt.value"
                                @click="source = opt.value"
                            >
                                {{ opt.label }}
                            </button>
                        </div>
                    </div>
                    <form class="actions" @submit.prevent="loadRooms()">
                        <div v-if="source === 'recommend'" class="search-box">
                            <input v-model="keyword" placeholder="搜索频道，创建公开房间" spellcheck="false" />
                        </div>
                        <BaseButton type="submit" variant="secondary" size="small" :disabled="loading">{{ keyword ? '搜索' : '刷新' }}</BaseButton>
                    </form>
                </div>

                <div v-if="channels.length" class="room-grid">
                    <article v-for="channel in channels" :key="channel.id" class="room-card">
                        <div class="card-frame" aria-hidden="true">
                            <div class="frame-corner frame-tl"></div>
                            <div class="frame-corner frame-tr"></div>
                            <div class="frame-corner frame-bl"></div>
                            <div class="frame-corner frame-br"></div>
                        </div>
                        <img v-if="channel.cover" :src="resolveImageUrl(channel.cover)" alt="" />
                        <div>
                            <h2>{{ channel.name }}</h2>
                            <p class="muted">频道 {{ channel.id }}</p>
                        </div>
                        <BaseButton variant="secondary" size="small" :disabled="pending" @click="openCreate(); form.global_collection_id = channel.id; form.room_privacy = 1">在此创建</BaseButton>
                    </article>
                </div>

                <div v-if="loading && !rooms.length" class="room-grid">
                    <SkeletonBox v-for="n in 6" :key="n" height="110px" />
                </div>

                <p v-else-if="!rooms.length && !channels.length" class="empty">
                    {{ error ? '房间列表暂不可用，可以重试或输入房间号加入。' : '暂无可加入的房间，试试创建一个自己的音乐室。' }}
                </p>

                <div v-else class="room-grid">
                    <article v-for="room in rooms" :key="room.id" class="room-card">
                        <div class="card-frame" aria-hidden="true">
                            <div class="frame-corner frame-tl"></div>
                            <div class="frame-corner frame-tr"></div>
                            <div class="frame-corner frame-bl"></div>
                            <div class="frame-corner frame-br"></div>
                        </div>
                        <img v-if="room.cover" :src="resolveImageUrl(room.cover)" alt="" loading="lazy" />
                        <div class="card-content">
                            <h2 :title="room.name">{{ room.name }}</h2>
                            <p class="muted">{{ room.count }} 人在线 · {{ room.id }}</p>
                            <p v-if="room.notice" class="room-notice" :title="room.notice">{{ room.notice }}</p>
                        </div>
                        <div class="card-actions">
                            <BaseButton variant="secondary" size="small" :disabled="pending" @click="join(room)">进入</BaseButton>
                            <BaseButton v-if="source === 'created'" variant="secondary" size="small" :disabled="pending" @click="deleteStudy(room)">删除</BaseButton>
                        </div>
                    </article>
                </div>

                <button
                    v-if="hasMoreRooms && source === 'recommend'"
                    class="floor-more-btn"
                    :disabled="loading"
                    @click="loadRooms(true)"
                >
                    {{ loading ? '加载中...' : '加载更多房间' }}
                </button>
                <p v-if="listFeedback" class="list-feedback muted" role="status">{{ listFeedback }}</p>
            </section>
        </template>

        <!-- 房间内部模式：横向顶部现在播放卡片 + 下方完整内容面板 -->
        <template v-else>
            <div class="room-layout">
                <!-- 顶部正在播放横向卡片 -->
                <section class="panel room-summary">
                    <div class="card-frame" aria-hidden="true">
                        <div class="frame-corner frame-tl"></div>
                        <div class="frame-corner frame-tr"></div>
                        <div class="frame-corner frame-bl"></div>
                        <div class="frame-corner frame-br"></div>
                    </div>

                    <div class="summary-cover-wrapper">
                        <img v-if="together.playback?.song.coverUrl" class="current-cover" :src="resolveImageUrl(together.playback.song.coverUrl)" alt="当前歌曲封面" />
                        <div v-else class="cover-placeholder">
                            <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="12" cy="12" r="10" />
                                <circle cx="12" cy="12" r="3" />
                            </svg>
                        </div>
                    </div>

                    <div class="summary-main">
                        <div class="summary-top">
                            <div class="summary-info">
                                <p class="eyebrow">NOW PLAYING</p>
                                <h2>{{ together.playback?.song.name || '等待房间播放' }}</h2>
                                <p class="muted">{{ together.playback?.song.ar?.map(a => a.name).join(' / ') || '暂无歌手' }}</p>
                            </div>

                            <!-- 房间号与复制按钮：严格遵循测试要求 class="room-id-bar", class="room-number", class="copy-room-id-btn" -->
                            <div class="room-id-bar">
                                <span class="room-number">房间号 {{ together.room.id }}</span>
                                <button
                                    class="copy-room-id-btn"
                                    type="button"
                                    :class="{ 'is-copied': copied }"
                                    :title="copied ? '已复制' : '复制房间号'"
                                    :aria-label="copied ? '已复制' : '复制房间号'"
                                    @click="copyRoomNumber"
                                >
                                    <svg v-if="!copied" class="copy-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                    <svg v-else class="copied-icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                        <polyline points="20 6 9 17 4 12"></polyline>
                                    </svg>
                                </button>
                            </div>
                        </div>

                        <div class="summary-actions">
                            <BaseButton variant="secondary" size="small" @click="run(() => setLocalListening(!together.localPaused))">
                                {{ together.localPaused ? '恢复同步收听' : '仅暂停我的收听' }}
                            </BaseButton>
                            <template v-if="together.owner">
                                <BaseButton v-if="together.room.kind === 'study'" variant="secondary" size="small" @click="kind = 'study'; openCreate(true)">编辑自习室</BaseButton>
                                <BaseButton v-else variant="secondary" size="small" :disabled="pending" @click="run(() => roomAction('room', 'update_chat', { chat: together.chatEnabled ? 2 : 1 }))">
                                    {{ together.chatEnabled ? '关闭聊天' : '开启聊天' }}
                                </BaseButton>
                                <BaseButton variant="danger" size="small" :disabled="pending" @click="leave(true)">解散房间</BaseButton>
                            </template>
                        </div>

                        <p class="muted help">{{ together.canControl ? '底部播放器可控制房间的播放与进度。' : '歌曲与进度跟随房间；你可以单独调节音量或暂停收听。' }}</p>
                        <p v-if="together.room.notice" class="room-notice">{{ together.room.notice }}</p>
                    </div>
                </section>

                <!-- 下方完整内容面板 -->
                <section class="panel room-content">
                    <div class="card-frame" aria-hidden="true">
                        <div class="frame-corner frame-tl"></div>
                        <div class="frame-corner frame-tr"></div>
                        <div class="frame-corner frame-bl"></div>
                        <div class="frame-corner frame-br"></div>
                    </div>
                    <nav class="room-tabs" aria-label="房间内容">
                        <button v-for="(label, key) in roomTabs" :key="key" :class="{ selected: tab === key }" :aria-pressed="tab === key" @click="tab = key">{{ label }}</button>
                    </nav>
                    <div class="tab-content">
                        <div class="section-heading">
                            <h2>{{ roomTabs[tab] }}</h2>
                            <BaseButton variant="secondary" size="small" :disabled="pending" @click="run(() => refreshRoomDetails())">刷新</BaseButton>
                        </div>
                        <p v-if="together.detailError" class="message error" role="status">{{ together.detailError }}</p>

                        <template v-if="tab === 'playlist'">
                            <TogetherSongList
                                :songs="together.songs"
                                :current-hash="together.playback?.song.hash"
                                :action="together.canControl ? '播放' : ''"
                                :busy="pending"
                                @select="song => run(() => roomAction('music', 'switch_song', { ...roomAudio(song), act_type: 1 }))"
                            />
                            <button
                                v-if="together.moreSongs"
                                class="floor-more-btn"
                                :disabled="together.loadingSongs"
                                @click="run(loadMoreRoomSongs)"
                            >
                                {{ together.loadingSongs ? '加载中...' : '更多歌曲' }}
                            </button>
                            <p v-if="!together.songs.length" class="empty">房间还没有歌曲</p>
                        </template>

                        <template v-if="tab === 'order'">
                            <form class="inline-form song-search" @submit.prevent="findSongs">
                                <div class="search-box" style="flex: 1;">
                                    <input v-model="songKeyword" placeholder="搜索歌曲 / 歌手，提交点歌" spellcheck="false" />
                                </div>
                                <BaseButton type="submit" size="small" :loading="searching" :disabled="!songKeyword.trim()">搜索</BaseButton>
                            </form>
                            <TogetherSongList :songs="results" action="点歌" :busy="pending" @select="order" />
                            <p v-if="!results.length" class="empty">搜索你想与大家分享的歌曲</p>
                        </template>

                        <template v-if="tab === 'requests'">
                            <TogetherSongList :songs="together.orders">
                                <template #actions="{ song }">
                                    <template v-if="together.canControl">
                                        <BaseButton variant="secondary" size="small" :disabled="pending" @click="run(() => roomAction('music', 'music_add', { audios: [roomAudio(song)], order_userid: song.order_userid, action: 4 }))">加入队列</BaseButton>
                                        <BaseButton variant="secondary" size="small" :disabled="pending" @click="run(() => roomAction('music', 'remove_song', { ...roomAudio(song), order_userid: song.order_userid }))">移除</BaseButton>
                                    </template>
                                </template>
                            </TogetherSongList>
                            <p v-if="!together.orders.length" class="empty">还没有人点歌</p>
                        </template>

                        <template v-if="tab === 'members'">
                            <ul class="members">
                                <li v-for="(member, index) in together.members" :key="member.id || index">
                                    <img v-if="member.avatar" :src="resolveImageUrl(member.avatar)" alt="" />
                                    <span>{{ member.name }}</span>
                                    <small v-if="member.id === together.room.ownerId">房主</small>
                                </li>
                            </ul>
                            <p v-if="!together.members.length" class="empty">暂无成员信息</p>
                        </template>

                        <template v-if="tab === 'chat'">
                            <button
                                v-if="hasOlder"
                                class="floor-more-btn"
                                :disabled="olderLoading"
                                @click="loadOlder"
                            >
                                {{ olderLoading ? '加载中...' : '加载历史消息' }}
                            </button>
                            <div class="chat-messages" aria-live="polite" aria-relevant="additions">
                                <article v-for="message in together.messages" :key="message.id" :class="{ mine: message.sender === identity() }">
                                    <div class="card-frame" aria-hidden="true">
                                        <div class="frame-corner frame-tl"></div>
                                        <div class="frame-corner frame-tr"></div>
                                        <div class="frame-corner frame-bl"></div>
                                        <div class="frame-corner frame-br"></div>
                                    </div>
                                    <small>{{ message.name }}</small>
                                    <p>{{ message.text }}</p>
                                </article>
                                <p v-if="!together.messages.length" class="empty">和一起听的朋友打个招呼吧</p>
                            </div>
                            <form @submit.prevent="send">
                                <label class="sr-only" for="chat-draft">聊天消息</label>
                                <textarea id="chat-draft" v-model="draft" :disabled="!together.chatEnabled" maxlength="500" :placeholder="together.chatEnabled ? '分享此刻的心情…' : '房主已关闭聊天'" rows="3"></textarea>
                                <div class="chat-footer">
                                    <small>{{ draft.length }} / 500</small>
                                    <BaseButton type="submit" size="small" :loading="sending" :disabled="pending || !draft.trim() || !together.chatEnabled">发送</BaseButton>
                                </div>
                            </form>
                        </template>
                    </div>
                </section>
            </div>
        </template>

        <!-- 创建/编辑房间弹窗 -->
        <BaseModal :show="showCreate" :title="configuring ? '编辑自习室' : `创建${kind === 'music' ? '众乐房' : '自习室'}`" :persistent="pending" @close="showCreate = false">
            <form id="create-together" class="together-form" @submit.prevent="createRoom">
                <label>房间名称<input v-model="form.room_name" maxlength="40" required /></label>
                <template v-if="kind === 'music'"><label>可见范围<Selector v-model="form.room_privacy" :options="[{ label: '私密 · 通过房间号加入', value: 2 }, { label: '公开 · 关联频道', value: 1 }]" /></label><label v-if="form.room_privacy === 1">频道 ID<input v-model="form.global_collection_id" required /></label><label v-else>房间人数<input v-model.number="form.capacity" type="number" min="2" max="5" /></label></template>
                <template v-else><label>房间公告<textarea v-model="form.room_notice" maxlength="200" rows="2"></textarea></label><label>音乐来源<Selector v-model="form.music_type" :options="[{ label: '歌曲列表', value: 1 }, { label: '推荐音乐', value: 2 }, { label: '白噪音', value: 3 }]" /></label><label v-if="form.music_type === 3">白噪音类型编号<input v-model.number="form.white_noise_type" type="number" min="1" /></label><label class="check"><input v-model="form.allow_chat" type="checkbox" :true-value="1" :false-value="0" />允许聊天</label></template>
                <fieldset v-if="kind === 'music' || form.music_type !== 3"><legend>从当前播放队列选择初始歌曲（最多 50 首）</legend><p v-if="!seedSongs.length" class="muted">当前没有可分享的酷狗歌曲，可以先在播放器中选择歌曲。</p><div class="seed-list"><label v-for="song in seedSongs" :key="song.hash" class="check"><input v-model="selectedSongs" type="checkbox" :value="song.hash" />{{ song.name }}</label></div></fieldset>
                <p v-if="error" class="message error" role="alert">{{ error }}</p>
            </form>
            <template #footer><BaseButton variant="secondary" :disabled="pending" @click="showCreate = false">取消</BaseButton><BaseButton form="create-together" type="submit" :loading="pending">{{ configuring ? '保存' : '创建并加入' }}</BaseButton></template>
        </BaseModal>
    </div>
</template>

<style scoped>
.together-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 0 160px;
    color: var(--text);
    text-align: left;
}

/* 标头区域 */
.page-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-bottom: 20px;
}
h1, h2, h3, p {
    margin: 0;
}
h1 {
    font: 28px SourceHanSansCN-Bold, sans-serif;
    margin: 5px 0 10px;
}
h2 {
    font: 15px SourceHanSansCN-Bold, sans-serif;
}
h3 {
    font-size: 13px;
}
.eyebrow {
    font: 11px Bender-Bold, monospace;
    letter-spacing: 2px;
    color: var(--muted-text);
}
.muted, small {
    font-size: 12px;
    color: var(--muted-text);
    line-height: 1.8;
}

/* 大厅主标签栏（众乐房 / 自习室） */
.lobby-mode-tabs {
    display: flex;
    gap: 28px;
    margin-bottom: 18px;
    border-bottom: 1px solid var(--border);
}
.lobby-tab-btn {
    border: none;
    border-bottom: 2px solid transparent;
    padding: 8px 4px 12px;
    background: transparent;
    color: var(--muted-text);
    cursor: pointer;
    font: 16px SourceHanSansCN-Bold, sans-serif;
    transition: color 0.18s ease, border-bottom-color 0.18s ease;
}
.lobby-tab-btn:hover {
    color: var(--text);
}
.lobby-tab-btn.active {
    color: var(--text);
    border-bottom-color: var(--text);
}

/* 通用四角框（与评论区一致的标志性 Arknights 风格） */
.card-frame {
    position: absolute;
    inset: 0;
    pointer-events: none;
}
.frame-corner {
    position: absolute;
    width: 6px;
    height: 6px;
    border: 2px solid var(--text);
}
.frame-corner.frame-tl {
    top: -1px;
    left: -1px;
    border-bottom: none;
    border-right: none;
}
.frame-corner.frame-tr {
    top: -1px;
    right: -1px;
    border-bottom: none;
    border-left: none;
}
.frame-corner.frame-bl {
    bottom: -1px;
    left: -1px;
    border-top: none;
    border-right: none;
}
.frame-corner.frame-br {
    bottom: -1px;
    right: -1px;
    border-top: none;
    border-left: none;
}

/* 面板样式 */
.panel {
    position: relative;
    padding: 22px;
    background: var(--panel);
    border: 1px solid var(--border);
    backdrop-filter: blur(8px);
}
.section-heading, .actions, .inline-form, .join-panel {
    display: flex;
    align-items: center;
    gap: 14px;
}
.section-heading {
    justify-content: space-between;
    margin-bottom: 20px;
}
.join-panel {
    margin-bottom: 22px;
}
.join-panel .inline-form {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
}
.join-panel .inline-form input {
    flex: 1;
}

/* 来源分类标签（推荐房间 / 最近访问 / 我创建的） */
.source-tabs {
    display: flex;
    align-items: center;
    gap: 20px;
}
.source-tab {
    border: none;
    background: transparent;
    padding: 4px 0;
    font: 14px SourceHanSansCN-Bold, sans-serif;
    color: var(--muted-text);
    cursor: pointer;
    transition: color 0.18s ease;
}
.source-tab:hover {
    color: var(--text);
}
.source-tab.active {
    color: var(--text);
}

/* 搜索框 */
.search-box {
    display: flex;
    align-items: center;
    width: 240px;
}
.search-box input {
    width: 100%;
}

/* 房间卡片网格 */
.room-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
}
.room-card {
    position: relative;
    border: 1px solid var(--border);
    background: var(--layer);
    padding: 16px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 94px;
    box-sizing: border-box;
    transition: background-color 0.18s ease, border-color 0.18s ease;
}
.room-card:hover {
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    border-color: var(--text);
}
.room-card img {
    width: 54px;
    height: 54px;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid var(--border);
}
.room-card .card-content {
    flex: 1;
    min-width: 0;
}
.room-card h2 {
    font-size: 15px;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-bottom: 4px;
}
.room-card .card-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.room-notice {
    margin-top: 6px;
    color: var(--muted-text);
    font-size: 11px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
}
.room-card .room-notice {
    max-height: 2.8em;
    overflow: hidden;
}

/* 与评论区一致的展开/加载更多胶囊按钮 */
.floor-more-btn {
    display: block;
    margin: 20px auto 0;
    padding: 7px 22px;
    background: rgba(0, 0, 0, 0.05);
    border: none;
    color: var(--text);
    font: 12px SourceHanSansCN-Bold, sans-serif;
    cursor: pointer;
    transition: background-color 0.16s ease, color 0.16s ease;
}
:global(html.dark) .floor-more-btn {
    background: rgba(255, 255, 255, 0.08);
}
.floor-more-btn:hover:not(:disabled) {
    background: var(--text);
    color: var(--bg);
}
.floor-more-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

/* 房内布局：上下通栏结构，告别左右高度不平衡 */
.room-layout {
    display: flex;
    flex-direction: column;
    gap: 20px;
}

/* 正在播放顶部横向卡片 */
.room-summary {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 22px 24px;
}
.summary-cover-wrapper {
    width: 128px;
    height: 128px;
    flex-shrink: 0;
}
.current-cover, .cover-placeholder {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border: 1px solid var(--border);
    display: block;
}
.cover-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--muted-text);
    background: var(--layer);
}
.summary-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.summary-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
}
.summary-info {
    flex: 1;
    min-width: 0;
}
.summary-info h2 {
    font-size: 20px;
    margin: 4px 0 6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.summary-info .muted {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 房间号与复制按钮 */
.room-id-bar {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--layer);
    border: 1px solid var(--border);
    flex-shrink: 0;
    white-space: nowrap;
}
.room-number {
    font: 12px Bender-Bold, monospace;
    color: var(--text);
    user-select: text;
    margin: 0;
    line-height: 1;
}
.copy-room-id-btn {
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text);
    padding: 0;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.18s ease;
    flex-shrink: 0;
    user-select: none;
}
.copy-room-id-btn:hover {
    background: var(--text);
    color: var(--bg);
}
.copy-room-id-btn.is-copied {
    border-color: #3ba776;
    color: #3ba776;
}

.summary-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}
.help {
    font-size: 12px;
    color: var(--muted-text);
}

/* 房间内容主面板 */
.room-content {
    padding: 0;
    min-width: 0;
}
.room-tabs {
    display: flex;
    gap: 24px;
    padding: 0 24px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
}
.room-tabs button {
    white-space: nowrap;
    border: 0;
    border-bottom: 2px solid transparent;
    padding: 16px 0;
    background: transparent;
    color: var(--muted-text);
    cursor: pointer;
    font: 13px SourceHanSansCN-Bold, sans-serif;
    transition: color 0.18s ease, border-bottom-color 0.18s ease;
}
.room-tabs button:hover {
    color: var(--text);
}
.room-tabs .selected {
    color: var(--text);
    border-bottom-color: var(--text);
}
.tab-content {
    padding: 24px;
}
.song-search {
    margin-bottom: 16px;
}

/* 提示与空状态 */
.empty {
    text-align: center;
    padding: 48px 16px;
    color: var(--muted-text);
    font-size: 13px;
    line-height: 1.8;
}
.message {
    padding: 12px 16px;
    background: var(--layer);
    border-left: 2px solid var(--text);
    margin-bottom: 18px;
    font-size: 13px;
    overflow-wrap: anywhere;
}
.error {
    color: #b83a3a;
    border-color: currentColor;
}

/* 成员列表 */
.members {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 14px;
}
.members li {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 10px 14px;
    background: var(--layer);
    border: 1px solid var(--border);
    min-width: 0;
}
.members img {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    flex-shrink: 0;
    border: 1px solid var(--border);
}
.members span {
    flex: 1;
    font-size: 13px;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.members small {
    font-size: 11px;
    color: var(--muted-text);
    padding: 1px 6px;
    background: var(--panel);
    border: 1px solid var(--border);
}

/* 聊天气泡（四角框风格） */
.chat-messages {
    min-height: 220px;
    max-height: 420px;
    overflow-y: auto;
    margin: 16px 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
}
.chat-messages article {
    position: relative;
    border: 1px solid var(--border);
    background: var(--layer);
    padding: 10px 16px;
    max-width: 75%;
    align-self: flex-start;
}
.chat-messages .mine {
    align-self: flex-end;
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    border-color: var(--text);
}
.chat-messages small {
    font-size: 11px;
    color: var(--muted-text);
}
.chat-messages p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 13px;
    margin-top: 4px;
    user-select: text;
    line-height: 1.5;
}
.chat-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 10px;
}

/* 输入框与控件 */
input, textarea {
    box-sizing: border-box;
    min-width: 0;
    padding: 8px 12px;
    border: 1px solid var(--border);
    background: var(--layer);
    color: var(--text);
    font: inherit;
    font-size: 13px;
    outline: none;
    transition: border-color 0.18s ease;
}
textarea {
    width: 100%;
    resize: vertical;
}
input:focus-visible, textarea:focus-visible, button:focus-visible {
    border-color: var(--text);
    outline: none;
}
.sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
}
.disconnect {
    margin-bottom: 18px;
}
.list-feedback {
    margin-top: 20px;
    text-align: center;
}

/* BaseButton 微调 */
.together-page :deep(.base-button), .together-form :deep(.base-button) {
    border-radius: 0;
    font: 12px SourceHanSansCN-Bold, sans-serif;
    border: 1px solid var(--border);
    white-space: nowrap;
    flex-shrink: 0;
    transition: all 0.16s ease;
}
.together-page :deep(.base-button--primary) {
    color: var(--bg);
    background: var(--text);
    border-color: var(--text);
}
.together-page :deep(.base-button--secondary) {
    background: var(--layer);
    color: var(--text);
}
.together-page :deep(.base-button--danger) {
    background: transparent;
    color: #b83a3a;
    border-color: color-mix(in srgb, #b83a3a 40%, var(--border));
}
.together-page :deep(.base-button--danger:hover:not(:disabled)) {
    background: #b83a3a;
    color: #fff;
    border-color: #b83a3a;
}
.together-page :deep(.base-button:hover:not(:disabled)) {
    background: var(--text);
    color: var(--bg);
}
.together-page :deep(.button-text) {
    margin-left: 0;
}

/* 响应式断点 */
@media (max-width: 850px) {
    .room-summary {
        flex-direction: column;
        align-items: flex-start;
    }
    .summary-cover-wrapper {
        width: 100px;
        height: 100px;
    }
    .summary-top {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
    }
    .room-grid {
        grid-template-columns: 1fr;
    }
    .page-heading {
        align-items: flex-start;
    }
    .page-heading .actions {
        flex-wrap: wrap;
        justify-content: flex-end;
    }
    .join-panel .inline-form {
        flex-wrap: wrap;
    }
    .together-page {
        padding-top: 18px;
    }
}
@media (max-width: 600px) {
    .section-heading {
        flex-wrap: wrap;
    }
    .panel, .tab-content {
        padding: 16px;
    }
    .room-content {
        padding: 0;
    }
    .room-tabs {
        gap: 16px;
        padding: 0 16px;
    }
    .room-card {
        padding: 14px;
    }
    .discovery .actions {
        flex-wrap: wrap;
    }
}
</style>

<style>
/* BaseModal 弹窗样式 */
.modal-container:has(.together-form) {
    background: var(--panel);
    color: var(--text);
    border: 1px solid var(--border);
}
.modal-container:has(.together-form) :is(.modal-header, .modal-footer) {
    border-color: var(--border);
}
.modal-container:has(.together-form) :is(.modal-title h3, .modal-close) {
    color: var(--text);
}
.modal-container:has(.together-form) .base-button {
    font-size: 13px;
}
.modal-container:has(.together-form) .base-button--primary {
    background: var(--text);
    color: var(--bg);
}
.modal-container:has(.together-form) .base-button--secondary {
    background: var(--layer);
    color: var(--text);
}
.together-form {
    display: grid;
    gap: 16px;
    color: var(--text);
}
.together-form label {
    display: grid;
    gap: 6px;
    font-size: 13px;
}
.together-form :is(input, textarea) {
    padding: 8px 12px;
    border: 1px solid var(--border);
    background: var(--layer);
    color: var(--text);
    font: inherit;
    outline: none;
}
.together-form :is(input, textarea):focus {
    border-color: var(--text);
}
.together-form fieldset {
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--border);
    font-size: 12px;
}
.together-form .check {
    display: flex;
    align-items: center;
    gap: 8px;
}
.together-form .check input {
    accent-color: var(--text);
}
.seed-list {
    max-height: 180px;
    overflow-y: auto;
    display: grid;
    gap: 8px;
    margin-top: 6px;
}
.dark .together-page .error, .dark .together-form .error {
    color: #ff9999 !important;
}
.dark .together-page .panel {
    background: var(--panel) !important;
}
.dark .together-page .room-tabs button {
    background: transparent !important;
    border-radius: 0 !important;
    color: var(--muted-text) !important;
}
.dark .together-page .room-tabs .selected {
    color: var(--text) !important;
    border-bottom-color: var(--text) !important;
}
.dark .together-page :is(.muted, small, .empty, .room-notice) {
    color: var(--muted-text) !important;
}
.together-form .error {
    color: #b83a3a;
    font-size: 13px;
}
</style>
