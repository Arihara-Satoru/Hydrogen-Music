<p align="center">
  <img src="img/icon.png" width="96" alt="Hydrogen Music 图标" />
</p>

<h1 align="center">Hydrogen Music · 酷狗概念版</h1>

<p align="center">
  一款基于 Electron 与 Vue 构建的跨平台音乐播放器<br />
  在 Hydrogen Music 原有体验上，接入酷狗概念版相关能力
</p>

<p align="center">
  <a href="#-功能特性">功能特性</a> ·
  <a href="#-界面展示">界面展示</a> ·
  <a href="#%EF%B8%8F-下载安装">下载安装</a> ·
  <a href="#-本地开发">本地开发</a>
</p>

![Hydrogen Music 首页](img/首页展示.png)

## 项目说明

本项目基于 [Hydrogen-Music](https://github.com/ldx123000/Hydrogen-Music) 修改而来。感谢原作者的创意与付出。

本项目将主要后端能力切换至 [**酷狗概念版**](https://github.com/MakcRe/KuGouMusicApi)，并在原有设计基础上继续完善播放、漫游、桌面歌词、音乐视频等功能。

这不是原版功能的完整迁移：部分能力已经完成适配，部分能力受现有接口限制只能提供有限支持。如原作者认为本项目存在不妥之处，请联系仓库维护者处理。

## 🌟 功能特性

- **账号与曲库**：支持酷狗账号登录，推荐使用酷狗 APP 扫码登录；支持歌曲、歌单、专辑、歌手与 MV 等内容
- **播放与歌词**：支持歌曲播放、歌词展示、歌曲下载及歌词/评论面板切换
- **听歌识曲**：顶部搜索旁可识别麦克风或电脑声音，支持结果播放、收藏、搜索与本地识别记录；系统内录能力依操作系统而定
- **云盘音乐**：支持读取、上传、删除、播放和下载云盘歌曲
- **私人漫游**：接入酷狗私人 FM，支持推荐模式切换、喜欢、不喜欢与上一首/下一首操作
- **一起听**：支持众乐房与自习室的房间发现、创建、房间号加入、同步收听、成员和聊天；众乐房支持点歌与房主管理
- **塞壬唱片**：内置 Monster Siren 音乐专区，支持专辑浏览、搜索、播放与深浅色模式
- **音乐视频**：支持音乐视频背景及沉浸式播放界面
- **桌面歌词**：支持拖动、锁定、尺寸调整、当前/下一句显示和歌词来源切换，并提供完整与精简两种界面
- **电台与频道**：支持收听已收藏的电台节目
- **外观设置**：支持浅色/深色主题，以及跟随歌曲封面变化的界面背景
- **快捷键**：支持自定义应用内快捷键与全局快捷键
- **启动与更新**：提供五种可选启动动画，并支持应用更新检查与版本提示
- **跨平台安装**：提供 Windows、macOS（Apple Silicon/Intel）和 Linux x64 安装包

## ⚠️ 当前限制

- **云盘**：酷狗概念版后端暂未提供云盘详情接口
- **评论**：目前以浏览为主，暂不支持发送、回复、点赞等互动操作
- **收藏**：专辑收藏、收藏专辑列表等部分能力暂未开放
- **歌单**：部分旧版歌单编辑与操作能力尚未适配
- **音频后端**：HiFi 输出与 MPV 后端暂未移植
- **旧后端**：旧版网易云相关能力不再作为主要后端维护

### 一起听使用说明

登录酷狗概念版账号后，点击顶部 **一起听**，选择众乐房或自习室。可以浏览推荐房间、输入房间号加入，或从当前酷狗播放队列选择歌曲创建房间。公开众乐房需要关联频道；可搜索频道后点击“在此创建”。

- 加入后切换页面仍会同步收听，点击“一起听”可返回房间。房主通过底部播放器控制众乐房，听众可单独暂停自己的收听。
- 离开后恢复个人队列并保持暂停；网络异常时可重试离开，或使用“断开本地连接”。
- 房间状态通过 HTTP 定期同步，存在数秒延迟。歌曲仍受当前账号播放权限限制；房间返回加密 KGS 地址时，使用已有账号授权音源接口解析同一首歌曲。
- 自习室按当前后端能力提供配置、歌单、成员、聊天和跟随播放，暂不提供后端尚未实现的自习室点歌操作。

相关检查：`npm run check:listen-together`。

### 听歌识曲使用说明

点击顶部搜索旁的 **识曲**，选择 **电脑声音** 或 **麦克风 / 音频输入**，再点击 **开始识别**。采用渐进式识曲：约 3 秒开始尝试，无匹配时继续聆听，在约 6 秒、最多约 10 秒时使用更长片段识别；找到候选后提前停止，不必每次等满 10 秒。这不是服务端流式识别，也不保证 3 秒出结果。

一次连续采集最多约 10 秒，同时最多一个请求、总计最多三次；慢请求会跳过过期阶段，整次渐进识别（采集开始后）最多等待约 30 秒。网络错误或限流会明确报错，不会被当成无匹配连续重试。连续采样能力不可用时，会明确提示改用完整片段识别，不改变音频来源。

打开面板不会自动录音；取消或关闭会停止后续采集及请求。期间可能多次上传累计音频片段至酷狗，累计上传量可能超过单次 10 秒音频；已发送的音频无法撤回。应用不将原始录音写入本地文件，也不保存或上传屏幕画面；最近识别记录仅保存歌曲信息，可手动清空。

- **Windows**：电脑声音使用系统回环采集；麦克风需要系统允许桌面应用访问。
- **macOS**：首次使用需允许麦克风、屏幕 / 系统音频录制。macOS 14.2 及以上使用系统音频权限；旧版本的内录能力受限，可在麦克风页选择虚拟声卡。开发模式下权限可能属于启动 Electron 的终端或 IDE。
- **Linux**：系统内录取决于桌面、PipeWire / PulseAudio 和设备配置；未获取音频时可在麦克风页选择可见的监听输入或虚拟声卡，不会自动偷偷切换录音来源。
- 请让待识别音乐单独播放，避免播放器自身或其他音频干扰。识别不支持离线，也不保证哼唱、翻唱或变速片段的匹配；结果播放仍受账号权限限制。
- 三平台共用界面与采样流程，**系统内录尚需不同平台实机反馈验证**。报告问题时请附应用版本、系统版本、音频来源、设备及错误提示，不要公开录音或账号凭据。

相关检查：`npm run check:audio-recognition`。

渐进策略曾使用官方公开音源的 `Renegade`（0 秒、30 秒起点）和 `Radiant`（30 秒起点）分别测试 3 / 6 / 10 秒 PCM，首个候选均返回对应歌曲；构建后的 Windows Electron 连续采样链路也曾用 `Radiant` 的 3 秒片段完成真实接口识别。这是少量清晰音源验证，**不代表麦克风环境、噪声场景的识别率，也不代表 macOS/Linux 已完成实机验证**。

## 🖼️ 界面展示

### 播放与评论

<table>
  <tr>
    <td width="50%" align="center"><img src="img/播放界面.png" alt="播放界面" /><br /><sub>播放与歌词界面</sub></td>
    <td width="50%" align="center"><img src="img/查看评论界面.png" alt="查看评论界面" /><br /><sub>歌曲评论浏览</sub></td>
  </tr>
</table>

### 私人漫游

<table>
  <tr>
    <td width="50%" align="center"><img src="img/私人漫游浅色模式.png" alt="私人漫游浅色模式" /><br /><sub>浅色模式</sub></td>
    <td width="50%" align="center"><img src="img/私人漫游深色模式.png" alt="私人漫游深色模式" /><br /><sub>深色模式</sub></td>
  </tr>
</table>

### 塞壬唱片

<table>
  <tr>
    <td width="50%" align="center"><img src="img/塞壬唱片浅色模式.png" alt="塞壬唱片浅色模式" /><br /><sub>专辑列表 · 浅色模式</sub></td>
    <td width="50%" align="center"><img src="img/塞壬唱片深色模式.png" alt="塞壬唱片深色模式" /><br /><sub>专辑列表 · 深色模式</sub></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><img src="img/塞壬唱片专辑界面.png" alt="塞壬唱片专辑界面" /><br /><sub>专辑详情与曲目列表</sub></td>
  </tr>
</table>

### 音乐视频

<table>
  <tr>
    <td width="50%" align="center"><img src="img/音乐视频模式1.png" alt="音乐视频模式一" /><br /><sub>沉浸模式</sub></td>
    <td width="50%" align="center"><img src="img/音乐视频模式2.png" alt="音乐视频模式二" /><br /><sub>歌词模式</sub></td>
  </tr>
</table>

### 桌面歌词

<table>
  <tr>
    <td width="60%" align="center"><img src="img/桌面歌词.png" alt="桌面歌词" /><br /><sub>完整模式</sub></td>
    <td width="40%" align="center"><img src="img/桌面歌词精简模式.png" alt="桌面歌词精简模式" /><br /><sub>精简模式</sub></td>
  </tr>
</table>

<details>
  <summary><strong>查看更多：主题、快捷键、启动动画与更新提示</strong></summary>
  <br />
  <p align="center"><img src="img/深色界面展示.png" alt="深色界面展示" /><br /><sub>深色主题</sub></p>
  <p align="center"><img src="img/可自定义全局快捷键.png" alt="可自定义全局快捷键" /><br /><sub>应用内与全局快捷键</sub></p>
  <p align="center"><img src="img/5种启动动画.png" alt="五种启动动画选项" /><br /><sub>五种启动动画可选</sub></p>
  <p align="center"><img src="img/启动动画其一.png" alt="启动动画示例" /><br /><sub>启动动画示例</sub></p>
  <p align="center"><img src="img/更新提示.png" alt="应用更新提示" /><br /><sub>应用更新提示</sub></p>
</details>

## 📦️ 下载安装

前往 [Releases](https://github.com/Arihara-Satoru/Hydrogen-Music/releases) 下载对应平台的安装包：

- **Windows**：`.exe` 安装包、便携版或 `.zip`
- **macOS**：Apple Silicon（arm64）或 Intel（x64）的 `.dmg`
- **Linux x64**：`.AppImage`、`.deb` 或 `.rpm`

> macOS 安装包目前未使用 Apple Developer 证书签名，首次启动时可能需要在“系统设置 → 隐私与安全性”中确认打开。

## 🧑‍💻 本地开发

```shell
# 安装依赖
pnpm install

# 启动 Vue 开发服务
pnpm run dev

# 启动 Electron 客户端（请另开一个终端）
pnpm start
```

## 👷 打包客户端

```shell
# 在当前系统打包对应平台
pnpm run dist

# 也可以显式指定目标；macOS 包仍需在 macOS 上生成
pnpm run dist -- --win
pnpm run dist -- --mac
pnpm run dist -- --linux
```

## 📜 开源许可

本项目仅供个人学习与研究使用，禁止用于商业及非法用途。

项目基于 [MIT License](https://opensource.org/licenses/MIT) 开源。使用本项目时，请同时遵守相关平台的服务条款及所在地法律法规。

## 致谢

- [Kaidesuyo/Hydrogen-Music](https://github.com/Kaidesuyo/Hydrogen-Music)和[ldx123000/Hydrogen-Music](https://github.com/ldx123000/Hydrogen-Music) — 原始项目
- [MakcRe/KuGouMusicApi](https://github.com/MakcRe/KuGouMusicApi) — 感谢该仓库提供的后端项目
- [OpenAI Codex](https://openai.com/codex/) — 感谢 Codex 在项目开发与完善过程中提供的协助
- [Brandon030722/ark-ui-skill](https://github.com/Brandon030722/ark-ui-skill) — 感谢该 Skill 仓库提供的界面设计灵感与工作流参考
- README 中的音乐视频示例取自哔哩哔哩视频 [BV1rTs3zyEPF](https://www.bilibili.com/video/BV1rTs3zyEPF)
- 感谢所有参与维护、测试和反馈的贡献者
