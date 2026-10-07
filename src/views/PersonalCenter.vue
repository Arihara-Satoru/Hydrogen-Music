<script setup>
import { computed, onActivated, onDeactivated, onUnmounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '../store/userStore'
import { getPersonalProfile, getUserProfile, updatePersonalProfile, updateAvatar, getUserRelations,
  followUser, getPrivateMessages, sendPrivateMessage, extractPurchasedItems } from '../api/user'
import { authorizeQRcode } from '../api/login'
import { normalizeUserProfile } from '../utils/accountSession'
import { getCookie, isLogin } from '../utils/authority'
import { resolveImageUrl } from '../utils/imageUtils'

const router = useRouter()
const userStore = useUserStore()
const form = reactive({ nickname: '', sex: '2', birthday: '', signature: '', province: '', city: '' })
const original = ref({})
const profileLoading = ref(false)
const busy = ref(false)
const feedback = ref('')
const error = ref('')
const tab = ref('follow')
const tabs = { follow: '关注', friends: '好友', fans: '粉丝', messages: '私信', authorize: '设备授权' }
const people = ref([])
const listLoading = ref(false)
const listError = ref('')
const targetId = ref('')
const selectedName = ref('')
const messages = ref([])
const messageText = ref('')
const messageLoading = ref(false)
const messageError = ref('')
const messageTip = ref('')
const oldestId = ref(0)
const hasOlder = ref(false)
const qrInput = ref('')
const qrAuthorized = ref(false)
let epoch = 0
let listGeneration = 0
let chatGeneration = 0
let active = false
const selfId = computed(() => String(userStore.user?.userId || ''))
const today = new Date().toLocaleDateString('sv-SE')
const validTarget = computed(() => /^[1-9]\d*$/.test(targetId.value.trim()) && targetId.value.trim() !== selfId.value)
const avatar = computed(() => userStore.user?.avatarUrl ? resolveImageUrl(userStore.user.avatarUrl) : '')
const accountKey = () => getCookie('userid')
const isCurrent = (version, account) => active && version === epoch && isLogin() && account === accountKey()

function fillForm(profile) {
  Object.assign(form, {
    nickname: profile.nickname || '', sex: String(profile.sex ?? 2),
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(profile.birthdayText) ? profile.birthdayText : '',
    signature: profile.signature || '', province: profile.province || '', city: profile.city || '',
  })
  original.value = { ...form }
}

async function loadProfile() {
  const version = epoch, account = accountKey()
  profileLoading.value = true
  error.value = ''
  try {
    const [detail, personal] = await Promise.all([getUserProfile(), getPersonalProfile()])
    if (!isCurrent(version, account)) return
    const raw = personal?.data?.userinfo || personal?.data?.info || personal?.data || {}
    const profile = normalizeUserProfile({ data: { ...detail?.data, ...raw } })
    userStore.updateUser(profile)
    fillForm(profile)
  } catch (cause) {
    if (isCurrent(version, account)) error.value = cause?.message || '个人资料加载失败，请重试'
  } finally {
    if (isCurrent(version, account)) profileLoading.value = false
  }
}

async function saveProfile() {
  if (busy.value || profileLoading.value) return
  const data = Object.fromEntries(Object.entries(form).filter(([key, value]) => value !== original.value[key]))
  if (!Object.keys(data).length) { feedback.value = '资料没有变化'; return }
  if ('nickname' in data && !data.nickname.trim()) { error.value = '昵称不能为空'; return }
  if (data.birthday && data.birthday > today) { error.value = '生日不能晚于今天'; return }
  const version = epoch, account = accountKey()
  busy.value = true
  error.value = feedback.value = ''
  try {
    await updatePersonalProfile(data)
    if (!isCurrent(version, account)) return
    userStore.updateUser(normalizeUserProfile({ data: { ...userStore.user, ...data, birthdayText: form.birthday,
      description: form.signature, location: [form.province, form.city].filter(Boolean).join(' ') } }))
    original.value = { ...form }
    feedback.value = '个人资料已保存'
  } catch (cause) {
    if (isCurrent(version, account)) error.value = cause?.message || '保存失败，请重试'
  } finally {
    if (isCurrent(version, account)) busy.value = false
  }
}

async function uploadAvatar(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || busy.value) return
  if (!['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
    error.value = '请选择不超过 5 MB 的 JPEG、PNG、GIF、BMP 或 WEBP 图片'; return
  }
  const version = epoch, account = accountKey()
  busy.value = true
  error.value = feedback.value = ''
  try {
    const imgFile = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('图片读取失败'))
      reader.readAsDataURL(file)
    })
    if (!isCurrent(version, account)) return
    const result = await updateAvatar(imgFile, file.name)
    if (!isCurrent(version, account)) return
    const pic = result?.pic || result?.data?.pic
    if (pic) userStore.updateUser({ ...userStore.user, avatarUrl: pic, pic })
    else await loadProfile()
    feedback.value = '头像已更新'
  } catch (cause) {
    if (isCurrent(version, account)) error.value = cause?.message || '头像上传失败'
  } finally {
    if (isCurrent(version, account)) busy.value = false
  }
}

