export const ONBOARDING_STORAGE_KEY = 'hydrogen:onboarding'
export const ONBOARDING_VERSION = 2

const step = (id, scope, target, title, content, options = {}) => ({
  id: `v2-${id}`, version: 2, scope, target, title, content, ...options,
})

export const ONBOARDING_STEPS = [
  step('home-logo', 'home', '[data-tour="app-logo"]', '返回首页', '点击 Hydrogen 标志可以随时返回首页。'),
  step('home-search', 'home', '[data-tour="search"]', '搜索音乐', '在这里搜索歌曲、歌手、专辑、歌单和视频。'),
  step('home-navigation', 'home', '[data-tour="navigation"]', '页面导航', '切换首页和我的音乐。云盘、私人漫游、塞壬唱片不会弹出引导。'),
  step('home-account', 'home', '[data-tour="account-menu"]', '账号与设置', '头像菜单用于登录或退出账号，并进入应用设置。', { prepare: 'account-menu' }),
  step('home-banner', 'home', '.home-page .banner', '首页推荐', '这里展示活动、资讯和重点推荐内容。'),
  step('home-daily', 'home', '.home-page .recommendation', '每日推荐', '登录后可从这里快速播放每日推荐歌曲。'),
  step('home-newest', 'home', '.home-page .newest-song', '最新歌曲', '这里会展示近期更新的歌曲。'),
  step('home-playlists', 'home', '.home-page .rec-list', '推荐歌单', '向下滚动可以浏览更多分类歌单。'),
  step('widget-cover', 'home', '[data-tour="widget-cover"]', '进入播放主页', '点击当前歌曲封面进入完整播放主页。'),
  step('widget-controls', 'home', '[data-tour="widget-controls"]', '快捷播放控制', '在这里调节音量、切歌、播放或暂停，并操作播放模式、播放列表和歌曲定位。'),

  step('library-sidebar', 'mymusic', '[data-tour="library-sidebar"]', '音乐分类', '在这里切换收藏、下载和本地音乐等分类。'),
  step('library-content', 'mymusic', '[data-tour="library-content"], .library-detail', '音乐内容', '这里显示当前分类、歌单、专辑或歌手的详细内容。'),

  step('search-navigation', 'search', '.search-page .view-control', '搜索导航', '返回、前进并查看当前搜索关键词。'),
  step('search-results', 'search', '.search-page .search-container', '分类搜索结果', '结果按歌曲、专辑、歌手、歌单和视频分类展示。'),
  step('login-entry', 'login', '.login-page .mode-type', '登录账号', '选择登录方式以同步在线音乐库和账号内容。'),
  step('login-content', 'account', '.login-content .login-container', '完成登录', '根据页面提示扫码或输入账号信息完成登录。'),

  step('settings-profile', 'settings', '.settings-user-info', '账号信息', '登录后可在这里查看账号等级、听歌时长和资料，并管理登录状态。'),
  step('settings-device', 'settings', '.settings-device-management', '设备管理', '查看账号登录设备，并让不再使用的设备退出登录。'),
  step('settings-music', 'settings', '[data-tour="settings-music"]', '音乐设置', '配置音质、歌词、封面效果、动态取色和视频功能。'),
  step('settings-local', 'settings', '[data-tour="settings-local"]', '本地与下载', '设置下载目录、本地扫描目录和音乐视频缓存。'),
  step('settings-shortcuts', 'settings', '[data-tour="settings-shortcuts"]', '快捷键', '查看和修改应用快捷键及全局快捷键。'),
  step('settings-other', 'settings', '[data-tour="other-settings"]', '应用设置', '调整主题、字体、页面入口、缓存、更新和退出行为。'),
  step('settings-restart', 'settings', '[data-tour="restart-onboarding"]', '重新查看引导', '点击“重新查看新手引导”会清除所有引导进度；之后进入各页面时会重新介绍。'),

  step('player-cover', 'player', '[data-tour="player-cover"]', '当前歌曲', '封面、歌曲名、歌手、播放进度和基础播放控制集中在这里。'),
  step('player-lyrics', 'player', '[data-tour="player-lyrics"]', '歌词与内容面板', '右侧默认显示滚动歌词，也会切换为评论、电台简介或歌词候选。'),
  step('player-tools', 'player', '[data-tour="player-tools"]', '侧边工具栏', '下面会逐项介绍当前歌曲可用的工具。不同歌曲类型显示的按钮可能不同。'),
  step('player-info', 'player', '.song-info-button', '歌曲信息', '查看歌曲、专辑、歌手以及文件和音质信息。'),
  step('player-video', 'player', '[data-tour="player-video"]', '音乐视频', '为当前歌曲添加或打开音乐视频。'),
  step('player-roma', 'player', '[data-tour="player-roma"]', '罗马音歌词', '显示或隐藏歌词的罗马音。仅支持具有罗马音数据的歌曲。'),
  step('player-translation', 'player', '[data-tour="player-translation"]', '翻译歌词', '显示或隐藏歌词翻译。'),
  step('player-original', 'player', '[data-tour="player-original"]', '原文歌词', '显示或隐藏歌曲原文歌词。'),
  step('player-download', 'player', '[data-tour="player-download"]', '下载歌曲', '将在线歌曲下载到设置的本地目录。'),
  step('player-add-playlist', 'player', '[data-tour="player-add-playlist"]', '加入歌单', '把当前在线歌曲添加到你的歌单。'),
  step('player-chorus', 'player', '.song-control .chorus-toggle', '只听副歌', '开启后会优先播放歌曲副歌片段。'),
  step('player-mode', 'player', '[data-tour="player-mode"]', '播放模式', '在顺序播放、列表循环、单曲循环和随机播放之间切换。'),
  step('player-lyric-select', 'player', '.song-control .lyric-select-icon', '选择歌词', '搜索其他歌词候选并保存更合适的版本。'),
  step('player-comments', 'player', '.song-control .comment-icon', '歌词与评论', '在歌词和歌曲评论之间切换；角标显示评论数量。'),
  step('player-desktop-lyric', 'player', '.song-control .desktop-lyric-btn', '桌面歌词', '打开独立的桌面歌词窗口；首次打开时还有单独引导。'),

  step('desktop-overview', 'desktop-lyric', '[data-tour="desktop-overview"]', '桌面歌词', '独立窗口会同步当前歌曲、歌词、进度和封面。双击歌词区域可以播放或暂停。'),
  step('desktop-rail', 'desktop-lyric', '[data-tour="desktop-rail"]', '窗口状态与拖动', '左侧显示歌词行数和播放状态；未锁定时可从这里拖动窗口。'),
  step('desktop-actions', 'desktop-lyric', '[data-tour="desktop-actions"]', '锁定与设置', '锁定后避免误拖动；设置按钮可切换歌词来源、显示模式和字体大小。'),
  step('desktop-lyrics', 'desktop-lyric', '[data-tour="desktop-lyrics"]', '当前歌词', '这里显示当前句、下一句和句内播放进度。'),
  step('desktop-media', 'desktop-lyric', '[data-tour="desktop-media"]', '封面与播放控制', '悬停封面区域可以切换上一首、播放暂停或下一首。'),
  step('desktop-timeline', 'desktop-lyric', '[data-tour="desktop-timeline"]', '歌曲进度', '拖动底部进度条可以跳转播放位置。'),
]

export const readOnboardingState = (storage) => {
  try {
    const value = JSON.parse(storage?.getItem(ONBOARDING_STORAGE_KEY) || '{}')
    return {
      version: Number(value.version) || 0,
      completedStepIds: Array.isArray(value.completedStepIds)
        ? [...new Set(value.completedStepIds.filter((id) => typeof id === 'string'))]
        : [],
    }
  } catch (_) {
    return { version: 0, completedStepIds: [] }
  }
}

export const getPendingOnboardingSteps = (storage, steps = ONBOARDING_STEPS, scope) => {
  const completed = new Set(readOnboardingState(storage).completedStepIds)
  return steps.filter((item) => (!scope || item.scope === scope) && !completed.has(item.id))
}

export const completeOnboardingSteps = (storage, stepIds, version = ONBOARDING_VERSION) => {
  const state = readOnboardingState(storage)
  const completedStepIds = [...new Set([...state.completedStepIds, ...stepIds])]
  storage?.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ version, completedStepIds }))
}

export const resetOnboarding = (storage) => storage?.removeItem(ONBOARDING_STORAGE_KEY)
