const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { animationDiagnosticsAllowed } = require('../src/electron/animationDiagnosticGate.cjs');
assert.equal(animationDiagnosticsAllowed({ isPackaged: true }, { HYDROGEN_ANIMATION_DIAGNOSTICS: '1' }), false);
assert.equal(animationDiagnosticsAllowed({ isPackaged: false }, {}), false);
assert.equal(animationDiagnosticsAllowed({ isPackaged: false }, { HYDROGEN_ANIMATION_DIAGNOSTICS: '1' }), true);
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]); }
const bundles = files(path.resolve(__dirname, '../dist')).filter(f => f.endsWith('.js'));
for (const file of bundles) {
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(!text.includes('__hydrogenAnimationRecorder'), `No recorder runtime in production: ${file}`);
  assert.ok(!text.includes('正在录制帧与 CPU'), `No recorder UI in production: ${file}`);
}
const preload = fs.readFileSync(path.resolve(__dirname, '../src/electron/preload.js'), 'utf8');
assert.match(preload, /process\.argv\.includes\('--hydrogen-animation-diagnostics'\)/);
console.log('Diagnostic isolation passed: packaged app hard-disabled, local opt-in, production bundles contain no recorder runtime.');
