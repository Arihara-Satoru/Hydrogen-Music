#!/usr/bin/env node
/**
 * Hydrogen Music — 便携版打包脚本
 *
 * 在 `tauri build` 完成后，将编译好的程序打包成解压即用的 zip。
 * 运行方式：node scripts/build-portable.cjs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const targetDir = path.join(projectRoot, 'src-tauri', 'target', 'release');
const sidecarDir = path.join(projectRoot, 'src-tauri', 'binaries');
const outputDir = path.join(projectRoot, 'dist_portable');

// 从 tauri.conf.json 读取版本号
const tauriConf = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'src-tauri', 'tauri.conf.json'), 'utf-8')
);
const version = tauriConf.version || '0.5.9';
const productName = tauriConf.productName || 'Hydrogen Music';

// 目标 triple（Windows x64）
const targetTriple = 'x86_64-pc-windows-msvc';

function main() {
  console.log(`[build-portable] 开始打包便携版 v${version}...`);

  // 1. 查找编译好的主程序
  const mainExe = path.join(targetDir, 'hydrogen-music.exe');
  if (!fs.existsSync(mainExe)) {
    console.error(`[build-portable] ❌ 未找到主程序: ${mainExe}`);
    console.error('[build-portable] 请先运行 npm run tauri:build');
    process.exit(1);
  }
  console.log(`[build-portable] ✅ 找到主程序: ${mainExe}`);

  // 2. 查找 sidecar 二进制
  const sidecarFile = `sidecar-server-${targetTriple}.exe`;
  const sidecarExe = path.join(sidecarDir, sidecarFile);
  if (!fs.existsSync(sidecarExe)) {
    console.error(`[build-portable] ❌ 未找到 sidecar: ${sidecarExe}`);
    process.exit(1);
  }
  console.log(`[build-portable] ✅ 找到 sidecar: ${sidecarExe}`);

  // 3. 创建临时打包目录
  const pkgDir = path.join(outputDir, `${productName}`);
  fs.mkdirSync(pkgDir, { recursive: true });

  // 4. 复制文件
  const destMainExe = path.join(pkgDir, `${productName}.exe`);
  const destSidecarDir = path.join(pkgDir, 'binaries');
  const destSidecarExe = path.join(destSidecarDir, `sidecar-server-${targetTriple}.exe`);

  fs.copyFileSync(mainExe, destMainExe);
  fs.mkdirSync(destSidecarDir, { recursive: true });
  fs.copyFileSync(sidecarExe, destSidecarExe);

  console.log(`[build-portable] 📦 文件已复制到临时目录`);

  // 5. 创建启动说明
  const readmeContent = `# ${productName} v${version} 便携版

## 使用方法
1. 解压到任意目录
2. 运行 ${productName}.exe

## 注意
- 首次启动可能需要稍等片刻（sidecar 后端启动）
- 程序会在同级目录生成配置文件
- 如需卸载，直接删除整个文件夹即可
`;
  fs.writeFileSync(path.join(pkgDir, 'README.txt'), readmeContent, 'utf-8');

  // 6. 打包为 zip
  const zipName = `${productName}.${version}.portable.zip`;
  const zipPath = path.join(outputDir, zipName);

  // 使用 PowerShell 的 Compress-Archive 打包
  try {
    console.log(`[build-portable] 🔨 正在打包为 ${zipName} ...`);
    execSync(
      `powershell -Command "Compress-Archive -Path '${pkgDir}' -DestinationPath '${zipPath}' -Force"`,
      { stdio: 'pipe' }
    );
    console.log(`[build-portable] ✅ 便携版打包完成!`);
    console.log(`[build-portable] 📁 ${zipPath}`);
  } catch (err) {
    console.error(`[build-portable] ❌ 打包失败:`, err.message);
    process.exit(1);
  }

  // 7. 清理临时目录
  fs.rmSync(pkgDir, { recursive: true, force: true });

  // 8. 显示文件大小
  const stats = fs.statSync(zipPath);
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`[build-portable] 💾 文件大小: ${sizeMB} MB`);
}

main();
