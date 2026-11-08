// Real Chromium AudioWorklet smoke test. Requires `pnpm build` first; never plays audio to speakers.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

if (!process.versions.electron) {
    const { spawnSync } = require('node:child_process')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true })
    process.exit(result.status ?? 1)
}

const { app, BrowserWindow } = require('electron')
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
    let win
    let directory
    try {
        const assets = path.resolve(__dirname, '../dist/assets')
        const worklet = fs.readdirSync(assets).find(file => /^adaptiveLoudness\.worklet-.*\.js$/.test(file))
        assert.ok(worklet, 'run pnpm build first')
        const tempRoot = process.env.LOCALAPPDATA
            ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : app.getPath('temp')
        fs.mkdirSync(tempRoot, { recursive: true })
        directory = fs.mkdtempSync(path.join(tempRoot, 'loudness-audio-'))
        fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><title>AudioWorklet test</title>')
        // Synthetic local audio fixture only; production analysis never creates a full-track copy.
        const wav = Buffer.alloc(44 + 48000 * 2 * 2)
        wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
        wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22)
        wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(48000 * 4, 28)
        wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36)
        wav.writeUInt32LE(wav.length - 44, 40)
        for (let frame = 0; frame < 48000; frame++) {
            const sample = Math.round(24000 * Math.sin(2 * Math.PI * 1000 * frame / 48000))
            wav.writeInt16LE(sample, 44 + frame * 4); wav.writeInt16LE(sample, 46 + frame * 4)
        }
        fs.writeFileSync(path.join(directory, 'audio.wav'), wav)
        win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
        win.webContents.setAudioMuted(true)
        await win.loadFile(path.join(directory, 'index.html'))
        const workletUrl = pathToFileURL(path.join(assets, worklet)).href
        const adaptiveSource = fs.readFileSync(path.resolve(__dirname, '../src/utils/adaptiveLoudness.mjs'), 'utf8')
            .replace(/^import .*$/m, `const workletUrl = ${JSON.stringify(workletUrl)}`)
            .replace(/^export /gm, '')
        const gaplessSource = fs.readFileSync(path.resolve(__dirname, '../src/utils/webAudioGapless.js'), 'utf8')
            .replace(/^import .*$/gm, '').replace(/^export /gm, '')
        const loudnessSource = fs.readFileSync(path.resolve(__dirname, '../src/utils/loudnessNormalization.mjs'), 'utf8')
            .replace(/^import .*$/gm, '').replace(/^export /gm, '')
        await win.webContents.executeJavaScript(`${adaptiveSource}\n${gaplessSource}\n${loudnessSource}\nvoid 0`)
        const result = await win.webContents.executeJavaScript(`(async () => {
            const seconds = 20;
            const rate = 48000;
            const audio = new OfflineAudioContext(2, rate * seconds, rate);
            const buffer = audio.createBuffer(2, rate * seconds, rate);
            for (let channel = 0; channel < 2; channel++) {
                const samples = buffer.getChannelData(channel);
                for (let i = 0; i < samples.length; i++) {
                    const time = i / rate;
                    const amplitude = time < 2 ? 0 : time < 16 ? 0.04 : 0.95;
                    samples[i] = amplitude * Math.sin(2 * Math.PI * 1000 * time);
                }
            }
            const source = audio.createBufferSource();
            source.buffer = buffer;
            const adaptive = await createAdaptiveLoudness(audio, 'offline-fixture');
            if (!adaptive.realtime) throw new Error('worklet helper unexpectedly fell back');
            const node = adaptive.node;
            let processorError = false;
            node.onprocessorerror = () => { processorError = true; };
            source.connect(node).connect(audio.destination);
            source.start();
            const start = performance.now();
            const rendered = await audio.startRendering();
            const elapsed = performance.now() - start;
            const samples = rendered.getChannelData(0);
            const rms = (from, to) => {
                let sum = 0;
                const first = Math.round(from * rate);
                const last = Math.round(to * rate);
                for (let i = first; i < last; i++) sum += samples[i] ** 2;
                return Math.sqrt(sum / (last - first));
            };
            let peak = 0;
            for (const value of samples) peak = Math.max(peak, Math.abs(value));
            adaptive.dispose();
            return { elapsed, seconds, processorError, peak, silence: rms(0, 2),
                quietStart: rms(2, 2.4), quietAcquired: rms(3.2, 4.2), quietLater: rms(14, 15), loudLater: rms(17, 19) };
        })()`)
        assert.equal(result.processorError, false)
        assert.equal(result.silence, 0)
        assert.ok(result.quietStart > 0 && result.quietStart < 0.012)
        assert.ok(result.quietAcquired > result.quietStart * 2)
        assert.ok(Math.abs(20 * Math.log10(result.quietLater / result.quietAcquired)) < 0.25, 'no audible long upward ramp after 1.2s of valid signal')
        assert.ok(result.loudLater > 0.13 && result.loudLater < 0.15, 'steady stereo test tone should converge near the -14 target after the quiet intro')
        assert.ok(result.peak <= 0.950001)
        console.log('Chromium AudioWorklet file:// production asset, fast acquisition/steady level and quiet-to-loud transition passed:', JSON.stringify(result))
        await win.webContents.executeJavaScript(fs.readFileSync(require.resolve('howler/dist/howler.js'), 'utf8'))
        const routing = await win.webContents.executeJavaScript(`(async () => {
            const url = ${JSON.stringify(pathToFileURL(path.join(directory, 'audio.wav')).href)};
            const player = new Howl({ src: [url], html5: true, volume: 0.3, autoplay: false });
            prepareHowlAudioProcessing(player);
            await new Promise((resolve, reject) => { player.once('load', resolve); player.once('loaderror', (_id, error) => reject(new Error(String(error)))); });
            await player.setLoudnessNormalization(true);
            const mode = player.__hmLoudnessMode;
            player.play();
            await new Promise(resolve => setTimeout(resolve, 200));
            player.pause();
            player.seek(0.5);
            const userVolume = player.volume();
            await player.setLoudnessNormalization(false);
            const disabledMode = player.__hmLoudnessMode;
            await player.setLoudnessNormalization(true);
            const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'volume');
            const nativeVolume = native.get.call(player._sounds[0]._node);
            player.unload();
            const fallback = new Howl({ src: [url], html5: true, volume: 0.3, autoplay: false });
            prepareProtectedPlayback(fallback);
            fallback.setLoudnessProtection(0.25);
            const protectedVolume = native.get.call(fallback._sounds[0]._node);
            fallback.unload();
            const decoded = await createDecodedAudioPlayer(url);
            await decoded.setLoudnessNormalization(true);
            const decodedMode = decoded.__hmLoudnessMode;
            await decoded.play();
            decoded.pause();
            decoded.seek(0.5);
            decoded.unload();
            await getAudioContext().close();
            return { mode, decodedMode, disabledMode, userVolume, nativeVolume, protectedVolume };
        })()`)
        assert.equal(routing.mode, 'realtime')
        assert.equal(routing.decodedMode, 'realtime')
        assert.equal(routing.disabledMode, 'off')
        assert.equal(routing.userVolume, 0.3)
        assert.equal(routing.nativeVolume, 1)
        assert.ok(Math.abs(routing.protectedVolume - 0.075) < 1e-6)
        console.log('Chromium real Howler/decoded routing, pause/seek, unified toggle, native-volume protection and unload passed')
    } catch (error) {
        process.exitCode = 1
        console.error(error)
    } finally {
        win?.destroy()
        if (directory) {
            fs.unlinkSync(path.join(directory, 'index.html'))
            fs.unlinkSync(path.join(directory, 'audio.wav'))
            fs.rmdirSync(directory)
        }
        app.exit(process.exitCode || 0)
    }
}).catch(error => { console.error(error); app.exit(1) })
