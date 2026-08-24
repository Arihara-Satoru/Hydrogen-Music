import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'

const localMusicFileListeners = new Set()
const localMusicCountListeners = new Set()
const downloadNextListeners = new Set()
const automaticUpdateListeners = new Set()
const manualUpdateListeners = new Set()
const updateNotAvailableListeners = new Set()
const updateErrorListeners = new Set()
const playerActionListeners = new Map()
let localShortcutBindings = []
let localShortcutListening = false
let automaticUpdateStarted = false
let latestReleaseUrl = ''

export function versionIsNewer(candidate, current) {
  const parse = (version) => String(version || '')
    .replace(/^v/i, '')
    .split('-')[0]
    .split('.')
    .map((value) => Number.parseInt(value, 10) || 0)
  const next = parse(candidate)
  const installed = parse(current)
  for (let index = 0; index < Math.max(next.length, installed.length); index++) {
    if ((next[index] || 0) !== (installed[index] || 0)) {
      return (next[index] || 0) > (installed[index] || 0)
    }
  }
  return false
}

async function checkGithubUpdate(manual) {
  try {
    const settings = await invoke('get_settings')
    if (settings?.other?.enableUpdate === false) throw new Error('应用更新已关闭，请先在设置中开启')
    const response = await fetch('https://api.github.com/repos/Arihara-Satoru/Hydrogen-Music/releases/latest', {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}）`)
    const release = await response.json()
    const latest = String(release.tag_name || release.name || '').replace(/^v/i, '')
    if (!latest) throw new Error('最新版本信息无效')
    if (versionIsNewer(latest, await getVersion())) {
      latestReleaseUrl = release.html_url || `https://github.com/Arihara-Satoru/Hydrogen-Music/releases/tag/v${latest}`
      if (manual) manualUpdateListeners.forEach((callback) => callback?.(latest, latestReleaseUrl))
      else automaticUpdateListeners.forEach((callback) => callback?.(undefined, latest))
    } else if (manual) {
      updateNotAvailableListeners.forEach((callback) => callback?.())
    }
  } catch (error) {
    if (manual) updateErrorListeners.forEach((callback) => callback?.(error?.message || '检查更新失败'))
    else console.warn('Automatic update check failed:', error)
  }
}

function dispatchPlayerAction(action, payload) {
  playerActionListeners.get(action)?.forEach((callback) => callback(undefined, payload))
}

function registerPlayerAction(action, eventName, callback) {
  if (!playerActionListeners.has(action)) playerActionListeners.set(action, new Set())
  playerActionListeners.get(action).add(callback)
  const stop = listenToTauriEvent(eventName, callback)
  return () => {
    playerActionListeners.get(action)?.delete(callback)
    stop()
  }
}

