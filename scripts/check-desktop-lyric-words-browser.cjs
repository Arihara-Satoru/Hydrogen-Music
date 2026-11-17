const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (!process.versions.electron) {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
    process.exit(result.status ?? 1);
}
const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const root = path.resolve(__dirname, '..');

app.whenReady().then(async () => {
    let server;
    let win;
    const deadline = setTimeout(() => { console.error('Desktop word check exceeded 75s'); app.exit(1); }, 75000);
    try {
        const { createServer } = await import('vite');
        const { default: vue } = await import('@vitejs/plugin-vue');
        const fixture = `<!doctype html><html><head><meta charset="UTF-8"><style>html,body,#qa{width:100%;height:100%;margin:0}</style></head><body><div id="qa"></div><script type="module">
            const { createApp, nextTick } = await import('vue');
            await import('/src/assets/css/fonts.css');
            const { ONBOARDING_STEPS } = await import('/src/utils/onboarding.mjs');
            const config = { selectedLyricType: 'auto', transparentMode: false };
            Storage.prototype.getItem = key => key === 'hydrogen:onboarding'
                ? JSON.stringify({completedStepIds: ONBOARDING_STEPS.map(item => item.id)})
                : key === 'hydrogen:desktop-lyric-config:v1' ? JSON.stringify(config) : null;
            Storage.prototype.setItem = () => {};
            Storage.prototype.removeItem = () => {};
            let update;
            window.electronAPI = { onLyricUpdate(callback) { update = callback; return () => {}; } };
            const { default: DesktopLyric } = await import('/src/components/DesktopLyric.vue');
            const instance = createApp(DesktopLyric);
            instance.config.errorHandler = error => { console.error(error.stack); throw error; };
            instance.mount('#qa');
            const { normalizeKugouKrcLyric } = await import('/src/utils/kugouLyric.js');
            const { buildLyricsTimeline } = await import('/src/utils/lyricCore.js');
            const krc = normalizeKugouKrcLyric('[10000,4000]<0,500,0>你<1500,2000,0>好\\n[14000,4000]<0,1000,0>下<1000,1000,0>句');
            const lines = buildLyricsTimeline({lrc:{lyric:krc.originalLyricText},wordTimings:krc.wordTimings,tlyric:{lyric:'[00:10.00]Hello\\n[00:14.00]Next'}});
            window.send = async data => { update(null, data); await nextTick(); await new Promise(requestAnimationFrame); };
            window.song = async (timed = true) => window.send({type:'song-change',song:{name:'逐字测试',ar:[{name:'Hydrogen'}]},lyrics:timed?lines:lines.map(({words,...row})=>row)});
            window.progress = (time, extra = {}) => window.send({type:'lyric-progress',currentIndex:0,currentTime:time,duration:30,playbackRate:1,...extra});
            window.readWords = () => [...document.querySelectorAll('.lyric-word')].map(el=>({text:el.textContent,progress:parseFloat(el.style.getPropertyValue('--word-progress')),clip:getComputedStyle(el,'::after').clipPath,color:getComputedStyle(el,'::after').color}));
            window.frames = async count => {for(let i=0;i<count;i++)await new Promise(requestAnimationFrame);};
            window.unmount = () => instance.unmount();
            window.checkBridge = async () => {
                const { markRaw } = await import('vue');
                const { default: pinia } = await import('/src/store/pinia.js');
                const { usePlayerStore } = await import('/src/store/playerStore.js');
                const { initDesktopLyric, destroyDesktopLyric } = await import('/src/utils/desktopLyric.js');
                const store = usePlayerStore(pinia);
                let request;
                const updates = [];
                window.electronAPI = {
                    isLyricWindowVisible: async () => true,
                    updateLyricData: payload => updates.push(payload),
                    getCurrentLyricData: callback => { request = callback; return () => {}; },
                    onDesktopLyricClosed: () => () => {},
                };
                store.$patch({songList:[{name:'Bridge',ar:[]}],currentIndex:0,songId:'bridge',lyricsObjArr:lines,
                    playing:true,isDesktopLyricOpen:true,progress:1,time:30,playbackRate:1.5,
                    currentMusic:markRaw({seek:()=>12.5,playing:()=>true})});
                initDesktopLyric();
                await nextTick();
                request();
                const songPayload = updates.findLast(payload => payload.type === 'song-change');
                const progressPayload = updates.findLast(payload => payload.type === 'lyric-progress');
                destroyDesktopLyric();
                const count = updates.length;
                await window.frames(25);
                return {songPayload,progressPayload,stopped:updates.length === count};
            };
            window.ready = true;
        </script></body></html>`;
        server = await createServer({
            root, configFile: false,
            plugins: [vue(), { name: 'desktop-words-fixture', configureServer(s) {
                s.middlewares.use(async (req, res, next) => {
                    if (req.url?.split('?')[0] !== '/__desktop-words.html') return next();
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    res.end(await s.transformIndexHtml('/__desktop-words.html', fixture));
                });
            } }],
            server: { host: '127.0.0.1', port: 0, hmr: false },
            optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-router', 'pinia', 'pinia-plugin-persistedstate'] },
        });
        await server.listen();
        console.log('Desktop word check: mounting real component');
        win = new BrowserWindow({ show: false, width: 820, height: 360, webPreferences: { offscreen: true, backgroundThrottling: false } });
        const errors = [];
        win.webContents.on('console-message', details => {
            if (details.level === 'error') { errors.push(details.message); console.error(details.message); }
        });
        await win.loadURL(`${server.resolvedUrls.local[0]}__desktop-words.html`);
        const run = async code => {
            const statement = code.trim().replace(/;$/, '');
            const body = statement.includes(';') ? statement : `return ${statement}`;
            try { return await win.webContents.executeJavaScript(`(async()=>{${body}})()`); }
            catch (error) { throw new Error(`Browser step failed: ${code}`, { cause: error }); }
        };
        await run(`await (async()=>{for(let i=0;!window.ready;i++){if(i>600)throw Error('fixture did not mount');await new Promise(requestAnimationFrame);}})()`);
        console.log('Desktop word check: timing, pause, seek and sources');
        await run('await song(); await frames(5);');
        await run('progress(10.25);');
        let words = await run('readWords()');
        assert.deepEqual(words.map(word => word.text), ['你', '好']);
        assert.equal(words[0].progress, 50);
        assert.equal(words[1].progress, 0);
        await run('progress(11);');
        words = await run('readWords()');
        assert.equal(words[0].progress, 100);
        assert.equal(words[1].progress, 0, 'instrumental gap does not color the next word');
        await run('progress(12.5);');
        words = await run('readWords()');
        assert.equal(words[1].progress, 50);
        assert.equal(words[1].clip, 'inset(0px 50% 0px 0px)');
        assert.equal(await run(`document.querySelector('.current-line__text').getAttribute('aria-label')`), '你好');
        await run(`await send({type:'play-state',playing:true}); await progress(11.5,{playbackRate:2}); await frames(8);`);
        const advancing = await run('readWords()[1].progress');
        assert.ok(advancing > 5, 'local clock animates between IPC updates');
        await run(`await send({type:'play-state',playing:false}); await progress(12.5);`);
        const paused = await run('readWords()[1].progress');
        await run('frames(8)');
        assert.equal(await run('readWords()[1].progress'), paused, 'pause freezes word fill');
        await run(`await send({type:'play-state',playing:true}); await progress(12.5,{advancing:false}); await frames(8);`);
        assert.equal(await run('readWords()[1].progress'), 50, 'buffering does not extrapolate');
        await run(`await send({type:'play-state',playing:false}); await progress(10.1);`);
        assert.ok(Math.abs(await run('readWords()[0].progress') - 20) < 0.001, 'seek backwards clears previous fill');
        await run('await progress(14.5); await frames(5);');
        assert.deepEqual(await run('readWords().map(word=>word.text)'), ['下', '句'], 'line switches immediately without the main-view index');

        await run(`document.querySelector('button[aria-label="打开桌面歌词设置"]').click(); await frames(2);`);
        await run(`document.querySelector('input[value="trans"]').click(); await frames(5);`);
        assert.equal(await run(`document.querySelector('.current-line__text').textContent.trim()`), 'Next');
        assert.equal(await run('readWords().length'), 0, 'translation never borrows original word timing');
        await run(`document.querySelector('input[value="original"]').click(); await frames(5);`);
        assert.equal(await run('readWords().length'), 2);
        await run(`document.querySelector('button[aria-label="关闭歌词设置"]').click(); await frames(25);`);
        for (const [width, height] of [[820, 360], [360, 640]]) {
            win.setSize(width, height);
            await run('frames(4)');
            assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false);
            const dir = path.join(root, 'output', 'desktop-lyric-words');
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `words-${width}.png`), (await win.webContents.capturePage()).toPNG());
        }
        win.setSize(820, 360);
        console.log('Desktop word check: transparent mode');
        await run(`document.querySelector('button[aria-label="打开桌面歌词设置"]').click(); await frames(25);`);
        await run(`document.querySelectorAll('.mode-options input')[1].click(); await frames(4);`);
        await run(`await progress(12.5); await frames(25);`);
        assert.equal(await run(`document.querySelector('.endfield-lyric').classList.contains('is-transparent')`), true);
        words = await run('readWords()');
        assert.equal(words[1].progress, 50);
        assert.equal(words[1].color, 'rgb(255, 250, 0)');
        fs.writeFileSync(path.join(root, 'output', 'desktop-lyric-words', 'words-transparent.png'), (await win.webContents.capturePage()).toPNG());
        const wrapped = await run(`
            const text = '逐字歌词换行后也会依次高亮，不会同时涂亮上下两行';
            const words = Array.from(text, (text,index)=>({text,startTime:10+index*.2,duration:.2}));
            await send({type:'song-change',song:{name:'长句测试'},lyrics:[{time:10,lyric:text,words}]});
            await progress(12.1); await frames(5);
            document.querySelector('.current-line__text').style.width = '180px';
            await frames(2);
            return [...document.querySelectorAll('.lyric-word')].map(el=>({top:el.getBoundingClientRect().top,progress:parseFloat(el.style.getPropertyValue('--word-progress'))}));
        `);
        assert.ok(new Set(wrapped.map(word => word.top)).size > 1, 'long lyrics actually wrap');
        assert.ok(wrapped[0].progress === 100 && wrapped.at(-1).progress === 0, 'wrapped words retain independent fill');
        await run('await song(); await progress(12.5); await frames(5);');
        await run('song(false); await progress(10.5); await frames(30);');
        assert.equal(await run('readWords().length'), 0, 'ordinary LRC fallback still renders');
        assert.equal(await run(`document.querySelector('.current-line__text').textContent.trim()`), '你好');
        console.log('Desktop word check: compact settings source height');
        for (const height of [220, 280, 330]) {
            win.setContentSize(760, height);
            for (const count of [2, 3, 4]) {
                const sources = await run(`
                    await send({type:'song-change',song:{name:'设置布局测试'},lyrics:[{
                        time:0,lyric:'原文',tlyric:${count >= 3 ? "'翻译'" : "''"},rlyric:${count >= 4 ? "'roma'" : "''"}
                    }]});
                    if(!document.querySelector('.control-dock'))document.querySelector('button[aria-label="打开桌面歌词设置"]').click();
                    await frames(25);
                    return [...document.querySelectorAll('.source-option')].map(el=>({
                        height:el.getBoundingClientRect().height,
                        textFits:el.querySelector('strong').scrollWidth <= el.querySelector('strong').clientWidth
                    }));
                `);
                assert.equal(sources.length, count);
                assert.ok(sources.every(source => source.height <= 40), `${height}px / ${count} sources must not stretch: ${JSON.stringify(sources)}`);
                assert.ok(sources.every(source => source.textFits), 'compact source labels must remain readable');
                if (height === 220 && count === 2) {
                    fs.writeFileSync(path.join(root, 'output', 'desktop-lyric-words', 'settings-compact.png'), (await win.webContents.capturePage()).toPNG());
                }
            }
        }
        await run('unmount();');
        console.log('Desktop word check: main-window bridge');
        const bridge = await run('checkBridge()');
        assert.deepEqual(bridge.songPayload.lyrics[0].words.map(word => word.text), ['你', '好']);
        assert.equal(bridge.progressPayload.currentTime, 12.5, 'bridge reads actual audio position, not the stale 1-second store sample');
        assert.equal(bridge.progressPayload.playbackRate, 1.5);
        assert.equal(bridge.progressPayload.advancing, true);
        assert.equal(bridge.stopped, true, 'destroy releases IPC interval and watchers');
        assert.deepEqual(errors, []);
        console.log('desktop lyric word browser check passed');
    } finally {
        clearTimeout(deadline);
        win?.destroy();
        await server?.close();
    }
}).then(() => app.exit(0)).catch(error => { console.error(error); app.exit(1); });
