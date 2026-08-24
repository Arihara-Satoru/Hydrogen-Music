# Tauri migration

The renderer was already Vue 3 + Vite + Pinia + Vue Router. This branch therefore keeps `src/` and replaces Electron behind the existing `windowApi`, `electronAPI`, and `playerApi` boundaries.

## Completed on `codex/tauri`

- [x] Add a Tauri v2 desktop host while retaining Electron as a comparison/fallback host.
- [x] Reuse the production Vite build, application icon, frameless title bar, and window controls.
- [x] Package the existing sibling Rust KuGou API as a sidecar, keep its device identity stable, health-check it, and terminate it with the app.
- [x] Persist settings, playlist/progress, local hash mappings, and video records with backup recovery.
- [x] Migrate dialogs, external links, file reveal, clipboard writes, and dynamically scoped local-file URLs.
- [x] Migrate recursive local-library scanning, audio tags, covers, lyrics, hashes, and missing-folder behavior.
- [x] Migrate queued music downloads, progress/pause/resume/cancel, safe destinations, lyric sidecars, and embedded tags/covers.
- [x] Migrate tray controls, close-to-tray behavior, global/local shortcuts, and browser Media Session controls.
- [x] Rebuild desktop lyrics as a transparent second Tauri window with data/control forwarding, bounds, resize, and lock behavior.
- [x] Migrate the renderer's restricted Siren/Bilibili request proxy and cloud-audio metadata extraction.
- [x] Migrate local video pools, Bilibili video caching/progress/cancel, video associations, and cache cleanup.
- [x] Check GitHub Releases for updates and use the existing manual-download path on every Tauri platform.

## Remaining release work

- [ ] Configure Tauri's signed in-app updater after the maintainer generates and secures a signing key. Tauri does not permit unsigned updater artifacts, so this branch intentionally opens the GitHub Release page instead of fabricating an install path.
- [ ] Port Windows “pause on other audio” monitoring. The current Tauri fallback reports it as unsupported; playback itself is unaffected.
- [ ] Decide whether system-font enumeration is worth retaining. The bundled fonts and manually entered CSS font families continue to work.
- [ ] If Bilibili stops providing AVC streams, package an FFmpeg sidecar for HEVC-to-H.264 conversion. The current selector already prefers AVC and keeps HEVC unchanged as a fallback.
- [ ] Complete visual QA for the desktop-lyric window. Automated compilation and its bounds/input tests pass, but UI control was stopped when user input was detected in the shared app window.
- [x] Build and verify Windows x64 MSI and NSIS installer generation.
- [ ] Verify installers on macOS and Linux, then remove Electron-only source, scripts, and dependencies in a separate cleanup commit.

## Checks

```powershell
pnpm check:tauri-window-api
pnpm build
Push-Location src-tauri
cargo fmt --all -- --check
cargo test --locked
Pop-Location
pnpm tauri:build
```

The migration keeps one compatibility rule: a capability is exposed under the same renderer method name on both hosts. Unported platform-specific features return an explicit safe fallback instead of crashing the Vue application.
