# 响度均衡实现说明

本文说明 MoeKoeMusic 中响度均衡（响度归一化）的数据来源、API 请求、播放增益算法，以及 Hydrogen-Music 当前接入链路的状态。这里的“响度均衡”指播放时按曲目调整增益，不会改写或转码音频文件。

## 结论

- 酷狗 `/song/url` 的成功响应在实测中包含 `volume`、`volume_gain`、`volume_peak`。这几个字段没有出现在 KuGouMusicApi 的 `/song/url` 文档参数说明中；它们是上游播放地址响应里的可选数据，不是请求参数，也不是稳定的 API 契约。
- MoeKoeMusic 前端读取这些响应字段，并通过 Web Audio `GainNode` 改变播放增益；它没有在客户端扫描音频样本来计算 LUFS。
- Hydrogen-Music 当前 API 代理可以透传字段，但前端 `src/api/song.js` 只保留 URL、音质、采样率、码率、位深和文件大小，尚未传递响度数据。主播放器使用 Howler 的 HTML5 音频路径，也尚未应用每首歌的响度增益。
- 因此当前项目不需要新增一个酷狗响度 API；需要补齐前端元数据传递、播放链路增益处理和一个设置入口。字段缺失时必须保持单位增益，不能用默认值把所有歌固定衰减约 14 dB。

## 1. 数据流

```text
GET /register/dev
       │ 返回 dfid（设备标识）
       ▼
GET /song/url?hash=...&quality=...
       │ 上游酷狗播放地址响应（可能含响度字段）
       ▼
本地 KuGouMusicApi 代理透传响应
       ▼
前端解析 URL、音质和响度元数据
       ▼
播放器按用户音量 × 曲目归一化增益播放
```

响度字段来自播放地址响应。`/register/dev` 是请求设备注册步骤，用于获取 `dfid`，本身不计算响度。KuGouMusicApi 的 `/song/url` 处理器将请求发往酷狗 `/v5/url`，并返回其响应；实现中没有本地响度分析或补算。

## 2. 接口说明

### 2.1 获取设备标识

```http
GET <API_BASE>/register/dev
```

实测返回结构：

```json
{
  "status": 1,
  "error_code": 0,
  "data": {
    "dfid": "<DFID>"
  }
}
```

后续请求通过 `Authorization` 头携带设备 Cookie：

```http
Authorization: dfid=<DFID>
```

本地桌面项目的 API base URL 当前配置为 `http://127.0.0.1:36530`，实际端口应以运行时配置为准。接口文档也提示，在请求播放地址前需要先调用 `/register/dev`，否则可能触发验证。

### 2.2 获取播放地址与响度字段

```http
GET <API_BASE>/song/url?hash=<HASH>&quality=<QUALITY>&album_audio_id=<ALBUM_AUDIO_ID>
Authorization: dfid=<DFID>
```

常用参数：

| 参数 | 说明 | 是否必需 |
|---|---|---|
| `hash` | 歌曲或音质对应的文件 Hash | 是 |
| `quality` | 音质，如 `128`、`320`、`flac` | 否，按接口默认值处理 |
| `album_audio_id` | 专辑音频 ID，部分歌曲需要 | 否 |
| `ppage_id` | 来源页面标识，行为取决于 API 的平台配置 | 否 |
| `free_part` | 请求试听部分；部分版权曲目需要此参数才能返回试听地址 | 否 |

`volume`、`volume_gain` 和 `volume_peak` 是响应字段，不是请求参数。接口文档没有为它们定义完整语义或保证每首歌都会返回。

### 2.3 成功响应示例

以下是字段结构示例，播放 URL 已省略：

```json
{
  "status": 1,
  "url": ["<PLAY_URL>"],
  "volume": -9.9,
  "volume_gain": 0,
  "volume_peak": 0.6,
  "bitRate": 128000
}
```

字段解释需区分“上游定义”和“MoeKoeMusic 的用法”：

| 字段 | 类型 | MoeKoeMusic 按代码注释采用的含义 | 注意事项 |
|---|---:|---|---|
| `volume` | number | 曲目综合响度，按 LUFS 参与目标响度计算 | KuGouMusicApi 文档没有正式定义单位 |
| `volume_gain` | number | 额外建议增益，按 dB 加入计算 | 是否已包含某种响度补偿，接口文档未说明 |
| `volume_peak` | number | 线性峰值，用于削波保护 | 不要先假设它一定在 `0..1`；此前另一个成功响应实测过 `1.6` |

### 2.4 状态与权限

本次测试观察到：

