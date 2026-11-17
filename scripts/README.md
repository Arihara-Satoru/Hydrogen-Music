# 检查脚本与开发工具

## 日常只需记住这些命令

```shell
# 默认：运行检查入口的自测，再跑快速检查（不启动 Electron、不写入 dist）
pnpm test

# 快速回归：Node 逻辑 + 源码结构约束
pnpm check:quick

# 列出所有检查、中文说明及前置条件；不执行检查、不构建
pnpm check:list

# 完整自动回归：quick + 媒体 + 构建产物 + Electron
pnpm check:all

# 只跑指定项；ID 见 check:list，多个 ID 用逗号分隔
pnpm check --only listen-together,media-session

# 遇到第一个未通过项就停止（默认继续，最后汇总）
pnpm check:all --fail-fast
```

快速不代表只做静态扫描：也运行模拟依赖下的业务逻辑和 DSP 测试，耗时随机器变化。完整检查会启动隔离的 Electron 窗口/本地 Vite 服务，部分脚本会保存 `output/` 下的诊断图片和记录。

## 分组及前置条件

当前登记 **73 个检查脚本、74 个执行项**：歌单立方体分别提供源码和生产 CSS 两种检查方式。快速组共 54 项；完整自动组共 72 项，另有 2 项手动检查。准确清单以 `pnpm check:list` 为准。

| 命令 | 分组 | 内容与条件 |
| --- | --- | --- |
| `pnpm check:logic` | `logic` | Node 逻辑、模拟 API/IPC、Vue 状态和部分源码约束；需要 VM 模块的项目自动带启动参数 |
| `pnpm check:source` | `source` | 读取源码，验证样式、桥接、生命周期等约束；**不等于真实 UI 测试或内存分析** |
| `pnpm check:media` | `media` | FFmpeg 合成音频、元数据读写、本地 HTTP/Range 服务；需已安装 `ffmpeg-static` 二进制及 `sharp` 等依赖 |
| `pnpm check:artifacts` | `build` | 压缩配置、生产包诊断隔离、生产 CSS；按需先执行一次前端构建 |
| `pnpm check:electron` | `electron` | 真正运行 Chromium 的样式、像素、动画、播放器和音频检查；需可执行的 Electron 及桌面环境 |
| `pnpm check --only <ID>` | 按登记项选择 | 运行原先未提供 `package.json` 单项命令的脚本也可用这个入口 |
| `pnpm check:runner` | 入口自测 | 检查登记完整性、分组、参数、构建复用、失败汇总、超时与取消 |

`pnpm check` 无参数等同于 `check:quick`；`pnpm check --help` 查看完整参数。所有原有 `check:*` 单项命令和 `bench:playlist` 保持原样；**旧单项命令直接调用脚本，不经过新的前置检查或自动构建**。

### 构建产物

`all`、`build`、`electron` 或单项选择中，只要遇到需要 `dist` 的检查，入口就先调用当前 Node 运行 Vite CLI。本轮最多构建一次；不启动酷狗后端、不生成桌面安装包，但会像 `pnpm build` 一样更新 `dist/`。

如果已经构建过，并确认产物与源码一致，可以显式复用：

```shell
pnpm check:artifacts --no-build
pnpm check:electron --no-build
```

`--no-build` 只检查入口和 AudioWorklet 等基础产物是否存在，**不判断是否过期**。缺少资源或构建失败会报告未通过，不会悄悄跳过并显示成功。`check:build` 仍是原来的压缩规则单项检查；整个构建组叫 `check:artifacts`，避免破坏旧命令。

### Electron 与系统环境

