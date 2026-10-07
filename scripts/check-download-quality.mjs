import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const context = createContext({ console, setTimeout: () => 0 })

function syntheticModule(identifier, exports) {
  return new SyntheticModule(Object.keys(exports), function setExports() {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
  }, { context, identifier })
}

const qualityPath = resolve('src/utils/quality.js')
const qualityModule = new SourceTextModule(await readFile(qualityPath, 'utf8'), { context, identifier: qualityPath })
await qualityModule.link(() => { throw new Error('Unexpected quality import') })
await qualityModule.evaluate()
const { buildLevelInfoFromStream, formatAudioInfo, formatDownloadQuality } = qualityModule.namespace
assert.equal(JSON.stringify(buildLevelInfoFromStream({ bitrate: 128000 })), '{"br":128000}')
for (const value of [undefined, null, '', 'bad', 0, -1, NaN, Infinity, true, [], {}]) {
  const info = formatAudioInfo({ sr: value, bitsPerSample: value, br: value })
  assert.equal(info.sampleRate, '未知')
  assert.equal(info.bitDepth, '未知')
  assert.equal(info.bitrate, '未知')
}
assert.equal(formatAudioInfo({ type: 'mp3', bitsPerSample: 16 }).bitDepth, '不适用')
assert.equal(formatAudioInfo({ container: 'MPEG' }).bitDepth, '不适用')
assert.equal(formatAudioInfo({ type: 'm4a', lossless: false }).bitDepth, '不适用')
assert.equal(formatAudioInfo({ type: 'm4a', lossless: true, bitsPerSample: 24 }).bitDepth, '24 bit')
const wavInfo = formatAudioInfo({ container: 'WAVE', sampleRate: 48000, bitsPerSample: 24, bitrate: 2304000 })
assert.equal(wavInfo.format, 'WAV')
assert.equal(wavInfo.sampleRate, '48 kHz')
assert.equal(wavInfo.bitDepth, '24 bit')
assert.equal(wavInfo.bitrate, '2304 kbps')
assert.equal(formatAudioInfo({ sr: '22050' }).sampleRate, '22.05 kHz')
assert.equal(buildLevelInfoFromStream({ sampleRate: 800, bitrate: 800 }).sr, 800)
assert.equal(buildLevelInfoFromStream({ sampleRate: 800, bitrate: 800 }).br, 800)
assert.equal(formatDownloadQuality({ type: 'mp3', br: 128000, level: 'flac' }, 'flac').text,
  '请求 FLAC → MP3 / 128 kbps（已降级）')
assert.equal(formatDownloadQuality({ type: 'mp3' }, 'flac').text,
  '请求 FLAC → MP3 / 码率未知（已降级）')
assert.equal(formatDownloadQuality({ type: 'flac', br: 900000, level: 'flac' }, 'flac').downgraded, false)
assert.equal(formatDownloadQuality({ type: 'mp3', br: 320000, level: '320' }, '128').downgraded, false)
assert.equal(formatDownloadQuality({ type: 'mp3', br: 128000 }, '320').downgraded, true)
assert.equal(formatDownloadQuality({ container: 'M4A', bitrate: 128000, lossless: false }, 'flac').downgraded, true)
assert.equal(formatDownloadQuality({ container: 'WAVE', bitrate: 2304000 }).text, 'WAV / 2304 kbps')

// Exercise the shared setter, including partial metadata and stream values overriding list metadata.
const playerSource = await readFile(resolve('src/utils/player.js'), 'utf8')
const setterModule = new SourceTextModule(`
  import { buildLevelInfoFromStream } from './quality';
  const songList = { value: [{ bitrate: 128 }] }, currentIndex = { value: 0 };
  ${playerSource.slice(playerSource.indexOf('const levelFieldMap ='), playerSource.indexOf('const cloudAudioExtensions ='))}
  ${playerSource.slice(playerSource.indexOf('export function setSongLevel('), playerSource.indexOf('export async function getLocalLyric('))}
  export { songList };
`, { context })
await setterModule.link(() => qualityModule)
await setterModule.evaluate()
const { setSongLevel, songList } = setterModule.namespace
setSongLevel('128', { type: 'mp3', bitrate: 128000 })
assert.equal(songList.value[0].level.sr, undefined)
assert.equal(songList.value[0].level.bitsPerSample, undefined)
assert.equal(songList.value[0].level.br, 128000)
songList.value[0].l = { sr: 44100, br: 96000 }
setSongLevel('128', { type: 'mp3', sr: 48000, br: 128000 })
assert.equal(songList.value[0].level.sr, 48000)
assert.equal(songList.value[0].level.br, 128000)
songList.value[0] = { source: 'siren' }
setSongLevel('wav', { type: 'wav' })
assert.equal(formatAudioInfo(songList.value[0].level).sampleRate, '未知')
assert.equal(formatAudioInfo(songList.value[0].level).bitrate, '未知')
assert.ok(!playerSource.includes('Howler.ctx?.sampleRate'), 'output sample rate must not be reported as source metadata')

