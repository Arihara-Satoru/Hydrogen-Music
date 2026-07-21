import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readSource = (relativePath) =>
  readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

const [background, ipcMain, preload, app, tray, mpris, stub] = await Promise.all([
  readSource("background.js"),
  readSource("src/electron/ipcMain.js"),
  readSource("src/electron/preload.js"),
  readSource("src/App.vue"),
  readSource("src/electron/tray.js"),
  readSource("src/electron/mpris.js"),
  readSource("src/utils/windowApiStub.js"),
]);

assert.match(background, /const PLAYER_SAVE_TIMEOUT_MS = 750;/);
assert.match(background, /const SHUTDOWN_ANIMATION_TIMEOUT_MS = 1500;/);
assert.match(background, /shutdownPhase = "saving"/);
assert.match(background, /shutdownPhase = "animating"/);
assert.match(background, /shutdownPhase = "finalizing"/);
assert.match(background, /!myWindow\.isVisible\(\)/);
assert.match(background, /myWindow\.isMinimized\(\)/);
assert.match(background, /webContents\.send\("player-save"\)/);
assert.match(background, /webContents\.send\("shutdown-animation"\)/);
assert.match(background, /event\.preventDefault\(\);\s*requestAppQuit\(\);/);
assert.match(background, /transparent: true,\s*backgroundColor: "#00000000"/);
assert.match(background, /setIgnoreMouseEvents\(true\)/);
assert.match(background, /setHasShadow\?\.\(false\)/);
assert.match(background, /setWindowButtonVisibility\?\.\(false\)/);
assert.match(background, /animatedWindow\.destroy\(\)/);
assert.match(background, /handleShutdownAnimationComplete = \(\) => \{\s*if \(shutdownPhase === "animating"\) finishAppQuit\(true\)/);
assert.doesNotMatch(background, /setTimeout\(\(\) => \{\s*app\.quit\(\);\s*\}, 500\)/);

assert.match(ipcMain, /ipcMain\.on\("exit-app"/);
assert.match(ipcMain, /handlePlayerSaved\(\)/);
assert.match(ipcMain, /ipcMain\.on\("shutdown-animation-complete"/);
assert.match(ipcMain, /requestAppQuit\(\(\) => autoUpdater\.quitAndInstall\(\)\)/);

assert.match(preload, /function onShutdownAnimation\(callback\)/);
assert.match(preload, /removeListener\("shutdown-animation", listener\)/);
assert.match(preload, /function completeShutdownAnimation\(\)/);
assert.match(stub, /onShutdownAnimation: \(\) => noop/);
assert.match(stub, /completeShutdownAnimation: noop/);

assert.doesNotMatch(app, /<Teleport|crt-shutdown__|background:\s*#000/);
assert.match(app, /document\.body\.classList\.add\('crt-shutdown-active'\)/);
assert.match(app, /animation: crt-window-collapse 1000ms linear both/);
assert.match(app, /body\.crt-shutdown-active::before/);
assert.match(app, /body\.crt-shutdown-active::after/);
assert.match(app, /background: transparent !important/);
assert.match(app, /mask-image: repeating-linear-gradient/);
assert.match(app, /@keyframes crt-beam-collapse/);
assert.match(app, /@keyframes crt-dot-afterglow/);
assert.match(app, /@media \(prefers-reduced-motion: reduce\)/);
assert.match(app, /animation: crt-window-fade 150ms ease-out both/);

assert.match(tray, /label: '退出',[\s\S]*?app\.quit\(\)/);
assert.match(mpris, /player\.on\('quit', \(\) => app\.quit\(\)\)/);

console.log("CRT shutdown animation checks passed (1000ms, reduced motion 150ms).");