- `status=1` 且有 `url`：成功拿到播放地址，检查响度字段才有意义。
- `status=2` 且 `fail_process` 包含 `pkg`、`buy`：该音质受购买或会员权限限制。这类失败响应没有 URL，也可能没有响度字段；字段缺失不能据此判定该歌曲在成功响应中也没有响度数据。
- 不带有效设备标识时可能触发“需要验证”错误；先调用 `/register/dev` 可满足本次接口所需的设备注册步骤。

## 3. 本次四组接口实测

测试地址为本机运行的 `http://127.0.0.1:36530`。每组先通过 `/register/dev` 取得设备标识，再请求 `/song/url`。结果如下：

| 音质 / 请求差异 | 不带 `free_part=1` | 添加 `free_part=1` 后 | `volume` | `volume_gain` | `volume_peak` |
|---|---|---|---:|---:|---:|
| `flac`，Hash `41A3FF4831B85CB5D205C57E0A402747`，带 `ppage_id` | `status=2`，`pkg/buy` | `status=1`，有 URL | -9.9 | 0 | 0.6 |
| `320`，Hash `0FDF8333572D9BD87270BCC221F2A5D7` | `status=2`，`pkg/buy` | `status=1`，有 URL | -9.9 | 0 | 0.6 |
| `320`，同一 Hash，带 `ppage_id` | `status=2`，`pkg/buy` | `status=1`，有 URL | -9.9 | 0 | 0.6 |
| `128`，Hash `3B92EB6F7A2583AE370B0D13B1ECCDE6` | `status=2`，`pkg/buy` | `status=1`，有 URL | -9.9 | 0 | 0.6 |

添加 `free_part=1` 后拿到的是试听地址。以上结果证明这四组成功试听响应含有响度字段；它不能证明完整音质播放响应始终提供这些字段，也不能替代其他歌曲和音质的覆盖验证。

可复现的请求形式：

```http
GET <API_BASE>/song/url?ppage_id=356753938&quality=flac&hash=41A3FF4831B85CB5D205C57E0A402747&album_audio_id=700095538&free_part=1
GET <API_BASE>/song/url?quality=320&hash=0FDF8333572D9BD87270BCC221F2A5D7&album_audio_id=700095538&free_part=1
GET <API_BASE>/song/url?ppage_id=356753938&quality=320&hash=0FDF8333572D9BD87270BCC221F2A5D7&album_audio_id=700095538&free_part=1
GET <API_BASE>/song/url?quality=128&hash=3B92EB6F7A2583AE370B0D13B1ECCDE6&album_audio_id=700095538&free_part=1
```

## 4. MoeKoeMusic 的响度处理

### 4.1 元数据提取

歌曲队列在取得 `/song/url` 响应后，从响应中读取 `volume`、`volume_gain`、`volume_peak` 并附到歌曲对象上。然后播放器在歌曲切换时把该对象交给响度控制器。

参考代码：