let apiResponse = null
const baseModule = syntheticModule('mock:base', {
  get: async (url) => {
    assert.ok(['/song/url', '/song/url/new'].includes(url))
    return apiResponse
  },
  post: () => null,
  getById: () => null,
  getWithPagination: () => null,
  operationRequest: () => null,
})
const paramsModule = syntheticModule('mock:params', {
  buildIdWithTimestamp: value => value,
  buildOperationParams: value => value,
  buildPaginationParams: value => value,
})
const lyricModule = syntheticModule('mock:kugouLyric', { normalizeKugouKrcLyric: value => value })
const lyricPreferenceModule = syntheticModule('mock:lyricPreference', {
  findRememberedLyricCandidate: () => null,
  rememberLyricCandidate: () => null,
})
const commentRepliesModule = syntheticModule('mock:commentReplies', {
  parseCommentReply: content => ({ content, replyTo: null }),
})

const songPath = resolve('src/api/song.js')
const songModule = new SourceTextModule(await readFile(songPath, 'utf8'), {
  context,
  identifier: songPath,
})
await songModule.link(specifier => {
  if (specifier === './base') return baseModule
  if (specifier === './params') return paramsModule
  if (specifier === '../utils/kugouLyric') return lyricModule
  if (specifier === '../utils/lyricPreference') return lyricPreferenceModule
  if (specifier === '../utils/commentReplies') return commentRepliesModule
  throw new Error(`Unexpected song import: ${specifier}`)
})
await songModule.evaluate()

apiResponse = { data: { url: ['https://audio.test/downgraded.mp3'], extName: 'mp3', quality: 'flac', bitrate: 128 } }
let stream = (await songModule.namespace.getMusicUrl({ hash: 'A'.repeat(32) }, 'flac')).data[0]
assert.equal(stream.level, '128')
assert.equal(stream.type, 'mp3')

apiResponse = { data: [{ quality: 'flac', info: { extname: 'MP3', bitrate: 128, tracker_url: ['https://audio.test/downgraded.mp3'] } }] }
stream = (await songModule.namespace.getMusicUrlNew({ hash: 'A'.repeat(32) }, 'flac')).data[0]
assert.equal(stream.level, '128')
assert.equal(stream.type, 'mp3')

apiResponse = { data: { url: ['https://audio.test/lossless.flac'], extname: 'flac', quality: 'flac' } }
stream = (await songModule.namespace.getMusicUrl({ hash: 'A'.repeat(32) }, 'flac')).data[0]
assert.equal(stream.level, 'flac')
assert.equal(stream.type, 'flac')

const responseWithQualities = flacUrl => ({
  data: [{
    quality: 'flac',
    level: 5,
    info: { extname: 'flac', tracker_url: [] },
    relate_goods: [
      {
        quality: '128',
        level: 2,
        info: { extname: 'mp3', tracker_url: ['https://audio.test/standard.mp3'], bitrate: 128 },
      },
      {
        quality: 'flac',
        level: 5,
        info: { extname: 'flac', tracker_url: flacUrl ? [flacUrl] : [], bitrate: 900 },
      },
    ],
  }],
})

apiResponse = responseWithQualities('https://audio.test/lossless.flac')
stream = (await songModule.namespace.getMusicUrlNew({ hash: 'A'.repeat(32) }, 'flac')).data[0]
assert.equal(stream.url, 'https://audio.test/lossless.flac')
assert.equal(stream.level, 'flac')
assert.equal(stream.type, 'flac')
assert.equal(stream.br, 900000)

apiResponse = {
  data: [{
    relate_goods: [
      { level: 2, info: { extname: 'mp3', tracker_url: ['https://audio.test/standard.mp3'] } },
      { level: 5, info: { extname: 'flac', tracker_url: ['https://audio.test/lossless.flac'] } },
    ],
  }],
}
stream = (await songModule.namespace.getMusicUrlNew({ hash: 'A'.repeat(32) }, 'flac')).data[0]
assert.equal(stream.url, 'https://audio.test/lossless.flac')
assert.equal(stream.level, 'flac')

apiResponse = responseWithQualities('')
stream = (await songModule.namespace.getMusicUrlNew({ hash: 'A'.repeat(32) }, 'flac')).data[0]
assert.equal(stream.url, 'https://audio.test/standard.mp3')
assert.equal(stream.level, '128')
assert.equal(stream.type, 'mp3')

