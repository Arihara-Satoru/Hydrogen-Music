const RECOVERY_KEY = 'hydrogen:chunk-load-recovery'

// 构建会替换带 hash 的资源；仍在运行的旧窗口可能引用已删除的懒加载文件。
// 每个失败资源只刷新一次，真正的文件损坏不能造成无限刷新。
export function installChunkLoadRecovery(target = window) {
  const onPreloadError = event => {
    const message = event.payload?.message
    if (typeof message !== 'string' || !/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) return

    try {
      if (target.sessionStorage.getItem(RECOVERY_KEY) === message) return
      target.sessionStorage.setItem(RECOVERY_KEY, message)
    } catch (_) {
      // 无法保存刷新标记时保留原错误，避免刷新循环。
      return
    }

    event.preventDefault()
    target.location.reload()
  }

  target.addEventListener('vite:preloadError', onPreloadError)
  return () => target.removeEventListener('vite:preloadError', onPreloadError)
}
