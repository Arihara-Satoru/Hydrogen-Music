import { getBoundedCacheValue, setBoundedCacheValue } from './boundedCache.mjs';

const COMMENT_SCROLL_CACHE_LIMIT = 100;
const commentScrollPositionMap = new Map();
let lastCommentTargetKey = null;

export function setCommentScrollPosition(targetKey, scrollTop) {
    if (!targetKey) return;
    const normalized = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0;
    setBoundedCacheValue(commentScrollPositionMap, targetKey, normalized, COMMENT_SCROLL_CACHE_LIMIT);
}

export function getCommentScrollPosition(targetKey) {
    if (!targetKey) return null;
    const cached = getBoundedCacheValue(commentScrollPositionMap, targetKey);
    return typeof cached === 'number' ? cached : null;
}

export function setLastCommentTargetKey(targetKey) {
    lastCommentTargetKey = targetKey || null;
}

export function getLastCommentTargetKey() {
    return lastCommentTargetKey;
}

export function getCommentScrollCacheSize() {
    return commentScrollPositionMap.size;
}
