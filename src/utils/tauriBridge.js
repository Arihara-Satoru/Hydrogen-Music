/**
 * Tauri API 桥接层
 *
 * 提供与 Electron `window.windowApi`/`window.electronAPI` 兼容的接口，
 * 底层使用 Tauri invoke() + Tauri Plugin API。
 * 在 Tauri 环境下使用 @tauri-apps/api 的 invoke/listen 调用 Rust 命令。
 * 在 Electron 环境下回退到 window.windowApi，保障迁移过程中的兼容性。
 *
 * 使用方法：
 *   1. 在 main.js 中调用 setupTauriBridge() 初始化
 *   2. 现有代码中的 windowApi.xxx() 调用自动生效
 *   3. 新代码可 import { xxx } from './tauriBridge'
 *
 * 注意：Tauri 插件（plugin-store/plugin-dialog 等）在非 Tauri 环境不可用，
 *       因此采用动态 import() 懒加载，避免阻塞 Vue 挂载。
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'

// ── Tauri 事件回调存储（解耦 listen 注册与回调设置时机） ──
let _playPauseCb = null
let _songControlCb = null
let _playmodeCb = null
let _volumeUpCb = null
let _volumeDownCb = null
let _processControlCb = null
let _hidePlayerCb = null
let _windowMaximizedCb = null
let _listenersReady = false

/**
 * 在 setupTauriBridge 中直接注册 Tauri 事件监听器，
 * 避免 player.js 模块级代码因加载时序早于 setupTauriBridge() 而丢失回调。
 */
function ensureTauriListeners() {
  if (_listenersReady) return
  _listenersReady = true

  listen('music-playing-control', () => {
    if (typeof _playPauseCb === 'function') _playPauseCb()
  })
  listen('music-song-control', (event) => {
    if (typeof _songControlCb === 'function') _songControlCb(null, event.payload)
  })
  listen('music-playmode-control', (event) => {
    if (typeof _playmodeCb === 'function') _playmodeCb(null, event.payload)
  })
  listen('music-volume-up', () => {
    if (typeof _volumeUpCb === 'function') _volumeUpCb()
  })
  listen('music-volume-down', () => {
    if (typeof _volumeDownCb === 'function') _volumeDownCb()
  })
  listen('music-process-control', (event) => {
    if (typeof _processControlCb === 'function') _processControlCb(event.payload)
  })
  listen('hide-player', () => {
    if (typeof _hidePlayerCb === 'function') _hidePlayerCb()
  })
  listen('window-maximized-changed', (event) => {
    if (typeof _windowMaximizedCb === 'function') {
      _windowMaximizedCb(null, Boolean(event.payload))
    }
  })
}

// ── 默认快捷键 ──
const DEFAULT_SHORTCUTS = [
  { id: 'play', name: '播放/暂停', shortcut: 'CommandOrControl+P', globalShortcut: 'CommandOrControl+Alt+P' },
  { id: 'last', name: '上一首', shortcut: 'CommandOrControl+Left', globalShortcut: 'CommandOrControl+Alt+Left' },
  { id: 'next', name: '下一首', shortcut: 'CommandOrControl+Right', globalShortcut: 'CommandOrControl+Alt+Right' },
  { id: 'volumeUp', name: '增加音量', shortcut: 'CommandOrControl+Up', globalShortcut: 'CommandOrControl+Alt+Up' },
  { id: 'volumeDown', name: '减少音量', shortcut: 'CommandOrControl+Down', globalShortcut: 'CommandOrControl+Alt+Down' },
  { id: 'processForward', name: '快进(3s)', shortcut: 'CommandOrControl+]', globalShortcut: 'CommandOrControl+Alt+]' },
  { id: 'processBack', name: '后退(3s)', shortcut: 'CommandOrControl+[', globalShortcut: 'CommandOrControl+Alt+[' },
]

// ── 默认设置（首次使用时写入 Store） ──
const DEFAULT_SETTINGS = {
  music: { level: 'high', lyricSize: 17, tlyricSize: 14, rlyricSize: 14, lyricInterlude: 2, searchAssistLimit: 8, showSongTranslation: true, coverSize: 400 },
  local: { downloadFolder: '', localFolder: [] },
  other: { quitApp: 'minimize', enableUpdate: false, globalShortcuts: false },
  shortcuts: DEFAULT_SHORTCUTS
}

