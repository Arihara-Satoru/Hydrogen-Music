<script setup>
  import { onMounted, onActivated, onDeactivated, onUnmounted, ref } from 'vue'
  import { onBeforeRouteLeave } from 'vue-router'
  import LoginQRCode from './LoginQRCode.vue'
  import { createWeChatQRcode, checkWeChatStatus, loginByOpenPlatform } from '../api/login'
  import { loginHandle } from '../utils/handle'
  import { noticeOpen } from '../utils/dialog'

  const props = defineProps(['firstLoadMode'])
  const emits = defineEmits(['jumpTo'])

  const firstLoadMode = ref(Number(props.firstLoadMode) || 0)
  const loging = ref(-1)
  const wxUuid = ref('')
  const qrcodeImg = ref('')
  const wxStatus = ref(408)
  const statusTitle = ref('请使用微信扫码授权')
  const statusTitleEN = ref('WECHAT')
  const checkWXInterval = ref(null)
  const loadingQr = ref(false)
  const pollingActive = ref(false)
  const pollingInFlight = ref(false)
  const loginCompleted = ref(false)
  let pollingSessionId = 0
  let qrLoadSessionId = 0

  const normalizeWxQrImage = (raw = '') => {
    if (!raw) return ''
    return raw.startsWith('data:image/') ? raw : `data:image/jpeg;base64,${raw}`
  }

  const clearTimer = (cancelLoad = true) => {
    if (cancelLoad) {
      qrLoadSessionId += 1
      loadingQr.value = false
    }
    pollingSessionId += 1
    pollingInFlight.value = false
    if (checkWXInterval.value) {
      clearTimeout(checkWXInterval.value)
      checkWXInterval.value = null
    }
    pollingActive.value = false
  }

  const resetWxState = () => {
    clearTimer()
    loginCompleted.value = false
    pollingInFlight.value = false
    wxUuid.value = ''
    qrcodeImg.value = ''
    wxStatus.value = 408
    statusTitle.value = '请使用微信扫码授权'
    statusTitleEN.value = 'WECHAT'
    loging.value = -1
  }

  const scheduleNextPoll = (sessionId, delay = 1000) => {
    if (sessionId !== pollingSessionId || !pollingActive.value || loginCompleted.value) return

    if (checkWXInterval.value) {
      clearTimeout(checkWXInterval.value)
    }

    checkWXInterval.value = setTimeout(async () => {
      if (sessionId !== pollingSessionId) return
      checkWXInterval.value = null
      await checkWXCode(sessionId)
      if (sessionId !== pollingSessionId || !pollingActive.value || loginCompleted.value) return
      if (wxStatus.value === 402 || wxStatus.value === 403 || wxStatus.value === 405) return
      scheduleNextPoll(sessionId)
    }, delay)
  }

  const startPolling = () => {
    if (loginCompleted.value) return
    clearTimer(false)
    pollingActive.value = true
    const sessionId = pollingSessionId
    scheduleNextPoll(sessionId)
  }

  const loadData = async () => {
    if (loadingQr.value) return

    resetWxState()
    const loadSessionId = ++qrLoadSessionId
    loadingQr.value = true

    try {
      const result = await createWeChatQRcode()
      if (loadSessionId !== qrLoadSessionId) return

      const uuid = result?.uuid || result?.data?.uuid
      const qr = result?.qrcode?.qrcodebase64 || result?.data?.qrcode?.qrcodebase64 || ''

      if (!uuid || !qr) {
        throw new Error('微信二维码加载失败')
      }

      wxUuid.value = uuid
      qrcodeImg.value = normalizeWxQrImage(qr)

      if (loadSessionId !== qrLoadSessionId) return
      startPolling()
    } catch (error) {
      if (loadSessionId !== qrLoadSessionId) return
      noticeOpen(error?.message || '微信二维码加载失败，请重试', 2)
      wxStatus.value = 402
      statusTitle.value = '二维码加载失败, 点击刷新'
      statusTitleEN.value = 'ERROR'
      loging.value = -1
    } finally {
      if (loadSessionId === qrLoadSessionId) loadingQr.value = false
    }
  }

  const checkWX = () => {
    if (loginCompleted.value || wxStatus.value === 405) {
      firstLoadMode.value = 0
      loadData()
      return
    }

    clearTimer(false)

    if (firstLoadMode.value === 1 || !wxUuid.value || !qrcodeImg.value) {
      firstLoadMode.value = 0
      loadData()
      return
    }

    startPolling()
  }

  defineExpose({ checkWX, clearTimer, resetWxState })

  const applyStatus = (status) => {
    if (status === 402) {
      statusTitle.value = '二维码已过期, 点击刷新'
      statusTitleEN.value = 'EXPIRED'
      loging.value = -1
      return
    }

    if (status === 408) {
      statusTitle.value = '请使用微信扫码授权'
      statusTitleEN.value = 'WECHAT'
      loging.value = -1
      return
    }

    if (status === 404) {
      statusTitle.value = '已扫码，请在微信确认'
      statusTitleEN.value = 'CONFIRM'
      loging.value = 1
      return
    }

    if (status === 403) {
      statusTitle.value = '已取消授权, 点击刷新'
      statusTitleEN.value = 'DENIED'
      loging.value = -1
      return
    }

    if (status === 405) {
      statusTitle.value = '授权成功，正在登录'
      statusTitleEN.value = 'LOGGING...'
      loging.value = 2
    }
  }

  const checkWXCode = async (sessionId = pollingSessionId) => {
    if (sessionId !== pollingSessionId || !wxUuid.value || loginCompleted.value || pollingInFlight.value) return

    pollingInFlight.value = true

    try {
      const result = await checkWeChatStatus(wxUuid.value)
      if (sessionId !== pollingSessionId) return

      // 微信长轮询 API 返回 wx_errcode 作为二维码状态码
      const status = Number(result?.wx_errcode)
      wxStatus.value = status
      applyStatus(status)

      if (status === 402 || status === 403) {
        clearTimer()
        return
      }

      if (status === 405) {
        const wxCode = result?.wx_code
        if (!wxCode) {
          throw new Error('微信授权码获取失败')
        }

        const openResult = await loginByOpenPlatform(wxCode)
        if (sessionId !== pollingSessionId) return

        if (openResult?.status === 1) {
          loginCompleted.value = true
          clearTimer()
          await loginHandle(openResult, 'wechat')
          emits('jumpTo')
          return
        }

        throw new Error(openResult?.msg || openResult?.message || '微信登录失败')
      }
    } catch (error) {
      if (sessionId !== pollingSessionId) return
      noticeOpen(error?.message || '微信登录失败，请重试', 2)
      wxStatus.value = 403
      applyStatus(403)
      clearTimer()
    } finally {
      if (sessionId === pollingSessionId) {
        pollingInFlight.value = false
      }
    }
  }

  const refreshQRCode = () => {
    if (loadingQr.value || loginCompleted.value) return
    loging.value = -2
    loadData()
  }

  onMounted(checkWX)
  onActivated(checkWX)

  onDeactivated(() => {
    clearTimer()
  })

  onBeforeRouteLeave(() => {
    clearTimer()
  })

  onUnmounted(() => {
    clearTimer()
  })
</script>

<template>
  <LoginQRCode :image="qrcodeImg" :animation="loging" :invalid="wxStatus === 402 || wxStatus === 403" :scanned="wxStatus === 404"
    :status="statusTitle" :label="statusTitleEN" alt="微信二维码" :disabled="loadingQr || loginCompleted" @refresh="refreshQRCode" />
</template>
