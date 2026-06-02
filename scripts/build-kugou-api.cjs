#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
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
// 步骤 2：Bundle 合并后的 sidecar 服务器
// ═══════════════════════════════════════════════════════════════

const hydrogenRoot = path.resolve(__dirname, '..');
const mergedEntry = path.join(hydrogenRoot, 'src-tauri', 'sidecar', 'merged-server.js');
const mergedOut = path.join(outRoot, 'merged-server.js');

if (fs.existsSync(mergedEntry)) {
  console.log('[build-kugou-api] Bundling merged sidecar server...');
  runEsbuild({
    entryPoints: [mergedEntry],
    outfile: mergedOut,
    external: ['sharp'], // 原生模块，由 pkg 单独处理
  });
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

  // pkg 需要从项目根目录运行以便正确解析 node_modules 中的原生模块
  execSync(
    `"node" "${pkgBin}" "${mergedJs}" ` +
    `-t ${targetArch} ` +
    `--scripts "${outRoot}/module/*.js" ` +
    `--scripts "${outRoot}/util/*.js" ` +
    `--assets "${outRoot}/public/**" ` +
    `--assets "${outRoot}/docs/**" ` +
    `-o "${path.join(binariesDir, 'sidecar-server')}"`,
    {
      cwd: apiRoot,
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

  const rawOutput = path.join(binariesDir, `sidecar-server${ext}`);
  const tauriName = `sidecar-server-${triple}${ext}`;
  const tauriOutput = path.join(binariesDir, tauriName);

  if (fs.existsSync(rawOutput)) {
    // 删除旧的同名文件（如果有）
    if (fs.existsSync(tauriOutput) && rawOutput !== tauriOutput) {
      fs.unlinkSync(tauriOutput);
    }
    fs.renameSync(rawOutput, tauriOutput);
    console.log(`[build-kugou-api] ✅ Sidecar binary created: ${tauriName}`);
  } else {
    // pkg 可能已经直接输出了正确名字
    if (fs.existsSync(tauriOutput)) {
      console.log(`[build-kugou-api] ✅ Sidecar binary exists: ${tauriName}`);
    } else {
      console.error(`[build-kugou-api] ❌ pkg output not found at ${rawOutput} or ${tauriOutput}`);
    }
  }
} catch (err) {
  console.error('[build-kugou-api] ❌ Failed to compile sidecar binary:', err.message);
  console.log('[build-kugou-api] You can still run the app in dev mode with "npm run tauri:dev"');
}
