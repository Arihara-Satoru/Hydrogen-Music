// Integration check: mount the real MusicPlayer and click its actual next-song control.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  process.exit(result.status ?? 1);
}
const { app, BrowserWindow, nativeImage } = require('electron');
const root = path.resolve(__dirname, '..');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  console.log('Checking actual player and visible blink frames...');
  const { createServer } = await import('vite');
  const { default: vue } = await import('@vitejs/plugin-vue');
  const server = await createServer({ root, configFile: false, plugins: [vue(), {name:'cover-playback-fixture', configureServer(s) {
    s.middlewares.use(async (req,res,next) => {
      if(req.url?.split('?')[0] !== '/__player-cover-qa.html') return next();
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.end(await s.transformIndexHtml('/__player-cover-qa.html',fixture));
    });
  }}], resolve:{alias:{'@':path.join(root,'src')}}, server: { host: '127.0.0.1', port: 0, hmr:false },
    optimizeDeps:{noDiscovery:true,include:['vue','vue-router','pinia','axios','howler','js-cookie','pinia-plugin-persistedstate','motion-v','vue-slider-component','qrcode','plyr','vue-virtual-scroller']},
    css: { preprocessorOptions: { scss: { quietDeps: true } } } });
  const fixture = `<!doctype html><html><head><meta charset="UTF-8"><style>html,body,#qa{width:100%;height:100%;margin:0}</style></head><body><div id="qa"></div><script type="module">
    Storage.prototype.setItem = function() {}; Storage.prototype.removeItem = function() {}; Storage.prototype.getItem = function() { return null; };
    await import('/src/utils/windowApiStub.js');
    await Promise.all([import('/src/assets/css/reset.css'),import('/src/assets/css/style.css'),import('/src/assets/css/fonts.css'),import('/src/assets/css/theme.css')]);
    const {createApp, nextTick, markRaw} = await import('vue');
    const {default:pinia} = await import('/src/store/pinia.js');
    const {usePlayerStore} = await import('/src/store/playerStore.js');
    const {createRouter, createMemoryHistory} = await import('vue-router');
    const {default:MusicPlayer} = await import('/src/views/MusicPlayer.vue');
    const {vDelayedTooltip} = await import('/src/utils/delayedTooltip.js');
    const {addSong, play} = await import('/src/utils/player.js');
    const store = usePlayerStore(pinia);
    const cover = n => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="'+(n%2?'#d9c358':'#245b61')+'"/><text x="300" y="320" text-anchor="middle" font-size="100">'+n+'</text></svg>');
    window.pendingCovers = [];
    window.windowApi.getLocalMusicImage = url => new Promise(resolve => window.pendingCovers.push({url,resolve}));
    const bytes = new Uint8Array(44 + 128000), view = new DataView(bytes.buffer);
    const text=(at,s)=>[...s].forEach((ch,i)=>bytes[at+i]=ch.charCodeAt(0));
    text(0,'RIFF');view.setUint32(4,bytes.length-8,true);text(8,'WAVEfmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,bytes.length-44,true);
    const audioUrl = URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
    window.windowApi.toFileUrl = () => audioUrl;
    store.$patch({ songList:Array.from({length:5},(_,i)=>({id:i+1,name:'Track '+(i+1),type:'local',url:'qa-'+i+'.wav',ar:[{name:'Hydrogen'}],format:{duration:8}})),songId:1,currentIndex:0,listInfo:{type:'local'},widgetState:false,lyricShow:true,volume:0,localBase64Img:cover(1) });
    const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}}]});
    createApp(MusicPlayer).use(pinia).use(router).directive('delayed-tooltip',vDelayedTooltip).mount('#qa');
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    window.recordNext = async (index, releaseDelay = 0, preloaded = false) => {
      const samples = [], started = performance.now(); let released = false;
      const oldStage = document.querySelector('.cover-stage');
      const oldCorners = document.querySelector('.cover-corners');
      if(preloaded) {
        // Same-track restart through the real addSong/play code: begin and completion share a Vue update.
        store.currentMusic = markRaw({unload(){}});
        addSong(store.songId, store.currentIndex, false, true);
        play('qa-preloaded', false, null, {loop(){},rate(){},volume(){},on(){},duration(){return 8},seek(){return 0},unload(){} });
      } else {
        document.querySelector('.player-control .control').lastElementChild.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      }
      while(performance.now()-started < 1800) {
        await frame();
        const t = performance.now()-started;
        if(!released && window.pendingCovers.length && t >= releaseDelay) { window.pendingCovers.splice(0).forEach(item=>item.resolve(cover(index+1))); released=true; }
        const corners=[...document.querySelectorAll('.c-border')], corner=corners[0], style=getComputedStyle(corner), stage=document.querySelector('.cover-stage');
        const cueLayer = document.querySelector('.cover-corners'), cueOpacity = Number(getComputedStyle(cueLayer).opacity);
        const motions=[...cueLayer.getAnimations(),...corner.getAnimations()].map(a=>({name:a.animationName,time:a.currentTime,delay:a.effect.getTiming().delay,state:a.playState}));
        samples.push({t, id:store.songId, changing:store.playerChangeSong, skeleton:!!document.querySelector('.cover-skeleton'),
          classes:document.querySelector('.player-cover').className,opacity:Number(style.opacity)*cueOpacity,transform:getComputedStyle(stage).transform,motions,
          imageOpacity:Number(getComputedStyle(document.querySelector('.cover img')).opacity),
          synchronized:corners.every(el=>getComputedStyle(el).opacity===style.opacity),
          newCorners:oldCorners!==document.querySelector('.cover-corners'),sameStage:oldStage===stage});
      }
      return samples;
    };
    window.prepareVisualBlink = async () => {
      document.querySelector('.player-control .control').firstElementChild.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      await nextTick();
      const deadline=performance.now()+3000;
      while(document.querySelector('.cover-skeleton') || !document.querySelector('.cover-replay')) {
        await frame(); window.pendingCovers.splice(0).forEach(item=>item.resolve(cover(3)));
        if(performance.now()>deadline)throw new Error('Visual blink did not start');
      }
      await nextTick();await frame();
      const cue=document.querySelector('.cover-corners').getAnimations()[0];cue.pause();cue.currentTime=155;
      await Promise.all(document.querySelector('.cover img').getAnimations().map(a=>a.finished));
      window.visualCue=cue;
      const r=document.querySelector('.cover-stage').getBoundingClientRect();
      return {x:Math.floor(r.x),y:Math.floor(r.y),width:Math.ceil(r.width),height:Math.ceil(r.height)};
    };
    window.visualBlinkFrame = async time => {
      window.visualCue.currentTime=time;await frame();await frame();
      return {released:document.querySelector('.player-cover').classList.contains('cover-released'),
        expanded:document.querySelector('.c-border').getAnimations().length>0,connected:window.visualCue.effect.target.isConnected,
        opacity:getComputedStyle(document.querySelector('.cover-corners')).opacity,playState:window.visualCue.playState};
    };
    await document.querySelector('.cover img').decode(); await nextTick();
    await Promise.all(document.querySelector('.cover-stage').getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));
    window.qaReady=true;
  </script></body></html>`;
  await server.listen();
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const errors = [];
  const watchdog = setTimeout(()=>{console.error('Real-player playback fixture timed out', errors);app.exit(1);},30000);
  win.webContents.on('console-message', (event) => { if (event.details?.level === 'error') errors.push(event.details.message); });
  try {
    await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__player-cover-qa.html`);
    console.log('Real player fixture loaded.');
    await win.webContents.executeJavaScript(`(async()=>{const end=performance.now()+15000;while(!window.qaReady){await new Promise(requestAnimationFrame);if(performance.now()>end)throw new Error('Fixture failed to mount');}})()`);
    for (let index = 1; index <= 4; index++) {
      const samples = await win.webContents.executeJavaScript(`recordNext(${index}, ${index === 2 ? 700 : 0}, ${index === 4})`);
      const blink = samples.filter(s=>s.classes.includes('cover-replay') && !s.classes.includes('waiting') && !s.skeleton);
      const states = blink.map(s=>s.opacity>.5?1:0).filter((s,i,a)=>i===0||s!==a[i-1]);
      fs.mkdirSync(path.join(root, 'output/player-cover-animation'), {recursive:true});
      fs.writeFileSync(path.join(root, `output/player-cover-animation/playback-${index}.json`), JSON.stringify({states,samples,errors},null,2));
      assert.ok(states.join('').includes('010101'), `Actual next-song click ${index}: observe two flashes, got ${states}`);
      assert.ok(samples.every(sample=>sample.id===Math.min(index+1,4)), 'Observe the selected track only, without a subsequent automatic song change');
      assert.ok(blink.every(sample=>sample.synchronized && sample.sameStage && sample.newCorners), 'Fresh corner animation nodes stay synchronized without rebuilding cover layout');
      const offSamples = blink.filter(sample=>sample.motions.find(a=>a.name.includes('dialog-entry-cue'))?.state==='running' && sample.opacity===0);
      assert.ok(offSamples.some(sample=>sample.imageOpacity>.95), 'Blink remains visible after the real cover has faded in');
      assert.ok(blink.filter(sample=>sample.motions.some(m=>m.name.includes('dialog-entry-cue')&&m.state==='running'))
        .every(sample=>!sample.classes.includes('cover-released') && sample.transform==='matrix(1.04, 0, 0, 1.04, 0, 0)'), 'Never expand or shrink before the double blink ends');
    }
    const clip=await win.webContents.executeJavaScript('prepareVisualBlink()');
    console.log('Capturing the two visible blink cycles.');
    win.webContents.debugger.attach('1.3');
    const bitmaps=[];
    for(const [name,time] of [['lit-1',155],['off-1',205],['lit-2',255],['off-2',305]]) {
      const gate=await win.webContents.executeJavaScript(`visualBlinkFrame(${time})`);
      assert.ok(!gate.released&&!gate.expanded&&gate.connected,`Movement remains blocked throughout ${name}: ${JSON.stringify(gate)}`);
      const capture=await win.webContents.debugger.sendCommand('Page.captureScreenshot',{format:'png',clip:{...clip,scale:1}});
      const image=nativeImage.createFromBuffer(Buffer.from(capture.data,'base64'));
      fs.writeFileSync(path.join(root,`output/player-cover-animation/visible-${name}.png`),image.toPNG());
      bitmaps.push(image.toBitmap());
    }
    const changedPixels=(a,b)=>{let count=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])>100)count++;return count;};
    assert.ok(changedPixels(bitmaps[0],bitmaps[1])>100,'First flash visibly changes rendered pixels');
    assert.ok(changedPixels(bitmaps[2],bitmaps[3])>100,'Second flash visibly changes rendered pixels');
    assert.ok(changedPixels(bitmaps[0],bitmaps[2])<10 && changedPixels(bitmaps[1],bitmaps[3])<10,'Both flashes render the same attached artwork and corners');
    assert.deepEqual(errors, [], 'No runtime errors in the real player');
    console.log('Real-player cover playback check passed: actual next controls, stores, audio load, asynchronous covers, repeated switching and synchronous preloaded restart.');
  } finally { clearTimeout(watchdog); win.destroy(); await server.close(); }
}).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
