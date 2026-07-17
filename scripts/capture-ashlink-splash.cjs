const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "design-qa");
const firstCapturePath = path.join(outputDir, "ashlink-motion-a.png");
const implementationPath = path.join(outputDir, "ashlink-implementation.png");
const diagnosticsPath = path.join(outputDir, "ashlink-diagnostics.json");
const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const errors = [];
  const window = new BrowserWindow({
    width: 720,
    height: 480,
    useContentSize: true,
    x: -10000,
    y: -10000,
    show: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: "#080806",
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.on("console-message", (details) => {
    if (["warning", "error"].includes(details.level)) errors.push(details.message);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    errors.push(`render process gone: ${details.reason}`);
  });

  try {
    fs.mkdirSync(outputDir, { recursive: true });
    window.setContentSize(720, 480);
    await window.loadFile(path.join(root, "splash-ashlink.html"));
    await window.webContents.executeJavaScript(
      'window.setSplashStatus("LINK STABILITY", 91)',
    );
    await wait(650);
    const firstCapture = await window.webContents.capturePage();
    fs.writeFileSync(firstCapturePath, firstCapture.toPNG());

    await wait(1100);
    const secondCapture = await window.webContents.capturePage();
    fs.writeFileSync(implementationPath, secondCapture.toPNG());

    const firstBitmap = firstCapture.toBitmap();
    const secondBitmap = secondCapture.toBitmap();
    assert.equal(firstBitmap.length, secondBitmap.length);
    let changedBytes = 0;
    for (let index = 0; index < firstBitmap.length; index += 1) {
      if (firstBitmap[index] !== secondBitmap[index]) changedBytes += 1;
    }

    const diagnostics = await window.webContents.executeJavaScript(`({
      name: window.__ashLinkMotion.name,
      trackCount: Object.keys(window.__ashLinkMotion.motionTracks).length,
      easingCount: new Set(Object.values(window.__ashLinkMotion.motionTracks).map(({ easing }) => easing)).size,
      contourSpeedCount: new Set(window.__ashLinkMotion.contourSpeeds).size,
      particleSpeedCount: new Set(window.__ashLinkMotion.particleSpeeds).size,
      bandParticleSpeedCount: new Set(window.__ashLinkMotion.bandParticleSpeeds).size,
      progressSpeedCount: new Set(window.__ashLinkMotion.progressSegmentSpeeds).size,
      progressPulseCount: new Set(window.__ashLinkMotion.progressPulseSpeeds).size,
      beamSpeedCount: new Set(window.__ashLinkMotion.beamStripSpeeds).size,
    })`);
    const contentBounds = window.getContentBounds();

    assert.equal(diagnostics.name, "灰烬链路");
    assert.equal(diagnostics.trackCount, 14);
    assert.ok(diagnostics.easingCount >= 8);
    assert.deepEqual(
      { width: contentBounds.width, height: contentBounds.height },
      { width: 720, height: 480 },
    );
    assert.ok(diagnostics.contourSpeedCount > 20);
    assert.ok(diagnostics.particleSpeedCount > 70);
    assert.ok(diagnostics.bandParticleSpeedCount > 120);
    assert.ok(diagnostics.progressSpeedCount > 50);
    assert.ok(diagnostics.progressPulseCount > 50);
    assert.ok(diagnostics.beamSpeedCount > 12);
    assert.ok(changedBytes > firstBitmap.length * 0.02, "motion frames should visibly differ");

    const finishStart = Date.now();
    await window.webContents.executeJavaScript("window.finishSplash()");
    const finishDuration = Date.now() - finishStart;
    assert.ok(finishDuration > 100 && finishDuration < 1200);
    assert.deepEqual(errors, []);

    const result = {
          firstCapturePath,
          implementationPath,
          changedBytes,
          changedRatio: changedBytes / firstBitmap.length,
          diagnostics,
          contentBounds,
          finishDuration,
          consoleErrors: errors,
    };
    fs.writeFileSync(diagnosticsPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
