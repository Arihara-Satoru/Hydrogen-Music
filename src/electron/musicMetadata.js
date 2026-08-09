let musicMetadataPromise = null

async function getMusicMetadata() {
    if (!musicMetadataPromise) {
        musicMetadataPromise = import('music-metadata')
    }
    return musicMetadataPromise
}

async function parseFile(...args) {
    const mod = await getMusicMetadata()
    return mod.parseFile(...args)
}

async function parseStream(...args) {
    const mod = await getMusicMetadata()
    return mod.parseStream(...args)
}

module.exports = { parseFile, parseStream }
