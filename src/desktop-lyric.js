import { createApp } from 'vue'
import DesktopLyric from './components/DesktopLyric.vue'
import './assets/css/common.css'
import './assets/css/fonts.css'
import './assets/css/theme.css'
import { initTheme, setTheme } from './utils/theme'
import { setupTauriBridge } from './utils/tauriBridge'

// 初始化 Tauri API 桥接层（仅在 Tauri 歌词窗口中生效）
setupTauriBridge()

const app = createApp(DesktopLyric)
app.mount('#desktop-lyric-app')

// Initialize theme for desktop lyric window
initTheme()

// Sync theme when settings change in main window (localStorage storage event)
window.addEventListener('storage', (e) => {
  if (e && e.key === 'theme') {
    const mode = e.newValue || 'system'
    setTheme(mode)
  }
})

// 通知主窗口歌词窗口已就绪
const notifyReady = () => {
  if (window.electronAPI?.lyricWindowReady) {
    window.electronAPI.lyricWindowReady()
  } else {
    // 兜底：通过事件系统通知
    const emit = window.__TAURI__?.event?.emit
    if (emit) emit('lyric-window-ready', {})
  }
}
notifyReady()
