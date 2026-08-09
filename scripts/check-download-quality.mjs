import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const context = createContext({ console })

function syntheticModule(identifier, exports) {
  return new SyntheticModule(Object.keys(exports), function setExports() {
    for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
  }, { context, identifier })
}

let apiResponse = null
const baseModule = syntheticModule('mock:base', {
  get: async (url) => {
    assert.equal(url, '/song/url/new')
    return apiResponse
  },
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
  throw new Error(`Unexpected song import: ${specifier}`)
})
await songModule.evaluate()

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
let stream = (await songModule.namespace.getMusicUrlNew({ hash: 'A'.repeat(32) }, 'flac')).data[0]
assert.equal(stream.url, 'https://audio.test/lossless.flac')
assert.equal(stream.level, 'flac')
assert.equal(stream.type, 'flac')
assert.equal(stream.br, 900)

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
const resolverSongModule = syntheticModule('mock:resolver-song', {
  getMusicUrl: async (_song, level) => {
    requestedLevels.push(level)
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

console.log('download quality check passed')