export function matchesShortcut(event, shortcut, isMac = false) {
  const parts = String(shortcut || '').split('+').map((part) => part.trim()).filter(Boolean)
  const key = parts.pop()
  if (!key) return false
  const modifiers = new Set(parts.map((part) => part.toLowerCase()))
  const commandOrControl = modifiers.has('commandorcontrol')
  const control = modifiers.has('control') || (commandOrControl && !isMac)
  const meta = modifiers.has('command') || (commandOrControl && isMac)
  if (event.ctrlKey !== control || event.metaKey !== meta) return false
  if (event.altKey !== modifiers.has('alt') || event.shiftKey !== modifiers.has('shift')) return false

  const expected = ({ Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' })[key] || key
  return event.key.toLowerCase() === expected.toLowerCase()
    || event.code.toLowerCase() === expected.toLowerCase()
    || (key.toLowerCase().startsWith('num') && event.code.toLowerCase() === `numpad${key.slice(3)}`.toLowerCase())
}

function handleLocalShortcut(event) {
  if (event.repeat) return
  const target = event.target
  if (target?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return
  const isMac = /Mac/i.test(navigator.userAgentData?.platform || navigator.platform || '')
  const binding = localShortcutBindings.find(({ shortcut }) => matchesShortcut(event, shortcut, isMac))
  if (!binding) return
  event.preventDefault()
  if (binding.id === 'last' || binding.id === 'next') dispatchPlayerAction('lastOrNext', binding.id)
  else if (binding.id === 'processForward' || binding.id === 'processBack') {
    dispatchPlayerAction('process', binding.id === 'processForward' ? 'forward' : 'back')
  } else dispatchPlayerAction(binding.id)
}

function configureLocalShortcuts(settings) {
  localShortcutBindings = Array.isArray(settings?.shortcuts)
    ? settings.shortcuts.filter((binding) => binding?.id && binding?.shortcut)
    : []
  if (!localShortcutListening && typeof document !== 'undefined') {
    document.addEventListener('keydown', handleLocalShortcut)
    localShortcutListening = true
  }
}

function dispatchDownloadNext() {
  downloadNextListeners.forEach((callback) => callback(undefined))
}

function listenToTauriEvent(eventName, callback) {
  let active = true
  const unlisten = listen(eventName, (event) => active && callback?.(undefined, event.payload))
    .catch(() => () => {})
  return () => {
    active = false
    void unlisten.then((stop) => stop())
  }
}

export function openExternalUrl(value) {
  const url = new URL(String(value))
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
    throw new Error(`Unsupported external URL protocol: ${url.protocol}`)
  }
  return openUrl(url.toString())
}

export function createTauriWindowApi(appWindow, fallbackApi = {}) {
  return {
    windowMin: () => appWindow.minimize(),
    windowMax: () => appWindow.toggleMaximize(),
    windowClose: () => appWindow.close(),
    getWindowMaximizedState: () => appWindow.isMaximized(),
    onWindowMaximizedChange(callback) {
      let active = true
      const unlisten = appWindow.onResized(() => {
        if (!active) return
        void appWindow.isMaximized()
          .then((maximized) => active && callback?.(Boolean(maximized)))
          .catch(() => {})
      }).catch(() => () => {})

      return () => {
        active = false
        void unlisten.then((stop) => stop())
      }
    },
    waitForKugouApiReady: () => invoke('wait_for_kugou_api_ready'),
    getSettings: async () => (await invoke('get_settings')) ?? fallbackApi.getSettings?.(),
    setSettings(settings) {
      try { configureLocalShortcuts(JSON.parse(settings)) } catch (_) {}
      return invoke('set_settings', { settings })
    },
    getLastPlaylist: () => invoke('get_last_playlist'),
    saveLastPlaylist: (playlist) => invoke('save_last_playlist', { playlist }),
    saveLastPlaybackProgress: (progressState) => invoke('save_last_playback_progress', { progressState }),
    scanLocalMusic(params) {
      void invoke('scan_local_music', { params })
        .then((data) => {
          localMusicCountListeners.forEach((callback) => callback(undefined, data.count))
          localMusicFileListeners.forEach((callback) => callback(undefined, data))
        })
        .catch((error) => console.error('Failed to scan local music:', error))
    },
    localMusicFiles(callback) {
      localMusicFileListeners.add(callback)
      return () => localMusicFileListeners.delete(callback)
    },
    localMusicCount(callback) {
      localMusicCountListeners.add(callback)
      return () => localMusicCountListeners.delete(callback)
    },
    clearLocalMusicData: () => Promise.resolve(),
    toFileUrl: (path) => path ? convertFileSrc(path) : '',
    getLocalMusicFileHash: (filePath) => invoke('get_local_music_file_hash', { filePath }),
    rememberLocalMusicHashTrack: (hash, song) => invoke('remember_local_music_hash_track', { hash, song }),
    getLocalMusicHashTracks: () => invoke('get_local_music_hash_tracks'),
    getLocalMusicImage: (filePath) => invoke('get_local_music_image', { filePath }),
    getCloudMusicMetadata: (options) => invoke('get_cloud_music_metadata', { options }),
    getLocalMusicLyric: (filePath) => invoke('get_local_music_lyric', { filePath }),
    startDownload: dispatchDownloadNext,
    download(args) {
      void invoke('download_file', { args }).catch((error) => {
        console.error('Failed to start download:', error)
        dispatchDownloadNext()
      })
    },
    downloadNext(callback) {
      downloadNextListeners.add(callback)
      const stop = listenToTauriEvent('download-next', callback)
      return () => {
        downloadNextListeners.delete(callback)
        stop()
      }
    },
    downloadProgress: (callback) => listenToTauriEvent('download-progress', callback),
    downloadPause: (close) => invoke('pause_download', { close: close ?? null }),
    downloadResume: () => invoke('resume_download'),
    downloadCancel: () => invoke('cancel_download'),
    beforeQuit: (callback) => listenToTauriEvent('player-save', callback),
    exitApp: (playlist) => invoke('exit_app', { playlist }),
    playOrPauseMusic: (callback) => registerPlayerAction('play', 'music-playing-control', callback),
    lastOrNextMusic: (callback) => registerPlayerAction('lastOrNext', 'music-song-control', callback),
    changeMusicPlaymode: (callback) => registerPlayerAction('playMode', 'music-playmode-control', callback),
    volumeUp: (callback) => registerPlayerAction('volumeUp', 'music-volume-up', callback),
    volumeDown: (callback) => registerPlayerAction('volumeDown', 'music-volume-down', callback),
    musicProcessControl: (callback) => registerPlayerAction('process', 'music-process-control', callback),
    hidePlayer: (callback) => listenToTauriEvent('hide-player', callback),
    async registerShortcuts() {
      const settings = await invoke('get_settings')
      configureLocalShortcuts(settings)
      try {
        await invoke('register_shortcuts')
      } catch (error) {
        console.warn('Some global shortcuts could not be registered:', error)
      }
    },
    unregisterShortcuts() {
      localShortcutBindings = []
      return invoke('unregister_shortcuts')
    },
    setWindowTile: (title) => appWindow.setTitle(String(title || 'Hydrogen Music')),
    getRequestData: (request) => invoke('get_request_data', { request }),
    getMusicVideoPool: () => invoke('get_music_video_pool'),
    async addMusicVideoPoolFiles() {
      const selected = await open({
        directory: false,
        multiple: true,
        filters: [{ name: '视频文件', extensions: ['mp4', 'm4v', 'webm', 'mov'] }],
      })
      if (!selected) {
        return { canceled: true, addedCount: 0, ...(await invoke('get_music_video_pool')) }
      }
      const paths = Array.isArray(selected) ? selected : [selected]
      return invoke('add_music_video_pool_files', { paths })
    },
    removeMusicVideoPoolFile: (filePath) => invoke('remove_music_video_pool_file', { filePath }),
    clearMusicVideoPool: () => invoke('clear_music_video_pool'),
    musicVideoIsExists: (obj) => invoke('music_video_is_exists', { obj }),
    deleteMusicVideo: (id) => invoke('delete_music_video', { id }),
    getBiliVideo: (request) => invoke('get_bili_video', { request }).catch((error) => {
      console.error('Failed to cache Bilibili video:', error)
      return 'failed'
    }),
    downloadVideoProgress: (callback) => listenToTauriEvent('download-video-progress', callback),
    cancelDownloadMusicVideo: () => invoke('cancel_download_music_video'),
    clearUnusedVideo: () => invoke('clear_unused_video'),
    clearAllCacheData: () => invoke('clear_all_cache_data'),
    resetAllData: () => invoke('reset_all_data'),
    onResetLocalStorage: (callback) => listenToTauriEvent('reset-local-storage', callback),
    checkUpdate(callback) {
      automaticUpdateListeners.add(callback)
      if (!automaticUpdateStarted) {
        automaticUpdateStarted = true
        queueMicrotask(() => void checkGithubUpdate(false))
      }
      return () => automaticUpdateListeners.delete(callback)
    },
    manualUpdateAvailable(callback) {
      manualUpdateListeners.add(callback)
      return () => manualUpdateListeners.delete(callback)
    },
    updateNotAvailable(callback) {
      updateNotAvailableListeners.add(callback)
      return () => updateNotAvailableListeners.delete(callback)
    },
    updateDownloadProgress: () => () => {},
    updateDownloaded: () => () => {},
    updateError(callback) {
      updateErrorListeners.add(callback)
      return () => updateErrorListeners.delete(callback)
    },
    checkForUpdate: () => checkGithubUpdate(true),
    downloadUpdate: () => latestReleaseUrl ? openExternalUrl(latestReleaseUrl) : checkGithubUpdate(true),
    installUpdate: () => latestReleaseUrl ? openExternalUrl(latestReleaseUrl) : Promise.resolve(),
    cancelUpdate: () => Promise.resolve(),
    playOrPauseMusicCheck: () => {},
    changeTrayMusicPlaymode: () => {},
    updatePlaylistStatus: () => {},
    updateDockMenu: () => {},
    openDirectory: () => open({ directory: true, multiple: false }),
    openFile: () => open({ directory: false, multiple: false }),
    openLocalFolder: (path) => revealItemInDir(path),
    toRegister: openExternalUrl,
    copyTxt: (text) => writeText(String(text)),
  }
}

export function getTauriWindowApi(fallbackApi) {
  return isTauri() ? createTauriWindowApi(getCurrentWindow(), fallbackApi) : null
}

export function getTauriElectronApi() {
  if (!isTauri()) return null
  return {
    createLyricWindow: () => invoke('create_lyric_window'),
    closeLyricWindow: () => invoke('close_lyric_window'),
    setLyricWindowMovable: (movable) => invoke('set_lyric_window_movable', { movable }),
    lyricWindowReady: () => {},
    onLyricUpdate: (callback) => listenToTauriEvent('lyric-update', callback),
    requestLyricData: () => invoke('request_lyric_data'),
    updateLyricData: (data) => invoke('update_lyric_data', { data }),
    seekDesktopLyric: (position) => invoke('seek_desktop_lyric', { position }),
    controlDesktopLyricPlayback: (action) => invoke('control_desktop_lyric_playback', { action }),
    getCurrentLyricData: (callback) => listenToTauriEvent('get-current-lyric-data', callback),
    isLyricWindowVisible: () => invoke('is_lyric_window_visible'),
    onDesktopLyricClosed: (callback) => listenToTauriEvent('desktop-lyric-closed', callback),
    resizeWindow: (width, height) => invoke('resize_lyric_window', { width, height }),
    getLyricWindowBounds: () => invoke('get_lyric_window_bounds'),
    getLyricWindowContentBounds: () => invoke('get_lyric_window_content_bounds'),
    moveLyricWindow: (x, y) => invoke('move_lyric_window', { x: Math.round(x), y: Math.round(y) }),
    moveLyricWindowBy: async (dx, dy) => {
      const bounds = await invoke('get_lyric_window_bounds')
      if (bounds) return invoke('move_lyric_window', { x: Math.round(bounds.x + dx), y: Math.round(bounds.y + dy) })
    },
    moveLyricWindowTo: (x, y, width, height) => invoke('move_lyric_window', {
      x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height),
    }),
    moveLyricWindowContentTo: (x, y, width, height) => invoke('move_lyric_window', {
      x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height),
    }),
    setLyricWindowResizable: (resizable) => invoke('set_lyric_window_resizable', { resizable }),
    getLyricWindowMinMax: () => invoke('get_lyric_window_min_max'),
    setLyricWindowMinMax: (minWidth, minHeight, maxWidth, maxHeight) => invoke('set_lyric_window_min_max', {
      minWidth: Math.round(minWidth), minHeight: Math.round(minHeight),
      maxWidth: Math.round(maxWidth), maxHeight: Math.round(maxHeight),
    }),
    setLyricWindowAspectRatio: () => {},
    notifyLyricWindowClosed: () => invoke('notify_lyric_window_closed'),
  }
}

export function getTauriPlayerApi() {
  if (!isTauri()) return null
  const onPayload = (eventName, callback) => listenToTauriEvent(
    eventName,
    (_event, payload) => callback?.(payload),
  )
  const onAction = (eventName, callback) => listenToTauriEvent(eventName, () => callback?.())
  return {
    onSetPosition: (callback) => onPayload('set-position', callback),
    onPlayPause: (callback) => onAction('playpause', callback),
    onNext: (callback) => onAction('next', callback),
    onPrevious: (callback) => onAction('previous', callback),
    onPlayM: () => () => {},
    onPauseM: () => () => {},
    onRepeat: () => () => {},
    onShuffle: () => () => {},
    sendMetaData: () => {},
    sendPlayerCurrentTrackTime: () => {},
    setVolume: () => {},
    onVolumeChanged: () => () => {},
  }
}