async function loadPeople() {
  if (!['follow', 'friends', 'fans'].includes(tab.value) || !active) return
  const current = ++listGeneration, version = epoch, account = accountKey(), type = tab.value
  people.value = []
  listLoading.value = true
  listError.value = ''
  try {
    const result = await getUserRelations(type)
    if (!isCurrent(version, account) || current !== listGeneration) return
    people.value = extractPurchasedItems(result, ['list', 'info', 'users', 'follow_list', 'friends_list', 'fans_list', 'friends', 'fans', 'follow']).map(person => ({
      ...person,
      id: String(person.userid || person.user_id || person.uid || person.id || person.kugouid || ''),
      name: String(person.nickname || person.k_nickname || person.nick_name || person.name || '酷狗用户'),
      avatar: person.pic || person.k_pic || person.avatar || person.avatarUrl || '',
      followed: type !== 'fans' || Number(person.is_follow ?? person.follow ?? person.is_friend) === 1,
    })).filter(person => /^[1-9]\d*$/.test(person.id))
  } catch (cause) {
    if (isCurrent(version, account) && current === listGeneration) listError.value = cause?.message || '列表加载失败'
  } finally {
    if (isCurrent(version, account) && current === listGeneration) listLoading.value = false
  }
}

async function changeFollow(id, follow) {
  if (busy.value || String(id) === selfId.value) return
  const version = epoch, account = accountKey()
  busy.value = true
  error.value = feedback.value = ''
  try {
    await followUser(id, follow)
    if (!isCurrent(version, account)) return
    feedback.value = follow ? '已关注该用户' : '已取消关注'
    await loadPeople()
  } catch (cause) {
    if (isCurrent(version, account)) error.value = cause?.message || '关注操作失败'
  } finally {
    if (isCurrent(version, account)) busy.value = false
  }
}

function openChat(person) {
  targetId.value = person.id
  selectedName.value = person.name
  tab.value = 'messages'
  void loadMessages()
}

