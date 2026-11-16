// Exercise the real player/Howler lifecycle in Chromium; all output is muted.
const assert = require('node:assert/strict')
const path = require('node:path')

if (!process.versions.electron) {
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
    process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()
// Let assertions propagate through async Vite cleanup before quitting Electron.
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
    let server
    let win
    const errors = []
    const watchdog = setTimeout(() => { console.error('Loudness switching check timed out', errors); app.exit(1) }, 45000)
    try {
        const { createServer } = await import('vite')
        const { default: vue } = await import('@vitejs/plugin-vue')
        const fixture = `<!doctype html><meta charset="UTF-8"><title>Loudness switching check</title><script type="module">
            window.qaErrors = [];
            window.addEventListener('error', event => window.qaErrors.push(event.message));
            window.addEventListener('unhandledrejection', event => window.qaErrors.push(String(event.reason)));
            Storage.prototype.getItem = () => null;
            Storage.prototype.setItem = () => {};
            Storage.prototype.removeItem = () => {};
            await import('/src/utils/windowApiStub.js');
            const { default: pinia } = await import('/src/store/pinia.js');
            const { usePlayerStore } = await import('/src/store/playerStore.js');
            const { play, addSong, stopTogetherPlayback } = await import('/src/utils/player.js');
            const { Howler } = await import('howler');
            const { getAudioContext, createDecodedAudioPlayer } = await import('/src/utils/webAudioGapless.js');
            const store = usePlayerStore(pinia);
            const bytes = new Uint8Array(44 + 48000 * 4 * 5), view = new DataView(bytes.buffer);
            const text = (offset, value) => [...value].forEach((ch, i) => bytes[offset + i] = ch.charCodeAt(0));
            text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVEfmt ');
            view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
            view.setUint32(24, 48000, true); view.setUint32(28, 192000, true);
            view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, bytes.length - 44, true);
            const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
            window.windowApi.toFileUrl = () => url;
            store.$patch({ songList: Array.from({ length: 4 }, (_, index) => ({
                id: index + 1, name: 'Track ' + (index + 1), type: 'local', url: 'fixture-' + index + '.wav', ar: [{ name: 'Test' }],
            })), songId: 1, currentIndex: 0, volume: 0.3, playMode: 1, loudnessNormalization: true });
            const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
            const until = async (condition, label) => {
                const end = performance.now() + 5000;
                while (!condition()) { if (performance.now() > end) throw new Error('Timed out: ' + label); await delay(5); }
            };
            const gateProcessing = playback => {
                const original = playback.setLoudnessNormalization.bind(playback);
                let release;
                const gate = new Promise(resolve => { release = resolve; });
                const state = { entered: false, release };
                playback.setLoudnessNormalization = async enabled => { state.entered = true; await gate; return original(enabled); };
                return state;
            };
            window.runSwitchingChecks = async () => {
                // An unloaded Howl stays current until the next URL resolves.
                play(url, true);
                const pending = store.currentMusic;
                const gate = gateProcessing(pending);
                await until(() => gate.entered, 'normalization setup');
                pending.unload();
                gate.release();
                await delay(50);
                const unloaded = { state: pending.state(), sounds: pending._sounds.length, queued: pending._queue.length };

                // Howler schedules load listeners with setTimeout; unload before they run.
                play(url, true);
                const lateLoad = store.currentMusic;
                lateLoad._emit('load');
                lateLoad.unload();
                await delay(50);
                const late = { sounds: lateLoad._sounds.length, queued: lateLoad._queue.length, processing: lateLoad.__hmProcessingRequest || 0 };

                play(url, true);
                const lateError = store.currentMusic;
                lateError._emit('loaderror', lateError._sounds[0]._id, 'canceled request');
                lateError.unload();
                await delay(50);
                const canceledError = { samePlayback: store.currentMusic === lateError, howls: Howler._howls.length };

                const decoded = await createDecodedAudioPlayer(url);
                const decodedGate = gateProcessing(decoded);
                let decodedPlayCalls = 0;
                const originalPlay = decoded.play.bind(decoded);
                decoded.play = () => { decodedPlayCalls++; return originalPlay(); };
                play(url, true, null, decoded);
                await until(() => decodedGate.entered, 'decoded normalization setup');
                decoded.unload();
                decodedGate.release();
                await delay(50);

                // Repeated actual addSong calls during loading, start and fade-in.
                play(url, true);
                for (let i = 0; i < 48; i++) {
                    addSong(i % 4 + 1, i % 4, true, true);
                    await delay([0, 5, 15, 40][i % 4]);
                }
                await until(() => store.currentMusic?.playing() && store.loudnessNormalizationActive, 'final normalized playback');
                await delay(300);
                const rapid = { id: store.songId, active: store.loudnessNormalizationActive,
                    howls: Howler._howls.length, sounds: store.currentMusic._sounds.length, mode: store.currentMusic.__hmLoudnessMode };
                stopTogetherPlayback();
                Howler.unload();
                await getAudioContext().close();
                URL.revokeObjectURL(url);
                return { unloaded, late, canceledError, decodedPlayCalls, rapid, errors: window.qaErrors };
            };
            window.qaReady = true;
        </script>`
        server = await createServer({
            root: path.resolve(__dirname, '..'), configFile: false,
            plugins: [vue(), { name: 'loudness-switching-fixture', configureServer(vite) {
                vite.middlewares.use(async (req, res, next) => {
                    if (req.url?.split('?')[0] !== '/__loudness-switching.html') return next()
                    res.setHeader('Content-Type', 'text/html; charset=utf-8')
                    res.end(await vite.transformIndexHtml('/__loudness-switching.html', fixture))
                })
            } }],
            server: { host: '127.0.0.1', port: 0, hmr: false },
            optimizeDeps: { noDiscovery: true, include: ['vue', 'pinia', 'pinia-plugin-persistedstate', 'howler', 'axios', 'js-cookie'] },
        })
        await server.listen()
        win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
        win.webContents.setAudioMuted(true)
        win.webContents.on('console-message', event => {
            if (event.details?.level === 'error' || /音频处理不可用|无法创建实时响度节点|实时响度分析不可用/.test(event.details?.message || '')) {
                errors.push(event.details.message)
            }
        })
        await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__loudness-switching.html`)
        await win.webContents.executeJavaScript(`(async () => {
            const end = performance.now() + 15000;
            while (!window.qaReady) { if (performance.now() > end) throw new Error('Fixture failed to load'); await new Promise(resolve => setTimeout(resolve, 10)); }
        })()`)
        const result = await win.webContents.executeJavaScript('runSwitchingChecks()')
        assert.deepEqual(result.unloaded, { state: 'unloaded', sounds: 0, queued: 0 }, 'unload during processing must not resurrect a Howl')
        assert.deepEqual(result.late, { sounds: 0, queued: 0, processing: 0 }, 'ignore a queued load event after unload')
        assert.deepEqual(result.canceledError, { samePlayback: true, howls: 0 }, 'a canceled load error must not recreate playback in CORS fallback mode')
        assert.equal(result.decodedPlayCalls, 0, 'decoded autoplay must also be canceled by unload')
        assert.deepEqual(result.rapid, { id: 4, active: true, howls: 1, sounds: 1, mode: 'realtime' })
        assert.deepEqual(result.errors, [], 'no uncaught errors or rejected promises')
        assert.deepEqual(errors, [], 'no audio-processing failures')
        console.log('Chromium real-player rapid switching: canceled setup, queued load/error, decoded autoplay and 48 addSong calls passed')
    } finally {
        clearTimeout(watchdog)
        win?.destroy()
        await server?.close()
    }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1) })
