import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const context = createContext({ console })
const requests = []
const readOptions = []
let responder = async () => ({})
const plain = value => JSON.parse(JSON.stringify(value))

const baseModule = new SyntheticModule(['post', 'get', 'getById', 'getWithPagination', 'operationRequest'], function setBaseExports() {
  this.setExport('post', (url, data) => { requests.push({ url, data }); return responder(url, data) })
  this.setExport('get', (url, params, autoTimestamp = false) => {
    requests.push({ url, params })
    readOptions.push({ url, autoTimestamp })
    return responder(url, params, autoTimestamp)
  })
  this.setExport('getById', () => Promise.resolve({}))
  this.setExport('getWithPagination', () => Promise.resolve({}))
  this.setExport('operationRequest', () => Promise.resolve({}))
}, { context, identifier: 'mock:base' })

const paramsModule = new SyntheticModule(['buildIdWithTimestamp', 'buildOperationParams', 'buildPaginationParams'], function setParamsExports() {
  this.setExport('buildIdWithTimestamp', value => value)
  this.setExport('buildOperationParams', value => value)
  this.setExport('buildPaginationParams', value => value)
}, { context, identifier: 'mock:params' })

const lyricModule = new SyntheticModule(['normalizeKugouKrcLyric'], function setLyricExports() {
  this.setExport('normalizeKugouKrcLyric', value => value)
}, { context, identifier: 'mock:lyric' })

const lyricPreferenceModule = new SyntheticModule(['findRememberedLyricCandidate', 'rememberLyricCandidate'], function setPreferenceExports() {
  this.setExport('findRememberedLyricCandidate', () => null)
  this.setExport('rememberLyricCandidate', () => {})
}, { context, identifier: 'mock:lyric-preference' })

const commentRepliesPath = resolve('src/utils/commentReplies.js')
const commentRepliesModule = new SourceTextModule(await readFile(commentRepliesPath, 'utf8'), { context, identifier: commentRepliesPath })
await commentRepliesModule.link(() => {
  throw new Error('commentReplies.js must not import other modules')
})
await commentRepliesModule.evaluate()

const songPath = resolve('src/api/song.js')
const songModule = new SourceTextModule(await readFile(songPath, 'utf8'), { context, identifier: songPath })
await songModule.link(specifier => {
  if (specifier === './base') return baseModule
  if (specifier === './params') return paramsModule
  if (specifier === '../utils/kugouLyric') return lyricModule
  if (specifier === '../utils/lyricPreference') return lyricPreferenceModule
  if (specifier === '../utils/commentReplies') return commentRepliesModule
  throw new Error(`Unexpected import: ${specifier}`)
})
await songModule.evaluate()

const {
  getMusicCommentCount,
  getMusicCommentFloor,
  getMusicCommentsByClassify,
  getMusicCommentsByHotword,
  getMusicCommentsNew,
} = songModule.namespace
const hash = '98eb07ad8eaf74bf56dece55518ad63e'
responder = async () => ({ [hash]: 21125 })
assert.equal((await getMusicCommentCount(hash)).total, 21125)
assert.deepEqual(plain(requests.at(-1)), { url: '/comment/count', params: { hash } })

responder = async () => ({
  status: 1,
  err_code: 0,
  count: 45,
  current_page: 2,
  maxPage: 3,
  childrenid: '100285259',
  classify_list: [{ id: 12, label: '有图', cnt: 7, icon: 'category.png' }],
  hot_word_list: [{ content: '生活', count: 5 }],
  list: [{
    id: 101,
    content: '测试评论',
    addtime: '2024-04-28 13:00:45',
    reply_num: 2,
    special_child_id: '100285259',
    album_audio_id: 302362878,
    user_id: 9,
    user_name: '测试用户',
    user_pic: 'avatar.jpg',
    like: { count: 3, haslike: true },
    images: [{ url: 'comment.jpg', width: 800, height: 600, label: '图片' }],
  }],
})
const commentsResult = await getMusicCommentsNew({ id: 302362878, pageSize: 20, pageNo: 2 })
assert.deepEqual(plain(requests.at(-1)), {
  url: '/comment/music',
  params: { mixsongid: 302362878, page: 2, pagesize: 20, show_classify: 1, show_hotword_list: 1 },
})
assert.equal(commentsResult.total, 45)
assert.equal(commentsResult.currentPage, 2)
assert.equal(commentsResult.hasMore, true)
assert.equal(commentsResult.cursor, '3')
assert.equal(commentsResult.comments[0].likedCount, 3)
assert.equal(commentsResult.comments[0].images[0].url, 'comment.jpg')
assert.deepEqual(plain(commentsResult.classifyList[0]), { id: 12, label: '有图', count: 7, icon: 'category.png' })
assert.deepEqual(plain(commentsResult.hotwordList[0]), { content: '生活', count: 5 })