async function loadMessages(older = false) {
  if (!validTarget.value || !active) return
  const current = ++chatGeneration, version = epoch, account = accountKey(), id = targetId.value.trim()
  const cursor = older ? oldestId.value : 0
  messageLoading.value = true
  messageError.value = ''
  try {
    const result = await getPrivateMessages(id, cursor, selfId.value)
    if (!isCurrent(version, account) || current !== chatGeneration || id !== targetId.value.trim()) return
    const items = extractPurchasedItems(result, ['messages', 'msglist', 'msg_list', 'list', 'info']).map(item => {
      let content = item.message || item.content || item.msg || item
      if (typeof content === 'string') { try { content = JSON.parse(content) } catch { content = { alert: content } } }
      if (!content || typeof content !== 'object' || Array.isArray(content)) content = { alert: '[暂不支持的消息]' }
      return { ...item, content, id: item.msgid ?? item.id, sender: String(item.fromuid ?? item.from_userid ?? item.sender ?? item.uid ?? item.userid ?? content?.userid ?? '') }
    })
    const merged = older ? [...messages.value, ...items] : items
    messages.value = [...new Map(merged.map(item => [item.id == null ? item : String(item.id), item])).values()]
      .sort((a, b) => /^\d+$/.test(String(a.id)) && /^\d+$/.test(String(b.id)) ? (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0) : 0)
    const ids = items.map(item => String(item.id)).filter(id => /^\d+$/.test(id))
    oldestId.value = result?.data?.maxid ?? ids.reduce((min, id) => !min || BigInt(id) < BigInt(min) ? id : min, '')
    hasOlder.value = items.length >= 30 && /^\d+$/.test(String(oldestId.value)) && BigInt(oldestId.value) > BigInt(0) && String(oldestId.value) !== String(cursor)
  } catch (cause) {
    if (isCurrent(version, account) && current === chatGeneration) messageError.value = cause?.message || '私信加载失败'
  } finally {
    if (isCurrent(version, account) && current === chatGeneration) messageLoading.value = false
  }
}

async function sendMessage() {
  if (!validTarget.value || !messageText.value.trim() || busy.value) return
  const version = epoch, account = accountKey(), id = targetId.value.trim(), text = messageText.value.trim()
  busy.value = true
  messageError.value = ''
  try {
    const result = await sendPrivateMessage(id, text, userStore.user?.nickname)
    if (!isCurrent(version, account) || id !== targetId.value.trim()) return
    messageText.value = ''
    messageTip.value = result?.tip_content || result?.data?.tip_content || '私信已发送'
    await loadMessages()
  } catch (cause) {
    if (isCurrent(version, account)) messageError.value = cause?.message || '发送失败，草稿已保留'
  } finally {
    if (isCurrent(version, account)) busy.value = false
  }
}

async function authorize() {
  if (busy.value) return
  let key = qrInput.value.trim()
  try { const url = new URL(key); key = url.searchParams.get('qrcode') || url.searchParams.get('key') || '' } catch { /* Raw keys are accepted. */ }
  const version = epoch, account = accountKey()
  busy.value = true
  error.value = feedback.value = ''
  qrAuthorized.value = false
  try {
    const result = await authorizeQRcode(key)
    if (!isCurrent(version, account)) return
    if (result?.data?.authorized !== true) throw new Error(result?.msg || '授权未完成，请确认二维码仍有效')
    qrAuthorized.value = true
    qrInput.value = ''
    feedback.value = '已授权其他设备登录'
  } catch (cause) {
    if (isCurrent(version, account)) error.value = cause?.message || '二维码授权失败'
  } finally {
    if (isCurrent(version, account)) busy.value = false
  }
}

watch(tab, () => { listGeneration++; listLoading.value = false; listError.value = ''; error.value = feedback.value = ''; void loadPeople() }, { flush: 'sync' })
watch(targetId, () => {
  selectedName.value = ''
  chatGeneration++; messages.value = []; messageLoading.value = false; messageError.value = messageTip.value = ''; oldestId.value = 0; hasOlder.value = false
}, { flush: 'sync' })
function deactivate() { active = false; epoch++; listGeneration++; chatGeneration++ }
onActivated(() => {
  active = true
  epoch++
  busy.value = false
  if (!isLogin()) { void router.replace('/login'); return }
  feedback.value = error.value = ''
  targetId.value = messageText.value = selectedName.value = qrInput.value = ''
  messages.value = people.value = []
  fillForm(userStore.user || {})
  void loadProfile()
  void loadPeople()
})
watch(() => userStore.user?.userId, id => { if (active && !id && !isLogin()) { deactivate(); void router.replace('/login') } })
onDeactivated(deactivate)
onUnmounted(deactivate)
</script>

