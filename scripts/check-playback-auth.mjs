import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const context = createContext({ console: { ...console, warn() {} } })
const requests = []
const cookies = new Map([['token', 'account-token'], ['userid', '123']])
let responder
let cookieCacheInvalidations = 0
const plain = value => JSON.parse(JSON.stringify(value))
const mock = exports => new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
}, { context })
async function load(path, dependencies = {}) {
    const module = new SourceTextModule(await readFile(path, 'utf8'), { context, identifier: path })
    await module.link(key => {
        assert.ok(dependencies[key], `Unexpected import in ${path}: ${key}`)
        return dependencies[key]
    })
    await module.evaluate()
    return module
}
const request = async config => {
    requests.push(plain(config))
    return responder(config)
}
const requestModule = mock({
    default: request,
    invalidateNcmApiCookieCache: () => { cookieCacheInvalidations++ },
})
const base = await load('src/api/base.js', { '../utils/request': requestModule })
const song = await load('src/api/song.js', {
    './base': base,
    './params': mock({ buildIdWithTimestamp() {}, buildOperationParams() {}, buildPaginationParams() {} }),
    '../utils/kugouLyric': mock({ normalizeKugouKrcLyric() {} }),
    '../utils/lyricPreference': mock({ findRememberedLyricCandidate() {}, rememberLyricCandidate() {} }),
    '../utils/commentReplies': mock({ parseCommentReply() {} }),
})
const quality = await load('src/utils/quality.js')
const resolver = await load('src/utils/musicUrlResolver.js', {
    '../api/song': song,
    '../api/cloud': mock({ getCloudDiskSongUrl: params => request({ url: '/user/cloud/url', method: 'get', params }) }),
    './quality': quality,
    './authority': mock({
        getCookie: key => cookies.get(key),
        updateStoredAuthCookies: ({ cookie }) => {
            const [key, value] = cookie.split('=')
            cookies.set(key, value)
        },
    }),
    './request': requestModule,
})
const resolveTrack = resolver.namespace.resolveTrackByQualityPreference
const { getMusicPlaybackAuth, getMusicUrlAuth, getMusicUrlNew } = song.namespace
const hashes = { 128: 'A'.repeat(32), 320: 'B'.repeat(32), flac: 'C'.repeat(32), high: 'D'.repeat(32) }
const levels = { 128: 2, 320: 4, flac: 5, high: 6 }
const track = { hash: hashes[128], album_id: 100, album_audio_id: 200 }
const privilege = () => ({ status: 1, data: [{
    hash: hashes[128], quality: '128', level: 2,
    relate_goods: Object.keys(hashes).map(quality => ({ hash: hashes[quality], quality, level: levels[quality] })),
}] })
const stream = (level, overrides = {}) => ({
    status: 1,
    url: [`https://audio.test/${level}.${['flac', 'high'].includes(level) ? 'flac' : 'mp3'}`],
    quality: level,
    extName: ['flac', 'high'].includes(level) ? 'flac' : 'mp3',
    bitrate: level === 'high' ? 2304000 : level === 'flac' ? 900 : Number(level),
    sample_rate: level === 'high' ? 96000 : 44100,
    bit_depth: level === 'high' ? 24 : 16,
    volume: -18, volume_gain: 0, volume_peak: 0.8,
    ...overrides,
})
const baseResponder = async ({ url }) => {
    if (url === '/register/dev') return { status: 1, data: { dfid: 'registered-device' } }
    if (url === '/privilege/lite') return privilege()
    if (url === '/user/verify') return { status: 1, data: { auth: 'user-playback-auth' } }
    throw new Error(`Unexpected request: ${url}`)
}
const resetRequests = handler => { requests.length = 0; responder = handler }