responder = async () => ({ count: 1, current_page: 1, list: [{ id: 102, content: '分类评论' }] })
await getMusicCommentsByClassify({ id: 302362878, type_id: 12, page: 2, pagesize: 10, sort: 2 })
assert.deepEqual(plain(requests.at(-1)), {
  url: '/comment/music/classify',
  params: { mixsongid: 302362878, type_id: 12, page: 2, pagesize: 10, sort: 2 },
})

responder = async () => ({ count: 1, current_page: 1, list: [{ id: 103, content: '热词评论' }] })
await getMusicCommentsByHotword({ id: 302362878, hot_word: '生活', page: 3, pagesize: 10 })
assert.deepEqual(plain(requests.at(-1)), {
  url: '/comment/music/hotword',
  params: { mixsongid: 302362878, hot_word: '生活', page: 3, pagesize: 10 },
})

responder = async () => ({
  comments_num: 24,
  current_page: 2,
  list: Array.from({ length: 5 }, (_, index) => ({ id: 200 + index, content: `回复${index}` })),
})
const floorResult = await getMusicCommentFloor({
  id: { mixsongid: 302362878, special_child_id: '100285259' },
  parentCommentId: 1016353987,
  limit: 5,
  page: 2,
})
assert.deepEqual(plain(requests.at(-1)), {
  url: '/comment/floor',
  params: { mixsongid: 302362878, special_id: '100285259', tid: 1016353987, page: 2, pagesize: 5 },
})
assert.equal(floorResult.data.totalCount, 24)
assert.equal(floorResult.data.hasMore, true)
assert.equal(floorResult.data.nextPage, 3)
for (const url of ['/comment/music', '/comment/music/classify', '/comment/music/hotword', '/comment/floor']) {
  assert.equal(readOptions.findLast(read => read.url === url).autoTimestamp, true, `${url} must bypass stale API cache`)
}
console.log('comment API check passed')

responder = async () => ({ status: 1 })
await songModule.namespace.postMusicComment({ id: 123, content: ' hello ' })
assert.deepEqual(plain(requests.at(-1)), { url: '/comment/music/send', data: { mixsongid: 123, content: 'hello' } })
await songModule.namespace.postMusicComment({ id: 123, content: 'reply', commentId: 9, special_id: 12, tid: 8, pid: 9 })
assert.equal(requests.at(-1).url, '/comment/floor/send')
assert.equal(requests.at(-1).data.tid, 8)
assert.equal(requests.at(-1).data.pid, 9)
assert.equal(requests.at(-1).data.is_t, 0)
await songModule.namespace.postMusicComment({ id: 123, content: 'reply', commentId: 8, special_id: 12, tid: 8, pid: 0, is_t: 1 })
assert.equal(requests.at(-1).data.is_t, 0)
assert.throws(() => songModule.namespace.postMusicComment({ id: 123, content: 'reply', commentId: 9 }), /回复需要/)
for (const commentId of [0, '', 'bad', -1]) {
  const requestCount = requests.length
  assert.throws(() => songModule.namespace.postMusicComment({ id: 123, content: 'reply', commentId, special_id: 12, tid: 8 }), /有效的目标评论/)
  assert.equal(requests.length, requestCount)
}
assert.throws(() => songModule.namespace.postMusicComment({ id: 123, content: 'reply', tid: 8, special_id: 12 }), /有效的目标评论/)
assert.throws(() => songModule.namespace.postMusicComment({ id: 123, content: 'reply', commentId: 9, tid: 'bad', special_id: 12 }), /顶层评论/)
await songModule.namespace.deleteMusicComment({ mixsongid: 123, cid: 9, tid: 8 })
assert.deepEqual(plain(requests.at(-1)), { url: '/comment/music/del', data: { mixsongid: 123, cid: 9, tid: 8 } })
console.log('comment mutations check passed')

