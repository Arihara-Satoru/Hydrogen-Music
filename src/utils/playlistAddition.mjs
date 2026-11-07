// Store membership keys only, with bounded, short-lived, account-scoped caches.
export function createPlaylistAddition({ getPlaylistAll, updatePlaylist, extractKeys, isSuccess,
  getAccountId, getLoadedSongs = () => null, now = Date.now }) {
  const cache = new Map()
  let scope = null
  let generation = 0
  let busy = false
  const invalidate = ({ cancel = false } = {}) => { cache.clear(); if (cancel) generation++ }
  const addKeys = (keys, songs) => {
    for (const song of songs) for (const key of extractKeys(song)) keys.add(key)
  }
  const remember = (id, keys) => {
    cache.delete(id)
    cache.set(id, { keys, expires: now() + 5000 })
    while (cache.size > 3) cache.delete(cache.keys().next().value)
  }
  const add = async (playlist, input) => {
    if (busy) return { busy: true }
    const account = getAccountId()
    if (!account) throw new Error('请先登录账号')
    if (account !== scope) { invalidate({ cancel: true }); scope = account }
    const revision = generation
    const assertCurrent = () => {
      if (account !== getAccountId() || revision !== generation) throw new Error('账号已切换，请重试')
    }
    const id = String(playlist?.list_create_listid || playlist?.listid || playlist?.id || '')
    if (!id) throw new Error('当前歌单信息不完整')
    const tracks = (Array.isArray(input) ? input : [input]).filter(Boolean)
      .map(song => song?.value && typeof song.value === 'object' ? song.value : song)
    if (!tracks.length) throw new Error('没有选中的歌曲')
    busy = true
    try {
      let keys
      const cached = cache.get(id)
      const loaded = getLoadedSongs(playlist)
      if (cached?.expires > now()) keys = new Set(cached.keys)
      else if (Array.isArray(loaded)) {
        keys = new Set()
        addKeys(keys, loaded)
      } else {
        const snapshot = await getPlaylistAll({ id, timestamp: now(), totalHint: playlist.trackCount ?? playlist.count })
        assertCurrent()
        if (!snapshot?.complete || !Array.isArray(snapshot.songs)) throw new Error('无法确认歌单内容，请重试')
        keys = new Set()
        addKeys(keys, snapshot.songs)
      }
      assertCurrent()
      remember(id, keys)
      const seen = new Set(keys)
      const pending = []
      let skipped = 0
      for (const song of tracks) {
        const songKeys = extractKeys(song)
        if (!songKeys.length) throw new Error('当前歌曲信息不完整，暂时无法添加到歌单')
        if (songKeys.some(key => seen.has(key))) { skipped++; continue }
        pending.push(song)
        for (const key of songKeys) seen.add(key)
      }
      if (!pending.length) return { added: [], skipped, total: tracks.length }
      const result = await updatePlaylist({ op: 'add', pid: id, tracks: pending })
      assertCurrent()
      if (!isSuccess(result)) {
        cache.delete(id)
        return { failed: true, result, added: [], skipped, total: tracks.length }
      }
      addKeys(keys, pending)
      const info = result?.data?.info
      const records = Array.isArray(info) ? info : pending.length === 1 && info ? [info] : []
      addKeys(keys, records)
      remember(id, keys)
      return { added: pending, records, skipped, total: tracks.length, result,
        commit: () => { assertCurrent(); remember(id, keys) } }
    } finally {
      busy = false
    }
  }
  return { add, invalidate }
}

export function playlistAdditionNotice({ added, skipped, total }, name) {
  if (!added.length) return total === 1 ? `歌曲已在「${name}」中` : `所选歌曲已在「${name}」中（${skipped} 首），无需重复添加`
  if (skipped) return `已添加 ${added.length} 首到「${name}」，跳过 ${skipped} 首重复歌曲`
  return total === 1 ? `已添加到${name}` : `已添加 ${added.length} 首到「${name}」`
}
