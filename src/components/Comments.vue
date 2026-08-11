<script setup>
import { ref, watch, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { getMusicCommentsNew, getMusicCommentFloor, postMusicComment, likeMusicComment } from '../api/song'
import { getDjProgramCommentsNew, getDjProgramCommentFloor, postDjProgramComment, likeDjProgramComment } from '../api/dj'
import { usePlayerStore } from '../store/playerStore'
import { useUserStore } from '../store/userStore'
import { storeToRefs } from 'pinia'
import { noticeOpen } from '../utils/dialog'
import { getCommentScrollPosition, setCommentScrollPosition, getLastCommentTargetKey, setLastCommentTargetKey } from '../utils/commentScrollMemory'
import { buildCommentReplyTree } from '../utils/commentReplies'
import CommentText from './CommentText.vue'

const emit = defineEmits(['total-change'])

const playerStore = usePlayerStore()
const userStore = useUserStore()
const { songId, songList, currentIndex, listInfo } = storeToRefs(playerStore)
const currentTrack = computed(() => {
    const list = songList.value || []
    const idx = typeof currentIndex.value === 'number' ? currentIndex.value : 0
    return list[idx] || null
})
const isDj = computed(() => listInfo.value && listInfo.value.type === 'dj')
const songCommentMutationSupported = computed(() => isDj.value)
const programId = computed(() => {
    const cur = currentTrack.value
    return cur && (cur.programId || cur.programID || cur.programid)
})
const musicCommentId = computed(() => {
    if (isDj.value) return null
    const cur = currentTrack.value
    if (cur?.source === 'siren') return null
    const curId = cur && (cur.mixsongid || cur.mixsong_id || cur.album_audio_id || cur.MixSongID || cur.id || cur.songId || cur.musicId)
    return curId || songId.value || null
})

const comments = ref([])
const hotComments = ref([])
const classifyOptions = ref([])
const hotwordOptions = ref([])
const activeFilter = ref({ kind: 'all', value: '', label: '全部评论' })
const classifySort = ref(1)
const loading = ref(false)
const loadError = ref('')
const total = ref(0)
const hasMore = ref(true)
const nextCursor = ref('0')
const pageNo = ref(1)
const limit = ref(20)
const newComment = ref('')
const replyingTo = ref(null)
const submitting = ref(false)
const floorReplies = ref({})
const imagePreview = ref(null)
const imagePreviewCloseRef = ref(null)
const imagePreviewTrigger = ref(null)

const FLOOR_REPLY_LIMIT = 5

const COMMENTS_PREFETCH_PX = 200
const commentsContainerRef = ref(null)
const scrollCheckRafId = ref(null)
const isCommentsVisible = computed(() => !playerStore.widgetState)
const commentTargetKey = computed(() => {
    if (isDj.value) {
        return programId.value ? `dj:${programId.value}` : ''
    }
    return musicCommentId.value ? `song:${musicCommentId.value}` : ''
})
const pendingRestoreScrollTop = ref(null)

const resetCommentsScroll = () => {
    const container = commentsContainerRef.value
    if (!container) return
    container.scrollTop = 0
}

const getDistanceToBottom = () => {
    const container = commentsContainerRef.value
    if (!container) return Number.POSITIVE_INFINITY
    if (!isCommentsVisible.value || container.clientHeight <= 0) return Number.POSITIVE_INFINITY
    return container.scrollHeight - (container.scrollTop + container.clientHeight)
}

const cacheCurrentScrollPosition = (targetKey = commentTargetKey.value) => {
    const container = commentsContainerRef.value
    if (!container || !targetKey) return
    setCommentScrollPosition(targetKey, container.scrollTop)
}

const restoreCommentsScrollIfNeeded = () => {
    if (pendingRestoreScrollTop.value === null) return

    const container = commentsContainerRef.value
    if (!container) return

    const expectedScrollTop = pendingRestoreScrollTop.value
    container.scrollTop = expectedScrollTop

    // 如果当前位置已恢复到目标（或已没有更多可加载），结束恢复流程。
    const restored = Math.abs(container.scrollTop - expectedScrollTop) <= 2
    if (restored || !hasMore.value) {
        pendingRestoreScrollTop.value = null
    }

    cacheCurrentScrollPosition()
}

const shouldAutoLoadMore = () => {
    if (loading.value || !hasMore.value) return false
    return getDistanceToBottom() <= COMMENTS_PREFETCH_PX
}

const tryAutoLoadMore = () => {
    if (!shouldAutoLoadMore()) return
    fetchComments(false)
}

const handleCommentsScroll = () => {
    cacheCurrentScrollPosition()
    if (scrollCheckRafId.value !== null) return
    scrollCheckRafId.value = requestAnimationFrame(() => {
        scrollCheckRafId.value = null
        tryAutoLoadMore()
    })
}

const clearScrollCheckRaf = () => {
    if (scrollCheckRafId.value === null) return
    cancelAnimationFrame(scrollCheckRafId.value)
    scrollCheckRafId.value = null
}

const getUserName = user => (user && user.nickname) || '未知用户'

const getUserAvatar = (user, size = 40) => {
    if (user && user.avatarUrl) return `${user.avatarUrl}${user.avatarUrl.includes('?') ? '&' : '?'}param=${size}y${size}`
    return 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='
}

const openImagePreview = async (image, trigger) => {
    if (!image?.url) return
    imagePreview.value = image
    imagePreviewTrigger.value = trigger || null
    await nextTick()
    imagePreviewCloseRef.value?.focus()
}

const closeImagePreview = async () => {
    if (!imagePreview.value) return
    const trigger = imagePreviewTrigger.value
    imagePreview.value = null
    imagePreviewTrigger.value = null
    await nextTick()
    trigger?.focus?.()
}

const trapImagePreviewFocus = event => {
    event.preventDefault()
    imagePreviewCloseRef.value?.focus()
}

const isFilterActive = (kind, value = '') => activeFilter.value.kind === kind && `${activeFilter.value.value}` === `${value}`
const commentSectionTitle = computed(() => {
    if (isDj.value) return 'LATEST COMMENTS'
    if (activeFilter.value.kind === 'all') return 'ALL COMMENTS'
    return activeFilter.value.kind === 'classify' ? `CATEGORY · ${activeFilter.value.label}` : `HOTWORD · ${activeFilter.value.label}`
})

const resolveReplyRootCommentId = (comment, rootCommentId = null) => {
    const explicitRoot = Number(rootCommentId)
    if (Number.isFinite(explicitRoot) && explicitRoot > 0) return explicitRoot

    const parentId = Number(comment && comment.parentCommentId)
    if (Number.isFinite(parentId) && parentId > 0) return parentId

    const selfId = Number(comment && comment.commentId)
    if (Number.isFinite(selfId) && selfId > 0) return selfId

    return null
}

const isInlineReplyVisible = comment => {
    if (!replyingTo.value || !comment || !comment.commentId) return false
    const expectedRootId = resolveReplyRootCommentId(replyingTo.value, replyingTo.value.__rootCommentId)
    return expectedRootId === comment.commentId
}

const toPositiveInt = value => {
    const num = Number(value)
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

const getCommentReplyCount = comment => {
    return toPositiveInt(comment && comment.showFloorComment && comment.showFloorComment.replyCount)
}

const createFloorState = replyCount => ({
    expanded: false,
    loading: false,
    error: '',
    items: [],
    tree: [],
    expandedReplyIds: [],
    hasMore: replyCount > 0,
    nextTime: -1,
    nextPage: 1,
    total: replyCount,
})

const getFloorCommentKey = comment => {
    if (!comment || !comment.commentId) return ''
    return String(comment.commentId)
}

const getFloorState = comment => {
    const key = getFloorCommentKey(comment)
    if (!key) return null
    return floorReplies.value[key] || null
}

const ensureFloorState = comment => {
    const key = getFloorCommentKey(comment)
    if (!key) return null
    if (!floorReplies.value[key]) {
        floorReplies.value[key] = createFloorState(getCommentReplyCount(comment))
    }
    return floorReplies.value[key]
}

const rebuildFloorStates = (preserveExisting = true) => {
    const previous = preserveExisting ? floorReplies.value || {} : {}
    const next = {}
    const mergedComments = [...hotComments.value, ...comments.value]

    for (const comment of mergedComments) {
        const key = getFloorCommentKey(comment)
        if (!key) continue

        const replyCount = getCommentReplyCount(comment)
        const previousState = previous[key]

        if (previousState) {
            const nextState = {
                ...previousState,
                total: replyCount > 0 ? replyCount : previousState.total || 0,
            }
            if (nextState.total > 0 && nextState.items.length >= nextState.total) {
                nextState.hasMore = false
            }
            next[key] = nextState
        } else {
            next[key] = createFloorState(replyCount)
        }
    }

    floorReplies.value = next
}

const mergeFloorItems = (existing = [], incoming = []) => {
    if (!existing.length) return incoming.slice()
    if (!incoming.length) return existing.slice()

    const seen = new Set(existing.map(item => item.commentId))
    const merged = existing.slice()
    for (const item of incoming) {
        if (seen.has(item.commentId)) continue
        merged.push(item)
        seen.add(item.commentId)
    }
    return merged
}

const rebuildFloorReplyTree = (state, rootComment) => {
    state.tree = buildCommentReplyTree(state.items, rootComment)
}

const getVisibleFloorReplies = rootComment => {
    const state = getFloorState(rootComment)
    if (!state) return []
    if (!Array.isArray(state.tree)) rebuildFloorReplyTree(state, rootComment)

    const expandedIds = new Set((state.expandedReplyIds || []).map(id => `${id}`))
    const visible = []
    const appendNode = (node, depth) => {
        const id = `${node.comment.commentId}`
        const expanded = expandedIds.has(id)
        visible.push({ ...node, depth, expanded })
        if (expanded) node.children.forEach(child => appendNode(child, depth + 1))
    }
    state.tree.forEach(node => appendNode(node, 0))
    return visible
}

const toggleNestedReplies = (rootComment, reply) => {
    const state = getFloorState(rootComment)
    if (!state || !reply?.commentId) return
    const id = `${reply.commentId}`
    const expandedIds = state.expandedReplyIds || []
    state.expandedReplyIds = expandedIds.includes(id)
        ? expandedIds.filter(expandedId => expandedId !== id)
        : [...expandedIds, id]
}

const requestCommentList = async params => {
    if (isDj.value && programId.value) {
        return getDjProgramCommentsNew({ id: programId.value, ...params })
    }
    if (musicCommentId.value) {
        const filter = activeFilter.value
        return getMusicCommentsNew({
            id: musicCommentId.value,
            ...params,
            ...(filter.kind === 'classify' ? { typeId: filter.value, sort: classifySort.value } : {}),
            ...(filter.kind === 'hotword' ? { hotWord: filter.value } : {}),
        })
    }
    return null
}

const requestCommentFloor = async params => {
    if (isDj.value && programId.value) {
        return getDjProgramCommentFloor({ id: programId.value, ...params })
    }
    if (musicCommentId.value) {
        return getMusicCommentFloor({
            id: {
                mixsongid: musicCommentId.value,
                special_id: params.special_id,
                special_child_id: params.special_id,
            },
            ...params,
        })
    }
    return null
}

const loadFloorReplies = async (comment, { forceFirstPage = false } = {}) => {
    const state = ensureFloorState(comment)
    if (!state || state.loading) return

    const replyCount = getCommentReplyCount(comment)
    if (!replyCount && state.items.length === 0) {
        state.hasMore = false
        state.total = 0
        state.expanded = true
        return
    }

    const isFirstPage = forceFirstPage || state.items.length === 0
    if (!isFirstPage && !state.hasMore) return

    state.loading = true
    state.error = ''

    try {
        const response = await requestCommentFloor({
            parentCommentId: comment.commentId,
            special_id: comment.special_child_id || comment.specialId || comment.special_id || '',
            limit: FLOOR_REPLY_LIMIT,
            time: isFirstPage ? -1 : state.nextTime,
            page: isFirstPage ? 1 : state.nextPage,
        })

        if (response && response.code === 200) {
            const data = response.data || {}
            const incomingItems = Array.isArray(data.comments) ? data.comments : []

            if (isFirstPage) {
                state.items = incomingItems
            } else {
                state.items = mergeFloorItems(state.items, incomingItems)
            }
            rebuildFloorReplyTree(state, comment)

            const totalCount = Number(data.totalCount)
            if (Number.isFinite(totalCount) && totalCount >= 0) {
                state.total = Math.floor(totalCount)
            }

            state.hasMore = !!data.hasMore

            const nextTimeValue = Number(data.time)
            if (Number.isFinite(nextTimeValue) && nextTimeValue >= 0) {
                state.nextTime = nextTimeValue
            }

            const nextPageValue = Number(data.nextPage)
            if (Number.isFinite(nextPageValue) && nextPageValue > 0) {
                state.nextPage = Math.floor(nextPageValue)
            } else {
                state.nextPage += 1
            }

            if (state.total > 0 && state.items.length >= state.total) {
                state.hasMore = false
            }

            state.expanded = true
        } else {
            state.error = '回复加载失败，点击重试'
        }
    } catch (error) {
        console.error('获取楼层回复失败:', error)
        state.error = '回复加载失败，点击重试'
    } finally {
        state.loading = false
    }
}

const toggleFloorReplies = async comment => {
    const state = ensureFloorState(comment)
    if (!state) return

    if (state.expanded) {
        state.expanded = false
        return
    }

    if (state.items.length > 0) {
        state.expanded = true
        return
    }

    await loadFloorReplies(comment, { forceFirstPage: true })
}

const loadMoreFloorReplies = async comment => {
    const state = ensureFloorState(comment)
    if (!state || state.loading || !state.hasMore) return
    await loadFloorReplies(comment)
}

const retryFloorReplies = async comment => {
    const state = ensureFloorState(comment)
    if (!state) return
    state.error = ''
    await loadFloorReplies(comment, { forceFirstPage: state.items.length === 0 })
}

const applyCommentListResponse = (response, reset) => {
    if (!response || response.code !== 200) return false

    const incoming = Array.isArray(response.comments) ? response.comments : []
    comments.value = reset ? incoming : mergeFloorItems(comments.value, incoming)
    total.value = toPositiveInt(response.total)
    hasMore.value = !!response.hasMore && (reset || incoming.length > 0)
    nextCursor.value = response.cursor || nextCursor.value
    pageNo.value = reset ? 2 : pageNo.value + 1

    if (!isDj.value && activeFilter.value.kind === 'all') {
        classifyOptions.value = Array.isArray(response.classifyList) ? response.classifyList : []
        hotwordOptions.value = Array.isArray(response.hotwordList) ? response.hotwordList : []
    }
    return true
}

// 获取评论数据
const fetchComments = async (reset = false) => {
    if (loading.value || (!hasMore.value && !reset)) return

    const requestTargetKey = commentTargetKey.value
    if (!requestTargetKey || !isCommentsVisible.value) return

    loading.value = true
    loadError.value = ''
    let fetchSucceeded = false

    if (reset) {
        comments.value = []
        total.value = 0
        hasMore.value = true
        nextCursor.value = '0'
        pageNo.value = 1
        floorReplies.value = {}
        if (!isDj.value) hotComments.value = []
    }

    try {
        if (reset && isDj.value) {
            const [latestResult, hotResult] = await Promise.allSettled([
                requestCommentList({ sortType: 3, pageSize: limit.value, pageNo: 1, cursor: '0' }),
                requestCommentList({ sortType: 2, pageSize: limit.value, pageNo: 1 }),
            ])
            const latestResponse = latestResult.status === 'fulfilled' ? latestResult.value : null
            const hotResponse = hotResult.status === 'fulfilled' ? hotResult.value : null
            fetchSucceeded = applyCommentListResponse(latestResponse, true)
            hotComments.value = hotResponse?.code === 200 && Array.isArray(hotResponse.comments) ? hotResponse.comments : []
        } else {
            const response = await requestCommentList({
                sortType: 3,
                pageSize: limit.value,
                pageNo: reset ? 1 : pageNo.value,
                ...(nextCursor.value ? { cursor: nextCursor.value } : {}),
            })
            fetchSucceeded = applyCommentListResponse(response, reset)
        }

        rebuildFloorStates(!reset)

        if (fetchSucceeded) {
            if (isDj.value || activeFilter.value.kind === 'all') {
                emit('total-change', { targetKey: requestTargetKey, total: total.value })
            }
        } else {
            loadError.value = '评论加载失败，请点击重试'
        }
    } catch (error) {
        console.error('获取评论失败:', error)
        loadError.value = '评论加载失败，请点击重试'
    } finally {
        loading.value = false
    }

    if (fetchSucceeded) {
        await nextTick()
        restoreCommentsScrollIfNeeded()
        tryAutoLoadMore()
    }
}

const selectCommentFilter = async (kind, value = '', label = '全部评论') => {
    if (isDj.value || loading.value || isFilterActive(kind, value)) return
    activeFilter.value = { kind, value, label }
    classifySort.value = 1
    pendingRestoreScrollTop.value = null
    resetCommentsScroll()
    await fetchComments(true)
}

const toggleClassifySort = async () => {
    if (loading.value || activeFilter.value.kind !== 'classify') return
    classifySort.value = classifySort.value === 1 ? 2 : 1
    resetCommentsScroll()
    await fetchComments(true)
}

const retryComments = () => fetchComments(comments.value.length === 0)

// 发送评论
const submitComment = async () => {
    if (!newComment.value.trim() || submitting.value) return

    if (!userStore.user) {
        noticeOpen('请先登录', 2)
        return
    }

    if (!songCommentMutationSupported.value) {
        noticeOpen('当前酷狗后端暂不支持歌曲评论发送/回复', 2)
        return
    }

    submitting.value = true

    try {
        let response = null
        if (isDj.value && programId.value) {
            response = await postDjProgramComment(programId.value, newComment.value.trim(), replyingTo.value ? replyingTo.value.commentId : null)
        } else {
            const params = {
                id: musicCommentId.value,
                content: newComment.value.trim(),
            }
            if (replyingTo.value) params.commentId = replyingTo.value.commentId
            response = await postMusicComment(params)
        }

        if (response && response.code === 200) {
            noticeOpen('评论发送成功', 2)
            newComment.value = ''
            replyingTo.value = null
            // 重新获取评论
            await fetchComments(true)
        } else {
            noticeOpen('评论发送失败', 2)
        }
    } catch (error) {
        console.error('发送评论失败:', error)
        noticeOpen('评论发送失败', 2)
    } finally {
        submitting.value = false
    }
}

// 点赞评论
const toggleLikeComment = async comment => {
    if (!userStore.user) {
        noticeOpen('请先登录', 2)
        return
    }

    if (!songCommentMutationSupported.value) {
        noticeOpen('当前酷狗后端暂不支持歌曲评论点赞', 2)
        return
    }

    try {
        let response = null
        if (isDj.value && programId.value) {
            response = await likeDjProgramComment(programId.value, comment.commentId, !comment.liked)
        } else {
            response = await likeMusicComment({ id: musicCommentId.value, cid: comment.commentId, t: comment.liked ? 0 : 1 })
        }

        if (response && response.code === 200) {
            comment.liked = !comment.liked
            const currentCount = Number(comment.likedCount) || 0
            const nextCount = currentCount + (comment.liked ? 1 : -1)
            comment.likedCount = nextCount > 0 ? nextCount : 0
        }
    } catch (error) {
        console.error('点赞失败:', error)
        noticeOpen('操作失败', 2)
    }
}

// 回复评论
const toggleReply = (comment, rootCommentId = null) => {
    if (!songCommentMutationSupported.value) {
        noticeOpen('当前酷狗后端暂不支持歌曲评论回复', 2)
        return
    }

    const rootId = resolveReplyRootCommentId(comment, rootCommentId)
    if (!rootId) return

    if (replyingTo.value && replyingTo.value.commentId === comment.commentId && resolveReplyRootCommentId(replyingTo.value, replyingTo.value.__rootCommentId) === rootId) {
        // 如果点击的是当前正在回复的评论，则取消回复
        cancelReply()
    } else {
        // 否则开始回复这个评论
        replyingTo.value = {
            ...comment,
            __rootCommentId: rootId,
        }
        newComment.value = `@${getUserName(comment.user)} `
        // 使用nextTick确保DOM更新后再聚焦
        nextTick(() => {
            // 聚焦到回复输入框
            const textarea = document.querySelector('.reply-textarea')
            if (textarea) {
                textarea.focus()
                textarea.setSelectionRange(textarea.value.length, textarea.value.length)
            }
        })
    }
}

// 取消回复
const cancelReply = () => {
    replyingTo.value = null
    newComment.value = ''
}

// 处理复制成功
const handleCopySuccess = () => {
    noticeOpen('评论已复制到剪贴板', 1)
}

// 处理复制失败
const handleCopyError = error => {
    noticeOpen('复制失败，请手动选择文字复制', 2)
    console.warn('复制评论失败:', error)
}

// 格式化时间
const formatTime = timestamp => {
    const ts = Number(timestamp)
    if (!Number.isFinite(ts) || ts <= 0) return '刚刚'

    const now = Date.now()
    const diff = now - ts

    const minute = 60 * 1000
    const hour = 60 * minute
    const day = 24 * hour
    const month = 30 * day
    const year = 365 * day

    if (diff < minute) {
        return '刚刚'
    } else if (diff < hour) {
        return `${Math.floor(diff / minute)}分钟前`
    } else if (diff < day) {
        return `${Math.floor(diff / hour)}小时前`
    } else if (diff < month) {
        return `${Math.floor(diff / day)}天前`
    } else if (diff < year) {
        return `${Math.floor(diff / month)}个月前`
    } else {
        return `${Math.floor(diff / year)}年前`
    }
}

// 监听歌曲/节目变化，切换时重置滚动到顶部
watch(
    commentTargetKey,
    (target, previousTarget) => {
        if (!target) {
            comments.value = []
            hotComments.value = []
            classifyOptions.value = []
            hotwordOptions.value = []
            activeFilter.value = { kind: 'all', value: '', label: '全部评论' }
            floorReplies.value = {}
            loadError.value = ''
            total.value = 0
            hasMore.value = false
            nextCursor.value = '0'
            pageNo.value = 1
            return
        }

        if (previousTarget && previousTarget !== target) {
            classifyOptions.value = []
            hotwordOptions.value = []
            activeFilter.value = { kind: 'all', value: '', label: '全部评论' }
            classifySort.value = 1
        }

        const lastCommentTarget = getLastCommentTargetKey()
        const switchedWhileCommentsClosed = !previousTarget && !!lastCommentTarget && lastCommentTarget !== target

        if (previousTarget) {
            cacheCurrentScrollPosition(previousTarget)
        }

        if (previousTarget || switchedWhileCommentsClosed) {
            pendingRestoreScrollTop.value = null
            resetCommentsScroll()
        } else {
            const cachedScrollTop = getCommentScrollPosition(target)
            pendingRestoreScrollTop.value = typeof cachedScrollTop === 'number' && cachedScrollTop > 0 ? cachedScrollTop : null
            if (pendingRestoreScrollTop.value === null) {
                resetCommentsScroll()
            }
        }

        setLastCommentTargetKey(target)
        fetchComments(true)
    },
    { immediate: true }
)

watch(isCommentsVisible, visible => {
    if (!visible) {
        clearScrollCheckRaf()
        return
    }

    fetchComments(true)
})

onMounted(() => {
    nextTick(() => {
        tryAutoLoadMore()
    })
})

onUnmounted(() => {
    cacheCurrentScrollPosition()
    setLastCommentTargetKey(commentTargetKey.value)
    clearScrollCheckRaf()
})
</script>

<template>
    <div class="arknights-comments" ref="commentsContainerRef" @scroll.passive="handleCommentsScroll">
        <!-- 评论区主标题 -->
        <div class="comments-header">
            <div class="header-frame">
                <div class="frame-corner frame-tl"></div>
                <div class="frame-corner frame-tr"></div>
                <div class="frame-corner frame-bl"></div>
                <div class="frame-corner frame-br"></div>
                <div class="header-title-wrapper">
                    <span class="header-title">COMMENTS</span>
                    <div class="title-underline"></div>
                </div>
            </div>
        </div>

        <!-- 发表评论区域 -->
        <div class="comment-input-section" v-if="isDj && userStore.user && !replyingTo">
            <div class="input-frame">
                <div class="frame-corner frame-tl"></div>
                <div class="frame-corner frame-tr"></div>
                <div class="frame-corner frame-bl"></div>
                <div class="frame-corner frame-br"></div>

                <div class="input-content">
                    <div class="input-wrapper">
                        <textarea v-model="newComment" class="comment-textarea" :placeholder="songCommentMutationSupported ? 'INPUT YOUR COMMENT...' : 'CURRENT BACKEND DOES NOT SUPPORT COMMENT POSTING'" :disabled="submitting || !songCommentMutationSupported" @keydown.enter.ctrl="submitComment"></textarea>
                        <div class="input-border"></div>
                    </div>

                    <div class="input-actions">
                        <span class="shortcut-hint">CTRL+ENTER</span>
                        <button class="submit-button" @click="submitComment" :disabled="!songCommentMutationSupported || !newComment.trim() || submitting">
                            <span>{{ submitting ? 'SENDING...' : 'SEND' }}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- 未登录提示 -->
        <div class="login-prompt" v-else-if="isDj && !userStore.user">
            <div class="prompt-frame">
                <div class="frame-corner frame-tl"></div>
                <div class="frame-corner frame-tr"></div>
                <div class="frame-corner frame-bl"></div>
                <div class="frame-corner frame-br"></div>
                <span class="prompt-text">LOGIN REQUIRED TO COMMENT</span>
            </div>
        </div>

        <div class="read-only-note" v-if="!isDj" role="note">
            <span class="read-only-code">READ ONLY</span>
            <span>酷狗开放接口当前支持评论浏览、筛选与楼层回复查看</span>
        </div>

        <section class="comment-filter-panel" v-if="!isDj && (classifyOptions.length > 0 || hotwordOptions.length > 0)" aria-label="评论筛选">
            <div class="filter-row" v-if="classifyOptions.length > 0">
                <span class="filter-label">分类</span>
                <div class="filter-options">
                    <button
                        type="button"
                        class="filter-chip"
                        :class="{ active: isFilterActive('all') }"
                        :aria-pressed="isFilterActive('all')"
                        :disabled="loading"
                        @click="selectCommentFilter('all')"
                    >
                        全部
                    </button>
                    <button
                        type="button"
                        class="filter-chip"
                        :class="{ active: isFilterActive('classify', option.id) }"
                        :aria-pressed="isFilterActive('classify', option.id)"
                        :disabled="loading"
                        v-for="option in classifyOptions"
                        :key="`classify-${option.id}`"
                        @click="selectCommentFilter('classify', option.id, option.label)"
                    >
                        {{ option.label }}<span class="filter-count">{{ option.count }}</span>
                    </button>
                    <button
                        type="button"
                        class="sort-button"
                        v-if="activeFilter.kind === 'classify'"
                        :disabled="loading"
                        :aria-label="`切换为${classifySort === 1 ? '倒序' : '正序'}排列`"
                        @click="toggleClassifySort"
                    >
                        {{ classifySort === 1 ? '正序' : '倒序' }}
                    </button>
                </div>
            </div>
            <div class="filter-row hotword-row" v-if="hotwordOptions.length > 0">
                <span class="filter-label">热词</span>
                <div class="filter-options">
                    <button
                        type="button"
                        class="filter-chip hotword-chip"
                        :class="{ active: isFilterActive('hotword', option.content) }"
                        :aria-pressed="isFilterActive('hotword', option.content)"
                        :disabled="loading"
                        v-for="option in hotwordOptions"
                        :key="`hotword-${option.content}`"
                        @click="selectCommentFilter('hotword', option.content, option.content)"
                    >
                        #{{ option.content }}<span class="filter-count">{{ option.count }}</span>
                    </button>
                </div>
            </div>
        </section>

        <!-- 精彩评论区域 -->
        <div class="hot-comments-section" v-if="hotComments.length > 0">
            <div class="section-header">
                <div class="section-title-wrapper">
                    <span class="section-title">HOT COMMENTS</span>
                    <span class="section-count">[{{ hotComments.length }}]</span>
                </div>
                <div class="section-line"></div>
            </div>

            <div class="comments-grid">
                <div class="comment-card hot-card" v-for="comment in hotComments" :key="comment.commentId">
                    <div class="card-frame">
                        <div class="frame-corner frame-tl"></div>
                        <div class="frame-corner frame-tr"></div>
                        <div class="frame-corner frame-bl"></div>
                        <div class="frame-corner frame-br"></div>
                    </div>

                    <div class="card-content">
                        <div class="comment-meta">
                            <div class="user-avatar">
                                <img :src="getUserAvatar(comment.user, 40)" :alt="getUserName(comment.user)" />
                                <div class="avatar-frame"></div>
                            </div>
                            <div class="user-info">
                                <span class="username">{{ getUserName(comment.user) }}</span>
                                <span class="timestamp">{{ formatTime(comment.time) }}</span>
                            </div>
                        </div>

                        <CommentText :text="comment.content" :enable-emoji="true" :copyable="true" :show-copy-button="false" @copy-success="handleCopySuccess" @copy-error="handleCopyError" />

                        <div class="comment-images" v-if="comment.images?.length">
                            <button
                                v-for="(image, imageIndex) in comment.images"
                                :key="`${comment.commentId}-image-${imageIndex}`"
                                type="button"
                                class="comment-image-button"
                                :aria-label="`放大查看${getUserName(comment.user)}的评论图片 ${imageIndex + 1}`"
                                @click="openImagePreview(image, $event.currentTarget)"
                            >
                                <img
                                    :src="image.url"
                                    :alt="`${getUserName(comment.user)}的评论图片 ${imageIndex + 1}`"
                                    :width="image.width || undefined"
                                    :height="image.height || undefined"
                                    loading="lazy"
                                />
                            </button>
                        </div>

                        <div class="comment-controls">
                            <button type="button" class="control-item like-control" :class="{ active: comment.liked, 'control-item-disabled': !songCommentMutationSupported }" :disabled="!songCommentMutationSupported" @click="toggleLikeComment(comment)">
                                <div class="control-icon">
                                    <svg viewBox="0 0 1024 1024" width="14" height="14">
                                        <path
                                            d="M736.603 35.674c-87.909 0-169.647 44.1-223.447 116.819C459.387 79.756 377.665 35.674 289.708 35.674c-158.47 0-287.397 140.958-287.397 314.233 0 103.371 46.177 175.887 83.296 234.151 107.88 169.236 379.126 379.846 390.616 388.725 11.068 8.557 24.007 12.837 36.917 12.837 12.939 0 25.861-4.28 36.917-12.837 11.503-8.879 282.765-219.488 390.614-388.725C977.808 525.793 1024 453.277 1024 349.907 1023.999 176.632 895.071 35.674 736.603 35.674z"
                                        />
                                    </svg>
                                </div>
                                <span class="control-text">{{ comment.likedCount > 0 ? comment.likedCount : 'LIKE' }}</span>
                            </button>

                            <button type="button" class="control-item reply-control" :class="{ 'control-item-disabled': !songCommentMutationSupported }" :disabled="!songCommentMutationSupported" @click="toggleReply(comment)">
                                <div class="control-icon">
                                    <svg viewBox="0 0 1024 1024" width="14" height="14">
                                        <path
                                            d="M853.333333 85.333333a85.333333 85.333333 0 0 1 85.333334 85.333334v469.333333a85.333333 85.333333 0 0 1-85.333334 85.333333H298.666667L128 896V170.666667a85.333333 85.333333 0 0 1 85.333333-85.333334h640z m0 85.333334H213.333333v530.773333L285.44 640H853.333333V170.666667z m-256 128v85.333333H256v-85.333333h341.333333z m0 170.666666v85.333334H256v-85.333334h341.333333z"
                                        />
                                    </svg>
                                </div>
                                <span class="control-text">REPLY</span>
                            </button>
                        </div>

                        <div class="floor-replies" v-if="getCommentReplyCount(comment) > 0">
                            <button
                                class="floor-toggle"
                                type="button"
                                :aria-expanded="!!getFloorState(comment)?.expanded"
                                :aria-busy="!!getFloorState(comment)?.loading"
                                :disabled="!!getFloorState(comment)?.loading"
                                @click="toggleFloorReplies(comment)"
                            >
                                <span v-if="getFloorState(comment)?.loading">加载回复中...</span>
                                <span v-else-if="!getFloorState(comment)?.expanded">展开{{ getCommentReplyCount(comment) }}条回复</span>
                                <span v-else>收起回复</span>
                            </button>

                            <div class="floor-panel" v-if="getFloorState(comment)?.expanded">
                                <div class="floor-list" v-if="(getFloorState(comment)?.items || []).length > 0">
                                    <div
                                        class="floor-item"
                                        :class="{ 'floor-item-nested': node.depth > 0, 'floor-item-reference': node.comment.referenceOnly }"
                                        :style="{ '--reply-depth': Math.min(node.depth, 4) }"
                                        v-for="node in getVisibleFloorReplies(comment)"
                                        :key="`floor-${comment.commentId}-${node.comment.commentId}`"
                                    >
                                        <div class="floor-avatar" v-if="!node.comment.referenceOnly">
                                            <img :src="getUserAvatar(node.comment.user, 24)" :alt="getUserName(node.comment.user)" />
                                        </div>
                                        <div class="floor-main">
                                            <div class="floor-item-meta">
                                                <span class="floor-username">{{ getUserName(node.comment.user) }}</span>
                                                <span class="floor-time">{{ node.comment.referenceOnly ? '被回复的评论' : formatTime(node.comment.time) }}</span>
                                            </div>
                                            <CommentText
                                                class="floor-text"
                                                :text="node.comment.content || ''"
                                                :enable-emoji="true"
                                                :copyable="true"
                                                :show-copy-button="false"
                                                @copy-success="handleCopySuccess"
                                                @copy-error="handleCopyError"
                                            />
                                            <div class="floor-controls" v-if="!node.comment.referenceOnly">
                                                <button type="button" class="floor-control-item floor-like" :class="{ active: node.comment.liked, 'floor-control-item-disabled': !songCommentMutationSupported }" :disabled="!songCommentMutationSupported" @click="toggleLikeComment(node.comment)">
                                                    <div class="floor-control-icon">
                                                        <svg viewBox="0 0 1024 1024" width="10" height="10">
                                                            <path
                                                                d="M736.603 35.674c-87.909 0-169.647 44.1-223.447 116.819C459.387 79.756 377.665 35.674 289.708 35.674c-158.47 0-287.397 140.958-287.397 314.233 0 103.371 46.177 175.887 83.296 234.151 107.88 169.236 379.126 379.846 390.616 388.725 11.068 8.557 24.007 12.837 36.917 12.837 12.939 0 25.861-4.28 36.917-12.837 11.503-8.879 282.765-219.488 390.614-388.725C977.808 525.793 1024 453.277 1024 349.907 1023.999 176.632 895.071 35.674 736.603 35.674z"
                                                            />
                                                        </svg>
                                                    </div>
                                                    <span class="floor-control-text">{{ (Number(node.comment.likedCount) || 0) > 0 ? node.comment.likedCount : 'LIKE' }}</span>
                                                </button>

                                                <button type="button" class="floor-control-item floor-reply" :class="{ 'floor-control-item-disabled': !songCommentMutationSupported }" :disabled="!songCommentMutationSupported" @click="toggleReply(node.comment, comment.commentId)">
                                                    <div class="floor-control-icon">
                                                        <svg viewBox="0 0 1024 1024" width="10" height="10">
                                                            <path
                                                                d="M853.333333 85.333333a85.333333 85.333333 0 0 1 85.333334 85.333334v469.333333a85.333333 85.333333 0 0 1-85.333334 85.333333H298.666667L128 896V170.666667a85.333333 85.333333 0 0 1 85.333333-85.333334h640z m0 85.333334H213.333333v530.773333L285.44 640H853.333333V170.666667z m-256 128v85.333333H256v-85.333333h341.333333z m0 170.666666v85.333334H256v-85.333334h341.333333z"
                                                            />
                                                        </svg>
                                                    </div>
                                                    <span class="floor-control-text">REPLY</span>
                                                </button>
                                            </div>
                                            <button
                                                class="floor-thread-toggle"
                                                type="button"
                                                v-if="node.descendantCount > 0"
                                                :aria-expanded="node.expanded"
                                                @click="toggleNestedReplies(comment, node.comment)"
                                            >
                                                {{ node.expanded ? '收起跟帖' : `展开${node.descendantCount}条跟帖` }}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <button type="button" class="floor-status floor-error" v-if="getFloorState(comment)?.error" @click="retryFloorReplies(comment)">
                                    {{ getFloorState(comment).error }}
                                </button>

                                <div class="floor-status floor-empty" v-else-if="!getFloorState(comment)?.loading && (getFloorState(comment)?.items || []).length === 0">暂无回复</div>

                                <button class="floor-more" type="button" v-if="getFloorState(comment)?.hasMore" :disabled="getFloorState(comment)?.loading" @click="loadMoreFloorReplies(comment)">
                                    {{ getFloorState(comment)?.loading ? '加载中...' : '展开更多回复' }}
                                </button>

                                <div class="floor-status floor-end" v-else-if="!getFloorState(comment)?.hasMore && (getFloorState(comment)?.items || []).length > 0">已展示全部回复</div>
                            </div>
                        </div>

                        <!-- 内联回复框 -->
                        <div class="inline-reply-box" v-if="isInlineReplyVisible(comment)">
                            <div class="reply-frame">
                                <div class="frame-corner frame-tl"></div>
                                <div class="frame-corner frame-tr"></div>
                                <div class="frame-corner frame-bl"></div>
                                <div class="frame-corner frame-br"></div>
                            </div>

                            <div class="reply-content">
                                <div class="reply-header">
                                    <span class="reply-prefix">REPLY TO</span>
                                    <span class="reply-target">{{ getUserName(replyingTo?.user || comment.user) }}</span>
                                    <button type="button" class="close-reply" aria-label="取消回复" @click="cancelReply()">×</button>
                                </div>

                                <div class="reply-input-wrapper">
                                    <textarea v-model="newComment" class="reply-textarea" :placeholder="songCommentMutationSupported ? 'INPUT YOUR REPLY...' : 'CURRENT BACKEND DOES NOT SUPPORT COMMENT REPLY'" :disabled="submitting || !songCommentMutationSupported" @keydown.enter.ctrl="submitComment"></textarea>
                                    <div class="reply-input-border"></div>
                                </div>

                                <div class="reply-actions">
                                    <span class="reply-shortcut-hint">CTRL+ENTER</span>
                                    <div class="reply-buttons">
                                        <button class="cancel-reply-btn" @click="cancelReply()">CANCEL</button>
                                        <button class="send-reply-btn" @click="submitComment" :disabled="!songCommentMutationSupported || !newComment.trim() || submitting">
                                            {{ submitting ? 'SENDING...' : 'SEND' }}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 最新评论区域 -->
        <div class="latest-comments-section">
            <div class="section-header">
                <div class="section-title-wrapper">
                    <span class="section-title">{{ commentSectionTitle }}</span>
                    <span class="section-count">[{{ total }}]</span>
                </div>
                <div class="section-line"></div>
            </div>

            <div class="comments-grid">
                <div class="comment-card" v-for="comment in comments" :key="comment.commentId">
                    <div class="card-frame">
                        <div class="frame-corner frame-tl"></div>
                        <div class="frame-corner frame-tr"></div>
                        <div class="frame-corner frame-bl"></div>
                        <div class="frame-corner frame-br"></div>
                    </div>

                    <div class="card-content">
                        <div class="comment-meta">
                            <div class="user-avatar">
                                <img :src="getUserAvatar(comment.user, 40)" :alt="getUserName(comment.user)" />
                                <div class="avatar-frame"></div>
                            </div>
                            <div class="user-info">
                                <span class="username">{{ getUserName(comment.user) }}</span>
                                <span class="timestamp">{{ formatTime(comment.time) }}</span>
                            </div>
                        </div>

                        <CommentText :text="comment.content" :enable-emoji="true" :copyable="true" :show-copy-button="false" @copy-success="handleCopySuccess" @copy-error="handleCopyError" />

                        <div class="comment-images" v-if="comment.images?.length">
                            <button
                                v-for="(image, imageIndex) in comment.images"
                                :key="`${comment.commentId}-image-${imageIndex}`"
                                type="button"
                                class="comment-image-button"
                                :aria-label="`放大查看${getUserName(comment.user)}的评论图片 ${imageIndex + 1}`"
                                @click="openImagePreview(image, $event.currentTarget)"
                            >
                                <img
                                    :src="image.url"
                                    :alt="`${getUserName(comment.user)}的评论图片 ${imageIndex + 1}`"
                                    :width="image.width || undefined"
                                    :height="image.height || undefined"
                                    loading="lazy"
                                />
                            </button>
                        </div>

                        <div class="comment-controls">
                            <button type="button" class="control-item like-control" :class="{ active: comment.liked, 'control-item-disabled': !songCommentMutationSupported }" :disabled="!songCommentMutationSupported" @click="toggleLikeComment(comment)">
                                <div class="control-icon">
                                    <svg viewBox="0 0 1024 1024" width="14" height="14">
                                        <path
                                            d="M736.603 35.674c-87.909 0-169.647 44.1-223.447 116.819C459.387 79.756 377.665 35.674 289.708 35.674c-158.47 0-287.397 140.958-287.397 314.233 0 103.371 46.177 175.887 83.296 234.151 107.88 169.236 379.126 379.846 390.616 388.725 11.068 8.557 24.007 12.837 36.917 12.837 12.939 0 25.861-4.28 36.917-12.837 11.503-8.879 282.765-219.488 390.614-388.725C977.808 525.793 1024 453.277 1024 349.907 1023.999 176.632 895.071 35.674 736.603 35.674z"
                                        />
                                    </svg>
                                </div>
                                <span class="control-text">{{ comment.likedCount > 0 ? comment.likedCount : 'LIKE' }}</span>
                            </button>

                            <button type="button" class="control-item reply-control" :class="{ 'control-item-disabled': !songCommentMutationSupported }" :disabled="!songCommentMutationSupported" @click="toggleReply(comment)">
                                <div class="control-icon">
                                    <svg viewBox="0 0 1024 1024" width="14" height="14">
                                        <path
                                            d="M853.333333 85.333333a85.333333 85.333333 0 0 1 85.333334 85.333334v469.333333a85.333333 85.333333 0 0 1-85.333334 85.333333H298.666667L128 896V170.666667a85.333333 85.333333 0 0 1 85.333333-85.333334h640z m0 85.333334H213.333333v530.773333L285.44 640H853.333333V170.666667z m-256 128v85.333333H256v-85.333333h341.333333z m0 170.666666v85.333334H256v-85.333334h341.333333z"
                                        />
                                    </svg>
                                </div>
                                <span class="control-text">REPLY</span>
                            </button>
                        </div>

                        <div class="floor-replies" v-if="getCommentReplyCount(comment) > 0">
                            <button
                                class="floor-toggle"
                                type="button"
                                :aria-expanded="!!getFloorState(comment)?.expanded"
                                :aria-busy="!!getFloorState(comment)?.loading"
                                :disabled="!!getFloorState(comment)?.loading"
                                @click="toggleFloorReplies(comment)"
                            >
                                <span v-if="getFloorState(comment)?.loading">加载回复中...</span>
                                <span v-else-if="!getFloorState(comment)?.expanded">展开{{ getCommentReplyCount(comment) }}条回复</span>
                                <span v-else>收起回复</span>
                            </button>

                            <div class="floor-panel" v-if="getFloorState(comment)?.expanded">
                                <div class="floor-list" v-if="(getFloorState(comment)?.items || []).length > 0">
                                    <div
                                        class="floor-item"
                                        :class="{ 'floor-item-nested': node.depth > 0, 'floor-item-reference': node.comment.referenceOnly }"
                                        :style="{ '--reply-depth': Math.min(node.depth, 4) }"
                                        v-for="node in getVisibleFloorReplies(comment)"
                                        :key="`floor-${comment.commentId}-${node.comment.commentId}`"
                                    >
                                        <div class="floor-avatar" v-if="!node.comment.referenceOnly">
                                            <img :src="getUserAvatar(node.comment.user, 24)" :alt="getUserName(node.comment.user)" />
                                        </div>
                                        <div class="floor-main">
                                            <div class="floor-item-meta">
                                                <span class="floor-username">{{ getUserName(node.comment.user) }}</span>
                                                <span class="floor-time">{{ node.comment.referenceOnly ? '被回复的评论' : formatTime(node.comment.time) }}</span>
                                            </div>
                                            <CommentText
                                                class="floor-text"
                                                :text="node.comment.content || ''"
                                                :enable-emoji="true"
                                                :copyable="true"
                                                :show-copy-button="false"
                                                @copy-success="handleCopySuccess"
                                                @copy-error="handleCopyError"
                                            />
                                            <div class="floor-controls" v-if="!node.comment.referenceOnly">
                                                <button type="button" class="floor-control-item floor-like" :class="{ active: node.comment.liked, 'floor-control-item-disabled': !songCommentMutationSupported }" :disabled="!songCommentMutationSupported" @click="toggleLikeComment(node.comment)">
                                                    <div class="floor-control-icon">
                                                        <svg viewBox="0 0 1024 1024" width="10" height="10">
                                                            <path
                                                                d="M736.603 35.674c-87.909 0-169.647 44.1-223.447 116.819C459.387 79.756 377.665 35.674 289.708 35.674c-158.47 0-287.397 140.958-287.397 314.233 0 103.371 46.177 175.887 83.296 234.151 107.88 169.236 379.126 379.846 390.616 388.725 11.068 8.557 24.007 12.837 36.917 12.837 12.939 0 25.861-4.28 36.917-12.837 11.503-8.879 282.765-219.488 390.614-388.725C977.808 525.793 1024 453.277 1024 349.907 1023.999 176.632 895.071 35.674 736.603 35.674z"
                                                            />
                                                        </svg>
                                                    </div>
                                                    <span class="floor-control-text">{{ (Number(node.comment.likedCount) || 0) > 0 ? node.comment.likedCount : 'LIKE' }}</span>
                                                </button>

                                                <button type="button" class="floor-control-item floor-reply" :class="{ 'floor-control-item-disabled': !songCommentMutationSupported }" :disabled="!songCommentMutationSupported" @click="toggleReply(node.comment, comment.commentId)">
                                                    <div class="floor-control-icon">
                                                        <svg viewBox="0 0 1024 1024" width="10" height="10">
                                                            <path
                                                                d="M853.333333 85.333333a85.333333 85.333333 0 0 1 85.333334 85.333334v469.333333a85.333333 85.333333 0 0 1-85.333334 85.333333H298.666667L128 896V170.666667a85.333333 85.333333 0 0 1 85.333333-85.333334h640z m0 85.333334H213.333333v530.773333L285.44 640H853.333333V170.666667z m-256 128v85.333333H256v-85.333333h341.333333z m0 170.666666v85.333334H256v-85.333334h341.333333z"
                                                            />
                                                        </svg>
                                                    </div>
                                                    <span class="floor-control-text">REPLY</span>
                                                </button>
                                            </div>
                                            <button
                                                class="floor-thread-toggle"
                                                type="button"
                                                v-if="node.descendantCount > 0"
                                                :aria-expanded="node.expanded"
                                                @click="toggleNestedReplies(comment, node.comment)"
                                            >
                                                {{ node.expanded ? '收起跟帖' : `展开${node.descendantCount}条跟帖` }}
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                <button type="button" class="floor-status floor-error" v-if="getFloorState(comment)?.error" @click="retryFloorReplies(comment)">
                                    {{ getFloorState(comment).error }}
                                </button>

                                <div class="floor-status floor-empty" v-else-if="!getFloorState(comment)?.loading && (getFloorState(comment)?.items || []).length === 0">暂无回复</div>

                                <button class="floor-more" type="button" v-if="getFloorState(comment)?.hasMore" :disabled="getFloorState(comment)?.loading" @click="loadMoreFloorReplies(comment)">
                                    {{ getFloorState(comment)?.loading ? '加载中...' : '展开更多回复' }}
                                </button>

                                <div class="floor-status floor-end" v-else-if="!getFloorState(comment)?.hasMore && (getFloorState(comment)?.items || []).length > 0">已展示全部回复</div>
                            </div>
                        </div>

                        <!-- 内联回复框 -->
                        <div class="inline-reply-box" v-if="isInlineReplyVisible(comment)">
                            <div class="reply-frame">
                                <div class="frame-corner frame-tl"></div>
                                <div class="frame-corner frame-tr"></div>
                                <div class="frame-corner frame-bl"></div>
                                <div class="frame-corner frame-br"></div>
                            </div>

                            <div class="reply-content">
                                <div class="reply-header">
                                    <span class="reply-prefix">REPLY TO</span>
                                    <span class="reply-target">{{ getUserName(replyingTo?.user || comment.user) }}</span>
                                    <button type="button" class="close-reply" aria-label="取消回复" @click="cancelReply()">×</button>
                                </div>

                                <div class="reply-input-wrapper">
                                    <textarea v-model="newComment" class="reply-textarea" placeholder="INPUT YOUR REPLY..." :disabled="submitting" @keydown.enter.ctrl="submitComment"></textarea>
                                    <div class="reply-input-border"></div>
                                </div>

                                <div class="reply-actions">
                                    <span class="reply-shortcut-hint">CTRL+ENTER</span>
                                    <div class="reply-buttons">
                                        <button class="cancel-reply-btn" @click="cancelReply()">CANCEL</button>
                                        <button class="send-reply-btn" @click="submitComment" :disabled="!newComment.trim() || submitting">
                                            {{ submitting ? 'SENDING...' : 'SEND' }}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 状态提示区域 -->
            <div class="status-section">
                <button type="button" class="error-status" v-if="!loading && loadError" @click="retryComments">
                    <span>{{ loadError }}</span>
                </button>

                <!-- 加载中 -->
                <div class="loading-status" v-if="loading">
                    <div class="loading-frame">
                        <div class="frame-corner frame-tl"></div>
                        <div class="frame-corner frame-tr"></div>
                        <div class="frame-corner frame-bl"></div>
                        <div class="frame-corner frame-br"></div>
                    </div>
                    <div class="loading-content">
                        <div class="loading-indicator"></div>
                        <span class="loading-text">LOADING...</span>
                    </div>
                </div>

                <!-- 暂无更多 -->
                <div class="no-more-status" v-if="!loadError && !hasMore && comments.length > 0">
                    <div class="status-frame">
                        <div class="frame-corner frame-tl"></div>
                        <div class="frame-corner frame-tr"></div>
                        <div class="frame-corner frame-bl"></div>
                        <div class="frame-corner frame-br"></div>
                    </div>
                    <span class="status-text">NO MORE COMMENTS</span>
                </div>

                <!-- 暂无评论 -->
                <div class="empty-status" v-if="!loading && !loadError && comments.length === 0 && hotComments.length === 0">
                    <div class="status-frame">
                        <div class="frame-corner frame-tl"></div>
                        <div class="frame-corner frame-tr"></div>
                        <div class="frame-corner frame-bl"></div>
                        <div class="frame-corner frame-br"></div>
                    </div>
                    <span class="status-text">NO COMMENTS YET</span>
                </div>
            </div>
        </div>
    </div>

    <Teleport to="body">
        <Transition name="image-preview">
            <div
                v-if="imagePreview"
                class="image-preview-layer"
                role="dialog"
                aria-modal="true"
                :aria-label="imagePreview.label || '评论图片预览'"
                @click.self="closeImagePreview"
                @keydown.esc.stop.prevent="closeImagePreview"
                @keydown.tab="trapImagePreviewFocus"
            >
                <div class="image-preview-dialog">
                    <img
                        :src="imagePreview.url"
                        :alt="imagePreview.label || '评论图片预览'"
                        :width="imagePreview.width || undefined"
                        :height="imagePreview.height || undefined"
                    />
                    <button ref="imagePreviewCloseRef" type="button" class="image-preview-close" aria-label="关闭图片预览" @click="closeImagePreview">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M5 5l14 14M19 5L5 19" />
                        </svg>
                    </button>
                    <span class="image-preview-hint">点击空白处或按 ESC 关闭</span>
                </div>
            </div>
        </Transition>
    </Teleport>
</template>

<style scoped lang="scss">
// 明日方舟风格评论区样式
.arknights-comments {
    width: 100%;
    height: 100%;
    padding: 20px;
    overflow-y: auto;
    background: rgba(255, 255, 255, 0.35);
    backdrop-filter: blur(10px);
    font-family: SourceHanSansCN-Bold, Bender-Bold, monospace;

    // 自定义滚动条
    &::-webkit-scrollbar {
        width: 3px;
    }

    &::-webkit-scrollbar-track {
        background: rgba(0, 0, 0, 0.1);
    }

    &::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.4);

        &:hover {
            background: rgba(0, 0, 0, 0.6);
        }
    }
}

