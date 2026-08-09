const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ffmpegPath = require('ffmpeg-static')
const sharp = require('sharp')
const { parseFile } = require('../src/electron/musicMetadata')
const { finalizeDownloadedFile, resolveDownloadExtension } = require('../src/electron/download')

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'hydrogen-download-metadata-'))
const coverData = {
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  mime: 'image/png',
}
const context = {
  fileName: '下载标签自检',
  artists: ['测试歌手'],
  album: '测试专辑',
  lyrics: {
    lrc: '[00:00.000]第一句\n[00:01.000]第二句',
    tlyric: '[00:00.000]First line',
    romalrc: null,
  },
}

function createSilentAudio(outputPath, format) {
  execFileSync(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'lavfi',
    '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', '0.1',
    '-f', format,
    '-y',
    outputPath,
  ])
}

function getEmbeddedLyricText(metadata) {
  return (metadata.common.lyrics || [])
    .map(value => typeof value === 'string' ? value : value?.text || JSON.stringify(value))
    .join('\n')
}

async function checkFile(filePath, expectedContainer, embeddedCover = coverData) {
  await finalizeDownloadedFile(filePath, context, { coverData: embeddedCover, saveLyricFile: true })
  const metadata = await parseFile(filePath)

  assert.equal(metadata.format.container, expectedContainer)
  assert.equal(metadata.common.title, context.fileName)
  assert.deepEqual(metadata.common.artists, context.artists)
  assert.equal(metadata.common.album, context.album)
  assert.equal(metadata.common.picture?.length, 1)
  assert.match(metadata.common.picture[0].format, /^image\/(?:png|jpeg)$/)
  assert.match(getEmbeddedLyricText(metadata), /第一句/)
  assert.match(fs.readFileSync(filePath.replace(/\.[^.]+$/, '.lrc'), 'utf8'), /\[00:00\.000\]第一句/)
}

(async () => {
  try {
    assert.equal(resolveDownloadExtension({ getMimeType: () => 'audio/flac', getFilename: () => 'stream.mp3' }, 'mp3'), 'flac')
    assert.equal(resolveDownloadExtension({ getMimeType: () => 'audio/mpeg', getFilename: () => 'stream.flac' }, 'mp3'), 'flac')
    assert.equal(resolveDownloadExtension({ getMimeType: () => 'application/octet-stream', getFilename: () => 'stream.flac' }, 'mp3'), 'flac')
    assert.equal(resolveDownloadExtension({ getMimeType: () => 'application/octet-stream', getFilename: () => 'stream.bin' }, 'flac'), 'flac')

    const mp3Path = path.join(tempRoot, 'tagged.mp3')
    const flacPath = path.join(tempRoot, 'lossless.flac')
    const webpCover = { buffer: await sharp(coverData.buffer).webp().toBuffer(), mime: 'image/webp' }
    createSilentAudio(mp3Path, 'mp3')
    createSilentAudio(flacPath, 'flac')

    await checkFile(mp3Path, 'MPEG', webpCover)
    await checkFile(flacPath, 'FLAC')
    console.log('download metadata check passed')
  } finally {
    const resolvedTempRoot = path.resolve(tempRoot)
    const resolvedSystemTemp = path.resolve(os.tmpdir()) + path.sep
    if (!resolvedTempRoot.startsWith(resolvedSystemTemp)) throw new Error('refusing to clean non-temporary path')
    fs.rmSync(resolvedTempRoot, { recursive: true, force: true })
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
