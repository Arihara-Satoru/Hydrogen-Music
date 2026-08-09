const BILI_QR_POLL_HOSTNAME = 'passport.bilibili.com'
const BILI_QR_POLL_PATHNAME = '/x/passport-login/web/qrcode/poll'
const BILI_LOGIN_COOKIE_FIELDS = new Map([
    ['SESSDATA', 'sessdata'],
    ['bili_jct', 'biliJct'],
    ['DedeUserID', 'dedeUserId'],
])

function getSetCookieHeaders(headers) {
    const value = headers?.['set-cookie'] ?? headers?.['Set-Cookie'] ?? headers?.get?.('set-cookie')
    if (Array.isArray(value)) return value
    return typeof value === 'string' && value ? [value] : []
}

function extractBiliLoginCookies(headers) {
    const cookies = {}

    for (const header of getSetCookieHeaders(headers)) {
        const cookiePair = String(header).split(';', 1)[0]
        const separatorIndex = cookiePair.indexOf('=')
        if (separatorIndex <= 0) continue

        const name = cookiePair.slice(0, separatorIndex).trim()
        const field = BILI_LOGIN_COOKIE_FIELDS.get(name)
        if (!field) continue

        const value = cookiePair.slice(separatorIndex + 1).trim()
        if (value) cookies[field] = value
    }

    return cookies
}

function isBiliQrPollUrl(urlObj) {
    return urlObj?.hostname === BILI_QR_POLL_HOSTNAME && urlObj?.pathname === BILI_QR_POLL_PATHNAME
}

function decorateBiliQrPollResponse(urlObj, responseData, responseHeaders) {
    if (!isBiliQrPollUrl(urlObj) || !responseData?.data || responseData.data.code !== 0) {
        return responseData
    }

    const loginCookies = extractBiliLoginCookies(responseHeaders)
    if (!loginCookies.sessdata) return responseData

    return {
        ...responseData,
        data: {
            ...responseData.data,
            loginCookies,
        },
    }
}

module.exports = {
    decorateBiliQrPollResponse,
    extractBiliLoginCookies,
}