// 执行真实评论组件和 API，验证回复保留原楼层并刷新楼层接口。
const componentSource = (await readFile('src/components/Comments.vue', 'utf8')).match(/<script setup>([\s\S]*?)<\/script>/)[1]
const notices = []
let confirmDeletion
const playerState = { songId: { value: 123 }, songList: { value: [{ id: 123 }] }, currentIndex: { value: 0 }, listInfo: { value: {} } }
const componentMocks = {
  vue: { ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }), watch() {}, onMounted() {}, onUnmounted() {}, nextTick: async callback => callback?.() },
  pinia: { storeToRefs: value => value },
  '../store/playerStore': { usePlayerStore: () => playerState },
  '../store/userStore': { useUserStore: () => ({ user: { userId: 42 } }) },
  '../utils/dialog': { noticeOpen: message => notices.push(message), dialogOpen: (_title, _message, handler) => { confirmDeletion = handler } },
  '../utils/commentScrollMemory': { getCommentScrollPosition() {}, setCommentScrollPosition() {}, getLastCommentTargetKey() {}, setLastCommentTargetKey() {} },
  '../api/dj': { getDjProgramCommentsNew() {}, getDjProgramCommentFloor() {}, postDjProgramComment() {}, likeDjProgramComment() {} },
  './CommentText.vue': { default: {} },
  './CommentVerification.vue': { default: {} },
}
context.defineEmits = () => () => {}
context.document = { querySelector: () => null }
const commentsComponent = new SourceTextModule(componentSource + '\nexport { comments, newComment, replyingTo, floorReplies, toggleReply, submitComment, resolveReplyRootCommentId, toggleFloorReplies, getVisibleFloorReplies, removeComment };', { context })
await commentsComponent.link(name => {
  if (name === '../api/song') return songModule
  if (name === '../utils/commentReplies') return commentRepliesModule
  const exports = componentMocks[name]
  assert.ok(exports, `Unexpected component import: ${name}`)
  return new SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
  }, { context })
})
await commentsComponent.evaluate()
const component = commentsComponent.namespace
const root = { commentId: 8, content: 'original', special_child_id: 12, user: { nickname: 'original author' }, showFloorComment: { replyCount: 0 } }
component.comments.value = [root]
responder = async url => url === '/comment/floor'
  ? { status: 1, comments_num: 1, list: [{ id: 9, tid: 8, pid: 0, content: 'reply//@original author:original', puser_id: 7 }] }
  : { status: 1 }
component.toggleReply(root)
component.newComment.value = 'reply'
let replyRequestStart = requests.length
await component.submitComment()
assert.deepEqual(requests.slice(replyRequestStart).map(request => request.url), ['/comment/floor/send', '/comment/floor'])
assert.equal(requests[replyRequestStart].data.tid, 8)
assert.equal(requests[replyRequestStart].data.pid, 0)
assert.equal(requests[replyRequestStart].data.is_t, 0)
assert.equal(requests[replyRequestStart + 1].params.pagesize, 30)
assert.equal(component.comments.value[0], root)
assert.equal(component.floorReplies.value['8'].expanded, true)
assert.equal(component.floorReplies.value['8'].items[0].rootCommentId, 8)
assert.equal(root.showFloorComment.replyCount, 1)
assert.equal(notices.at(-1), '回复发送成功')
const child = component.floorReplies.value['8'].items[0]
assert.equal(component.resolveReplyRootCommentId({ ...child, parentCommentId: 99 }), 8)
component.toggleReply(child)
component.newComment.value = 'nested reply'
replyRequestStart = requests.length
await component.submitComment()
assert.equal(requests[replyRequestStart].data.tid, 8)
assert.equal(requests[replyRequestStart].data.pid, 9)
assert.equal(requests[replyRequestStart].data.is_t, 0)
assert.equal(requests[replyRequestStart].data.special_id, 12)
assert.equal(component.comments.value[0], root)

