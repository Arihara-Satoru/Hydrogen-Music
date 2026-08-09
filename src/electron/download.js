const { ipcMain } = require('electron')
const fs = require('fs')
const fse = require('fs-extra')
const axios = require('axios')
const { randomUUID } = require('crypto')
const { getElectronStore } = require('./store')
const path = require('path');
let NodeID3 = null
let Metaflac = null
let Sharp = null
const audioExtensions = new Set(['mp3', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'aiff', 'aif', 'ape'])
try { NodeID3 = require('node-id3') } catch (_) { NodeID3 = null }
try { Metaflac = require('metaflac-js') } catch (_) { Metaflac = null }
try { Sharp = require('sharp') } catch (_) { Sharp = null }

function hasLyrics(lyrics) {
  return !!(lyrics && (lyrics.lrc || lyrics.tlyric || lyrics.romalrc))
}

function inferImageMime(buffer, contentType = '', sourceUrl = '') {
  const headerMime = String(contentType || '').split(';')[0].trim().toLowerCase()
  const buf = Buffer.from(buffer || [])
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png'
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(headerMime)) {
    return headerMime === 'image/jpg' ? 'image/jpeg' : headerMime
  }

  const lowerUrl = String(sourceUrl || '').split('?')[0].toLowerCase()
  if (lowerUrl.endsWith('.png')) return 'image/png'
  if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerUrl.endsWith('.webp')) return 'image/webp'
  return ''
}

async function prepareCoverData(coverUrl, providedCover = null) {
  let buffer
  let mime

  if (providedCover && providedCover.buffer) {
    buffer = Buffer.from(providedCover.buffer)
    mime = providedCover.mime || inferImageMime(buffer)
  } else {
    if (!coverUrl) return null
    const response = await axios.get(coverUrl, { responseType: 'arraybuffer', timeout: 15000 })
    buffer = Buffer.from(response.data)
    mime = inferImageMime(buffer, response.headers && response.headers['content-type'], coverUrl)
  }

  if ((mime === 'image/png' || mime === 'image/jpeg') || !Sharp) return { buffer, mime }

  const image = Sharp(buffer)
  const metadata = await image.metadata()
  if (metadata.hasAlpha) return { buffer: await image.png().toBuffer(), mime: 'image/png' }
  return { buffer: await image.jpeg({ mozjpeg: true, quality: 90 }).toBuffer(), mime: 'image/jpeg' }
}

function detectAudioTagFormat(audioPath) {
  let descriptor = null
  try {
    descriptor = fs.openSync(audioPath, 'r')
    const header = Buffer.alloc(12)
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0)
    if (bytesRead >= 4 && header.toString('ascii', 0, 4) === 'fLaC') return 'flac'
    if (bytesRead >= 3 && header.toString('ascii', 0, 3) === 'ID3') return 'mp3'
    if (bytesRead >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0) return 'mp3'
  } catch (_) {
    // Fall back to the file extension below.
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor) } catch (_) {}
    }
  }

  return path.extname(audioPath).slice(1).toLowerCase()
}

function resolveDownloadExtension(item, fallback) {
  const mimeType = String(item?.getMimeType?.() || '').split(';')[0].trim().toLowerCase()
  const extensionByMime = {
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
  }
  const mimeExtension = extensionByMime[mimeType]
  if (mimeExtension && mimeExtension !== 'mp3') return mimeExtension

  const responseExtension = path.extname(String(item?.getFilename?.() || '')).slice(1).toLowerCase()
  if (audioExtensions.has(responseExtension)) return responseExtension
  if (mimeExtension) return mimeExtension
  const fallbackExtension = String(fallback || '').replace(/^\./, '').toLowerCase()
  return audioExtensions.has(fallbackExtension) ? fallbackExtension : 'mp3'
}

function updateId3(tags, audioPath) {
  if (!NodeID3) throw new Error('node-id3 unavailable')
  const result = NodeID3.update(tags, audioPath)
  if (result instanceof Error) throw result
  if (result === false) throw new Error('node-id3 update failed')
}

