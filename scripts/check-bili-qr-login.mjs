import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [source, ipcSource, preloadSource] = await Promise.all([
  readFile('src/components/MusicVideo.vue', 'utf8'),
  readFile('src/electron/ipcMain.js', 'utf8'),
  readFile('src/electron/preload.js', 'utf8'),
])

assert.match(source, /const qrLoading = ref\(false\);/)
assert.match(source, /const qrError = ref\(''\);/)
assert.match(source, /const getQRCode = async \(\) =>/)
assert.match(source, /result\?\.code !== 0 \|\| !key \|\| !loginUrl/)
assert.match(source, /const qrImage = await QRCode\.toDataURL\(loginUrl,/)
assert.match(source, /qrcodeImg\.value = qrImage;\s+checkInterval\(\);/s)
assert.match(source, /qrError\.value = '二维码加载失败，点击重试';/)
assert.match(source, /<img v-if="qrcodeImg" :src="qrcodeImg" alt="哔哩哔哩登录二维码" \/>/)
assert.match(source, /<button v-else class="qr-retry" type="button" :disabled="qrLoading" @click="getQRCode">/)
assert.match(source, /const storeBiliCookiesFromLoginUrl = async urlStr =>/)
assert.match(source, /await windowApi\.getBiliQrLoginCookies\(urlStr\)/)
assert.match(source, /const cookieStr = await storeBiliCookiesFromLoginUrl\(data\.url\)/)
assert.match(ipcSource, /ipcMain\.handle\("get-bili-qr-login-cookies"/)
assert.match(ipcSource, /response\.headers\["set-cookie"\]/)
assert.match(ipcSource, /url\.hostname\.endsWith\("\.bilibili\.com"\)/)
assert.match(preloadSource, /getBiliQrLoginCookies: \(loginUrl\)/)

console.log('bilibili QR login check passed')
