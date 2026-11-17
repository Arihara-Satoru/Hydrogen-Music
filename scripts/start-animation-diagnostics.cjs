const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = { ...process.env, VITE_ANIMATION_DIAGNOSTICS: '1', HYDROGEN_ANIMATION_DIAGNOSTICS: '1' };
delete env.ELECTRON_RUN_AS_NODE;
// 使用独立构建目录，避免诊断构建污染正式 dist；不需要 Vite 开发服务器。
const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
const build = spawnSync(process.execPath, [viteCli, 'build', '--outDir', 'dist-animation-diagnostics'], {
  cwd: root, env, stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status || 1);
const child = spawn(require('electron'), [root, '--hydrogen-animation-diagnostics'], { cwd: root, env, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