- [OnlineMusicQueue.js：映射响度响应字段](https://github.com/MoeKoeMusic/MoeKoeMusic/blob/main/src/components/player/songQueue/OnlineMusicQueue.js#L210-L229)
- [PlayerControl.vue：切歌时应用响度数据](https://github.com/MoeKoeMusic/MoeKoeMusic/blob/main/src/components/PlayerControl.vue#L885-L900)

### 4.2 增益计算

参考实现把目标响度硬编码为 `-14`，用 Web Audio 的 `GainNode` 调节线性增益：

```text
响度差 dB = 目标响度 - volume
线性增益 = 10 ^ (响度差 dB / 20)
若 volume_gain 非零，再乘以 10 ^ (volume_gain / 20)
若 volume_peak × 线性增益 > 0.95，则把增益限制为 0.95 / volume_peak
最后把增益限制在 0.01 到 3.0
```

对本次四组试听数据，按参考算法计算：

```text
目标响度差 = -14 - (-9.9) = -4.1 dB
线性增益 = 10 ^ (-4.1 / 20) ≈ 0.624
归一化后峰值 = 0.6 × 0.624 ≈ 0.374
```

该样本的峰值未触发 `0.95` 削波限制。用户音量和响度补偿应保持为两个独立的乘数：

```text
最终播放增益 = 用户音量 × 曲目响度增益
```

参考代码：[AudioController.js：响度计算及峰值保护](https://github.com/MoeKoeMusic/MoeKoeMusic/blob/main/src/components/player/AudioController.js#L66-L132)。

### 4.3 音频处理链

MoeKoeMusic 创建 `AudioContext`，将媒体元素连接到 `GainNode`，再连接到输出设备。它只在用户启用功能、首次播放时初始化，并在播放前恢复被浏览器挂起的 `AudioContext`。代码里没有按 PCM 样本实时测量 LUFS 的流程，因此上游元数据缺失时，客户端无法凭这段逻辑自己获得真实响度。

## 5. 缺失字段与算法风险

MoeKoeMusic 当前队列代码使用了以下默认值：

```js
volume: response.volume || 0,
volumeGain: response.volume_gain || 0,
volumePeak: response.volume_peak || 1
```

这组默认值有风险。如果响应没有响度字段，算法仍可能把 `volume=0` 当成真实响度，并按 `-14 - 0 = -14 dB` 计算，导致没有元数据的歌曲统一衰减到约 `0.20` 倍线性增益。它不是“跳过归一化”的中性行为。

建议的缺失值处理：

1. 把响度元数据整体表示为可选值；缺少任一必需字段或数值无效时，标记为“无数据”。
2. “无数据”时使用 `gain=1.0`，仅按用户音量正常播放。
3. 只对数值有限且通过范围检查的数据执行增益计算；错误时回退到 `gain=1.0`。
4. 对 `volume_gain` 的语义做实测确认，避免它本身已经是目标补偿时再重复叠加。
5. 元数据按实际播放的音质响应绑定；不要把一种音质的响度数据误用到另一个不同母带或编码版本上。

## 6. Hydrogen-Music 当前接入状态

### 已有能力

- 播放 URL 请求走本机酷狗 API，base URL 在 `src/utils/request.js` 中配置。
- `src/utils/musicUrlResolver.js` 已按音质尝试 `/song/url`，并在必要时尝试 `ppage_id` 与 `/song/url/new` 降级路径。
- 播放器使用 Howler，并在主要流媒体 `Howl` 初始化时设置 `html5: true`。项目也有 `webAudioGapless.js`，但这不代表普通在线流媒体已经接入逐曲响度增益。

### 尚未接通的环节

- `src/api/song.js` 的 `extractStreamMeta()` 当前只提取采样率、码率、位深和文件大小；`getMusicUrl()` 返回对象没有 `volume`、`volume_gain`、`volume_peak`，所以响度响应数据会在前端适配层丢失。
- `src/utils/musicUrlResolver.js` 会把适配后的播放信息继续传给播放器，但当前信息中没有响度结构。
- `src/utils/player.js` 的主在线播放使用 Howler HTML5 音频路径；目前没有独立的每曲增益节点，也没有归一化设置持久化。
- 本次源码检索没有找到现成的响度均衡设置项。若要让用户自行开启/关闭，需要在现有设置页添加一个最小开关；这会增加可见控件，但不需要改变页面视觉风格。

相关本地代码：

- [src/api/song.js：播放响应提取](../src/api/song.js#L102-L232)
- [src/utils/musicUrlResolver.js：音质与 URL 解析](../src/utils/musicUrlResolver.js#L122-L222)
- [src/utils/player.js：主在线播放器](../src/utils/player.js#L1661-L1830)
- [src/utils/request.js：本地 API 地址及请求头](../src/utils/request.js#L14-L90)

## 7. 建议的本地接入顺序

1. 在 API 适配层把三项字段作为可选响度元数据原样保留；不要把它们和码率、采样率混为一类。
2. 在歌曲/预加载对象中随 URL 一同传递元数据，确保正常播放、预加载、切歌和刷新播放地址时都使用同一首歌对应的数据。
3. 为在线播放实现单独的响度增益层，并与用户音量、淡入淡出、静音及音量滑块解耦；测试 Electron/Chromium 的 CORS 与媒体播放兼容性。
4. 增益计算使用经过验证的元数据；无数据或接口失败时保持 `1.0`，并确保响度层不会覆盖用户音量。
5. 在现有设置页增加一个默认关闭的开关，并持久化设置。若当前需求不允许增加任何可见控件，则不应默认启用这项功能。
6. 对 `/song/url` 成功响应、字段缺失、字段异常、`status=2` 权限失败、`/song/url/new` 返回结构、音质切换和歌曲切换分别验证。

由于 API 没有正式承诺响度字段的定义与覆盖率，建议把该功能标记为“上游数据可用时生效”，而不是宣称所有歌曲都能标准化。

## 参考资料

- [MoeKoeMusic：歌曲队列中的响度字段](https://github.com/MoeKoeMusic/MoeKoeMusic/blob/main/src/components/player/songQueue/OnlineMusicQueue.js)
- [MoeKoeMusic：AudioController 增益处理](https://github.com/MoeKoeMusic/MoeKoeMusic/blob/main/src/components/player/AudioController.js)
- [KuGouMusicApi：`/song/url` 文档](https://github.com/MakcRe/KuGouMusicApi/blob/main/docs/README.md#L1520-L1572)（描述请求参数及设备注册要求，未定义响度响应字段）
- [KuGouMusicApi：`/song/url` 上游请求实现](https://github.com/MakcRe/KuGouMusicApi/blob/main/module/song_url.js)（请求酷狗 `/v5/url` 并透传响应）
