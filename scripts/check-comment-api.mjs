import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm'

const context = createContext({ console })
const requests = []
let responder = async () => ({})
const plain = value => JSON.parse(JSON.stringify(value))

const baseModule = new SyntheticModule(['get', 'getById', 'getWithPagination', 'operationRequest'], function setBaseExports() {
  this.setExport('get', (url, params) => {
    requests.push({ url, params })
    return responder(url, params)
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
const { buildCommentReplyTree, parseCommentReply } = commentRepliesModule.namespace

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
  list: [
    { id: 200, user_id: 2, user_name: '乙', puser_id: 1, content: '第一层回复//@甲:楼主原文' },
    { id: 201, user_id: 3, user_name: '丙', puser_id: 2, content: '第二层回复//@乙:第一层回复' },
    ...Array.from({ length: 3 }, (_, index) => ({ id: 202 + index, content: `回复${index + 2}` })),
  ],
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
assert.equal(floorResult.data.comments[0].content, '第一层回复')
assert.deepEqual(plain(floorResult.data.comments[1].replyTo), { userId: 2, userName: '乙', content: '第一层回复' })

assert.deepEqual(plain(parseCommentReply('回答内容//@用户:被回复原文')), {
  content: '回答内容',
  replyTo: { userId: '', userName: '用户', content: '被回复原文' },
})
const replyTree = buildCommentReplyTree(floorResult.data.comments.slice(0, 2), {
  commentId: 100,
  content: '楼主原文',
  user: { userId: 1, nickname: '甲' },
})
assert.equal(replyTree.length, 1)
assert.equal(replyTree[0].comment.commentId, 200)
assert.equal(replyTree[0].children[0].comment.commentId, 201)
assert.equal(replyTree[0].descendantCount, 1)

const partialReplyTree = buildCommentReplyTree(floorResult.data.comments.slice(1, 2), {
  commentId: 100,
  content: '楼主原文',
  user: { userId: 1, nickname: '甲' },
})
assert.equal(partialReplyTree[0].comment.referenceOnly, true)
assert.equal(partialReplyTree[0].comment.content, '第一层回复')
assert.equal(partialReplyTree[0].children[0].comment.commentId, 201)

console.log('comment API check passed')
