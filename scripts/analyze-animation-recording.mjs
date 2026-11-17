import { readFile } from 'node:fs/promises';
const file = process.argv[2];
if (!file) throw new Error('用法：node scripts/analyze-animation-recording.mjs <录制.json>');
const report = JSON.parse(await readFile(file, 'utf8'));
console.log('采样摘要（rAF 间隔不等于 GPU 实际呈现帧）：', JSON.stringify(report.summary, null, 2));
const events = report.events;
const baseline = report.summary.baselineMs || 16.67;
const cpu = report.cpu;
if (cpu?.profile) {
    const { nodes, samples = [], timeDeltas = [] } = cpu.profile;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const parents = new Map();
    for (const n of nodes) for (const child of n.children || []) parents.set(child, n.id);
    let clock = (cpu.startRequestMs + cpu.startConfirmedMs) / 2;
    const points = samples.map((id, i) => {
        const dt = (timeDeltas[i] || 0) / 1000;
        clock += dt;
        return { id, dt, t: clock };
    });
    function rank(start, end) {
        const totals = new Map();
        for (const p of points) {
            if (p.t < start || p.t > end) continue;
            const leaf = byId.get(p.id)?.callFrame?.functionName;
            if (leaf === '(idle)') continue;
            let id = p.id;
            const seen = new Set();
            const seenFrames = new Set();
            while (id && !seen.has(id)) {
                seen.add(id);
                const n = byId.get(id);
                if (!n) break;
                const f = n.callFrame;
                const key = `${f.functionName || '(anonymous)'} @ ${f.url || '(native)'}:${f.lineNumber + 1}`;
                if (!seenFrames.has(key)) totals.set(key, (totals.get(key) || 0) + p.dt);
                seenFrames.add(key);
                id = parents.get(id);
            }
        }
        return [...totals].sort((a, b) => b[1] - a[1]).slice(0, 18)
            .map(([frame, ms]) => ({ frame, inclusiveSampleMs: Math.round(ms * 10) / 10 }));
    }
    console.log('\nCPU 采样累计热点（包含子调用，不能相加；时间对齐存在 IPC 启动误差）：');
    console.log(JSON.stringify(rank(0, Infinity), null, 2));
    for (const e of events.filter(e => e.type === 'click' && /open-player/.test(e.target))) {
        console.log(`\n进入播放页 ${e.t.toFixed(1)}ms 后两秒的调用热点：`);
        console.log(JSON.stringify(rank(e.t, e.t + 2000), null, 2));
    }
} else console.log('\nCPU 采样不可用：', cpu?.error || '本文件由旧版记录器生成');
const gaps = report.frames.filter(f => !f.hidden && f.dt > Math.max(35, baseline * 1.75))
    .sort((a, b) => b.dt - a.dt).slice(0, 20);
for (const gap of gaps) {
    const tasks = events.filter(e => ['longtask', 'long-animation-frame'].includes(e.type) &&
        e.start <= gap.t && e.start + e.duration >= gap.t - gap.dt);
    console.log(`\n长帧 ${gap.t.toFixed(1)}ms，间隔 ${gap.dt.toFixed(1)}ms；重叠任务 ${tasks.length}`);
    console.log(JSON.stringify(tasks, null, 2));
    console.log('附近状态：', JSON.stringify(events.filter(e => ['state', 'store', 'click'].includes(e.type) &&
        e.t >= gap.t - gap.dt - 100 && e.t <= gap.t + 100), null, 2));
}
console.log('\n动画取消事件（取消不一定是故障，需结合进入/退出时间线）：');
console.log(JSON.stringify(events.filter(e => /cancel$/.test(e.type)), null, 2));
console.log('\n切歌与入场状态时间线：');
console.log(JSON.stringify(events.filter(e => ['start', 'state', 'store', 'manual-mark', 'visibility'].includes(e.type)), null, 2));
