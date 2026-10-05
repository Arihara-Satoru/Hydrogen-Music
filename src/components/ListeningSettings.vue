<script setup>
import { computed, ref, watch } from 'vue'
import { useUserStore } from '../store/userStore'
import { usePlayerStore } from '../store/playerStore'
import { getListeningPreference, updateListeningPreference, getContentBlacklist, editContentBlacklist } from '../api/user'
import { recommendationTags, parseRecommendationWeights, validateRecommendationWeights, normalizeBlacklistItem } from '../utils/listeningPreference.mjs'
import { noticeOpen, dialogOpen } from '../utils/dialog'

const userStore = useUserStore()
const playerStore = usePlayerStore()
const accountKey = computed(() => String(userStore.user?.userId || userStore.user?.userid || ''))
const track = computed(() => playerStore.songList?.[playerStore.currentIndex])
const artists = computed(() => (track.value?.ar || track.value?.artists || []).filter(artist => /^[1-9]\d*$/.test(String(artist.id))))
const loading = ref(false)
const saving = ref(false)
const ready = ref(false)
const error = ref('')
const mode = ref('0')
const weights = ref({})
let preferenceSerial = 0
const label = ref('song')
const items = ref([])
const page = ref(1)
const total = ref(0)
const blacklistLoading = ref(false)
const blacklistError = ref('')
const editing = ref(false)
let blacklistSerial = 0

async function loadPreference() {
    const serial = ++preferenceSerial
    const account = accountKey.value
    loading.value = true
    ready.value = false
    error.value = ''
    try {
        const result = await getListeningPreference()
        if (serial !== preferenceSerial || account !== accountKey.value) return
        const data = result.data || {}
        weights.value = parseRecommendationWeights(data.song_lang)
        mode.value = String(data.mode || '0')
        ready.value = true
    } catch (cause) { if (serial === preferenceSerial) error.value = cause.message || '偏好加载失败' }
    finally { if (serial === preferenceSerial) loading.value = false }
}
async function savePreference() {
    if (!ready.value || saving.value) return
    const account = accountKey.value
    error.value = ''
    try {
        validateRecommendationWeights(weights.value)
        saving.value = true
        await updateListeningPreference({ mode: mode.value, song_lang: JSON.stringify(weights.value) })
        if (account === accountKey.value) noticeOpen('听歌偏好已保存', 2)
    } catch (cause) { if (account === accountKey.value) error.value = cause?.response?.data?.msg || cause.message || '保存失败' }
    finally { saving.value = false }
}
async function loadBlacklist(reset = true) {
    const serial = ++blacklistSerial
    const account = accountKey.value
    const requestedLabel = label.value
    const nextPage = reset ? 1 : page.value + 1
    blacklistLoading.value = true
    blacklistError.value = ''
    if (reset) { items.value = []; page.value = 1; total.value = 0 }
    try {
        const result = await getContentBlacklist(requestedLabel, nextPage)
        if (serial !== blacklistSerial || account !== accountKey.value) return
        const data = result.data || {}
        const list = (data.items || []).map(item => normalizeBlacklistItem(item, requestedLabel))
        items.value = reset ? list : [...items.value, ...list]
        total.value = Number(data.total) || 0
        page.value = nextPage
    } catch (cause) { if (serial === blacklistSerial) blacklistError.value = cause?.response?.data?.msg || cause.message || '黑名单加载失败' }
    finally { if (serial === blacklistSerial) blacklistLoading.value = false }
}
async function edit(data) {
    if (editing.value || !accountKey.value) return
    const account = accountKey.value
    editing.value = true
    try {
        await editContentBlacklist(data)
        if (account !== accountKey.value) return
        noticeOpen(data.isDelete ? '已取消屏蔽' : '已屏蔽，将影响推荐内容', 2)
        await loadBlacklist()
    } catch (cause) { if (account === accountKey.value) blacklistError.value = cause?.response?.data?.msg || cause.message || '操作失败' }
    finally { editing.value = false }
}
function blockCurrentSong() {
    const song = track.value
    if (!song?.hash || song.type === 'local' || song.source === 'siren') return
    const data = { label: 'song', hash: song.hash, mixsongid: song.mixsongid || song.id, name: song.name }
    const account = accountKey.value
    dialogOpen('屏蔽歌曲', `将「${song.name}」加入推荐黑名单？`, confirmed => { if (confirmed && account === accountKey.value) void edit(data) })
}
watch(label, () => { if (accountKey.value) void loadBlacklist() })
watch(accountKey, account => {
    ++preferenceSerial
    ++blacklistSerial
    weights.value = {}; mode.value = '0'; items.value = []; total.value = 0; ready.value = false
    error.value = ''; blacklistError.value = ''
    if (account) { void loadPreference(); void loadBlacklist() }
}, { immediate: true })
</script>

