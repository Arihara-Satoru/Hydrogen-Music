// Run: node scripts/check-home-skeleton.cjs [optional-preview-directory]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], { env, stdio: 'inherit', windowsHide: true });
  process.exit(result.status ?? 1);
}

const { app, BrowserWindow } = require('electron');
const { parse, compileScript, compileStyle } = require('@vue/compiler-sfc');
const root = path.resolve(__dirname, '..');
const previewDir = process.argv[2];
const components = ['base/SkeletonBox', 'Banner', 'NewestSong', 'RecListItem', 'Recommendation', 'RecList', '../views/HomePage'];
const css = ['reset', 'style', 'theme'].map(name => fs.readFileSync(path.join(root, `src/assets/css/${name}.css`), 'utf8'));
const compiled = components.map((name, index) => {
  const filename = path.join(root, `src/components/${name}.vue`);
  const { descriptor } = parse(fs.readFileSync(filename, 'utf8'));
  const id = `home-skeleton-${index}`;
  for (const style of descriptor.styles) {
    const result = compileStyle({ source: style.content, filename, id: `data-v-${id}`, scoped: style.scoped, preprocessLang: style.lang });
    assert.deepEqual(result.errors, []);
    css.push(result.code);
  }
  const script = compileScript(descriptor, { id, inlineTemplate: true }).content
    .replace(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/g, (_match, bindings, source) => {
      if (source === 'vue') return `const ${bindings.replace(/\bas\b/g, ':')} = Vue;`;
      if (bindings.trim().startsWith('{')) return `const ${bindings} = deps;`;
      return `const ${bindings.trim()} = deps[${JSON.stringify(bindings.trim())}];`;
    })
    .replace('export default', 'return');
  return { name: path.basename(name), id, script };
});
css.push('.mainWindow { width: 100%; min-height: 100vh; } #preview { padding: 70px 45px 0; }');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 950, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>${css.join('\n')}</style><div class="mainWindow"><div id="preview"></div></div>`));
    await win.webContents.executeJavaScript(fs.readFileSync(require.resolve('vue/dist/vue.global.prod.js'), 'utf8') + '; void 0');
    await win.webContents.executeJavaScript(`
      var requests = {}, calls = {}, ready = 0;
      var request = key => {
        calls[key] = (calls[key] || 0) + 1;
        return new Promise((resolve, reject) => { requests[key] = {resolve, reject}; });
      };
      var player = Vue.reactive({songId: null, playing: false, showSongTranslation: false});
      var deps = {
        getBanner: () => request('banner'), getNewestSong: () => request('songs'),
        getRecommendedSongList: () => request('0'), getRecommendedArtists: () => request('1'),
        getNewAlbum: () => request('2'), getTopList: () => request('3'),
        useRouter: () => ({push() {}}), onBeforeRouteLeave() {},
        useUserStore: () => ({homePage: true}), usePlayerStore: () => player,
        useLibraryStore: () => ({}), useLocalStore: () => ({}),
        storeToRefs: Vue.toRefs, resolveImageUrl: value => value || '',
        getSongDisplayName: song => song.name, addToNext() {}, startMusic() {}, pauseMusic() {}, playAll() {},
        isLogin: () => false, noticeOpen() {},
        BreakingNewsDetailModal: {render: () => null},
      };
      ${compiled.map(({ name, id, script }) => `deps[${JSON.stringify(name)}] = new Function('Vue', 'deps', ${JSON.stringify(script)})(Vue, deps); deps[${JSON.stringify(name)}].__scopeId = 'data-v-${id}';`).join('\n')}
      var visible = Vue.ref(true);
      var testApp = Vue.createApp({ setup: () => () => Vue.h(Vue.KeepAlive, null, {default: () => visible.value ? Vue.h(deps.HomePage) : null}) });
      testApp.directive('lazy', {});
      window.windowApi = {notifyStartupReady: () => ready++};
      testApp.mount('#preview');
      var flush = async () => { await new Promise(resolve => setTimeout(resolve, 30)); await Vue.nextTick(); };
      var reactivate = async () => { visible.value = false; await Vue.nextTick(); visible.value = true; await flush(); };
      var snapshot = () => ({
        busy: document.querySelectorAll('[aria-busy="true"]').length,
        covers: [...document.querySelectorAll('.rec-list-item')].map(el => el.querySelectorAll('.skeleton-cover').length),
        titles: [...document.querySelectorAll('.header-title-cn')].map(el => el.textContent),
        songRows: document.querySelectorAll('.newest-song .skeleton-item').length,
      });
      void 0;
    `);
    const initial = await win.webContents.executeJavaScript('snapshot()');
    assert.equal(initial.busy, 6, 'All asynchronous sections start busy');
    assert.deepEqual(initial.covers, [10, 5, 10, 5], 'Skeleton counts match requested rows');
    assert.deepEqual(initial.titles, ['推荐歌单', '推荐歌手', '最新专辑', '排行榜'], 'Titles are available before the requests settle');
    assert.equal(initial.songRows, 3);

    win.webContents.debugger.attach('1.3');
    for (const width of [1400, 1080, 800]) {
      win.setContentSize(width, 950);
      for (const dark of [false, true]) {
        await win.webContents.executeJavaScript(`document.documentElement.classList.toggle('dark', ${dark}); flush()`);
        const geometry = await win.webContents.executeJavaScript(`(() => {
          const rect = el => { const r = el.getBoundingClientRect(); return {width: r.width, height: r.height, top: r.top}; };
          return {
            cover: rect(document.querySelector('.skeleton-cover')),
            banner: rect(document.querySelector('.banner-img')),
            song: rect(document.querySelector('.newest-song')),
            base: getComputedStyle(document.querySelector('.skeleton-box')).backgroundColor,
            hidden: [...document.querySelectorAll('.skeleton-box')].every(el => el.getAttribute('aria-hidden') === 'true'),
          };
        })()`);
        assert.ok(Math.abs(geometry.cover.width - geometry.cover.height) < 1, 'Cover placeholder is square at every width');
        assert.ok(Math.abs(geometry.banner.height - width * 0.137) < 1);
        assert.ok(Math.abs(geometry.banner.top - geometry.song.top) < 1, 'Header columns stay aligned');
        assert.ok(geometry.hidden, 'Decorative placeholders are hidden from assistive technology');
        assert.equal(geometry.base, dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)');
        if (previewDir && width === 1400) {
          await new Promise(resolve => setTimeout(resolve, 600));
          const image = await win.webContents.capturePage();
          fs.mkdirSync(previewDir, { recursive: true });
          fs.writeFileSync(path.join(previewDir, `${dark ? 'dark' : 'light'}.png`), image.toPNG());
        }
      }
    }
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    assert.equal(await win.webContents.executeJavaScript('getComputedStyle(document.querySelector(".skeleton-box"), "::after").animationName'), 'none');

    await win.webContents.executeJavaScript(`requests['0'].resolve({result: [{id: 1, name: '测试歌单'}]}); flush()`);
    const partial = await win.webContents.executeJavaScript('snapshot()');
    assert.equal(partial.busy, 5, 'One section finishing does not hide the other skeletons');
    assert.deepEqual(partial.covers, [0, 5, 10, 5], 'Reactive state replaces the playlist skeleton');
    await win.webContents.executeJavaScript(`
      requests.banner.resolve({banners: []}); requests.songs.reject(new Error('test request failure'));
      requests['1'].resolve({artists: []}); requests['2'].resolve({albums: []}); requests['3'].reject(new Error('test request failure'));
      flush();
    `);
    assert.equal(await win.webContents.executeJavaScript('snapshot().busy'), 0, 'Failures and empty results stop loading');
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll(".skeleton-box").length'), 0, 'No permanent skeletons after failure');
    assert.equal(await win.webContents.executeJavaScript('ready'), 1, 'Startup readiness is still notified');
    await win.webContents.executeJavaScript('reactivate()');
    assert.deepEqual(await win.webContents.executeJavaScript('calls'), { banner: 1, songs: 2, 0: 1, 1: 1, 2: 1, 3: 2 }, 'Reuse successful and empty results; retry failed sections');
    assert.equal(await win.webContents.executeJavaScript('snapshot().busy'), 2);
    await win.webContents.executeJavaScript(`requests.songs.resolve({result: [{id: 1, name: '测试歌曲', ar: []}]}); requests['3'].resolve({list: []}); flush()`);
    assert.equal(await win.webContents.executeJavaScript('snapshot().busy'), 0);
    assert.equal(await win.webContents.executeJavaScript('document.querySelector(".song-name").textContent'), '测试歌曲');
    console.log('Home skeleton checks passed: loading, independent completion, errors, empty results, cache, retry, themes, sizing and reduced motion.');
  } finally {
    win.destroy();
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
