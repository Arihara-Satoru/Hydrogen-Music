import request from '../utils/request'
/**
 * 登录后调用此接口 ,可获取用户账号信息
 * @returns 
 */
 export function getUserProfile() {
    return request({
      url: '/user/detail',
      method: 'get',
      params: {
        timestamp: new Date().getTime(),
      },
    });
  }

/**
 * 登录后调用此接口，可以获取用户的所有创建以及收藏的歌单
 * 可选参数 : page 页数, pagesize 每页数量(默认30)
 * @returns
 */
  export function getUserPlaylist(params) {
    return request({
      url: '/user/playlist',
      method: 'get',
      params,
    });
  }


/**
 * 说明 : 调用此接口 , 可退出登录
 * @returns 
 */
  export function logout() {
      return Promise.resolve({ status: 1 });
  }

/**
 * 说明 : 调用此接口 , 传入用户 id, 可获取已喜欢音乐 id 列表(id 数组)
 * @param {*} id 
 * @returns 
 */
 export function getLikelist(id) {
    return request({
      url: '/likelist',
      method: 'get',
      params: {
        id: id,
        timestamp: new Date().getTime(),
      }
    });
  }

/**
 * 说明: 登录后调用此接口，可获取当前 VIP 信息。
 * @param {*} id 
 * @returns 
 */
export function getVipInfo() {
    return request({
      url: '/user/vip/detail',
      method: 'get',
      params: {
        timestamp: new Date().getTime(),
      }
    });
  }

function withTimestamp(params = {}) {
    return {
        ...params,
        timestamp: Date.now(),
    }
}

function ensureAccountFeatureResponse(result) {
    const failed = Number(result?.status) === 0
        || (result?.error_code !== undefined && Number(result.error_code) !== 0)
    if (failed) throw new Error(result?.msg || result?.message || result?.data || 'account-feature-request-failed')
    return result
}

const PURCHASE_PAGE_SIZE = 50
const MAX_PURCHASE_PAGES = 100

export function extractPurchasedItems(result, preferredKeys) {
    const roots = [result?.data?.data, result?.data, result]
    for (const root of roots) {
        if (Array.isArray(root)) return root
        if (!root || typeof root != 'object') continue

        for (const key of preferredKeys) {
            if (Array.isArray(root[key])) return root[key]
            if (Array.isArray(root[key]?.list)) return root[key].list
        }

        const directArray = Object.values(root).find(value => Array.isArray(value))
        if (directArray) return directArray
    }
    return []
}

function getPurchasedTotal(result) {
    const roots = [result?.data?.data, result?.data, result]
    for (const root of roots) {
        if (!root || typeof root != 'object') continue
        for (const key of ['total', 'total_count', 'total_num']) {
            if (root[key] === null || root[key] === undefined || root[key] === '') continue
            const total = Number(root[key])
            if (Number.isFinite(total) && total >= 0) return total
        }
    }
    return null
}

async function fetchAllPurchasedPages(url, params, preferredKeys) {
    const requestedPage = Number(params?.page)
    const requestedPageSize = Number(params?.pagesize)
    const firstPage = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.max(1, Math.floor(requestedPage)) : 1
    const pageSize = Number.isFinite(requestedPageSize) && requestedPageSize > 0
        ? Math.min(Math.max(1, Math.floor(requestedPageSize)), PURCHASE_PAGE_SIZE)
        : PURCHASE_PAGE_SIZE
    let firstResult = null
    let mergedItems = null

    // ponytail: 5,000 purchases is ample today; switch the UI to incremental paging if accounts outgrow it.
    for (let index = 0; index < MAX_PURCHASE_PAGES; index += 1) {
        const result = ensureAccountFeatureResponse(await request({
            url,
            method: 'get',
            params: withTimestamp({ ...params, page: firstPage + index, pagesize: pageSize }),
        }))
        const pageItems = extractPurchasedItems(result, preferredKeys)

        if (!firstResult) {
            firstResult = result
            mergedItems = pageItems
        } else {
            mergedItems.push(...pageItems)
        }

        const total = getPurchasedTotal(result)
        if (pageItems.length < pageSize || (total > 0 && mergedItems.length >= total)) return firstResult
    }

    throw new Error('purchased-content-pagination-limit-exceeded')
}

/**
 * 获取用户全部已购买单曲；接口每页最多返回 50 条，这里自动合并分页。
 * @param {object} params
 * @returns
 */
export function getPurchasedSongs(params = {}) {
    return fetchAllPurchasedPages(
        '/user/purchased/songs',
        params,
        ['songs', 'song_list', 'audio_list', 'goods', 'list', 'info', 'items'],
    )
}

/**
 * 获取用户全部已购买专辑；接口每页最多返回 50 条，这里自动合并分页。
 * @param {object} params
 * @returns
 */
export function getPurchasedAlbums(params = {}) {
    return fetchAllPurchasedPages(
        '/user/purchased/albums',
        params,
        ['albums', 'album_list', 'goods', 'list', 'info', 'items'],
    )
}

/**
 * 查询听歌等级；传入 d_sec 与 diff_sec 时同步新增听歌时长。
 * @param {object} params
 * @returns
 */
export function getUserGradeInfo(params = {}) {
    return request({
        url: '/user/grade/info',
        method: 'get',
        params: withTimestamp(params),
    }).then(ensureAccountFeatureResponse)
}

/**
 * 获取当前账号的登录设备。
 * @returns
 */
export function getLoginDevices() {
    return request({
        url: '/login/device',
        method: 'get',
        params: withTimestamp(),
    }).then(ensureAccountFeatureResponse)
}

/**
 * 让指定设备退出登录。
 * @param {object} device
 * @returns
 */
export function kickLoginDevice(device = {}) {
    return request({
        url: '/login/device/kick',
        method: 'get',
        params: withTimestamp({
            t_mid: device.t_mid ?? device.mid,
            t: device.t,
            t_appid: device.t_appid ?? device.appid,
            t_clientver: device.t_clientver ?? device.ver ?? device.clientver,
        }),
    }).then(ensureAccountFeatureResponse)
}

/**
 * 获取服务器时间，避免使用本地时区直接计算领取日期。
 * @returns
 */
export function getServerNow() {
    return request({
        url: '/server/now',
        method: 'post',
        params: withTimestamp(),
    })
}

/**
 * 获取已领取 VIP 状态。
 * @returns
 */
export function getYouthVipUnionStatus() {
    return request({
        url: '/youth/union/vip',
        method: 'get',
        params: withTimestamp(),
    })
}

/**
 * 获取当月已领取 VIP 天数记录。
 * @returns
 */
export function getYouthVipMonthRecord() {
    return request({
        url: '/youth/month/vip/record',
        method: 'get',
        params: withTimestamp(),
    })
}

/**
 * 领取一天 VIP。
 * @param {string} receiveDay - 领取日期，格式为 YYYY-MM-DD
 * @returns
 */
export function claimYouthDailyVip(receiveDay) {
    return request({
        url: '/youth/day/vip',
        method: 'post',
        params: withTimestamp({
            receive_day: receiveDay,
        }),
    })
}
