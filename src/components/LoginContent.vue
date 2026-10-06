<script setup>
  import { computed, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import LoginByQRCode from './LoginByQRCode.vue'
  import LoginByWeChat from './LoginByWeChat.vue'
  import LoginByAccount from './LoginByAccount.vue'
  import LoginByQQ from './LoginByQQ.vue'

  const route = useRoute()
  const router = useRouter()

  const loginByQR = ref(null)
  const loginByWX = ref(null)
  const loginByAC = ref(null)
  const loginByQQ = ref(null)
  const jumpPage = ref(false)
  const jumpTimer = ref(null)

  // 0: 酷狗二维码 1: 微信登录 2: 手机验证码 3: QQ 登录
  const loginMode = ref(0)
  const isKugouQrMode = computed(() => loginMode.value === 0)
  const isWechatMode = computed(() => loginMode.value === 1)
  const isPhoneMode = computed(() => loginMode.value === 2)
  const isQQMode = computed(() => loginMode.value === 3)

  const syncModeFromRoute = () => {
    const queryMode = Number(route.query.mode)

    if (queryMode === 3) {
      loginMode.value = 3
      return
    }

    // 非法值回退到默认二维码
    if (queryMode === 1) {
      loginMode.value = 1
      return
    }

    if (queryMode === 2) {
      loginMode.value = 2
      return
    }

    loginMode.value = 0
  }

  const enterKugouQrMode = () => {
    loginMode.value = 0
    loginByQR.value?.checkQR()
    loginByWX.value?.clearTimer()
  }

  const enterWechatMode = () => {
    loginMode.value = 1
    loginByWX.value?.checkWX()
    loginByQR.value?.clearTimer()
  }

  const enterPhoneMode = () => {
    loginMode.value = 2
    loginByAC.value?.inputFocus()
    loginByQR.value?.clearTimer()
    loginByWX.value?.clearTimer()
    loginByQQ.value?.clearTimer()
  }

  const changeMode = (mode) => {
    if (mode === loginMode.value) return
    loginByQQ.value?.clearTimer()
    if (mode === 3) {
      loginByQR.value?.clearTimer()
      loginByWX.value?.clearTimer()
      loginMode.value = 3
      return
    }
    if (mode === 0) {
      enterKugouQrMode()
      return
    }

    if (mode === 1) {
      enterWechatMode()
      return
    }

    enterPhoneMode()
  }

  // 登录成功后动画并跳转
  const jumpTo = () => {
    loginByQR.value?.clearTimer()
    loginByWX.value?.clearTimer()
    loginByQQ.value?.clearTimer()
    if (jumpTimer.value) {
      clearTimeout(jumpTimer.value)
      jumpTimer.value = null
    }
    // 先预热目标页面，减少跳转时的空白帧和“闪一下”的感觉
    void import('../views/MyMusic.vue')
    jumpPage.value = true
    // 与 .jumpPage 的动画时长对齐，避免动画结束后先露出一帧空白再切路由
    jumpTimer.value = setTimeout(() => {
      void router.push('/mymusic').catch(() => {
        // 跳转失败时恢复登录页，避免卡在缩小态
        jumpPage.value = false
      })
      jumpTimer.value = null
    }, 2800)
  }

  watch(() => route.query.mode, () => {
    syncModeFromRoute()

    if (isKugouQrMode.value) {
      loginByQR.value?.checkQR()
      loginByWX.value?.clearTimer()
      return
    }

    if (isWechatMode.value) {
      loginByWX.value?.checkWX()
      loginByQR.value?.clearTimer()
      return
    }

    loginByQR.value?.clearTimer()
    loginByWX.value?.clearTimer()
    if (!isQQMode.value) loginByQQ.value?.clearTimer()
    loginByAC.value?.inputFocus()
  }, { immediate: true })

  onActivated(() => {
    syncModeFromRoute()

    if (isKugouQrMode.value) {
      loginByQR.value?.checkQR()
      return
    }

    if (isWechatMode.value) {
      loginByWX.value?.checkWX()
      return
    }

    loginByAC.value?.inputFocus()
  })

  onDeactivated(() => {
    loginByQR.value?.clearTimer()
    loginByWX.value?.clearTimer()
    loginByQQ.value?.clearTimer()
  })

  onUnmounted(() => {
    loginByQR.value?.clearTimer()
    loginByWX.value?.clearTimer()
    loginByQQ.value?.clearTimer()
    if (jumpTimer.value) {
      clearTimeout(jumpTimer.value)
      jumpTimer.value = null
    }
  })
</script>

<template>
  <div class="login-content" :class="{ jumpPage: jumpPage }">
    <div class="login-container">
      <div class="login-header">
        <div class="login-icon">
          <img src="../assets/img/netease-music.png" alt="">
        </div>
        <span class="login-title">登录酷狗账号</span>
      </div>

      <LoginByQRCode
        ref="loginByQR"
        class="qrcode-container"
        :firstLoadMode="loginMode"
        v-if="isKugouQrMode"
        @jumpTo="jumpTo"
      />

      <LoginByWeChat
        ref="loginByWX"
        class="qrcode-container"
        :firstLoadMode="loginMode"
        v-if="isWechatMode"
        @jumpTo="jumpTo"
      />

      <LoginByQQ v-if="isQQMode" ref="loginByQQ" @jumpTo="jumpTo" />

      <LoginByAccount
        ref="loginByAC"
        class="account-container"
        v-show="isPhoneMode"
        @jumpTo="jumpTo"
      />

      <div class="login-other">
        <span class="qrcode-tip" v-show="isKugouQrMode">使用酷狗音乐扫码登录，单击二维码刷新</span>
        <span class="qrcode-tip" v-show="isWechatMode">使用微信扫码授权登录酷狗，单击二维码刷新</span>
        <span class="qrcode-tip" v-show="isPhoneMode">使用手机号验证码登录</span>
        <span class="qrcode-tip" v-show="isQQMode">使用 QQ 扫码授权登录酷狗，单击二维码刷新</span>

        <div class="login-method">
          <button v-for="(label, mode) in ['酷狗二维码', '微信登录', '手机验证码', 'QQ 登录']"
            :key="mode" type="button" :class="{ active: loginMode === mode }"
            :aria-pressed="loginMode === mode" @click="changeMode(mode)">{{ label }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
  .login-content {
    height: 100%;
    --login-title: #000000;
    --login-text: #000000;
    --login-muted: rgb(111, 111, 111);

    .login-container {
      display: flex;
      flex-direction: column;
      justify-content: center;
      height: calc(100% - 120px);

      .login-header {
        display: flex;
        flex-direction: column;
        align-items: center;

        .login-icon {
          margin-bottom: 1.5vh;
          width: 6.5vh;
          height: 6.5vh;
          background-color: rgb(226, 0, 0);

          img {
            width: 100%;
            height: 100%;
          }
        }

        .login-title {
          font: 2.7vh SourceHanSansCN-Bold;
          color: var(--login-title);
        }
      }

      .login-other {
        margin-top: 5.5vh;

        .qrcode-tip {
          font: 13px SourceHanSansCN-Bold;
          color: var(--login-text);
        }

        .login-method {
          display: flex;
          justify-content: center;
          flex-wrap: wrap;
          gap: 10px;
          margin-top: 8px;
          button {
            border: 0;
            background: transparent;
            padding: 4px;
            font: 12px SourceHanSansCN-Bold;
            color: var(--login-muted);
            transition: 0.2s;

            &.active {
              color: var(--login-text);
              cursor: default;
            }

            &:hover {
              cursor: pointer;
              color: var(--login-text);
            }
          }

          .separation {
            margin: 0 4px;
            pointer-events: none;
          }
        }
      }
    }
  }

  .jumpPage {
    opacity: 0;
    transform: scale(0.4);
    transition: 0.6s 2.2s cubic-bezier(.47, 0, .98, .58);
  }

  .dark .login-content {
    --login-title: #f2f5f7;
    --login-text: #f2f5f7;
    --login-muted: #adb4bf;
  }
</style>
