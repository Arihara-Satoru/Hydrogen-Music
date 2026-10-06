// Run: node scripts/check-fm-theme.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
app.disableHardwareAcceleration();
const { parse, compileStyle } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '..');
const { descriptor } = parse(fs.readFileSync(path.join(root, 'src/components/PersonalFM.vue'), 'utf8'));
const vue = fs.readFileSync(require.resolve('vue/dist/vue.global.prod.js'), 'utf8');
const render = require('@vue/compiler-dom').compile(descriptor.template.content, { mode: 'function' }).code;
const tiltLogic = descriptor.scriptSetup.content.slice(descriptor.scriptSetup.content.indexOf('const fmSceneRef ='), descriptor.scriptSetup.content.indexOf('// ponytail: this three-line view'));
const lyricLogic = descriptor.scriptSetup.content.slice(descriptor.scriptSetup.content.indexOf('const fmLyricLines ='), descriptor.scriptSetup.content.indexOf('const prevCandidateSong ='));
const modes = name => require('node:vm').runInNewContext(descriptor.scriptSetup.content.match(new RegExp(`const ${name} = Object\\.freeze\\((\\[[\\s\\S]*?\\])\\);`))[1]);
const cover = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, 'src/assets/img/default-cover.svg')).toString('base64');
const css = ['reset', 'style', 'theme'].map(name =>
  fs.readFileSync(path.join(root, `src/assets/css/${name}.css`), 'utf8'));