// 通用框架样式
.frame-corner {
    position: absolute;
    width: 8px;
    height: 8px;
    border: 2px solid #000;

    &.frame-tl {
        top: -1px;
        left: -1px;
        border-bottom: none;
        border-right: none;
    }

    &.frame-tr {
        top: -1px;
        right: -1px;
        border-bottom: none;
        border-left: none;
    }

    &.frame-bl {
        bottom: -1px;
        left: -1px;
        border-top: none;
        border-right: none;
    }

    &.frame-br {
        bottom: -1px;
        right: -1px;
        border-top: none;
        border-left: none;
    }
}

// 评论区标题
.comments-header {
    margin-bottom: 24px;

    .header-frame {
        position: relative;
        padding: 16px 24px;
        background: rgba(255, 255, 255, 0.4);
        border: 1px solid rgba(0, 0, 0, 0.2);
    }

    .header-title-wrapper {
        text-align: center;
        position: relative;
    }

    .header-title {
        font-family: Bender-Bold, monospace;
        font-size: 18px;
        font-weight: bold;
        color: #000;
        letter-spacing: 2px;
        text-transform: uppercase;
    }

    .title-underline {
        width: 60px;
        height: 2px;
        background: #000;
        margin: 8px auto 0;
    }
}

// 评论输入区域
.comment-input-section {
    margin-bottom: 32px;

    .input-frame {
        position: relative;
        background: rgba(255, 255, 255, 0.3);
        border: 1px solid rgba(0, 0, 0, 0.15);
    }

    .input-content {
        padding: 20px;
    }

    .reply-info {
        display: flex;
        align-items: center;
        margin-bottom: 16px;
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.05);
        border-left: 3px solid #000;

        .reply-prefix {
            font-family: Bender-Bold, monospace;
            font-size: 10px;
            color: rgba(0, 0, 0, 0.6);
            margin-right: 8px;
            letter-spacing: 1px;
        }

        .reply-target {
            font-family: SourceHanSansCN-Bold;
            font-size: 12px;
            color: #000;
            font-weight: bold;
            flex: 1;
        }

        .cancel-reply {
            width: 20px;
            height: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.1);
            color: #000;
            cursor: pointer;
            font-size: 16px;
            line-height: 1;
            transition: all 0.2s;

            &:hover {
                background: rgba(0, 0, 0, 0.2);
                transform: scale(1.1);
            }
        }
    }

    .input-wrapper {
        position: relative;
        margin-bottom: 16px;
    }

    .comment-textarea {
        width: 100%;
        min-height: 80px;
        padding: 12px 16px;
        background: rgba(255, 255, 255, 0.6);
        border: none;
        outline: none;
        font-family: SourceHanSansCN-Bold;
        font-size: 14px;
        color: #000;
        resize: vertical;

        &::placeholder {
            color: rgba(0, 0, 0, 0.4);
            font-family: Bender-Bold, monospace;
            font-size: 12px;
            letter-spacing: 1px;
        }

        &:focus {
            background: rgba(255, 255, 255, 0.8);

            + .input-border {
                border-color: #000;
            }
        }
    }

    .input-border {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        border: 2px solid rgba(0, 0, 0, 0.2);
        pointer-events: none;
        transition: border-color 0.2s;
    }

    .input-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;

        .shortcut-hint {
            font-family: Bender-Bold, monospace;
            font-size: 10px;
            color: rgba(0, 0, 0, 0.5);
            letter-spacing: 1px;
        }

        .submit-button {
            position: relative;
            padding: 10px 20px;
            background: #000;
            color: #fff;
            border: none;
            cursor: pointer;
            font-family: Bender-Bold, monospace;
            font-size: 12px;
            font-weight: bold;
            letter-spacing: 1px;
            transition: all 0.2s;
            text-transform: uppercase;

            &:hover:not(:disabled) {
                background: rgba(0, 0, 0, 0.8);
                transform: translateY(-1px);
            }

            &:active:not(:disabled) {
                transform: translateY(0);
            }

            &:disabled {
                background: rgba(0, 0, 0, 0.3);
                cursor: not-allowed;
            }
        }
    }
}

