const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const baseHash = '3FBC5C315493373AD05CAA47760DE18C'
const highQualityHash = '500E7AAFBFB8530540EAB1D93795EE5D'
const urlCalls = []
let newUrlCalls = 0
let invalidations = 0
const cookies = {}

const context = vm.createContext({ console })
const resolverPath = path.resolve(__dirname, '../src/utils/musicUrlResolver.js')
const resolver = new vm.SourceTextModule(fs.readFileSync(resolverPath, 'utf8'), {
    context,
    identifier: resolverPath,
})

function synthetic(exports) {
    return new vm.SyntheticModule(Object.keys(exports), function setExports() {
        for (const [name, value] of Object.entries(exports)) this.setExport(name, value)
    }, { context })
}

const modules = {
    '../api/cloud': synthetic({
        getCloudDiskSongUrl: async () => null,
    }),
    '../api/song': synthetic({
        getSongPrivilegeLite: async () => ({
            status: 1,
            data: [{
                hash: baseHash,
                quality: '128',
                level: 2,
                relate_goods: [
                    { hash: baseHash, quality: '128', level: 2 },
                    { hash: highQualityHash, quality: '320', level: 4 },
                ],
            }],
        }),
        getMusicUrl: async (song, quality, params = {}) => {
            urlCalls.push({ hash: song.hash, quality, ppageId: params.ppage_id ?? null })
            return {
                data: [{
                    url: song.hash === highQualityHash
                        && quality === '320'
                        && params.ppage_id === 356753938
                        ? 'https://example.test/song.mp3'
                        : null,
                }],
            }
        },
        getMusicUrlNew: async () => {
            newUrlCalls += 1
            return { data: [{ url: null }] }
        },
    }),
    './quality': synthetic({
        getPreferredQuality: value => value,
    }),
    './authority': synthetic({
        getCookie: key => cookies[key],
        updateStoredAuthCookies: ({ cookie }) => {
            const [, dfid] = cookie.match(/^dfid=(.+)$/) || []
            if (dfid) cookies.dfid = dfid
        },
    }),
    './request': synthetic({
        default: async () => ({ data: { dfid: 'D'.repeat(24) } }),
        invalidateNcmApiCookieCache: () => {
            invalidations += 1
        },
    }),
}

async function main() {
    await resolver.link(specifier => modules[specifier])
    await resolver.evaluate()

    const result = await resolver.namespace.resolveTrackByQualityPreference({
        hash: baseHash,
        album_audio_id: 490678421,
    }, 'flac')

    assert.equal(result.url, 'https://example.test/song.mp3')
    assert.deepEqual(urlCalls, [
        { hash: highQualityHash, quality: '320', ppageId: null },
        { hash: highQualityHash, quality: '320', ppageId: 356753938 },
    ])
    assert.equal(newUrlCalls, 0)
    assert.equal(cookies.dfid, 'D'.repeat(24))
    assert.equal(invalidations, 1)
    console.log('music URL resolver check passed')
}

main().catch((error) => {
    console.error(error)
    process.exitCode = 1
})
