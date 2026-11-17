// 集中登记运行条件；保留旧脚本路径及 package.json 中的单项命令。
export const groups = {
  logic: 'Node 逻辑与模拟依赖回归，不启动桌面窗口',
  source: '源码结构与样式约束，不等于真实界面测试',
  media: 'FFmpeg / 元数据集成，使用合成文件和本地 HTTP 服务',
  build: '构建配置和生产产物检查，按需先构建一次',
  electron: '真实 Electron / Chromium，需桌面环境',
  manual: '需指定安装包或 Git 基线，不纳入自动全量检查'
}

export const profiles = {
  quick: ['logic', 'source'],
  all: ['logic', 'source', 'media', 'build', 'electron']
}

const check = (id, group, title, options = {}) => ({
  id, group, title, file: `check-${id}.${options.extension || 'mjs'}`, ...options
})

export const checks = [
  check('account-social', 'logic', '账号资料、社交及 QQ 会话', { vmModules: true }),
  check('adaptive-loudness', 'logic', '实时响度 DSP 与校准'),
  check('animation-cpu-profiler', 'logic', '动画 CPU 采样生命周期', { extension: 'cjs' }),
  check('animation-report', 'logic', '动画报告保存与校验', { extension: 'cjs' }),
  check('app-update', 'logic', '更新控制器及取消重试', { extension: 'cjs' }),
  check('audio-recognition', 'logic', '识曲采样与权限竞态模拟'),
  check('auto-launch', 'logic', '开机自启控制器模拟', { extension: 'cjs' }),
  check('chorus-feature', 'logic', '副歌片段归一化'),
  check('chunk-load-recovery', 'logic', '懒加载资源失效恢复'),
  check('cloud-api', 'logic', '云盘 API 映射模拟', { vmModules: true }),
  check('comment-api', 'logic', '评论 API 与校验流程模拟', { vmModules: true }),
  check('daily-vip-claim', 'logic', 'VIP 领取、重试及状态模拟', { vmModules: true }),
  check('download-quality', 'logic', '下载音质与状态模拟', { vmModules: true }),
  check('external-links', 'logic', '外部链接安全边界', { extension: 'cjs' }),
  check('favorite-playlist', 'logic', '喜欢歌单及竞态模拟', { vmModules: true }),
  check('fm-cache-cleanup', 'logic', 'FM 近期记录缓存清理'),
  check('global-shortcuts', 'logic', '快捷键默认值、冲突与清理模拟', { extension: 'cjs' }),
  check('kugou-compatibility', 'logic', '酷狗搜索与歌单兼容模拟', { vmModules: true }),
  check('listen-together', 'logic', '一起听响应映射与状态模拟', { vmModules: true }),
  check('listening-features', 'logic', '听歌偏好、黑名单与上报模拟', { vmModules: true }),
  check('login-devices', 'logic', '设备身份与登录设备模拟', { vmModules: true }),
  check('loudness-normalization', 'logic', '响度路由、设置及切歌竞态模拟', { vmModules: true }),
  check('media-session', 'logic', '系统媒体会话与耳机控制模拟', { vmModules: true }),
  check('onboarding', 'logic', '引导步骤与存储状态'),
  check('performance', 'logic', '有界缓存及生命周期约束'),
  check('playback-auth', 'logic', '播放授权链模拟', { vmModules: true }),
  check('playback-keyboard', 'logic', '播放键盘快捷键与焦点模拟'),
  check('playlist-addition', 'logic', '歌单写入、查重与账号切换模拟'),
  check('playlist-cube', 'logic', '歌单立方体状态与源码约束'),
  check('progressive-recognition', 'logic', '渐进识曲调度及降采样'),
  check('purchased-api', 'logic', '已购内容 API 映射模拟', { vmModules: true }),
  check('release-notes', 'logic', '更新日志归一化'),
  check('selected-persistence', 'logic', '持久化白名单及遍历边界'),
  check('selector', 'logic', '下拉框源码与定位逻辑模拟'),
  check('siren-play-all', 'logic', '塞壬播放队列与取消'),
  check('song-selection', 'logic', '歌曲范围选择'),
  check('song-text-interaction', 'logic', '双击播放与原生文字选择'),
  check('splash', 'logic', '启动动画主题及源码约束', { extension: 'cjs' }),
  check('startup-ready', 'logic', '启动就绪通知与超时模拟'),
  check('update-ignore', 'logic', '忽略版本与持久化模拟'),

  check('background-memory', 'source', '后台动画与视频生命周期约束'),
  check('bili-qr-login', 'source', '哔哩哔哩扫码桥接约束'),
  check('comment-panel', 'source', '评论面板源码约束'),
  check('desktop-lyric-window', 'source', '桌面歌词窗口桥接约束'),
  check('foreground-memory', 'source', '前台资源释放约束'),
  check('logic-races', 'source', '异步状态与竞态防护约束'),
  check('lyric-reveal', 'source', '歌词入场动画约束'),
  check('profile-colors', 'source', '账号资料卡主题隔离', { extension: 'cjs' }),
  check('search-typewriter', 'source', '搜索打字机源码约束'),
  check('startup-preview', 'source', '启动动画预览源码约束'),
  check('update-release-notes', 'source', '更新日志布局及滚动约束'),
  check('window-controls', 'source', '窗口按钮点击区域与层级约束'),

  check('cloud-metadata', 'media', '云盘音频标签读取', { extension: 'cjs', requires: ['ffmpeg'] }),
  check('download-metadata', 'media', '下载文件标签写入', { extension: 'cjs', requires: ['ffmpeg'] }),
  check('remote-audio-metadata', 'media', '远程音频头及 Range 缓存', { extension: 'cjs', requires: ['ffmpeg'] }),

  check('build-optimization', 'build', 'Oxc 压缩规则及双入口'),
  check('animation-diagnostic-isolation', 'build', '生产产物不含动画录制器', { extension: 'cjs', needsBuild: true }),
  check('playlist-cube-dist', 'build', '生产 CSS 中的歌单立方体约束', {
    file: 'check-playlist-cube.mjs', args: ['--dist'], needsBuild: true
  }),

  check('default-theme', 'electron', '默认主题真实样式', { extension: 'cjs' }),
  check('fm-cover-animation', 'electron', 'FM 封面入场与中断动画', { extension: 'cjs' }),
  check('fm-theme', 'electron', 'FM 双布局及动态主题', { extension: 'cjs' }),
  check('home-skeleton', 'electron', '首页骨架屏真实渲染', { extension: 'cjs' }),
  check('loudness-audio', 'electron', 'AudioWorklet 生产资源及音频链路', { extension: 'cjs', needsBuild: true }),
  check('loudness-switching', 'electron', '真实 Howler 快速切歌', { extension: 'cjs' }),
  check('player-cover-animation', 'electron', '播放器封面动画与中断恢复', { extension: 'cjs' }),
  check('player-cover-playback', 'electron', '真实播放器切歌、视频与歌词', { extension: 'cjs', timeoutMs: 180000 }),
  check('selector-browser', 'electron', '下拉框真实滚动与定位', { extension: 'cjs' }),
  check('settings-profile-background', 'electron', '资料卡背景覆盖像素检查', { extension: 'cjs' }),
  check('siren-header', 'electron', '塞壬顶栏与外壳切换', { extension: 'cjs' }),

  check('lyric-layout-reuse', 'manual', '歌词测量复用；与当前 Git HEAD 比较', { requires: ['git-head'] }),
  check('packaged-metadata', 'manual', '指定 app.asar 中的元数据依赖', { extension: 'cjs', requires: ['asar'] })
]
