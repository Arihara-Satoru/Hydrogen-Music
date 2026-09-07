import { getSirenCacheSizes } from '../api/siren'
import { getCommentScrollCacheSize } from './commentScrollMemory'
import { getPlaybackTickerDiagnostics } from './player/playbackTicker'

const SAMPLE_INTERVAL_MS = 60_000
const counters = {
  longTasks: { count: 0, totalMs: 0, maxMs: 0 },
  longFrames: { count: 0, totalMs: 0, maxMs: 0 },
  slowInteractions: { count: 0, totalMs: 0, maxMs: 0 },
}

let timer = null
let observers = []
let startedAt = 0
let latestSnapshot = null

function recordCounter(counter, entries) {
  for (const entry of entries) {
    const duration = Math.round(Number(entry.duration) || 0)
    counter.count += 1
    counter.totalMs += duration
    counter.maxMs = Math.max(counter.maxMs, duration)
  }
}

function observe(type, counter, options = {}) {
  if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type)) return

  try {
    const observer = new PerformanceObserver((list) => recordCounter(counter, list.getEntries()))
    observer.observe({ type, buffered: true, ...options })
    observers.push(observer)
  } catch (_) {}
}

function resetCounters() {
  for (const counter of Object.values(counters)) {
    counter.count = 0
    counter.totalMs = 0
    counter.maxMs = 0
  }
}

function getHeapSnapshot() {
  const memory = performance.memory
  if (!memory) return null
  return {
    usedBytes: memory.usedJSHeapSize,
    totalBytes: memory.totalJSHeapSize,
    limitBytes: memory.jsHeapSizeLimit,
  }
}

export async function samplePerformanceDiagnostics(reason = 'manual') {
  const collectStartedAt = performance.now()
  let processSnapshot = null
  try {
    processSnapshot = await window.windowApi?.getPerformanceSnapshot?.()
  } catch (error) {
    processSnapshot = { error: String(error?.message || error) }
  }

  latestSnapshot = {
    at: new Date().toISOString(),
    reason,
    uptimeMs: Math.round(performance.now() - startedAt),
    route: location.hash || location.pathname,
    hidden: document.hidden,
    heap: getHeapSnapshot(),
    domNodes: document.querySelectorAll('*').length,
    timing: structuredClone(counters),
    ticker: getPlaybackTickerDiagnostics(),
    caches: {
      comments: getCommentScrollCacheSize(),
      siren: getSirenCacheSizes(),
    },
    process: processSnapshot,
    collectionMs: Math.round(performance.now() - collectStartedAt),
  }
  resetCounters()
  // A string prevents DevTools from retaining the live object graph referenced by a logged object.
  console.info(`[perf] ${JSON.stringify(latestSnapshot)}`)
  return latestSnapshot
}

export function stopPerformanceDiagnostics() {
  if (timer) window.clearInterval(timer)
  timer = null
  observers.forEach((observer) => observer.disconnect())
  observers = []
}

export function startPerformanceDiagnostics() {
  if (timer) return
  startedAt = performance.now()
  observe('longtask', counters.longTasks)
  observe('long-animation-frame', counters.longFrames)
  observe('event', counters.slowInteractions, { durationThreshold: 40 })
  void samplePerformanceDiagnostics('start')
  timer = window.setInterval(() => void samplePerformanceDiagnostics('interval'), SAMPLE_INTERVAL_MS)
}

export function initPerformanceDiagnostics() {
  if (!import.meta.env.DEV) return

  window.__hydrogenPerfDiagnostics = {
    start: startPerformanceDiagnostics,
    stop: stopPerformanceDiagnostics,
    sample: samplePerformanceDiagnostics,
    getLatest: () => latestSnapshot,
  }

  const queryEnabled = new URLSearchParams(location.search).get('perfDiagnostics') === '1'
  const storedEnabled = localStorage.getItem('hydrogen:perfDiagnostics') === '1'
  if (import.meta.env.VITE_PERF_DIAGNOSTICS === '1' || queryEnabled || storedEnabled) {
    startPerformanceDiagnostics()
  }
}

if (import.meta.hot) import.meta.hot.dispose(stopPerformanceDiagnostics)
