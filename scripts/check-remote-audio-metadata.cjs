const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const http = require('node:http')
const ffmpegPath = require('ffmpeg-static')
const { loadRemoteAudioMetadata, HEADER_LIMIT } = require('../src/electron/remoteAudioMetadata')

function createAudio(format, codec, rate, extra = []) {
    return execFileSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', `anullsrc=r=${rate}:cl=stereo`,
        '-t', '0.2', '-c:a', codec, ...extra, '-f', format, 'pipe:1',
    ])
}

;(async () => {
    const fixtures = new Map([
        ['/vorbis', createAudio('ogg', 'libvorbis', 44100)],
        ['/opus', createAudio('ogg', 'libopus', 48000)],
        ['/flac', createAudio('flac', 'flac', 96000, ['-sample_fmt', 's32'])],
        ['/wav', createAudio('wav', 'pcm_s24le', 48000)],
        ['/mp3', createAudio('mp3', 'libmp3lame', 44100)],
    ])
    // Truncating a long Ogg stream must still extract its identification header.
    fixtures.set('/long-ogg', execFileSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anoisesrc=r=44100',
        '-t', '45', '-c:a', 'libvorbis', '-q:a', '10', '-f', 'ogg', 'pipe:1',
    ], { maxBuffer: 8 * 1024 * 1024 }))
    assert.ok(fixtures.get('/long-ogg').length > HEADER_LIMIT)
    fixtures.set('/ignore-range', Buffer.concat([fixtures.get('/wav'), Buffer.alloc(HEADER_LIMIT * 2)]))
    const counts = new Map()
    let retry = true
    const server = http.createServer((request, response) => {
        counts.set(request.url, (counts.get(request.url) || 0) + 1)
        assert.equal(request.headers.range, `bytes=0-${HEADER_LIMIT - 1}`)
        if (request.url === '/retry' && retry) {
            retry = false
            response.writeHead(503).end()
            return
        }
        const audio = fixtures.get(request.url === '/retry' ? '/vorbis' : request.url)
        if (!audio) return response.writeHead(404).end()
        const ignoreRange = request.url === '/ignore-range'
        const body = ignoreRange ? audio : audio.subarray(0, HEADER_LIMIT)
        response.writeHead(ignoreRange ? 200 : 206, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': body.length,
        })
        response.end(body)
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    try {
        const load = name => loadRemoteAudioMetadata({ url: base + name, cacheKey: 'same-song' })
        const [vorbis, duplicate] = await Promise.all([load('/vorbis'), load('/vorbis')])
        assert.deepEqual(vorbis, duplicate)
        assert.equal(counts.get('/vorbis'), 1)
        assert.equal(vorbis.sampleRate, 44100)
        assert.match(vorbis.codec, /vorbis/i)
        const opus = await load('/opus')
        assert.equal(opus.sampleRate, 48000)
        assert.match(opus.codec, /opus/i)
        const flac = await load('/flac')
        assert.equal(flac.sampleRate, 96000)
        assert.equal(flac.bitsPerSample, 24)
        assert.equal(flac.lossless, true)
        const wav = await load('/wav')
        assert.equal(wav.sampleRate, 48000)
        assert.equal(wav.bitsPerSample, 24)
        assert.equal((await load('/mp3')).sampleRate, 44100)
        assert.equal((await load('/long-ogg')).sampleRate, 44100)
        assert.equal((await load('/ignore-range')).bitsPerSample, 24)
        await assert.rejects(load('/retry'))
        assert.equal((await load('/retry')).sampleRate, 44100)
        assert.equal(counts.get('/retry'), 2)
        await assert.rejects(loadRemoteAudioMetadata({ url: 'file:///test.wav' }), /HTTP/)
        console.log('remote audio metadata check passed')
    } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
    }
})().catch(error => {
    console.error(error)
    process.exitCode = 1
})
