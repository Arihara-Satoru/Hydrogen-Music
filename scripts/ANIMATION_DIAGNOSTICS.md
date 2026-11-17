# 本地动画诊断

普通 `pnpm build` / `pnpm start` 不启用动画诊断。正式打包应用禁止注册相关 IPC，即使设置环境变量也不会开启。

完全退出已运行的播放器（含托盘），然后运行：

```powershell
node scripts/start-animation-diagnostics.cjs
```

命令将诊断前端构建到独立的 `dist-animation-diagnostics` 目录，并启动本地 Electron；无需运行 `pnpm dev`。

窗口内按 `Ctrl+Shift+F9` 开始录制，复现后再次按键，通过原生对话框保存 JSON。取消或保存失败可重试。录制时不要打开开发者工具。

分析报告：

```powershell
node scripts/analyze-animation-recording.mjs <报告路径>
```

报告可能包含本机脚本路径和歌曲 ID，请仅向信任的诊断人员提供。rAF 间隔与 CPU 采样不是 GPU 实际呈现帧的精确测量。
