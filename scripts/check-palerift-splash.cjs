const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const splash = fs.readFileSync(path.join(root, "splash-palerift.html"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.config.cjs"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/views/Settings.vue"), "utf8");
const ipc = fs.readFileSync(path.join(root, "src/electron/ipcMain.js"), "utf8");

assert.equal([...splash.matchAll(/<script>([\s\S]*?)<\/script>/g)].length, 1);
assert.match(splash, /<canvas id="scene"/);
assert.doesNotMatch(splash, /<img\b|<svg\b|src\/assets|HYDROGEN MUSIC|\blogo\b/i);
assert.doesNotMatch(splash, /https?:\/\/|<link\b/);
assert.match(splash, /prefers-reduced-motion: reduce/);
assert.match(splash, /role="progressbar"/);
assert.match(splash, /const createGrainLayer = \(\) =>/);
assert.match(splash, /const fallout = Array\.from/);
assert.match(splash, /window\.setSplashStatus = \(status, progress\) =>/);
assert.match(splash, /window\.finishSplash = \(\) =>/);
assert.match(splash, /movingLayers: \["fallout", "surveyScan", "fracture", "carrier", "progress"\]/);
assert.match(background, /palerift: "splash-palerift\.html"/);
assert.match(builder, /'splash-palerift\.html'/);
assert.match(settings, /\{ label: "白域断层", value: "palerift" \}/);
assert.match(ipc, /"palerift"/);

console.log("Pale Rift splash checks passed without project artwork or external assets.");
