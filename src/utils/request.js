import axios from "axios";
import { getCookie, isLogin, updateStoredAuthCookies } from '../utils/authority'
import pinia from "../store/pinia";
import { useLibraryStore } from '../store/libraryStore'
import { useUserStore } from '../store/userStore'
import { clearAccountScopedState } from './accountState'
import { buildKugouDeviceCookieString } from './loginDevices'

import { noticeOpen } from "./dialog";

const libraryStore = useLibraryStore(pinia)

const request = axios.create({
    baseURL: 'http://127.0.0.1:36530',
    withCredentials: true,
    timeout: 20000,
});

const AUTH_COOKIE_KEYS = ['token', 'userid', 'vip_type', 'vip_token', 't1', 'dfid']

let cachedAuthCookieString = null
let kugouApiReadyPromise = null
let kugouApiStatus = null

function waitForKugouApiReady() {
  const api = globalThis.windowApi
  if (typeof api?.waitForKugouApiReady !== 'function') return Promise.resolve({ ready: true })
  if (!kugouApiReadyPromise) {
    kugouApiReadyPromise = api.waitForKugouApiReady()
      .then((status) => {
        kugouApiStatus = status
        return status
      })
      .catch((error) => {
        kugouApiReadyPromise = null
        kugouApiStatus = null
        throw error
      })
  }
  return kugouApiReadyPromise
}

function buildAuthCookieString(device, includeAccountCookies) {
  if (includeAccountCookies && cachedAuthCookieString === null) {
    cachedAuthCookieString = AUTH_COOKIE_KEYS
      .map((key) => {
        const value = getCookie(key)
        return value ? `${key}=${value}` : ''
      })
      .filter(Boolean)
      .join(';')
  }

  return [includeAccountCookies ? cachedAuthCookieString : '', buildKugouDeviceCookieString(device)]
    .filter(Boolean)
    .join(';')
}

export function invalidateNcmApiCookieCache() {
  cachedAuthCookieString = null
}

export function getKugouApiDeviceIdentity() {
  return kugouApiStatus?.device || null
}

let autoLoggingOut = false

function triggerAutoLogout(reason) {
  if (autoLoggingOut) return
  autoLoggingOut = true

  void clearAccountScopedState().finally(() => {
    setTimeout(() => { autoLoggingOut = false }, 1500)
  })

  const userStore = useUserStore(pinia)
  userStore.appOptionShow = false

  noticeOpen(reason || '登录状态已失效，已自动退出，请重新登录', 3)
}

request.interceptors.request.use(async function (config) {
  const apiStatus = await waitForKugouApiReady()
  if (apiStatus?.ready === false) {
    const error = new Error(apiStatus.error || 'kugou-api-unavailable')
    error.config = config
    throw error
  }

  config.params = config.params || {}
  config.headers = config.headers || {}

  const requestUrl = config.url || ''
  const skipAuthCookie = (
    requestUrl.startsWith('/login/')
    && !requestUrl.startsWith('/login/device')
  ) || requestUrl === '/captcha/sent'

  const authCookieString = buildAuthCookieString(apiStatus?.device, !skipAuthCookie && isLogin())
  if (authCookieString) config.headers.Authorization = authCookieString

  if (libraryStore.needTimestamp.indexOf(config.url) != -1) {
    config.params.timestamp = new Date().getTime()
  }

  return config
}, function (error) {
  noticeOpen('发起请求错误', 2)
  return Promise.reject(error)
});

function persistSetCookieHeader(response) {
  const setCookieHeader = response?.headers?.['set-cookie']
  if (!setCookieHeader) return
  const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
  const cookieString = cookies.map(c => c.split(';')[0]).join('; ')
  if (cookieString && Object.keys(updateStoredAuthCookies({ cookie: cookieString })).length) {
    invalidateNcmApiCookieCache()
  }
}

request.interceptors.response.use(function (response) {
    persistSetCookieHeader(response)
    const url = response?.config?.url || ''
    const data = response?.data

    const isAuthApi = url.startsWith('/login') || url === '/logout'
    if (!isAuthApi && data && typeof data === 'object') {
      const code = data.code
      const text = data.msg || data.message || ''
      if (code === 301 || /需要登录|请先登录|not\s*login|invalid\s*session/i.test(text || '')) {
        triggerAutoLogout('登录状态已失效，已自动退出')
      }
    }
    return data
  }, function (error) {
    const url = error?.config?.url || ''
    const status = error?.response?.status
    const msg = error?.response?.data?.message || error?.response?.data?.msg
    const code = error?.response?.data?.code

    if (status === 401 || status === 403) {
      triggerAutoLogout('登录已过期，请重新登录')
    } else {
      const text = error?.response?.data?.msg || error?.response?.data?.message || ''
      if (code === 301 || /需要登录|请先登录|not\s*login|invalid\s*session/i.test(text || '')) {
        triggerAutoLogout('登录状态已失效，已自动退出')
      }
    }

    const suppressGlobalNotice = url === '/like'
      || url === '/playlist/tracks'
      || url === '/playlist/tracks/add'
      || url === '/playlist/tracks/del'
      || url === '/server/now'
      || url === '/youth/union/vip'
      || url === '/youth/month/vip/record'
      || url === '/youth/day/vip'
      || url === '/youth/day/vip/upgrade'
      || url === '/user/grade/info'
      || url === '/user/purchased/songs'
      || url === '/user/purchased/albums'
      || url === '/login/device'
      || url === '/login/device/kick'
      || url === '/get/model'
      || url === '/get/mode/info'
    if (!suppressGlobalNotice) {
      if (msg) noticeOpen(`请求错误：${msg}`, 2)
      else if (status) noticeOpen(`请求错误 (${status})`, 2)
      else noticeOpen('请求错误', 2)
    }
    return Promise.reject(error)
  });

export default request;
