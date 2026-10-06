<script setup>
import { onMounted, onActivated, onDeactivated, onUnmounted, computed, ref } from 'vue'
import { createQQQRcode, checkQQStatus, loginByQQ } from '../api/login'
import { loginHandle } from '../utils/handle'
import LoginQRCode from './LoginQRCode.vue'

const emit = defineEmits(['jumpTo'])
const image = ref('')
const status = ref('正在获取 QQ 二维码…')
const error = ref('')
const loading = ref(false)
const expired = ref(false)
const manual = ref(false)
const openid = ref('')
const accessToken = ref('')
let session = null
let generation = 0
let timer
let active = false
const completed = ref(false)
const scanned = ref(false)
const animation = computed(() => completed.value ? 2 : scanned.value && !expired.value ? 1 : -1)
const qrLabel = computed(() => completed.value ? 'LOGGING...' : expired.value ? 'ERROR' : scanned.value ? 'CONFIRM' : 'QQ')

function stop() {
  active = false
  generation++
  clearTimeout(timer)
  loading.value = false
}

async function complete(result, current) {
  if (current !== generation || !active) return
  if (Number(result?.status) !== 1 || !(result?.data?.token || result?.token)) {
    throw new Error(result?.msg || result?.message || 'QQ 授权登录失败')
  }
  completed.value = true
  stop()
  const completedGeneration = generation
  status.value = '授权成功，正在登录…'
  await loginHandle(result, 'qq')
  if (completedGeneration !== generation) return
  emit('jumpTo')
}

async function poll(current) {
  if (!active || current !== generation) return
  try {
    const result = await checkQQStatus(session)
    if (!active || current !== generation) return
    if (Number(result?.status) === 1) return await complete(result, current)
    if (result?.status === 'expired') {
      expired.value = true
      status.value = '二维码已过期，请刷新'
      return
    }
    if (result?.status === 'wait' || String(result?.status) === '66') {
      scanned.value = false
      status.value = '请使用 QQ 扫码授权登录酷狗'
    } else if (String(result?.status) === '67') {
      scanned.value = true
      status.value = '已扫码，请在 QQ 中确认'
    } else throw new Error(result?.msg || 'QQ 授权未完成，请刷新重试')
    timer = setTimeout(() => poll(current), 1500)
  } catch (cause) {
    if (current !== generation) return
    error.value = cause?.message || 'QQ 登录失败，请重试'
    expired.value = true
  }
}

async function refresh() {
  if (loading.value || completed.value) return
  stop()
  active = true
  completed.value = false
  session = null
  image.value = ''
  scanned.value = false
  error.value = ''
  expired.value = false
  loading.value = true
  status.value = '正在获取 QQ 二维码…'
  const current = generation
  try {
    const result = await createQQQRcode()
    if (!active || current !== generation) return
    session = result
    if (!session?.qrsig || !session?.qrcode) throw new Error('QQ 二维码加载失败')
    image.value = session.qrcode.startsWith('data:image/') ? session.qrcode : `data:image/png;base64,${session.qrcode}`
    status.value = '请使用 QQ 扫码授权登录酷狗'
    timer = setTimeout(() => poll(current), 1500)
  } catch (cause) {
    if (current !== generation) return
    error.value = cause?.message || 'QQ 二维码加载失败'
    expired.value = true
  } finally {
    if (current === generation) loading.value = false
  }
}

async function submit() {
  stop()
  active = true
  const current = generation
  loading.value = true
  error.value = ''
  try {
    await complete(await loginByQQ({ openid: openid.value.trim(), access_token: accessToken.value.trim() }), current)
    accessToken.value = ''
  } catch (cause) {
    if (current === generation) error.value = cause?.message || 'QQ 登录失败'
  } finally {
    if (current === generation) loading.value = false
  }
}

function switchManual() {
  manual.value = !manual.value
  stop()
  error.value = ''
  if (!manual.value) void refresh()
}

onMounted(refresh)
onActivated(() => { if (!active && !completed.value && !manual.value) void refresh() })
onDeactivated(stop)
onUnmounted(stop)
defineExpose({ clearTimer: stop })
</script>

<template>
  <div class="qq-login">
    <form v-if="manual" @submit.prevent="submit">
      <label>QQ openid<input v-model="openid" required autocomplete="off" /></label>
      <label>QQ access_token<input v-model="accessToken" type="password" required autocomplete="off" /></label>
      <button :disabled="loading">{{ loading ? '正在登录…' : '使用授权信息登录' }}</button>
    </form>
    <LoginQRCode v-else :image="image" :animation="animation" :invalid="expired" :scanned="scanned && !expired"
      :status="expired ? (error || status) : status" :label="qrLabel" alt="QQ 登录授权二维码"
      refresh-label="刷新 QQ 二维码" :disabled="loading || completed" @refresh="refresh">
      <button type="button" class="qrcode-action" :disabled="loading || completed" @click="switchManual">已有 QQ 授权信息？</button>
    </LoginQRCode>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button v-if="manual" type="button" class="switch" :disabled="loading || completed" @click="switchManual">返回 QQ 扫码</button>
  </div>
</template>

<style scoped>
.qq-login { display: flex; flex-direction: column; color: var(--text); }
p { margin: 12px 0; font-size: 13px; }
form { display: grid; gap: 12px; width: min(320px, 90%); margin: 4vh auto 0; text-align: left; }
label { display: grid; gap: 6px; font-size: 13px; }
input, button { padding: 8px 12px; border: 1px solid var(--border); background: var(--bg); color: var(--text); border-radius: 4px; }
button { cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
.switch { margin-top: 16px; align-self: center; border: 0; background: transparent; font-size: 12px; text-underline-offset: 4px; text-decoration: underline; }
button:focus-visible { outline: 2px solid var(--text); outline-offset: 4px; }
.error { color: #db4040; }
</style>