async function finalizeDownloadedFile(audioPath, context, options = {}) {
  if (!audioPath || !context) return

  const parsed = path.parse(audioPath)
  const lyricPayload = context.lyrics
  const lyricMeta = {
    name: context.fileName,
    artists: Array.isArray(context.artists) ? context.artists : [],
    album: context.album || null,
  }
  const timedLyrics = hasLyrics(lyricPayload) ? buildCombinedLrcText(lyricPayload, lyricMeta) : ''
  const plainLyrics = hasLyrics(lyricPayload) ? buildUnsyncedLyricText(lyricPayload) : ''

  if (options.saveLyricFile && timedLyrics.trim()) {
    try {
      const lrcPath = path.join(parsed.dir, parsed.name + '.lrc')
      if (!fs.existsSync(lrcPath)) fs.writeFileSync(lrcPath, timedLyrics, 'utf8')
    } catch (error) {
      console.warn('写入歌词文件失败:', error && error.message ? error.message : error)
    }
  }

  let cover = null
  try {
    cover = await prepareCoverData(context.coverUrl, options.coverData)
  } catch (error) {
    console.warn('下载或转换封面失败:', error && error.message ? error.message : error)
  }

  const title = context.fileName || parsed.name
  const artists = Array.isArray(context.artists) ? context.artists.filter(Boolean) : []
  const album = context.album || ''
  const format = detectAudioTagFormat(audioPath)

  if (format === 'mp3') {
    const tags = {
      title,
      artist: artists.join(' / '),
      album,
      comment: { language: 'XXX', text: 'Hydrogen Music' },
    }
    const lyricText = timedLyrics || plainLyrics
    if (lyricText.trim()) {
      tags.unsynchronisedLyrics = { language: 'chi', text: lyricText }
      const synchronisedLyrics = buildSynchronisedLyricsFrames(lyricPayload)
      if (synchronisedLyrics && synchronisedLyrics.length) tags.synchronisedLyrics = synchronisedLyrics
    }
    if (cover && cover.buffer && cover.mime) {
      tags.image = {
        mime: cover.mime,
        type: { id: 3, name: 'front cover' },
        description: 'Cover',
        imageBuffer: cover.buffer,
      }
    }
    updateId3(tags, audioPath)
    return
  }

  if (format === 'flac') {
    if (!Metaflac) throw new Error('metaflac-js unavailable')
    const flac = new Metaflac(audioPath)
    if (!Buffer.isBuffer(flac.padding)) flac.padding = Buffer.alloc(0)
    for (const tag of ['TITLE', 'ARTIST', 'ALBUM', 'LYRICS', 'UNSYNCEDLYRICS', 'LRC', 'LYRICS_LRC', 'SYNCEDLYRICS']) {
      flac.removeTag(tag)
    }
    if (title) flac.setTag(`TITLE=${title}`)
    if (artists.length) flac.setTag(`ARTIST=${artists.join(' / ')}`)
    if (album) flac.setTag(`ALBUM=${album}`)
    if (plainLyrics.trim()) {
      flac.setTag(`LYRICS=${plainLyrics}`)
      flac.setTag(`UNSYNCEDLYRICS=${plainLyrics}`)
    } else if (timedLyrics.trim()) {
      flac.setTag(`LYRICS=${timedLyrics}`)
    }
    if (timedLyrics.trim()) {
      flac.setTag(`LRC=${timedLyrics}`)
      flac.setTag(`LYRICS_LRC=${timedLyrics}`)
      flac.setTag(`SYNCEDLYRICS=${timedLyrics}`)
    }
    if (cover && cover.buffer && (cover.mime === 'image/png' || cover.mime === 'image/jpeg')) {
      flac.pictures = []
      flac.importPictureFromBuffer(cover.buffer)
    }
    flac.save()
  }
}

