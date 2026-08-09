import request from '../utils/request'

function ensureSoundEffectResponse(result) {
    const failed = Number(result?.status) === 0
        || (result?.error_code !== undefined && Number(result.error_code) !== 0)
    if (failed) throw new Error(result?.msg || result?.message || result?.data || 'sound-effect-request-failed')
    return result
}

export function getCommunitySoundEffects(params = {}) {
    return request({
        url: '/get/model',
        method: 'get',
        params: {
            page: 1,
            pagesize: 50,
            ...params,
        },
    }).then(ensureSoundEffectResponse)
}

export function getSoundEffectDetail(modelId, params = {}) {
    return request({
        url: '/get/mode/info',
        method: 'get',
        params: {
            model_id: modelId,
            page: 1,
            pagesize: 30,
            ...params,
        },
    }).then(ensureSoundEffectResponse)
}