for (const style of descriptor.styles) {
  const result = compileStyle({ source: style.content, filename: 'PersonalFM.vue', id: 'data-v-fm-check', scoped: style.scoped, preprocessLang: 'scss' });
  assert.deepEqual(result.errors, []);
  css.push(result.code);
}
// Sample settled colors, independently of the app's theme/button transitions.
css.push('*:not(.fm-lyric-line):not(.fm-lyric-line p) { transition: none !important; }');
css.push('.mainWindow { width: 100%; height: 100vh; } #preview { height: 100%; }');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>${css.join('\n')}</style>
      <div class="mainWindow"><div id="preview"></div></div>`));
    await win.webContents.executeJavaScript(vue + '; void 0');
    await win.webContents.executeJavaScript(`
      const cover = ${JSON.stringify(cover)};
      const song = { id: 1, name: 'ワールドイズマイン (世界第一公主殿下)(Game Version)', ar: [{name: '初音ミク'}], al: {name: 'Project DIVA', picUrl: cover} };
      const noop = () => {};
      const state = Vue.reactive({
        waterMotionEnabled: false, songId: 1, currentLyricIndex: 1, lyricsObjArr: [
          { time: 0, lyric: '沿着水光，慢慢靠近' },
          { time: 10, lyric: '让这一刻停留在耳边', tlyric: 'Let this moment linger' },
          { time: 20, lyric: '下一段旋律正在远处等你' },
          { time: 30, lyric: '把此刻交给音乐' },
        ],
        coverInterrupting: false, isPlaying: true, isPanelIntroActive: false, isPanelOutlineReady: true,
        loading: false, modeSwitching: false, modePanelOpen: true, selectedFmModeSummary: 'AI 推荐池',
        selectedFmMode: 'ai_pool', selectedFmSubmode: '0', currentSong: song, currentIndex: 0,
        currentSongArtists: song.ar, currentSongAlbum: song.al, playedSongs: [song], nextCandidateSong: song,
        isPrefetching: false, likeLoading: false, isCurrentSongLiked: false, showSongTranslation: true,
        coverTransitionName: 'fm-shift-neutral', FM_MODE_OPTIONS: ${JSON.stringify(modes('FM_MODE_OPTIONS'))},
        FM_SCENE_SUBMODE_OPTIONS: ${JSON.stringify(modes('FM_SCENE_SUBMODE_OPTIONS'))},
        coverTrackItems: [
          { key: 'left', role: 'left', song: null, isPlaceholder: true, placeholderText: 'NO PREV', clickable: false },
          { key: 'center', role: 'center', song, clickable: true },
          { key: 'right', role: 'right', song, clickable: true },
        ],
        getFmSongCover: () => cover, getSongDisplayName: song => song.name, getFmSongAlbumName: song => song.al.name,
        canOpenArtist: () => true, canOpenAlbum: () => true,
        toggleModePanel: noop, changeFmMode: noop, changeFmSubmode: noop, handleCoverSlotClick: noop,
        openArtist: noop, openAlbum: noop, goPrev: noop, goNext: noop, trashSong: noop, likeSong: noop, refreshFM: noop,
      });
      const { computed } = Vue;
      const songId = Vue.toRef(state, 'songId'), currentSong = Vue.toRef(state, 'currentSong');
      const lyricsObjArr = Vue.toRef(state, 'lyricsObjArr'), currentLyricIndex = Vue.toRef(state, 'currentLyricIndex');
      ${lyricLogic}
      state.fmLyricLines = fmLyricLines;
      state.fmLyricStatus = fmLyricStatus;
      Vue.createApp({ __scopeId: 'data-v-fm-check', setup: () => {
        const {ref, onMounted, onActivated, onDeactivated, onUnmounted, watch} = Vue;
        const waterMotionEnabled = Vue.toRef(state, 'waterMotionEnabled');
        ${tiltLogic}
        state.fmSceneRef = fmSceneRef;
        state.stopFmTilt = stopFmTilt;
        return state;
      }, render: new Function('Vue', ${JSON.stringify(render)})(Vue) }).mount('#preview');
      void 0;
      `);
    assert.equal(await win.webContents.executeJavaScript('!!document.querySelector(".fm-mode-trigger")'), true, 'Actual FM template must render');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await win.webContents.debugger.sendCommand('DOM.enable');
    await win.webContents.debugger.sendCommand('CSS.enable');
    const { root: dom } = await win.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: dom.nodeId, selector: '.fm-mode-trigger' });
    await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
    for (const dark of [false, true]) {
      for (const hue of [null, 0, 60, 240]) {
        const result = await win.webContents.executeJavaScript(`(() => {
          const root = document.documentElement;
          root.className = '${dark ? 'dark' : ''} ${hue === null ? '' : 'dynamic-theme'}';
          root.style.setProperty('--ambient-hue', '${hue ?? 210}');
          root.style.setProperty('--ambient-saturation', '70%');
          root.style.setProperty('--ambient-secondary-strength', '0.5');
          root.style.setProperty('--ambient-tertiary-strength', '0.25');
          root.style.setProperty('transition', 'none');
          const styles = selector => getComputedStyle(document.querySelector(selector));
          const rgba = value => value.match(/[\\d.]+/g).map(Number);
          const primary = [ '.fm-mode-btn.active', '.fm-submode-btn.active', '.fm-play-overlay'].map(selector => ({
            selector, bg: styles(selector).backgroundColor, text: styles(selector).color,
            child: styles(selector + ' :is(.mode-code, .mode-label, svg)').color,
          }));
          document.querySelector('.fm-mode-trigger').focus();
          return {
            primary,
            panelBg: styles('.fm-panel').backgroundColor, panelImage: styles('.fm-panel').backgroundImage,
            backdrop: styles('.mainWindow').backgroundImage,
            dossierAlpha: rgba(styles('.fm-dossier').backgroundColor)[3],
            reflection: styles('.fm-cover-reflection').pointerEvents,
            discMask: styles('.fm-cd').maskImage,
            discPlaying: document.querySelector('.personal-fm').classList.contains('fm-record-playing'),
            menuAlpha: rgba(styles('.fm-mode-dropdown').backgroundColor)[3],
            outline: styles('.fm-mode-trigger').outlineStyle,
            titleFont: styles('.fm-header h1').fontFamily,
            buttonRadius: styles('.fm-mode-trigger').borderRadius,
            dossierBorder: styles('.fm-dossier').borderTopStyle,
            statusMask: styles('.fm-status-strip').maskImage,
            mutedText: styles('.fm-status-strip small').color,
            normalText: styles('.fm-status-strip strong').color,
            decorations: ['.fm-panel', '.fm-cover-carousel'].filter(s => document.querySelector(s)).map(s => getComputedStyle(document.querySelector(s), '::before').content),
          };
        })()`);
        assert.equal(result.panelBg, 'rgba(0, 0, 0, 0)');
        assert.equal(result.panelImage, 'none');
        assert.equal(result.dossierAlpha, 0);
        assert.equal(result.reflection, 'none');
        assert.ok(result.discMask.includes('radial-gradient'));
        assert.ok(result.discPlaying);
        assert.ok(result.menuAlpha >= 0.9);
        assert.equal(result.outline, 'solid');
        assert.ok(result.titleFont.includes('SourceHanSansCN-Heavy'));
        assert.equal(result.buttonRadius, '0px');
        assert.equal(result.dossierBorder, 'solid');
        assert.equal(result.statusMask, 'none');
        assert.notEqual(result.mutedText, result.normalText);
        for (const button of result.primary) {
          assert.notEqual(button.bg, button.text, `${dark}/${hue}: ${button.selector} contrast`);
          assert.equal(button.text, button.child, `${dark}/${hue}: ${button.selector} child color`);
          assert.equal(button.bg, dark ? 'rgb(241, 243, 245)' : 'rgb(17, 18, 19)');
        }
        if (hue !== null) assert.ok(result.backdrop.includes('gradient'));
        assert.ok(result.decorations.every(content => content === 'none'));
        await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
        const hover = await win.webContents.executeJavaScript(`(() => {
          const el = document.querySelector('.fm-mode-trigger');
          return { bg: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color, child: getComputedStyle(el.querySelector('.mode-trigger-value')).color };
        })()`);
        assert.notEqual(hover.bg, hover.text);
        await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
        if (process.env.FM_THEME_PREVIEW_DIR && (hue === null || hue === 240)) {
          await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
          await win.webContents.executeJavaScript('state.modePanelOpen = false; Vue.nextTick().then(() => undefined)');
          await new Promise(resolve => setTimeout(resolve, 200));
          const image = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Preview did not paint')), 3000);
            win.webContents.once('paint', (_event, _rect, image) => { clearTimeout(timeout); resolve(image); });
            win.webContents.invalidate();
          });
          fs.mkdirSync(process.env.FM_THEME_PREVIEW_DIR, { recursive: true });
          assert.ok(!image.isEmpty(), 'Preview bitmap must be valid');
          fs.writeFileSync(path.join(process.env.FM_THEME_PREVIEW_DIR, `${dark ? 'dark' : 'light'}-${hue ?? 'default'}.png`), image.toPNG());
          await win.webContents.executeJavaScript('state.modePanelOpen = true; Vue.nextTick().then(() => undefined)');
          await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['focus', 'focus-visible'] });
        }
      }
    }
    const lyrics = await win.webContents.executeJavaScript(`(async () => {
      const original = state.lyricsObjArr;
      const read = () => ({ texts: fmLyricLines.value.map(row => row.lyric), active: fmLyricLines.value.filter(row => row.active).map(row => row.index), status: fmLyricStatus.value });
      const initial = read();
      state.currentLyricIndex = 2;
      await Vue.nextTick();
      const advanced = document.querySelector('[aria-current="true"]').textContent;
      state.currentLyricIndex = -1;
      const prelude = read();
      state.lyricsObjArr = [{lyric: 'first'}, {lyric: ''}, {lyric: 'third', tlyric: 'translation'}];
      state.currentLyricIndex = 1;
      const blank = read();
      state.songId = 2;
      const mismatch = read();
      state.songId = 1; state.lyricsObjArr = null;
      const pending = read();
      state.lyricsObjArr = [];
      const empty = read();
      state.lyricsObjArr = original; state.currentLyricIndex = 1;
      await Vue.nextTick();
      return {initial, advanced, prelude, blank, mismatch, pending, empty,
        actions: document.querySelectorAll('.action-btn').length,
        translation: !!document.querySelector('.fm-lyric-translation'),
        ripple: getComputedStyle(document.querySelector('.fm-water-surface'), '::before').animationName,
        reflection: getComputedStyle(document.querySelector('.fm-cover-reflection')).animationName};
    })()`);
    assert.deepEqual(lyrics.initial.active, [1]);
    assert.ok(lyrics.advanced.includes('下一段'));
    assert.deepEqual(lyrics.prelude.active, []);
    assert.deepEqual(lyrics.blank.active, [0]);
    assert.equal(lyrics.blank.texts.length, 2);
    assert.equal(lyrics.mismatch.texts.length, 0);
    assert.equal(lyrics.mismatch.status, '播放后显示歌词');
    assert.equal(lyrics.pending.status, '正在加载歌词…');
    assert.equal(lyrics.empty.status, '暂无歌词，静静听一会儿');
    assert.equal(lyrics.actions, 0);
    assert.ok(lyrics.translation);
    assert.equal(lyrics.ripple, 'none');
    assert.equal(lyrics.reflection, 'none');
    assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".fm-cover-reflection")).filter'), 'none');
    assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".fm-lyric-line")).transitionDuration'), '0s');
    assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".fm-cd")).animationName'), 'none');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const spin = await win.webContents.executeJavaScript('({name: getComputedStyle(document.querySelector(".fm-cd")).animationName, state: getComputedStyle(document.querySelector(".fm-cd")).animationPlayState})');
    assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".fm-water-surface")).backgroundImage.includes("repeating")'), false);
    assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".fm-cover-reflection")).animationName'), 'none');
    await win.webContents.executeJavaScript('state.waterMotionEnabled = true; Vue.nextTick().then(() => undefined)');
    const motion = await win.webContents.executeJavaScript(`(async () => {
      const before = document.querySelector('feOffset').dy.animVal;
      await new Promise(resolve => setTimeout(resolve, 180));
      const after = document.querySelector('feOffset').dy.animVal;
      state.currentLyricIndex = 3;
      await Vue.nextTick();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {before, after, entering: !!document.querySelector('.fm-lyric-enter-active'),
        filter: getComputedStyle(document.querySelector('.fm-cover-reflection')).filter,
        duration: getComputedStyle(document.querySelector('.fm-lyric-line')).transitionDuration,
        highlightDuration: getComputedStyle(document.querySelector('.fm-lyric-line p')).transitionDuration};
    })()`);
    assert.ok(motion.after > motion.before, 'Water field must flow forward without reversing');
    const seam = await win.webContents.executeJavaScript(`(() => {
      const svg = document.querySelector('.fm-water-filter');
      svg.pauseAnimations();
      const sample = t => {
        svg.setCurrentTime(t);
        return [...document.querySelectorAll('feOffset')].map(node => node.dy.animVal);
      };
      const first = sample(0), middle = sample(4), last = sample(7.999), wrapped = sample(8.001);
      const mask = getComputedStyle(document.querySelector('.fm-cover-reflection')).maskImage;
      svg.unpauseAnimations();
      return {first, middle, last, wrapped, mask, stitched: document.querySelector('feTurbulence').getAttribute('stitchTiles')};
    })()`);
    assert.equal(seam.stitched, 'stitch');
    assert.ok(!seam.mask.includes('repeating'));
    for (const pair of [seam.first, seam.middle, seam.last, seam.wrapped]) assert.ok(Math.abs(pair[0] - pair[1] - 128) < .001);
    assert.ok(Math.abs(seam.last[0] - seam.wrapped[0] - 128) < .05, 'End/start must meet modulo one stitched tile');
    // Verify rendered pixels across the seam, rather than only checking animation attributes.
    await win.webContents.executeJavaScript('state.isPlaying = false; document.querySelector(".fm-water-filter").pauseAnimations(); Vue.nextTick().then(() => undefined)');
    await new Promise(resolve => setTimeout(resolve, 600));
    const frameAt = async time => {
      await win.webContents.executeJavaScript(`document.querySelector(".fm-water-filter").setCurrentTime(${time})`);
      await new Promise(resolve => setTimeout(resolve, 120));
      const bitmap = await new Promise(resolve => {
        win.webContents.once('paint', (_event, _rect, image) => resolve(image));
        win.webContents.invalidate();
      });
      return bitmap.toBitmap();
    };
    const delta = (a, b) => {
      assert.equal(a.length, b.length);
      let total = 0;
      for (let i = 0; i < a.length; i++) total += Math.abs(a[i] - b[i]);
      return total / a.length;
    };
    const startPixels = await frameAt(0), midPixels = await frameAt(4);
    const endPixels = await frameAt(7.999), nextPixels = await frameAt(8.001);
    const motionDelta = delta(startPixels, midPixels), seamDelta = delta(endPixels, nextPixels);
    assert.ok(motionDelta > .001, 'Reflection pixels must move');
    assert.ok(seamDelta < motionDelta * .2 + .001, `Loop seam must be visually continuous: seam ${seamDelta}, motion ${motionDelta}`);
    await win.webContents.executeJavaScript('document.querySelector(".fm-water-filter").unpauseAnimations()');
    assert.ok(motion.entering, 'Lyric window must animate incoming lines');
    assert.ok(motion.filter.includes('fm-water-distortion'));
    assert.ok(motion.duration.includes('0.48s'));
    assert.ok(motion.highlightDuration.includes('0.4s'));
    assert.equal(spin.name, 'fm-disc-spin');
    assert.equal(spin.state, 'running');
    const tilt = await win.webContents.executeJavaScript(`(async () => {
      const root = document.querySelector('.personal-fm');
      const read = () => ({yaw: root.style.getPropertyValue('--fm-pointer-yaw'), pitch: root.style.getPropertyValue('--fm-pointer-pitch'), left: getComputedStyle(document.querySelector('.fm-cover-carousel')).transform, right: getComputedStyle(document.querySelector('.fm-dossier')).transform});
      const move = async (x, y) => {
        window.dispatchEvent(new PointerEvent('pointermove', {clientX: x, clientY: y, pointerType: 'mouse'}));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return read();
      };
      const center = await move(innerWidth / 2, innerHeight / 2);
      const edge = await move(innerWidth * 2, -innerHeight);
      window.dispatchEvent(new Event('blur'));
      const reset = read();
      state.waterMotionEnabled = false;
      await Vue.nextTick();
      const reduced = await move(0, 0);
      state.waterMotionEnabled = true;
      await Vue.nextTick();
      return {center, edge, reset, reduced, metadata: !!document.querySelector('.fm-info'), perspective: getComputedStyle(document.querySelector('.fm-main')).perspective};
    })()`);
    assert.equal(tilt.metadata, false);
    assert.equal(tilt.perspective, '1200px');
    assert.notEqual(tilt.center.left, tilt.center.right, 'Both planes must incline in opposite directions');
    assert.notEqual(tilt.center.left, tilt.edge.left, 'Pointer movement must affect 3D transform');
    assert.equal(tilt.edge.yaw, '4deg');
    assert.equal(tilt.edge.pitch, '3deg');
    assert.equal(tilt.reset.yaw, '0deg');
    assert.equal(tilt.reduced.yaw, '0deg');
    await win.webContents.executeJavaScript('state.isPlaying = false; Vue.nextTick().then(() => undefined)');
    assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".fm-cd")).animationPlayState'), 'paused');
    for (const width of [800, 390]) {
      win.setContentSize(width, 1000);
      await new Promise(resolve => setTimeout(resolve, 200));
      const layout = await win.webContents.executeJavaScript(`(() => {
        const main = document.querySelector('.fm-main');
        const disc = document.querySelector('.slot-center .fm-cd');
        return { tilt: getComputedStyle(document.querySelector('.fm-dossier')).transform, columns: getComputedStyle(main).gridTemplateColumns.split(' ').length, width: document.documentElement.scrollWidth, viewport: innerWidth, discRight: disc.getBoundingClientRect().right };
      })()`);
      assert.equal(layout.viewport, width);
      assert.equal(layout.columns, 1);
      assert.equal(layout.tilt, 'none');
      assert.ok(layout.width <= layout.viewport);
      assert.ok(layout.discRight <= layout.viewport);
    }
    if (process.env.FM_THEME_PREVIEW_DIR) {
      win.setContentSize(1400, 900);
      await new Promise(resolve => setTimeout(resolve, 300));
      await win.webContents.executeJavaScript('state.modePanelOpen = false; state.currentLyricIndex = 1; Vue.nextTick().then(() => undefined)');
      await win.webContents.debugger.sendCommand('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      await new Promise(resolve => setTimeout(resolve, 1100));
      assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll(".fm-lyric-leave-active").length'), 0, 'Departed lyric rows must be removed after their transition');
      const bitmap = await new Promise(resolve => {
        win.webContents.once('paint', (_event, _rect, image) => resolve(image));
        win.webContents.invalidate();
      });
      fs.writeFileSync(path.join(process.env.FM_THEME_PREVIEW_DIR, 'water-motion.png'), bitmap.toPNG());
    }
    console.log('FM theme check passed: actual template, light/dark and dynamic colors, live lyrics/translation/empty states, lyrics-only panel, bounded pointer tilt and reset, seamless forward-flow water without stripes, play/pause and reduced motion, long title, 800/390px layouts, controls and keyboard focus.');
  } finally {
    win.destroy();
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