// The real API and resolver must register the device, select the quality hash and explicitly pass auth.
resetRequests(config => config.url === '/song/url/auth/merge' ? stream(config.params.quality) : baseResponder(config))
let result = await resolveTrack(track, 'high')
assert.deepEqual(requests.map(item => item.url), ['/register/dev', '/privilege/lite', '/user/verify', '/song/url/auth/merge'])
assert.equal(cookies.get('dfid'), 'registered-device')
assert.equal(cookieCacheInvalidations, 1)
assert.deepEqual(requests.at(-1).params, { auth: 'user-playback-auth', quality: 'high', hash: hashes.high, album_audio_id: 200, album_id: 100 })
assert.equal(result.url, 'https://audio.test/high.flac')
assert.equal(result.level, 'high')
assert.equal(result.type, 'flac')
assert.equal(result.sr, 96000)
assert.equal(result.bitsPerSample, 24)
assert.equal(result.br, 2304000)
assert.deepEqual(plain(result.loudness), { volume: -18, gain: 0, peak: 0.8 })
const firstAuthTimestamp = requests.find(item => item.url === '/user/verify').params.timestamp

// Search/list variants use the same album context; nested payloads and backup URLs retain source metadata.
resetRequests(config => config.url === '/song/url/auth/merge'
    ? { body: { status: 1, data: stream('flac', { url: [], backup_url: ['', 'https://audio.test/backup.flac'] }) } }
    : baseResponder(config))
result = await resolveTrack({ FileHash: hashes[128], MixSongID: 201, al: { id: 101 } }, 'flac')
assert.equal(requests[0].url, '/privilege/lite')
assert.equal(requests[0].params.album_id, 101)
assert.equal(requests.at(-1).params.album_id, 101)
assert.equal(requests.at(-1).params.album_audio_id, 201)
assert.equal(requests.at(-1).params.hash, hashes.flac)
assert.equal(result.url, 'https://audio.test/backup.flac')
assert.equal(result.level, 'flac')
assert.equal(result.br, 900000)
assert.equal(result.loudness.volume, -18)
assert.ok(requests.find(item => item.url === '/user/verify').params.timestamp > firstAuthTimestamp)
assert.ok(!requests.some(item => item.url === '/register/dev'))

// A high-quality failure falls back with the FLAC hash, reusing user auth only within this resolution.
resetRequests(config => {
    if (config.url === '/song/url/auth/merge') {
        return config.params.quality === 'high' ? { status: 2, error_code: 203, msg: 'Hi-Res 不可用', url: [] } : stream('flac')
    }
    if (config.url === '/song/url') return { status: 2, url: [] }
    return baseResponder(config)
})
result = await resolveTrack({ hash: hashes[128], albumId: 102, albumAudioId: 202 }, 'high')
assert.equal(result.level, 'flac')
assert.equal(requests.filter(item => item.url === '/user/verify').length, 1)
assert.deepEqual(requests.filter(item => item.url === '/song/url/auth/merge').map(item => item.params.hash), [hashes.high, hashes.flac])
assert.equal(requests.at(-1).params.album_id, 102)
assert.equal(requests.at(-1).params.album_audio_id, 202)

// The strongest returned fallback must survive weaker legacy responses and subsequent empty results.
resetRequests(config => {
    if (config.url === '/song/url/auth/merge') return config.params.quality === 'high' ? stream('flac') : { status: 2, url: [] }
    if (config.url === '/song/url') return config.params.quality === 'high' ? stream('128') : { status: 2, url: [] }
    if (config.url === '/song/url/new') return { status: 1, data: [] }
    return baseResponder(config)
})
result = await resolveTrack(track, 'high')
assert.equal(result.level, 'flac')
assert.equal(result.url, 'https://audio.test/flac.flac')
assert.equal(requests.filter(item => item.url === '/user/verify').length, 1)

resetRequests(config => {
    if (config.url === '/song/url/auth/merge') {
        if (config.params.quality === 'high') return stream('flac')
        if (config.params.quality === '320') return stream('320')
        return { status: 2, url: [] }
    }
    if (config.url === '/song/url') return { status: 2, url: [] }
    return baseResponder(config)
})
result = await resolveTrack(track, 'high')
assert.equal(result.level, 'flac', 'a later exact 320 response must not discard a playable FLAC fallback')

// Unavailable user auth still permits the established legacy playback path.
resetRequests(config => {
    if (config.url === '/user/verify') return { status: 0, error_code: 20018, msg: '登录已过期' }
    if (config.url === '/song/url') return stream('flac')
    return baseResponder(config)
})
result = await resolveTrack(track, 'flac')
assert.equal(result.level, 'flac')
assert.ok(!requests.some(item => item.url === '/song/url/auth/merge'))

