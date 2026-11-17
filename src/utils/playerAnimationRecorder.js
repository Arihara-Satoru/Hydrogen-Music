import { watch } from 'vue';

// 仅手动录制时采样；不读取逐帧 computedStyle/布局，不修改动画或播放状态。
let active = null;
let latest = null;
const limit = 30000;
export function recordPlayerAnimationState(source, data) {
    active?.push('state', { source, ...data });
}

export function installPlayerAnimationRecorder(store) {
    let indicator = null;
    let saving = false;
    let exported = false;
    let cpuStart = null;
    let cpuStop = null;
    let starting = false;
    function showIndicator(text) {
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.style.cssText = 'position:fixed;top:72px;right:20px;z-index:2147483647;background:#111;color:#fff;padding:12px 18px;font:14px sans-serif;pointer-events:none;border:2px solid #ffb000';
            document.body.appendChild(indicator);
        }
        indicator.textContent = text;
    }
    function stop() {
        if (!active) return latest;
        const run = active;
        run.push('stop', {});
        active = null;
        run.cleanup.forEach(fn => fn());
        const frames = run.frames;
        const sorted = frames.map(f => f.dt).sort((a, b) => a - b);
        const baseline = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
        const visible = frames.filter(f => !f.hidden);
        const slow = visible.filter(f => baseline && f.dt > baseline * 1.75);
        latest = {
            schema: 1, startedAt: run.date, durationMs: performance.now() - run.start,
            environment: { userAgent: navigator.userAgent, width: innerWidth, height: innerHeight,
                devicePixelRatio, supportedEntries: PerformanceObserver.supportedEntryTypes },
            summary: { frames: frames.length, baselineMs: baseline,
                maxVisibleFrameMs: Math.max(0, ...visible.map(f => f.dt)),
                slowVisibleFrames: slow.length,
                estimatedMissedFrames: slow.reduce((n, f) => n + Math.max(0, Math.round(f.dt / baseline) - 1), 0),
                truncated: run.truncated },
            frames, events: run.events,
        };
        showIndicator('录制已停止 · Ctrl+Shift+F9 导出诊断文件');
        const report = latest;
        cpuStop = Promise.resolve(cpuStart).then(async meta => {
            if (meta?.error || !window.windowApi?.stopAnimationCpuProfile) {
                report.cpu = meta || { error: 'CPU 采样接口不可用，请重启播放器' };
                return;
            }
            try {
                report.cpu = { ...await window.windowApi.stopAnimationCpuProfile(),
                    startRequestMs: meta.requestMs, startConfirmedMs: meta.confirmedMs, intervalUs: meta.intervalUs };
            } catch (error) { report.cpu = { error: String(error.message || error) }; }
        });
        return latest;
    }
    async function save() {
        if (saving) return;
        const report = stop();
        if (!report) return;
        saving = true;
        try {
            await cpuStop;
            if (!window.windowApi?.saveAnimationReport) throw new Error('请完全退出并重新启动本地播放器，以加载新的保存接口');
            showIndicator('请选择诊断 JSON 的保存位置…');
            const result = await window.windowApi.saveAnimationReport(JSON.stringify(report));
            if (result.error) throw new Error(result.error);
            if (result.canceled) {
                showIndicator('已取消保存，记录仍保留 · Ctrl+Shift+F9 重试');
                return;
            }
            exported = true;
            showIndicator(`诊断已保存：${result.filePath} · Ctrl+Shift+F9 开始新录制`);
            return result;
        } catch (error) {
            showIndicator(`保存失败：${error.message} · 记录仍保留，可重试`);
        } finally {
            saving = false;
        }
    }
    async function start() {
        if (starting || saving) return;
        starting = true;
        stop();
        await cpuStop;
        exported = false;
        const run = { start: performance.now(), date: new Date().toISOString(), frames: [], events: [], cleanup: [], truncated: false };
        run.push = (type, data) => {
            if (run.events.length >= limit) { run.truncated = true; return; }
            run.events.push({ t: performance.now() - run.start, type, ...data });
        };
        active = run;
        showIndicator('正在启动 CPU 调用栈采样，请稍候…');
        const requestMs = performance.now() - run.start;
        cpuStart = (async () => {
            try {
                const result = await window.windowApi?.startAnimationCpuProfile?.();
                return { ...(result || { error: 'CPU 采样接口不可用，请完全退出后重启播放器' }),
                    requestMs, confirmedMs: performance.now() - run.start };
            } catch (error) { return { error: String(error.message || error) }; }
        })();
        void cpuStart.then(meta => {
            starting = false;
            if (active !== run) return;
            run.push('cpu-start', meta);
            showIndicator(meta.error ? `● 仅帧记录：${meta.error}` : '● 正在录制帧与 CPU 调用栈 · 复现后 Ctrl+Shift+F9 导出');
        });
        let previous = performance.now();
        let raf;
        const tick = now => {
            if (run.frames.length < limit) run.frames.push({ t: now - run.start, dt: now - previous, hidden: document.hidden });
            else run.truncated = true;
            previous = now;
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        run.cleanup.push(() => cancelAnimationFrame(raf));
        for (const type of ['longtask', 'long-animation-frame']) {
            if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
            const observer = new PerformanceObserver(list => {
                for (const e of list.getEntries()) run.push(type, { start: e.startTime - run.start, duration: e.duration,
                    blockingDuration: e.blockingDuration, renderStart: e.renderStart,
                    styleAndLayoutStart: e.styleAndLayoutStart,
                    scripts: Array.from(e.scripts || [], s => ({ duration: s.duration, sourceURL: s.sourceURL?.split('?')[0],
                        sourceFunctionName: s.sourceFunctionName, invoker: s.invoker,
                        forcedStyleAndLayoutDuration: s.forcedStyleAndLayoutDuration })) });
            });
            observer.observe({ type });
            run.cleanup.push(() => { observer.disconnect(); });
        }
        const snapshot = () => ({ songId: store.songId, index: store.currentIndex, widget: store.widgetState,
            changing: store.playerChangeSong, lyricShow: store.lyricShow,
            lyricLines: store.lyricsObjArr?.length ?? null, playing: store.playing });
        run.push('start', snapshot());
        run.cleanup.push(watch(() => [store.songId, store.currentIndex, store.widgetState, store.playerChangeSong,
            store.lyricShow, store.lyricsObjArr, store.playing], () => run.push('store', snapshot()), { flush: 'sync' }));
        const listen = (name, fn) => {
            document.addEventListener(name, fn, true);
            run.cleanup.push(() => document.removeEventListener(name, fn, true));
        };
        for (const name of ['animationstart', 'animationend', 'animationcancel', 'transitionrun', 'transitionend', 'transitioncancel']) {
            listen(name, e => {
                if (!e.target.closest?.('.musicPlayer, .music-widget')) return;
                run.push(name, { target: String(e.target.className).slice(0, 180), name: e.animationName || e.propertyName,
                    elapsed: e.elapsedTime, pseudo: e.pseudoElement });
            });
        }
        listen('click', e => run.push('click', { target: String(e.target?.className?.baseVal ?? e.target?.className ?? '').slice(0, 180) }));
        listen('visibilitychange', () => run.push('visibility', { hidden: document.hidden }));
        // WAAPI 歌词入场没有 CSS animationcancel 事件，低频读取动画时间轴补足记录。
        const ids = new WeakMap();
        let nextId = 1;
        let lastAnimations = '';
        const animationTimer = setInterval(() => {
            const animations = document.getAnimations().filter(a =>
                a.effect?.target?.closest?.('.musicPlayer, .music-widget'));
            const data = animations.slice(0, 100).map(a => {
                if (!ids.has(a)) ids.set(a, nextId++);
                const timing = a.effect.getTiming();
                return { id: ids.get(a), name: a.animationName || a.transitionProperty || 'WAAPI',
                    target: String(a.effect.target.className).slice(0, 120), state: a.playState,
                    time: a.currentTime, duration: timing.duration, delay: timing.delay };
            });
            const signature = JSON.stringify(data.map(({ time, ...rest }) => rest));
            if (signature !== lastAnimations) {
                lastAnimations = signature;
                run.push('animation-inventory', { animations: data });
            }
        }, 100);
        run.cleanup.push(() => clearInterval(animationTimer));
        // 自动停止但不自动导出，避免无限采样。
        const timeout = setTimeout(() => { stop(); console.info('[动画诊断] 已达到 120 秒，请按 Ctrl+Shift+F9 导出。'); }, 120000);
        run.cleanup.push(() => clearTimeout(timeout));
        console.info('[动画诊断] 开始录制；复现后按 Ctrl+Shift+F9 停止并导出。');
    }
    const keydown = e => {
        if (!e.ctrlKey || !e.shiftKey || e.code !== 'F9' || e.repeat) return;
        e.preventDefault();
        if (saving || starting) return;
        if (active || (latest && !exported)) { void save(); }
        else start();
    };
    window.addEventListener('keydown', keydown, true);
    window.__hydrogenAnimationRecorder = { start, stop, save, getLatest: () => latest,
        mark: label => active?.push('manual-mark', { label: String(label).slice(0, 200) }) };
    return () => {
        stop();
        window.removeEventListener('keydown', keydown, true);
        delete window.__hydrogenAnimationRecorder;
        indicator?.remove();
    };
}