/** 判断当前是否运行在 Tauri 环境 */
const isTauri = () => typeof window !== 'undefined' && window.__TAURI__ !== undefined

/** 动态获取 Tauri 插件模块（非 Tauri 环境返回 fallback） */
let _tauriModules = null
async function ensureTauriModules() {
  if (_tauriModules) return _tauriModules
  if (!isTauri()) {
    _tauriModules = { store: null, dialog: null, shell: null, ww: null, dpi: null }
    return _tauriModules
  }
  try {
    const [storeMod, dialogMod, shellMod, wwMod, dpiMod] = await Promise.all([
      import('@tauri-apps/plugin-store'),
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-shell'),
      import('@tauri-apps/api/webviewWindow'),
      import('@tauri-apps/api/dpi'),
    ])
    _tauriModules = {
      store: storeMod,
      dialog: dialogMod,
      shell: shellMod,
      ww: wwMod,
      dpi: dpiMod,
    }
  } catch (e) {
    console.warn('[tauriBridge] Failed to load Tauri plugin modules:', e)
    _tauriModules = { store: null, dialog: null, shell: null, ww: null, dpi: null }
  }
  return _tauriModules
}

/** 懒加载获取 Store 实例 */
let _settingsStore = null
let _lastPlaylistStore = null
let _musicVideoStore = null

async function getStore(name) {
  const mod = await ensureTauriModules()
  if (!mod.store) return null
  if (name === 'settings' && !_settingsStore) _settingsStore = await mod.store.Store.load('settings.json')
  if (name === 'lastPlaylist' && !_lastPlaylistStore) _lastPlaylistStore = await mod.store.Store.load('lastPlaylist.json')
  if (name === 'musicVideo' && !_musicVideoStore) _musicVideoStore = await mod.store.Store.load('musicVideo.json')
  if (name === 'settings') return _settingsStore
  if (name === 'lastPlaylist') return _lastPlaylistStore
  if (name === 'musicVideo') return _musicVideoStore
  return null
}

/** 获取 lyric 窗口的 WebviewWindow 实例（可能为 null） */
async function getLyricWin() {
  try {
    const mod = await ensureTauriModules()
    if (!mod.ww) return null
    return mod.ww.getWebviewWindow('lyric')
  } catch (_) {
    return null
  }
}

/** 创建 LogicalSize */
async function makeSize(w, h) {
  const mod = await ensureTauriModules()
  if (!mod.dpi) return null
  return new mod.dpi.LogicalSize(Math.round(w), Math.round(h))
}

/** 创建 LogicalPosition */
async function makePos(x, y) {
  const mod = await ensureTauriModules()
  if (!mod.dpi) return null
  return new mod.dpi.LogicalPosition(Math.round(x), Math.round(y))
}

// ═══════════════════════════════════════════════════════════════
// 桥接初始化：将 Tauri 实现挂载到 window.windowApi
// ═══════════════════════════════════════════════════════════════

