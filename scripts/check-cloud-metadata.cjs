const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const ffmpegPath = require('ffmpeg-static')
const { finalizeDownloadedFile } = require('../src/electron/download')
const { loadCloudMusicMetadata } = require('../src/electron/cloudMetadata')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrogen-cloud-metadata-'))
const cover = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address()))
  })
}

function close(server) {
  return new Promise(resolve => server.close(resolve))
}

async function createTaggedAudio(extension, format) {
  const audioPath = path.join(tempRoot, `tagged.${extension}`)
  execFileSync(ffmpegPath, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '0.1', '-f', format, '-y', audioPath,
  ])
  await finalizeDownloadedFile(audioPath, {
    fileName: '云盘标签自检',
    artists: ['测试歌手'],
    album: '测试专辑',
    lyrics: { lrc: '[00:00.000]cloud lyric' },
  }, {
    coverData: { buffer: cover, mime: 'image/png' },
  })
  return fs.readFileSync(audioPath)
}

;(async () => {
  let server
  try {
    const audioByPath = new Map([
      ['/tagged.mp3', await createTaggedAudio('mp3', 'mp3')],
      ['/tagged.flac', await createTaggedAudio('flac', 'flac')],
    ])
    server = http.createServer((request, response) => {
      const audio = audioByPath.get(request.url)
      if (!audio) {
        response.writeHead(404).end()
        return
      }
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '')
      const start = match ? Number(match[1]) : 0
      const end = Math.min(match?.[2] ? Number(match[2]) : audio.length - 1, audio.length - 1)
      const body = audio.subarray(start, end + 1)
      response.writeHead(match ? 206 : 200, {
        'Accept-Ranges': 'bytes',
        'Content-Length': body.length,
        'Content-Range': `bytes ${start}-${end}/${audio.length}`,
        // Kugou CDNs may report a generic MP3 MIME even when the cloud file is FLAC.
        'Content-Type': 'audio/mpeg',
      })
      response.end(body)
    })
    const address = await listen(server)
    for (const extension of ['mp3', 'flac']) {
      const metadata = await loadCloudMusicMetadata({
        url: `http://127.0.0.1:${address.port}/tagged.${extension}`,
        cacheKey: `self-check-${extension}-${Date.now()}`,
        fileName: `tagged.${extension}`,
        extension,
      })

      assert.equal(metadata.title, '云盘标签自检')
      assert.deepEqual(metadata.artists, ['测试歌手'])
      assert.equal(metadata.album, '测试专辑')
      assert.match(metadata.coverUrl, /^data:image\/png;base64,/)
      assert.match(metadata.lyric?.lrc?.lyric || '', /cloud lyric/)
    }
    console.log('cloud metadata check passed')
  } finally {
    if (server?.listening) await close(server)
    const resolvedTempRoot = path.resolve(tempRoot)
    const resolvedSystemTemp = path.resolve(os.tmpdir()) + path.sep
    if (!resolvedTempRoot.startsWith(resolvedSystemTemp)) throw new Error('refusing to clean non-temporary path')
    fs.rmSync(resolvedTempRoot, { recursive: true, force: true })
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