let requestedLevels = []
let resolverMode = 'missing-until-128'
const resolverSongModule = syntheticModule('mock:resolver-song', {
  getMusicUrl: async (_song, level) => {
    requestedLevels.push(level)
    if (resolverMode === 'downgraded-flac') {
      return level === 'flac'
        ? { data: [{ url: 'https://audio.test/downgraded.mp3', level: '128', type: 'mp3' }] }
        : { data: [{ url: 'https://audio.test/high-quality.mp3', level, type: 'mp3' }] }
    }
    return { data: [{ url: level === '128' ? 'https://audio.test/standard.mp3' : null, level, type: level === '128' ? 'mp3' : 'flac' }] }
  },
  getMusicUrlNew: async () => ({ data: [{ url: 'https://audio.test/standard.mp3', level: '128', type: 'mp3' }] }),
  getSongPrivilegeLite: async () => null,
})
const resolverCloudModule = syntheticModule('mock:resolver-cloud', { getCloudDiskSongUrl: async () => null })
const resolverQualityModule = syntheticModule('mock:resolver-quality', {
  getPreferredQuality: level => ['128', '320', 'flac', 'high'].includes(level) ? level : 'flac',
})
const resolverAuthorityModule = syntheticModule('mock:resolver-authority', {
  getCookie: key => key === 'dfid' ? 'registered-device' : '',
  updateStoredAuthCookies: () => null,
})
const resolverRequestModule = syntheticModule('mock:resolver-request', {
  default: async () => null,
  invalidateNcmApiCookieCache: () => null,
})

const resolverPath = resolve('src/utils/musicUrlResolver.js')
const resolverModule = new SourceTextModule(await readFile(resolverPath, 'utf8'), {
  context,
  identifier: resolverPath,
})
await resolverModule.link(specifier => {
  if (specifier === '../api/cloud') return resolverCloudModule
  if (specifier === '../api/song') return resolverSongModule
  if (specifier === './quality') return resolverQualityModule
  if (specifier === './authority') return resolverAuthorityModule
  if (specifier === './request') return resolverRequestModule
  throw new Error(`Unexpected resolver import: ${specifier}`)
})
await resolverModule.evaluate()

const fallbackResult = await resolverModule.namespace.resolveTrackByQualityPreference({}, 'flac')
assert.equal(fallbackResult.level, '128')
assert.deepEqual(requestedLevels, ['flac', 'flac', '320', '320', '128'])

resolverMode = 'downgraded-flac'
requestedLevels = []
const verifiedResult = await resolverModule.namespace.resolveTrackByQualityPreference({}, 'flac')
assert.equal(verifiedResult.level, '320')
assert.deepEqual(requestedLevels, ['flac', 'flac', '320'])

// Verify the queue label, downgrade notice, and measured completion notice through the manager.
const localStore = {}
const playerStore = {}
const localRefs = {
  downloadList: { value: [{ id: 1, name: '音质自检' }] },
  isDownloading: { value: false },
  isFirstDownload: { value: true },
}
const notices = []
let nextDownload
let resolveStarted
const started = new Promise(resolve => { resolveStarted = resolve })
context.windowApi = {
  downloadNext: callback => { nextDownload = callback },
  download: payload => { resolveStarted(payload) },
}
const managerDependencies = {
  '../store/localStore': syntheticModule('mock:manager-local', { useLocalStore: () => localStore }),
  '../store/playerStore': syntheticModule('mock:manager-player', { usePlayerStore: () => playerStore }),
  pinia: syntheticModule('mock:manager-pinia', { storeToRefs: store => store === localStore ? localRefs : { quality: { value: 'flac' } } }),
  '../api/song': syntheticModule('mock:manager-song', { checkMusic: async () => ({ success: true }), getLyric: async () => null }),
  '../api/siren': syntheticModule('mock:manager-siren', { getSirenLyricText: async () => '', getSirenSong: async () => null }),
  './dialog': syntheticModule('mock:manager-dialog', { noticeOpen: text => notices.push(text) }),
  './locaMusic': syntheticModule('mock:manager-scan', { scanMusic: () => null }),
  './quality': qualityModule,
  './musicUrlResolver': syntheticModule('mock:manager-resolver', {
    resolveTrackByQualityPreference: async () => ({ url: 'https://audio.test/standard.mp3', type: 'mp3', level: '128', br: 128000 }),
  }),
  './siren': syntheticModule('mock:manager-siren-utils', { getSirenAudioExtension: () => 'wav', getSirenSourceId: () => '', SIREN_SOURCE: 'siren' }),
}
const managerPath = resolve('src/utils/downloadManager.js')
const managerModule = new SourceTextModule(await readFile(managerPath, 'utf8'), { context, identifier: managerPath })
await managerModule.link(specifier => {
  assert.ok(managerDependencies[specifier], `Unexpected manager import: ${specifier}`)
  return managerDependencies[specifier]
})
await managerModule.evaluate()
managerModule.namespace.initDownloadManager()
nextDownload({})
const downloadPayload = await started
assert.equal(downloadPayload.preferredQuality, 'flac')
assert.equal(localRefs.downloadList.value[0].downloadQuality, '请求 FLAC → MP3 / 128 kbps（已降级）')
assert.match(notices.at(-1), /已降级/)
nextDownload({}, {
  state: 'completed', name: '音质自检', preferredQuality: 'flac',
  audio: { type: 'mp3', level: 'flac', bitrate: 128000 },
})
assert.match(notices.at(-1), /下载完成：请求 FLAC → MP3 \/ 128 kbps（已降级）；全部下载完毕/)
assert.equal(localRefs.downloadList.value.length, 0)

console.log('download quality check passed')