export function setupTauriBridge() {
  // 非 Tauri 环境无需初始化（Electron contextBridge 已提供）
  if (!isTauri()) return

  // 直接注册 Tauri 事件监听器（与回调存储解耦）
  ensureTauriListeners()

  // 注意：由于插件模块需要动态 import()，将异步初始化推迟到微任务
  // 同步部分先挂载基本的 invoke 封装，不会阻塞 Vue 挂载
  const api = {
    // ── 窗口控制（纯 invoke，不依赖插件模块） ──
    windowMin: () => invoke('window_min'),
    windowMax: () => invoke('window_max'),
    windowClose: () => invoke('window_close'),
    getWindowMaximizedState: () => invoke('window_is_maximized'),

    // ── 桌面歌词 ──
    createLyricWindow: () => invoke('create_lyric_window'),
    closeLyricWindow: () => invoke('close_lyric_window'),
    isLyricWindowVisible: () => invoke('is_lyric_window_visible'),
    setLyricWindowMovable: (movable) => invoke('set_lyric_window_movable', { movable }),

    // ── 工具函数 ──
    toFileUrl: (filePathOrUrl) => {
      if (!filePathOrUrl || typeof filePathOrUrl !== 'string') return ''
      if (filePathOrUrl.startsWith('file://')) return filePathOrUrl
      const normalized = String(filePathOrUrl).replace(/\\/g, '/')
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) return normalized
      const withLeadingSlash = /^[a-zA-Z]:\//.test(normalized) ? `/${normalized}` : normalized
      const encoded = encodeURI(withLeadingSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
      return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
    },
    copyTxt: (txt) => navigator.clipboard.writeText(txt).catch(() => {}),
    setWindowTile: (title) => {
      try { document.title = title } catch (_) {}
    },

    // ── 播放/事件监听（回调由 ensureTauriListeners 中的 Tauri 事件驱动） ──
    playOrPauseMusic: (callback) => {
      if (typeof callback === 'function') _playPauseCb = callback
    },
    lastOrNextMusic: (callback) => {
      if (typeof callback === 'function') _songControlCb = callback
    },
    changeMusicPlaymode: (callback) => {
      if (typeof callback === 'function') _playmodeCb = callback
    },
    volumeUp: (callback) => {
      if (typeof callback === 'function') _volumeUpCb = callback
    },
    volumeDown: (callback) => {
      if (typeof callback === 'function') _volumeDownCb = callback
    },
    musicProcessControl: (callback) => {
      if (typeof callback === 'function') _processControlCb = callback
    },
    hidePlayer: (callback) => {
      if (typeof callback === 'function') _hidePlayerCb = callback
    },
    onWindowMaximizedChange: (callback) => {
      if (typeof callback === 'function') {
        _windowMaximizedCb = callback
        return () => { _windowMaximizedCb = null }
      }
    },
    updateDockMenu: (songInfo) => {
      if (!isTauri()) return
      if (!songInfo || typeof songInfo !== 'object') {
        invoke('update_dock_menu', { song: null }).catch(() => {})
        return
      }
      const payload = {
        name: String(songInfo.name || ''),
        artist: String(songInfo.artist || ''),
      }
      invoke('update_dock_menu', { song: payload }).catch(() => {})
    },
    updatePlaylistStatus: (_status) => {
      // Tauri 下暂不实现
    },
    changeTrayMusicPlaymode: (_mode) => {
      // Tauri 下后续 Phase 3 实现
    },
    playOrPauseMusicCheck: (_playing) => {
      // Tauri 下暂不实现
    },

    // ── 下载管理（sidecar HTTP API） ──
    _sidecarBase: (function() {
      if (isTauri()) {
        invoke('get_sidecar_url').then(url => { window.__sidecarUrl = url }).catch(() => {})
      }
      return function() { return window.__sidecarUrl || 'http://127.0.0.1:36531' }
    })(),
    _scUrl: function() {
      return window.__sidecarUrl || 'http://127.0.0.1:36531'
    },
    download: (_url) => {
    },
    downloadNext: (callback) => { if (typeof callback === 'function') callback() },
    downloadProgress: (_callback) => {},
    downloadPause: () => {},
    downloadResume: () => {},
    downloadCancel: () => {},
    startDownload: () => {},

    // ── 本地音乐（sidecar HTTP API） ──
    _localMusicCountCb: null,
    _localMusicFilesCb: null,
    localMusicCount: (callback) => {
      api._localMusicCountCb = typeof callback === 'function' ? callback : null
    },
    localMusicFiles: (callback) => {
      api._localMusicFilesCb = typeof callback === 'function' ? callback : null
    },
    scanLocalMusic: async (params) => {
      if (!isTauri()) return
      try {
        const dirPath = params?.type || params?.dirPath || ''
        if (!dirPath) return
        const baseUrl = window.__sidecarUrl || 'http://127.0.0.1:36531'
        const resp = await fetch(`${baseUrl}/local/scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dirPath, recursive: true }),
        })
        const result = await resp.json()
        if (result.files && api._localMusicCountCb) {
          api._localMusicCountCb(null, result.total)
        }
        if (result.files && api._localMusicFilesCb) {
          api._localMusicFilesCb(null, {
            type: params?.type || 'local',
            locaFilesMetadata: result.files,
            dirTree: null,
            count: result.total,
          })
        }
      } catch (_) {}
    },
    getLocalMusicImage: async (filePath) => {
      if (!isTauri()) return Promise.resolve(null)
      try {
        const baseUrl = window.__sidecarUrl || 'http://127.0.0.1:36531'
        const resp = await fetch(`${baseUrl}/local/image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath, size: 400 }),
        })
        if (!resp.ok) return null
        const data = await resp.json()
        return data.data || null
      } catch (_) {
        return null
      }
    },
    getLocalMusicLyric: async (filePath, _options) => {
      if (!isTauri()) return Promise.resolve(null)
      try {
        const baseUrl = window.__sidecarUrl || 'http://127.0.0.1:36531'
        const resp = await fetch(`${baseUrl}/local/lyric`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath }),
        })
        if (!resp.ok) return null
        const data = await resp.json()
        return data.lyric || null
      } catch (_) {
        return null
      }
    },
    openLocalFolder: async (folderPath) => {
      if (!isTauri()) return
      try {
        const { open } = await import('@tauri-apps/plugin-shell')
        open(folderPath)
      } catch (_) {}
    },
    clearLocalMusicData: (_type) => {
    },
    getRequestData: async (request) => {
      if (!isTauri()) return Promise.reject(new Error('getRequestData not available'))
      try {
        const baseUrl = window.__sidecarUrl || 'http://127.0.0.1:36531'
        const resp = await fetch(`${baseUrl}/proxy`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: request.url || request,
            option: request.option || {},
          }),
        })
        if (!resp.ok) throw new Error('Proxy request failed')
        const result = await resp.json()
        return result.data
      } catch (e) {
        throw e
      }
    },

    // ── 设置（tauri-plugin-store 实现） ──
    getSettings: async () => {
      try {
        const store = await getStore('settings')
        if (!store) return DEFAULT_SETTINGS
        const saved = await store.get('settings')
        if (saved) return saved
        await store.set('settings', DEFAULT_SETTINGS)
        await store.save()
        return DEFAULT_SETTINGS
      } catch (_) {
        return DEFAULT_SETTINGS
      }
    },
    setSettings: async (settings) => {
      try {
        const parsed = typeof settings === 'string' ? JSON.parse(settings) : settings
        const store = await getStore('settings')
        if (!store) return
        await store.set('settings', parsed)
        await store.save()
      } catch (_) {}
    },
    getLastPlaylist: async () => {
      try {
        const store = await getStore('lastPlaylist')
        if (!store) return null
        return await store.get('lastPlaylist') || null
      } catch (_) {
        return null
      }
    },
    saveLastPlaylist: async (playlist) => {
      try {
        const store = await getStore('lastPlaylist')
        if (!store) return
        await store.set('lastPlaylist', playlist)
        await store.save()
      } catch (_) {}
    },

    // ── 更新（后续 Phase 5 实现，保留空 operation 保证不报错） ──
    checkUpdate: (_callback) => {},
    manualUpdateAvailable: (_callback) => {},
    updateNotAvailable: (_callback) => {},
    updateDownloadProgress: (_callback) => {},
    updateDownloaded: (_callback) => {},
    updateError: (_callback) => {},
    checkForUpdate: () => {},
    downloadUpdate: () => {},
    installUpdate: () => {},
    cancelUpdate: () => {},

    // ── 对话框（tauri-plugin-dialog 实现） ──
    openFile: async () => {
      try {
        const mod = await ensureTauriModules()
        if (!mod.dialog) return null
        // Settings.vue 用 openFile 选择文件夹，此处默认打开目录选择器
        const result = await mod.dialog.open({
          multiple: false,
          directory: true,
          title: '选择文件夹',
        })
        return result || null
      } catch (_) {
        return null
      }
    },
    toRegister: (url) => {
      if (isTauri()) {
        import('@tauri-apps/plugin-shell').then(mod => mod.open(url)).catch(() => window.open(url, '_blank'))
      } else {
        window.open(url, '_blank')
      }
    },

    // ── 快捷键（tauri-plugin-global-shortcut 实现） ──
    registerShortcuts: async () => {
      if (!isTauri()) return
      try {
        // 从 store 读取快捷键配置
        const settings = await api.getSettings()
        let shortcuts = settings?.shortcuts
        // 未配置快捷键时使用默认值
        if (!shortcuts || !Array.isArray(shortcuts) || shortcuts.length === 0) {
          shortcuts = DEFAULT_SHORTCUTS
        }
        // 转换为 Rust 命令需要的格式
        const configs = shortcuts.map(sc => ({
          id: sc.id,
          name: sc.name || '',
          shortcut: sc.shortcut || null,
          global_shortcut: sc.globalShortcut || null,
          type: !!sc.type,
        }))
        await invoke('register_shortcuts', { shortcuts: configs })
      } catch (_) {
        // ignore
      }
    },
    unregisterShortcuts: () => {
      if (!isTauri()) return
      invoke('unregister_shortcuts').catch(() => {})
    },
  }

  window.windowApi = api

  // 同时暴露 electronAPI 别名（供桌面歌词相关代码使用）
  window.electronAPI = {
    createLyricWindow: api.createLyricWindow,
    closeLyricWindow: api.closeLyricWindow,
    setLyricWindowMovable: api.setLyricWindowMovable,
    isLyricWindowVisible: api.isLyricWindowVisible,

    // 监听歌词数据更新（歌词窗口侧）
    onLyricUpdate: (callback) => {
      if (typeof callback === 'function') {
        listen('lyric-update', (event) => callback(event.payload))
      }
    },
    // 请求当前歌词数据（歌词窗口 → 主窗口）
    requestLyricData: () => emit('request-lyric-data'),
    // 发送歌词数据到歌词窗口（主窗口 → 歌词窗口）
    updateLyricData: (data) => emit('lyric-update', data),
    // 获取当前歌词数据请求（主窗口侧监听）
    getCurrentLyricData: (callback) => {
      if (typeof callback === 'function') {
        listen('request-lyric-data', () => callback())
      }
    },
    // 歌词窗口就绪通知
    lyricWindowReady: () => emit('lyric-window-ready'),

    // ── 歌词窗口操作（通过 Tauri WebviewWindow API 操作 lyric 窗口） ──
    getLyricWindowBounds: async () => {
      try {
        const win = await getLyricWin()
        if (!win) return { x: 0, y: 0, width: 500, height: 350 }
        const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()])
        return { x: pos.x, y: pos.y, width: size.width, height: size.height }
      } catch (_) {
        return { x: 0, y: 0, width: 500, height: 350 }
      }
    },
    getLyricWindowContentBounds: async () => {
      try {
        const win = await getLyricWin()
        if (!win) return { x: 0, y: 0, width: 500, height: 350 }
        const [pos, size] = await Promise.all([win.innerPosition(), win.innerSize()])
        return { x: pos.x, y: pos.y, width: size.width, height: size.height }
      } catch (_) {
        return { x: 0, y: 0, width: 500, height: 350 }
      }
    },
    resizeWindow: async (width, height) => {
      try {
        const win = await getLyricWin()
        const sz = await makeSize(width, height)
        if (win && sz) await win.setSize(sz)
      } catch (_) {}
    },
    moveLyricWindow: async (x, y) => {
      try {
        const win = await getLyricWin()
        const pos = await makePos(x, y)
        if (win && pos) await win.setPosition(pos)
      } catch (_) {}
    },
    moveLyricWindowContentTo: async (x, y, width, height) => {
      try {
        const win = await getLyricWin()
        if (!win) return
        const [pos, sz] = await Promise.all([makePos(x, y), makeSize(width, height)])
        if (pos && sz) await Promise.all([win.setPosition(pos), win.setSize(sz)])
      } catch (_) {}
    },
    setLyricWindowResizable: (resizable) => {
      getLyricWin().then(win => { if (win) win.setResizable(resizable) }).catch(() => {})
    },
    getLyricWindowMinMax: async () => {
      try {
        const win = await getLyricWin()
        if (!win) return { minWidth: 250, minHeight: 100, maxWidth: 500, maxHeight: 800 }
        const [minSize, maxSize] = await Promise.all([win.minSize(), win.maxSize()])
        return {
          minWidth: minSize?.width ?? 250,
          minHeight: minSize?.height ?? 100,
          maxWidth: maxSize?.width ?? 500,
          maxHeight: maxSize?.height ?? 800,
        }
      } catch (_) {
        return { minWidth: 250, minHeight: 100, maxWidth: 500, maxHeight: 800 }
      }
    },
    setLyricWindowMinMax: async (minW, minH, maxW, maxH) => {
      try {
        const win = await getLyricWin()
        if (!win) return
        const [minSz, maxSz] = await Promise.all([makeSize(minW, minH), makeSize(maxW, maxH)])
        if (minSz && maxSz) await Promise.all([win.setMinSize(minSz), win.setMaxSize(maxSz)])
      } catch (_) {}
    },

    // ── 歌词窗口关闭通知（事件通信） ──
    onDesktopLyricClosed: (callback) => {
      if (typeof callback === 'function') {
        listen('desktop-lyric-closed', () => callback())
      }
    },
    notifyLyricWindowClosed: () => emit('desktop-lyric-closed'),
  }

  // playerApi 别名（供 MPRIS/MediaSession 使用，Tauri 下为空存根）
  window.playerApi = {
    sendMetaData: (_metadata) => {},
    onSetPosition: (_callback) => {},
    onNext: (_callback) => {},
    onPrevious: (_callback) => {},
    onPlayPause: (_callback) => {},
    onRepeat: (_callback) => {},
  }
}

