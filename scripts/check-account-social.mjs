import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, SourceTextModule, SyntheticModule, runInContext } from 'node:vm'
import { ref, computed, reactive, watch } from 'vue'
import { parse, compileStyle } from '@vue/compiler-sfc'

const requests = []
let respond = async () => ({ status: 1 })
const context = createContext({ Date, console })
const request = new SyntheticModule(['default'], function () {
  this.setExport('default', config => { requests.push(config); return respond(config) })
}, { context })
async function loadApi(path) {
  const module = new SourceTextModule(await readFile(path, 'utf8'), { context })
  await module.link(() => request)
  await module.evaluate()
  return module.namespace
}
const login = await loadApi('src/api/login.js')
const user = await loadApi('src/api/user.js')
const personalCenterSource = await readFile('src/views/PersonalCenter.vue', 'utf8')
const { descriptor } = parse(personalCenterSource)
const personalCenterStyle = compileStyle({ source: descriptor.styles[0].content, filename: 'PersonalCenter.vue', id: 'data-v-check', scoped: true })
assert.equal(personalCenterStyle.errors.length, 0)
assert.doesNotMatch(personalCenterStyle.code, /\.dark(?:\s*,\s*\.dark)*\s*\{/, 'personal-center theme rules must never target the entire app')
const accountSource = await readFile('src/utils/accountSession.js', 'utf8')
const normalizeContext = createContext({ Date, getCookie: () => '456' })
runInContext(accountSource.slice(accountSource.indexOf('function pickFirstValue'), accountSource.indexOf('export function normalizePlaylistItem')).replace('export function normalizeUserProfile', 'function normalizeUserProfile'), normalizeContext)
const clearedProfile = runInContext("normalizeUserProfile({ data: { signature: '', descri: '旧签名', description: '旧签名' } })", normalizeContext)
assert.equal(clearedProfile.signature, '')
assert.equal(clearedProfile.description, '', 'clearing signature must also update the settings display')
const session = { qrsig: 'sig', ptqrtoken: 123, pt_login_sig: 'login', pt_openlogin_data: 'a=b&h5sig=c', xlogin_url: 'https://qq.example/?a=b', cookie: 'qrsig=sig; pt_login_sig=login', qrcode: 'image' }
await login.checkQQStatus(session)
assert.equal(requests.at(-1).params.timestamp > 0, true)
for (const key of ['qrsig', 'ptqrtoken', 'pt_login_sig', 'pt_openlogin_data', 'xlogin_url', 'cookie']) assert.equal(requests.at(-1).data[key], session[key])
assert.equal(requests.at(-1).url, '/login/qq/qr/check')
await login.authorizeQRcode('key-123')
assert.equal(requests.at(-1).data.qrcode, 'key-123')
assert.throws(() => login.authorizeQRcode('https://invalid'), /key/)
await login.loginByQQ({ openid: 'id', access_token: 'secret' })
assert.equal(requests.at(-1).data.access_token, 'secret')
await user.updatePersonalProfile({ signature: '', birthday: '', sex: '0' })
assert.equal(requests.at(-1).data.signature, '')
assert.equal(requests.at(-1).data.sex, '0')
await user.updateAvatar('data:image/png;base64,abcd', '头像.png')
assert.equal(requests.at(-1).data.filename, '头像.png')
for (const type of ['follow', 'friends', 'fans']) { await user.getUserRelations(type); assert.equal(requests.at(-1).url, `/user/${type}`) }
assert.throws(() => user.getUserRelations('invalid'))
await user.followUser('123', false)
assert.equal(requests.at(-1).url, '/user/follow/del')
await user.getPrivateMessages('123', '9007199254740993')
assert.equal(requests.at(-1).params.maxid, '9007199254740993')
respond = async config => ({ status: 1, list: config.params.tag === 'chat:456_123'
  ? [{ msgid: '9007199254740993', uid: 456, message: { alert: '我发出的消息' } }]
  : [{ msgid: '9007199254740992', uid: 123, message: { alert: '对方回复' } }] })
const bothDirections = await user.getPrivateMessages('123', 0, '456')
assert.equal(bothDirections.list.map(item => item.uid).join(','), '456,123', 'history must include either participant order')
assert.equal(requests.at(-2).params.tag, 'chat:123_456')
assert.equal(requests.at(-1).params.tag, 'chat:456_123')
respond = async config => ({ status: 1, list: Array.from({ length: 30 }, (_, index) => ({
  msgid: String(BigInt(config.params.tag === 'chat:456_123' ? '9007199254741099' : '9007199254741049') - BigInt(index)),
})) })
const mergedPage = await user.getPrivateMessages('123', '9007199254741199', '456')
assert.equal(mergedPage.list.length, 30)
assert.equal(mergedPage.list.at(-1).msgid, '9007199254741070', 'merged page must keep the newest 30 so its next cursor cannot skip the other tag')
assert.equal(requests.at(-1).params.maxid, '9007199254741199')
respond = async () => ({ status: 1, list: [{ msgid: '9007199254740993', uid: 456 }] })
assert.equal((await user.getPrivateMessages('123', 0, '456')).list.length, 1, 'same message in both histories must be deduplicated')
assert.throws(() => user.sendPrivateMessage('123', '  '))
respond = async () => ({ status: 0, errcode: 3006, error: '需要对方关注或回复后才能恢复正常聊天' })
await assert.rejects(user.sendPrivateMessage('123', '你好'), /需要对方关注/)

let interceptRequest
const mock = values => new SyntheticModule(Object.keys(values), function () {
  for (const [key, value] of Object.entries(values)) this.setExport(key, value)
}, { context })
const requestDependencies = {
  axios: mock({ default: { create: () => ({ interceptors: {
    request: { use: callback => { interceptRequest = callback } }, response: { use() {} },
  } }) } }),
  '../utils/authority': mock({ getCookie: key => ({ token: 'test-token', userid: '456' })[key], isLogin: () => true, updateStoredAuthCookies: () => ({}) }),
  '../store/pinia': mock({ default: {} }),
  '../store/libraryStore': mock({ useLibraryStore: () => ({ needTimestamp: [] }) }),
  '../store/userStore': mock({ useUserStore: () => ({}) }),
  './accountState': mock({ clearAccountScopedState() {} }),
  './loginDevices': mock({ buildKugouDeviceCookieString: () => 'mid=test-device' }),
  './dialog': mock({ noticeOpen() {} }),
}
const sharedRequest = new SourceTextModule(await readFile('src/utils/request.js', 'utf8'), { context })
await sharedRequest.link(specifier => requestDependencies[specifier])
await sharedRequest.evaluate()
const authorizedRequest = await interceptRequest({ url: '/login/qr/authorize' })
assert.match(authorizedRequest.headers.Authorization, /token=test-token;userid=456/)
const qqRequest = await interceptRequest({ url: '/login/qq/qr/check' })
assert.doesNotMatch(qqRequest.headers.Authorization, /token=/, 'QQ authorization must not reuse the current account token')

// Execute the actual setup scripts, keeping Vue's synchronous watchers and controlling network/timers.
async function setup(path, bindings) {
  const source = await readFile(path, 'utf8')
  const script = source.match(/<script setup>([\s\S]*?)<\/script>/)[1].replace(/import[\s\S]*?from ['"][^'"]+['"]\s*\n/g, '')
  const hooks = {}, scope = createContext({ ref, computed, reactive, watch, Date, URL, console,
    onMounted: fn => { hooks.mounted = fn }, onActivated: fn => { hooks.activated = fn },
    onDeactivated: fn => { hooks.deactivated = fn }, onUnmounted: fn => { hooks.unmounted = fn },
    onBeforeRouteLeave() {}, defineProps: () => ({ firstLoadMode: 2 }),
    defineExpose() {}, defineEmits: () => () => {}, ...bindings })
  runInContext(script, scope)
  return { hooks, get: expression => runInContext(expression, scope) }
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const firstQr = deferred(), secondQr = deferred()
let creates = 0, scheduled, checks = 0, qqStatus = { status: 'expired' }
const qq = await setup('src/components/LoginByQQ.vue', {
  createQQQRcode: () => (++creates === 1 ? firstQr.promise : secondQr.promise),
  checkQQStatus: async () => { checks++; return qqStatus }, loginByQQ() {}, loginHandle() {},
  setTimeout: fn => { scheduled = fn; return 1 }, clearTimeout: () => { scheduled = null },
})
const firstLoad = qq.get('refresh()')
qq.get('stop()')
firstQr.resolve(session)
await firstLoad
assert.equal(scheduled, null, 'deactivated QR creation must never restart polling')
const secondLoad = qq.get('refresh()')
secondQr.resolve(session)
await secondLoad
await scheduled()
assert.equal(checks, 1)
assert.equal(qq.get('expired.value'), true)
await qq.get('refresh()')
qqStatus = { status: '67' }
await scheduled()
assert.equal(qq.get('animation.value'), 1, 'QQ scan confirmation must use the shared shrinking animation')
assert.equal(qq.get('qrLabel.value'), 'CONFIRM')
qqStatus = { status: 1, data: { token: 'qa-token' } }
await scheduled()
assert.equal(qq.get('animation.value'), 2, 'QQ success must start the shared login animation')
assert.equal(qq.get('qrLabel.value'), 'LOGGING...')
for (const component of ['LoginByQRCode', 'LoginByWeChat', 'LoginByQQ']) {
  const source = await readFile(`src/components/${component}.vue`, 'utf8')
  assert.match(source, /<LoginQRCode\b/, `${component} must reuse the same QR animation component`)
  assert.doesNotMatch(source, /@keyframes/, `${component} must not duplicate QR animation styles`)
}

for (const component of ['LoginByQRCode', 'LoginByWeChat']) {
  const pending = deferred()
  let pollScheduled = false, qrCreates = 0
  const existingQr = await setup(`src/components/${component}.vue`, {
    getQRcodeKey: () => { qrCreates++; return pending.promise }, createQRcode: async () => ({ data: { qrimg: 'image' } }),
    createWeChatQRcode: () => { qrCreates++; return pending.promise }, checkWeChatStatus() {}, loginByOpenPlatform() {}, checkQRcodeStatus() {},
    loginHandle() {}, noticeOpen() {}, copyToClipboard() {},
    setTimeout: () => { pollScheduled = true; return 1 }, clearTimeout() {},
  })
  const loading = existingQr.get('loadData()')
  existingQr.hooks.unmounted()
  pending.resolve({ data: { unikey: 'key' }, uuid: 'uuid', qrcode: { qrcodebase64: 'image' } })
  await loading
  assert.equal(pollScheduled, false, `${component} must not start polling after switching login methods`)
  await existingQr.get('loadData()')
  assert.equal(pollScheduled, true, `${component} must still start polling for an active QR`)
  const beforeRefresh = qrCreates
  existingQr.get('refreshQRCode()')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(qrCreates, beforeRefresh + 1, `${component} must support refreshing a waiting QR by clicking it`)
  existingQr.get('pollingInFlight.value = true; clearTimer(false); startPolling()')
  assert.equal(existingQr.get('pollingInFlight.value'), false, `${component} must allow fresh polling after canceling an in-flight request`)
}

let wxCreates = 0
const wxMounted = await setup('src/components/LoginByWeChat.vue', {
  defineProps: () => ({ firstLoadMode: 1 }),
  createWeChatQRcode: async () => { wxCreates++; return { uuid: 'uuid', qrcode: { qrcodebase64: 'image' } } },
  setTimeout: () => 1, clearTimeout() {}, noticeOpen() {},
})
assert.equal(typeof wxMounted.hooks.mounted, 'function', 'switching to WeChat must initialize the newly mounted component')
wxMounted.hooks.mounted()
wxMounted.hooks.activated()
await new Promise(resolve => setImmediate(resolve))
assert.equal(wxCreates, 1, 'mount and activation must share a single QR creation request')
assert.match(wxMounted.get('qrcodeImg.value'), /^data:image\//)
wxMounted.hooks.unmounted()

const pendingPhone = deferred()
let phoneLogins = 0
const phone = await setup('src/components/LoginByAccount.vue', {
  loginByPhone: () => { phoneLogins++; return pendingPhone.promise }, noticeOpen() {},
  setTimeout: () => 1, clearTimeout() {},
})
phone.get("accountNumber.value = '13800138000'; captchaCode.value = '123456'")
const phoneLogin = phone.get('login()')
await phone.get('login()')
assert.equal(phoneLogins, 1, 'repeated form submission must not start duplicate logins')
pendingPhone.resolve({ status: 0, msg: '验证码错误' })
await phoneLogin

const store = reactive({ user: { userId: '456', nickname: '我' }, updateUser(value) { this.user = value } })
let account = '456', history = [{ msgid: '9007199254740993', uid: '123', message: '{"alert":"你好"}' }, { msgid: '9007199254740992', uid: '456', message: { alert: '收到' } }]
let sendFails = true, pendingHistory = null, uploads = 0
const profile = await setup('src/views/PersonalCenter.vue', {
  useRouter: () => ({ replace() {}, back() {} }), useUserStore: () => store,
  getUserProfile: async () => ({ data: store.user }), getPersonalProfile: async () => ({ data: store.user }),
  normalizeUserProfile: result => ({ ...result.data }), resolveImageUrl: value => value,
  getCookie: key => key === 'userid' ? account : 'test-token', isLogin: () => !!account,
  getUserRelations: async () => ({ data: { list: [{ userid: '123', nickname: '朋友' }] } }),
  extractPurchasedItems: user.extractPurchasedItems,
  getPrivateMessages: async () => pendingHistory ? pendingHistory.promise : { data: { list: history } },
  sendPrivateMessage: async () => { if (sendFails) throw new Error('需要对方关注或回复'); return { status: 1 } },
  updatePersonalProfile: async () => ({ status: 1 }), updateAvatar: async () => { uploads++; return { pic: 'https://example.test/avatar.png' } },
  FileReader: class { readAsDataURL() { this.result = 'data:image/png;base64,abcd'; this.onload() } },
  followUser() {}, authorizeQRcode: async () => ({ data: { authorized: false } }),
})
profile.hooks.activated()
await new Promise(resolve => setImmediate(resolve))
await profile.get("uploadAvatar({ target: { value: 'file', files: [{ type: 'text/plain', size: 12 }] } })")
assert.equal(uploads, 0, 'non-image files must never be uploaded')
await profile.get("uploadAvatar({ target: { value: 'file', files: [{ type: 'image/png', size: 12, name: 'avatar.png' }] } })")
assert.equal(uploads, 1)
assert.equal(store.user.avatarUrl, 'https://example.test/avatar.png')
profile.get("openChat({ id: '123', name: '朋友' })")
await new Promise(resolve => setImmediate(resolve))
assert.equal(profile.get('messages.value.length'), 2, 'opening chat must load its first page')
assert.equal(profile.get('messages.value[0].id'), '9007199254740992', 'large message IDs must keep order and precision')
assert.equal(profile.get('messages.value[0].sender'), '456', 'actual history uid must identify outgoing messages as mine')
assert.equal(profile.get('messages.value[1].sender'), '123', 'actual history uid must identify incoming messages')
profile.get("messageText.value = '保留草稿'")
await profile.get('sendMessage()')
assert.equal(profile.get('messageText.value'), '保留草稿')
assert.match(profile.get('messageError.value'), /需要对方关注/)
sendFails = false
await profile.get('sendMessage()')
assert.equal(profile.get('messageText.value'), '')
profile.get("qrInput.value = 'key-123'")
await profile.get('authorize()')
assert.equal(profile.get('qrAuthorized.value'), false, 'status success without authorized must not claim authorization')
pendingHistory = deferred()
const oldRequest = profile.get('loadMessages()')
profile.hooks.deactivated()
pendingHistory.resolve({ data: { list: [{ msgid: '99', message: { alert: '旧结果' } }] } })
await oldRequest
assert.equal(profile.get('messages.value.length'), 2, 'inactive page must ignore old responses')
console.log('account/social checks passed: QQ session, cancellation, profile payloads, relations, chat order/drafts, authorization')
