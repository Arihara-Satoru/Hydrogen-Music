const fs = require('node:fs/promises');

async function saveAnimationReport({ event, win, dialog, app, json, writeFile = fs.writeFile }) {
  if (event.sender !== win.webContents) throw new Error('不允许的诊断导出来源');
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > 32 * 1024 * 1024) {
    throw new Error('诊断报告为空或超过 32MB 限制');
  }
  const report = JSON.parse(json);
  if (report.schema !== 1 || !Array.isArray(report.frames) || !Array.isArray(report.events)) {
    throw new Error('诊断报告格式无效');
  }
  const name = `hydrogen-animation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const result = await dialog.showSaveDialog(win, {
    title: '保存动画掉帧诊断报告',
    defaultPath: require('node:path').join(app.getPath('documents'), name),
    filters: [{ name: 'JSON 诊断报告', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeFile(result.filePath, json, 'utf8');
  return { canceled: false, filePath: result.filePath };
}
module.exports = { saveAnimationReport };
