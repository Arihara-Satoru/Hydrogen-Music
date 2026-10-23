export function objectValue(value) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value) } catch { return {} }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export function roomItems(value, keys = ['list', 'info', 'rooms', 'room_list']) {
    if (Array.isArray(value)) return value
    if (!value || typeof value !== 'object') return []
    for (const key of keys) {
        if (Array.isArray(value[key])) return value[key]
        if (key === 'list' && value[key] && typeof value[key] === 'object') return Object.values(value[key])
    }
    if (value.data && value.data !== value) return roomItems(value.data, keys)
    return []
}

export function normalizeRoom(value, kind = 'music') {
    const raw = { ...objectValue(value), ...objectValue(value?.room_info) }
    const biz = String(raw.biz ?? raw.room_biz ?? (kind === 'study' ? '1000' : '1009'))
    const id = String(raw.room_id ?? raw.roomid ?? raw.groupid ?? raw.group_id ?? '')
    return {
        ...raw, id, kind: biz === '1000' ? 'study' : biz === '1009' ? 'music' : '', biz,
        groupId: String(raw.groupid ?? raw.group_id ?? id),
        name: String(raw.room_name || raw.room_theme || raw.introduction || raw.name || raw.channel_name || `${raw.user_info?.nick_name || raw.nick_name || '朋友'}的音乐室`),
        ownerId: String(raw.ownerid ?? raw.owner_id ?? raw.owner_uid ?? raw.creator_userid ?? raw.create_userid ?? raw.master_id ?? raw.owner?.userid ?? raw.userid ?? raw.user_info?.userid ?? raw.ownerId ?? ''),
        cover: raw.room_cover || raw.cover || raw.pic || raw.room_bg_content?.bg_img || raw.user_pic || raw.user_info?.user_pic || '',
        count: Number(raw.member_count ?? raw.online_user_count ?? raw.online_count ?? raw.user_count ?? 0) || 0,
        notice: String(raw.room_notice || raw.notice || ''),
    }
}

// Recommendations can repeat the same rooms across pages, even with is_end=0.
// Skip a bounded number of duplicate pages and always expose an end state.
export async function loadDistinctRoomPages({ fetchPage, previous = [], startPage = 1, kind = 'music', maxPages = 3, isCurrent = () => true }) {
    const merged = new Map(previous.map(room => [room.id, room]))
    const initialCount = merged.size
    let page = startPage
    for (let attempt = 0; attempt < maxPages; attempt++, page++) {
        if (!isCurrent()) return null
        const result = await fetchPage(page)
        if (!isCurrent()) return null
        const raw = roomItems(result, ['rooms', 'room_list', 'list', 'info'])
        for (const item of raw) {
            const room = normalizeRoom(item, kind)
            if (room.id && room.kind === kind) merged.set(room.id, room)
        }
        const added = merged.size - initialCount
        const ended = Number(result?.is_end) === 1 || raw.length === 0
        if (added || ended || attempt === maxPages - 1) {
            return { rooms: [...merged.values()], page, added, hasMore: !ended && added > 0 }
        }
    }
}

export function normalizeRoomSong(value) {
    const raw = { ...objectValue(value), ...objectValue(value?.song_info), ...objectValue(value?.audio) }
    const hash = String(raw.hash || raw.Hash || '').toUpperCase()
    if (!hash) return null
    const mixsongid = raw.mixsongid ?? raw.mixSongId ?? raw.album_audio_id ?? raw.Audioid ?? raw.id ?? ''
    const name = raw.songname || raw.song_name || raw.name || raw.filename || raw.FileName || '未命名歌曲'
    const artist = raw.author_name || raw.singername || raw.singer_name || raw.SingerName || ''
    const authors = Array.isArray(raw.authors) ? raw.authors.map(author => ({ id: author.author_id, name: author.author_name || '' })).filter(author => author.name) : []
    const cover = raw.cover || raw.coverUrl || raw.sizable_cover || raw.album_sizable_cover || raw.album_info?.sizable_cover || raw.trans_param?.union_cover || raw.Image || raw.AlbumImage || raw.img || raw.pic || raw.picUrl || raw.album_img || ''
    return { ...raw, id: mixsongid || hash, mixsongid, hash, name, type: 'song',
        ar: raw.ar || (authors.length ? authors : [{ name: artist }]), al: raw.al || { id: raw.album_id ?? raw.album_info?.album_id, picUrl: cover },
        coverUrl: cover, dt: Number(raw.timelength ?? raw.dt ?? (Number(raw.duration || 0) * 1000)) || 0 }
}

