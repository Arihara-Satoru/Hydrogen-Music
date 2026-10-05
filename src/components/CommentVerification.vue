<script setup>
import { ref, onBeforeUnmount } from 'vue'
import { dialogOpen } from '../utils/dialog'
import { getCommentVerificationInfo, verifyCommentSecurity } from '../api/song'

const props = defineProps({ challenge: { type: Object, required: true } })
const emit = defineEmits(['verified', 'retry'])
const busy = ref(false)
const error = ref('')
const info = ref(null)
let closePrompt = null
let active = true
let captcha = null

onBeforeUnmount(() => {
    active = false
    closePrompt?.()
    captcha?.destroy()
})

function showPrompt(message = '酷狗要求安全验证。草稿已保留，验证通过后请再次点击发送。') {
    if (!active) return
    const sms = Number(info.value?.v_type) === 32
    closePrompt = dialogOpen('安全验证', message, (confirmed, code) => {
        if (!active || busy.value) return
        if (!confirmed) { emit('retry'); return }
        if (sms) void submitVerification(code)
        else void startVerification()
    }, sms ? { label: '手机验证码', inputmode: 'numeric', autocomplete: 'one-time-code' } : null)
}

const fail = cause => {
    if (!active) return
    error.value = cause?.response?.data?.msg || cause?.response?.data?.message || cause.message || '安全验证失败'
    busy.value = false
    showPrompt(error.value)
}

async function submitVerification(verifycode) {
    if (!active) return
    busy.value = true
    error.value = ''
    try {
        const result = await verifyCommentSecurity({ ...props.challenge, v_type: Number(info.value.v_type), verifycode })
        if (Number(result?.status) !== 1 || Number(result?.error_code ?? result?.err_code ?? 0) !== 0) {
            throw new Error(result?.msg || result?.message || '安全验证未通过')
        }
        // ponytail: 验证只解锁发送按钮；公开评论需用户再次提交，避免自动重试造成重复发布。
        if (active) emit('verified')
    } catch (cause) { fail(cause) }
    finally { if (active) busy.value = false }
}

async function startVerification() {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
        if (!props.challenge.sid || !props.challenge.edt) throw new Error('缺少安全验证凭据，请重新提交评论获取验证')
        const result = await getCommentVerificationInfo(props.challenge.eventid)
        if (!active) return
        if (Number(result?.status) === 0 || Number(result?.error_code ?? result?.err_code ?? 0) !== 0) {
            throw new Error(result?.msg || result?.message || '无法获取安全验证信息')
        }
        info.value = result?.data
        const type = Number(info.value?.v_type)
        if (type === 32) {
            busy.value = false
            showPrompt('请输入酷狗发送到绑定手机的验证码。')
            return
        }
        if (type !== 23 || !info.value?.txappid) throw new Error('暂不支持此验证方式，请在酷狗客户端完成验证后重试')
        if (!window.TencentCaptcha) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script')
                const timer = setTimeout(() => finish(new Error('验证码加载超时，请重试')), 15000)
                const finish = cause => {
                    clearTimeout(timer)
                    script.remove()
                    cause ? reject(cause) : resolve()
                }
                // 与后端的酷狗验证示例使用同一腾讯验证码 SDK。
                script.src = 'https://turing.captcha.qcloud.com/TCaptcha.js'
                script.onload = () => finish()
                script.onerror = () => finish(new Error('验证码加载失败，请检查网络后重试'))
                document.head.appendChild(script)
            })
        }
        if (!active) return
        if (!window.TencentCaptcha) throw new Error('验证码组件不可用，请重试')
        captcha?.destroy()
        const txappid = String(info.value.txappid)
        captcha = new window.TencentCaptcha(txappid, result => {
            if (!active) return
            if (result.ret !== 0 || result.errorCode || !result.ticket || !result.randstr) {
                fail(new Error(result.ret === 2 ? '已取消验证，可以重新验证' : '验证码未通过，请重试'))
                return
            }
            void submitVerification('KGCodeTX|' + JSON.stringify({ ticket: result.ticket, randstr: result.randstr, txappid }))
        }, { showHeader: false })
        captcha.show()
    } catch (cause) { fail(cause) }
}
showPrompt()
</script>

<template></template>
