// 外壳状态由路由和已有播放器显示状态决定，不依赖页面是否仍留在 DOM 中。
export function resolveAppShellLayout(routeName, widgetState) {
    const sirenRoute = routeName === 'siren' || routeName === 'sirenAlbum'
    return {
        siren: Boolean(widgetState && sirenRoute),
        fullWindow: sirenRoute || routeName === 'personalfm',
    }
}