// 未登录提示
.login-prompt {
    margin-bottom: 32px;

    .prompt-frame {
        position: relative;
        padding: 20px;
        background: rgba(255, 255, 255, 0.25);
        border: 1px solid rgba(0, 0, 0, 0.1);
        text-align: center;
    }

    .prompt-text {
        font-family: Bender-Bold, monospace;
        font-size: 14px;
        color: rgba(0, 0, 0, 0.6);
        letter-spacing: 1px;
    }
}

.read-only-note {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    margin-bottom: 20px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.28);
    border: 1px solid rgba(0, 0, 0, 0.12);
    color: rgba(0, 0, 0, 0.72);
    font-family: SourceHanSansCN-Bold;
    font-size: 12px;
    line-height: 1.5;
}

.read-only-code {
    flex-shrink: 0;
    padding: 3px 6px;
    background: #000;
    color: #fff;
    font-family: Bender-Bold, monospace;
    font-size: 10px;
    letter-spacing: 0.8px;
}

.comment-filter-panel {
    margin-bottom: 24px;
    padding: 12px 14px;
    background: rgba(255, 255, 255, 0.24);
    border: 1px solid rgba(0, 0, 0, 0.12);
}

.filter-row {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    align-items: start;
    gap: 10px;

    & + & {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(0, 0, 0, 0.1);
    }
}

