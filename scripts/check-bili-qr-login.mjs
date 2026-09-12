import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile('src/components/MusicVideo.vue', 'utf8')

assert.match(source, /const qrLoading = ref\(false\);/)
assert.match(source, /const qrError = ref\(''\);/)
assert.match(source, /const getQRCode = async \(\) =>/)
assert.match(source, /result\?\.code !== 0 \|\| !key \|\| !loginUrl/)
assert.match(source, /const qrImage = await QRCode\.toDataURL\(loginUrl,/)
assert.match(source, /qrcodeImg\.value = qrImage;\s+checkInterval\(\);/s)
assert.match(source, /qrError\.value = '二维码加载失败，点击重试';/)
assert.match(source, /<img v-if="qrcodeImg" :src="qrcodeImg" alt="哔哩哔哩登录二维码" \/>/)
assert.match(source, /<button v-else class="qr-retry" type="button" :disabled="qrLoading" @click="getQRCode">/)

console.log('bilibili QR login check passed')