// ═══════════════════════════════════════════════════════════════
// 导出命名函数（供逐步替换使用）
// ═══════════════════════════════════════════════════════════════

// 窗口控制
export function windowMin() {
  return isTauri() ? invoke('window_min') : window.windowApi?.windowMin()
}
export function windowMax() {
  return isTauri() ? invoke('window_max') : window.windowApi?.windowMax()
}
export function windowClose() {
  return isTauri() ? invoke('window_close') : window.windowApi?.windowClose()
}
export async function getWindowMaximizedState() {
  return isTauri() ? invoke('window_is_maximized') : window.windowApi?.getWindowMaximizedState()
}
export function onWindowMaximizedChange(callback) {
  if (isTauri()) {
    const unlisten = listen('window-maximized-changed', (event) => callback?.(null, Boolean(event.payload)))
    return () => unlisten.then((fn) => fn())
  }
  return window.windowApi?.onWindowMaximizedChange(callback)
}

// 桌面歌词
export function createLyricWindow() {
  return isTauri() ? invoke('create_lyric_window') : window.electronAPI?.createLyricWindow()
}
export function closeLyricWindow() {
  return isTauri() ? invoke('close_lyric_window') : window.electronAPI?.closeLyricWindow()
}
export function isLyricWindowVisible() {
  return isTauri() ? invoke('is_lyric_window_visible') : window.electronAPI?.isLyricWindowVisible()
}
export function setLyricWindowMovable(movable) {
  return isTauri() ? invoke('set_lyric_window_movable', { movable }) : window.electronAPI?.setLyricWindowMovable(movable)
}