// 此楼层的真实记录结构：旧回复在前，新回复在第 17、18 条。
const toyouRoot = { commentId: 374305268, content: '歌词上传完成，辛苦熬夜打的👍', special_child_id: '22357329', user: { userId: 594987594, nickname: 'Toyou-Ghoul' }, showFloorComment: { replyCount: 20 } }
const floorRecords = Array.from({ length: 20 }, (_, index) => ({ id: 1000 + index, user_id: 100 + index, content: 'existing reply', tid: 374305268, pid: 0 }))
for (const [index, id] of [[16, 633107608], [17, 633106726]]) {
  floorRecords[index] = { id, user_id: 598130887, user_name: '蒲公英的约定', content: '辛苦了//@Toyou-Ghoul:歌词上传完成，辛苦熬夜打的👍', tid: 374305268, pid: 0, puser_id: '594987594', is_reply: 1 }
}
responder = async () => ({ status: 1, comments_num: 20, current_page: 1, list: floorRecords.slice(0, requests.at(-1).params.pagesize) })
await component.toggleFloorReplies(toyouRoot)
const visibleReplies = component.getVisibleFloorReplies(toyouRoot)
assert.deepEqual(plain(visibleReplies.filter(node => node.comment.user.userId === 598130887).map(node => [node.comment.commentId, node.comment.content, node.depth])), [[633107608, '辛苦了', 0], [633106726, '辛苦了', 0]])
assert.equal(component.floorReplies.value['374305268'].hasMore, false)

responder = async () => ({ status: 0, ssaCode: 'reply-event' })
component.toggleReply(root)
component.newComment.value = 'preserved reply'
await component.submitComment()
assert.equal(component.replyingTo.value.commentId, 8)
assert.equal(component.newComment.value, 'preserved reply')
assert.equal(component.comments.value[0], root)
console.log('comment reply flow check passed')

// 删除成功后，未绕过缓存的读取会返回旧评论，必须使用新数据。
const ownComment = { commentId: 1771115180, user: { userId: 42 }, content: '辛苦了' }
component.comments.value = [ownComment]
const deletionStart = requests.length
responder = async (url, _params, fresh) => url === '/comment/music'
  ? { status: 1, count: fresh ? 0 : 1, list: fresh ? [] : [{ id: ownComment.commentId, user_id: 42, content: '辛苦了' }] }
  : { status: 1 }
component.removeComment(ownComment)
await confirmDeletion(true)
assert.deepEqual(requests.slice(deletionStart).map(request => request.url), ['/comment/music/del', '/comment/music'])
assert.equal(component.comments.value.length, 0)
assert.equal(notices.at(-1), '评论已删除')
console.log('comment deletion refresh check passed')

const challenge = { eventid: 'test-event', sid: 'test-sid', edt: 'test-edt' }
assert.deepEqual(plain(songModule.namespace.getCommentSecurityChallenge({ response: { data: {
  status: 0, err_code: 60045, ssaCode: challenge.eventid, sid: challenge.sid, edt: challenge.edt,
} } })), challenge)
assert.deepEqual(plain(songModule.namespace.getCommentSecurityChallenge({ data: { event_id: 'test-event' }, sid: 'test-sid', edt: 'test-edt' })), challenge)
assert.equal(songModule.namespace.getCommentSecurityChallenge({ status: 0, err_code: 60045, msg: '发布失败' }), null)
await songModule.namespace.getCommentVerificationInfo(challenge.eventid)
assert.equal(requests.at(-1).url, '/get/verify/info')
await songModule.namespace.verifyCommentSecurity({ ...challenge, v_type: 23, verifycode: 'ticket' })
assert.deepEqual(plain(requests.at(-1)), { url: '/verify/user/info', data: { ...challenge, v_type: 23, verifycode: 'ticket' } })
assert.throws(() => songModule.namespace.verifyCommentSecurity({ ...challenge, v_type: 1, verifycode: 'ticket' }), /安全验证/)
assert.throws(() => songModule.namespace.verifyCommentSecurity({ ...challenge, v_type: 23 }), /安全验证/)
console.log('comment verification API check passed')

