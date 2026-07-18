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

const STATIC_IMPORT_RE = /(?:\brequire\s*\(\s*|\bfrom\s+|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g;

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

function getJavaScriptFiles(sourceDir) {
  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  return fs.readdirSync(sourceDir).filter((file) => file.endsWith('.js'));
}

function buildDirectory(sourceDir, targetDir) {
  const files = getJavaScriptFiles(sourceDir);
  if (files.length === 0) return;

  const entryPoints = files.map((file) => path.join(sourceDir, file));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(targetDir, file)), { recursive: true });
  }

  runEsbuild({
    entryPoints,
    outdir: targetDir,
  });
}

function hasBareDependency(source) {
  STATIC_IMPORT_RE.lastIndex = 0;
  for (const match of source.matchAll(STATIC_IMPORT_RE)) {
    if (!match[1].startsWith('.') && !match[1].startsWith('node:')) return true;
  }
  return false;
}

function buildApiModules(sourceDir, targetDir) {
  const files = getJavaScriptFiles(sourceDir);
  const bundledFiles = [];
  const sharedFiles = [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(sourceDir, file), 'utf8');
    (hasBareDependency(source) ? bundledFiles : sharedFiles).push(file);
  }

  const buildFiles = (selectedFiles, bundle) => {
    if (selectedFiles.length === 0) return;
    runEsbuild({
      entryPoints: selectedFiles.map((file) => path.join(sourceDir, file)),
      outdir: targetDir,
      bundle,
    });
  };

  // ponytail: API modules only use static imports today; switch to esbuild's
  // metafile graph if dynamic package imports are introduced.
  buildFiles(sharedFiles, false);
  buildFiles(bundledFiles, true);
}

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(outRoot, 'util'), { recursive: true });
fs.mkdirSync(path.join(outRoot, 'module'), { recursive: true });

runEsbuild({
  entryPoints: [path.join(apiRoot, 'index.js')],
  outfile: path.join(outRoot, 'app.js'),
});

runEsbuild({
  entryPoints: [path.join(apiRoot, 'main.js')],
  outfile: path.join(outRoot, 'main.js'),
});

buildDirectory(path.join(apiRoot, 'util'), path.join(outRoot, 'util'));
buildApiModules(path.join(apiRoot, 'module'), path.join(outRoot, 'module'));

const moduleFiles = getJavaScriptFiles(path.join(outRoot, 'module'));
const moduleBytes = moduleFiles.reduce(
  (total, file) => total + fs.statSync(path.join(outRoot, 'module', file)).size,
  0,
);
if (moduleBytes > 10 * 1024 * 1024) {
  throw new Error(`KuGou API module output is unexpectedly large: ${(moduleBytes / 1024 / 1024).toFixed(2)} MB`);
}

console.log(
  `[build-kugou-api] KuGouMusicApi runtime completed (${moduleFiles.length} modules, ${(moduleBytes / 1024 / 1024).toFixed(2)} MB)`,
);
