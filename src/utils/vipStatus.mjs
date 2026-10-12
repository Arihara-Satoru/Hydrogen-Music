const VIP_FIELDS = ['vip_type', 'vipType', 'user_type', 'userType', 'busi_vip']

export function extractVipInfo(result) {
    const candidates = [result?.data?.data, result?.data, result]
    if (candidates.some(value => value && (
        (value.status !== undefined && value.status !== null && Number(value.status) === 0)
        || (value.error_code !== undefined && value.error_code !== null && Number(value.error_code) !== 0)
        || (value.errcode !== undefined && value.errcode !== null && Number(value.errcode) !== 0)
    ))) return null

    return candidates.find(value => (
        value && typeof value === 'object' && !Array.isArray(value)
        && VIP_FIELDS.some(key => value[key] !== undefined && value[key] !== null)
    )) || null
}

function parseVipEndTime(value) {
    if (value === undefined || value === null || value === '') return NaN
    const timestamp = Number(value)
    if (Number.isFinite(timestamp)) return timestamp > 0 ? (timestamp < 1e12 ? timestamp * 1000 : timestamp) : NaN

    const text = String(value).trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return Date.parse(`${text}T23:59:59+08:00`)
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)) return Date.parse(`${text.replace(' ', 'T')}+08:00`)
    return Date.parse(text)
}

function isActiveVip(active, endTime, now) {
    if (!active) return false
    const expiresAt = parseVipEndTime(endTime)
    return !Number.isFinite(expiresAt) || expiresAt > now
}

/** 展示服务端实际会员权益；畅听 VIP 是每日领取升级的目标，豪华/超级 VIP 也已达标。 */
export function getCurrentVipLevel(result, now = Date.now()) {
    const info = extractVipInfo(result)
    if (!info) return { tier: 'unknown', label: '暂不可用', isHighest: false }

    const vipType = Number(info.vip_type ?? info.vipType)
    const userType = Number(info.user_type ?? info.userType)
    const products = Array.isArray(info.busi_vip) ? info.busi_vip : []
    const hasProduct = type => products.some(product => (
        product?.product_type === type
        && isActiveVip(Number(product.is_vip) === 1, product.vip_end_time, now)
    ))
    const superVip = isActiveVip(
        Number.isInteger(userType) && userType >= 0 && (userType & 16) !== 0,
        info.su_vip_end_time,
        now,
    )
    const deluxeVip = isActiveVip(vipType === 6, info.vip_end_time, now)

    if (superVip) return { tier: 'super', label: '超级 VIP', isHighest: true }
    if (deluxeVip || hasProduct('dvip')) return { tier: 'deluxe', label: '豪华 VIP', isHighest: true }
    if (hasProduct('tvip')) return { tier: 'music', label: '畅听 VIP', isHighest: true }
    if (hasProduct('svip')) return { tier: 'concept', label: '概念版 VIP', isHighest: false }
    if (isActiveVip(vipType > 0, info.vip_end_time, now)) return { tier: 'vip', label: 'VIP', isHighest: false }
    return { tier: 'none', label: '普通用户', isHighest: false }
}