// 事件
export function onEvent(eventName, callback) {
  if (isTauri()) {
    const unlisten = listen(eventName, (event) => callback(event.payload))
    return () => unlisten.then((fn) => fn())
  }
  return () => {}
}
export function emitEvent(eventName, payload) {
  if (isTauri()) return emit(eventName, payload)
}

// 工具
export function setWindowTile(title) {
  if (isTauri()) {
    document.title = title
    return
  }
  return window.windowApi?.setWindowTile(title)
}
export function toFileUrl(filePathOrUrl) {
  if (isTauri()) {
    return _toFileUrlImpl(filePathOrUrl)
  }
  return window.windowApi?.toFileUrl(filePathOrUrl)
}
function _toFileUrlImpl(filePathOrUrl) {
  if (!filePathOrUrl || typeof filePathOrUrl !== 'string') return ''
  if (filePathOrUrl.startsWith('file://')) return filePathOrUrl
  const normalized = String(filePathOrUrl).replace(/\\/g, '/')
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) return normalized
  const withLeadingSlash = /^[a-zA-Z]:\//.test(normalized) ? `/${normalized}` : normalized
  const encoded = encodeURI(withLeadingSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
}
export function copyTxt(txt) {
  if (isTauri()) {
    navigator.clipboard.writeText(txt).catch(() => {})
    return
  }
  return window.windowApi?.copyTxt(txt)
}

// 设置
export async function getSettings() {
  if (isTauri()) {
    try {
      const store = await getStore('settings')
      if (!store) return DEFAULT_SETTINGS
      const saved = await store.get('settings')
      if (saved) return saved
      await store.set('settings', DEFAULT_SETTINGS)
      await store.save()
      return DEFAULT_SETTINGS
    } catch (_) { return DEFAULT_SETTINGS }
  }
  return window.windowApi?.getSettings?.()
}
export async function setSettings(settings) {
  if (isTauri()) {
    try {
      const parsed = typeof settings === 'string' ? JSON.parse(settings) : settings
      const store = await getStore('settings')
      if (!store) return
      await store.set('settings', parsed)
      await store.save()
    } catch (_) {}
    return
  }
  return window.windowApi?.setSettings?.(settings)
}

// 对话框
export async function openFileDialog() {
  if (isTauri()) {
    try {
      const mod = await ensureTauriModules()
      if (!mod.dialog) return null
      return await mod.dialog.open({ multiple: false, directory: true, title: '选择文件夹' }) || null
    } catch (_) { return null }
  }
  return window.windowApi?.openFile?.()
}
