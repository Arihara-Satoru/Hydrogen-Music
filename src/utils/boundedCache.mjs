export function getBoundedCacheValue(cache, key) {
  if (!cache.has(key)) return undefined;

  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

export function setBoundedCacheValue(cache, key, value, limit) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);

  while (cache.size > limit) cache.delete(cache.keys().next().value);
  return value;
}
