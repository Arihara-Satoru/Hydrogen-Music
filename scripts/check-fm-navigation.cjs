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
const cover = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(root, 'src/assets/img/default-cover.svg')).toString('base64');
const css = ['reset', 'style', 'theme'].map(name =>
  fs.readFileSync(path.join(root, `src/assets/css/${name}.css`), 'utf8'));
for (const style of descriptor.styles) {
  const result = compileStyle({ source: style.content, filename: 'PersonalFM.vue', id: 'data-v-fm-check', scoped: style.scoped, preprocessLang: 'scss' });
  css.push(result.code);
}
css.push('.mainWindow { width: 100%; height: 100vh; } #preview { height: 100%; }');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>${css.join('\n')}</style>
      <div class="mainWindow"><div id="preview"></div></div>`));
    await win.webContents.executeJavaScript(vue + '; void 0');
    await win.webContents.executeJavaScript(`
      const cover = ${JSON.stringify(cover)};
      const songA = { id: 1, name: 'Song A', ar: [{name: 'Artist A'}], al: {name: 'Album A', picUrl: cover} };
      const songB = { id: 2, name: 'Song B', ar: [{name: 'Artist B'}], al: {name: 'Album B', picUrl: cover} };
      const songC = { id: 3, name: 'Song C', ar: [{name: 'Artist C'}], al: {name: 'Album C', picUrl: cover} };
      const songD = { id: 4, name: 'Song D', ar: [{name: 'Artist D'}], al: {name: 'Album D', picUrl: cover} };
      
      const songs = [songA, songB, songC, songD];
      let curIdx = 1;

      const state = Vue.reactive({
        isClassic: false,
        waterMotionEnabled: false,
        isPanelIntroActive: false,
        isPanelOutlineReady: true,
        coverInterrupting: false,
        isPlaying: true,
        loading: false,
        modeSwitching: false,
        modePanelOpen: false,
        selectedFmMode: 'ai_pool',
        selectedFmSubmode: '0',
        selectedFmModeSummary: 'AI 推荐池',
        FM_MODE_OPTIONS: [],
        FM_SCENE_SUBMODE_OPTIONS: [],
        rightPlaceholderText: 'NEXT',
        currentSong: songs[curIdx],
        currentIndex: curIdx,
        playedSongs: [songA, songB],
        currentSongArtists: songs[curIdx].ar,
        currentSongAlbum: songs[curIdx].al,
        coverTransitionName: 'fm-shift-neutral',
        coverTransitionDirection: 'neutral',
        coverTrackItems: [],
        fmLyricLines: [],
        fmLyricStatus: '',
        likeLoading: false,
        isPrefetching: false,
        isCurrentSongLiked: false,
        nextCandidateSong: songs[curIdx + 1],
        getFmSongCover: () => cover,
        getSongDisplayName: s => s?.name || '',
        getFmSongAlbumName: s => s?.al?.name || '',
        canOpenArtist: () => true,
        canOpenAlbum: () => true,
        toggleModePanel: () => {},
        changeFmMode: () => {},
        changeFmSubmode: () => {},
        openArtist: () => {},
        openAlbum: () => {},
        trashSong: () => {},
        likeSong: () => {},
        refreshFM: () => {},
        goNext: () => {},
        goPrev: () => {},
        handleCoverSlotClick: () => {},
      });

      function updateItems() {
        const prev = curIdx > 0 ? songs[curIdx - 1] : null;
        const cur = songs[curIdx];
        const next = curIdx < songs.length - 1 ? songs[curIdx + 1] : null;
        state.currentSong = cur;
        state.nextCandidateSong = next;
        state.coverTrackItems = [
          prev ? { key: 'song-' + prev.id, role: 'left', song: prev, isPlaceholder: false, clickable: true }
               : { key: 'ph-left', role: 'left', song: null, isPlaceholder: true, placeholderText: 'NO PREV', clickable: false },
          { key: 'song-' + cur.id, role: 'center', song: cur, isPlaceholder: false, clickable: true },
          next ? { key: 'song-' + next.id, role: 'right', song: next, isPlaceholder: false, clickable: true }
               : { key: 'ph-right', role: 'right', song: null, isPlaceholder: true, placeholderText: 'NEXT', clickable: false },
        ];
      }
      updateItems();

      state.goNext = () => {
        if (curIdx < songs.length - 1) {
          state.coverTransitionDirection = 'next';
          state.coverTransitionName = 'fm-shift-next';
          curIdx++;
          updateItems();
        }
      };

      state.goPrev = () => {
        if (curIdx > 0) {
          state.coverTransitionDirection = 'prev';
          state.coverTransitionName = 'fm-shift-prev';
          curIdx--;
          updateItems();
        }
      };

      state.handleCoverSlotClick = (item) => {
        if (item.role === 'right') state.goNext();
        else if (item.role === 'left') state.goPrev();
      };

      Vue.createApp({
        setup: () => state,
        render: new Function('Vue', ${JSON.stringify(render)})(Vue)
      }).mount('#preview');
      window.testState = state;
      void 0;
    `);

    // Let initial render settle
    await new Promise(r => setTimeout(r, 100));

    // Verify initial slot structure
    const initialCheck = await win.webContents.executeJavaScript(`(() => {
      const leftBtn = document.querySelector('.fm-cover-slot.slot-left');
      const centerBtn = document.querySelector('.fm-cover-slot.slot-center');
      const rightBtn = document.querySelector('.fm-cover-slot.slot-right');
      const centerStage = centerBtn.querySelector('.fm-center-stage');
      const cd = centerStage.querySelector('.fm-cd');
      const reflection = centerStage.querySelector('.fm-cover-reflection');
      const leftCd = leftBtn.querySelector('.fm-cd');
      const rightCd = rightBtn.querySelector('.fm-cd');

      return {
        hasLeft: !!leftBtn,
        hasCenter: !!centerBtn,
        hasRight: !!rightBtn,
        hasCenterStage: !!centerStage,
        hasCdInCenter: !!cd,
        hasReflectionInCenter: !!reflection,
        leftHasNoCd: !leftCd,
        rightHasNoCd: !rightCd,
      };
    })()`);

    assert.ok(initialCheck.hasLeft, 'Left slot must exist');
    assert.ok(initialCheck.hasCenter, 'Center slot must exist');
    assert.ok(initialCheck.hasRight, 'Right slot must exist');
    assert.ok(initialCheck.hasCenterStage, 'Center stage must exist inside center slot');
    assert.ok(initialCheck.hasCdInCenter, 'CD disc must exist inside center stage');
    assert.ok(initialCheck.hasReflectionInCenter, 'Reflection must exist inside center stage');
    assert.ok(initialCheck.leftHasNoCd, 'Left thumbnail must not contain CD disc');
    assert.ok(initialCheck.rightHasNoCd, 'Right thumbnail must not contain CD disc');

    // Click right slot to go next
    await win.webContents.executeJavaScript(`
      document.querySelector('.fm-cover-slot.slot-right').click();
      void 0;
    `);

    // Wait 50ms during transition
    await new Promise(r => setTimeout(r, 50));

    const duringNextCheck = await win.webContents.executeJavaScript(`(() => {
      const leftBtn = document.querySelector('.fm-cover-slot.slot-left');
      const centerBtn = document.querySelector('.fm-cover-slot.slot-center');
      const rightBtn = document.querySelector('.fm-cover-slot.slot-right');
      const leftRect = leftBtn.getBoundingClientRect();
      const rightRect = rightBtn.getBoundingClientRect();
      const centerRect = centerBtn.getBoundingClientRect();

      return {
        curSongId: window.testState.currentSong.id,
        transitionName: window.testState.coverTransitionName,
        leftWidth: leftRect.width,
        rightWidth: rightRect.width,
        centerWidth: centerRect.width,
        hasCdInCenter: !!centerBtn.querySelector('.fm-cd'),
        hasReflectionInCenter: !!centerBtn.querySelector('.fm-cover-reflection'),
      };
    })()`);

    assert.equal(duringNextCheck.curSongId, 3, 'Current song should update to song C (id 3)');
    assert.equal(duringNextCheck.transitionName, 'fm-shift-next', 'Transition name must be fm-shift-next');
    assert.ok(duringNextCheck.hasCdInCenter, 'Center slot must retain CD disc');
    assert.ok(duringNextCheck.hasReflectionInCenter, 'Center slot must retain water reflection');
    assert.ok(duringNextCheck.leftWidth < 120, 'Left slot must remain thumbnail size during transition');
    assert.ok(duringNextCheck.rightWidth < 120, 'Right slot must remain thumbnail size during transition');
    assert.ok(duringNextCheck.centerWidth > 180, 'Center slot must remain stage size during transition');

    // Wait for transition to complete
    await new Promise(r => setTimeout(r, 400));

    // Click left slot to go prev
    await win.webContents.executeJavaScript(`
      document.querySelector('.fm-cover-slot.slot-left').click();
      void 0;
    `);

    await new Promise(r => setTimeout(r, 50));

    const duringPrevCheck = await win.webContents.executeJavaScript(`(() => {
      return {
        curSongId: window.testState.currentSong.id,
        transitionName: window.testState.coverTransitionName,
      };
    })()`);

    assert.equal(duringPrevCheck.curSongId, 2, 'Current song should update back to song B (id 2)');
    assert.equal(duringPrevCheck.transitionName, 'fm-shift-prev', 'Transition name must be fm-shift-prev');

    console.log('FM navigation animation check passed: smooth fixed slots, stage transition, no layout jumping, CD & reflection retained!');
  } catch (err) {
    console.error('FM navigation check failed:', err);
    process.exit(1);
  } finally {
    app.quit();
  }
});
