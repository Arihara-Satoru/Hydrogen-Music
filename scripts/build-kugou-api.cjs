#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');

// ═══════════════════════════════════════════════════════════════
// 检测：如果 sidecar 二进制已存在，跳过整个构建流程
// 在 CI 中，预编译的二进制通常由 release.yml 提前下载到该目录
// 如需强制重新编译，删除 src-tauri/binaries/ 下的文件即可
// ═══════════════════════════════════════════════════════════════
const binariesDir = path.join(projectDir, 'src-tauri', 'binaries');
const buildArch = process.argv.includes('--arm64') ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
const ext = process.platform === 'win32' ? '.exe' : '';
const expectedBinary = path.join(binariesDir, `sidecar-server-${buildArch}${ext}`);

if (fs.existsSync(expectedBinary)) {
  const sizeMB = (fs.statSync(expectedBinary).size / 1024 / 1024).toFixed(1);
  console.log(`[build-kugou-api] ✅ Sidecar binary already exists: sidecar-server-${buildArch}${ext} (${sizeMB} MB)`);
  console.log('[build-kugou-api] Skipping full build. Delete the file to force recompile.');
  process.exit(0);
}

const apiCandidates = [
  path.resolve(projectDir, 'KuGouMusicApi'),
  path.resolve(projectDir, '..', 'KuGouMusicApi'),
  path.resolve(projectDir, '..', '..', 'KuGouMusicApi'),
].filter((candidate, index, array) => array.indexOf(candidate) === index);
const apiRoot = apiCandidates.find((candidate) => fs.existsSync(candidate)) || apiCandidates[0];
const outRoot = path.join(apiRoot, 'bin', 'api_js');
const esbuild = require(require.resolve('esbuild', { paths: [apiRoot] }));

function runEsbuild(options) {
  esbuild.buildSync({
    absWorkingDir: apiRoot,
    bundle: true,
    minify: true,
    platform: 'node',
    logLevel: 'info',
    ...options,
  });
}

function buildDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  const files = fs.readdirSync(sourceDir).filter((file) => file.endsWith('.js'));
  if (files.length === 0) {
    return;
  }

  const entryPoints = files.map((file) => path.join(sourceDir, file));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(targetDir, file)), { recursive: true });
  }

  runEsbuild({
    entryPoints,
    outdir: targetDir,
  });
}

fs.mkdirSync(path.join(outRoot, 'util'), { recursive: true });
fs.mkdirSync(path.join(outRoot, 'module'), { recursive: true });

runEsbuild({
  entryPoints: [path.join(apiRoot, 'index.js')],
  outfile: path.join(outRoot, 'app.js'),
});

buildDirectory(path.join(apiRoot, 'util'), path.join(outRoot, 'util'));
buildDirectory(path.join(apiRoot, 'module'), path.join(outRoot, 'module'));

console.log('[build-kugou-api] KuGouMusicApi JS bundle completed');

// ═══════════════════════════════════════════════════════════════
// 步骤 2：单独打包 server.js（供 merged-server.js require 使用）
// ═══════════════════════════════════════════════════════════════

console.log('[build-kugou-api] Bundling server.js separately...');
runEsbuild({
  entryPoints: [path.join(apiRoot, 'server.js')],
  outfile: path.join(outRoot, 'server.js'),
  external: ['./module/*'], // 模块是动态加载的，不打包进来
});
console.log('[build-kugou-api] server.js bundled');

// ═══════════════════════════════════════════════════════════════
// 步骤 3：Bundle 合并后的 sidecar 服务器
// ═══════════════════════════════════════════════════════════════

const hydrogenRoot = path.resolve(__dirname, '..');
const mergedEntry = path.join(hydrogenRoot, 'src-tauri', 'sidecar', 'merged-server.js');
const mergedOut = path.join(outRoot, 'merged-server.js');