.filter-label {
    padding-top: 13px;
    color: rgba(0, 0, 0, 0.58);
    font-family: SourceHanSansCN-Bold;
    font-size: 11px;
    letter-spacing: 0.5px;
}

.filter-options {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
}

.filter-chip,
.sort-button {
    min-height: 44px;
    padding: 8px 11px;
    border: 1px solid rgba(0, 0, 0, 0.16);
    background: rgba(255, 255, 255, 0.38);
    color: rgba(0, 0, 0, 0.76);
    cursor: pointer;
    font-family: SourceHanSansCN-Bold;
    font-size: 12px;
    line-height: 1.2;
    transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;

    &:hover:not(:disabled) {
        border-color: rgba(0, 0, 0, 0.42);
        background: rgba(255, 255, 255, 0.64);
    }

    &:focus-visible {
        outline: 2px solid #000;
        outline-offset: 2px;
    }

    &:disabled {
        cursor: wait;
        opacity: 0.58;
    }

    &.active {
        border-color: #000;
        background: #000;
        color: #fff;
    }
}

.filter-count {
    margin-left: 6px;
    font-family: Bender-Bold, monospace;
    font-size: 10px;
    opacity: 0.68;
}

.sort-button {
    border-style: dashed;
}

// 区块标题
.section-header {
    display: flex;
    align-items: center;
    margin-bottom: 14px;

    .section-title-wrapper {
        display: flex;
        align-items: baseline;
        margin-right: 12px;
    }

    .section-title {
        font-family: Bender-Bold, monospace;
        font-size: 13px;
        font-weight: bold;
        color: #000;
        letter-spacing: 1px;
        margin-right: 6px;
    }

.section-count {
        font-family: Bender-Bold, monospace;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.72);
    }

    .section-line {
        flex: 1;
        height: 1px;
        background: rgba(0, 0, 0, 0.2);
    }
}

