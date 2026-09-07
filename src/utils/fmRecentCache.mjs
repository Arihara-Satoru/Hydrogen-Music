export const FM_RECENT_CACHE_PREFIX = "hm.fm.recentPlayedQueue:";
export const FM_RECENT_CACHE_CLEANUP_PREFIX = "hm.fm.recentPlayedQueueCleanup:";
export const FM_RECENT_CACHE_CLEANUP_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

function normalizeUserId(userId) {
  return String(userId ?? "guest").trim() || "guest";
}

export function getFmRecentCacheKey(userId) {
  return `${FM_RECENT_CACHE_PREFIX}${normalizeUserId(userId)}`;
}

export function getFmRecentCacheCleanupKey(userId) {
  return `${FM_RECENT_CACHE_CLEANUP_PREFIX}${normalizeUserId(userId)}`;
}

export function shouldClearFmRecentCache(lastCleanedAt, now = Date.now()) {
  const timestamp = Number(lastCleanedAt);
  return lastCleanedAt !== null && lastCleanedAt !== "" && Number.isFinite(timestamp) && now - timestamp >= FM_RECENT_CACHE_CLEANUP_INTERVAL_MS;
}

export function ensureFmRecentCacheCleanupSchedule(storage, userId, now = Date.now()) {
  const cleanupKey = getFmRecentCacheCleanupKey(userId);
  const lastCleanedAt = storage.getItem(cleanupKey);
  if (lastCleanedAt !== null && lastCleanedAt !== "" && Number.isFinite(Number(lastCleanedAt))) return;
  storage.setItem(cleanupKey, String(now));
}

export function clearExpiredFmRecentCache(storage, userId, now = Date.now()) {
  const cleanupKey = getFmRecentCacheCleanupKey(userId);
  if (!shouldClearFmRecentCache(storage.getItem(cleanupKey), now)) {
    ensureFmRecentCacheCleanupSchedule(storage, userId, now);
    return false;
  }

  storage.removeItem(getFmRecentCacheKey(userId));
  storage.setItem(cleanupKey, String(now));
  return true;
}

export function markFmRecentCacheCleaned(storage, userId, now = Date.now()) {
  storage.setItem(getFmRecentCacheCleanupKey(userId), String(now));
}