module.exports = async function MusicDownload(win) {
  const Store = await getElectronStore()
  const settingsStore = new Store({ name: 'settings' })
  let isClose = false
  const sanitize = (name) => {
    try {
      const normalized = String(name || '')
        .replace(/[\\/:*?"<>|]/g, ' ')
        .replace(/[\u0000-\u001f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[. ]+$/g, '')
        .slice(0, 120) || 'unknown'
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized)) return `_${normalized}`
      return normalized
    } catch (_) {
      return 'unknown'
    }
  }
  let downloadObj = {
    downloadUrl: '',
    fileName: '',
    type: '',
    savePath: '',
    id: null,
    lyrics: null,
    coverUrl: null,
    artists: null,
    album: null,
  }
  ipcMain.on('download', async (event, args) => {
    downloadObj.fileName = args.name
    downloadObj.downloadUrl = args.url
    downloadObj.type = args.type
    downloadObj.id = args.id || null
    downloadObj.lyrics = args.lyrics || null
    downloadObj.coverUrl = args.coverUrl || null
    downloadObj.artists = args.artists || null
    downloadObj.album = args.album || null
    const savePath = await settingsStore.get('settings')
    downloadObj.savePath = path.join(savePath.local.downloadFolder, path.sep)
    win.webContents.downloadURL(downloadObj.downloadUrl)
  })

  win.webContents.session.on('will-download', (event, item, webContents) => {
    const context = {
      ...downloadObj,
      type: resolveDownloadExtension(item, downloadObj.type),
      artists: Array.isArray(downloadObj.artists) ? [...downloadObj.artists] : [],
      lyrics: downloadObj.lyrics ? { ...downloadObj.lyrics } : null,
    }
    const settings = (() => {
      try { return settingsStore.get('settings') || null } catch (_) { return null }
    })()
    const createSongFolder = !!(settings && settings.local && settings.local.downloadCreateSongFolder)
    const saveLyricFile = !!(settings && settings.local && settings.local.downloadSaveLyricFile)

    // 以歌曲名创建文件夹，内部保存音频/歌词/封面，并在音频文件内写入元数据
    const baseName = sanitize(context.fileName)
    let destDir = context.savePath
    let audioFileName = baseName + '.' + context.type
    if (createSongFolder) {
      destDir = path.join(context.savePath, baseName)
      try {
        let suffix = 1
        while (fs.existsSync(destDir) && !fs.statSync(destDir).isDirectory()) {
          destDir = path.join(context.savePath, `${baseName} (${suffix++})`)
        }
        fse.ensureDirSync(destDir)
      } catch (e) {
        try { fse.ensureDirSync(context.savePath) } catch (_) {}
        destDir = context.savePath
      }
      audioFileName = baseName + '.' + context.type
    } else {
      try { fse.ensureDirSync(context.savePath) } catch (_) {}
      // 文件名冲突处理：在同一目录下追加 (n)
      try {
        let suffix = 1
        const parsedType = '.' + String(context.type || '').replace(/^\./, '')
        const ext = parsedType === '.' ? '' : parsedType
        while (fs.existsSync(path.join(destDir, audioFileName))) {
          audioFileName = `${baseName} (${suffix++})${ext}`
        }
      } catch (_) {}
    }

    const audioPath = path.join(destDir, audioFileName)
    item.setSavePath(audioPath)

    const totalBytes = item.getTotalBytes();

    console.log(item.getURL())
    console.log(totalBytes)
    console.log(item.getSavePath())

    let interruptedTimes = 0
    item.on('updated', (event, state) => {
      let progress = item.getReceivedBytes() / totalBytes
      progress = Math.round(progress * 100)
      win.setProgressBar(progress / 100);

      if (state === 'interrupted') {
        console.log('Download is interrupted but can be resumed')
        let alterPath = path.join(context.savePath, sanitize(context.fileName))
        if (true) {
          interruptedTimes++
          const tryDir = alterPath + (interruptedTimes > 1 ? ` (${interruptedTimes})` : '')
          try { fse.ensureDirSync(tryDir) } catch (_) {}
          item.setSavePath(path.join(tryDir, sanitize(context.fileName) + '.' + context.type))
          if (interruptedTimes > 3) {
            item.setSavePath(path.join(context.savePath, "undefined_name_" + randomUUID() + "." + context.type))
            interruptedTimes = 0
          }
          item.resume()
        }

      } else if (state === 'progressing') {
        if (item.isPaused()) {
          console.log('Download is paused')
        } else {
          console.log(progress)
        }
      }
      win.webContents.send('download-progress', progress)
    })
    item.once('done', async (event, state) => {
      if (state === 'completed') {
        console.log('Download successfully')
        try {
          await finalizeDownloadedFile(item.getSavePath(), context, { saveLyricFile })
        } catch (e) {
          console.warn('写入下载歌曲元数据失败:', e && e.message ? e.message : e)
        }
      } else {
        console.log(`Download failed: ${state}`)
      }
      if (!win.isDestroyed()) {
        win.setProgressBar(-1);
      }
      if (!isClose) win.webContents.send('download-next')
    })
    ipcMain.on('download-resume', () => {
      item.resume()
    })
    ipcMain.on('download-pause', (close) => {
      if (close == 'shutdown') {
        isClose = true
        item.cancel()
      }
      else item.pause()
    })
    ipcMain.on('download-cancel', () => {
      item.cancel()
    })
  })
}

// 构建合并后的 LRC 文本：核心修复——兼容 [mm:ss:cc] 与 [mm:ss.xxx] 时间格式
function buildCombinedLrcText(lyricPayload, meta) {
  try {
    // 更宽松的时间标签解析：允许分隔符为 : ： . ． 。 , ， ; ； / - _ 或任意空白
    // 支持 [mm sep ss] 与 [mm sep ss sep cc] 形式（cc 可为 1-3 位，表示 10ms/1ms 精度）
    const timeTag = /\[(\d{1,3})\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,2})(?:\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,3}))?\]/g
    const timeTagSingle = /\[(\d{1,3})\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,2})(?:\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,3}))?\]/
    const lrcMetadataTagLine = /^\s*\[(?:ar|ti|al|by|offset|re|ve|au|length|language|lang|kana)\s*:[^\]]*\]\s*$/i

    const extractUntimedPreludeLines = (text) => {
      const out = []
      if (!text || typeof text !== 'string') return out
      const lines = text.split(/\r?\n/)
      for (const raw of lines) {
        if (typeof raw !== 'string') continue
        if (timeTagSingle.test(raw)) break
        const line = raw.trim()
        if (!line) continue
        if (lrcMetadataTagLine.test(line)) continue
        out.push(line)
      }
      return out
    }

    const parseLines = (text) => {
      const map = new Map()
      if (!text || typeof text !== 'string') return map
      const lines = text.split(/\r?\n/)
      for (const raw of lines) {
        if (!raw) continue
        const tags = Array.from(raw.matchAll(timeTag))
        if (!tags || tags.length === 0) continue
        const lyricText = raw.replace(timeTag, '').trim()
        if (!lyricText) continue
        for (const m of tags) {
          const mm = parseInt(m[1] || '0', 10)
          const ss = parseInt(m[2] || '0', 10)
          const ms = m[3] ? parseInt((m[3] + '00').slice(0, 3), 10) : 0
          const t = mm * 60 + ss + ms / 1000
          const key = t.toFixed(3)
          const arr = map.get(key) || []
          arr.push(lyricText)
          map.set(key, arr)
        }
      }
      return map
    }

    const preludeLines = extractUntimedPreludeLines(lyricPayload && lyricPayload.lrc)
    const oMap = parseLines(lyricPayload.lrc)
    const tMap = parseLines(lyricPayload.tlyric)
    const rMap = parseLines(lyricPayload.romalrc)

    const allKeysSet = new Set([...oMap.keys(), ...tMap.keys(), ...rMap.keys()])
    const allTimes = Array.from(allKeysSet).map(k => Number(k)).sort((a, b) => a - b)

    const formatTag = (sec) => {
      const m = Math.floor(sec / 60)
      const s = Math.floor(sec % 60)
      const ms = Math.round((sec - Math.floor(sec)) * 1000)
      const mm = String(m).padStart(2, '0')
      const ss = String(s).padStart(2, '0')
      const mmm = String(ms).padStart(3, '0')
      return `[${mm}:${ss}.${mmm}]`
    }

    let out = ''
    out += '[by:Hydrogen Music]\n'
    if (meta && (meta.name || (meta.artists && meta.artists.length) || meta.album)) {
      if (meta.name) out += `[ti:${meta.name}]\n`
      if (Array.isArray(meta.artists) && meta.artists.length) out += `[ar:${meta.artists.join(' / ')}]\n`
      if (meta.album) out += `[al:${meta.album}]\n`
    }
    for (const line of preludeLines) {
      out += `${line}\n`
    }
    for (const t of allTimes) {
      const key = t.toFixed(3)
      const oList = oMap.get(key) || []
      const trList = tMap.get(key) || []
      const rList = rMap.get(key) || []
      for (const o of oList) out += `${formatTag(t)}${o}\n`
      for (const tr of trList) out += `${formatTag(t)}${tr}\n`
      for (const r of rList) out += `${formatTag(t)}${r}\n`
    }
    return out
  } catch (e) {
    return ''
  }
}

