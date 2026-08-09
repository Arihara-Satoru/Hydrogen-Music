// ponytail: 60 秒批量上报匹配后端实测节奏；若接口支持可靠退出同步，再补不足一分钟的尾数。
export const LISTEN_REPORT_STEP_SECONDS = 60
export const LISTEN_TICK_MAX_GAP_SECONDS = 10

export function calculateListenedSeconds(previousMs, nowMs, active, maxGapSeconds = LISTEN_TICK_MAX_GAP_SECONDS) {
    if (!active) return 0

    const elapsed = (Number(nowMs) - Number(previousMs)) / 1000
    if (!Number.isFinite(elapsed) || elapsed <= 0 || elapsed > maxGapSeconds) return 0
    return elapsed
}

export function takeReportableSeconds(pendingSeconds, stepSeconds = LISTEN_REPORT_STEP_SECONDS) {
    const pending = Number(pendingSeconds)
    const step = Number(stepSeconds)
    if (!Number.isFinite(pending) || !Number.isFinite(step) || pending < step || step <= 0) return 0
    return Math.floor(pending / step) * step
}