if (fs.existsSync(mergedEntry)) {
  console.log('[build-kugou-api] Bundling merged sidecar server...');
  // 先把 merged-server.js 复制到 outRoot 目录下，这样 require('./server') 能正确解析
  const mergedCopy = path.join(outRoot, '_merged-entry.js');
  fs.copyFileSync(mergedEntry, mergedCopy);

  runEsbuild({
    entryPoints: [mergedCopy],
    outfile: mergedOut,
    external: ['sharp'], // 原生模块，由 pkg 单独处理
  });

  // 清理临时文件
  fs.unlinkSync(mergedCopy);

  console.log('[build-kugou-api] Merged sidecar server bundled');
} else {
  console.warn('[build-kugou-api] merged-server.js not found, skipping');
}

// ═══════════════════════════════════════════════════════════════
// 步骤 3：用 pkg 编译 sidecar 为独立二进制
// ═══════════════════════════════════════════════════════════════

const { execSync } = require('child_process');

try {
  const pkgBin = require.resolve('pkg', { paths: [apiRoot] });
  const targetArch = process.argv.includes('--arm64') ? 'node18-win-arm64' : 'node18-win-x64';
  const binariesDir = path.join(hydrogenRoot, 'src-tauri', 'binaries');
  fs.mkdirSync(binariesDir, { recursive: true });

  const mergedJs = path.join(outRoot, 'merged-server.js');
  if (!fs.existsSync(mergedJs)) {
    throw new Error(`merged-server.js not found at ${mergedJs}`);
  }

  console.log(`[build-kugou-api] Compiling sidecar binary (${targetArch})...`);

  // pkg 从 bin/api_js 目录运行，自动读取 package.json 中的 pkg 配置
  const pkgOutputName = path.join(binariesDir, 'sidecar-server' + (process.platform === 'win32' ? '.exe' : ''));
  
  execSync(
    `"node" "${pkgBin}" . -t ${targetArch} -o "${pkgOutputName}"`,
    {
      cwd: outRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_PATH: path.join(apiRoot, 'node_modules'),
      },
    }
  );

  // 重命名以匹配 Tauri sidecar 命名规范
  // Tauri 2.x 期望: sidecar-server-{target-triple}.exe
  const platformTriples = {
    win32: {
      x64: 'x86_64-pc-windows-msvc',
      arm64: 'aarch64-pc-windows-msvc',
    },
    linux: {
      x64: 'x86_64-unknown-linux-gnu',
      arm64: 'aarch64-unknown-linux-gnu',
    },
    darwin: {
      x64: 'x86_64-apple-darwin',
      arm64: 'aarch64-apple-darwin',
    },
  };

  const os = process.platform;
  const arch = process.argv.includes('--arm64') ? 'arm64' : 'x64';
  const triple = platformTriples[os]?.[arch] || `${arch}-${os}`;
  const ext = os === 'win32' ? '.exe' : '';

  const rawOutput = pkgOutputName;
  const tauriName = `sidecar-server-${triple}${ext}`;
  const tauriOutput = path.join(binariesDir, tauriName);

  if (fs.existsSync(rawOutput)) {
    if (rawOutput !== tauriOutput) {
      // 删除旧的 Tauri 命名文件（如果存在）
      if (fs.existsSync(tauriOutput)) {
        fs.unlinkSync(tauriOutput);
        console.log(`[build-kugou-api] Removed old binary: ${tauriName}`);
      }
      fs.renameSync(rawOutput, tauriOutput);
    }
    const sizeMB = (fs.statSync(tauriOutput).size / 1024 / 1024).toFixed(1);
    console.log(`[build-kugou-api] ✅ Sidecar binary created: ${tauriName} (${sizeMB} MB)`);
  } else if (fs.existsSync(tauriOutput)) {
    const sizeMB = (fs.statSync(tauriOutput).size / 1024 / 1024).toFixed(1);
    console.log(`[build-kugou-api] ✅ Sidecar binary exists: ${tauriName} (${sizeMB} MB)`);
  } else {
    console.error(`[build-kugou-api] ❌ pkg output not found at ${rawOutput}`);
    console.error(`[build-kugou-api]    Also checked: ${tauriOutput}`);
  }
} catch (err) {
  console.error('[build-kugou-api] ❌ Failed to compile sidecar binary:', err.message);
  console.log('[build-kugou-api] You can still run the app in dev mode with "npm run tauri:dev"');
}
