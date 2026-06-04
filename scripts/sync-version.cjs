/**
 * 将 package.json 中的 version 同步到 tauri.conf.json 和 Cargo.toml
 * 在 semantic-release 的 prepare 阶段执行（此时 package.json 已被更新为新版本号）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const PKG_PATH = path.join(ROOT, 'package.json')
const TAURI_CONF_PATH = path.join(ROOT, 'src-tauri', 'tauri.conf.json')
const CARGO_TOML_PATH = path.join(ROOT, 'src-tauri', 'Cargo.toml')

// 读取新版本号
const { version } = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'))
console.log(`[sync-version] Syncing version ${version} to Tauri config files...`)

// 1. 更新 tauri.conf.json
const tauriConf = JSON.parse(fs.readFileSync(TAURI_CONF_PATH, 'utf8'))
tauriConf.version = version
fs.writeFileSync(TAURI_CONF_PATH, JSON.stringify(tauriConf, null, 2) + '\n')
console.log(`[sync-version] Updated src-tauri/tauri.conf.json → version: ${version}`)

// 2. 更新 Cargo.toml（保留原格式，只替换 version 行）
let cargoToml = fs.readFileSync(CARGO_TOML_PATH, 'utf8')
cargoToml = cargoToml.replace(/^version\s*=\s*".*?"/m, `version = "${version}"`)
fs.writeFileSync(CARGO_TOML_PATH, cargoToml)
console.log(`[sync-version] Updated src-tauri/Cargo.toml → version: ${version}`)

console.log('[sync-version] Done.')