// 评论区域
.hot-comments-section {
    margin-bottom: 24px;
}

.latest-comments-section {
    .comments-grid {
        margin-bottom: 18px;
    }
}

.comments-grid {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

// 评论卡片
.comment-card {
    position: relative;
    background: rgba(255, 255, 255, 0.28);
    border: 1px solid rgba(0, 0, 0, 0.1);
    border-left: 3px solid rgba(0, 0, 0, 0.28);
    transition-property: transform, border-color, box-shadow;
    transition-duration: 0.2s;
    transition-timing-function: ease;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    will-change: transform;

    &:hover {
        background: rgba(255, 255, 255, 0.28);
        transform: translateY(-1px);
    }

    &.hot-card {
        border-left-color: rgba(233, 192, 104, 0.76);
    }

    .card-frame {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
    }

    .card-content {
        position: relative;
        padding: 12px 14px;
        -webkit-font-smoothing: antialiased;
        text-rendering: optimizeLegibility;
    }
}

// 评论元信息
.comment-meta {
    display: flex;
    align-items: center;
    margin-bottom: 8px;

    .user-avatar {
        position: relative;
        margin-right: 10px;

        img {
            width: 28px;
            height: 28px;
            object-fit: cover;
        }

        .avatar-frame {
            position: absolute;
            top: -2px;
            left: -2px;
            right: -2px;
            bottom: -2px;
            border: 2px solid rgba(0, 0, 0, 0.2);
        }
    }

    .user-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1px;
    }

    .username {
        font-family: SourceHanSansCN-Bold;
        font-size: 13px;
        font-weight: bold;
        color: #000;
        text-align: left;
    }

    .timestamp {
        font-family: Bender-Bold, monospace;
        font-size: 11px;
        color: rgba(0, 0, 0, 0.62);
        letter-spacing: 0.5px;
        text-align: left;
    }
}

