const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const splash = fs.readFileSync(path.join(root, "splash.html"), "utf8");
const classicSplash = fs.readFileSync(path.join(root, "splash-classic.html"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/views/Settings.vue"), "utf8");
const settingsIpc = fs.readFileSync(path.join(root, "src/electron/ipcMain.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.config.cjs"), "utf8");
const scripts = [...splash.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const classicScripts = [...classicSplash.matchAll(/<script>([\s\S]*?)<\/script>/g)];

assert.equal(scripts.length, 1, "splash should keep one self-contained script");
new Function(scripts[0][1]);
assert.equal(classicScripts.length, 1, "classic splash should keep one self-contained script");
new Function(classicScripts[0][1]);

assert.match(splash, /<canvas id="scene"/);
assert.match(splash, /const drawGlobe =/);
assert.equal((splash.match(/drawHelix\(\{/g) || []).length, 2);
assert.match(splash, /role="progressbar"/);
assert.match(splash, /prefers-reduced-motion: reduce/);
assert.equal((classicSplash.match(/<span><\/span>/g) || []).length, 5);
assert.match(classicSplash, /transform: scale\(2\)/);
assert.match(background, /startupAnimation === "classic"/);
assert.match(background, /useClassicSplash \? "splash-classic\.html" : "splash\.html"/);
assert.match(settings, /value: "signal"/);
assert.match(settings, /value: "classic"/);
assert.match(settingsIpc, /startupAnimation:[\s\S]*?=== "classic" \? "classic" : "signal"/);
assert.match(builder, /'splash-classic\.html'/);
assert.match(splash, /transform: scale\(var\(--splash-scale\)\)/);
assert.match(splash, /viewport\.dpr = .* \* displayScale;/);

const [, windowWidth, windowHeight] = background.match(
  /const createSplashWindow[\s\S]*?width: (\d+),\s+height: (\d+),/,
);
const [, designWidth, designHeight] = splash.match(
  /main \{[\s\S]*?width: (\d+)px;\s+height: (\d+)px;/,
);
const [, splashScale] = splash.match(/--splash-scale: (\d+);/);
assert.deepEqual(
  [Number(windowWidth), Number(windowHeight)],
  [Number(designWidth) * Number(splashScale), Number(designHeight) * Number(splashScale)],
);
assert.deepEqual([Number(windowWidth), Number(windowHeight)], [720, 480]);

const progressStages = [
  ...background.matchAll(/setSplashStatus\([^,\n]+,\s*(\d+)\)/g),
].map((match) => Number(match[1]));
assert.deepEqual([...new Set(progressStages)], [24, 38, 56, 82, 100]);

console.log("Splash animation check passed.");