// 执行真实 Vue 组件脚本，模拟验证码和后端；不发布真实评论。
const verificationSource = (await readFile('src/components/CommentVerification.vue', 'utf8')).match(/<script setup>([\s\S]*?)<\/script>/)[1]
assert.doesNotMatch(await readFile('src/components/CommentVerification.vue', 'utf8'), /<style|Teleport|verification-overlay/)
async function mountVerification({ type = 23, sdk = true } = {}) {
  let dispose, callback
  const events = []
  const calls = []
  const prompts = []
  let verificationResult = { status: 1 }
  let destroyed = 0
  const verificationContext = createContext({
    console, setTimeout, clearTimeout,
    defineProps: () => ({ challenge }),
    defineEmits: () => event => events.push(event),
    window: sdk ? { TencentCaptcha: class {
      constructor(appid, cb) { assert.equal(appid, '123'); callback = cb }
      show() {}
      destroy() { destroyed++ }
    } } : {},
    document: { createElement: () => ({ remove() {} }), head: { appendChild: script => script.onerror() } },
  })
  const vue = new SyntheticModule(['ref', 'onBeforeUnmount'], function () {
    this.setExport('ref', value => ({ value }))
    this.setExport('onBeforeUnmount', handler => { dispose = handler })
  }, { context: verificationContext })
  const dialogs = new SyntheticModule(['dialogOpen'], function () {
    this.setExport('dialogOpen', (title, text, handler, input) => {
      const prompt = { title, text, handler, input, closed: false }
      prompts.push(prompt)
      return () => { prompt.closed = true }
    })
  }, { context: verificationContext })
  const api = new SyntheticModule(['getCommentVerificationInfo', 'verifyCommentSecurity'], function () {
    this.setExport('getCommentVerificationInfo', async eventid => {
      assert.equal(eventid, challenge.eventid)
      return { status: 1, data: { v_type: type, txappid: 123 } }
    })
    this.setExport('verifyCommentSecurity', async params => { calls.push(plain(params)); return verificationResult })
  }, { context: verificationContext })
  const component = new SourceTextModule(verificationSource + '\nexport { startVerification, submitVerification, busy, error, info };', { context: verificationContext })
  await component.link(name => name === 'vue' ? vue : name === '../utils/dialog' ? dialogs : api)
  await component.evaluate()
  return { state: component.namespace, events, calls, prompts, dispose: () => dispose(),
    callback: async value => { callback(value); await new Promise(resolve => setTimeout(resolve, 0)) },
    setResult: value => { verificationResult = value }, destroyed: () => destroyed }
}

const verification = await mountVerification()
assert.equal(verification.prompts[0].title, '安全验证')
assert.match(verification.prompts[0].text, /草稿已保留/)
const cancelled = await mountVerification()
cancelled.prompts[0].handler(false)
assert.deepEqual(cancelled.events, ['retry'])
assert.equal(cancelled.calls.length, 0)
cancelled.dispose()
await verification.state.startVerification()
assert.equal(verification.state.busy.value, true)
await verification.callback({ ret: 2 })
assert.match(verification.state.error.value, /取消/)
assert.equal(verification.calls.length, 0)
assert.equal(verification.state.busy.value, false)
await verification.state.startVerification()
await verification.callback({ ret: 0, errorCode: 1001, ticket: 'trerror_test', randstr: 'test' })
assert.equal(verification.calls.length, 0)
verification.setResult({ status: 0, msg: '验证已过期' })
await verification.state.startVerification()
await verification.callback({ ret: 0, ticket: 'test-ticket', randstr: 'test-randstr' })
assert.equal(verification.events.length, 0)
assert.equal(verification.state.error.value, '验证已过期')
verification.setResult({ status: 1 })
await verification.state.startVerification()
await verification.callback({ ret: 0, ticket: 'test-ticket', randstr: 'test-randstr' })
assert.deepEqual(verification.events, ['verified'])
assert.deepEqual(verification.calls.at(-1), { ...challenge, v_type: 23,
  verifycode: 'KGCodeTX|{"ticket":"test-ticket","randstr":"test-randstr","txappid":"123"}' })