// 生成无时间戳的纯文本歌词（用于内嵌到 MP3/FLAC 标签中）
function buildUnsyncedLyricText(lyricPayload) {
  try {
    const combined = buildCombinedLrcText(lyricPayload, null) || ''
    // 去掉所有 [..] 标签（时间与头部元信息），合并并清理空白
    const text = combined
      .replace(/\[[^\]]+\]/g, '')
      .replace(/[\t ]+/g, ' ')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter((line) => !!line)
      .join('\n')
    return text
  } catch (_) {
    return ''
  }
}

// 生成带时间戳的同步歌词帧（ID3v2 SYLT），用于 MP3 内嵌同步歌词
function buildSynchronisedLyricsFrames(lyricPayload) {
  try {
    if (!NodeID3 || !NodeID3.TagConstants) return null
    const TagConstants = NodeID3.TagConstants
    const timeTag = /\[(\d{1,3})\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,2})(?:\s*[:：\.\uFF0E\u3002,，;；/\-_\s]\s*(\d{1,3}))?\]/g

    const extractEntries = (text) => {
      const entries = []
      if (!text || typeof text !== 'string') return entries
      const lines = text.split(/\r?\n/)
      for (const raw of lines) {
        if (!raw) continue
        const tags = Array.from(raw.matchAll(timeTag))
        if (!tags || tags.length === 0) continue
        const lyricText = raw.replace(timeTag, '').trim()
        if (!lyricText) continue
        for (const m of tags) {
          const mm = parseInt(m[1] || '0', 10)
          const ss = parseInt(m[2] || '0', 10)
          const ms = m[3] ? parseInt((String(m[3]) + '00').slice(0, 3), 10) : 0
          const timeMs = Math.max(0, Math.round((mm * 60 + ss) * 1000 + ms))
          entries.push({ timeMs, text: lyricText })
        }
      }
      return entries
    }

    const grouped = new Map() // timeMs -> { o: [], t: [], r: [] }
    const addToGroup = (entries, key) => {
      for (const e of entries) {
        if (!e || typeof e.timeMs !== 'number' || e.timeMs < 0) continue
        const bucket = grouped.get(e.timeMs) || { o: [], t: [], r: [] }
        if (e.text && String(e.text).trim()) bucket[key].push(String(e.text).trim())
        grouped.set(e.timeMs, bucket)
      }
    }

    addToGroup(extractEntries(lyricPayload && lyricPayload.lrc), 'o')
    addToGroup(extractEntries(lyricPayload && lyricPayload.tlyric), 't')
    addToGroup(extractEntries(lyricPayload && lyricPayload.romalrc), 'r')

    const times = Array.from(grouped.keys()).sort((a, b) => a - b)
    const synchronisedText = []
    for (const timeMs of times) {
      const bucket = grouped.get(timeMs)
      if (!bucket) continue
      const parts = []
      if (bucket.o && bucket.o.length) parts.push(bucket.o.join('\n'))
      if (bucket.t && bucket.t.length) parts.push(bucket.t.join('\n'))
      if (bucket.r && bucket.r.length) parts.push(bucket.r.join('\n'))
      const text = parts.join('\n').trim()
      if (!text) continue
      synchronisedText.push({ text, timeStamp: timeMs })
    }
    if (!synchronisedText.length) return null

    return [{
      language: 'chi',
      timeStampFormat: TagConstants.TimeStampFormat.MILLISECONDS,
      contentType: TagConstants.SynchronisedLyrics.ContentType.LYRICS,
      shortText: 'Lyrics',
      synchronisedText
    }]
  } catch (_) {
    return null
  }
}

module.exports.finalizeDownloadedFile = finalizeDownloadedFile
module.exports.resolveDownloadExtension = resolveDownloadExtension
