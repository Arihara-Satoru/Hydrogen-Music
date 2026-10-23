import { watch } from 'vue'
import pinia from '../store/pinia'
import { useListenTogetherStore } from '../store/listenTogetherStore'
import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'
import { ROOM_BIZ, togetherRequest } from '../api/listenTogether'
import { getCookie, isLogin } from './authority'
import { noticeOpen } from './dialog'
import { setTogetherHandler, setTogetherPersonalSnapshot } from './togetherBridge'
import { roomItems, normalizeRoom, normalizeRoomSong, normalizeRoomOrder, normalizeRoomPlayback, playbackPosition,
    playableRoomUrl, normalizeRoomMessage, mergeRoomMessages, roomAudio } from './listenTogetherData.mjs'

let session = null
let entering = null
let generation = 0
let disposeAccount = null
let playerModule
const store = () => useListenTogetherStore(pinia)
const player = () => usePlayerStore(pinia)
const account = () => String(getCookie('userid') || '')
const loadPlayer = async () => playerModule ||= await import('./player')
const current = context => context === session && context.generation === generation && context.account === account() && isLogin()
const params = room => ({ room_id: room.id, roomid: room.id, groupid: room.groupId, biz: room.biz })
const api = (context, domain, operation, data = {}) => togetherRequest(domain, operation, { ...params(context.room), ...data }, { signal: context.controller.signal })

export function initTogetherSession() {
    if (disposeAccount) return
    disposeAccount = watch(() => useUserStore(pinia).user?.userId, () => {
        if ((session && session.account !== account()) || (session && !useUserStore(pinia).user)) resetTogetherSession()
    })
    window.addEventListener('beforeunload', unloadSession)
}

function unloadSession() { void leaveTogetherRoom().catch(() => {}) }
export function destroyTogetherSession() {
    disposeAccount?.(); disposeAccount = null
    window.removeEventListener('beforeunload', unloadSession)
    resetTogetherSession()
}

function restorePersonal(context) {
    playerModule?.stopTogetherPlayback()
    if (context?.saved) Object.assign(player(), context.saved, { playing: false, currentMusic: null })
}

export function resetTogetherSession() {
    generation++
    entering?.abort(); entering = null
    const old = session
    session = null
    if (old) {
        clearTimeout(old.syncTimer); clearTimeout(old.detailTimer); clearTimeout(old.heartbeatTimer)
        old.controller.abort()
    }
    setTogetherHandler(null)
    if (old) restorePersonal(old)
    setTogetherPersonalSnapshot(null)
    store().$reset()
}

export async function leaveTogetherRoom(dismiss = false) {
    const old = session
    if (!old) { resetTogetherSession(); return }
    if (dismiss && !store().owner) throw new Error('只有房主可以解散房间')
    if (old.leaving) return
    old.leaving = true
    store().busy = true
    // Failed leave remains visible/retryable, rather than silently stranding a room.
    try {
        await api(old, 'room', dismiss ? 'dismiss' : 'leave')
        if (current(old)) resetTogetherSession()
    } finally {
        old.leaving = false
        if (current(old)) store().busy = false
    }
}

function savePersonal() {
    const p = player()
    return Object.fromEntries(['songList', 'listInfo', 'songId', 'currentIndex', 'progress', 'time', 'quality', 'shuffledList', 'shuffleIndex']
        .map(key => [key, p[key]]))
}

