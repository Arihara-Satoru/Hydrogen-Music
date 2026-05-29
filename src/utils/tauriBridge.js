/**
 * Tauri API 桥接层
 *
 * 提供与 Electron `window.windowApi` 兼容的接口，底层使用 Tauri invoke()。
 * 在 Tauri 环境下使用 @tauri-apps/api 的 invoke/listen 调用 Rust 命令。
 * 在 Electron 环境下回退到 window.windowApi，保障迁移过程中的兼容性。
 *
 * 使用方法：
 *   1. 在 main.js 中调用 setupTauriBridge() 初始化
 *   2. 现有代码中的 windowApi.xxx() 调用自动生效
 *   3. 新代码可 import { xxx } from './tauriBridge'
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, emit } from '@tauri-apps/api/event'

/** 判断当前是否运行在 Tauri 环境 */
const isTauri = () => typeof window !== 'undefined' && window.__TAURI__ !== undefined

// ═══════════════════════════════════════════════════════════════
// 桥接初始化：将 Tauri 实现挂载到 window.windowApi
// ═══════════════════════════════════════════════════════════════

export function setupTauriBridge() {
  // 非 Tauri 环境无需初始化（Electron contextBridge 已提供）
  if (!isTauri()) return

  const api = {
    // ── 窗口控制 ──
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
      try {
        document.title = title
      } catch (_) {}
    },

    // ── 播放/事件监听（注册监听器，返回取消函数） ──
    playOrPauseMusic: (callback) => {
      if (typeof callback === 'function') {
        listen('music-playing-control', () => callback())
      }
    },
    lastOrNextMusic: (callback) => {
      if (typeof callback === 'function') {
        listen('music-song-control', (event) => callback(null, event.payload))
      }
    },
    changeMusicPlaymode: (callback) => {
      if (typeof callback === 'function') {
        listen('music-playmode-control', (event) => callback(null, event.payload))
      }
    },
    volumeUp: (callback) => {
      if (typeof callback === 'function') {
        listen('music-volume-up', () => callback())
      }
    },
    volumeDown: (callback) => {
      if (typeof callback === 'function') {
        listen('music-volume-down', () => callback())
      }
    },
    musicProcessControl: (callback) => {
      if (typeof callback === 'function') {
        listen('music-process-control', (event) => callback(event.payload))
      }
    },
    hidePlayer: (callback) => {
      if (typeof callback === 'function') {
        listen('hide-player', () => callback())
      }
    },
    onWindowMaximizedChange: (callback) => {
      if (typeof callback === 'function') {
        const unlisten = listen('window-maximized-changed', (event) => {
          callback(null, Boolean(event.payload))
        })
        return () => unlisten.then((fn) => fn())
      }
    },
    updateDockMenu: (_songInfo) => {
      // Tauri 下 Dock 菜单暂不实现
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

    // ── 下载管理（后续 Phase 4 sidecar 实现） ──
    download: (_url) => {},
    downloadNext: (callback) => { if (typeof callback === 'function') callback() },
    downloadProgress: (_callback) => {},
    downloadPause: () => {},
    downloadResume: () => {},
    downloadCancel: () => {},
    startDownload: () => {},

    // ── 本地音乐（后续 Phase 4 sidecar 实现） ──
    scanLocalMusic: (_type) => {},
    localMusicFiles: (_callback) => {},
    localMusicCount: (_callback) => {},
    getLocalMusicImage: (_filePath) => Promise.resolve(null),
    getLocalMusicLyric: (_filePath, _options) => Promise.resolve(null),
    openLocalFolder: (_path) => {},
    clearLocalMusicData: (_type) => {},
    getRequestData: (_request) => Promise.reject(new Error('getRequestData not available in Tauri yet')),
    getBiliVideo: (_request) => Promise.reject(new Error('getBiliVideo not available in Tauri yet')),
    musicVideoIsExists: (_obj) => Promise.resolve(false),
    clearUnusedVideo: (_state) => Promise.resolve(null),
    deleteMusicVideo: (_id) => Promise.resolve(null),
    downloadVideoProgress: (_callback) => {},
    cancelDownloadMusicVideo: () => {},

    // ── 设置（后续 Phase 3/4 实现） ──
    getSettings: () => Promise.resolve({
      music: { level: 'high', lyricSize: 17, tlyricSize: 14, rlyricSize: 14, lyricInterlude: 2, searchAssistLimit: 8, showSongTranslation: true, coverSize: 400 },
      local: { downloadFolder: '', localFolder: [] },
      other: { quitApp: 'minimize', enableUpdate: false },
      shortcuts: {}
    }),
    setSettings: (_settings) => {},
    getLastPlaylist: () => Promise.resolve(null),
    saveLastPlaylist: (_playlist) => {},

    // ── 更新（后续 Phase 5 实现） ──
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

    // ── 对话框（后续 Phase 4 实现） ──
    openFile: () => Promise.resolve(null),
    toRegister: (url) => { window.open(url, '_blank') },

    // ── 快捷键（后续 Phase 3 实现） ──
    registerShortcuts: () => {},
    unregisterShortcuts: () => {},
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
    // 发送歌词数据到歌词窗口（主窗口 → 全局，歌词窗口监听 lyric-update）
    updateLyricData: (data) => emit('lyric-update', data),
    // 获取当前歌词数据请求（主窗口侧监听）
    getCurrentLyricData: (callback) => {
      if (typeof callback === 'function') {
        listen('request-lyric-data', () => callback())
      }
    },
    getLyricWindowBounds: () => Promise.resolve({ x: 0, y: 0, width: 500, height: 350 }),
    moveLyricWindow: (_x, _y) => {},
    resizeWindow: (_w, _h) => {},
    lyricWindowReady: () => {},
    onDesktopLyricClosed: () => {},
    notifyLyricWindowClosed: () => {},
    getLyricWindowContentBounds: () => Promise.resolve({ x: 0, y: 0, width: 500, height: 350 }),
    setLyricWindowResizable: () => {},
    getLyricWindowMinMax: () => Promise.resolve({ minWidth: 250, minHeight: 100, maxWidth: 500, maxHeight: 800 }),
    setLyricWindowMinMax: () => {},
    moveLyricWindowContentTo: () => {},
  }

  // playerApi 别名（供 MPRIS/MediaSession 使用）
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
    if (!filePathOrUrl || typeof filePathOrUrl !== 'string') return ''
    if (filePathOrUrl.startsWith('file://')) return filePathOrUrl
    const normalized = String(filePathOrUrl).replace(/\\/g, '/')
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(normalized)) return normalized
    const withLeadingSlash = /^[a-zA-Z]:\//.test(normalized) ? `/${normalized}` : normalized
    const encoded = encodeURI(withLeadingSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
    return encoded.startsWith('/') ? `file://${encoded}` : `file:///${encoded}`
  }
  return window.windowApi?.toFileUrl(filePathOrUrl)
}
export function copyTxt(txt) {
  if (isTauri()) {
    navigator.clipboard.writeText(txt).catch(() => {})
    return
  }
  return window.windowApi?.copyTxt(txt)
}
