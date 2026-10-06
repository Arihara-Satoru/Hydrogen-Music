<script setup>
  import { onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
  import { onBeforeRouteLeave } from 'vue-router'
  import QRCode from 'qrcode'
  import LoginQRCode from './LoginQRCode.vue'
  import { createQRcode, getQRcodeKey, checkQRcodeStatus } from '../api/login'
  import { loginHandle } from '../utils/handle'
  import { noticeOpen } from '../utils/dialog'
  import { copyToClipboard } from '../utils/clipboard'

  const props = defineProps(['firstLoadMode'])
  const emits = defineEmits(['jumpTo'])

  const firstLoadMode = ref(Number(props.firstLoadMode) || 0)
  const loging = ref(-1)
  const qrKey = ref(null)
  const copyAuthorizationLink = async () => {
    const copied = await copyToClipboard(`https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${qrKey.value}`)
    noticeOpen(copied ? '已复制，可在已登录设备的个人中心授权' : '复制失败，请重试', 2)
  }
  const qrcodeImg = ref('')
  const qrStatus = ref(1)
  const statusTitle = ref('请使用酷狗音乐扫码')
  const statusTitleEN = ref('QRCODE')
  const checkQRInterval = ref(null)
  const loadingQr = ref(false)
  const pollingActive = ref(false)
  const pollingInFlight = ref(false)
  const loginCompleted = ref(false)
  let pollingSessionId = 0
  let qrLoadSessionId = 0
  const resetQrState = () => {
    clearTimer()
    loginCompleted.value = false
    pollingInFlight.value = false
    qrKey.value = null
    qrcodeImg.value = ''
    qrStatus.value = 1
    statusTitle.value = '请使用酷狗音乐扫码'
    statusTitleEN.value = 'QRCODE'
    loging.value = -1
  }

  const clearTimer = (cancelLoad = true) => {
    if (cancelLoad) {
      qrLoadSessionId += 1
      loadingQr.value = false
    }
    pollingSessionId += 1
    pollingInFlight.value = false
    if (checkQRInterval.value) {
      clearTimeout(checkQRInterval.value)
      checkQRInterval.value = null
    }
    pollingActive.value = false
  }

  const scheduleNextPoll = (sessionId, delay = 1000) => {
    if (sessionId !== pollingSessionId || !pollingActive.value || loginCompleted.value) return

    if (checkQRInterval.value) {
      clearTimeout(checkQRInterval.value)
    }

    checkQRInterval.value = setTimeout(async () => {
      if (sessionId !== pollingSessionId) return
      checkQRInterval.value = null
      await checkQRcode(sessionId)
      if (sessionId !== pollingSessionId || !pollingActive.value || loginCompleted.value) return
      if (qrStatus.value === 0 || qrStatus.value === 4) return
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

  const generateFallbackQrImg = async (key) => {
    const loginUrl = `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${key}`
    return QRCode.toDataURL(loginUrl, {
      errorCorrectionLevel: 'Q',
      type: 'image/png',
      width: 192,
      height: 192,
      color: {
        dark: '#000000',
        light: '#00000000',
      },
    })
  }

  const loadData = async () => {
    if (loadingQr.value) return

    resetQrState()
    const loadSessionId = ++qrLoadSessionId
    loadingQr.value = true

    try {
      const keyResult = await getQRcodeKey()
      if (loadSessionId !== qrLoadSessionId) return
      const key = keyResult?.data?.unikey || keyResult?.data?.qrcode
      if (!key) {
        throw new Error('获取二维码 key 失败')
      }

      qrKey.value = key

      const qrResult = await createQRcode(key)
      if (loadSessionId !== qrLoadSessionId) return
      const qrimg = qrResult?.data?.qrimg || qrResult?.data?.base64 || qrResult?.data?.qrcode_img
      qrcodeImg.value = qrimg || await generateFallbackQrImg(key)
      if (loadSessionId !== qrLoadSessionId) return

      startPolling()
    } catch (error) {
      if (loadSessionId !== qrLoadSessionId) return
      noticeOpen(error?.message || '二维码加载失败，请重试', 2)
      qrStatus.value = 0
      statusTitle.value = '二维码加载失败, 点击刷新'
      statusTitleEN.value = 'ERROR'
      loging.value = -1
    } finally {
      if (loadSessionId === qrLoadSessionId) loadingQr.value = false
    }
  }

  const checkQR = () => {
    if (loginCompleted.value) return

    if (qrStatus.value === 4) {
      firstLoadMode.value = 0
      loadData()
      return
    }

    clearTimer(false)

    if (firstLoadMode.value === 1 || !qrKey.value || !qrcodeImg.value) {
      firstLoadMode.value = 0
      loadData()
      return
    }

    startPolling()
  }

  defineExpose({ checkQR, clearTimer, resetQrState })

  watch(() => qrStatus.value, (newVal) => {
    if (newVal === 0) {
      statusTitle.value = '二维码过期, 点击刷新'
      statusTitleEN.value = 'ERROR'
      loging.value = -1
    } else if (newVal === 1) {
      statusTitle.value = '请使用酷狗音乐扫码'
      statusTitleEN.value = 'QRCODE'
      loging.value = -1
    } else if (newVal === 2) {
      statusTitle.value = '请在手机端确认登录'
      statusTitleEN.value = 'CONFIRM'
      loging.value = 1
    } else if (newVal === 4) {
      statusTitle.value = '登录成功，正在跳转'
      statusTitleEN.value = 'LOGGING...'
      loging.value = 2
    }
  })

  const checkQRcode = async (sessionId = pollingSessionId) => {
    if (sessionId !== pollingSessionId || !qrKey.value || loginCompleted.value || pollingInFlight.value) return

    pollingInFlight.value = true

    try {
      const result = await checkQRcodeStatus(qrKey.value)
      if (sessionId !== pollingSessionId) return
      const status = Number(result?.data?.status ?? result?.code)

      if (status === 0) {
        qrStatus.value = 0
        clearTimer()
      } else if (status === 1) {
        qrStatus.value = 1
      } else if (status === 2) {
        qrStatus.value = 2
      } else if (status === 4) {
        qrStatus.value = 4
        loginCompleted.value = true
        clearTimer()
        void loginHandle(result, 'qr')
        emits('jumpTo')
      }
    } catch (_) {
      // 轮询失败保持静默，避免频繁打断
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

  if (firstLoadMode.value === 0) {
    loadData()
  }

  onActivated(() => {
    if (firstLoadMode.value !== 0) return

    if (loginCompleted.value || qrStatus.value === 4) return

    if (!qrKey.value || !qrcodeImg.value) {
      loadData()
      return
    }

    if (qrStatus.value !== 0) {
      startPolling()
    }
  })

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
  <LoginQRCode :image="qrcodeImg" :animation="loging" :invalid="qrStatus === 0" :scanned="qrStatus === 2"
    :status="statusTitle" :label="statusTitleEN" :disabled="loadingQr || loginCompleted" @refresh="refreshQRCode">
    <button class="qrcode-action" type="button" :disabled="!qrKey || qrStatus === 0 || qrStatus === 4" @click="copyAuthorizationLink">复制链接，由已登录设备授权</button>
  </LoginQRCode>
</template>
