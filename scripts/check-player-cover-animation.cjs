// Run: node scripts/check-player-cover-animation.cjs [optional-preview-directory]
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
const { compile } = require('@vue/compiler-dom');
const root = path.resolve(__dirname, '..');
const previewDir = process.argv[2];
const loadComponent = file => parse(fs.readFileSync(path.join(root, file), 'utf8'), { filename: path.join(root, file) }).descriptor;
const player = loadComponent('src/components/Player.vue');
const music = loadComponent('src/views/MusicPlayer.vue');
const skeleton = loadComponent('src/components/base/SkeletonBox.vue');
const coverLoading = player.scriptSetup.content.slice(
  player.scriptSetup.content.indexOf('const coverImage = ref(null);'),
  player.scriptSetup.content.indexOf('const safePlaybackRate ='),
);
assert.ok(coverLoading.includes('onCoverImageLoad'), 'Exercise the real image loading state');
const skeletonScript = compileScript(skeleton, { id: 'cover-skeleton-check', inlineTemplate: true }).content
  .replace(/import\s+\{([^}]+)\}\s+from\s+['"]vue['"];?/g, (_match, bindings) => `const {${bindings.replace(/\bas\b/g, ':')}} = Vue;`)
  .replace('export default', 'return');
const coverTemplate = player.template.content.slice(
  player.template.content.indexOf('<div class="player-cover">'),
  player.template.content.indexOf('<div class="player-info">'),
);
assert.ok(coverTemplate.includes('cover-stage'), 'Use the real cover markup');
const render = compile(coverTemplate, { mode: 'function' }).code;
const css = ['reset', 'style', 'theme'].map(name => fs.readFileSync(path.join(root, `src/assets/css/${name}.css`), 'utf8'));
for (const [descriptor, filename, id] of [
  [player, 'src/components/Player.vue', 'data-v-cover-check'],
  [music, 'src/views/MusicPlayer.vue', 'data-v-music-check'],
  [skeleton, 'src/components/base/SkeletonBox.vue', 'data-v-cover-skeleton-check'],
]) {
  for (const style of descriptor.styles) {
    const result = compileStyle({ source: style.content, filename: path.join(root, filename), id, scoped: style.scoped, preprocessLang: 'scss' });
    assert.deepEqual(result.errors, []);
    css.push(result.code);
  }
}
css.push('html, body, #preview { width: 100%; height: 100%; }');
const vue = fs.readFileSync(require.resolve('vue/dist/vue.global.prod.js'), 'utf8');
app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  // Hold image responses until the test explicitly releases them; no timing-dependent network sleeps.
  const pendingImages = new Map(), imageWaiters = new Map();
  const server = require('node:http').createServer((request, response) => {
    pendingImages.set(request.url, response);
    imageWaiters.get(request.url)?.();
    imageWaiters.delete(request.url);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const imageOrigin = `http://127.0.0.1:${server.address().port}`;
  const waitForImage = url => pendingImages.has(url) ? Promise.resolve() : new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Image request did not arrive: ${url}`)), 5000);
    imageWaiters.set(url, () => { clearTimeout(timeout); resolve(); });
  });
  const releaseImage = (url, { status = 200, width = 600, height = 600 } = {}) => {
    const response = pendingImages.get(url);
    assert.ok(response, `Image request reached the fixture: ${url}`);
    response.writeHead(status, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    response.end(status === 200 ? `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#203c43"/></svg>` : 'not found');
    pendingImages.delete(url);
  };
  const win = new BrowserWindow({ show: false, width: 1400, height: 900, webPreferences: { offscreen: true } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>${css.join('\n')}</style><div id="preview"></div>`));
    await win.webContents.executeJavaScript(vue + '; void 0');
    await win.webContents.executeJavaScript(`
      const { ref, nextTick, computed, watch, toRefs } = Vue;
      const coverUrl = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="#203c43"/><circle cx="300" cy="300" r="210" fill="#e8d880"/><circle cx="300" cy="300" r="140" fill="#203c43"/><text x="300" y="315" text-anchor="middle" fill="white" font-size="38">HYDROGEN</text></svg>');
      const state = Vue.reactive({ currentCoverUrl: coverUrl, currentSong: {id: 1}, songId: 1, currentIndex: 0,
        playerChangeSong: false, videoIsPlaying: false, backToVideo() {}, getDefaultCoverUrl: () => coverUrl });
      const SkeletonBox = new Function('Vue', ${JSON.stringify(skeletonScript)})(Vue);
      SkeletonBox.__scopeId = 'data-v-cover-skeleton-check';
      let coverState;
      const Cover = { __scopeId: 'data-v-cover-check', components: { SkeletonBox }, setup: () => {
        const { songId, currentSong, currentIndex, currentCoverUrl, playerChangeSong } = toRefs(state);
        const getDefaultCoverUrl = () => state.getDefaultCoverUrl();
        ${coverLoading}
        coverState = { ...toRefs(state), coverImage, coverImageKey, coverImageSrc, coverImageFailed, coverImageLoaded,
          coverImageUnavailable, showCoverSkeleton, onCoverImageLoad, onCoverImageError };
        return coverState;
      }, render: new Function('Vue', ${JSON.stringify(render)})(Vue) };
      const mountKey = ref(0), visible = ref(true);
      Vue.createApp({ components: { Cover }, setup: () => ({ mountKey, visible }), template:
        '<div class="music-player" data-v-music-check v-show="visible"><div :key="mountKey" class="player-container" data-v-music-check data-v-cover-check><div class="player" data-v-cover-check><div class="player-body" data-v-cover-check><Cover /><div class="player-info" data-v-cover-check>Find the Pieces</div><div class="player-control" data-v-cover-check>00:00 — 04:06</div></div></div></div></div>'
      }).mount('#preview');
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      };
      const snapshot = () => {
        const q = selector => document.querySelector(selector);
        return { panel: rect(q('.player-container')), body: rect(q('.player-body')), cover: rect(q('.cover img')),
          artwork: rect(q('.cover-artwork')), info: rect(q('.player-info')), controls: rect(q('.player-control')),
          busy: q('.cover-artwork').getAttribute('aria-busy'), skeleton: !!q('.cover-skeleton'),
          stage: rect(q('.cover-stage')), corners: [...document.querySelectorAll('.c-border')].map(el => ({ ...rect(el), opacity: Number(getComputedStyle(el).opacity) })) };
      };
      const seek = async time => {
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
        await frame();
        return snapshot();
      };
      const restart = async () => {
        state.playerChangeSong = false; state.videoIsPlaying = false;
        mountKey.value++; await nextTick();
        await document.querySelector('.cover img').decode();
        await seek(0);
      };
      void 0;
    `);

    const close = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1.5, `${label}: ${actual} vs ${expected}`);
    const assertAttached = (sample, label) => {
      for (const [index, x, y] of [[0, 'x', 'y'], [1, 'right', 'y'], [2, 'right', 'bottom'], [3, 'x', 'bottom']]) {
        close(sample.corners[index][x], sample.cover[x], `${label}: corner ${index + 1} horizontal attachment`);
        close(sample.corners[index][y], sample.cover[y], `${label}: corner ${index + 1} vertical attachment`);
      }
    };

    for (const [width, height] of [[1400, 900], [1000, 700], [800, 1000], [390, 844]]) {
      win.setContentSize(width, height);
      await win.webContents.executeJavaScript('restart()');
      const label = `${width}x${height}`;
      if (width / height <= 5 / 6) {
        const hidden = await win.webContents.executeJavaScript(`getComputedStyle(document.querySelector('.player-container')).display`);
        assert.equal(hidden, 'none', `${label}: preserve the portrait layout`);
        continue;
      }
      const samples = await win.webContents.executeJavaScript(`(async () => {
        const result = {};
        for (const time of [600, 899, 900, 1055, 1105, 1155, 1205, 1250, 1400, 1550]) result[time] = await seek(time);
        return result;
      })()`);
      assert.ok(samples[600].panel.height < samples[900].panel.height, `${label}: sample during shell expansion`);
      close(samples[899].cover.width, samples[900].cover.width, `${label}: no early cover shrink`);
      assertAttached(samples[899], label);
      for (const time of [900, 1055, 1105, 1155, 1205]) {
        close(samples[time].cover.width, samples[899].cover.width, `${label}/${time}: keep enlarged cover throughout cue`);
        assertAttached(samples[time], `${label}/${time}`);
      }
      for (const [time, opacity] of [[899, 1], [900, 0], [1055, 1], [1105, 0], [1155, 1], [1205, 0], [1250, 1]]) {
        assert.ok(samples[time].corners.every(corner => Math.abs(corner.opacity - opacity) < 0.01), `${label}/${time}: all corners flash in sync`);
      }
      assert.ok(Math.abs(samples[1250].cover.width / samples[1550].cover.width - 1.04) < 0.001, `${label}: 4% initial enlargement`);
      assert.ok(samples[1400].cover.width < samples[1250].cover.width && samples[1400].cover.width > samples[1550].cover.width, `${label}: continuous cover shrink`);
      assert.ok(samples[1400].cover.x - samples[1400].corners[0].x > 0, `${label}: corners expand while the cover shrinks`);
      close(samples[1550].corners[0].x, samples[1550].stage.x, `${label}: final corner position`);
      close(samples[1550].corners[2].right, samples[1550].stage.right, `${label}: final opposite corner position`);
      assert.ok(samples[1550].cover.x > samples[1550].corners[0].x + 5, `${label}: restore normal cover-frame gap`);
      assert.ok(samples[1250].cover.x >= samples[1250].body.x - 1 && samples[1250].cover.right <= samples[1250].body.right + 1, `${label}: enlarged cover stays inside clipping bounds`);

      const switchState = await win.webContents.executeJavaScript(`(async () => {
        await seek(1550); const before = document.querySelector('.cover-stage');
        state.playerChangeSong = true; state.songId = 2; await nextTick();
        const changing = document.querySelector('.cover img').classList.contains('cover-change');
        state.playerChangeSong = false; await nextTick();
        visible.value = false; await nextTick(); await frame();
        visible.value = true; await nextTick(); await frame();
        const reopened = await seek(899);
        return { reused: before === document.querySelector('.cover-stage'),
          cueDelay: document.querySelector('.c-border').getAnimations().find(a => a.animationName.includes('dialog-entry-cue')).effect.getTiming().delay,
          coverChange: document.querySelector('.cover img').classList.contains('cover-change'), changing, reopened };
      })()`);
      assert.ok(switchState.reused && switchState.changing && !switchState.coverChange, `${label}: preserve song-change and hide/reopen behavior`);
      assertAttached(switchState.reopened, `${label}: replay after reopening`);
      close(switchState.reopened.cover.width, samples[899].cover.width, `${label}: restore enlarged opening frame`);
      assert.ok(Math.abs(switchState.cueDelay - 900) < 0.01, `${label}: cue follows the shared shell timeline`);
    }

    // Change shell timing to prove this is linked rather than a duplicated fixed delay.
    win.setContentSize(1400, 900);
    const linked = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('.music-player').style.setProperty('--player-entry-duration', '1100ms');
      await restart();
      return document.querySelector('.c-border').getAnimations().find(a => a.animationName.includes('dialog-entry-cue')).effect.getTiming().delay;
    })()`);
    assert.ok(Math.abs(linked - 1300) < 0.01, 'Changing shell duration also updates the cover cue');
    await win.webContents.executeJavaScript(`document.querySelector('.music-player').style.removeProperty('--player-entry-duration'); restart()`);

    if (previewDir) {
      fs.mkdirSync(previewDir, { recursive: true });
      for (const [name, time] of [['attached', 899], ['blink-off', 1105], ['expanding', 1400], ['settled', 1550]]) {
        await win.webContents.executeJavaScript(`seek(${time})`);
        fs.writeFileSync(path.join(previewDir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
      }
    }

    const assertStableLayout = (before, after, label) => {
      for (const part of ['stage', 'artwork', 'info', 'controls']) {
        for (const prop of ['x', 'y', 'width', 'height']) close(after[part][prop], before[part][prop], `${label}/${part}/${prop}`);
      }
      for (let i = 0; i < 4; i++) {
        for (const prop of ['x', 'y', 'width', 'height']) close(after.corners[i][prop], before.corners[i][prop], `${label}/corner-${i + 1}/${prop}`);
      }
    };

    // A deferred network image must not collapse the slot, corners, title or playback controls.
    for (const [width, height] of [[1400, 900], [1000, 700]]) {
      win.setContentSize(width, height);
      await win.webContents.executeJavaScript(`state.currentCoverUrl = coverUrl; restart()`);
      const before = await win.webContents.executeJavaScript('seek(1550)');
      assert.equal(before.skeleton, false, 'Loaded cover has no skeleton');
      const url = `/slow-cover-${width}`;
      const pending = await win.webContents.executeJavaScript(`(async () => {
        const staleImage = coverState.coverImage.value;
        state.playerChangeSong = true; state.songId++;
        state.currentCoverUrl = ${JSON.stringify(imageOrigin + url)};
        await nextTick();
        coverState.onCoverImageLoad({currentTarget: staleImage});
        coverState.onCoverImageError({currentTarget: staleImage});
        await seek(1550);
        return { sample: snapshot(), loaded: coverState.coverImageLoaded.value, failed: coverState.coverImageFailed.value,
          skeletonOpacity: getComputedStyle(document.querySelector('.cover-skeleton')).opacity,
          coverOpacity: getComputedStyle(document.querySelector('.cover')).opacity };
      })()`);
      await waitForImage(url);
      assert.equal(pending.sample.skeleton, true, 'Show skeleton while artwork is pending');
      assert.equal(pending.sample.busy, 'true', 'Expose the loading state accessibly');
      assert.equal(pending.loaded, false, 'Ignore late loads from replaced image nodes');
      assert.equal(pending.failed, false, 'Ignore late failures from replaced image nodes');
      assert.equal(pending.skeletonOpacity, '1', 'Song-change fade does not hide the skeleton');
      assert.equal(pending.coverOpacity, '1', 'Keep the cover slot visible during song changes');
      assertStableLayout(before, pending.sample, `${width}: pending cover`);
      for (const dark of [true, false]) {
        const theme = await win.webContents.executeJavaScript(`(async () => {
          document.documentElement.classList.toggle('dark', ${dark}); await frame();
          return { base: getComputedStyle(document.querySelector('.cover-skeleton')).backgroundColor,
            artwork: getComputedStyle(document.querySelector('.cover-artwork')).backgroundColor,
            hidden: document.querySelector('.cover-skeleton').getAttribute('aria-hidden') };
        })()`);
        const expected = dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
        assert.equal(theme.base, expected, 'Reuse the existing skeleton theme');
        assert.equal(theme.artwork, expected, 'Static artwork placeholder follows the active theme');
        assert.equal(theme.hidden, 'true', 'Decorative skeleton is hidden from assistive technology');
      }
      if (previewDir && width === 1400) {
        fs.writeFileSync(path.join(previewDir, 'loading-skeleton.png'), (await win.webContents.capturePage()).toPNG());
      }
      releaseImage(url, width === 1400 ? { width: 1200, height: 300 } : { width: 300, height: 1200 });
      const loaded = await win.webContents.executeJavaScript(`(async () => {
        await document.querySelector('.cover img').decode(); await nextTick(); await frame();
        const stillChanging = snapshot();
        state.playerChangeSong = false; await nextTick();
        const settled = await seek(1550);
        return { stillChanging, settled, ready: document.querySelector('.cover img').classList.contains('cover-image-ready') };
      })()`);
      assert.equal(loaded.stillChanging.skeleton, true, 'Keep skeleton until the song-change fade is released');
      assert.equal(loaded.settled.skeleton, false, 'Remove skeleton once the new cover is ready');
      assert.equal(loaded.settled.busy, 'false', 'Stop loading state after success');
      assert.ok(loaded.ready, 'Reveal the loaded image');
      assertStableLayout(before, loaded.stillChanging, `${width}: loaded during transition`);
      assertStableLayout(before, loaded.settled, `${width}: non-square artwork`);
      close(loaded.settled.artwork.width, loaded.settled.artwork.height, 'Crop wide/tall source images to a stable square');
    }

    // Reverse a pending load before it finishes; old completion must not reveal the new song early.
    const rapidBefore = await win.webContents.executeJavaScript('seek(1550)');
    await win.webContents.executeJavaScript(`(async () => {
      state.songId++; state.currentCoverUrl = ${JSON.stringify(imageOrigin + '/old-cover')}; await nextTick();
    })()`);
    await waitForImage('/old-cover');
    await win.webContents.executeJavaScript(`(async () => {
      state.songId++; state.currentCoverUrl = ${JSON.stringify(imageOrigin + '/new-cover')}; await nextTick();
    })()`);
    await waitForImage('/new-cover');
    releaseImage('/old-cover');
    assert.equal(await win.webContents.executeJavaScript('coverState.coverImageLoaded.value'), false, 'Old request cannot mark new artwork loaded');
    releaseImage('/new-cover');
    const rapidAfter = await win.webContents.executeJavaScript(`(async () => {
      await document.querySelector('.cover img').decode(); await nextTick(); return await seek(1550);
    })()`);
    assert.equal(rapidAfter.skeleton, false, 'Rapid song changes finish on the current artwork');
    assertStableLayout(rapidBefore, rapidAfter, 'Rapid song changes');

    // Errors fall back once to the default cover; missing artwork and cache hits keep the same slot.
    await win.webContents.executeJavaScript(`(async () => {
      state.songId++; state.currentCoverUrl = ${JSON.stringify(imageOrigin + '/broken-cover')}; await nextTick();
    })()`);
    await waitForImage('/broken-cover');
    releaseImage('/broken-cover', { status: 404 });
    const fallback = await win.webContents.executeJavaScript(`(async () => {
      const image = document.querySelector('.cover img');
      if (!coverState.coverImageFailed.value) await new Promise(resolve => image.addEventListener('error', resolve, {once:true}));
      await nextTick(); await document.querySelector('.cover img').decode(); await nextTick();
      return {sample: await seek(1550), failed: coverState.coverImageFailed.value};
    })()`);
    assert.equal(fallback.failed, true, 'Failed network cover selects the default artwork');
    assert.equal(fallback.sample.skeleton, false, 'Fallback success does not leave a permanent skeleton');
    assertStableLayout(rapidBefore, fallback.sample, 'Failed artwork');
    const missing = await win.webContents.executeJavaScript(`(async () => {
      state.songId++; state.currentCoverUrl = ''; await nextTick();
      await document.querySelector('.cover img').decode(); await nextTick();
      state.songId++; await nextTick(); await document.querySelector('.cover img').decode(); await nextTick();
      return await seek(1550);
    })()`);
    assert.equal(missing.skeleton, false, 'Missing artwork and cached default cover settle normally');
    assertStableLayout(rapidBefore, missing, 'Missing artwork');

    await win.webContents.executeJavaScript(`(async () => {
      state.getDefaultCoverUrl = () => ${JSON.stringify(imageOrigin + '/broken-default')};
      state.songId++; await nextTick();
    })()`);
    await waitForImage('/broken-default');
    releaseImage('/broken-default', { status: 404 });
    const unavailable = await win.webContents.executeJavaScript(`(async () => {
      if (!coverState.coverImageUnavailable.value) await new Promise(resolve => document.querySelector('.cover img').addEventListener('error', resolve, {once:true}));
      await nextTick(); return {sample: await seek(1550), unavailable: coverState.coverImageUnavailable.value};
    })()`);
    assert.ok(unavailable.unavailable && !unavailable.sample.skeleton && unavailable.sample.busy === 'false', 'Default-cover failure stops loading without retry loops');
    assertStableLayout(rapidBefore, unavailable.sample, 'Unavailable default artwork');

    win.setContentSize(1400, 900);
    await win.webContents.executeJavaScript('state.getDefaultCoverUrl = () => coverUrl; state.currentCoverUrl = coverUrl; restart()');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const reduced = await win.webContents.executeJavaScript(`(async () => {
      await restart();
      return { active: document.getAnimations().length, sample: snapshot() };
    })()`);
    assert.equal(reduced.active, 0, 'Reduced motion skips blinking, scaling, expansion and breathing');
    assert.ok(reduced.sample.corners.every(corner => corner.opacity === 1), 'Reduced motion keeps corners visible');
    close(reduced.sample.cover.width, reduced.sample.stage.width - 27, 'Reduced motion immediately shows the normal-size cover');
    const reducedSkeleton = await win.webContents.executeJavaScript(`(async () => {
      state.playerChangeSong = true; await nextTick();
      return getComputedStyle(document.querySelector('.cover-skeleton'), '::after').animationName;
    })()`);
    assert.equal(reducedSkeleton, 'none', 'Reduced motion also disables skeleton shimmer');
    console.log('Player cover checks passed: shell-linked intro, synchronized flashes and release, stable loading skeleton/layout, deferred/wide/tall/missing/failed artwork, stale events, rapid song changes, cache, reopen, portrait and reduced motion.');
  } finally {
    win.destroy();
    server.closeAllConnections();
    server.close();
  }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
