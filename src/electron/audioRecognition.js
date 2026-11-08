const { desktopCapturer, ipcMain } = require('electron');

// 采集权限只授予用户主动开启的主窗口、主 frame 和当前应用 URL。
function isRecognitionFrame(win, frame) {
  if (!win || win.isDestroyed() || !frame || frame !== win.webContents.mainFrame) return false;
  try {
    const url = new URL(frame.url);
    const current = new URL(win.webContents.getURL());
    if (url.protocol === 'file:') return url.pathname === current.pathname && /\/dist\/index\.html$/i.test(url.pathname);
    return url.origin === 'http://localhost:5173' || url.origin === 'http://127.0.0.1:5173';
  } catch { return false; }
}

function installAudioRecognition(win) {
  let lease = null;
  const allowed = frame => isRecognitionFrame(win, frame) && lease && Date.now() < lease.until;
  const ses = win.webContents.session;
  const prepare = async (event, source, requestId) => {
    if (event.sender !== win.webContents || !isRecognitionFrame(win, event.senderFrame)) throw new Error('不允许的音频采集请求');
    if (source !== 'system') throw new Error('当前仅支持电脑声音识曲');
    if (typeof requestId !== 'string' || !/^[\w-]{1,64}$/.test(requestId)) throw new Error('无效的采集请求');
    const currentLease = { source, requestId, until: Date.now() + 60000, used: false };
    lease = currentLease;
    return { platform: process.platform };
  };
  const cancel = (event, requestId) => {
    if (event.sender === win.webContents && lease?.requestId === requestId) lease = null;
  };
  ipcMain.handle('audio-recognition:prepare', prepare);
  ipcMain.handle('audio-recognition:cancel', cancel);
  ses.setPermissionCheckHandler((contents, permission, origin, details) => {
    // 不改变已有剪贴板、全屏、媒体播放等权限行为；仅收紧新增的录音/屏幕采集。
    if (!['media', 'display-capture'].includes(permission)) return true;
    if (contents !== win.webContents || !allowed(win.webContents.mainFrame) || details.isMainFrame === false) return false;
    if (permission === 'display-capture') return lease.source === 'system';
    return false;
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!['media', 'display-capture'].includes(permission)) { callback(true); return; }
    const trusted = contents === win.webContents && allowed(win.webContents.mainFrame) && details.isMainFrame !== false;
    callback(Boolean(trusted && ((permission === 'display-capture' && lease.source === 'system')
      // Electron 42 的 getDisplayMedia 先通过 media 请求检查，mediaTypes 为 []，
      // 随后才进入受 frame / 单次授权限制的 DisplayMediaRequestHandler。
      // 非空的 video/audio 仍不能在 system 授权中当作摄像头/麦克风请求放行。
      || (permission === 'media' && lease.source === 'system' && Array.isArray(details.mediaTypes) && details.mediaTypes.length === 0))));
  });
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!allowed(request.frame) || lease.source !== 'system' || lease.used || !request.audioRequested) { callback(null); return; }
    // 消耗一次授权；不允许其他页面/第二个请求沿用这次点击。
    const currentLease = lease;
    currentLease.used = true;
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length || lease !== currentLease || !allowed(request.frame)) { callback(null); return; }
      callback({ video: sources[0], audio: 'loopback' });
    } catch { callback(null); }
  }, { useSystemPicker: false });
  win.once('closed', () => {
    lease = null;
    ipcMain.removeHandler('audio-recognition:prepare');
    ipcMain.removeHandler('audio-recognition:cancel');
    ses.setDisplayMediaRequestHandler(null);
    ses.setPermissionCheckHandler(null);
    ses.setPermissionRequestHandler(null);
  });
}

module.exports = { installAudioRecognition, isRecognitionFrame };
