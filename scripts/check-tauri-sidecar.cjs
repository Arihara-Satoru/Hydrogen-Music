const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const targetTriple = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim()
const extension = process.platform === 'win32' ? '.exe' : ''
const binary = path.join(projectRoot, 'src-tauri', 'binaries', `kugoumusicapi-${targetTriple}${extension}`)
assert.equal(fs.existsSync(binary), true, 'run pnpm prepare:tauri-sidecar first')

const port = 36531
const token = 'hydrogen-kugou-api-check'
const child = spawn(binary, [], {
  cwd: path.dirname(binary),
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    platform: 'lite',
    KUGOU_API_HEALTH_TOKEN: token,
    KUGOU_API_HEALTH_PATH: '/__hydrogen/health',
  },
  stdio: 'ignore',
  windowsHide: true,
})

function requestHealth() {
  return new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${port}/__hydrogen/health`, { timeout: 500 }, response => {
      let body = ''
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body }))
    })
    request.on('timeout', () => request.destroy(new Error('timeout')))
    request.on('error', reject)
  })
}

async function main() {
try {
  const deadline = Date.now() + 10000
  let response
  while (Date.now() < deadline) {
    try {
      response = await requestHealth()
      break
    } catch (_) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
  assert.equal(response?.status, 200)
  assert.deepEqual(JSON.parse(response.body), { service: token })
  console.log('Tauri KuGou sidecar check passed')
} finally {
  child.kill()
}
}

main().catch(error => {
  child.kill()
  console.error(error)
  process.exitCode = 1
})
