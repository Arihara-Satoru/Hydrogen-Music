const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "design-qa");
const firstCapturePath = path.join(outputDir, "ashen-motion-a.png");
const implementationPath = path.join(outputDir, "ashen-implementation.png");
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
    window.setContentSize(720, 480);
    await window.loadFile(path.join(root, "splash-ashen.html"));
    await window.webContents.executeJavaScript(
      'window.setSplashStatus("CONTAINMENT STABLE", 82)',
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
      name: window.__ashenMotion.name,
      trackCount: Object.keys(window.__ashenMotion.motionTracks).length,
      particleSpeedCount: new Set(window.__ashenMotion.particleSpeeds).size,
      channelSpeedCount: new Set(window.__ashenMotion.channelParticleSpeeds).size,
      progressSpeedCount: new Set(window.__ashenMotion.progressSegmentSpeeds).size,
      verticalSpeedCount: new Set(window.__ashenMotion.verticalSegmentSpeeds).size,
    })`);
    const contentBounds = window.getContentBounds();

    assert.equal(diagnostics.name, "灰域协议");
    assert.equal(diagnostics.trackCount, 13);
    assert.deepEqual(
      { width: contentBounds.width, height: contentBounds.height },
      { width: 720, height: 480 },
    );
    assert.ok(diagnostics.particleSpeedCount > 50);
    assert.ok(diagnostics.channelSpeedCount > 30);
    assert.ok(diagnostics.progressSpeedCount > 20);
    assert.ok(diagnostics.verticalSpeedCount > 20);
    assert.ok(changedBytes > firstBitmap.length * 0.02, "motion frames should visibly differ");
    const finishStart = Date.now();
    await window.webContents.executeJavaScript("window.finishSplash()");
    const finishDuration = Date.now() - finishStart;
    assert.ok(finishDuration > 100 && finishDuration < 1200);
    assert.deepEqual(errors, []);

    console.log(
      JSON.stringify(
        {
          implementationPath,
          changedBytes,
          changedRatio: changedBytes / firstBitmap.length,
          diagnostics,
          contentBounds,
          finishDuration,
          consoleErrors: errors,
        },
        null,
        2,
      ),
    );
  } finally {
    window.destroy();
    app.quit();
  }
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
