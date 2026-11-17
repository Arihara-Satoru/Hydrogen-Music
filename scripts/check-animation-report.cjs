const assert = require('node:assert/strict');
const { saveAnimationReport } = require('../src/electron/animationReport.cjs');
(async () => {
  const sender = {};
  const json = JSON.stringify({ schema: 1, frames: [], events: [] });
  const writes = [];
  const args = { event: { sender }, win: { webContents: sender }, json,
    app: { getPath: () => process.cwd() },
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: 'report.json' }) },
    writeFile: async (...values) => writes.push(values) };
  assert.deepEqual(await saveAnimationReport(args), { canceled: false, filePath: 'report.json' });
  assert.deepEqual(writes, [['report.json', json, 'utf8']]);
  args.dialog.showSaveDialog = async () => ({ canceled: true });
  assert.deepEqual(await saveAnimationReport(args), { canceled: true });
  assert.equal(writes.length, 1);
  args.dialog.showSaveDialog = async () => ({ canceled: false, filePath: 'report.json' });
  await assert.rejects(saveAnimationReport({ ...args, writeFile: async () => { throw Error('disk full'); } }), /disk full/);
  await assert.rejects(saveAnimationReport({ ...args, event: { sender: {} } }), /来源/);
  await assert.rejects(saveAnimationReport({ ...args, json: '{}' }), /格式/);
  console.log('Native animation report save checks passed: success, cancel, write failure, sender and schema validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
