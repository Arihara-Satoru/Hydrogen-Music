/**
 * windowApi Stub - 在非 Electron 环境下提供 windowApi 降级实现；Tauri 覆盖已迁移能力
 * 避免因 windowApi 未定义导致 ReferenceError 崩溃（白屏）
 */
import { getTauriElectronApi, getTauriPlayerApi, getTauriWindowApi } from './tauriWindowApi.mjs'

(function () {
  if (typeof windowApi !== "undefined") return;

  const noop = () => {};
  const noopPromise = () => Promise.resolve();
  const noopResolve = (val) => () => Promise.resolve(val);

  const fallbackApi = {
    // ── 窗口控制 ──
    windowMin: noop,
    windowMax: noop,
    windowClose: noop,
    getWindowMaximizedState: noopResolve(false),
    onWindowMaximizedChange: noop,

    // ── 播放控制（注册回调）──
    playOrPauseMusic: noop,
    playOrPauseMusicCheck: noop,
    lastOrNextMusic: noop,
    changeMusicPlaymode: noop,
    changeTrayMusicPlaymode: noop,
    volumeUp: noop,
    volumeDown: noop,
    musicProcessControl: noop,
    hidePlayer: noop,
    syncWindowsTaskbarPlaybackState: noop,

    // ── 设置 ──
    getSettings: noopResolve({
      music: {
        level: "high",
        lyricSize: 28,
        tlyricSize: 22,
        rlyricSize: 22,
        lyricInterlude: 4,
        searchAssistLimit: 8,
        showSongTranslation: true,
        audioVisualizer: false,
        loudnessNormalization: false,
        autoPlayOnStartup: false,
        pauseOnOtherAudio: false,
        coverSize: 400,
      },
      local: {
        downloadFolder: "",
        localFolder: [],
      },
      other: {
        quitApp: "minimize",
        globalShortcuts: true,
        enableUpdate: false,
        startupAnimation: "ark",
      },
      shortcuts: [
        { id: "play", name: "播放/暂停", shortcut: "CommandOrControl+P", globalShortcut: "CommandOrControl+Alt+P" },
        { id: "last", name: "上一首", shortcut: "CommandOrControl+Left", globalShortcut: "CommandOrControl+Alt+Left" },
        { id: "next", name: "下一首", shortcut: "CommandOrControl+Right", globalShortcut: "CommandOrControl+Alt+Right" },
        { id: "volumeUp", name: "增加音量", shortcut: "CommandOrControl+Up", globalShortcut: "CommandOrControl+Alt+Up" },
        { id: "volumeDown", name: "减少音量", shortcut: "CommandOrControl+Down", globalShortcut: "CommandOrControl+Alt+Down" },
        { id: "processForward", name: "快进(3s)", shortcut: "CommandOrControl+]", globalShortcut: "CommandOrControl+Alt+]" },
        { id: "processBack", name: "后退(3s)", shortcut: "CommandOrControl+[", globalShortcut: "CommandOrControl+Alt+[" },
      ],
    }),
    setSettings: noop,
    getSystemFonts: noopResolve([]),
    getOtherAudioMonitorState: noopResolve({
      supported: false,
      active: false,
    }),
    onOtherAudioStateChanged: () => noop,

    // ── 本地音乐 / 文件 ──
    scanLocalMusic: noop,
    localMusicFiles: noop,
    localMusicCount: noop,
    getLocalMusicFileHash: noopResolve(""),
    rememberLocalMusicHashTrack: noopResolve(false),
    getLocalMusicHashTracks: noopResolve({}),
    clearLocalMusicData: noop,
    openLocalFolder: noop,
    openDirectory: noopResolve(""),
    openFile: noopResolve(""),
    toFileUrl: (path) => path || "",
    getLocalMusicImage: noopResolve(""),
    getCloudMusicMetadata: noopResolve(null),
    getCoverPalette: noopResolve(null),
    getLocalMusicLyric: noopResolve(""),

    // ── 歌单 ──
    getLastPlaylist: noopResolve(null),
    saveLastPlaylist: noop,
    saveLastPlaybackProgress: noop,

    // ── 更新 ──
    checkUpdate: noop,
    manualUpdateAvailable: noop,
    updateNotAvailable: noop,
    updateDownloadProgress: noop,
    updateDownloaded: noop,
    updateError: noop,
    waitForKugouApiReady: noopResolve({ ready: true }),
    checkForUpdate: noop,
    downloadUpdate: noop,
    installUpdate: noop,
    cancelUpdate: noop,

    // ── 下载 ──
    startDownload: noop,
    download: noop,
    downloadNext: noop,
    downloadProgress: noop,
    downloadPause: noop,
    downloadResume: noop,
    downloadCancel: noop,

    // ── 菜单 / Dock ──
    setWindowTile: noop,
    updatePlaylistStatus: noop,
    updateDockMenu: noop,

    // ── 视频 ──
    musicVideoIsExists: noopResolve(false),
    getMusicVideoPool: noopResolve({ videos: [] }),
    addMusicVideoPoolFiles: noopResolve({
      canceled: true,
      addedCount: 0,
      videos: [],
    }),
    removeMusicVideoPoolFile: noopResolve({ videos: [] }),
    clearMusicVideoPool: noopResolve({ videos: [] }),
    clearUnusedVideo: noopResolve([]),
    deleteMusicVideo: noop,
    downloadVideoProgress: noop,
    cancelDownloadMusicVideo: noop,

    // ── 登录 / 外部链接 ──
    toRegister: noop,
    copyTxt: noop,

    // ── 快捷键 ──
    registerShortcuts: noop,
    unregisterShortcuts: noop,

    // ── MediaSession / MPRIS ──
    sendMetaData: noop,
    sendPlayerCurrentTrackTime: noop,
    beforeQuit: noop,
    exitApp: noop,

    // ── 杂项 ──
    lyricControl: noop,
    getRequestData: noopResolve(null),
    getBiliVideo: noopResolve(null),

    // ── 数据重置 ──
    clearAllCacheData: noopResolve({ success: false, error: "Not in Electron" }),
    resetAllData: noopResolve({ success: false, error: "Not in Electron" }),
    onResetLocalStorage: noop,
  };
  Object.assign(fallbackApi, getTauriWindowApi(fallbackApi));
  window.windowApi = fallbackApi;
  const tauriElectronApi = getTauriElectronApi();
  const tauriPlayerApi = getTauriPlayerApi();

  // 桌面歌词尚未迁移时保留完整方法形状，避免初始化阶段直接白屏
  if (typeof window.electronAPI === "undefined") {
    window.electronAPI = tauriElectronApi || {
      createLyricWindow: noopResolve({ success: false }),
      closeLyricWindow: noopResolve({ success: false }),
      setLyricWindowMovable: noopPromise,
      lyricWindowReady: noop,
      onLyricUpdate: noop,
      requestLyricData: noop,
      updateLyricData: noop,
      seekDesktopLyric: noopPromise,
      controlDesktopLyricPlayback: noopPromise,
      getCurrentLyricData: noop,
      isLyricWindowVisible: noopResolve(false),
      onDesktopLyricClosed: noop,
      getLyricWindowBounds: noopResolve(null),
      resizeWindow: noopPromise,
      moveLyricWindowContentTo: noop,
      setLyricWindowResizable: noop,
      getLyricWindowMinMax: noopResolve(null),
      setLyricWindowMinMax: noopPromise,
      getLyricWindowContentBounds: noopResolve(null),
      notifyLyricWindowClosed: noop,
    };
  }
  if (typeof window.playerApi === "undefined") {
    window.playerApi = tauriPlayerApi || {
      onSetPosition: noop,
      onPlayPause: noop,
      onNext: noop,
      onPrevious: noop,
      onPlayM: noop,
      onPauseM: noop,
      onRepeat: noop,
      onShuffle: noop,
      sendMetaData: noop,
      sendPlayerCurrentTrackTime: noop,
      setVolume: noop,
      onVolumeChanged: noop,
    };
  }
  if (typeof window.process === "undefined") {
    window.process = { platform: "browser" };
  }
})();
