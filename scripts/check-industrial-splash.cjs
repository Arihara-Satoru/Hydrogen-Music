const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const splash = fs.readFileSync(path.join(root, "splash-industrial.html"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/views/Settings.vue"), "utf8");
const settingsIpc = fs.readFileSync(path.join(root, "src/electron/ipcMain.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.config.cjs"), "utf8");
const scripts = [...splash.matchAll(/<script>([\s\S]*?)<\/script>/g)];

assert.equal(scripts.length, 1, "industrial splash should keep one self-contained script");
new Function(scripts[0][1]);
assert.match(splash, /splash-industrial-texture\.png/);
assert.doesNotMatch(splash, /<img\b[^>]+(?:logo|icon)|src\/assets|HYDROGEN MUSIC/i);
assert.match(splash, /prefers-reduced-motion: reduce/);
assert.match(splash, /window\.finishSplash = \(\) =>/);
const waveform = splash.match(/const drawWaveform = \(time, reveal\) => \{([\s\S]*?)\n      \};/)?.[1];
assert.ok(waveform, "waveform renderer should exist");
assert.match(waveform, /fractalNoise/);
assert.match(waveform, /fieldSurge/);
assert.doesNotMatch(waveform, /right(?:Surge|Breath|Weight)/);
assert.doesNotMatch(waveform, /Math\.sin/, "waveform should not use predictable sine cycles");

const tracks = [...splash.matchAll(/^\s{8}(\w+): (\d+),$/gm)].map(([, name, value]) => [
  name,
  Number(value),
]);
assert.equal(tracks.length, 9, "every visual layer should have an explicit motion track");
assert.equal(new Set(tracks.map(([, value]) => value)).size, tracks.length);
assert.match(splash, /movingLayers: Object\.keys\(MOTION_TRACKS\)/);

assert.match(background, /industrial: "splash-industrial\.html"/);
assert.match(background, /loadFile\(path\.join\(__dirname, splashFile\)\)/);
assert.match(settings, /label: "末日工业", value: "industrial"/);
assert.match(settingsIpc, /\["classic", "industrial", "ashen", "ashlink"\]\.includes/);
assert.match(builder, /'splash-industrial\.html'/);
assert.match(builder, /'splash-industrial-texture\.png'/);
assert.ok(fs.statSync(path.join(root, "splash-industrial-texture.png")).size > 100_000);

console.log("Industrial splash checks passed with nine unique motion tracks.");
