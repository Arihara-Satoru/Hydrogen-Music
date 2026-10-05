export const LISTEN_TICK_MAX_GAP_SECONDS = 10

export function calculateListenedSeconds(previousMs, nowMs, active, maxGapSeconds = LISTEN_TICK_MAX_GAP_SECONDS) {
    if (!active) return 0

    const elapsed = (Number(nowMs) - Number(previousMs)) / 1000
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > maxGapSeconds) return 0
    return elapsed
}

export function calculatePlaybackMilliseconds(previousMs, nowMs, previousSeek, seek, rate = 1) {
    const elapsed = calculateListenedSeconds(previousMs, nowMs, true)
    const advance = Number(seek) - Number(previousSeek)
    // ponytail: discard seek jumps and sleep gaps; use media events if playback gains variable rate ramps.
    if (!elapsed || !Number.isFinite(advance) || advance <= 0 || advance > elapsed * rate + 0.5) return 0
    return Math.min(elapsed, advance / rate) * 1000
}
