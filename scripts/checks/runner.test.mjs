import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { checks, groups } from './catalog.mjs'
import {
  commandFor, parseArgs, preflight, projectRoot, runProcess, runSuite, selectChecks, validateCatalog, verifyBuild
} from './runner.mjs'

test('目录完整登记，单项旧命令和构建条件未丢失', () => {
  validateCatalog()
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  for (const command of Object.values(pkg.scripts)) {
    for (const match of command.matchAll(/scripts\/(check-[\w-]+\.(?:cjs|mjs))/g)) {
      assert.ok(checks.some(check => check.file === match[1]), `旧命令未登记：${match[1]}`)
    }
  }
  assert.throws(() => validateCatalog([...checks, checks[0]]), /重复/)
  assert.throws(() => validateCatalog(checks.slice(1)), /尚未登记/)
  assert.throws(() => validateCatalog([{ ...checks[0], group: 'unknown' }]), /未知/)
  assert.throws(() => validateCatalog([{ ...checks[0], file: '../bad.mjs' }]), /无效/)
  assert.equal(checks.find(check => check.id === 'loudness-audio').needsBuild, true)
  assert.equal(checks.find(check => check.id === 'animation-diagnostic-isolation').needsBuild, true)
  assert.equal(checks.find(check => check.id === 'packaged-metadata').group, 'manual')
  for (const check of checks) {
    const source = readFileSync(new URL(`../${check.file}`, import.meta.url), 'utf8')
    if (source.includes('SourceTextModule')) assert.equal(check.vmModules, true, `${check.id} 需要 VM 模块参数`)
  }
})

test('默认快速检查、完整检查与只读清单边界', () => {
  assert.ok(selectChecks(parseArgs([])).every(check => ['logic', 'source'].includes(check.group)))
  const all = selectChecks(parseArgs(['all']))
  assert.ok(all.every(check => check.group !== 'manual'))
  assert.equal(all.length + checks.filter(check => check.group === 'manual').length, checks.length)
  assert.deepEqual(selectChecks(parseArgs(['--list'])), checks)
  for (const group of Object.keys(groups)) {
    assert.ok(selectChecks(parseArgs([group])).every(check => check.group === group))
  }
  assert.deepEqual(selectChecks(parseArgs(['--only', 'packaged-metadata'])).map(check => check.id), ['packaged-metadata'])
  assert.deepEqual(selectChecks(parseArgs(['--only', 'song-selection,selector', '--only', 'song-selection'])).map(check => check.id), ['selector', 'song-selection'])
  assert.equal(parseArgs(['--', 'quick', '--fail-fast', '--no-build']).noBuild, true)
  assert.throws(() => parseArgs(['--only']), /需要参数/)
  assert.throws(() => parseArgs(['--only', ',,']), /至少需要/)
  assert.throws(() => parseArgs(['unknown']), /未知分组/)
  assert.throws(() => parseArgs(['constructor']), /未知分组/)
  assert.throws(() => parseArgs(['--wrong']), /未知参数/)
  assert.throws(() => selectChecks(parseArgs(['--only', 'missing'])), /未知检查/)
  assert.throws(() => selectChecks(parseArgs(['quick', '--only', 'packaged-metadata'])), /之外/)
})

test('使用参数数组，不依赖 shell 引号；VM 与 Electron 启动方式正确', () => {
  const vm = commandFor(checks.find(check => check.id === 'cloud-api'))
  assert.equal(vm.executable, process.execPath)
  assert.equal(vm.args[0], '--experimental-vm-modules')
  const electron = commandFor(checks.find(check => check.id === 'selector-browser'), {}, projectRoot, 'electron executable')
  assert.equal(electron.executable, 'electron executable')
  assert.ok(electron.args[0].endsWith('check-selector-browser.cjs'))
  const asar = commandFor(checks.find(check => check.id === 'packaged-metadata'), { asar: 'path with spaces/app.asar' })
  assert.equal(asar.args.at(-1), 'path with spaces/app.asar')
  assert.equal(commandFor(checks.find(check => check.id === 'playlist-cube-dist')).args.at(-1), '--dist')
  assert.throws(() => preflight(checks.find(check => check.id === 'packaged-metadata'), {}), /--asar/)
  assert.throws(() => verifyBuild(new URL('./fixtures/absent', import.meta.url).pathname), /缺少/)
})

const buildChecks = checks.filter(check => ['animation-diagnostic-isolation', 'playlist-cube-dist'].includes(check.id))
const dependencies = extra => ({ log() {}, preflight() {}, verifyBuild() {}, ...extra })

test('多项产物检查只构建一次；--no-build 只验证并复用', async () => {
  const commands = []
  const deps = dependencies({ run: async command => { commands.push(command); return { status: 'passed' } } })
  const results = await runSuite(buildChecks, {}, deps)
  assert.equal(commands.length, 3)
  assert.ok(commands[0].args[0].endsWith('vite.js'))
  assert.equal(results.filter(result => result.id === '@build').length, 1)
  assert.ok(results.every(result => result.status === 'passed'))
  commands.length = 0
  await runSuite(buildChecks, { noBuild: true }, deps)
  assert.equal(commands.length, 2)
})

test('构建失败或产物缺失不能把依赖项误报为通过', async () => {
  let count = 0
  const failed = await runSuite(buildChecks, {}, dependencies({
    run: async () => { count++; return { status: 'failed' } }
  }))
  assert.equal(count, 1)
  assert.deepEqual(failed.map(result => result.status), ['failed', 'blocked', 'blocked'])
  const missing = await runSuite(buildChecks, {}, dependencies({
    run: async () => ({ status: 'passed' }), verifyBuild() { throw new Error('missing asset') }
  }))
  assert.deepEqual(missing.map(result => result.status), ['blocked', 'blocked', 'blocked'])
})

test('默认继续、fail-fast 停止；缺失前置条件不会执行脚本', async () => {
  const selected = checks.filter(check => ['song-selection', 'selector'].includes(check.id))
  const deps = dependencies({ run: async () => ({ status: 'failed', code: 1 }) })
  assert.equal((await runSuite(selected, {}, deps)).length, 2)
  assert.equal((await runSuite(selected, { failFast: true }, deps)).length, 1)
  let executed = false
  const blocked = await runSuite(selected, {}, dependencies({
    preflight() { throw new Error('missing dependency') },
    run: async () => { executed = true; return { status: 'passed' } }
  }))
  assert.equal(executed, false)
  assert.ok(blocked.every(result => result.status === 'blocked'))
})

test('真实子进程返回码、启动错误和超时都能报告', async () => {
  const node = source => ({ executable: process.execPath, args: ['-e', source] })
  assert.equal((await runProcess(node('process.exit(0)'))).status, 'passed')
  assert.equal((await runProcess(node('process.exit(7)'))).code, 7)
  assert.equal((await runProcess({ executable: '__missing_check_executable__', args: [] })).status, 'failed')
  assert.equal((await runProcess(node('setInterval(() => {}, 1000)'), { timeoutMs: 300 })).status, 'timeout')
})

test('取消时停止当前进程，且不运行后续检查', async () => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 300)
  try {
    const result = await runProcess({ executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] }, {
      signal: controller.signal
    })
    assert.equal(result.status, 'cancelled')
    const results = await runSuite(buildChecks, { signal: controller.signal }, dependencies({
      run() { throw new Error('must not run') }
    }))
    assert.deepEqual(results, [])
  } finally { clearTimeout(timer) }
})
