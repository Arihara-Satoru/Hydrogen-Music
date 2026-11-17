import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { checks, groups, profiles } from './catalog.mjs'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

export function validateCatalog(catalog = checks, root = projectRoot) {
  const ids = new Set()
  for (const check of catalog) {
    if (ids.has(check.id)) throw new Error(`重复的检查 ID：${check.id}`)
    ids.add(check.id)
    if (!Object.hasOwn(groups, check.group)) throw new Error(`未知检查分组：${check.group}`)
    if (!/^check-[\w-]+\.(?:mjs|cjs)$/.test(check.file)) throw new Error(`无效脚本路径：${check.file}`)
    if (!existsSync(resolve(root, 'scripts', check.file))) throw new Error(`缺少脚本：${check.file}`)
  }
  const registered = new Set(catalog.map(check => check.file))
  const missing = readdirSync(resolve(root, 'scripts'))
    .filter(file => /^check-.*\.(?:mjs|cjs)$/.test(file) && !registered.has(file))
  if (missing.length) throw new Error(`检查脚本尚未登记：${missing.join('、')}`)
}

export function parseArgs(args) {
  const options = { profile: undefined, only: [], list: false, failFast: false, noBuild: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') continue
    if (arg === '--list') options.list = true
    else if (arg === '--fail-fast') options.failFast = true
    else if (arg === '--no-build') options.noBuild = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--only' || arg === '--asar') {
      const value = args[++i]
      if (!value || value.startsWith('--')) throw new Error(`${arg} 需要参数`)
      if (arg === '--only') {
        const ids = value.split(',').filter(Boolean)
        if (!ids.length) throw new Error('--only 至少需要一个检查 ID')
        options.only.push(...ids)
      }
      else options.asar = resolve(value)
    } else if (!arg.startsWith('-') && !options.profile) options.profile = arg
    else throw new Error(`未知参数：${arg}`)
  }
  if (options.profile && !Object.hasOwn(profiles, options.profile) && !Object.hasOwn(groups, options.profile)) {
    throw new Error(`未知分组：${options.profile}`)
  }
  return options
}

export function selectChecks(options, catalog = checks) {
  if (options.only.length) {
    const ids = new Set(options.only)
    for (const id of ids) if (!catalog.some(check => check.id === id)) throw new Error(`未知检查：${id}`)
    const selected = catalog.filter(check => ids.has(check.id))
    if (options.profile) {
      const allowed = profiles[options.profile] || [options.profile]
      if (selected.some(check => !allowed.includes(check.group))) throw new Error('--only 包含所选分组之外的检查')
    }
    return selected
  }
  const selectedGroups = options.profile ? profiles[options.profile] || [options.profile]
    : options.list ? Object.keys(groups) : profiles.quick
  return catalog.filter(check => selectedGroups.includes(check.group))
}

export function commandFor(check, options = {}, root = projectRoot, electronPath) {
  const script = resolve(root, 'scripts', check.file)
  const args = [...(check.args || [])]
  if (check.requires?.includes('asar') && options.asar) args.push(options.asar)
  if (check.group === 'electron') return { executable: electronPath || require('electron'), args: [script, ...args] }
  return { executable: process.execPath, args: [...(check.vmModules ? ['--experimental-vm-modules'] : []), script, ...args] }
}

// Windows 上包含孙进程（Electron / Vite）的整棵树；POSIX 使用独立进程组。
function terminateTree(child) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
  } else {
    try { process.kill(-child.pid, 'SIGKILL') } catch { /* 子进程可能已退出 */ }
  }
}

export function runProcess(command, { cwd = projectRoot, timeoutMs = 60000, signal } = {}) {
  return new Promise(resolveResult => {
    if (signal?.aborted) return resolveResult({ status: 'cancelled' })
    const env = { ...process.env }
    // Electron 必须以桌面进程运行，不能继承测试终端的 Node 模式。
    delete env.ELECTRON_RUN_AS_NODE
    const started = performance.now()
    let timedOut = false
    let timer
    let completed = false
    const child = spawn(command.executable, command.args, {
      cwd, env, stdio: 'inherit', shell: false, windowsHide: true, detached: process.platform !== 'win32'
    })
    const abort = () => terminateTree(child)
    const finish = result => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      resolveResult({ ...result, milliseconds: Math.round(performance.now() - started) })
    }
    child.once('error', error => finish({ status: 'failed', message: error.message }))
    child.once('close', (code, childSignal) => finish({
      status: signal?.aborted ? 'cancelled' : timedOut ? 'timeout' : code === 0 ? 'passed' : 'failed',
      code, signal: childSignal
    }))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    timer = setTimeout(() => { timedOut = true; terminateTree(child) }, timeoutMs)
  })
}

export function preflight(check, options, root = projectRoot) {
  for (const requirement of [...(check.requires || []), ...(check.group === 'electron' ? ['electron'] : [])]) {
    if (requirement === 'asar' && (!options.asar || !existsSync(options.asar))) {
      throw new Error('请通过 --asar <app.asar 路径> 指定已存在的安装包归档')
    }
    if (requirement === 'git-head') {
      const result = spawnSync('git', ['cat-file', '-e', 'HEAD:src/components/Lyric.vue'], { cwd: root, stdio: 'ignore' })
      if (result.status !== 0) throw new Error('此检查需要 Git 仓库中的 HEAD:src/components/Lyric.vue')
    }
    if (requirement === 'ffmpeg' || requirement === 'electron') {
      const executable = require(requirement === 'ffmpeg' ? 'ffmpeg-static' : 'electron')
      if (!executable) throw new Error(`${requirement} 不支持当前平台`)
      accessSync(executable, constants.X_OK)
      if (requirement === 'electron' && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        throw new Error('Electron 检查需要桌面会话；无显示器的 Linux 请在 xvfb-run 下运行')
      }
    }
  }
}

