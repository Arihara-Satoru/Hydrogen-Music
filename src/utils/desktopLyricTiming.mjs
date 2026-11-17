export function clampPercentage(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.min(100, Math.max(0, number));
}

export function normalizeLyricWords(words, lyricText) {
    if (!Array.isArray(words) || !words.length) return [];
    const normalized = [];
    for (const word of words) {
        const text = typeof word?.text === 'string' ? word.text : '';
        const startTime = Number(word?.startTime);
        const duration = Number(word?.duration);
        if (!text || !Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(duration) || duration < 0 ||
            (normalized.length && startTime < normalized[normalized.length - 1].startTime)) return [];
        normalized.push({ text, startTime, duration });
    }
    return normalized.map(word => word.text).join('') === String(lyricText || '').trim() ? normalized : [];
}

export function resolveDesktopLyricLine(row, type = 'auto') {
    if (!row) return { text: '—', words: [] };
    const words = normalizeLyricWords(row.words, row.lyric);
    const fields = type === 'original' || (type === 'auto' && words.length)
        ? ['lyric', 'tlyric', 'rlyric']
        : type === 'roma' ? ['rlyric', 'lyric', 'tlyric'] : ['tlyric', 'lyric', 'rlyric'];
    const field = fields.find(key => String(row[key] || '').trim());
    return { text: field ? String(row[field]).trim() : '—', words: field === 'lyric' ? words : [] };
}

export function calculateLyricWordProgress(word, currentTime) {
    const start = Number(word?.startTime);
    const duration = Number(word?.duration);
    const now = Number(currentTime);
    if (!Number.isFinite(start) || !Number.isFinite(duration) || !Number.isFinite(now) || now < start) return 0;
    return duration > 0 ? clampPercentage(((now - start) / duration) * 100) : 100;
}

export function interpolateLyricTime(snapshot, timestamp, playing, duration = 0) {
    const base = Math.max(0, Number(snapshot?.currentTime) || 0);
    const elapsed = playing && snapshot?.advancing !== false
        ? Math.min(0.6, Math.max(0, (timestamp - snapshot.receivedAt) / 1000))
        : 0;
    const rate = Number(snapshot?.playbackRate);
    const time = base + elapsed * (Number.isFinite(rate) && rate > 0 ? rate : 1);
    return duration > 0 ? Math.min(duration, time) : time;
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
