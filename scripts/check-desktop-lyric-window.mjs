import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [backgroundSource, lyricSource, ipcSource, preloadSource, tourSource] = await Promise.all([
  readFile('background.js', 'utf8'),
  readFile('src/components/DesktopLyric.vue', 'utf8'),
  readFile('src/electron/ipcMain.js', 'utf8'),
  readFile('src/electron/preload.js', 'utf8'),
  readFile('src/components/OnboardingTour.vue', 'utf8'),
])

assert.match(backgroundSource, /transparent:\s*true,[\s\S]*backgroundColor:\s*["']#00000000["']/)
assert.match(lyricSource, /free:\s*\{\s*minWidth:\s*0,\s*minHeight:\s*0,\s*maxWidth:\s*0,\s*maxHeight:\s*0\s*\}/)
assert.match(lyricSource, /compactMode\.value\s*\|\|\s*transparentMode\.value[\s\S]*WINDOW_LIMITS\.free\.minWidth/)
assert.match(lyricSource, /@change="handleViewModeChange\('compact'\)"/)
assert.match(lyricSource, /@change="handleViewModeChange\('transparent'\)"/)
assert.match(lyricSource, /is-transparent:not\(\.is-locked\):hover \.field-shell[\s\S]*var\(--ef-surface\) 22%/)
assert.doesNotMatch(lyricSource, /backdrop-filter|blur\(24px\)/)
assert.match(lyricSource, /transparentMode\.value && locked\.value && !onboardingActive\.value && !isLockedInteractiveTarget\(target\)/)
assert.match(lyricSource, /\.current-line__text, \.next-line p, \.control-dock/)
assert.match(preloadSource, /setLyricWindowIgnoreMouseEvents:[\s\S]*set-lyric-window-ignore-mouse-events/)
assert.match(ipcSource, /set-lyric-window-ignore-mouse-events[\s\S]*setIgnoreMouseEvents\(Boolean\(ignore\)/)
assert.match(ipcSource, /forward:\s*Boolean\(ignore\)/)
assert.match(lyricSource, /DESKTOP_LYRIC_CONFIG_KEY = 'hydrogen:desktop-lyric-config:v1'/)
assert.match(lyricSource, /watch\([\s\S]*locked, lyricFontSize, selectedLyricType, compactMode, transparentMode[\s\S]*persistDesktopLyricConfig/)
assert.match(lyricSource, /await saveCurrentWindowBounds\(\)[\s\S]*isClosing\.value = true/)
assert.match(lyricSource, /restoreDesktopLyricConfig[\s\S]*setLyricWindowMinMax[\s\S]*resizeWindow/)
assert.match(lyricSource, /beforeunload', persistCurrentBrowserBounds/)
assert.match(lyricSource, /onboardingOriginalBounds = bounds[\s\S]*await resizeWindow\(width, height\)/)
assert.match(lyricSource, /await resizeWindow\(bounds\.width, bounds\.height\)/)
assert.match(lyricSource, /if \(!onboardingOriginalBounds\) persistDesktopLyricConfig\(bounds\)/)
assert.match(tourSource, /max-height: calc\(100vh - 16px\); overflow-y: auto/)

console.log('desktop lyric window check passed')
