import { createApp } from 'vue'
import App from './App.vue'
import router from './router/router.js'
import pinia from './store/pinia'
import lazy from './utils/lazy'
import { MotionPlugin } from 'motion-v'
import './assets/css/style.css'
import './assets/css/reset.css'
import './assets/css/common.css'
import './assets/css/fonts.css'
import './assets/css/theme.css'
import { initTheme } from './utils/theme'
import { setupTauriBridge } from './utils/tauriBridge'

// 初始化 Tauri API 桥接层（替换 Electron contextBridge 的 windowApi）
setupTauriBridge()

const app = createApp(App)
app.use(router)
app.use(pinia)
app.use(MotionPlugin)
app.directive('lazy', lazy)
// Initialize theme before app renders
initTheme()
app.mount('#app')

// 懒加载初始化逻辑，减小首屏包体
;(async () => {
  try {
    const { init } = await import('./utils/initApp')
    init()
  } catch (_) {}
})()

// 延迟到空闲时再注册 MediaSession，避免阻塞首屏
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 500))
// Tauri 环境下不注册 MediaSession（由 WebView 原生处理）
const isTauriEnv = typeof window !== 'undefined' && window.__TAURI__ !== undefined
if (!isTauriEnv && window.process?.platform !== 'win32') {
  idle(async () => {
    try {
      const { initMediaSession } = await import('./utils/mediaSession')
      initMediaSession()
    } catch (_) {}
  })
}

// Prevent default browser file open on drag/drop globally
window.addEventListener('dragover', (e) => {
  e.preventDefault()
})
window.addEventListener('drop', (e) => {
  e.preventDefault()
})
