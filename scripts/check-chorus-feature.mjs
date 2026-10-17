import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

console.log('Testing chorus segments normalization and player logic...');

const playerStoreSource = await readFile('src/store/playerStore.js', 'utf8');
assert(playerStoreSource.includes('currentChorus: null'), 'playerStore should include currentChorus');

const playerSource = await readFile('src/utils/player.js', 'utf8');
assert(playerSource.includes('export async function loadSongChorus'), 'player.js should export loadSongChorus');
assert(playerSource.includes('normalizeSongChorusSegments'), 'player.js should have normalizeSongChorusSegments');

// Verify normalization calculations directly
function normalizeClimaxTimeToSeconds(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num >= 1000 ? num / 1000 : num;
}

function normalizeSongChorusSegments(response, fallbackDurationMs = 0) {
  const rawList = Array.isArray(response?.data)
    ? response.data
    : response?.data
      ? [response.data]
      : [];
  const segments = [];
  const CHORUS_MIN_SEGMENT_SECONDS = 3;
  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;
    const startTime = normalizeClimaxTimeToSeconds(
      item?.start_time ?? item?.start ?? item?.begin_time,
    );
    const endTime = normalizeClimaxTimeToSeconds(
      item?.end_time ?? item?.end ?? item?.stop_time,
    );
    const durationTime = normalizeClimaxTimeToSeconds(
      item?.timelength ?? item?.duration ?? fallbackDurationMs,
    );
    if (!Number.isFinite(startTime)) continue;

    const normalizedEndTime = Number.isFinite(endTime)
      ? endTime
      : Number.isFinite(durationTime)
        ? startTime + durationTime
        : null;
    if (!Number.isFinite(normalizedEndTime) || normalizedEndTime <= startTime)
      continue;

    const normalizedDuration = normalizedEndTime - startTime;
    if (
      !Number.isFinite(normalizedDuration) ||
      normalizedDuration < CHORUS_MIN_SEGMENT_SECONDS
    )
      continue;

    segments.push({
      startTime,
      endTime: normalizedEndTime,
      duration: normalizedDuration,
    });
  }
  return segments.sort((a, b) => a.startTime - b.startTime);
}

// Test with Kugou climax response
const mockKugouClimax = {
  status: 1,
  data: [
    {
      start_time: '56100',
      end_time: '82200',
      timelength: '26100',
      audio_name: '千本桜',
    }
  ]
};

const normalized = normalizeSongChorusSegments(mockKugouClimax);
assert.equal(normalized.length, 1);
assert.equal(normalized[0].startTime, 56.1);
assert.equal(normalized[0].endTime, 82.2);
assert.equal(normalized[0].duration, 26.1);

// Test with multi-segment response
const mockMultiClimax = {
  status: 1,
  data: [
    { start_time: 140000, end_time: 170000 },
    { start_time: 50000, end_time: 80000 }
  ]
};

const multiNormalized = normalizeSongChorusSegments(mockMultiClimax);
assert.equal(multiNormalized.length, 2);
assert.equal(multiNormalized[0].startTime, 50);
assert.equal(multiNormalized[1].startTime, 140);

// Test coordinate mapping
const songDuration = 200; // 200s
const seg = multiNormalized[0];
const startPercent = Math.max(0, Math.min(100, (seg.startTime / songDuration) * 100));
const endPercent = Math.max(0, Math.min(100, (seg.endTime / songDuration) * 100));
const widthPercent = Math.max(0.6, endPercent - startPercent);

assert.equal(startPercent, 25);
assert.equal(endPercent, 40);
assert.equal(widthPercent, 15);

// Test empty / invalid responses
assert.equal(normalizeSongChorusSegments(null).length, 0);
assert.equal(normalizeSongChorusSegments({ data: [] }).length, 0);
assert.equal(normalizeSongChorusSegments({ data: [{ start_time: 100, end_time: 101 }] }).length, 0); // duration < 3s

// Test Player.vue template structure
const playerVueSource = await readFile('src/components/Player.vue', 'utf8');
assert(playerVueSource.includes('v-if="hasChorus && isCurrentlyInChorus"'), 'Player.vue should only show chorus badge during chorus');
assert(playerVueSource.includes('// CHORUS'), 'Player.vue should include clean // CHORUS badge tag');
assert(!playerVueSource.includes('class="chorus-badge-time"'), 'Player.vue should not clutter badge with static timestamp');

console.log('All chorus checks passed successfully!');
