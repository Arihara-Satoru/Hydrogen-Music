import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const context = createContext({ console })
const requests = []
let responder = async () => ({ status: 1, data: { info: [] } })

const requestModule = new SyntheticModule(['default'], function setRequestExport() {
  this.setExport('default', config => {
    requests.push(config)
    return responder(config)
  })
}, { context, identifier: 'mock:request' })

const playlistModule = new SyntheticModule(['normalizePlaylistSong'], function setPlaylistExport() {
  this.setExport('normalizePlaylistSong', (song = {}) => ({
    ...song,
    id: song.album_audio_id ?? song.audio_id ?? song.id ?? song.hash ?? null,
    hash: song.hash || song.FileHash || song.file_hash || '',
    album_audio_id: song.album_audio_id ?? '',
    name: song.name || song.songName || song.songname || song.audio_name || song.filename || song.FileName || '',
    al: { id: song.album_id ?? null },
    album: { id: song.album_id ?? null },
  }))
}, { context, identifier: 'mock:playlist' })

const cloudPath = resolve('src/api/cloud.js')
const cloudModule = new SourceTextModule(await readFile(cloudPath, 'utf8'), {
  context,
  identifier: cloudPath,
})

await cloudModule.link(specifier => {
  if (specifier === '../utils/request') return requestModule
  if (specifier === './playlist') return playlistModule
  throw new Error(`Unexpected import: ${specifier}`)
})
await cloudModule.evaluate()

const { deleteCloudSong, getCloudDiskData, uploadCloudSong } = cloudModule.namespace
const requestedPages = []
const pageResponses = {
  1: {
    status: 1,
    data: {
      total: 3,
      used_size: 1024,
      max_size: 4096,
      info: [
        {
          kv_id: 7,
          FileName: '第一首.flac',
          FileSize: 2048,
          FileHash: 'ABC123',
          audio_id: 11,
          album_audio_id: 21,
          addtime: 1_710_000_000,
        },
        { kv_id: 8, filename: '第二首.mp3', filesize: 1024, hash: 'DEF456', audio_id: 12 },
      ],
    },
  },
  2: {
    status: 1,
    data: {
      total: 3,
      info: [{ kv_id: 9, filename: '第三首.mp3', filesize: 512, hash: 'GHI789', audio_id: 13 }],
    },
  },
}

responder = async ({ params }) => {
  requestedPages.push(params.page)
  return pageResponses[params.page]
}

const listResult = await getCloudDiskData({ page: 1, pagesize: 2 })
assert.deepEqual(requestedPages, [1, 2])
assert.equal(listResult.count, 3)
assert.equal(listResult.data.length, 3)
assert.equal(listResult.data[0].id, 7)
assert.equal(listResult.data[0].kv_id, 7)
assert.equal(listResult.data[0].fileName, '第一首.flac')
assert.equal(listResult.data[0].fileSize, 2048)
assert.equal(listResult.data[0].addTime, 1_710_000_000_000)
assert.equal(listResult.data[0].simpleSong.source, 'cloud')
assert.equal(listResult.data[0].simpleSong.cloudUrlParams.audio_id, 11)
assert.equal(listResult.size, 1024)
assert.equal(listResult.maxSize, 4096)

const uploadFile = { name: '歌手 - 歌曲.FLAC' }
responder = async () => ({ status: 1, data: { uploadInfo: { hash: 'ABC123' } } })
const uploadResult = await uploadCloudSong(uploadFile)
const uploadRequest = requests.at(-1)
assert.equal(uploadRequest.url, '/user/cloud/upload')
assert.equal(uploadRequest.method, 'post')
assert.equal(uploadRequest.data, uploadFile)
assert.equal(uploadRequest.headers['Content-Type'], 'application/octet-stream')
assert.equal(uploadRequest.params.extendname, 'flac')
assert.equal(uploadRequest.params.name, uploadFile.name)
assert.equal(uploadRequest.timeout, 600_000)
assert.equal(uploadResult.code, 200)

responder = async () => ({ status: 1, data: {} })
const deleteResult = await deleteCloudSong({ fileid: '7,8', album_audio_id: '21,0' })
const deleteRequest = requests.at(-1)
assert.equal(deleteRequest.url, '/user/cloud/del')
assert.equal(deleteRequest.method, 'post')
assert.equal(deleteRequest.params.fileid, '7,8')
assert.equal(deleteRequest.params.album_audio_id, '21,0')
assert.equal(deleteResult.code, 200)

responder = async () => ({ status: 0, error_code: 20018, error_msg: '登录状态失效' })
await assert.rejects(() => getCloudDiskData({ pagesize: 2 }), /登录状态失效/)

responder = async () => ({ status: 0, msg: '上传失败' })
await assert.rejects(() => uploadCloudSong(uploadFile), /上传失败/)

console.log('cloud API check passed')
