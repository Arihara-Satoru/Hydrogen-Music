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
// Keep the process alive until async cleanup finishes so assertion failures cannot exit as a false success.
app.on('window-all-closed', () => {});

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
    const {default:Title} = await import('/src/components/Title.vue');
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
    let videoUrl;
    window.windowApi.toFileUrl = file => file === 'qa-video.webm' ? videoUrl : audioUrl;
    store.$patch({ songList:Array.from({length:5},(_,i)=>({id:i+1,name:'Track '+(i+1),type:'local',url:'qa-'+i+'.wav',ar:[{name:'Hydrogen'}],format:{duration:8}})),songId:1,currentIndex:0,listInfo:{type:'local'},widgetState:false,lyricShow:true,volume:0,localBase64Img:cover(1) });
    const router=createRouter({history:createMemoryHistory(),routes:[{path:'/',component:{render:()=>null}}]});
    createApp({components:{MusicPlayer,Title},template:'<div style="position:fixed;top:20px;left:45px;z-index:100"><Title /></div><MusicPlayer />'})
      .use(pinia).use(router).directive('delayed-tooltip',vDelayedTooltip).mount('#qa');
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
    window.recordNext = async (index, releaseDelay = 0, preloaded = false) => {
      const samples = [], started = performance.now(); let released = preloaded;
      const oldStage = document.querySelector('.cover-stage');
      const oldCorners = document.querySelector('.cover-corners');
      if(preloaded) {
        // Same-track restart through the real addSong/play code: begin and completion share a Vue update.
        store.currentMusic?.unload?.();
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
        samples.push({t, id:store.songId, changing:store.playerChangeSong, skeleton:!!document.querySelector('.cover-skeleton'),coverResolved:released,
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
    window.prepareVideoPanels = async mode => {
      if(!videoUrl) {
        // Exercise the real PlayerVideo/Plyr with a local, deterministic video rather than a broken media URL.
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
        const ctx=canvas.getContext('2d'),stream=canvas.captureStream(30),chunks=[];
        const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
        recorder.ondataavailable=e=>chunks.push(e.data);
        const stopped=new Promise(resolve=>recorder.onstop=resolve);
        recorder.start();
        for(let i=0;i<8;i++){ctx.fillStyle='#bbcbd0';ctx.fillRect(0,0,640,360);ctx.fillStyle='#30464d';ctx.fillRect(80+i,80,480,200);await frame();}
        recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
        videoUrl=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));
      }
      store.musicVideoMode=mode;store.musicVideo=true;
      await nextTick();await frame();
      store.currentMusicVideo={id:store.songId,path:'qa-video.webm',source:mode==='pool'?'local-pool':undefined,
        timing:[{start:0,end:8,videoTiming:0}]};
      store.videoIsPlaying=true;store.playerShow=false;
      await nextTick();await frame();
      const video=document.querySelector('.back-video video');
      if(video.readyState<2)await new Promise((resolve,reject)=>{video.addEventListener('loadeddata',resolve,{once:true});video.addEventListener('error',()=>reject(new Error('Video fixture failed')),{once:true});});
      await Promise.all(document.querySelector('.player-container').getAnimations().map(a=>a.finished.catch(()=>{})));
    };
    window.openPanels = async (fromVideo, interrupt=false) => {
      const stage=document.querySelector('.cover-stage'),image=document.querySelector('.player-cover img'),video=document.querySelector('.back-video video');
      const oldCue=document.querySelector('.cover-corners').getAnimations()[0];
      if(fromVideo)document.querySelector('.title-player').click();
      else {store.widgetState=true;await nextTick();await frame();store.widgetState=false;}
      await nextTick();await frame();
      const shell=document.querySelector('.player-container').getAnimations()[0],cue=document.querySelector('.cover-corners').getAnimations()[0];
      const opening={shell:shell.animationName,delay:cue.effect.getTiming().delay,time:cue.currentTime,newCue:cue!==oldCue,
        sameStage:stage===document.querySelector('.cover-stage'),sameImage:image===document.querySelector('.player-cover img'),
        sameVideo:video===document.querySelector('.back-video video'),active:document.querySelector('.player-container').classList.contains('player-active')};
      shell.pause();cue.pause();
      if(interrupt){document.querySelector('.player-cover .cover').click();await nextTick();await frame();return opening;}
      const samples=[];
      for(const time of [0,600,899,900,1055,1105,1155,1205,1249]) {
        shell.currentTime=time;cue.currentTime=time;await frame();await frame();
        if(!cue.effect.target.isConnected)throw new Error('Entry cue replaced unexpectedly');
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
        samples.push({time,panel:rect('.player-container'),artwork:rect('.cover-artwork'),corner:rect('.c-border'),
          transform:getComputedStyle(stage).transform,opacity:getComputedStyle(cue.effect.target).opacity,
          released:document.querySelector('.player-cover').classList.contains('cover-released')});
      }
      cue.finish();await frame();await nextTick();
      await Promise.all(stage.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));
      return {opening,samples,released:document.querySelector('.player-cover').classList.contains('cover-released')};
    };
    window.hidePanels = async complete => {
      document.querySelector('.player-cover .cover').click();await nextTick();await frame();
      if(complete)await Promise.all(document.querySelector('.player-container').getAnimations().map(a=>a.finished.catch(()=>{})));
      return {hidden:document.querySelector('.player-container').classList.contains('player-hide'),show:store.playerShow};
    };
    window.playVideoEntry = async () => {
      await window.hidePanels(true);document.querySelector('.title-player').click();await nextTick();
      const cue=document.querySelector('.cover-corners').getAnimations()[0],states=[];
      const deadline=performance.now()+4000;let synchronized=true;
      while(!document.querySelector('.cover-released')) {
        await frame();
        if(performance.now()>deadline)throw new Error('Video entry did not finish');
        if(cue.currentTime<cue.effect.getTiming().delay)continue;
        const lit=Number(getComputedStyle(cue.effect.target).opacity)>.5?1:0;
        if(states.at(-1)!==lit)states.push(lit);
        const corners=[...document.querySelectorAll('.c-border')];
        synchronized=synchronized&&corners.every(el=>getComputedStyle(el).opacity===getComputedStyle(corners[0]).opacity);
      }
      return {states,synchronized};
    };
    window.reducedVideoEntry = async () => {
      await window.hidePanels(true);document.querySelector('.title-player').click();await nextTick();await frame();
      return {shell:document.querySelector('.player-container').getAnimations().length,
        cover:document.querySelector('.cover-stage').getAnimations({subtree:true}).length,
        motions:document.querySelector('.cover-stage').getAnimations({subtree:true}).map(a=>({name:a.animationName,property:a.transitionProperty,target:a.effect.target.className})),
        corners:[...document.querySelectorAll('.c-border')].map(el=>({opacity:getComputedStyle(el).opacity,translate:getComputedStyle(el).translate}))};
    };
    window.disableVideoPanels = async () => {store.musicVideo=false;await nextTick();await frame();return !store.videoIsPlaying&&store.playerShow;};
    window.coverCenter = () => {
      const r=document.querySelector('.player-cover .cover').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
    };
    window.coverInteractionState = async () => {
      const el=document.querySelector('.player-cover .cover');
      await Promise.all(el.getAnimations().map(a=>a.finished.catch(()=>{})));
      return {transform:getComputedStyle(el).transform,enabled:el.classList.contains('back-Video'),show:store.playerShow,
        hidden:document.querySelector('.player-container').classList.contains('player-hide'),playing:store.playing,
        paused:document.querySelector('.back-video video')?.paused};
    };
    window.setVideoCoverEligibility = async kind => {
      store.musicVideo=true;await nextTick();await frame();
      store.currentMusicVideo=kind==='missing'?null:{id:store.songId+100,path:'qa-video.webm'};
      store.videoIsPlaying=false;store.playerShow=true;await nextTick();await frame();
    };
    window.pauseVideoControls = async (backgroundVisible=true) => {
      store.currentMusic=markRaw({seek:()=>store.progress,pause(){},fade(){},once(event,callback){if(event==='fade')queueMicrotask(callback);},volume(){}});
      store.playing=true;await nextTick();await frame();
      // Click the real pause control, not only patch the playing flag.
      document.querySelector('.player-control .control').children[1].dispatchEvent(new MouseEvent('click',{bubbles:true}));
      await nextTick();await frame();
      if(!backgroundVisible){store.videoIsPlaying=false;await nextTick();await frame();}
      return !store.playing;
    };
    window.videoLyricEntry = async () => {
      store.lyricSize=28;store.tlyricSize=20;store.rlyricSize=16;store.lyricInterludeTime=999;
      store.time=300;await nextTick();
      store.progress=48;
      store.lyricsObjArr=Array.from({length:60},(_,i)=>({time:i*4,lyric:'视频歌词滚动回归 '+i}));
      store.currentLyricIndex=12;await nextTick();
      await window.hidePanels(true);
      const track=document.querySelector('.lyric-entry-track'),oldTrack=track;
      const cancelled=track.getAnimations().length===0;
      document.querySelector('.title-player').click();await nextTick();
      const deadline=performance.now()+5000;let animation;
      while(!(animation=track.getAnimations()[0])){await frame();if(performance.now()>deadline)throw new Error('Video lyric entry did not restart');}
      const shell=document.querySelector('.player-container').getAnimations()[0];
      const result={cancelled,reused:oldTrack===document.querySelector('.lyric-entry-track'),
        shellFinished:!shell||shell.playState==='finished',from:animation.effect.getKeyframes()[0].transform};
      await animation.finished;await nextTick();await frame();
      const lines=document.querySelector('.lyric-lines'),scroll=document.querySelector('.lyric-scroll-area');
      const before=lines.style.transform;
      store.progress=64;store.currentLyricIndex=16;await nextTick();await frame();
      result.followsProgress=before!==lines.style.transform;
      const height=scroll.style.height;
      document.querySelector('.lyric-area').dispatchEvent(new WheelEvent('wheel',{deltaY:240}));await nextTick();
      result.manualScroll=height!==scroll.style.height;
      await window.hidePanels(true);document.querySelector('.title-player').click();await nextTick();
      while(!track.getAnimations().length){await frame();if(performance.now()>deadline+5000)throw new Error('Repeated lyric entry did not restart');}
      result.repeated=true;
      return result;
    };
    await document.querySelector('.cover img').decode(); await nextTick();
    await Promise.all(document.querySelector('.cover-stage').getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations!==Infinity).map(a=>a.finished));
    window.qaReady=true;
  </script></body></html>`;
  await server.listen();
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true, backgroundThrottling: false } });
  const errors = [];
  const watchdog = setTimeout(()=>{console.error('Real-player playback fixture timed out', errors);app.exit(1);},90000);
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
  win.webContents.on('render-process-gone', (_event, details) => { console.error('Player fixture renderer exited:', details, errors); app.exit(1); });
  win.webContents.on('did-fail-load', (_event, code, description, url) => console.error('Player fixture load failed:', code, description, url));
  try {
    await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__player-cover-qa.html`);
    console.log('Real player fixture loaded.', win.webContents.getURL());
    await win.webContents.executeJavaScript(`(async()=>{const end=performance.now()+15000;while(!window.qaReady){await new Promise(requestAnimationFrame);if(performance.now()>end)throw new Error('Fixture failed to mount');}})()`);
    for (let index = 1; index <= 4; index++) {
      const samples = await win.webContents.executeJavaScript(`recordNext(${index}, ${index === 2 ? 700 : 0}, ${index === 4})`);
      // Local metadata can briefly retain the previous cached artwork before its async cover resolves.
      const blink = samples.filter(s=>s.coverResolved && s.classes.includes('cover-replay') && !s.classes.includes('waiting') && !s.skeleton);
      const states = blink.map(s=>s.opacity>.5?1:0).filter((s,i,a)=>i===0||s!==a[i-1]);
      fs.mkdirSync(path.join(root, 'output/player-cover-animation'), {recursive:true});
      fs.writeFileSync(path.join(root, `output/player-cover-animation/playback-${index}.json`), JSON.stringify({states,samples,errors},null,2));
      assert.ok(states.join('').includes('010101'), `Actual next-song click ${index}: observe two flashes, got ${states}`);
      assert.ok(samples.every(sample=>sample.id===Math.min(index+1,4)), 'Observe the selected track only, without a subsequent automatic song change');
      assert.ok(blink.every(sample=>sample.synchronized && sample.sameStage && sample.newCorners), 'Fresh corner animation nodes stay synchronized without rebuilding cover layout');
      const offSamples = blink.filter(sample=>sample.motions.find(a=>a.name.includes('dialog-entry-cue'))?.state==='running' && sample.opacity===0);
      assert.ok(offSamples.some(sample=>sample.imageOpacity>.95), 'Blink remains visible after the real cover has faded in');
      assert.ok(blink.filter(sample=>sample.motions.some(m=>m.name.includes('dialog-entry-cue')&&m.state==='running'))
        .every(sample=>!sample.classes.includes('cover-released') && !sample.motions.some(m=>m.name.includes('cover-corners-expand'))),
        'Never release cover settlement or corner expansion before the double blink ends');
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
    // Isolate panel-entry checks from the preceding audio autoplay/next-track timers.
    await win.loadURL(`http://127.0.0.1:${server.httpServer.address().port}/__player-cover-qa.html`);
    await win.webContents.executeJavaScript(`(async()=>{const end=performance.now()+15000;while(!window.qaReady){await new Promise(requestAnimationFrame);if(performance.now()>end)throw new Error('Fixture failed to remount');}})()`);
    const baseline=await win.webContents.executeJavaScript('openPanels(false)');
    const hoverCover = async () => {
      const point=await win.webContents.executeJavaScript('coverCenter()');
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
      return win.webContents.executeJavaScript('coverInteractionState()');
    };
    const leaveCover = async () => {
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x:1350,y:50});
      await win.webContents.executeJavaScript('coverInteractionState()');
    };
    const clickCover = async () => {
      const point=await win.webContents.executeJavaScript('coverCenter()');
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
      return win.webContents.executeJavaScript('coverInteractionState()');
    };
    const ordinary=await hoverCover();
    assert.equal(ordinary.transform,'matrix(1, 0, 0, 1, 0, 0)','Ordinary playback has no video hover enlargement');
    assert.ok(!ordinary.enabled&&(await clickCover()).show,'Ordinary cover clicks never hide the controls');
    await leaveCover();
    const assertSharedEntry = (actual,label) => {
      assert.ok(actual.opening.newCue&&actual.opening.sameStage&&actual.opening.sameImage&&actual.opening.sameVideo&&actual.opening.active, label+': reset only animation nodes, not artwork or video');
      assert.equal(actual.opening.shell,baseline.opening.shell,label+': use the ordinary panel animation');
      assert.equal(actual.opening.delay,baseline.opening.delay,label+': use the shared shell-linked cue delay');
      assert.ok(actual.opening.time<200,label+': restart the cue from the beginning');
      assert.deepEqual(actual.samples,baseline.samples,label+': identical shell expansion, cover geometry and double-blink frames');
      assert.ok(actual.released,label+': settle only after the double blink');
    };
    for(const mode of ['song','pool']) {
      await win.webContents.executeJavaScript('prepareVideoPanels('+JSON.stringify(mode)+')');
      assertSharedEntry(await win.webContents.executeJavaScript('openPanels(true)'),mode+' initial video return');
      for(const complete of [false,true]) {
        const hidden=await win.webContents.executeJavaScript('hidePanels('+complete+')');
        assert.ok(hidden.hidden&&!hidden.show,'Cover click still hides the controls for video viewing');
        assertSharedEntry(await win.webContents.executeJavaScript('openPanels(true)'),mode+(complete?' completed':' cancelled')+' hide');
      }
      await win.webContents.executeJavaScript('hidePanels(true)');
      const interrupted=await win.webContents.executeJavaScript('openPanels(true,true)');
      assert.ok(interrupted.newCue,'Video return starts a fresh cue before interruption');
      assertSharedEntry(await win.webContents.executeJavaScript('openPanels(true)'),mode+' interrupted entry');
      const natural=await win.webContents.executeJavaScript('playVideoEntry()');
      assert.deepEqual(natural.states,[0,1,0,1,0,1],mode+': naturally play both video-return flashes');
      assert.ok(natural.synchronized,'Video-return corners flash together');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      const reduced=await win.webContents.executeJavaScript('reducedVideoEntry()');
      assert.equal(reduced.shell,0,'Reduced motion skips the video-return shell animation');
      assert.equal(reduced.cover,0,'Reduced motion skips the video-return cover animation: '+JSON.stringify(reduced.motions));
      assert.ok(reduced.corners.every(c=>c.opacity==='1'&&c.translate==='none'),'Reduced motion immediately shows expanded, visible corners');
      await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
      await win.webContents.executeJavaScript('hidePanels(true);');
      assertSharedEntry(await win.webContents.executeJavaScript('openPanels(true)'),mode+' motion restored');
      for(const backgroundVisible of [true,false]) {
        assert.ok(await win.webContents.executeJavaScript('pauseVideoControls('+backgroundVisible+')'),'Actual pause control pauses the audio');
        const hover=await hoverCover();
        assert.ok(hover.enabled&&!hover.playing,'Paused current-song video retains video-only cover interactions');
        assert.equal(hover.transform,'matrix(1.05, 0, 0, 1.05, 0, 0)','Video-only hover enlargement is restored');
        const hidden=await clickCover();
        assert.ok(hidden.hidden&&!hidden.show&&!hidden.playing&&hidden.paused,'Physical cover click hides paused video controls without resuming media');
        await leaveCover();
        assertSharedEntry(await win.webContents.executeJavaScript('openPanels(true)'),mode+' paused return');
      }
      const lyrics=await win.webContents.executeJavaScript('videoLyricEntry()');
      assert.ok(lyrics.cancelled&&lyrics.reused&&lyrics.shellFinished&&lyrics.repeated,'Video lyrics cancel while hidden, replay after shell expansion and reuse the same track');
      assert.notEqual(lyrics.from,'translate3d(0px, 0px, 0px)','Video lyric entry travels through the real lyrics');
      assert.ok(lyrics.followsProgress&&lyrics.manualScroll,'Video lyrics retain timed following and manual wheel scrolling');
      fs.writeFileSync(path.join(root,'output/player-cover-animation/video-'+mode+'-settled.png'),(await win.webContents.capturePage()).toPNG());
      win.setContentSize(700,900);
      const portraitLyrics=await win.webContents.executeJavaScript('videoLyricEntry()');
      assert.ok(portraitLyrics.repeated&&portraitLyrics.manualScroll,'Portrait video lyrics do not wait for the hidden left panel animation');
      win.setContentSize(1400,900);
      await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await win.webContents.executeJavaScript('hidePanels(true)');
      assert.ok(await win.webContents.executeJavaScript('disableVideoPanels()'),'Disabling video restores the ordinary player');
      assertSharedEntry(await win.webContents.executeJavaScript('openPanels(false)'),mode+' disabled');
      const disabled=await hoverCover();
      assert.ok(!disabled.enabled&&(await clickCover()).show,'Disabling video removes video-only interactions');
      assert.equal(disabled.transform,'matrix(1, 0, 0, 1, 0, 0)','Disabling video removes hover enlargement');
      await leaveCover();
    }
    for(const kind of ['missing','mismatched']) {
      await win.webContents.executeJavaScript('setVideoCoverEligibility('+JSON.stringify(kind)+')');
      const inactive=await hoverCover();
      assert.ok(!inactive.enabled&&(await clickCover()).show,kind+': enabled setting alone must not activate video-cover interactions');
      assert.equal(inactive.transform,'matrix(1, 0, 0, 1, 0, 0)',kind+': no video hover on missing/other-song media');
      await leaveCover();
    }
    assert.deepEqual(errors, [], 'No runtime errors in the real player');
    console.log('Real-player cover playback check passed: next controls, asynchronous covers and preloaded restart; shared song/pool video entry; paused physical cover clicks without resuming media; video-only hover; repeated lyric entry, timed following and wheel scrolling; missing/mismatched/disabled video guards.');
  } finally { clearTimeout(watchdog); win.destroy(); await server.close(); }
}).then(()=>app.quit()).catch(error=>{console.error(error);app.exit(1);});
