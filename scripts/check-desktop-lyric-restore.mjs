import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createApp, nextTick, watch } from 'vue';
import { createPinia, defineStore, storeToRefs } from 'pinia';
import { selectedPersistence } from '../src/store/selectedPersistence.js';
import { normalizeLyricWords } from '../src/utils/desktopLyricTiming.mjs';

const [storeSource, bridgeSource] = await Promise.all([
    readFile('src/store/playerStore.js', 'utf8'),
    readFile('src/utils/desktopLyric.js', 'utf8'),
]);
const executable = source => source.replace(/^import .*\r?$/gm, '').replaceAll('export ', '');
const saved = new Map();
const storage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
const persisted = () => JSON.parse(saved.get('playerStore') || '{}');
const settle = async () => { await nextTick(); await new Promise(setImmediate); await nextTick(); };
const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

function boot(options = {}) {
    const pinia = createPinia().use(selectedPersistence);
    createApp({}).use(pinia);
    const usePlayerStore = runInNewContext(`${executable(storeSource)}\nusePlayerStore;`, {
        defineStore, localStorage: storage, getTogetherPersonalSnapshot: () => null,
    });
    const store = usePlayerStore(pinia);
    const calls = { create: 0, close: 0, query: 0, payloads: [] };
    let closed;
    let request;
    let disposed = 0;
    const api = {
        isLyricWindowVisible: async () => { calls.query++; return options.visibility ?? false; },
        createLyricWindow: async () => { calls.create++; return options.createResult ?? { success: true }; },
        closeLyricWindow: async () => { calls.close++; return options.closeResult ?? { success: true }; },
        updateLyricData: data => calls.payloads.push(data),
        getCurrentLyricData: callback => { request = callback; return () => { request = null; disposed++; }; },
        onDesktopLyricClosed: callback => { closed = callback; return () => { closed = null; disposed++; }; },
    };
    const bridge = runInNewContext(`${executable(bridgeSource)}\n({ initDesktopLyric, destroyDesktopLyric, toggleDesktopLyric });`, {
        watch, storeToRefs, pinia, usePlayerStore, normalizeLyricWords,
        getSongDisplayName: song => song.name || '', window: options.noApi ? {} : { electronAPI: api },
        setTimeout, clearTimeout, setInterval, clearInterval,
    });
    return {
        ...bridge, store, calls,
        closed: () => closed?.(), request: () => request?.(),
        stop() { bridge.destroyDesktopLyric(); store.$dispose(); },
        get disposed() { return disposed; },
    };
}

let app = boot();
app.initDesktopLyric();
await settle();
assert.equal(app.calls.create, 0, 'first launch must not open lyrics by default');
await app.toggleDesktopLyric();
assert.equal(app.store.isDesktopLyricOpen, true);
assert.equal(persisted().desktopLyricEnabled, true, 'open choice persists immediately');
assert.equal('isDesktopLyricOpen' in persisted(), false, 'runtime state must not be restored as an existing native window');
app.stop();
assert.equal(persisted().desktopLyricEnabled, true, 'app shutdown must not clear the choice');

app = boot();
assert.equal(app.store.isDesktopLyricOpen, false);
assert.equal(app.store.desktopLyricEnabled, true);
app.initDesktopLyric();
app.initDesktopLyric();
await settle();
assert.equal(app.calls.create, 1, 'restart restores exactly one window');
assert.equal(app.store.isDesktopLyricOpen, true);
app.request();
assert.ok(['song-change', 'play-state', 'lyric-progress'].every(type => app.calls.payloads.some(data => data.type === type)));
await app.toggleDesktopLyric();
assert.equal(persisted().desktopLyricEnabled, false, 'main-player close choice persists immediately');
app.stop();

app = boot();
app.initDesktopLyric();
await settle();
assert.equal(app.calls.create, 0, 'manual close remains closed after restart');
await app.toggleDesktopLyric();
app.closed();
assert.equal(app.store.isDesktopLyricOpen, false);
assert.equal(persisted().desktopLyricEnabled, false, 'desktop settings close also persists');
app.stop();

saved.set('playerStore', JSON.stringify({ desktopLyricEnabled: true }));
app = boot({ createResult: { success: false } });
app.initDesktopLyric();
await settle();
assert.equal(app.store.isDesktopLyricOpen, false);
assert.equal(app.store.desktopLyricEnabled, true, 'failed restoration must keep the next-start preference');
app.stop();
app = boot({ createResult: Promise.reject(new Error('native window unavailable')) });
app.initDesktopLyric();
await settle();
assert.equal(app.store.desktopLyricEnabled, true);
app.stop();

app = boot({ visibility: true, closeResult: { success: false } });
app.initDesktopLyric();
await settle();
assert.equal(app.calls.create, 0, 'an existing window is reused after renderer reload');
assert.equal(app.store.isDesktopLyricOpen, true);
await app.toggleDesktopLyric();
assert.equal(app.store.desktopLyricEnabled, true, 'failed close does not silently disable restoration');
app.stop();

const visible = deferred();
app = boot({ visibility: visible.promise });
app.initDesktopLyric();
await app.toggleDesktopLyric();
visible.resolve(false);
await settle();
assert.equal(app.calls.create, 1, 'late startup visibility cannot reopen or overwrite a manual toggle');
assert.equal(app.store.isDesktopLyricOpen, true);
app.stop();

const pendingVisibility = deferred();
app = boot({ visibility: pendingVisibility.promise });
app.initDesktopLyric();
app.stop();
pendingVisibility.resolve(false);
await settle();
assert.equal(app.calls.create, 0, 'disposed startup must not create a late window');
assert.equal(app.disposed, 2);

const pendingCreate = deferred();
app = boot({ createResult: pendingCreate.promise });
app.initDesktopLyric();
await settle();
await app.toggleDesktopLyric();
assert.equal(app.calls.create, 1, 'restore and rapid toggles cannot create duplicate windows');
app.stop();
pendingCreate.resolve({ success: true });
await settle();
assert.equal(app.store.isDesktopLyricOpen, false, 'disposed create result must be ignored');

app = boot({ noApi: true });
app.initDesktopLyric();
await settle();
assert.equal(app.calls.create, 0, 'browser-only mode does not attempt native restoration');
assert.equal(app.store.desktopLyricEnabled, true);
app.stop();

console.log('desktop lyric restore checks passed: restart, manual close, shutdown, failure, duplicate and stale IPC guards');