<template>
  <div class="personal-center">
    <header><div><p class="eyebrow">ACCOUNT</p><h1>个人中心</h1></div><button class="back-button" @click="router.back()">返回</button></header>
    <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="columns">
      <section class="profile-panel" aria-label="个人资料">
        <div class="identity"><img v-if="avatar" :src="avatar" alt="当前头像" /><span v-else class="avatar-placeholder">{{ form.nickname.slice(0, 1) || '♪' }}</span>
          <div class="identity-info"><h2>{{ userStore.user?.nickname || '酷狗用户' }}</h2><p class="account-id">ID {{ selfId }}</p>
            <label class="upload" :class="{ disabled: busy }"><span>{{ busy ? '处理中…' : '更换头像' }}</span><input type="file" aria-label="更换头像" accept="image/jpeg,image/png,image/gif,image/bmp,image/webp" :disabled="busy" @change="uploadAvatar" /></label>
          </div></div>
        <p class="avatar-hint">JPG / PNG / GIF / BMP / WEBP · 最大 5 MB</p>
        <p v-if="profileLoading" role="status">正在加载资料…</p>
        <button v-if="error && !profileLoading" :disabled="busy" @click="loadProfile">重新加载资料</button>
        <form class="profile-form" @submit.prevent="saveProfile">
          <fieldset :disabled="busy || profileLoading"><label>昵称<input v-model="form.nickname" required maxlength="100" /></label>
          <div class="field-row"><label>性别<select v-model="form.sex"><option value="2">保密</option><option value="0">女</option><option value="1">男</option></select></label>
            <label>生日<input v-model="form.birthday" type="date" :max="today" /></label></div>
          <label>个性签名<textarea v-model="form.signature" rows="3" maxlength="500" /></label>
          <div class="field-row"><label>省份<input v-model="form.province" maxlength="50" /></label><label>城市<input v-model="form.city" maxlength="50" /></label></div>
          <button class="primary" type="submit">{{ busy ? '正在保存…' : '保存资料' }}</button></fieldset>
        </form>
      </section>
      <section class="social-panel" aria-label="用户社交">
        <nav aria-label="社交与设备授权"><button v-for="(label, key) in tabs" :key="key" :aria-pressed="tab === key" :class="{ selected: tab === key }" @click="tab = key">{{ label }}</button></nav>
        <div class="social-content">
        <template v-if="['follow', 'friends', 'fans'].includes(tab)">
          <div class="section-heading"><h2>{{ tabs[tab] }}<span v-if="!listLoading && !listError" class="count">{{ people.length }}</span></h2><button class="refresh-button" :disabled="listLoading" @click="loadPeople">{{ listLoading ? '加载中…' : '刷新列表' }}</button></div>
          <p v-if="listLoading" role="status">正在加载…</p><p v-else-if="listError" class="error" role="alert">{{ listError }}</p>
          <p v-else-if="!people.length" class="empty">暂无{{ tabs[tab] }}，可以通过用户 ID 关注或发送私信。</p>
          <ul v-else class="people"><li v-for="person in people" :key="person.id">
            <img v-if="person.avatar" :src="resolveImageUrl(person.avatar)" alt="" /><span v-else class="small-avatar">{{ person.name.slice(0, 1) }}</span>
            <div class="person-name"><strong>{{ person.name }}</strong><small>ID {{ person.id }}</small></div>
            <div v-if="person.id !== selfId" class="person-actions"><button class="relation-action" :disabled="busy" @click="changeFollow(person.id, !person.followed)">{{ person.followed ? '取消关注' : '关注' }}</button>
              <button class="message-action" :disabled="busy" @click="openChat(person)">私信</button></div>
          </li></ul>
          <form class="target-form follow-form" @submit.prevent="changeFollow(targetId.trim(), true)"><label>添加关注<input v-model="targetId" inputmode="numeric" placeholder="输入酷狗用户 ID" :disabled="busy" /></label><button class="primary" :disabled="!validTarget || busy">关注</button></form>
        </template>
        <template v-else-if="tab === 'messages'">
          <h2>{{ selectedName ? `与 ${selectedName} 的私信` : '私信' }}</h2>
          <form class="target-form" @submit.prevent="loadMessages()"><label>对方用户 ID<input v-model="targetId" inputmode="numeric" placeholder="输入酷狗用户 ID" :disabled="busy" /></label><button :disabled="!validTarget || messageLoading || busy">查看会话 / 刷新</button></form>
          <p v-if="messageError" class="error" role="alert">{{ messageError }}</p><p v-if="messageTip" class="feedback" role="status">{{ messageTip }}</p>
          <button v-if="hasOlder" :disabled="messageLoading" @click="loadMessages(true)">加载更早消息</button>
          <div class="messages" aria-label="会话记录" :aria-busy="messageLoading">
            <p v-if="messageLoading" role="status">正在加载会话…</p><p v-else-if="!messages.length" class="empty">{{ validTarget ? '暂无消息，可以发送第一条私信。' : '输入用户 ID 查看会话。' }}</p>
            <article v-for="(message, index) in messages" :key="message.id ?? index" :class="{ mine: message.sender === selfId }"><small>{{ message.sender === selfId ? '我' : (message.content.nickname || selectedName || message.sender || '对方') }}</small>
              <p>{{ message.content.alert || message.content.text || '[暂不支持的消息]' }}</p>
              <img v-if="[202, 205].includes(Number(message.content.msgtype)) && /^https?:\/\//i.test(message.content.url || '')" :src="resolveImageUrl(message.content.url)" alt="私信图片或表情" loading="lazy" />
            </article>
          </div>
          <form @submit.prevent="sendMessage"><label>私信内容<textarea v-model="messageText" rows="3" placeholder="输入消息" :disabled="busy" /></label><button class="primary" :disabled="!validTarget || !messageText.trim() || busy">{{ busy ? '正在发送…' : '发送私信' }}</button></form>
          <p class="muted">对方未关注或回复前，最多可发送 3 条打招呼消息。</p>
        </template>
        <template v-else>
          <h2>授权其他设备登录</h2><p class="authorize-description">将其他设备登录二维码中的 key 或二维码链接粘贴到下方。确认后，该设备将登录当前账号。</p>
          <form @submit.prevent="authorize"><label>二维码 key 或链接<input v-model="qrInput" required placeholder="粘贴二维码 key 或链接" :disabled="busy" /></label><button class="primary" :disabled="!qrInput.trim() || busy">{{ busy ? '正在授权…' : '确认授权该设备登录' }}</button></form>
          <p v-if="qrAuthorized" class="feedback">授权成功，请在另一设备查看登录状态。</p>
        </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.personal-center {
  --account-line: color-mix(in srgb, var(--text) 12%, transparent);
  height: 100%;
  overflow: auto;
  padding: 18px 5% 140px;
  scroll-padding-bottom: 140px;
  box-sizing: border-box;
  color: var(--text);
  text-align: left;
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
header, .columns, .personal-center > .feedback, .personal-center > .error { max-width: 1180px; margin-left: auto; margin-right: auto; }
header, .section-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
header { margin-bottom: 24px; }
.eyebrow { font: 11px Bender-Bold; letter-spacing: .2em; color: var(--muted-text); margin-bottom: 6px; }
h1 { font: 28px SourceHanSansCN-Bold; line-height: 1.3; }
h2 { font: 17px SourceHanSansCN-Bold; line-height: 1.5; }
p { line-height: 1.6; }
.columns { display: grid; grid-template-columns: 310px minmax(0, 1fr); gap: 24px; align-items: start; }
section { min-width: 0; border: 1px solid var(--account-line); border-top: 2px solid var(--text); background: var(--layer); }
.profile-panel { padding: 24px; }
.identity { display: flex; align-items: center; gap: 16px; }
.identity img, .avatar-placeholder { width: 68px; height: 68px; flex-shrink: 0; object-fit: cover; border-radius: 50%; }
.avatar-placeholder, .small-avatar { display: grid; place-items: center; background: var(--layer); border: 1px solid var(--account-line); }
.identity-info { min-width: 0; }
.identity h2 { font-size: 17px; overflow-wrap: anywhere; }
.account-id { margin: 3px 0 5px; font: 12px Bender-Bold; color: var(--muted-text); }
.upload { display: inline-flex; position: relative; padding: 2px 0; font-size: 12px; color: var(--text); border-bottom: 1px solid var(--border); cursor: pointer; }
.upload input { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; opacity: 0; cursor: pointer; }
.upload:focus-within { outline: 2px solid var(--text); outline-offset: 4px; }
.upload.disabled { opacity: .5; cursor: default; }
.avatar-hint { margin: 14px 0 22px; padding-bottom: 20px; border-bottom: 1px solid var(--account-line); font-size: 11px; color: var(--muted-text); }
form, fieldset { display: grid; gap: 14px; }
fieldset { border: 0; padding: 0; min-width: 0; }
label { display: grid; gap: 7px; font-size: 12px; color: var(--muted-text); min-width: 0; }
input, textarea, select { width: 100%; min-width: 0; box-sizing: border-box; padding: 9px 11px; border: 1px solid var(--account-line); color: var(--text); background: var(--layer); border-radius: 2px; font: inherit; font-size: 13px; line-height: 1.5; transition: border-color .15s ease, background-color .15s ease; }
input, select { min-height: 38px; }
input::placeholder, textarea::placeholder { color: var(--muted-text); }
select option { background: var(--bg); color: var(--text); }
textarea { resize: vertical; min-height: 84px; }
button { min-height: 36px; padding: 7px 14px; border: 1px solid var(--account-line); background: transparent; color: var(--text); border-radius: 2px; cursor: pointer; font: inherit; font-size: 12px; line-height: 1.5; transition: background-color .15s ease, border-color .15s ease; }
button:hover:not(:disabled) { background: var(--layer); border-color: var(--border); }
button:disabled { opacity: .4; cursor: default; }
button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; }
.primary { background: var(--text); border-color: var(--text); color: var(--bg); font-family: SourceHanSansCN-Bold; }
.primary:hover:not(:disabled) { background: var(--text); border-color: var(--text); opacity: .85; }
.profile-form .primary { margin-top: 6px; min-height: 40px; }
.field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.back-button { border: 0; padding-right: 0; color: var(--muted-text); }
.back-button:hover:not(:disabled) { background: transparent; color: var(--text); }
nav { display: flex; gap: 20px; padding: 0 24px; border-bottom: 1px solid var(--account-line); overflow-x: auto; scrollbar-width: thin; }
nav button { position: relative; flex-shrink: 0; border: 0; border-radius: 0; padding: 18px 0 16px; font-size: 14px; color: var(--muted-text); }
nav button:hover:not(:disabled) { background: transparent; color: var(--text); }
nav .selected { color: var(--text); font-family: SourceHanSansCN-Bold; }
nav .selected::after { content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px; background: var(--text); }
.social-content { padding: 24px; }
.section-heading { margin-bottom: 12px; }
.section-heading h2 { display: flex; align-items: center; gap: 10px; }
.count { font: 12px Bender-Bold; color: var(--muted-text); }
.refresh-button { border: 0; color: var(--muted-text); padding-right: 0; }
.muted { font-size: 11px; color: var(--muted-text); margin: 14px 0 0; }
.error, .feedback { margin-top: 12px; margin-bottom: 16px; padding: 10px 12px; font-size: 13px; background: var(--layer); border-left: 2px solid currentColor; }
.error { color: #b82b2b; } .feedback { color: #237552; }
.dark .personal-center .error { color: #ff9999 !important; } .dark .personal-center .feedback { color: #83d6b2 !important; }
.empty { padding: 48px 16px; font-size: 13px; line-height: 1.8; color: var(--muted-text); text-align: center; }
.people { list-style: none; padding: 0 8px 0 0; margin: 0; max-height: clamp(240px, 43vh, 440px); overflow: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.people li { display: flex; align-items: center; gap: 12px; min-height: 74px; padding: 14px 0; border-bottom: 1px solid var(--account-line); }
.people li:last-child { border-bottom: 0; }
.people img, .small-avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.person-name { flex: 1; min-width: 0; overflow-wrap: anywhere; display: grid; gap: 4px; }
.person-name strong { font: 14px SourceHanSansCN-Bold; }
small { font-size: 11px; color: var(--muted-text); }
.person-name small { font-family: Bender-Bold; }
.person-actions { display: flex; align-items: center; gap: 14px; flex-shrink: 0; }
.relation-action { border: 0; padding: 6px 0; color: var(--muted-text); }
.relation-action:hover:not(:disabled) { background: transparent; color: var(--text); }
.message-action { min-height: 32px; padding: 5px 13px; }
.target-form { grid-template-columns: minmax(0, 1fr) auto; align-items: end; margin: 18px 0; gap: 10px; }
.follow-form { margin: 20px 0 0; padding-top: 20px; border-top: 1px solid var(--account-line); }
.target-form button { min-height: 39px; }
.messages { max-height: 38vh; min-height: 200px; overflow: auto; display: flex; flex-direction: column; gap: 12px; margin: 20px 0; padding-right: 8px; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
article { background: var(--layer); border: 1px solid var(--account-line); border-radius: 2px; padding: 12px 16px; max-width: 85%; align-self: flex-start; overflow-wrap: anywhere; }
article.mine { align-self: flex-end; border-color: var(--border); }
article p { white-space: pre-wrap; font-size: 13px; margin-top: 5px; }
article img { max-width: 100%; max-height: 220px; object-fit: contain; margin-top: 8px; }
.authorize-description { margin: 12px 0 24px; max-width: 48ch; color: var(--muted-text); font-size: 13px; }
.dark .personal-center section { background: var(--panel); }
.dark .personal-center :is(label, small, .eyebrow, .account-id, .avatar-hint, .count, .muted, .empty, .authorize-description) { color: var(--muted-text) !important; }
.dark .personal-center :is(input, textarea, select) { background: var(--bg) !important; }
.dark .personal-center :is(nav button, .back-button, .refresh-button, .relation-action) { background: transparent !important; color: var(--muted-text) !important; }
.dark .personal-center nav .selected,
.dark .personal-center :is(nav button, .back-button, .refresh-button, .relation-action):hover:not(:disabled) { color: var(--text) !important; }
.dark .personal-center .primary { background: var(--text) !important; color: var(--bg) !important; border-color: var(--text) !important; }
@media (max-width: 1000px) {
  .columns { grid-template-columns: 280px minmax(0, 1fr); gap: 18px; }
  .profile-panel, .social-content { padding: 20px; }
  nav { padding: 0 20px; gap: 16px; }
  .person-actions { gap: 10px; }
}
@media (max-width: 820px) {
  .personal-center { padding: 12px 16px 140px; }
  .columns { grid-template-columns: 1fr; }
  .people { max-height: 380px; }
}
@media (max-width: 480px) {
  .profile-panel, .social-content { padding: 16px; }
  nav { padding: 0 16px; gap: 16px; }
  .people li { flex-wrap: wrap; }
  .person-actions { margin-left: 54px; }
}
@media (prefers-reduced-motion: reduce) { button, input, textarea, select { transition: none; } }
</style>
