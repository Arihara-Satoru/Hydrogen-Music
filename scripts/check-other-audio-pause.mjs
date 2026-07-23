import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createOtherAudioPauseController } from "../src/utils/otherAudioPause.mjs";

const require = createRequire(import.meta.url);
const { createStableStateFilter } = require("../src/electron/otherAudioMonitor.js");

function createHarness() {
  let playing = false;
  let playbackKey = "song-1";
  let hasTrack = true;
  let pauses = 0;
  let resumes = 0;
  const controller = createOtherAudioPauseController({
    isPlaying: () => playing,
    hasPlayableTrack: () => hasTrack,
    getPlaybackKey: () => playbackKey,
    pause: () => {
      pauses++;
      playing = false;
    },
    resume: () => {
      resumes++;
      playing = true;
    },
  });

  return {
    controller,
    get pauses() {
      return pauses;
    },
    get resumes() {
      return resumes;
    },
    setPlaying(value) {
      playing = value;
    },
    setPlaybackKey(value) {
      playbackKey = value;
    },
    setHasTrack(value) {
      hasTrack = value;
    },
  };
}

{
  const harness = createHarness();
  harness.setPlaying(true);
  harness.controller.setOtherAudioActive(true);
  assert.equal(harness.pauses, 1);
  assert.equal(harness.controller.getState().resumePending, true);
  harness.controller.setOtherAudioActive(false);
  assert.equal(harness.resumes, 1);
}

{
  const harness = createHarness();
  harness.setPlaying(true);
  harness.controller.setOtherAudioActive(true);
  harness.controller.handleManualPause();
  harness.controller.setOtherAudioActive(false);
  assert.equal(harness.resumes, 0);
}

{
  const harness = createHarness();
  harness.controller.setOtherAudioActive(true);
  assert.equal(
    harness.controller.requestPlayback({ userInitiated: false }),
    false,
  );
  harness.controller.setOtherAudioActive(false);
  assert.equal(harness.resumes, 1);
}

{
  const harness = createHarness();
  harness.controller.setOtherAudioActive(true);
  assert.equal(
    harness.controller.requestPlayback({ userInitiated: true }),
    true,
  );
  assert.equal(
    harness.controller.requestPlayback({ userInitiated: false }),
    true,
  );
  harness.controller.setOtherAudioActive(false);
  assert.equal(harness.resumes, 0);
  harness.setPlaying(true);
  harness.controller.setOtherAudioActive(true);
  assert.equal(harness.pauses, 1);
}

{
  const harness = createHarness();
  harness.setPlaying(true);
  harness.controller.setOtherAudioActive(true);
  harness.setPlaybackKey("song-2");
  harness.controller.setOtherAudioActive(false);
  assert.equal(harness.resumes, 0);
}

{
  const harness = createHarness();
  harness.setHasTrack(false);
  harness.setPlaying(true);
  harness.controller.setOtherAudioActive(true);
  harness.controller.setOtherAudioActive(false);
  assert.equal(harness.pauses, 0);
  assert.equal(harness.resumes, 0);
}

{
  const changes = [];
  const filter = createStableStateFilter({
    activeAfterMs: 500,
    inactiveAfterMs: 1000,
    onChange: (active) => changes.push(active),
  });
  filter.push(true, 0);
  filter.push(true, 400);
  filter.push(false, 450);
  assert.deepEqual(changes, []);
  filter.push(true, 1000);
  filter.push(true, 1500);
  assert.deepEqual(changes, [true]);
  filter.push(false, 1600);
  filter.push(false, 2500);
  assert.deepEqual(changes, [true]);
  filter.push(false, 2600);
  assert.deepEqual(changes, [true, false]);
  filter.push(true, 3000);
  filter.push(true, 3500);
  filter.reset(false);
  assert.deepEqual(changes, [true, false, true, false]);
}

console.log("other audio pause checks passed");
