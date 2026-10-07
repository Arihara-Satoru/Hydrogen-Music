import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createApp, nextTick, ref } from 'vue';
import { createPinia, defineStore } from 'pinia';
import persistedState from 'pinia-plugin-persistedstate';

const saved = new Map();
const storage = {
  getItem: key => saved.get(key) ?? null,
  setItem: (key, value) => saved.set(key, value),
};
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const stripImports = source => source.replace(/^[ \t]*import .*\r?$/gm, '');
const useOtherStore = runInNewContext(
  stripImports(read('../src/store/otherStore.js')).replace('export const', 'const') + '\nuseOtherStore;',
  { defineStore, localStorage: storage },
);
const restart = () => {
  const pinia = createPinia().use(persistedState);
  createApp({}).use(pinia);
  return useOtherStore(pinia);
};
const notify = (store, info) => {
  const listener = read('../src/App.vue').match(/disposeCheckUpdate = windowApi\.checkUpdate\([\s\S]*?\n\}\);/)[0];
  runInNewContext(listener, {
    otherStore: store,
    windowApi: { checkUpdate: callback => callback(info) },
  });
};

let store = restart();
notify(store, { version: '0.7.1' });
assert.equal(store.toUpdate, true);
const close = runInNewContext(
  stripImports(read('../src/components/Update.vue').match(/<script setup>([\s\S]*?)<\/script>/)[1].trim()) + '\nclose;',
  { ref, useOtherStore: () => store, setTimeout: callback => callback() },
);
close();
await nextTick();
assert.equal(store.toUpdate, false);
assert.equal(store.updateInfo, null);
assert.deepEqual(JSON.parse(saved.get('otherStore')), { ignoredUpdateVersion: '0.7.1' });

store = restart();
notify(store, { version: '0.7.1' });
assert.equal(store.toUpdate, false, 'ignored version must stay hidden after restarting');
notify(store, null);
assert.equal(store.toUpdate, false, 'missing version must not open an empty prompt');
notify(store, { version: '0.7.2', releaseNotes: 'New release' });
assert.equal(store.toUpdate, true, 'a newer release must still prompt');
assert.equal(store.updateInfo.releaseNotes, 'New release');
store.toUpdate = false;
notify(store, '0.7.3');
assert.equal(store.toUpdate, true, 'legacy string notifications must still prompt');
assert.equal(store.updateInfo.version, '0.7.3');
console.log('update ignore and persistence checks passed');
