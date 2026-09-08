import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import vm from 'node:vm'
import { ref, watch, nextTick } from 'vue'

const source = await readFile('src/components/LibraryList.vue', 'utf8')
const typeSource = await readFile('src/components/LibraryType.vue', 'utf8')
// Check the desktop bundle too: Electron loads dist when Vite is not running.
if (process.argv.includes('--dist')) {
  const files = (await readdir('dist/assets')).filter(name => /^MyMusic-.*\.css$/.test(name))
  assert.ok(files.length, 'build the desktop bundle before checking it')
  for (const file of files) {
    const css = await readFile(`dist/assets/${file}`, 'utf8')
    const face = css.match(/\.playlist-cube-face\s*\{([^}]+)\}/)?.[1]
    assert.ok(face, 'the built cube face styles must exist')
    assert.doesNotMatch(face, /background(?:-color|-image)?\s*:/, 'cube faces must preserve the page backdrop')
  }
}
const animations = []
const lifecycle = []
class Element {
  style = {}
  children = []
  scrollTop = 0
  clientWidth = 260
  clientHeight = 600
  cloneNode() { return new Element() }
  removeAttribute() {}
  querySelectorAll() { return [] }
  append(...children) { this.children.push(...children) }
  replaceChildren() { this.children = [] }
  animate(frames, options) {
    let resolve, reject
    const animation = { frames, options, finished: new Promise((a, b) => { resolve = a; reject = b }),
      complete: () => resolve(), cancel: () => reject(Object.assign(new Error(), { name: 'AbortError' })) }
    animations.push(animation)
    return animation
  }
}
const context = vm.createContext({ ref, watch, nextTick, console,
  listType1: ref(0), listType2: ref(0), libraryStore: { playlistCubeBusy: false },
  document: { createElement: () => new Element() },
  window: { matchMedia: () => ({ matches: false }) },
  onDeactivated: fn => lifecycle.push(fn), onBeforeUnmount: fn => lifecycle.push(fn),
})
vm.runInContext(source.slice(source.indexOf('  const listScroll ='), source.indexOf('  const scrollTop =')) + '\nglobalThis.elements = { listScroll, cubeViewport }', context)
context.elements.listScroll.value = new Element()
context.elements.cubeViewport.value = new Element()
const tick = async () => { await nextTick(); await nextTick() }
context.elements.listScroll.value.scrollTop = 210
context.listType2.value = 1
await tick()
assert.equal(context.libraryStore.playlistCubeBusy, true)
assert.equal(animations[0].frames[1].transform, 'translateZ(-130px) rotateY(-90deg)')
assert.equal(animations[0].options.duration, 500)
let faces = context.elements.cubeViewport.value.children[0].children
assert.equal(faces.length, 2)
assert.equal(faces[1].style.transform, 'rotateY(90deg) translateZ(130px)')
assert.equal(faces[0].children[0].scrollTop, 210)
assert.equal(context.elements.listScroll.value.scrollTop, 0)
animations[0].complete()
await tick()
assert.equal(context.libraryStore.playlistCubeBusy, false)
assert.equal(context.elements.cubeViewport.value.children.length, 0)
context.listType2.value = 0
await tick()
assert.equal(animations[1].frames[1].transform, 'translateZ(-130px) rotateY(90deg)')
lifecycle[0]()
await tick()
assert.equal(context.libraryStore.playlistCubeBusy, false)
assert.equal(context.elements.cubeViewport.value.children.length, 0)
context.listType2.value = 2
await tick()
assert.equal(animations.length, 2, 'purchased tab must not rotate')
context.listType2.value = 0
await tick()
context.window.matchMedia = () => ({ matches: true })
context.listType2.value = 1
await tick()
assert.equal(animations.length, 2, 'reduced motion must bypass animation')

let refreshes = 0
Object.assign(context, { option: ref(0), typeOne: ref(0), typeTwo: ref(0), typeThree: ref(0), typeFour: ref(0),
  changeLibraryList: () => {}, refreshCurrentSection: () => { refreshes++ } })
vm.runInContext(typeSource.slice(typeSource.indexOf('  function changeType('), typeSource.indexOf('  const refreshLocal')), context)
context.changeType(0)
assert.equal(refreshes, 0, 'selected tab must not refresh')
context.libraryStore.playlistCubeBusy = true
context.changeType(1)
assert.equal(context.typeOne.value, 0, 'busy click must not change selection')
context.libraryStore.playlistCubeBusy = false
context.changeType(1)
assert.equal(context.typeOne.value, 1)
assert.equal(refreshes, 1)
console.log('playlist cube checks passed: direction, geometry, scroll, cleanup, cancellation, reduced motion and click guards')
