export const recommendationTags = [
    ['L1', '国语'], ['L2', '英语'], ['L5', '粤语'], ['L4', '韩语'], ['L3', '日语'], ['L6', '纯音乐'],
    ['S9', 'DJ'], ['T1', '翻唱'], ['N2', '现场'], ['S28', 'AI 歌曲'],
]

export function parseRecommendationWeights(value) {
    const weights = typeof value === 'string' ? (value ? JSON.parse(value) : {}) : (value || {})
    if (!weights || typeof weights !== 'object' || Array.isArray(weights)) throw new Error('推荐强度格式无效')
    for (const weight of Object.values(weights)) {
        if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0 || weight > 100) throw new Error('推荐强度必须在 0–100 之间')
    }
    return weights
}

export function validateRecommendationWeights(weights) {
    parseRecommendationWeights(weights)
    if (recommendationTags.slice(0, 6).every(([id]) => weights[id] === 0)) throw new Error('语种不可全部屏蔽')
    if ((weights.S9 ?? 50) > 50 && weights.T1 === 0) throw new Error('加大 DJ 推荐时不可同时屏蔽翻唱')
}

export function normalizeBlacklistItem(item, label) {
    const value = item[`${label}_v`]
    let details = {}
    try { details = typeof value === 'string' ? JSON.parse(value) : value || {} } catch (_) {}
    return { key: String(item[`${label}_k`] || ''), name: details?.n || '未知内容', mixsongid: details?.m || '' }
}
