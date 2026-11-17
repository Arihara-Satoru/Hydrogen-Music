// Read the OS setting rather than persisting a second, potentially stale preference.
function createAutoLaunchController(app, platform = process.platform) {
  const supported = app.isPackaged && ['win32', 'darwin'].includes(platform);
  const options = () => platform === 'win32' ? { path: process.execPath, args: [] } : {};
  const getState = () => {
    if (!supported) return { supported: false, enabled: false, reason: app.isPackaged ? '当前平台暂不支持开机自启' : '安装正式版后可设置开机自启' };
    try {
      const settings = app.getLoginItemSettings(options());
      return { supported: true, enabled: Boolean(settings.openAtLogin) && settings.executableWillLaunchAtLogin !== false };
    } catch (_) {
      return { supported: false, enabled: false, reason: '无法读取系统自启设置' };
    }
  };
  return {
    getState,
    setEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new TypeError('开机自启参数必须为布尔值');
      if (!supported) return getState();
      app.setLoginItemSettings({ ...options(), openAtLogin: enabled });
      const state = getState();
      if (!state.supported || state.enabled !== enabled) throw new Error('系统未应用开机自启设置，请检查系统启动项权限');
      return state;
    },
  };
}

module.exports = { createAutoLaunchController };