verification.dispose()
const previousCalls = verification.calls.length
await verification.callback({ ret: 0, ticket: 'stale-ticket', randstr: 'test' })
assert.equal(verification.calls.length, previousCalls)
assert.ok(verification.destroyed() > 0)
assert.equal(verification.prompts.at(-1).closed, true)
const sms = await mountVerification({ type: 32 })
await sms.state.startVerification()
assert.equal(sms.state.busy.value, false)
assert.equal(sms.calls.length, 0)
assert.equal(sms.prompts.at(-1).input.label, '手机验证码')
sms.prompts.at(-1).handler(true, '123456')
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(sms.calls[0], { ...challenge, v_type: 32, verifycode: '123456' })
assert.deepEqual(sms.events, ['verified'])
const pending = await mountVerification({ type: 32 })
await pending.state.startVerification()
let finishPending
pending.setResult(new Promise(resolve => { finishPending = resolve }))
const pendingRequest = pending.state.submitVerification('123456')
pending.dispose()
finishPending({ status: 1 })
await pendingRequest
assert.equal(pending.events.length, 0)
const unsupported = await mountVerification({ type: 99 })
await unsupported.state.startVerification()
assert.match(unsupported.state.error.value, /暂不支持/)
assert.equal(unsupported.state.busy.value, false)
const unavailable = await mountVerification({ sdk: false })
await unavailable.state.startVerification()
assert.match(unavailable.state.error.value, /加载失败/)
assert.equal(unavailable.state.busy.value, false)
assert.equal(unavailable.events.length, 0)
console.log('comment verification flow check passed')

const dialogState = Object.fromEntries(['dialogShow', 'dialogHeader', 'dialogText', 'dialogInput'].map(key => [key, { value: null }]))
const otherStore = new SyntheticModule(['useOtherStore'], function () {
  this.setExport('useOtherStore', () => dialogState)
}, { context })
const piniaMock = new SyntheticModule(['storeToRefs'], function () {
  this.setExport('storeToRefs', value => value)
}, { context })
const dialogModule = new SourceTextModule(await readFile('src/utils/dialog.js', 'utf8'), { context })
await dialogModule.link(name => name === 'pinia' ? piniaMock : otherStore)
await dialogModule.evaluate()
const dialogs = dialogModule.namespace
dialogs.dialogOpen('first', 'first', confirmed => {
  if (confirmed) dialogs.dialogOpen('second', 'second', () => {})
})
dialogs.dialogConfirm()
assert.equal(dialogState.dialogShow.value, true)
assert.equal(dialogState.dialogHeader.value, 'second')
const closeOld = dialogs.dialogOpen('old', 'old', () => {})
dialogs.dialogOpen('current', 'current', () => {})
closeOld()
assert.equal(dialogState.dialogShow.value, true)
let smsResult = null
dialogs.dialogOpen('SMS', 'code', (confirmed, code) => { smsResult = [confirmed, code] }, { label: '手机验证码' })
dialogs.dialogConfirm()
assert.equal(smsResult, null)
dialogState.dialogInput.value.value = ' 123456 '
dialogs.dialogConfirm()
assert.deepEqual(smsResult, [true, '123456'])
assert.equal(dialogState.dialogShow.value, false)
assert.equal(dialogState.dialogInput.value, null)
dialogs.dialogOpen('cancel', 'cancel', confirmed => { assert.equal(confirmed, false) })
dialogs.dialogCancel()
assert.equal(dialogState.dialogShow.value, false)
dialogs.dialogConfirm() // 已关闭的弹窗不再次触发回调。
console.log('shared dialog check passed')
