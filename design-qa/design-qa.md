# Splash redesign visual QA

- Source: `C:\Users\satira\.codex\generated_images\019f5faf-3203-7201-866b-051271a24fce\exec-915892e7-7fd7-40df-a7ca-c490ad11290f.png`
- Implementation screenshot (before the resize): `D:\data\project\ArkMusic\Hydrogen-Music\design-qa\splash-implementation.png`
- Production viewport: 720 × 480 CSS pixels; the 360 × 240 design coordinates are rendered at 2× scale
- State: `正在启动音乐服务...`, progress 38%
- Browser: Codex in-app Chromium browser

## Comparison evidence

- Full view, source on the left and implementation on the right: `splash-comparison-full.png`
- Focused progress region, source on the left and implementation on the right: `splash-comparison-progress.png`

The full-view comparison is rendered at 2× so the globe points, typography, calibration lines, and both background DNA structures remain readable. The focused comparison checks the status-to-progress spacing, continuous track, white fill, and yellow leading marker at the same loading state.

## Findings

- P0: none.
- P1: none after iteration.
- P2: the Canvas globe uses deliberately simplified continent masks; the 360 × 240 logical design preserves the selected silhouette and point-cloud character without adding a startup dependency.
- Layout matches the selected composition: compact logo at upper left, calibrated point globe left of center, waveform bridge, right-aligned brand block, and full-width bottom progress treatment.
- Motion verification passed: screenshots 1.2 seconds apart produced a non-zero frame difference (`mean 22.30`, `max 255`), covering globe and DNA animation.
- Accessibility checks passed: named progressbar with min/max/current value, readable status text, and a reduced-motion static rendering path.
- Splash code emitted no console warnings or errors. The in-app browser's injected instrumentation logged three source-less `MutationObserver` errors; neither `splash.html` nor the QA harness contains a `MutationObserver`, and the Electron smoke test did not reproduce them.

## Iteration history

1. Initial standalone capture showed the splash's pre-IPC 12% state while the approved source showed 38%.
2. Added a tiny QA-only preview harness that calls the production `window.setSplashStatus` API, then recaptured both images at the same 38% service-start state.
3. Rechecked the combined full view and focused progress region; no P0/P1 mismatch remained.

## Functional checks

- Canvas and DPR sizing: passed at 720 × 480 CSS pixels; backing pixels also account for the display DPR.
- Dynamic status/progress API: passed at the representative 38% state.
- Production build: passed with `npm run build`.
- Electron startup smoke test: passed through API readiness and main-window load.

final result: passed