export async function enterTogetherRoom(input, kind = 'music', creation = null) {
    if (!isLogin()) throw new Error('请先登录酷狗概念版账号')
    if (store().joining) return
    if (session) throw new Error('请先离开当前房间')
    const g = ++generation, user = account(), controller = new AbortController()
    entering = controller
    store().joining = true; store().error = ''
    let room, joined = false, created = false
    const valid = () => generation === g && account() === user && isLogin()
    try {
        const playback = await loadPlayer()
        if (!valid()) return
        if (creation) {
            const result = await togetherRequest('room', 'create', { ...creation, biz: ROOM_BIZ[kind] }, { signal: controller.signal })
            created = true
            room = normalizeRoom(result, kind)
            if (!room.id) throw new Error('创建结果缺少房间编号，请在“我创建的”或“最近访问”中检查')
            room.name = creation.room_name || room.name
            room.ownerId = user
        } else {
            room = typeof input === 'object' ? normalizeRoom(input, kind) : normalizeRoom({ room_id: String(input).trim() }, kind)
        }
        if (!room.kind || !room.id || !/^[\w-]+$/.test(room.id)) throw new Error('请输入有效的房间号，并选择正确的房间类型')
        if (!valid()) return
        if (creation && kind === 'study') {
            await togetherRequest('study', 'configure', { ...creation, ...params(room) }, { signal: controller.signal })
        }
        const joinedData = await togetherRequest('room', 'join', params(room), { signal: controller.signal })
        joined = true
        const groupId = joinedData.groupid ?? joinedData.group_id
        if (groupId) room.groupId = String(groupId)
        if (!valid()) return
        if (creation && kind === 'music') {
            const audios = creation.audios || []
            const firstAudio = audios[0]
            const progressInfo = creation.progress_info || {
                cur_song: firstAudio?.hash || '',
                album_audio_id: String(firstAudio?.mixsongid ?? firstAudio?.mixSongId ?? firstAudio?.album_audio_id ?? ''),
                progress: 0,
                pause: firstAudio ? '1' : '2',
                play_mode: 1,
            }
            await togetherRequest('music', 'initialize', {
                ...params(room),
                audios,
                progress_info: progressInfo,
            }, { signal: controller.signal })
        }
        if (!valid()) return
        const context = { room, account: user, generation: g, controller, saved: savePersonal(), failures: 0, streamRetryAt: 0 }
        session = context; entering = null
        setTogetherPersonalSnapshot(context.saved)
        playback.stopTogetherPlayback()
        player().songList = null
        player().songId = null
        player().progress = 0
        player().time = 0
        player().listInfo = { type: 'together', id: room.id, sourceRoute: '/together' }
        store().room = room; store().owner = room.ownerId === user; store().connection = '连接中'
        setTogetherHandler(handleControl)
        schedule(context, 'syncTimer', syncPlayback, 0)
        schedule(context, 'detailTimer', refreshRoomDetails, 0)
        schedule(context, 'heartbeatTimer', heartbeat, 0)
    } catch (error) {
        if (valid()) store().error = error.message
        throw error
    } finally {
        // Only use the same account's credentials for compensating cleanup.
        if (!session && room?.id && (joined || created) && account() === user && isLogin()) {
            await togetherRequest('room', created ? 'dismiss' : 'leave', params(room)).catch(() => {})
        }
        if (generation === g) { store().joining = false; entering = null }
    }
}

function schedule(context, key, fn, delay) {
    if (!current(context)) return
    clearTimeout(context[key])
    context[key] = setTimeout(async () => {
        try { await fn(context) } catch (error) {
            if (current(context)) { store().error = error.message; store().connection = '连接中断，正在重试' }
        } finally {
            const interval = key === 'syncTimer' ? Math.min(15000, 3000 * (context.failures + 1)) : key === 'heartbeatTimer' ? 20000 : 12000
            schedule(context, key, fn, interval)
        }
    }, delay)
}

async function heartbeat(context) {
    const result = await api(context, 'room', 'heartbeat')
    if (!current(context)) return
    if (result.status && ['DISMISSED', 'CLOSED', 'DELETED'].includes(String(result.status))) {
        resetTogetherSession(); noticeOpen('房间已结束', 3)
    }
}

