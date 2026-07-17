const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const splash = fs.readFileSync(path.join(root, "splash-ashlink.html"), "utf8");
const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "src/views/Settings.vue"), "utf8");
const settingsIpc = fs.readFileSync(path.join(root, "src/electron/ipcMain.js"), "utf8");
const builder = fs.readFileSync(path.join(root, "electron-builder.config.cjs"), "utf8");
const scripts = [...splash.matchAll(/<script>([\s\S]*?)<\/script>/g)];

assert.equal(scripts.length, 1, "ash-link splash should keep one self-contained script");
new Function(scripts[0][1]);
assert.match(splash, /splash-ashlink-texture\.png/);
assert.doesNotMatch(splash, /<img\b[^>]+(?:logo|icon)|src\/assets|HYDROGEN MUSIC/i);
assert.match(splash, /prefers-reduced-motion: reduce/);
assert.match(splash, /window\.setSplashStatus = \(status, progress\) =>/);
assert.match(splash, /window\.finishSplash = \(\) =>/);
assert.match(splash, /const ambientParticles = Array\.from/);
assert.match(splash, /const bandParticles = Array\.from/);
assert.match(splash, /const progressSegments = Array\.from/);
assert.match(splash, /const contours = contourFamilies\.flatMap/);
assert.match(splash, /activationSpeed: 0\.7 \+ seededRandom\(\) \* 3\.1/);
assert.match(splash, /speed: 0\.32 \+ seededRandom\(\) \* 2\.8/);
assert.match(splash, /window\.__ashLinkMotion = Object\.freeze/);

const trackBlock = splash.match(/const MOTION_TRACKS = Object\.freeze\(\{([\s\S]*?)\n        \}\);/)?.[1] || "";
const durations = [...trackBlock.matchAll(/duration: (\d+)/g)].map(([, value]) => Number(value));
const delays = [...trackBlock.matchAll(/delay: (\d+)/g)].map(([, value]) => Number(value));
const easings = [...trackBlock.matchAll(/easing: "([^"]+)"/g)].map(([, value]) => value);
assert.ok(durations.length >= 13, "every visible layer should own a motion track");
assert.ok(new Set(durations).size >= 11, "motion tracks should not share one rhythm");
assert.ok(new Set(delays).size >= 9, "motion tracks should have staggered delays");
assert.ok(new Set(easings).size >= 5, "motion tracks should use varied easing");

assert.match(background, /ashlink: "splash-ashlink\.html"/);
assert.match(settings, /label: "灰烬链路", value: "ashlink"/);
assert.match(settingsIpc, /\["classic", "industrial", "ashen", "ashlink"\]\.includes/);
assert.match(builder, /'splash-ashlink\.html'/);
assert.match(builder, /'splash-ashlink-texture\.png'/);
assert.ok(fs.statSync(path.join(root, "splash-ashlink-texture.png")).size > 100_000);

console.log("Ash-Link splash checks passed with independent layer, particle, and segment motion.");