// Exhausted fallbacks preserve the authorization error rather than silently returning null.
resetRequests(config => {
    if (config.url === '/user/verify') return { status: 0, error_code: 20018, msg: '登录已过期' }
    if (config.url === '/song/url') return { status: 2, url: [] }
    if (config.url === '/song/url/new') return { status: 1, data: [] }
    return baseResponder(config)
})
await assert.rejects(() => resolveTrack(track, 'flac'), error => {
    assert.match(error.message, /登录已过期.*20018/)
    assert.equal(error.response.data.error_code, 20018)
    return true
})
assert.equal(requests.filter(item => item.url === '/user/verify').length, 1)

resetRequests(async () => ({ status: 1, data: { auth: ' ' } }))
await assert.rejects(getMusicPlaybackAuth, /获取用户播放授权失败/)
resetRequests(async () => ({ status: 1, error_code: 152, data: { auth: 'invalid-auth' } }))
await assert.rejects(getMusicPlaybackAuth, /152/)
resetRequests(async () => { throw new Error('Unexpected network request') })
await assert.rejects(() => getMusicUrlAuth(track), /需要用户播放授权/)
assert.equal(requests.length, 0)
resetRequests(async () => ({ status: 2, error_code: 203, errmsg: '需要购买', fail_process: ['buy'] }))
await assert.rejects(() => getMusicUrlAuth(track, 'flac', { auth: 'valid-auth' }), error => {
    assert.match(error.message, /需要购买.*203/)
    assert.deepEqual(Array.from(error.response.data.fail_process), ['buy'])
    return true
})
resetRequests(async () => stream('high', { status: 0, error_code: 20018, msg: '登录已过期' }))
await assert.rejects(() => getMusicUrlAuth(track, 'high', { auth: 'valid-auth' }), /登录已过期.*20018/)

// The all-quality endpoint selects the best available downgrade and never upgrades a 128 request.
resetRequests(async () => ({ data: [{ relate_goods: [
    { quality: '128', info: { extname: 'mp3', tracker_url: ['https://audio.test/standard.mp3'] } },
    { quality: 'flac', info: { extname: 'flac', tracker_url: ['https://audio.test/lossless.flac'] } },
] }] }))
assert.equal((await getMusicUrlNew(track, 'high')).data[0].level, 'flac')
assert.equal((await getMusicUrlNew(track, '128')).data[0].level, '128')
resetRequests(async () => ({ data: [{ quality: 'high', info: { extname: 'flac', tracker_url: ['https://audio.test/high.flac'] } }] }))
assert.equal((await getMusicUrlNew(track, '128')).data[0].url, null)

// Switching accounts during either authorization stage must stop retries and discard stale audio.
for (const delayedUrl of ['/user/verify', '/song/url/auth/merge']) {
    cookies.set('token', 'original-token')
    cookies.set('userid', '123')
    let release, signalStarted
    const started = new Promise(resolve => { signalStarted = resolve })
    const gate = new Promise(resolve => { release = resolve })
    resetRequests(async config => {
        if (config.url === delayedUrl) {
            signalStarted()
            await gate
            return delayedUrl === '/user/verify' ? { status: 1, data: { auth: 'old-account-auth' } } : stream('high')
        }
        return baseResponder(config)
    })
    const rejected = assert.rejects(() => resolveTrack(track, 'high'), /登录状态已变化/)
    await started
    cookies.set('token', 'new-account-token')
    cookies.set('userid', '456')
    release()
    await rejected
    assert.equal(requests.at(-1).url, delayedUrl)
    assert.ok(!requests.some(item => ['/song/url', '/song/url/new'].includes(item.url)))
}

// Cloud audio remains ahead of catalog authorization.
resetRequests(async config => {
    assert.equal(config.url, '/user/cloud/url')
    return { status: 1, data: { url: 'https://audio.test/cloud.mp3', extName: 'mp3' } }
})
result = await resolveTrack({ ...track, source: 'cloud' }, '128')
assert.equal(result.url, 'https://audio.test/cloud.mp3')
assert.deepEqual(requests.map(item => item.url), ['/user/cloud/url'])

console.log('playback Auth chain check passed')
