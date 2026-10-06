<script setup>
  import { onActivated, onUnmounted, ref } from 'vue'
  import DataCheckAnimaton from './DataCheckAnimaton.vue'
  import { noticeOpen } from '../utils/dialog'
  import { loginByPhone, sendCaptcha } from '../api/login'
  import { loginHandle } from '../utils/handle'

  const emits = defineEmits(['jumpTo'])

  const accountInput = ref(null)
  const codeInput = ref(null)
  const accountNumber = ref('')
  const captchaCode = ref('')
  const focusTimer = ref(null)
  const countdownTimer = ref(null)
  const countdown = ref(0)
  const sendingCaptcha = ref(false)

  const loginAnimation = ref(false)
  const dataCheckAnimaton = ref(null)

  onActivated(() => {
    accountInput.value?.focus()
  })

  const inputFocus = () => {
    accountNumber.value = ''
    captchaCode.value = ''

    focusTimer.value = setTimeout(() => {
      accountInput.value?.focus()
      clearTimeout(focusTimer.value)
    }, 1)
  }

  defineExpose({ inputFocus })

  const validateMobile = () => {
    const mobile = accountNumber.value.replace(/\s/g, '')
    if (!/^\d{11}$/.test(mobile)) {
      noticeOpen('请输入正确的手机号', 2)
      return ''
    }
    return mobile
  }

  const validateLogin = () => {
    const mobile = validateMobile()
    const code = captchaCode.value.replace(/\s/g, '')
    if (!mobile || !/^\d{4,8}$/.test(code)) {
      noticeOpen('请输入正确的验证码', 2)
      return null
    }
    return { mobile, code }
  }

  const loginError = () => {
    dataCheckAnimaton.value?.errorAnimation()
    const errorTimer = setTimeout(() => {
      loginAnimation.value = false
      clearTimeout(errorTimer)
    }, 1500)
  }

  const startCountdown = () => {
    countdown.value = 60
    if (countdownTimer.value) {
      clearInterval(countdownTimer.value)
      countdownTimer.value = null
    }
    countdownTimer.value = setInterval(() => {
      if (countdown.value <= 1) {
        countdown.value = 0
        clearInterval(countdownTimer.value)
        countdownTimer.value = null
        return
      }
      countdown.value -= 1
    }, 1000)
  }

  const sendCode = async () => {
    if (sendingCaptcha.value || countdown.value > 0) return

    const mobile = validateMobile()
    if (!mobile) return

    sendingCaptcha.value = true
    try {
      const result = await sendCaptcha(mobile)
      if (result?.status === 1 || result?.error_code === 0) {
        noticeOpen('验证码已发送，请注意查收', 2)
        startCountdown()
        codeInput.value?.focus()
        return
      }
      throw new Error(result?.msg || result?.message || '验证码发送失败')
    } catch (error) {
      noticeOpen(error?.message || '验证码发送失败，请稍后重试', 2)
    } finally {
      sendingCaptcha.value = false
    }
  }

  async function login() {
    if (loginAnimation.value || sendingCaptcha.value) return
    const payload = validateLogin()
    if (!payload) return

    loginAnimation.value = true

    try {
      const result = await loginByPhone(payload)

      if (result?.status === 1) {
        await loginHandle(result, 'account')
        emits('jumpTo')
        return
      }

      throw new Error(result?.data || result?.msg || result?.message || '登录失败，请检查验证码')
    } catch (error) {
      noticeOpen(error?.message || '登录失败，请稍后重试', 2)
      loginError()
    }
  }

  onUnmounted(() => {
    if (countdownTimer.value) {
      clearInterval(countdownTimer.value)
      countdownTimer.value = null
    }
  })
</script>

<template>
  <form class="account-container" @submit.prevent="login">
    <div class="account">
      <div class="account-adress">
        <label for="account-phone">手机号</label>
        <div class="input-container" :class="{ 'login-animation': loginAnimation }">
          <span class="phone-country">+86</span>
          <input id="account-phone" class="account-input" v-model="accountNumber" type="tel" inputmode="numeric"
            autocomplete="tel-national" name="account" ref="accountInput" :disabled="loginAnimation"
            spellcheck="false" maxlength="11" placeholder="请输入手机号" @keydown.enter.prevent="sendCode">
        </div>
      </div>
      <div class="mail-password">
        <label for="account-code">验证码</label>
        <div class="code-row" :class="{ 'login-animation': loginAnimation }">
          <input id="account-code" class="password-input" type="text" inputmode="numeric" autocomplete="one-time-code"
            name="captcha" ref="codeInput" v-model="captchaCode" :disabled="loginAnimation"
            spellcheck="false" maxlength="8" placeholder="请输入验证码">
          <button type="button" class="send-button" :disabled="sendingCaptcha || countdown > 0 || loginAnimation" @click="sendCode">
            {{ countdown > 0 ? `${countdown}s 后重发` : (sendingCaptcha ? '发送中…' : '发送验证码') }}
          </button>
        </div>
      </div>
      <div class="animation" v-if="loginAnimation">
        <DataCheckAnimaton class="check-animation" ref="dataCheckAnimaton" />
      </div>
    </div>
    <button type="submit" class="login-button" :disabled="loginAnimation || sendingCaptcha">
      {{ loginAnimation ? '登录中…' : '登录' }}
    </button>
  </form>
</template>

<style scoped>
.account-container { width: min(340px, calc(100% - 40px)); margin: 4vh auto 0; color: var(--login-text); }
.account { position: relative; display: grid; gap: 22px; text-align: left; }
label { display: block; margin-bottom: 9px; font: 13px SourceHanSansCN-Bold; }
.input-container, .code-row { display: flex; align-items: center; min-height: 46px; border-bottom: 1px solid var(--login-muted); transition: opacity .2s, transform .2s; }
.input-container:focus-within, .code-row:focus-within { border-color: var(--login-text); }
.phone-country { padding-right: 14px; margin-right: 14px; border-right: 1px solid var(--login-muted); font-size: 15px; }
input { min-width: 0; width: 100%; padding: 10px 0; border: 0; background: transparent; color: inherit; outline: none; font: 16px SourceHanSansCN-Regular, sans-serif; }
input::placeholder { color: var(--login-muted); font-size: 14px; }
button { cursor: pointer; border-radius: 0; font: 12px SourceHanSansCN-Bold; }
button:disabled { cursor: default; opacity: .55; }
button:focus-visible { outline: 2px solid var(--login-text); outline-offset: 4px; }
.send-button { flex-shrink: 0; min-width: 100px; padding: 9px 10px; margin-left: 12px; border: 1px solid var(--login-muted); color: inherit; background: transparent; }
.send-button:hover:not(:disabled) { border-color: var(--login-text); }
.login-button { width: 100%; min-height: 44px; margin-top: 28px; border: 1px solid var(--login-text); background: var(--login-text); color: var(--bg); font-size: 14px; transition: opacity .2s; }
.login-button:hover:not(:disabled) { opacity: .8; }
.animation { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.check-animation { width: 150px; height: 150px; }
.login-animation { opacity: 0; transform: scale(.95); }
.dark .account-container input, .dark .account-container .send-button { background: transparent !important; }
.dark .account-container .login-button { background: var(--login-text) !important; color: #171717 !important; }
</style>