- 请先完成 `pnpm install`，确保 Electron / FFmpeg 二进制已下载；不要用 `--ignore-scripts` 建立全新测试环境。
- Windows/macOS 需要可用桌面会话。Linux 无显示器环境需准备 Electron 系统依赖并通过 Xvfb 等提供显示服务，例如 `xvfb-run -a pnpm check:electron`。此轮整理只在 Windows 验证，跨平台仍需实机确认。
- 各项**串行执行**，避免同时启动多个 Chromium 抢占资源。`selector-browser` 目前使用固定端口 **5179**，其他进程占用时会明确失败。
- 子进程自动清除 `ELECTRON_RUN_AS_NODE`，并使用参数数组启动，不依赖不同 shell 的引号和路径转义。
- 普通项默认超时 60 秒，Electron 默认 120 秒，较长的播放器集成为 180 秒。超时及 Ctrl+C 会终止本入口启动的进程树，不关闭用户已有的播放器或开发服务。
- API 名称带有“模拟”的检查不验证远程接口可用性。声音采集权限、耳机事件、显卡性能及不同操作系统仍需手动验证。

## 不纳入自动全量的两项检查

这两项不是可以直接删除的废脚本，而是需要额外上下文：

```shell
# 指定已打包的 app.asar，检查 music-metadata / file-type 的实际依赖版本
pnpm check --only packaged-metadata --asar "release/win-unpacked/resources/app.asar"

# 核对歌词测量复用，同时比较工作区与当前 Git HEAD 的模板、样式和入场动画
pnpm check --only lyric-layout-reuse
```

- `packaged-metadata` 还被桌面打包配置作为 hook 引用，保持 `scripts/check-packaged-metadata.cjs` 路径和导出不变。
- `lyric-layout-reuse` 适合检查特定局部优化。模板或样式的正常修改也会触发差异；工作区无差异时，HEAD 对比本身不能证明没有回归。
- `pnpm check:all` **不包含 `manual` 组**，也不验证任意历史安装包。列表里会显示它们，完整执行结束也会提醒。

## 文件组织与维护规则

```text
scripts/
├─ run-checks.mjs                 # 统一 CLI
├─ checks/
│  ├─ catalog.mjs                # 检查 ID、分组、中文说明、启动方式和前置条件
│  ├─ runner.mjs                 # 选择、串行调度、自动构建、超时和汇总
│  └─ runner.test.mjs            # 使用 Node 自带测试运行器，不引入新测试框架
├─ check-*.mjs / check-*.cjs      # 原有具体检查，保留路径和独立运行方式
├─ fixtures/                     # UI 检查所用页面
├─ build*.js / build*.cjs        # 构建/打包工具，不属于回归检查
├─ release-build.cjs             # 发版工具，不由 check:all 调用
├─ set-console-encoding.cjs      # 终端编码工具
├─ start-animation-diagnostics.cjs
└─ analyze-animation-recording.mjs
```

本次采取**集中登记、逻辑分组**而非批量搬文件：现有脚本普遍使用相对路径读源码，文档、包命令和打包 hook 也引用旧路径。没有为了目录整齐破坏这些调用，也没有合并或删除尚未证明重复的断言。

新增检查时：

1. 添加 `check-<功能>.mjs/cjs`，使用合成数据或显式 mock，避免操作真实账号和个人媒体库。
2. 在 `checks/catalog.mjs` 登记说明和分组；需要 VM 模块标记 `vmModules`，需要产物标记 `needsBuild`，特殊条件写入 `requires`。
3. 通过 `pnpm check --only <ID>` 验证；再运行 `pnpm check:runner`。漏登记、重复 ID、无效路径会直接报错。
4. 优先断言行为而不是某一行源码写法；改动现有实现后，要同步检查 mock 是否仍对应当前接口。
5. 只要新增项登记到自动分组，即进入对应组和 `check:all`，不必再添加一个 `package.json` 命令。需人工参数的项放 `manual` 并记录原因。

结果状态：`passed` 通过、`failed` 子进程非零/启动失败、`blocked` 缺条件或构建失败、`timeout` 超时、`cancelled` 取消。任何未通过或未运行都会使本轮返回非零退出码；Ctrl+C 返回 130。程序默认保留每项原始输出，再显示中文汇总。

目前没有自动修改发布工作流：是否把某一组设置为发版门槛应另行决定。临时诊断数据、截图和基准输出放在已忽略的 `output/`，不要混入源代码或测试目录。

动画录制与报告分析见 [ANIMATION_DIAGNOSTICS.md](ANIMATION_DIAGNOSTICS.md)。
