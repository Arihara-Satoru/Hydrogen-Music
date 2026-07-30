export function clampPercentage(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, number));
}

export function calculateLyricLineProgress(lines, index, currentTime, duration = 0) {
    if (!Array.isArray(lines) || !Number.isInteger(index) || index < 0 || index >= lines.length) {
        return 0;
    }

    const start = Number(lines[index]?.time);
    const now = Number(currentTime);
    if (!Number.isFinite(start) || !Number.isFinite(now) || now <= start) return 0;

    let end = 0;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
        const candidate = Number(lines[nextIndex]?.time);
        if (Number.isFinite(candidate) && candidate > start) {
            end = candidate;
            break;
        }
    }

    const trackEnd = Number(duration);
    if (!end && Number.isFinite(trackEnd) && trackEnd > start) end = trackEnd;

    // ponytail: a four-second tail is only a missing-duration fallback; remove it once every sender guarantees duration.
    if (!end) end = start + 4;

    return clampPercentage(((now - start) / (end - start)) * 100);
}

if (globalThis.process?.argv?.[1]?.replaceAll('\\', '/').endsWith('/desktopLyricTiming.mjs')) {
    const rows = [{ time: 10 }, { time: 10 }, { time: 14 }];
    const checks = [
        [calculateLyricLineProgress(rows, 0, 12, 30), 50, 'skips duplicate timestamps'],
        [calculateLyricLineProgress(rows, 2, 16, 18), 50, 'uses duration for the final line'],
        [calculateLyricLineProgress(rows, -1, 12, 30), 0, 'rejects invalid indices'],
        [clampPercentage(140), 100, 'clamps percentages'],
    ];

    for (const [actual, expected, label] of checks) {
        if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
    }

    console.log('desktop lyric timing self-check passed');
}