// 评论内容 - 更新为适配CommentText组件
.comment-text {
    font-family: SourceHanSansCN-Bold;
    font-size: 13px;
    color: rgba(0, 0, 0, 0.85);
    line-height: 1.45;
    margin-bottom: 9px;
    word-break: break-word;
    text-align: left;
    user-select: text;
    cursor: text;

    // 表情样式优化
    :deep(.emoji) {
        font-size: 16px;
        vertical-align: middle;
        margin: 0 1px;
        display: inline-block;
        animation: none;
        transition: transform 0.2s ease;
    }

    :deep(.emoji:hover) {
        transform: scale(1.1);
    }

    // 移除悬停时的复制提示
    &:hover {
        position: relative;
    }
}

.comment-images {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    margin: 8px 0 10px;

    .comment-image-button {
        display: block;
        width: 100%;
        min-width: 0;
        padding: 0;
        overflow: hidden;
        border: none;
        background: transparent;
        cursor: zoom-in;
        touch-action: manipulation;

        &:hover img {
            transform: scale(1.02);
        }

        &:focus-visible {
            outline: 2px solid #000;
            outline-offset: 2px;
        }
    }

    img {
        display: block;
        width: 100%;
        max-height: 260px;
        object-fit: cover;
        background: rgba(0, 0, 0, 0.06);
        border: 1px solid rgba(0, 0, 0, 0.12);
        transition: transform 0.2s ease;
    }
}