export function verifyBuild(root = projectRoot) {
  for (const file of ['dist/index.html', 'dist/desktop-lyric.html', 'dist/assets']) {
    if (!existsSync(resolve(root, file))) throw new Error(`缺少 ${file}；先运行 pnpm build，或去掉 --no-build`)
  }
  if (!readdirSync(resolve(root, 'dist/assets')).some(file => /^adaptiveLoudness\.worklet-.*\.js$/.test(file))) {
    throw new Error('缺少生产 AudioWorklet 资源；请重新运行 pnpm build')
  }
}

export async function runSuite(selected, options = {}, dependencies = {}) {
  const root = dependencies.root || projectRoot
  const run = dependencies.run || runProcess
  const log = dependencies.log || console.log
  const before = dependencies.preflight || preflight
  const verify = dependencies.verifyBuild || verifyBuild
  const results = []
  let buildResult
  for (const check of selected) {
    if (options.signal?.aborted) break
    log(`\n[${results.filter(result => result.id !== '@build').length + 1}/${selected.length}] ${check.id} — ${check.title}`)
    let result
    try {
      before(check, options, root)
      if (check.needsBuild) {
        if (!buildResult) {
          if (options.noBuild) {
            verify(root)
            buildResult = { status: 'passed' }
            log('复用现有 dist（未检查是否与源码同步）。')
          } else {
            log('准备生产产物：vite build（本轮只构建一次）。')
            const viteCli = resolve(dirname(require.resolve('vite/package.json')), 'bin/vite.js')
            buildResult = await run({ executable: process.execPath, args: [viteCli, 'build'] }, {
              cwd: root, timeoutMs: 120000, signal: options.signal
            })
            results.push({ id: '@build', title: '生产构建准备', ...buildResult })
            if (buildResult.status === 'passed') {
              try { verify(root) } catch (error) {
                buildResult.status = 'blocked'
                buildResult.message = error.message
                Object.assign(results.at(-1), buildResult)
              }
            }
          }
        }
        if (buildResult.status !== 'passed') throw new Error('生产构建未成功，此项无法验证')
      }
      result = await run(commandFor(check, options, root), {
        cwd: root, timeoutMs: check.timeoutMs || (check.group === 'electron' ? 120000 : 60000), signal: options.signal
      })
    } catch (error) {
      result = { status: 'blocked', message: error.message }
    }
    results.push({ id: check.id, title: check.title, ...result })
    const duration = result.milliseconds === undefined ? '' : ` ${(result.milliseconds / 1000).toFixed(2)}s`
    log(`${result.status === 'passed' ? '通过' : '未通过'}：${check.id} [${result.status}]${duration}${result.message ? ` — ${result.message}` : ''}`)
    if (result.status === 'cancelled' || (options.failFast && result.status !== 'passed')) break
  }
  return results
}

export const help = `用法：node scripts/run-checks.mjs [quick|all|logic|source|media|build|electron|manual] [选项]
  --list                 只列出检查及条件，不执行、不构建
  --only <ID[,ID...]>     只运行指定项，可多次提供；手动检查也可单独选择
  --fail-fast            首次未通过后停止，默认继续并汇总
  --no-build             复用现有 dist；调用者需自行保证产物最新
  --asar <路径>          packaged-metadata 所需的 app.asar
  --help                 显示帮助
默认 quick：逻辑 + 源码约束。all 不含需人工参数或 Git 基线的 manual 组。
所有检查串行运行；超时或缺失前置条件也算未通过。`

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args)
  if (options.help) { console.log(help); return 0 }
  validateCatalog()
  const selected = selectChecks(options)
  if (!selected.length) throw new Error('没有选中任何检查')
  if (options.list) {
    for (const [group, description] of Object.entries(groups)) {
      const entries = selected.filter(check => check.group === group)
      if (!entries.length) continue
      console.log(`\n${group} (${entries.length}) — ${description}`)
      for (const check of entries) {
        const conditions = [...(check.needsBuild ? ['先构建'] : []), ...(check.requires || [])]
        console.log(`  ${check.id}: ${check.title}${conditions.length ? ` [${conditions.join(', ')}]` : ''}`)
      }
    }
    return 0
  }
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  const started = performance.now()
  try {
    const results = await runSuite(selected, { ...options, signal: controller.signal })
    const passed = results.filter(result => result.status === 'passed')
    const failed = results.filter(result => result.status !== 'passed')
    const unrun = selected.length - results.filter(result => result.id !== '@build').length
    console.log(`\n检查汇总：通过 ${passed.length}，未通过 ${failed.length}，未运行 ${unrun}；耗时 ${((performance.now() - started) / 1000).toFixed(2)}s（计数包含构建准备）。`)
    for (const result of failed) console.log(`  ${result.id}: ${result.status}${result.message ? ` — ${result.message}` : ''}`)
    if (options.profile === 'all') console.log('manual 组未纳入；用 pnpm check:list 查看指定安装包与 Git 基线检查。')
    return controller.signal.aborted ? 130 : (failed.length || unrun) ? 1 : 0
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}
