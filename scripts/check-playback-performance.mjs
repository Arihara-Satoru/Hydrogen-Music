import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = path => readFile(new URL(path, import.meta.url), "utf8");
const [widget, playerView, lyric, visualizer, player] = await Promise.all([
  readSource("../src/components/MusicWidget.vue"),
  readSource("../src/components/Player.vue"),
  readSource("../src/components/Lyric.vue"),
  readSource("../src/components/AudioVisualizer.vue"),
  readSource("../src/utils/player.js"),
]);

assert.match(widget, /widget-progress-[\s\S]*?:duration="0"/);
assert.match(playerView, /player-progress-[\s\S]*?:duration="0"/);
assert.match(lyric, /class="lyric-lines"[^>]*lineOffset/);
assert.doesNotMatch(lyric, /class="lyric-line"[^>]*lineOffset/);
assert.match(lyric, /\.lyric-lines\s*\{[\s\S]*?transition:\s*transform/);

assert.doesNotMatch(visualizer, /VISUALIZER_FRAME_INTERVAL_MS/);
assert.match(visualizer, /document\.addEventListener\('visibilitychange', handleVisibilityChange\)/);
assert.match(visualizer, /source\.disconnect\(playbackAnalyser\)/);
assert.match(visualizer, /resetAnalyser\(\)[\s\S]*?closeMediaAudioContext\(\)/);

const preloadLead = Number(player.match(/GAPLESS_PRELOAD_LEAD_SECONDS\s*=\s*([\d.]+)/)?.[1]);
const transitionLead = Number(player.match(/GAPLESS_EARLY_START_SECONDS\s*=\s*([\d.]+)/)?.[1]);
assert.ok(preloadLead >= 5 && preloadLead <= 30, `unexpected preload lead: ${preloadLead}`);
assert.ok(preloadLead > transitionLead);
assert.match(player, /remaining <= GAPLESS_PRELOAD_LEAD_SECONDS\) void preloadGaplessSong\(\)/);
assert.match(player, /gaplessPreloadPendingKey === preloadKey/);
assert.doesNotMatch(player, /scheduleGaplessPreload/);

console.log("playback-performance checks passed");
