// CDP CPU sampling, not tracing/screenshots: captures JS call stacks without changing animation timing.
function createAnimationCpuProfiler(webContents) {
  let attached = false;
  let running = false;
  let timer = null;
  let cached = null;
  let pendingStop = null;
  async function stop() {
    if (pendingStop) return pendingStop;
    if (!running) return cached;
    running = false;
    clearTimeout(timer);
    pendingStop = (async () => {
      try {
        const { profile } = await webContents.debugger.sendCommand('Profiler.stop');
        cached = { profile, stoppedAt: Date.now() };
      } catch (error) {
        cached = { error: String(error.message || error) };
      } finally {
        if (attached && webContents.debugger.isAttached()) webContents.debugger.detach();
        attached = false;
        pendingStop = null;
      }
      return cached;
    })();
    return pendingStop;
  }
  async function start() {
    await stop();
    cached = null;
    if (webContents.debugger.isAttached()) return { error: '调试器已被占用；请关闭开发者工具后重试录制' };
    try {
      webContents.debugger.attach('1.3');
      attached = true;
      await webContents.debugger.sendCommand('Profiler.enable');
      await webContents.debugger.sendCommand('Profiler.setSamplingInterval', { interval: 2000 });
      await webContents.debugger.sendCommand('Profiler.start');
      running = true;
      timer = setTimeout(() => { void stop(); }, 125000);
      return { startedAt: Date.now(), intervalUs: 2000 };
    } catch (error) {
      if (attached && webContents.debugger.isAttached()) webContents.debugger.detach();
      attached = false;
      return { error: String(error.message || error) };
    }
  }
  webContents.once('destroyed', () => { clearTimeout(timer); running = false; });
  return { start, stop };
}
module.exports = { createAnimationCpuProfiler };
