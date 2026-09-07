import assert from "node:assert/strict";
import {
  clearExpiredFmRecentCache,
  FM_RECENT_CACHE_CLEANUP_INTERVAL_MS,
  getFmRecentCacheKey,
  shouldClearFmRecentCache,
} from "../src/utils/fmRecentCache.mjs";

const storage = new Map();
const fakeStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};
const now = 1_000_000;
const cacheKey = getFmRecentCacheKey("user-1");

fakeStorage.setItem(cacheKey, '["song-1"]');
assert.equal(clearExpiredFmRecentCache(fakeStorage, "user-1", now), false);
assert.equal(fakeStorage.getItem(cacheKey), '["song-1"]');
assert.equal(shouldClearFmRecentCache(null, now + FM_RECENT_CACHE_CLEANUP_INTERVAL_MS), false);
assert.equal(shouldClearFmRecentCache(now, now + FM_RECENT_CACHE_CLEANUP_INTERVAL_MS - 1), false);
assert.equal(clearExpiredFmRecentCache(fakeStorage, "user-1", now + FM_RECENT_CACHE_CLEANUP_INTERVAL_MS), true);
assert.equal(fakeStorage.getItem(cacheKey), null);

console.log("FM recent-cache cleanup check passed");