<template>
    <div v-if="accountKey" class="listening-settings">
        <section aria-labelledby="listening-preference-title">
            <h2 id="listening-preference-title">听歌偏好</h2>
            <p>调整酷狗推荐内容。0 屏蔽，50 默认，100 加大推荐。</p>
            <p v-if="loading" role="status">正在读取偏好…</p>
            <p v-if="error" class="error" role="alert">{{ error }} <button v-if="!ready" @click="loadPreference">重试</button></p>
            <form v-if="ready" @submit.prevent="savePreference">
                <fieldset :disabled="saving">
                    <label class="mode">推荐模式 <select @change="mode = $event.target.value"><option value="0" :selected="mode === '0'">默认</option><option value="1" :selected="mode === '1'">熟悉</option><option value="2" :selected="mode === '2'">尝鲜</option></select></label>
                    <div class="weights">
                        <label v-for="[id, name] in recommendationTags" :key="id" :for="`weight-${id}`">
                            <span>{{ name }}</span>
                            <input :id="`weight-${id}`" type="range" min="0" max="100" step="1" :value="weights[id] ?? 50" @input="weights[id] = Number($event.target.value)" />
                            <output :for="`weight-${id}`">{{ weights[id] ?? 50 }}</output>
                        </label>
                    </div>
                    <button type="submit">{{ saving ? '保存中…' : '保存听歌偏好' }}</button>
                </fieldset>
            </form>
        </section>
        <section aria-labelledby="content-blacklist-title">
            <h2 id="content-blacklist-title">内容黑名单</h2>
            <p>屏蔽的歌曲和歌手将不再出现在猜你喜欢、每日推荐等场景。</p>
            <div class="actions">
                <label>内容类型 <select v-model="label"><option value="song">歌曲</option><option value="singer">歌手</option></select></label>
                <button :disabled="blacklistLoading" @click="loadBlacklist()">刷新</button>
                <button v-if="track?.hash && track?.type !== 'local' && track?.source !== 'siren'" :disabled="editing" @click="blockCurrentSong">屏蔽当前歌曲</button>
                <button v-for="artist in artists" :key="artist.id" :disabled="editing" @click="edit({ label: 'singer', singerid: artist.id, name: artist.name })">屏蔽 {{ artist.name }}</button>
            </div>
            <p v-if="blacklistError" class="error" role="alert">{{ blacklistError }}</p>
            <p v-if="blacklistLoading" role="status">正在读取黑名单…</p>
            <p v-else-if="!blacklistError && !items.length">暂无屏蔽内容</p>
            <ul>
                <li v-for="item in items" :key="item.key">
                    <span>{{ item.name }}</span>
                    <button :disabled="editing || !item.key" @click="edit({ label, isDelete: 1, name: item.name, mixsongid: item.mixsongid, ...(label === 'song' ? { hash: item.key } : { singerid: item.key }) })">取消屏蔽</button>
                </li>
            </ul>
            <button v-if="items.length < total" :disabled="blacklistLoading" @click="loadBlacklist(false)">加载更多（{{ items.length }}/{{ total }}）</button>
        </section>
    </div>
</template>

<style scoped>
.listening-settings { color: var(--text); margin: 24px 0; }
section { padding: 24px; margin-bottom: 20px; border: 1px solid var(--border); background: var(--bg); }
h2 { font-size: 20px; margin-bottom: 10px; }
p { font-size: 13px; line-height: 1.7; margin-bottom: 16px; opacity: .8; }
fieldset { border: 0; padding: 0; min-width: 0; }
.mode { display: flex; align-items: center; gap: 16px; margin: 18px 0; }
.weights { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 16px 32px; margin-bottom: 24px; }
.weights label { display: flex; align-items: center; gap: 12px; font-size: 14px; }
.weights span { width: 64px; flex-shrink: 0; }
input { flex: 1; min-width: 0; accent-color: #d58b33; }
output { width: 30px; text-align: right; }
button, select { padding: 8px 12px; border: 1px solid var(--border); color: var(--text); background: var(--bg); font: inherit; font-size: 13px; cursor: pointer; }
button:disabled { opacity: .45; cursor: default; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 18px 0; }
ul { list-style: none; padding: 0; }
li { display: flex; gap: 16px; align-items: center; justify-content: space-between; border-top: 1px solid var(--border); padding: 12px 0; font-size: 14px; }
li span { overflow-wrap: anywhere; }
li button { flex-shrink: 0; }
.error { color: #d34c4c; opacity: 1; }
</style>
