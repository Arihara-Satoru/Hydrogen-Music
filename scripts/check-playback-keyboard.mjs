import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { installSpacePlaybackShortcut } from '../src/utils/playbackKeyboard.mjs'

const target = new EventTarget()
target.document = { activeElement: null }
let toggles = 0
const dispose = installSpacePlaybackShortcut(target, () => toggles++)
function press(properties = {}, path = []) {
    const event = new Event('keydown', { cancelable: true })
    Object.assign(event, { key: ' ', composedPath: () => path }, properties)
    target.dispatchEvent(event)
    return event
}

assert.equal(press().defaultPrevented, true)
assert.equal(toggles, 1, 'Space outside controls toggles playback')
for (const selector of ['input', 'textarea', 'select', 'button', 'a[href]', 'summary', 'video', 'audio', '[role="textbox"]', '[role="switch"]', '.plyr']) {
    const control = { closest: selectors => selectors.split(', ').includes(selector) ? control : null }
    assert.equal(press({}, [control]).defaultPrevented, false, `${selector} keeps its native Space action`)
    // Focus fallback covers retargeted events; the composed path covers shadow children.
    target.document.activeElement = control
    assert.equal(press().defaultPrevented, false)
    target.document.activeElement = null
}
assert.equal(press({}, [{ isContentEditable: true }]).defaultPrevented, false)
for (const properties of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { key: 'Enter' }]) {
    assert.equal(press(properties).defaultPrevented, false)
}
const handled = new Event('keydown', { cancelable: true })
Object.assign(handled, { key: ' ' })
handled.preventDefault()
target.dispatchEvent(handled)
assert.equal(toggles, 1, 'Typing, IME, repeats and component-handled keys do not toggle playback')
press()
assert.equal(toggles, 2, 'Playback shortcut resumes after leaving the input')
dispose()
assert.equal(press().defaultPrevented, false)
assert.equal(toggles, 2, 'Unmount removes the listener')

// Native menu accelerators intercept the key before renderer guards can run.
const source = await readFile('src/electron/shortcuts.js', 'utf8')
let template, failStore = false
const sent = []
const shortcuts = ['play', 'last', 'next', 'volumeUp', 'volumeDown', 'processForward', 'processBack'].map((id, index) => ({ id, shortcut: `F${index + 1}` }))
class Store { get() { return shortcuts } }
const module = { exports: {} }
runInNewContext(source, {
    module, process: { platform: 'win32' }, console: { error() {} },
    require: id => {
        if (id === 'electron') return { Menu: { buildFromTemplate: value => value, setApplicationMenu: value => { template = value } }, globalShortcut: {} }
        if (id === './store') return { getElectronStore: async () => { if (failStore) throw new Error('store unavailable'); return Store } }
        throw new Error(`Unexpected import: ${id}`)
    },
})
for (const fallback of [false, true]) {
    failStore = fallback
    await module.exports.updateApplicationMenu({ webContents: { send: (...args) => sent.push(args) } })
    const controls = template.find(item => item.label === '音乐').submenu
    assert.equal(controls.some(item => item.accelerator === 'Space'), false, 'Neither normal nor fallback menu may capture Space')
    controls.find(item => item.label === '播放/暂停').click()
    assert.equal(sent.at(-1)[0], 'music-playing-control', 'Explicit menu playback remains available')
}
console.log('Playback keyboard checks passed: editable focus, IME, native controls, cleanup and Electron menus')
