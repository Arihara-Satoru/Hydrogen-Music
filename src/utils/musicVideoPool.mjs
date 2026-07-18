export function pickMusicVideoPoolEntry(
  entries,
  previousPath = "",
  random = Math.random,
) {
  const available = (Array.isArray(entries) ? entries : []).filter(
    (entry) =>
      entry?.available !== false &&
      typeof entry?.path === "string" &&
      entry.path,
  );
  if (available.length === 0) return null;

  const freshEntries = available.filter((entry) => entry.path !== previousPath);
  const candidates = freshEntries.length > 0 ? freshEntries : available;
  const sample = Number(random());
  const normalizedSample = Number.isFinite(sample)
    ? Math.min(Math.max(sample, 0), 1 - Number.EPSILON)
    : 0;

  return candidates[Math.floor(normalizedSample * candidates.length)];
}
