const path = require('path')
const { extractFile } = require('@electron/asar')

function readPackage(asarPath, packagePath) {
  return JSON.parse(extractFile(asarPath, packagePath.split('/').join(path.sep)).toString())
}

function verifyAsar(asarPath) {
  const metadata = readPackage(asarPath, 'node_modules/music-metadata/package.json')
  const requiredRange = metadata.dependencies?.['file-type'] || ''
  let fileType

  try {
    fileType = readPackage(asarPath, 'node_modules/music-metadata/node_modules/file-type/package.json')
  } catch (_) {
    fileType = readPackage(asarPath, 'node_modules/file-type/package.json')
  }

  const requiredMajor = Number(requiredRange.match(/\d+/)?.[0])
  const actualMajor = Number(fileType.version.match(/\d+/)?.[0])
  if (!requiredMajor || actualMajor !== requiredMajor) {
    throw new Error(
      `Packaged music-metadata requires file-type ${requiredRange}, but resolves to ${fileType.version}`,
    )
  }

  console.log(`[packaged-metadata] music-metadata ${metadata.version} -> file-type ${fileType.version}`)
}

async function verifyPackagedMetadata(context) {
  verifyAsar(path.join(context.packager.getResourcesDir(context.appOutDir), 'app.asar'))
}

if (require.main === module) {
  const asarPath = process.argv[2]
  if (!asarPath) throw new Error('Usage: node scripts/check-packaged-metadata.cjs <app.asar>')
  verifyAsar(path.resolve(asarPath))
}

module.exports = verifyPackagedMetadata
module.exports.verifyAsar = verifyAsar