export function normalizeRoomOrder(value) {
    const song = normalizeRoomSong(value)
    if (!song) return null
    return { ...song, order_userid: String(value.order_userid ?? value.user_info?.userid ?? '') }
}

export function roomAudio(song) {
    if (!song || song.type === 'local' || song.type === 'cloud' || song.source === 'siren') return null
    const hash = song.hash || song.Hash
    if (!hash) return null
    return { hash, mixsongid: song.mixsongid ?? song.mixSongId ?? song.album_audio_id ?? song.id ?? '', fid: song.fid ?? 0 }
}

export function normalizeRoomPlayback(value, songs = []) {
    const raw = objectValue(value)
    const state = { ...raw, ...objectValue(raw.player), ...objectValue(raw.progress_info) }
    const hash = String(state.cur_song || '').toUpperCase()
    const match = song => (hash && String(song.hash).toUpperCase() === hash) || (state.album_audio_id && String(song.album_audio_id ?? song.mixsongid ?? song.id) === String(state.album_audio_id))
    const matchedFromList = songs.find(match)
    let audio = state.audio || state.current_audio || state.song
    if (audio && matchedFromList) {
        audio = { ...matchedFromList, ...audio }
    } else {
        audio = audio || matchedFromList || roomItems(raw, ['song_info', 'songs_info']).find(match) || (hash ? { hash, album_audio_id: state.album_audio_id } : null)
    }
    const song = normalizeRoomSong(audio)
    if (!song) return null // An empty/unknown response is not a command to play the first queue entry.
    // genting progress is seconds; pause=1 means running, pause=2 means paused.
    const seconds = Number(state.progress ?? state.play_progress ?? 0)
    if (!Number.isFinite(seconds) || seconds < 0) return null
    return { song, position: seconds, paused: String(state.pause) === '2',
        version: String(state.list_version ?? raw.list_version ?? '') }
}

export function playbackPosition(snapshot, elapsedMs = 0) {
    const position = snapshot.position + (snapshot.paused ? 0 : Math.max(0, elapsedMs) / 1000)
    const duration = snapshot.song.dt / 1000
    return duration > 0 ? Math.min(position, Math.max(0, duration - .25)) : position
}

export function playableRoomUrl(value) {
    if (typeof value === 'string') return /^https?:\/\//i.test(value) ? value : ''
    if (Array.isArray(value)) return value.map(playableRoomUrl).find(Boolean) || ''
    if (!value || typeof value !== 'object') return ''
    for (const key of ['url', 'play_url', 'playurl', 'music_url', 'downurl', 'backupdownurl', 'data', 'audio']) {
        const url = playableRoomUrl(value[key])
        if (url) return url
    }
    return ''
}

export function normalizeRoomMessage(item) {
    const content = objectValue(item.message || item.content || item.msg)
    const text = content.alert ?? content.text ?? item.alert
    if (typeof text !== 'string' || !text) return null
    const sender = String(item.userid ?? item.fromuid ?? content.userid ?? '')
    const id = String(item.msgid ?? item.id ?? `${sender}:${item.sendtime ?? item.timestamp ?? ''}:${text}`)
    return { id, sender, name: String(content.nickname || item.nickname || '房间成员'), text }
}

export function mergeRoomMessages(previous, incoming) {
    return [...new Map([...previous, ...incoming].map(item => [item.id, item])).values()]
        .sort((a, b) => /^\d+$/.test(a.id) && /^\d+$/.test(b.id) ? (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0) : 0)
        .slice(-200)
}
