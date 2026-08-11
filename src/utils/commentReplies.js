const REPLY_SEPARATOR = '//@'

const normalizeText = value => `${value ?? ''}`.trim()
const normalizeMatchText = value => normalizeText(value).replace(/\s+/g, ' ')
const getCommentId = comment => comment?.commentId || comment?.id || comment?.tid || ''
const getUserId = comment => comment?.user?.userId || comment?.user_id || comment?.userId || ''

export function parseCommentReply(content, replyMeta = {}) {
    const text = normalizeText(content)
    const separatorIndex = text.indexOf(REPLY_SEPARATOR)
    if (separatorIndex < 0) return { content: text, replyTo: null }

    const quoted = text.slice(separatorIndex + REPLY_SEPARATOR.length)
    const nameEnd = quoted.indexOf(':')
    const parsedName = nameEnd >= 0 ? quoted.slice(0, nameEnd).trim() : ''
    const parsedContent = nameEnd >= 0 ? quoted.slice(nameEnd + 1).trim() : quoted.trim()

    return {
        content: text.slice(0, separatorIndex).trim(),
        replyTo: {
            userId: replyMeta.userId || replyMeta.user_id || '',
            userName: replyMeta.userName || replyMeta.user_name || parsedName,
            content: replyMeta.content || replyMeta.pcontent || parsedContent,
        },
    }
}

function getReplyTarget(comment) {
    if (comment?.replyTo) return comment.replyTo

    const replied = Array.isArray(comment?.beReplied) ? comment.beReplied[0] : null
    return parseCommentReply(comment?.content, {
        userId: comment?.replyToUserId || comment?.puser_id || replied?.user?.userId,
        userName: comment?.replyToUserName || replied?.user?.nickname,
        content: comment?.replyToContent || replied?.content,
    }).replyTo
}

function getDisplayContent(comment) {
    return parseCommentReply(comment?.content).content
}

function chooseParent(candidates, child) {
    const childTime = Number(child?.time)
    const eligible = candidates.filter(candidate => {
        if (candidate.comment === child) return false
        const candidateTime = Number(candidate.comment?.time)
        return !Number.isFinite(childTime) || !Number.isFinite(candidateTime) || candidateTime <= childTime
    })
    if (eligible.length < 2) return eligible[0] || null

    return eligible.reduce((latest, candidate) => {
        const latestTime = Number(latest.comment?.time) || 0
        const candidateTime = Number(candidate.comment?.time) || 0
        return candidateTime > latestTime ? candidate : latest
    })
}

function countDescendants(node) {
    node.descendantCount = node.children.reduce((count, child) => count + 1 + countDescendants(child), 0)
    return node.descendantCount
}

function containsNode(node, target) {
    return node === target || node.children.some(child => containsNode(child, target))
}

export function buildCommentReplyTree(comments = [], rootComment = null) {
    const nodes = comments.map(comment => ({ comment, children: [], descendantCount: 0 }))
    const nodeById = new Map()
    const nodesByUser = new Map()
    const nodesByUserAndContent = new Map()

    for (const node of nodes) {
        const id = getCommentId(node.comment)
        if (id) nodeById.set(`${id}`, node)

        const userId = `${getUserId(node.comment)}`
        if (!userId) continue
        const userNodes = nodesByUser.get(userId) || []
        userNodes.push(node)
        nodesByUser.set(userId, userNodes)

        const contentKey = `${userId}\u0000${normalizeMatchText(getDisplayContent(node.comment))}`
        const contentNodes = nodesByUserAndContent.get(contentKey) || []
        contentNodes.push(node)
        nodesByUserAndContent.set(contentKey, contentNodes)
    }

    const rootUserId = `${getUserId(rootComment)}`
    const rootContent = normalizeMatchText(getDisplayContent(rootComment))
    const roots = []
    const referenceNodes = new Map()

    for (const node of nodes) {
        const comment = node.comment
        const explicitParent = nodeById.get(`${comment?.parentCommentId || ''}`)
        if (explicitParent && explicitParent !== node && !containsNode(node, explicitParent)) {
            explicitParent.children.push(node)
            continue
        }

        const replyTo = getReplyTarget(comment)
        const targetUserId = `${replyTo?.userId || ''}`
        const targetContent = normalizeMatchText(replyTo?.content)
        if (!targetUserId && !targetContent) {
            roots.push(node)
            continue
        }

        if (targetUserId === rootUserId && targetContent && targetContent === rootContent) {
            roots.push(node)
            continue
        }

        const exactCandidates = nodesByUserAndContent.get(`${targetUserId}\u0000${targetContent}`) || []
        const sameUserCandidates = nodesByUser.get(targetUserId) || []
        const parent = chooseParent(exactCandidates, comment)
            || (targetUserId !== rootUserId && sameUserCandidates.length === 1
                ? chooseParent(sameUserCandidates, comment)
                : null)

        if (parent && !containsNode(node, parent)) {
            parent.children.push(node)
            continue
        }

        if (targetUserId === rootUserId || !targetContent) {
            roots.push(node)
            continue
        }

        const referenceKey = `${targetUserId}\u0000${replyTo?.userName || ''}\u0000${targetContent}`
        let referenceNode = referenceNodes.get(referenceKey)
        if (!referenceNode) {
            referenceNode = {
                comment: {
                    commentId: `reference:${referenceKey}`,
                    content: replyTo.content,
                    referenceOnly: true,
                    user: {
                        userId: replyTo.userId,
                        nickname: replyTo.userName || '被回复用户',
                        avatarUrl: '',
                    },
                },
                children: [],
                descendantCount: 0,
            }
            referenceNodes.set(referenceKey, referenceNode)
            roots.push(referenceNode)
        }
        referenceNode.children.push(node)
    }

    roots.forEach(countDescendants)
    return roots
}
