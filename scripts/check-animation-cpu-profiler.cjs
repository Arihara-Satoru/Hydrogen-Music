const assert = require('node:assert/strict');
const { createAnimationCpuProfiler } = require('../src/electron/animationCpuProfiler.cjs');
(async () => {
  let attached = false;
  const calls = [];
  const profile = { nodes: [], samples: [], timeDeltas: [] };
  const wc = { once() {}, debugger: {
    isAttached: () => attached, attach() { attached = true; }, detach() { attached = false; },
    async sendCommand(name, options) { calls.push({ name, options }); return name === 'Profiler.stop' ? { profile } : {}; },
  } };
  const recorder = createAnimationCpuProfiler(wc);
  assert.equal((await recorder.start()).intervalUs, 2000);
  assert.equal(attached, true);
  const [a, b] = await Promise.all([recorder.stop(), recorder.stop()]);
  assert.deepEqual(a.profile, profile);
  assert.deepEqual(a, b);
  assert.equal(attached, false);
  assert.equal(calls.filter(c => c.name === 'Profiler.stop').length, 1);
  assert.deepEqual(await recorder.stop(), a);
  attached = true;
  assert.match((await recorder.start()).error, /占用/);
  assert.equal(attached, true, 'Never detach another debugger');
  attached = false;
  wc.debugger.sendCommand = async () => { throw Error('failed'); };
  assert.match((await recorder.start()).error, /failed/);
  assert.equal(attached, false);
  console.log('CPU profiler lifecycle checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
