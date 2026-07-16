const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const splash = fs.readFileSync(path.join(root, "splash-ashen.html"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/views/Settings.vue"), "utf8");
const settingsIpc = fs.readFileSync(path.join(root, "src/electron/ipcMain.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.config.cjs"), "utf8");
const scripts = [...splash.matchAll(/<script>([\s\S]*?)<\/script>/g)];

assert.equal(scripts.length, 1, "ashen splash should keep one self-contained script");
new Function(scripts[0][1]);
assert.match(splash, /splash-ashen-texture\.png/);
assert.doesNotMatch(splash, /<img\b[^>]+(?:logo|icon)|src\/assets|HYDROGEN MUSIC/i);
assert.match(splash, /prefers-reduced-motion: reduce/);
assert.match(splash, /window\.setSplashStatus = \(status, progress\) =>/);
assert.match(splash, /window\.finishSplash = \(\) =>/);

const tracks = [
  ...splash.matchAll(
    /^\s{10}(\w+): \{ period: ([\d.]+), delay: ([\d.]+), easing: "(\w+)", jitter: ([\d.]+) \},$/gm,
  ),
].map(([, name, period, delay, easing, jitter]) => ({
  name,
  period: Number(period),
  delay: Number(delay),
  easing,
  jitter: Number(jitter),
}));

assert.equal(tracks.length, 13, "every visual group should declare its motion track");
assert.equal(new Set(tracks.map(({ period }) => period)).size, tracks.length);
assert.ok(new Set(tracks.map(({ delay }) => delay)).size >= 11);
assert.ok(new Set(tracks.map(({ easing }) => easing)).size >= 5);
assert.ok(tracks.every(({ jitter }) => jitter > 0));
assert.match(splash, /ambientParticles = Array\.from/);
assert.match(splash, /channelParticles = Array\.from/);
assert.match(splash, /progressSegments = Array\.from/);
assert.match(splash, /verticalSegments = Array\.from/);
assert.match(splash, /pulseSpeed: 0\.45 \+ seededRandom\(\) \* 2\.35/);
assert.match(splash, /speed: 0\.64 \+ seededRandom\(\) \* 2\.4/);
assert.match(splash, /context\.rotate\(rotation\)/);
assert.match(splash, /titleFlash < 0\.08/);

assert.match(background, /ashen: "splash-ashen\.html"/);
assert.match(background, /loadFile\(path\.join\(__dirname, splashFile\)\)/);
assert.match(settings, /label: "灰域协议", value: "ashen"/);
assert.match(settingsIpc, /\["classic", "industrial", "ashen"\]\.includes/);
assert.match(builder, /'splash-ashen\.html'/);
assert.match(builder, /'splash-ashen-texture\.png'/);
assert.ok(fs.statSync(path.join(root, "splash-ashen-texture.png")).size > 100_000);

console.log("Ashen splash checks passed with 13 unique motion tracks and variable-speed particles.");
