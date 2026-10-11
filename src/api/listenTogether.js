import request from '../utils/request'

export const ROOM_BIZ = { music: '1009', study: '1000' }
let requestSequence = 0

// The HTTP server caches by URL, including POSTs. Body-only operations must
// never share a URL, even when several requests start in the same millisecond.
export function togetherRequest(domain, operation, data = {}, options = {}) {
    if (!['room', 'music', 'study', 'chat', 'discovery'].includes(domain)) throw new Error('未知房间类型')
    return request({
        url: `/listen/together/${domain}`, method: 'post',
        params: { operation, timestamp: `${Date.now()}-${++requestSequence}` },
        data: { ...data, operation }, signal: options.signal,
    }).then(result => {
        if (!result || typeof result !== 'object') throw new Error('一起听接口返回了无效数据')
        const code = result.error_code ?? result.errcode ?? result.code
        if (Number(result.status) === 0 || (code != null && ![0, 200].includes(Number(code)))) {
            const error = new Error(result.error_msg || result.errmsg || result.message || result.msg || result.error || `房间请求失败（${code ?? '未知错误'}）`)
            error.code = code
            throw error
        }
        return result.data ?? result
    })
}
