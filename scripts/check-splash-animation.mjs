import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [splash, background] = await Promise.all([
  readFile(new URL("../splash.html", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8"),
]);

const motionDuration = Number(splash.match(/const MOTION_DURATION = (\d+);/)?.[1]);
const handoffDuration = Number(splash.match(/const HANDOFF_DURATION = (\d+);/)?.[1]);

assert.ok(motionDuration + handoffDuration >= 3000 && motionDuration + handoffDuration <= 5000);
assert.doesNotMatch(splash, /<img\b|src\/assets|class="logo"/i);
assert.match(splash, /window\.finishSplash = \(\) =>/);
assert.match(splash, /const REFERENCE_WIDTH = 1597;/);
assert.match(splash, /const REFERENCE_HEIGHT = 985;/);
assert.match(splash, /layout: "full-player-skeleton"/);
assert.match(splash, /\[1279, 267, 185, 118\]/);
assert.doesNotMatch(splash, /const panelTargets =/);
assert.match(background, /splashWindow\.webContents\.executeJavaScript/);
assert.match(background, /window\.finishSplash \? window\.finishSplash\(\)/);
assert.match(background, /Promise\.race/);

console.log(`Splash animation checks passed (${motionDuration + handoffDuration}ms).`);
