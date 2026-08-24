const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const apiRoots = [
  path.resolve(projectRoot, 'KuGouMusicApi'),
  path.resolve(projectRoot, '..', 'KuGouMusicApi'),
  path.resolve(projectRoot, '..', '..', 'KuGouMusicApi'),
]
const apiRoot = apiRoots.find(candidate => fs.existsSync(path.join(candidate, 'Cargo.toml')))
if (!apiRoot) throw new Error('KuGouMusicApi/Cargo.toml not found')

execFileSync('cargo', ['build', '--release', '--locked', '--manifest-path', path.join(apiRoot, 'Cargo.toml')], {
  cwd: apiRoot,
  stdio: 'inherit',
})

const targetTriple = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim()
if (!targetTriple) throw new Error('Unable to determine the Rust host target')

const extension = process.platform === 'win32' ? '.exe' : ''
const source = path.join(apiRoot, 'target', 'release', `kugoumusicapi${extension}`)
const destinationDir = path.join(projectRoot, 'src-tauri', 'binaries')
const destination = path.join(destinationDir, `kugoumusicapi-${targetTriple}${extension}`)
if (!fs.existsSync(source)) throw new Error(`KuGouMusicApi binary not found: ${source}`)

fs.mkdirSync(destinationDir, { recursive: true })
fs.copyFileSync(source, destination)
console.log(`[tauri-sidecar] ${path.relative(projectRoot, destination)} (${fs.statSync(destination).size} bytes)`)
