<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { routerKey } from 'vue-router'
import {
  completeOnboardingSteps,
  getPendingOnboardingSteps,
  ONBOARDING_STEPS,
  ONBOARDING_STORAGE_KEY,
  resetOnboarding,
} from '../utils/onboarding.mjs'

const props = defineProps({ scope: { type: String, default: '' } })
const emit = defineEmits(['active-change'])
const router = inject(routerKey, null)
const routeScopes = {
  homepage: 'home', mymusic: 'mymusic', playlist: 'mymusic', album: 'mymusic', artist: 'mymusic',
  rec: 'mymusic', dj: 'mymusic', localFiles: 'mymusic', localAlbum: 'mymusic', localArtist: 'mymusic',
  library: 'mymusic',
  search: 'search', login: 'login', account: 'account', settings: 'settings',
}
const excludedRoutes = new Set(['clouddisk', 'personalfm', 'siren', 'sirenAlbum'])
const routeScope = computed(() => {
  const name = String(router?.currentRoute.value.name || '').replace(/^~/, '')
  return excludedRoutes.has(name) ? '' : routeScopes[name] || ''
})
const currentScope = computed(() => props.scope || routeScope.value)

const steps = ref([])
const index = ref(0)
const active = ref(false)
watch(active, (value) => emit('active-change', value), { flush: 'sync' })
const locating = ref(false)
const rect = ref(null)
const shownStepIds = new Set()
let locateRun = 0
let startTimer = null
let preparedAction = ''

const showPlayerTools = (visible) => {
  document.body.classList.toggle('onboarding-player-tools-visible', visible)
}

const step = computed(() => steps.value[index.value])
const progress = computed(() => `${Math.min(index.value + 1, steps.value.length)} / ${steps.value.length}`)
const highlightStyle = computed(() => rect.value ? {
  left: `${rect.value.left - 6}px`, top: `${rect.value.top - 6}px`,
  width: `${rect.value.width + 12}px`, height: `${rect.value.height + 12}px`,
} : {})
const cardStyle = computed(() => {
  if (!rect.value) return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
  const cardWidth = Math.min(360, window.innerWidth - 32)
  const left = Math.min(Math.max(16, rect.value.left), window.innerWidth - cardWidth - 16)
  const cardHeight = 240
  const fitsBelow = rect.value.bottom + cardHeight + 18 < window.innerHeight
  const preferredTop = fitsBelow ? rect.value.bottom + 18 : rect.value.top - cardHeight - 18
  const top = Math.min(Math.max(16, preferredTop), Math.max(16, window.innerHeight - cardHeight - 16))
  return {
    left: `${left}px`, top: `${top}px`, bottom: 'auto',
    width: `${cardWidth}px`, transform: 'none',
  }
})

const findVisibleTarget = (selector) => Array.from(document.querySelectorAll(selector)).find((element) => {
  if (!element.getClientRects().length || getComputedStyle(element).visibility === 'hidden') return false
  const bounds = element.getBoundingClientRect()
  return bounds.width > 1 && bounds.height > 1
})

const cleanupPreparedAction = () => {
  if (preparedAction === 'account-menu') window.dispatchEvent(new CustomEvent('hydrogen:onboarding-account-menu', { detail: false }))
  preparedAction = ''
}

const prepareStep = async (item) => {
  cleanupPreparedAction()
  if (item?.prepare === 'account-menu' && !findVisibleTarget(item.target)) {
    window.dispatchEvent(new CustomEvent('hydrogen:onboarding-account-menu', { detail: true }))
    preparedAction = item.prepare
    await new Promise((resolve) => setTimeout(resolve, 420))
  }
}

