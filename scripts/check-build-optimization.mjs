import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build, loadConfigFromFile } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const loaded = await loadConfigFromFile(
  { command: 'build', mode: 'production' },
  fileURLToPath(new URL('../vite.config.js', import.meta.url))
)
assert.ok(loaded, '应能加载项目实际构建配置')
const config = loaded.config
assert.equal(config.build.minify, 'oxc')
assert.equal(config.build.target, 'es2018')
assert.deepEqual(Object.keys(config.build.rolldownOptions.input).sort(), ['desktop-lyric', 'main'])
assert.equal(config.build.rolldownOptions.onwarn, undefined, '不要通过忽略警告来代替修复')

// 使用项目实际压缩选项构建内存入口，不写入或覆盖 dist。
const fixtureId = '\0build-optimization-check'
const fixture = `
globalThis.runBuildOptimizationCheck = function () {
  const effects = []
  const effect = name => { effects.push(name); return name }
  console.log('debug-log', effect('log'))
  console.info('debug-info', effect('info'))
  console.debug('debug-debug', effect('debug'))
  console.warn('keep-warning')
  console.error('keep-error')
  debugger
  const evalLocal = 42
  return { effects, evalValue: eval('evalLocal') }
}
`
const result = await build({
  ...config,
  root,
  configFile: false,
  publicDir: false,
  logLevel: 'silent',
  plugins: [{
    name: 'build-optimization-check',
    resolveId(id) { if (id === fixtureId) return id },
    load(id) { if (id === fixtureId) return fixture }
  }],
  build: {
    ...config.build,
    write: false,
    rolldownOptions: {
      ...config.build.rolldownOptions,
      input: fixtureId
    }
  }
})
const chunk = result.output.find(item => item.type === 'chunk' && item.isEntry)
assert.ok(chunk, '应生成可执行入口')
assert.doesNotMatch(chunk.code, /console\.(?:log|info|debug)\s*\(/)
assert.doesNotMatch(chunk.code, /\bdebugger\b/)

const calls = []
const context = {
  console: Object.fromEntries(['log', 'info', 'debug', 'warn', 'error'].map(method => [
    method, (...args) => calls.push({ method, args })
  ]))
}
runInNewContext(chunk.code, context)
const execution = context.runBuildOptimizationCheck()
assert.deepEqual(Array.from(execution.effects), ['log', 'info', 'debug'], '移除日志时应保留参数副作用')
assert.equal(execution.evalValue, 42, '压缩不能破坏直接 eval 的局部变量')
assert.deepEqual(calls, [
  { method: 'warn', args: ['keep-warning'] },
  { method: 'error', args: ['keep-error'] }
])
console.log('构建优化检查通过：Oxc、双入口、ES2018、调试日志移除、参数副作用、warn/error 与直接 eval。')