async function syncPlayback(context) {
    if (!current(context) || context.syncing || context.command || context.leaving) return
    context.syncing = true
    const commandVersion = context.commandVersion || 0
    try {
        const started = performance.now()
        const raw = await api(context, context.room.kind, 'sync_player')
        const received = performance.now()
        if (!current(context) || commandVersion !== (context.commandVersion || 0)) return
        const snapshot = normalizeRoomPlayback(raw, store().songs)
        store().connection = snapshot ? '已同步' : '等待房间播放'; store().lastSync = Date.now()
        store().error = ''; context.failures = 0
        if (!snapshot) {
            // An empty room must not keep playing the previous room track.
            if (player().currentMusic) playerModule.stopTogetherPlayback()
            store().playback = null
            context.hash = ''
            return
        }
        store().playback = snapshot
        if (snapshot.version) store().listVersion = snapshot.version
        const p = player(), same = context.hash === snapshot.song.hash && p.currentMusic
        if (same) {
            // Queue metadata often arrives after the first player snapshot.
            const existing = p.songList?.[0]
            if (existing && snapshot.song.name !== '未命名歌曲') Object.assign(existing, snapshot.song)
        }
        if (!same) {
            if (Date.now() < context.streamRetryAt) return
            if (p.currentMusic) playerModule.stopTogetherPlayback()
            let url
            if (context.room.kind === 'music') {
                const stream = await api(context, 'music', 'playback_url', roomAudio(snapshot.song))
                url = playableRoomUrl(stream)
                if (snapshot.song.name === '未命名歌曲' && stream.fileName) snapshot.song.name = stream.fileName
                if (!snapshot.song.dt && stream.timeLength) snapshot.song.dt = Number(stream.timeLength) * 1000
            } else url = playableRoomUrl(raw)
            // The room endpoint can return encrypted KGS, which HTML audio cannot
            // decode. Resolve that same song through the account's existing URL API.
            if (!url || /\.kgs(?:[?#]|$)/i.test(url)) {
                const { resolveTrackByQualityPreference } = await import('./musicUrlResolver')
                if (!current(context)) return
                const stream = await resolveTrackByQualityPreference(snapshot.song, 'standard')
                url = stream?.url
            }
            if (!current(context) || commandVersion !== (context.commandVersion || 0)) return
            if (!url) { context.streamRetryAt = Date.now() + 15000; throw new Error('房间歌曲暂时无法播放，将稍后重试') }
            const seek = playbackPosition(snapshot, (received - started) / 2 + performance.now() - received)
            playerModule.playTogetherTrack(snapshot.song, url, seek, !snapshot.paused && !store().localPaused)
            context.hash = snapshot.song.hash
        } else {
            const desired = playbackPosition(snapshot, (received - started) / 2)
            const seek = Number(p.currentMusic.seek?.()) || 0
            if (Math.abs(seek - desired) > 2) playerModule.changeProgress(desired, { roomSync: true })
            if (snapshot.paused || store().localPaused) {
                if (p.playing) playerModule.pauseMusic({ roomSync: true })
            } else if (!p.playing) playerModule.startMusic({ roomSync: true })
        }
    } catch (error) {
        if (current(context)) {
            context.failures++
            if (context.failures >= 3 && player().playing) playerModule.pauseMusic({ roomSync: true })
        }
        throw error
    } finally { context.syncing = false }
}

export async function refreshRoomDetails(context = session) {
    if (!context || !current(context)) return
    const revision = context.detailRevision = (context.detailRevision || 0) + 1
    const requests = [
        [context.room.kind, 'detail'], [context.room.kind, 'members'], [context.room.kind, 'playlist'], ['chat', 'history'],
    ]
    if (context.room.kind === 'music') requests.push(['music', 'song_order_list'])
    const results = await Promise.allSettled(requests.map(([domain, op]) => api(context, domain, op)))
    if (!current(context) || revision !== context.detailRevision) return
    store().detailError = results.filter(item => item.status === 'rejected').map(item => item.reason?.message || '房间详情加载失败').join('；')
    const [detail, members, songs, messages, orders] = results.map(item => item.status === 'fulfilled' ? item.value : null)
    if (detail) {
        if ((context.room.kind === 'music' && Number(detail.room_status) === 0)
            || (context.room.kind === 'study' && Number(detail.status) === 0)) {
            resetTogetherSession()
            noticeOpen('房间已结束，已恢复个人播放队列', 3)
            return
        }
        const normalized = normalizeRoom({ ...context.room, ...detail }, context.room.kind)
        // Preserve the rmservice group identity obtained at join time.
        context.room = { ...normalized, id: context.room.id, groupId: context.room.groupId }
        store().room = context.room
        store().owner = context.room.ownerId === context.account
        store().chatEnabled = Number(detail.allow_chat ?? detail.switch?.chat ?? 1) === 1
    }
    if (members) store().members = roomItems(members, ['members', 'member_list', 'list', 'info']).map(item => ({
        id: String(item.userid ?? item.user_id ?? item.id ?? ''), name: item.nickname || item.nick_name || item.name || '房间成员',
        avatar: item.pic || item.img || item.avatar || item.user_pic || '',
    }))
    if (songs) {
        const firstPage = roomItems(songs, ['songs_info', 'audios', 'songs', 'list', 'info']).map(normalizeRoomSong).filter(Boolean)
        // Retain explicitly loaded pages only while the server's queue version agrees.
        const sameVersion = songs.list_version != null && String(songs.list_version) === context.queueVersion
        store().songs = sameVersion ? [...new Map([...firstPage, ...store().songs].map(song => [song.hash, song])).values()] : firstPage
        store().moreSongs = context.room.kind === 'music' && firstPage.length >= 50 && (songs.quantity == null || store().songs.length < Number(songs.quantity))
        if (songs.list_version != null) store().listVersion = String(songs.list_version)
        context.queueVersion = String(songs.list_version ?? '')
    }
    if (messages) {
        const items = roomItems(messages, ['messages', 'msg_list', 'msglist', 'list', 'info']).map(normalizeRoomMessage).filter(Boolean)
        store().messages = mergeRoomMessages(store().messages, items)
    }
    if (orders) store().orders = roomItems(orders, ['songs_info', 'audios', 'songs', 'list', 'info']).map(normalizeRoomOrder).filter(Boolean)
}

export async function loadMoreRoomSongs() {
    const context = session, s = store()
    if (!context || !current(context) || !s.moreSongs || s.loadingSongs) return
    const version = s.listVersion
    s.loadingSongs = true
    try {
        const result = await api(context, 'music', 'playlist', { audio: roomAudio(s.songs.at(-1)), pagesize: 50 })
        if (!current(context)) return
        if (s.listVersion !== version || (result.list_version != null && String(result.list_version) !== version)) {
            await refreshRoomDetails(context)
            return
        }
        const incoming = roomItems(result, ['songs_info', 'audios', 'songs', 'list', 'info']).map(normalizeRoomSong).filter(Boolean)
        const count = s.songs.length
        s.songs = [...new Map([...s.songs, ...incoming].map(song => [song.hash, song])).values()]
        s.moreSongs = incoming.length >= 50 && s.songs.length > count && (result.quantity == null || s.songs.length < Number(result.quantity))
    } finally { if (current(context)) s.loadingSongs = false }
}

export async function roomAction(domain, operation, data = {}) {
    const context = session
    if (!context || !current(context)) throw new Error('请先加入房间')
    if (store().busy) throw new Error('正在处理上一项操作，请稍候')
    if (['switch_song', 'player_operation', 'music_add', 'remove_song', 'configure', 'update_chat'].includes(operation) && !store().owner) throw new Error('只有房主可以进行此操作')
    store().busy = true; context.command = true; context.commandVersion = (context.commandVersion || 0) + 1
    try {
        const result = await api(context, domain, operation, { list_version: store().listVersion, ...data })
        if (!current(context)) throw new Error('房间会话已结束')
        return result
    } finally {
        context.command = false
        if (current(context)) {
            store().busy = false
            // Refresh on rejection as well (including a stale queue version).
            void refreshRoomDetails(context).catch(() => {})
            void syncPlayback(context).catch(error => { if (current(context)) store().error = error.message })
        }
    }
}

export async function sendRoomMessage(text) {
    if (!text.trim()) return
    if (text.length > 500) throw new Error('消息不能超过 500 字')
    if (!store().chatEnabled) throw new Error('房主已关闭聊天')
    const user = useUserStore(pinia).user
    await roomAction('chat', 'send', { message: text.trim(), nickname: user?.nickname || '', img: user?.avatarUrl || '' })
}

export async function setLocalListening(paused) {
    if (!session) return
    store().localPaused = paused
    if (paused) playerModule.pauseMusic({ roomSync: true })
    else await syncPlayback(session)
}

function handleControl(action, payload) {
    const s = store(), context = session
    if (!context) return
    if (action === 'stream-error') {
        context.hash = ''; context.streamRetryAt = Date.now() + 10000
        playerModule.stopTogetherPlayback()
        s.error = '播放地址暂不可用，正在重新同步'
        return
    }
    if (action === 'ended') {
        player().playing = false
        void syncPlayback(context).catch(() => {})
        return
    }
    if (action === 'external' || action === 'unsupported') {
        noticeOpen(action === 'external' ? '正在一起听，请先到房间页面离开，再播放其他歌曲' : '一起听期间由房间决定播放顺序，暂不支持此操作', 3)
        return
    }
    if (action === 'local-pause' || (!s.canControl && ['pause', 'resume'].includes(action))) {
        void setLocalListening(action !== 'resume').catch(error => { s.error = error.message })
        return
    }
    if (!s.canControl) { noticeOpen('只有众乐房房主可以控制房间播放', 2); return }
    if (s.localPaused && action === 'resume') { void setLocalListening(false).catch(error => { s.error = error.message }); return }
    let operation = 'player_operation', data
    if (action === 'seek') data = { action: 2, progress: Math.floor(Math.max(0, Number(payload) || 0)) }
    else if (action === 'pause' || action === 'resume') data = { action: 3, pause: action === 'pause' ? 2 : 1 }
    else {
        const index = s.songs.findIndex(song => song.hash === s.playback?.song.hash)
        const target = index < 0 ? null : s.songs[index + (action === 'previous' ? -1 : 1)]
        if (!target) { noticeOpen('队列中暂无可切换的歌曲，请在房间歌单中选择', 2); return }
        operation = 'switch_song'; data = { ...roomAudio(target), act_type: 1 }
    }
    void roomAction('music', operation, data).catch(error => { if (current(context)) s.error = error.message })
}