.image-preview-layer {
    position: fixed;
    inset: 0;
    z-index: 3000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(4, 6, 8, 0.9);
    backdrop-filter: blur(10px);
}

.image-preview-dialog {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    max-width: 100%;
    max-height: 100%;

    > img {
        display: block;
        max-width: calc(100vw - 48px);
        max-height: calc(100vh - 48px);
        object-fit: contain;
        background: #0a0c0e;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
    }
}

.image-preview-close {
    position: absolute;
    top: 10px;
    right: 10px;
    display: grid;
    width: 44px;
    height: 44px;
    place-items: center;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.48);
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    cursor: pointer;
    transition: background-color 0.2s ease, border-color 0.2s ease;

    svg {
        width: 20px;
        height: 20px;
        fill: none;
        stroke: currentColor;
        stroke-linecap: square;
        stroke-width: 1.8;
    }

    &:hover {
        border-color: #fff;
        background: #000;
    }

    &:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 3px;
    }
}

.image-preview-hint {
    position: absolute;
    bottom: 10px;
    left: 50%;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.72);
    color: rgba(255, 255, 255, 0.82);
    font-family: SourceHanSansCN-Bold;
    font-size: 11px;
    line-height: 1.4;
    white-space: nowrap;
    transform: translateX(-50%);
    pointer-events: none;
}

.image-preview-enter-active,
.image-preview-leave-active {
    transition: opacity 0.2s ease;

    .image-preview-dialog {
        transition: transform 0.2s ease;
    }
}

.image-preview-enter-from,
.image-preview-leave-to {
    opacity: 0;

    .image-preview-dialog {
        transform: scale(0.98);
    }
}

@media (prefers-reduced-motion: reduce) {
    .comment-images img,
    .image-preview-layer,
    .image-preview-dialog {
        transition: none !important;
    }
}

// 评论控制按钮
.comment-controls {
    display: flex;
    align-items: center;
    gap: 12px;

    .control-item {
        display: flex;
        align-items: center;
        gap: 5px;
        cursor: pointer;
        transition: all 0.2s;
        padding: 3px 7px;
        border: none;
        background: rgba(0, 0, 0, 0.05);
        font: inherit;

        &:hover {
            background: rgba(0, 0, 0, 0.1);
            transform: translateY(-1px);
        }

        &.control-item-disabled {
            opacity: 0.45;
            cursor: not-allowed;

            &:hover {
                background: rgba(0, 0, 0, 0.05);
                transform: none;
            }
        }

        &.active {
            background: rgba(0, 0, 0, 0.15);

            .control-icon svg {
                fill: #ff4757;
            }

            .control-text {
                color: #ff4757;
            }
        }

        .control-icon {
            display: flex;
            align-items: center;
            justify-content: center;

            svg {
                fill: rgba(0, 0, 0, 0.6);
                transition: fill 0.2s;
            }
        }

        .control-text {
            font-family: Bender-Bold, monospace;
            font-size: 11px;
            color: rgba(0, 0, 0, 0.72);
            letter-spacing: 0.35px;
            font-weight: bold;
        }
    }
}