const updateRect = () => {
  if (!active.value || !step.value) return
  const target = findVisibleTarget(step.value.target)
  if (!target) return
  const next = target.getBoundingClientRect()
  const left = Math.max(0, next.left)
  const top = Math.max(0, next.top)
  const right = Math.min(window.innerWidth, next.right)
  const bottom = Math.min(window.innerHeight, next.bottom)
  rect.value = { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

const finish = (skipAll = false, saveProgress = true) => {
  locateRun += 1
  cleanupPreparedAction()
  showPlayerTools(false)
  const completed = skipAll ? steps.value.map(({ id }) => id) : [...shownStepIds]
  if (saveProgress && completed.length) completeOnboardingSteps(localStorage, completed)
  active.value = false
  locating.value = false
  rect.value = null
  shownStepIds.clear()
}

const locateStep = async () => {
  if (!active.value || !step.value) return
  const run = ++locateRun
  locating.value = true
  rect.value = null
  await prepareStep(step.value)

  // ponytail: async route/components only need a bounded mount wait; unavailable
  // song-specific tools remain pending and are introduced when they actually appear.
  for (let attempt = 0; attempt < 45 && run === locateRun; attempt += 1) {
    const target = findVisibleTarget(step.value.target)
    if (target) {
      const bounds = target.getBoundingClientRect()
      const outsideViewport = bounds.bottom <= 0 || bounds.top >= window.innerHeight
        || bounds.right <= 0 || bounds.left >= window.innerWidth
      if (outsideViewport) {
        target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' })
        await new Promise(requestAnimationFrame)
      }
      if (run !== locateRun) return
      shownStepIds.add(step.value.id)
      updateRect()
      locating.value = false
      return
    }
    await new Promise(requestAnimationFrame)
  }
  if (run !== locateRun) return
  if (index.value < steps.value.length - 1) index.value += 1
  else finish(false)
}

const next = () => {
  if (index.value === steps.value.length - 1) finish(false)
  else index.value += 1
}
const previous = () => { if (index.value > 0) index.value -= 1 }
const startScope = (force = false) => {
  const scope = currentScope.value
  if (!scope) return
  if (active.value) finish(false)
  if (force) resetOnboarding(localStorage)
  showPlayerTools(scope === 'player')
  steps.value = getPendingOnboardingSteps(localStorage, ONBOARDING_STEPS, scope)
    .filter((item) => item.prepare || findVisibleTarget(item.target))
  if (!steps.value.length) {
    showPlayerTools(false)
    return
  }
  index.value = 0
  active.value = true
  void locateStep()
}
const scheduleStart = (delay = 450) => {
  clearTimeout(startTimer)
  startTimer = setTimeout(() => startScope(), delay)
}
const restart = () => startScope(true)
const refresh = () => { if (!active.value) scheduleStart(250) }
const handleStorage = (event) => {
  if (event.key !== ONBOARDING_STORAGE_KEY || event.newValue !== null) return
  if (active.value) finish(false, false)
  scheduleStart(250)
}

watch(index, () => void locateStep())
watch(currentScope, (scope) => {
  if (!scope) {
    clearTimeout(startTimer)
    if (active.value) finish(false)
    return
  }
  scheduleStart(500)
})

onMounted(() => {
  window.addEventListener('resize', updateRect)
  window.addEventListener('scroll', updateRect, true)
  window.addEventListener('hydrogen:restart-onboarding', restart)
  window.addEventListener('hydrogen:refresh-onboarding', refresh)
  window.addEventListener('storage', handleStorage)
  scheduleStart(700)
})
onBeforeUnmount(() => {
  clearTimeout(startTimer)
  locateRun += 1
  cleanupPreparedAction()
  showPlayerTools(false)
  if (active.value) emit('active-change', false)
  window.removeEventListener('resize', updateRect)
  window.removeEventListener('scroll', updateRect, true)
  window.removeEventListener('hydrogen:restart-onboarding', restart)
  window.removeEventListener('hydrogen:refresh-onboarding', refresh)
  window.removeEventListener('storage', handleStorage)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="active" class="onboarding-tour" role="dialog" aria-modal="true" :aria-label="step?.title">
      <div v-if="rect" class="onboarding-highlight" :style="highlightStyle"></div>
      <section class="onboarding-card" :style="cardStyle">
        <div class="onboarding-meta"><span>新手引导</span><span aria-label="当前进度">{{ progress }}</span></div>
        <h2>{{ step?.title }}</h2>
        <p>{{ locating ? '正在定位页面内容…' : step?.content }}</p>
        <div class="onboarding-progress" aria-hidden="true"><i :style="{ width: `${((index + 1) / steps.length) * 100}%` }"></i></div>
        <div class="onboarding-actions">
          <button type="button" class="onboarding-skip" @click="finish(true)">跳过本页</button>
          <div>
            <button type="button" :disabled="index === 0" @click="previous">上一步</button>
            <button type="button" class="onboarding-primary" @click="next">{{ index === steps.length - 1 ? '完成' : '下一步' }}</button>
          </div>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped lang="scss">
.onboarding-tour { position: fixed; inset: 0; z-index: 10000; pointer-events: none; }
.onboarding-highlight { position: fixed; border: 2px solid rgba(255,255,255,.96); border-radius: 10px; box-shadow: 0 0 0 9999px rgba(10,14,20,.68), 0 0 0 5px rgba(0,0,0,.28); transition: left .22s ease, top .22s ease, width .22s ease, height .22s ease; }
.onboarding-card { position: fixed; box-sizing: border-box; max-height: calc(100vh - 16px); overflow-y: auto; padding: 20px; color: #f7f7f7; background: rgba(20,20,20,.97) url('../assets/img/halftone.png'); background-size: 160px; box-shadow: 0 16px 50px rgba(0,0,0,.36); pointer-events: auto; transition: left .22s ease, top .22s ease, bottom .22s ease; font-family: SourceHanSansCN-Bold,sans-serif; }
.onboarding-meta,.onboarding-actions,.onboarding-actions>div { display:flex; align-items:center; justify-content:space-between; gap:8px; }
.onboarding-meta { color:rgba(255,255,255,.6); font:12px Bender-Bold; letter-spacing:1px; }
h2 { margin:13px 0 8px; font-size:20px; }
p { min-height:44px; margin:0; color:rgba(255,255,255,.78); font-size:14px; line-height:1.65; }
.onboarding-progress { height:2px; margin:16px 0; background:rgba(255,255,255,.15); }
.onboarding-progress i { display:block; height:100%; background:#fff; transition:width .2s ease; }
button { border:1px solid rgba(255,255,255,.35); padding:7px 12px; color:#fff; background:transparent; font:13px SourceHanSansCN-Bold; cursor:pointer; }
button:disabled { opacity:.35; cursor:default; }
.onboarding-primary { color:#111; background:#fff; border-color:#fff; }
.onboarding-skip { padding-left:0; border-color:transparent; color:rgba(255,255,255,.62); }
@media (prefers-reduced-motion:reduce) { .onboarding-highlight,.onboarding-card,.onboarding-progress i { transition:none; } }
</style>
