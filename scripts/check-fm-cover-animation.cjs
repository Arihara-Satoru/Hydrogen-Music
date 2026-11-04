// Run: node scripts/check-fm-cover-animation.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const previewDir = process.env.FM_COVER_PREVIEW_DIR || process.argv[2];

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
const { parse, compileStyle } = require('@vue/compiler-sfc');
app.disableHardwareAcceleration();
const root = path.resolve(__dirname, '..');
const { descriptor } = parse(fs.readFileSync(path.join(root, 'src/components/PersonalFM.vue'), 'utf8'));
const source = descriptor.scriptSetup.content;
const moves = source.slice(source.indexOf('const coverTrackItems ='), source.indexOf('const coverTransitionName ='));
const duration = source.slice(source.indexOf('const parseDurationToMs ='), source.indexOf('const getCoverReleaseDelayMs ='));
const render = require('@vue/compiler-dom').compile(descriptor.template.content, { mode: 'function' }).code;
const vue = fs.readFileSync(require.resolve('vue/dist/vue.global.prod.js'), 'utf8');
const css = ['reset', 'style', 'theme'].map(name => fs.readFileSync(path.join(root, `src/assets/css/${name}.css`), 'utf8'));
for (const style of descriptor.styles) {
  const result = compileStyle({ source: style.content, filename: 'PersonalFM.vue', id: 'data-v-fm-move', scoped: style.scoped, preprocessLang: 'scss' });
  assert.deepEqual(result.errors, []);
  css.push(result.code);
}
css.push('.mainWindow { width: 100%; height: 100vh; } #preview { height: 100%; }');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>${css.join('\n')}</style><div class="mainWindow"><div id="preview"></div></div>`));
    await win.webContents.executeJavaScript(vue + '; void 0');
    await win.webContents.executeJavaScript(`
      const { ref, computed, watch, nextTick } = Vue;
      const fmSceneRef = ref(null), modeSwitching = ref(false), currentIndex = ref(2);
      const songs = Array.from({length: 5}, (_, id) => ({id: id + 1, name: 'Record ' + (id + 1)}));
      const currentSong = computed(() => songs[currentIndex.value]);
      const prevCandidateSong = computed(() => songs[currentIndex.value - 1]);
      const nextCandidateSong = computed(() => songs[currentIndex.value + 1]);
      const rightPlaceholderText = ref('NO NEXT');
      const coverTransitionDirection = computed(() => state.coverTransitionName.includes('prev') ? 'prev' : 'next');
      const COVER_TRANSITION_FALLBACK_MS = 720;
      ${duration}
      const state = Vue.reactive({
        isClassic: true, waterMotionEnabled: false, fmSceneRef, modeSwitching,
        coverInterrupting: false, isPlaying: false, isPanelIntroActive: false, isPanelOutlineReady: true,
        loading: false, modePanelOpen: false, selectedFmModeSummary: '发现推荐', currentSong, currentIndex,
        currentSongArtists: [], currentSongAlbum: null, playedSongs: songs, nextCandidateSong,
        isPrefetching: false, likeLoading: false, isCurrentSongLiked: false, showSongTranslation: false,
        coverTransitionName: 'fm-shift-neutral', FM_MODE_OPTIONS: [], FM_SCENE_SUBMODE_OPTIONS: [],
        fmLyricLines: [], fmLyricStatus: '歌词', getSongDisplayName: song => song.name,
        getFmSongAlbumName: () => '', canOpenArtist: () => false, canOpenAlbum: () => false,
        getFmSongCover: song => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="hsl(' + song.id * 60 + ',40%,45%)"/><text x="120" y="170" font-size="60">' + song.id + '</text></svg>'),
      });
      for (const name of ['toggleModePanel', 'changeFmMode', 'changeFmSubmode', 'handleCoverSlotClick', 'openArtist', 'openAlbum', 'goPrev', 'goNext', 'trashSong', 'likeSong', 'refreshFM']) state[name] = () => {};
      Vue.createApp({ __scopeId: 'data-v-fm-move', setup: () => {
        ${moves}
        state.coverTrackItems = coverTrackItems;
        state.pinLeavingCover = pinLeavingCover;
        state.enterCover = enterCover;
        state.leaveCover = leaveCover;
        state.stopCoverMoves = stopCoverMoves;
        return state;
      }, render: new Function('Vue', ${JSON.stringify(render)})(Vue) }).mount('#preview');
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = el => {
        const r = el.getBoundingClientRect();
        return {x: r.x, y: r.y, width: r.width, height: r.height, opacity: Number(getComputedStyle(el).opacity)};
      };
      const covers = () => [...document.querySelector('.fm-cover-track').children];
      const snapshots = () => Object.fromEntries(covers().map(el => [el.dataset.coverKey, rect(el)]));
      const finish = async () => {
        await nextTick(); await frame();
        for (const el of covers()) for (const animation of el.getAnimations()) animation.finish();
        // Vue also uses a timeout fallback to remove CSS-transition leavers.
        await new Promise(resolve => setTimeout(resolve, 800));
        await nextTick(); await frame();
      };
      void 0;
    `);

    for (const classic of [true, false]) {
      for (const width of [1400, 800, 390]) {
        win.setContentSize(width, 1000);
        await win.webContents.executeJavaScript(`(async () => {
          await finish(); state.isClassic = ${classic}; state.modeSwitching = true;
          currentIndex.value = 2; await nextTick(); await frame(); state.modeSwitching = false;
        })()`);
        for (const direction of ['next', 'prev']) {
          const result = await win.webContents.executeJavaScript(`(async () => {
            await finish();
            const before = snapshots();
            const oldCenter = document.querySelector('.slot-center');
            const promoted = document.querySelector('.slot-${direction === 'next' ? 'right' : 'left'}');
            const incomingKey = promoted.dataset.coverKey;
            state.coverTransitionName = 'fm-shift-${direction}';
            currentIndex.value += ${direction === 'next' ? 1 : -1};
            await nextTick(); await nextTick();
            // Freeze the first frame to test continuity independently of frame rate.
            for (const el of covers()) for (const animation of el.getAnimations()) {
              animation.pause(); animation.currentTime = 0;
            }
            const start = snapshots();
            const sameNode = promoted === document.querySelector('.slot-center');
            const moving = covers().filter(el => el.getAnimations().some(a => a.effect.getKeyframes().some(k => k.transformOrigin === '0px 0px' || k.transformOrigin === '0 0')));
            const oldCenterKey = oldCenter.dataset.coverKey;
            for (const el of moving) for (const animation of el.getAnimations()) animation.currentTime = 150;
            const middle = snapshots();
            await finish();
            return { before, start, middle, end: snapshots(), incomingKey, oldCenterKey, sameNode, movingCount: moving.length,
              nodes: covers().length, active: covers().flatMap(el => el.getAnimations()).length };
          })()`);
          const label = `${classic ? 'classic' : 'modern'}/${width}/${direction}`;
          assert.ok(result.sameNode, `${label}: reuse the side cover node`);
          assert.equal(result.movingCount, 2, `${label}: animate both promoted and demoted covers`);
          for (const key of [result.incomingKey, result.oldCenterKey]) {
            assert.ok(Math.abs(result.before[key].opacity - result.start[key].opacity) < 0.01, `${label}: preserve visible opacity at the first frame`);
            for (const prop of ['x', 'y', 'width', 'height']) {
              assert.ok(Math.abs(result.before[key][prop] - result.start[key][prop]) < 1.5,
                `${label}/${key}/${prop}: cover must start at its actual old rectangle (${result.before[key][prop]} -> ${result.start[key][prop]})`);
            }
            const from = result.before[key], mid = result.middle[key], to = result.end[key];
            assert.ok(mid.width >= Math.min(from.width, to.width) - 1 && mid.width <= Math.max(from.width, to.width) + 1, `${label}: continuous scale`);
            const centerY = r => r.y + r.height / 2;
            assert.ok(centerY(mid) >= Math.min(centerY(from), centerY(to)) - 1.5 && centerY(mid) <= Math.max(centerY(from), centerY(to)) + 1.5,
              `${label}: no diagonal jump from below (${centerY(from)}, ${centerY(mid)}, ${centerY(to)})`);
          }
          assert.equal(result.nodes, 3, `${label}: remove departed cards`);
          assert.equal(result.active, 0, `${label}: clean up completed animations`);
        }
      }
    }

    const interrupt = await win.webContents.executeJavaScript(`(async () => {
      state.coverTransitionName = 'fm-shift-next'; currentIndex.value++;
      await nextTick(); await nextTick();
      for (const el of covers()) for (const a of el.getAnimations()) { a.pause(); a.currentTime = 120; }
      const before = snapshots();
      state.coverTransitionName = 'fm-shift-prev'; currentIndex.value--;
      await nextTick(); await nextTick();
      for (const el of covers()) for (const a of el.getAnimations()) { a.pause(); a.currentTime = 0; }
      const after = snapshots();
      await finish();
      state.modeSwitching = true; currentIndex.value = 0; await nextTick(); await frame(); state.modeSwitching = false;
      state.coverTransitionName = 'fm-shift-next'; currentIndex.value++; await nextTick(); await finish();
      const boundaryCount = covers().length;
      state.stopCoverMoves();
      return {before, after, boundaryCount};
    })()`);
    for (const key of ['song-3', 'song-4']) {
      for (const prop of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(interrupt.before[key][prop] - interrupt.after[key][prop]) < 1.5, `Interrupted ${key}/${prop} must continue from the visible frame`);
      }
    }
    assert.equal(interrupt.boundaryCount, 3, 'Placeholder transitions must not leave ghost covers');

    if (previewDir) {
      fs.mkdirSync(previewDir, { recursive: true });
      win.setContentSize(1400, 900);
      await win.webContents.executeJavaScript(`(async () => {
        await finish(); state.isClassic = true; state.modeSwitching = true;
        currentIndex.value = 2; await nextTick(); await frame(); state.modeSwitching = false;
        state.coverTransitionName = 'fm-shift-next'; currentIndex.value++;
        await nextTick(); await nextTick();
        for (const el of covers()) for (const a of el.getAnimations()) a.pause();
      })()`);
      for (const [name, time] of [['start', 0], ['middle', 150], ['end', 720]]) {
        await win.webContents.executeJavaScript(`(async () => {
          for (const el of covers()) for (const a of el.getAnimations()) a.currentTime = ${time};
          await frame();
        })()`);
        fs.writeFileSync(path.join(previewDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      }
      await win.webContents.executeJavaScript('finish()');
    }

    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await win.webContents.executeJavaScript(`(async () => {
      currentIndex.value++; await nextTick(); await nextTick();
      return covers().flatMap(el => el.getAnimations()).filter(a => a.effect.getKeyframes().some(k => k.transformOrigin)).length;
    })()`);
    assert.equal(reduced, 0, 'Reduced motion must skip cover movement');
    console.log('FM cover animation check passed: actual template/styles, both layouts and directions at 1400/800/390px, continuous position/scale, interrupted reversal, placeholders, cleanup, and reduced motion.');
  } finally {
    win.destroy();
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