.floor-replies {
    margin-top: 10px;
    padding-left: 0;

    .floor-toggle {
        min-height: 32px;
        border: none;
        margin-top: 0;
        padding: 4px 8px;
        background: rgba(0, 0, 0, 0.08);
        cursor: pointer;
        font-family: SourceHanSansCN-Bold;
        font-size: 12px;
        font-weight: bold;
        letter-spacing: 0.2px;
        color: rgba(0, 0, 0, 0.76);
        transition: all 0.2s;
        border-radius: 0;
        outline: none;
        box-shadow: none;
        -webkit-tap-highlight-color: transparent;

        &:hover {
            background: rgba(0, 0, 0, 0.14);
            color: rgba(0, 0, 0, 0.86);
        }

        &:focus {
            outline: none;
            box-shadow: none;
        }

        &:focus-visible {
            outline: 2px solid #000;
            outline-offset: 2px;
        }

        &:disabled {
            opacity: 0.62;
            cursor: wait;
        }
    }

    .floor-panel {
        margin-top: 8px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(0, 0, 0, 0.08);
        border-radius: 0;
    }

    .floor-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .floor-item,
    .floor-item:hover,
    .floor-item:focus-within {
        background: rgba(176, 209, 217, 0.07);
    }

    .floor-item {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 6px 8px;
        margin-left: calc(var(--reply-depth, 0) * 18px);
        border-left: 2px solid rgba(0, 0, 0, 0.2);
        border-radius: 0;
        transition: background-color 0.2s ease, border-color 0.2s ease;
    }

    .floor-item-nested {
        border-left-color: rgba(0, 0, 0, 0.34);
    }

    .floor-item-reference {
        background: rgba(0, 0, 0, 0.035);
        border-left-style: dashed;

        .floor-time {
            letter-spacing: 0.2px;
        }
    }

    .floor-avatar {
        width: 22px;
        height: 22px;
        flex-shrink: 0;
        border: 1px solid rgba(0, 0, 0, 0.18);
        overflow: hidden;
        border-radius: 0;

        img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
    }

    .floor-main {
        flex: 1;
        min-width: 0;
    }

    .floor-item-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
    }

    .floor-username {
        font-family: SourceHanSansCN-Bold;
        font-size: 12px;
        font-weight: bold;
        color: rgba(0, 0, 0, 0.82);
    }

    .floor-time {
        font-family: Bender-Bold, monospace;
        font-size: 10px;
        letter-spacing: 0.4px;
        color: rgba(0, 0, 0, 0.58);
    }

    .floor-text {
        font-family: SourceHanSansCN-Bold;
        font-size: 12px;
        line-height: 1.45;
        color: rgba(0, 0, 0, 0.82);
    }

    .floor-controls {
        margin-top: 5px;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .floor-control-item {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 5px;
        border: none;
        background: rgba(0, 0, 0, 0.05);
        cursor: pointer;
        transition: all 0.2s;
        border-radius: 0;

        &:hover {
            background: rgba(0, 0, 0, 0.11);
            transform: translateY(-1px);
        }

        .floor-control-icon {
            display: flex;
            align-items: center;
            justify-content: center;

            svg {
                fill: rgba(0, 0, 0, 0.58);
                transition: fill 0.2s;
            }
        }

        .floor-control-text {
            font-family: Bender-Bold, monospace;
            font-size: 10px;
            font-weight: bold;
            letter-spacing: 0.4px;
            color: rgba(0, 0, 0, 0.68);
        }

        &.active {
            .floor-control-icon svg,
            .floor-control-text {
                fill: #ff4757;
                color: #ff4757;
            }
        }

        &.floor-control-item-disabled {
            opacity: 0.45;
            cursor: not-allowed;

            &:hover {
                background: rgba(0, 0, 0, 0.05);
                transform: none;
            }
        }
    }

    .floor-thread-toggle {
        min-height: 32px;
        margin-top: 6px;
        padding: 4px 8px;
        border: none;
        background: rgba(0, 0, 0, 0.07);
        color: rgba(0, 0, 0, 0.72);
        font-family: SourceHanSansCN-Bold;
        font-size: 11px;
        font-weight: bold;
        cursor: pointer;
        transition: background-color 0.2s ease, color 0.2s ease;

        &:hover {
            background: rgba(0, 0, 0, 0.13);
            color: rgba(0, 0, 0, 0.88);
        }

        &:focus-visible {
            outline: 2px solid #000;
            outline-offset: 2px;
        }
    }

    .floor-more {
        margin-top: 8px;
        border: none;
        background: rgba(0, 0, 0, 0.08);
        color: rgba(0, 0, 0, 0.74);
        font-family: SourceHanSansCN-Bold;
        font-size: 12px;
        font-weight: bold;
        letter-spacing: 0.2px;
        padding: 4px 8px;
        cursor: pointer;
        transition: all 0.2s;
        border-radius: 0;
        outline: none;
        box-shadow: none;
        -webkit-tap-highlight-color: transparent;

        &:hover:not(:disabled) {
            background: rgba(0, 0, 0, 0.14);
            color: rgba(0, 0, 0, 0.86);
        }

        &:focus {
            outline: none;
            box-shadow: none;
        }


        &:focus-visible {
            outline: 2px solid #000;
            outline-offset: 2px;
        }

        &:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
    }

    .floor-status {
        margin-top: 8px;
        font-family: SourceHanSansCN-Bold;
        font-size: 11px;
        letter-spacing: 0.2px;
        color: rgba(0, 0, 0, 0.64);
    }

    .floor-error {
        display: block;
        padding: 0;
        border: none;
        background: transparent;
        color: #d64545;
        cursor: pointer;

        &:hover {
            color: #b82f2f;
        }
    }
}

// 状态区域
.status-section {
    display: flex;
    justify-content: center;
    margin-top: 24px;
}

// 加载状态
.loading-status {
    position: relative;
    padding: 16px 24px;
    background: rgba(255, 255, 255, 0.25);
    border: 1px solid rgba(0, 0, 0, 0.1);

    .loading-content {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
    }

    .loading-indicator {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(0, 0, 0, 0.2);
        border-top: 2px solid #000;
        animation: arknights-spin 1s linear infinite;
    }

    .loading-text {
        font-family: Bender-Bold, monospace;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.6);
        letter-spacing: 1px;
    }
}

.error-status {
    min-height: 44px;
    padding: 10px 16px;
    border: 1px solid rgba(194, 53, 53, 0.42);
    background: rgba(194, 53, 53, 0.08);
    color: #a62929;
    cursor: pointer;
    font-family: SourceHanSansCN-Bold;
    font-size: 12px;

    &:hover {
        background: rgba(194, 53, 53, 0.14);
    }

    &:focus-visible {
        outline: 2px solid #a62929;
        outline-offset: 2px;
    }
}

// 其他状态
.no-more-status,
.empty-status {
    position: relative;
    padding: 16px 24px;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid rgba(0, 0, 0, 0.08);
    text-align: center;

    .status-text {
        font-family: Bender-Bold, monospace;
        font-size: 12px;
        color: rgba(0, 0, 0, 0.5);
        letter-spacing: 1px;
    }
}

// 动画
@keyframes arknights-spin {
    0% {
        transform: rotate(0deg);
    }
    100% {
        transform: rotate(360deg);
    }
}

// 响应式设计
// 内联回复框样式
.inline-reply-box {
    margin-top: 12px;
    background: rgba(255, 255, 255, 0.15);
    border: 1px solid rgba(0, 0, 0, 0.1);
    position: relative;

    .reply-frame {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
    }

    .reply-content {
        position: relative;
        padding: 12px;
    }

    .reply-header {
        display: flex;
        align-items: center;
        margin-bottom: 10px;
        padding: 5px 8px;
        background: rgba(0, 0, 0, 0.05);
        border-left: 2px solid #000;

        .reply-prefix {
            font-family: Bender-Bold, monospace;
            font-size: 10px;
            color: rgba(0, 0, 0, 0.7);
            margin-right: 6px;
            letter-spacing: 0.8px;
        }

        .reply-target {
            font-family: SourceHanSansCN-Bold;
            font-size: 12px;
            color: #000;
            font-weight: bold;
            flex: 1;
        }

        .close-reply {
            width: 16px;
            height: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.1);
            border: none;
            color: #000;
            cursor: pointer;
            font-size: 12px;
            line-height: 1;
            transition: all 0.2s;

            &:hover {
                background: rgba(0, 0, 0, 0.2);
                transform: scale(1.1);
            }
        }
    }

    .reply-input-wrapper {
        position: relative;
        margin-bottom: 10px;
    }

    .reply-textarea {
        width: 100%;
        min-height: 52px;
        padding: 8px 10px;
        background: rgba(255, 255, 255, 0.6);
        border: none;
        outline: none;
        font-family: SourceHanSansCN-Bold;
        font-size: 12px;
        color: #000;
        resize: vertical;

        &::placeholder {
            color: rgba(0, 0, 0, 0.4);
            font-family: Bender-Bold, monospace;
            font-size: 10px;
            letter-spacing: 0.5px;
        }

        &:focus {
            background: rgba(255, 255, 255, 0.8);

            + .reply-input-border {
                border-color: #000;
            }
        }
    }

    .reply-input-border {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        border: 1px solid rgba(0, 0, 0, 0.2);
        pointer-events: none;
        transition: border-color 0.2s;
    }

    .reply-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;

        .reply-shortcut-hint {
            font-family: Bender-Bold, monospace;
            font-size: 10px;
            color: rgba(0, 0, 0, 0.58);
            letter-spacing: 0.5px;
        }

        .reply-buttons {
            display: flex;
            gap: 8px;
        }

        .cancel-reply-btn,
        .send-reply-btn {
            padding: 5px 10px;
            border: none;
            cursor: pointer;
            font-family: Bender-Bold, monospace;
            font-size: 10px;
            font-weight: bold;
            letter-spacing: 0.5px;
            transition: all 0.2s;
            text-transform: uppercase;

            &:hover {
                transform: translateY(-1px);
            }

            &:active {
                transform: translateY(0);
            }
        }

        .cancel-reply-btn {
            background: rgba(0, 0, 0, 0.1);
            color: rgba(0, 0, 0, 0.7);

            &:hover {
                background: rgba(0, 0, 0, 0.15);
            }
        }

        .send-reply-btn {
            background: #000;
            color: #fff;

            &:hover:not(:disabled) {
                background: rgba(0, 0, 0, 0.8);
            }

            &:disabled {
                background: rgba(0, 0, 0, 0.3);
                cursor: not-allowed;
                transform: none;
            }
        }
    }
}

@media (max-width: 768px) {
    .arknights-comments {
        padding: 16px;
    }

    .filter-row {
        grid-template-columns: 1fr;
        gap: 6px;
    }

    .filter-label {
        padding-top: 0;
    }

    .comment-images {
        grid-template-columns: 1fr;
    }

    .comment-card .card-content {
        padding: 10px 12px;
    }

    .comment-meta .user-avatar {
        img {
            width: 24px;
            height: 24px;
        }
    }

    .header-title {
        font-size: 16px;
    }

    .section-title {
        font-size: 12px;
    }

    .floor-replies {
        padding-left: 0;

        .floor-panel {
            padding: 7px 8px;
        }

        .floor-item {
            padding: 5px 6px;
            gap: 6px;
            margin-left: calc(var(--reply-depth, 0) * 12px);
        }

        .floor-avatar {
            width: 20px;
            height: 20px;
        }

        .floor-toggle,
        .floor-thread-toggle,
        .floor-more,
        .floor-status {
            font-size: 11px;
        }

        .floor-thread-toggle {
            min-height: 44px;
        }

        .floor-toggle {
            min-height: 44px;
        }

        .floor-text {
            font-size: 11px;
        }

        .floor-controls {
            gap: 6px;
        }

        .floor-control-item {
            padding: 2px 4px;
        }

        .floor-control-item .floor-control-text {
            font-size: 9px;
        }
    }
}
</style>
