#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');
const config = require(path.join(projectDir, 'electron-builder.config.cjs'));
const workflow = fs.readFileSync(path.join(projectDir, '.github/workflows/release.yml'), 'utf8');

assert.deepEqual(config.mac.target, ['dmg']);
assert.deepEqual(
  config.linux.target.map(({ target }) => target),
  ['AppImage', 'deb', 'rpm'],
);

for (const expected of [
  'windows-latest',
  'macos-latest',
  'macos-15-intel',
  'ubuntu-latest',
  '--win',
  '--mac',
  '--linux',
  'release/*.dmg',
  'release/*.AppImage',
  'release/*.deb',
  'release/*.rpm',
  'gh release upload',
]) {
  assert.ok(workflow.includes(expected), `release workflow is missing ${expected}`);
}

console.log('Platform build configuration check passed');
