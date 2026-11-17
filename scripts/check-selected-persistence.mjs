import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp, watch, nextTick } from 'vue';
import { createPinia, defineStore } from 'pinia';
import persisted from 'pinia-plugin-persistedstate';

const source = await readFile('src/store/selectedPersistence.js', 'utf8');
const plugin = new Function('watch', source.replace("import { watch } from 'vue';", '')
    .replace('export function selectedPersistence', 'function selectedPersistence') + '\nreturn selectedPersistence;')(watch);
const pinia = createPinia();
pinia.use(persisted);
pinia.use(plugin);
createApp({}).use(pinia);
let reads = 0;
let writes = [];
const storage = { getItem: () => JSON.stringify({ progress: 42, volume: 0.7, widgetState: false }),
    setItem: (key, value) => writes.push({ key, value: JSON.parse(value) }) };
const useStore = defineStore('test-player', {
    state: () => ({ progress: 0, volume: 0.3, lyricType: ['original'], listInfo: { type: 'playlist', id: 1 },
        widgetState: true, songList: Array.from({ length: 648 }, (_, id) => ({ id,
            get metadata() { reads++; return { artists: [{ name: 'artist' }], album: { name: 'album' } }; } })) }),
    selectedPersist: { storage, pick: ['progress', 'volume', 'lyricType', 'listInfo'] },
});
const store = useStore(pinia);
assert.equal(store.progress, 42);
assert.equal(store.volume, 0.7);
assert.equal(store.widgetState, true, 'Do not restore fields outside the allowlist');
reads = 0;
store.widgetState = false;
await nextTick();
assert.equal(reads, 0, 'Opening player does not traverse song metadata');
assert.equal(writes.length, 0, 'Non-persisted UI changes do not write storage');
store.progress = 43;
await nextTick();
assert.equal(reads, 0, 'Progress updates do not traverse song metadata');
assert.equal(writes.at(-1).value.progress, 43);
store.lyricType.push('trans');
store.listInfo.id = 2;
await nextTick();
assert.deepEqual(writes.at(-1).value.lyricType, ['original', 'trans']);
assert.equal(writes.at(-1).value.listInfo.id, 2);
assert.ok(!('songList' in writes.at(-1).value));
store.$persist();
assert.equal(reads, 0);
store.$dispose();
const count = writes.length;
store.progress++;
await nextTick();
assert.equal(writes.length, count, 'Dispose stops persistence watchers');

const player = await readFile('src/store/playerStore.js', 'utf8');
assert.match(player, /selectedPersist:/);
assert.doesNotMatch(player, /\n\s+persist:/);
assert.match(player, /getTogetherPersonalSnapshot\(\)/);
assert.match(player, /normalizePlayerStorePayload\(key, localStorage.getItem\(key\)\)/);
console.log('Selected persistence passed: restore allowlist, 648-track zero traversal, nested settings, save and disposal.');
