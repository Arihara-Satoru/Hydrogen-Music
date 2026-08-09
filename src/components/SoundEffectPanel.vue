<script setup>
import { computed, onMounted, ref } from 'vue'
import { getCommunitySoundEffects, getSoundEffectDetail } from '../api/effect'
import { resolveImageUrl } from '../utils/imageUtils'

const effects = ref([])
const selectedEffect = ref(null)
const effectDetail = ref(null)
const searchText = ref('')
const listLoading = ref(false)
const detailLoading = ref(false)
const listError = ref('')
const detailError = ref('')
let listRequestSerial = 0
let detailRequestSerial = 0

function extractEffectItems(result) {
    const roots = [result?.data?.data, result?.data, result]
    const keys = ['models', 'model_list', 'sound_list', 'effects', 'list', 'info', 'items', 'records']
    for (const root of roots) {
        if (Array.isArray(root)) return root
        if (!root || typeof root != 'object') continue
        for (const key of keys) {
            if (Array.isArray(root[key])) return root[key]
            if (Array.isArray(root[key]?.list)) return root[key].list
        }
    }
    return []
}

function normalizeEffect(raw, index = 0) {
    const id = raw?.model_id ?? raw?.modelid ?? raw?.sound_id ?? raw?.effect_id ?? raw?.id
    const name = raw?.model_name
        || raw?.sound_name
        || raw?.effect_name
        || raw?.title
        || raw?.name
        || `社区音效 ${index + 1}`
    const authorObject = raw?.author || raw?.user || raw?.creator || {}
    const author = raw?.author_name
        || raw?.nickname
        || raw?.username
        || authorObject?.name
        || authorObject?.nickname
        || ''
    const cover = raw?.cover
        || raw?.cover_url
        || raw?.pic
        || raw?.pic_url
        || raw?.img
        || raw?.image
        || raw?.icon
        || ''

    return {
        ...raw,
        id,
        name,
        author,
        cover,
        description: raw?.description || raw?.desc || raw?.intro || raw?.remark || '',
        category: raw?.classify_name || raw?.category_name || raw?.category || raw?.classify || '',
    }
}

function unwrapEffectDetail(result) {
    const data = result?.data?.data ?? result?.data ?? result
    if (Array.isArray(data)) return data[0] || null
    if (!data || typeof data != 'object') return null

    for (const key of ['model_info', 'sound_info', 'effect_info', 'detail', 'info', 'model']) {
        if (Array.isArray(data[key])) return data[key][0] || null
        if (data[key] && typeof data[key] == 'object') return data[key]
    }
    return data
}

const filteredEffects = computed(() => {
    const keyword = searchText.value.trim().toLocaleLowerCase()
    if (!keyword) return effects.value
    return effects.value.filter(effect => `${effect.name} ${effect.author} ${effect.category}`.toLocaleLowerCase().includes(keyword))
})

const detailDescription = computed(() => effectDetail.value?.description || selectedEffect.value?.description || '该音效暂未提供文字简介。')

function firstValue(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '')
}

function formatCount(value) {
    const count = Number(value)
    if (!Number.isFinite(count)) return String(value || '')
    if (count >= 10000) return `${Number((count / 10000).toFixed(1))} 万`
    return `${Math.max(0, Math.floor(count))}`
}

const detailFacts = computed(() => {
    const detail = effectDetail.value || selectedEffect.value || {}
    const facts = [
        ['创作者', firstValue(detail.author, detail.author_name, detail.nickname, detail.username)],
        ['分类', firstValue(detail.category, detail.classify_name, detail.category_name)],
        ['适配设备', firstValue(detail.earphone_name, detail.device_name, detail.brand_name, detail.model)],
        ['使用次数', firstValue(detail.use_count, detail.use_num, detail.play_count, detail.listen_count)],
        ['收藏数', firstValue(detail.collect_count, detail.collect_num, detail.favorite_count, detail.like_count)],
        ['音效版本', firstValue(detail.version, detail.sound_ver, detail.model_version)],
    ]
    return facts
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([label, value]) => ({
            label,
            value: /次数|收藏/.test(label) ? formatCount(value) : String(value),
        }))
})

const detailTags = computed(() => {
    const detail = effectDetail.value || selectedEffect.value || {}
    const rawTags = detail.tags || detail.tag_list || detail.labels || []
    if (Array.isArray(rawTags)) {
        return rawTags.map(tag => typeof tag == 'object' ? tag?.name || tag?.title : tag).filter(Boolean).slice(0, 8)
    }
    return String(rawTags || '').split(/[,，、]/).map(tag => tag.trim()).filter(Boolean).slice(0, 8)
})

async function selectEffect(effect) {
    if (!effect) return
    selectedEffect.value = effect
    effectDetail.value = null
    detailError.value = ''

    if (effect.id === undefined || effect.id === null || effect.id === '') {
        detailError.value = '该音效缺少详情标识'
        return
    }

    const requestSerial = ++detailRequestSerial
    detailLoading.value = true
    try {
        const result = await getSoundEffectDetail(effect.id)
        if (requestSerial !== detailRequestSerial) return
        const rawDetail = unwrapEffectDetail(result)
        effectDetail.value = rawDetail ? normalizeEffect({ ...effect, ...rawDetail }) : effect
    } catch (error) {
        if (requestSerial !== detailRequestSerial) return
        console.error('加载音效详情失败:', error)
        detailError.value = '音效详情加载失败'
    } finally {
        if (requestSerial === detailRequestSerial) detailLoading.value = false
    }
}

async function loadEffects() {
    const requestSerial = ++listRequestSerial
    listLoading.value = true
    listError.value = ''
    try {
        const result = await getCommunitySoundEffects({ timestamp: Date.now() })
        if (requestSerial !== listRequestSerial) return
        effects.value = extractEffectItems(result)
            .map(normalizeEffect)
            .filter(effect => effect.id !== undefined && effect.id !== null && effect.id !== '')

        const previousId = selectedEffect.value?.id
        const nextSelected = effects.value.find(effect => String(effect.id) === String(previousId)) || effects.value[0] || null
        if (nextSelected) void selectEffect(nextSelected)
        else {
            selectedEffect.value = null
            effectDetail.value = null
        }
    } catch (error) {
        if (requestSerial !== listRequestSerial) return
        console.error('加载社区音效失败:', error)
        effects.value = []
        selectedEffect.value = null
        effectDetail.value = null
        listError.value = '社区音效加载失败，请稍后重试'
    } finally {
        if (requestSerial === listRequestSerial) listLoading.value = false
    }
}

onMounted(() => {
    void loadEffects()
})
</script>

<template>
    <section class="sound-effect-panel" aria-labelledby="sound-effect-title">
        <header class="effect-header">
            <div>
                <p class="effect-kicker">SOUND LAB</p>
                <h2 id="sound-effect-title">社区音效</h2>
                <p class="effect-subtitle">浏览社区音效并查看调音方案详情</p>
            </div>
            <button class="effect-refresh" type="button" :disabled="listLoading" aria-label="刷新社区音效" @click="loadEffects">
                <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M20 6v5h-5" />
                    <path d="M19 11a7 7 0 1 0-1.3 5.2" />
                </svg>
                <span>{{ listLoading ? '刷新中' : '刷新' }}</span>
            </button>
        </header>

        <div class="effect-layout">
            <div class="effect-browser">
                <label class="effect-search">
                    <span class="sr-only">搜索社区音效</span>
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <circle cx="10.5" cy="10.5" r="6.5" />
                        <line x1="15.5" y1="15.5" x2="21" y2="21" />
                    </svg>
                    <input v-model="searchText" type="search" placeholder="搜索音效或创作者" />
                </label>

                <div class="effect-state" v-if="listLoading && effects.length === 0" aria-live="polite">正在加载社区音效…</div>
                <div class="effect-state effect-state-error" v-else-if="listError" role="status">
                    <span>{{ listError }}</span>
                    <button type="button" @click="loadEffects">重试</button>
                </div>
                <div class="effect-state" v-else-if="filteredEffects.length === 0">没有匹配的社区音效</div>
                <div class="effect-list" v-else>
                    <button
                        class="effect-item"
                        :class="{ selected: String(selectedEffect?.id) === String(effect.id) }"
                        type="button"
                        v-for="effect in filteredEffects"
                        :key="effect.id"
                        @click="selectEffect(effect)"
                    >
                        <span class="effect-cover">
                            <img v-if="effect.cover" :src="resolveImageUrl(effect.cover)" :alt="`${effect.name}封面`" loading="lazy" />
                            <span v-else aria-hidden="true">FX</span>
                        </span>
                        <span class="effect-item-copy">
                            <strong>{{ effect.name }}</strong>
                            <small>{{ effect.author || effect.category || '社区调音方案' }}</small>
                        </span>
                        <svg class="effect-chevron" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <path d="m9 5 7 7-7 7" />
                        </svg>
                    </button>
                </div>
            </div>

            <article class="effect-detail" v-if="selectedEffect">
                <div class="detail-loading" v-if="detailLoading" aria-live="polite">正在读取音效详情…</div>
                <template v-else>
                    <div class="detail-hero">
                        <div class="detail-cover">
                            <img v-if="(effectDetail || selectedEffect).cover" :src="resolveImageUrl((effectDetail || selectedEffect).cover)" :alt="`${(effectDetail || selectedEffect).name}封面`" />
                            <span v-else aria-hidden="true">FX</span>
                        </div>
                        <div class="detail-title">
                            <span>音效详情</span>
                            <h3>{{ (effectDetail || selectedEffect).name }}</h3>
                            <p v-if="(effectDetail || selectedEffect).author">BY {{ (effectDetail || selectedEffect).author }}</p>
                        </div>
                    </div>
                    <p class="detail-description">{{ detailDescription }}</p>
                    <div class="detail-error" v-if="detailError" role="status">{{ detailError }}</div>
                    <dl class="detail-facts" v-if="detailFacts.length">
                        <div v-for="fact in detailFacts" :key="fact.label">
                            <dt>{{ fact.label }}</dt>
                            <dd>{{ fact.value }}</dd>
                        </div>
                    </dl>
                    <div class="detail-tags" v-if="detailTags.length">
                        <span v-for="tag in detailTags" :key="tag">{{ tag }}</span>
                    </div>
                    <p class="effect-note">社区接口提供音效方案列表与详情；当前播放器不会改写系统音频输出。</p>
                </template>
            </article>
            <div class="effect-detail effect-detail-empty" v-else>选择一个音效查看详情</div>
        </div>
    </section>
</template>

<style scoped lang="scss">
.sound-effect-panel {
    width: 100%;
    height: 100%;
    min-height: 0;
    padding: clamp(16px, 2.5vw, 30px);
    background: color-mix(in srgb, var(--panel) 76%, transparent);
    border: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    color: var(--text);
    .effect-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
        flex: 0 0 auto;
        .effect-kicker {
            margin: 0 0 4px;
            font: 11px Bender-Bold;
            letter-spacing: 0.18em;
            color: var(--muted-text);
        }
        h2 {
            margin: 0;
            font: clamp(24px, 3vh, 34px) SourceHanSansCN-Heavy;
            line-height: 1.15;
            color: var(--text);
        }
        .effect-subtitle {
            margin: 7px 0 0;
            font: 12px SourceHanSansCN-Bold;
            color: var(--muted-text);
        }
    }
    button,
    input {
        font-family: SourceHanSansCN-Bold;
    }
    button:focus-visible,
    input:focus-visible {
        outline: 2px solid var(--text);
        outline-offset: 2px;
    }
    .effect-refresh {
        min-width: 86px;
        min-height: 44px;
        padding: 0 14px;
        border: 1px solid var(--border);
        background: var(--layer);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        color: var(--text);
        cursor: pointer;
        transition: 0.2s;
        svg {
            width: 17px;
            height: 17px;
            fill: none;
            stroke: currentColor;
            stroke-width: 1.7;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        &:hover:not(:disabled) {
            border-color: var(--text);
        }
        &:disabled {
            cursor: wait;
            opacity: 0.55;
        }
    }
    .effect-layout {
        margin-top: 20px;
        min-height: 0;
        flex: 1;
        display: grid;
        grid-template-columns: minmax(210px, 0.42fr) minmax(250px, 0.58fr);
        gap: clamp(14px, 2vw, 24px);
    }
    .effect-browser,
    .effect-detail {
        min-width: 0;
        min-height: 0;
        border: 1px solid var(--border);
        background: var(--layer);
    }
    .effect-browser {
        padding: 12px;
        display: flex;
        flex-direction: column;
    }
    .effect-search {
        min-height: 44px;
        padding: 0 12px;
        border: 1px solid var(--border);
        background: color-mix(in srgb, var(--panel) 70%, transparent);
        display: flex;
        align-items: center;
        gap: 9px;
        flex: 0 0 auto;
        svg {
            width: 17px;
            height: 17px;
            fill: none;
            stroke: var(--muted-text);
            stroke-width: 1.6;
            stroke-linecap: round;
        }
        input {
            width: 100%;
            min-width: 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: var(--text);
            font-size: 12px;
            &::placeholder {
                color: var(--muted-text);
            }
        }
    }
    .effect-list {
        margin-top: 10px;
        min-height: 0;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        &::-webkit-scrollbar {
            width: 5px;
        }
        &::-webkit-scrollbar-thumb {
            background: var(--border);
        }
    }
    .effect-item {
        width: 100%;
        min-height: 58px;
        padding: 7px 8px;
        border: 1px solid transparent;
        background: transparent;
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 18px;
        align-items: center;
        gap: 9px;
        color: var(--text);
        text-align: left;
        cursor: pointer;
        transition: 0.2s;
        &:hover,
        &.selected {
            background: color-mix(in srgb, var(--panel) 70%, transparent);
            border-color: var(--border);
        }
        &.selected {
            border-left: 3px solid var(--text);
        }
    }
    .effect-cover,
    .detail-cover {
        overflow: hidden;
        border: 1px solid var(--border);
        background: var(--panel);
        display: flex;
        align-items: center;
        justify-content: center;
        font: 12px Bender-Bold;
        color: var(--muted-text);
        img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
    }
    .effect-cover {
        width: 44px;
        height: 44px;
    }
    .effect-item-copy {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
        strong,
        small {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        strong {
            font-size: 13px;
            color: var(--text);
        }
        small {
            font-size: 10px;
            color: var(--muted-text);
        }
    }
    .effect-chevron {
        width: 17px;
        height: 17px;
        fill: none;
        stroke: var(--muted-text);
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
    .effect-state,
    .detail-loading,
    .effect-detail-empty {
        min-height: 120px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--muted-text);
        font: 12px SourceHanSansCN-Bold;
        text-align: center;
    }
    .effect-state-error {
        flex-direction: column;
        gap: 12px;
        button {
            min-width: 72px;
            min-height: 44px;
            border: 1px solid var(--border);
            background: transparent;
            color: var(--text);
            cursor: pointer;
        }
    }
    .effect-detail {
        padding: clamp(16px, 2.2vw, 26px);
        overflow: auto;
        &::-webkit-scrollbar {
            width: 5px;
        }
        &::-webkit-scrollbar-thumb {
            background: var(--border);
        }
    }
    .detail-hero {
        display: flex;
        align-items: center;
        gap: 16px;
    }
    .detail-cover {
        width: clamp(70px, 10vh, 96px);
        height: clamp(70px, 10vh, 96px);
        flex: 0 0 auto;
        font-size: 18px;
    }
    .detail-title {
        min-width: 0;
        span,
        p {
            font: 10px Bender-Bold;
            letter-spacing: 0.12em;
            color: var(--muted-text);
        }
        h3 {
            margin: 5px 0;
            font: clamp(18px, 2.4vh, 26px) SourceHanSansCN-Heavy;
            color: var(--text);
            word-break: break-word;
        }
        p {
            margin: 0;
        }
    }
    .detail-description {
        margin: 20px 0 0;
        font: 12px SourceHanSansCN-Bold;
        line-height: 1.7;
        color: var(--muted-text);
        white-space: pre-wrap;
    }
    .detail-error {
        margin-top: 14px;
        padding: 10px;
        border: 1px dashed var(--border);
        font: 11px SourceHanSansCN-Bold;
        color: var(--muted-text);
    }
    .detail-facts {
        margin: 20px 0 0;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 9px;
        > div {
            padding: 10px;
            min-width: 0;
            border: 1px solid var(--border);
        }
        dt {
            font: 10px SourceHanSansCN-Bold;
            color: var(--muted-text);
        }
        dd {
            margin: 4px 0 0;
            overflow: hidden;
            text-overflow: ellipsis;
            font: 12px SourceHanSansCN-Bold;
            color: var(--text);
        }
    }
    .detail-tags {
        margin-top: 16px;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        span {
            padding: 4px 7px;
            border: 1px solid var(--border);
            font: 10px SourceHanSansCN-Bold;
            color: var(--muted-text);
        }
    }
    .effect-note {
        margin: 20px 0 0;
        padding-top: 14px;
        border-top: 1px solid var(--border);
        font: 10px SourceHanSansCN-Bold;
        line-height: 1.6;
        color: var(--muted-text);
    }
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
}

@media (max-width: 760px) {
    .sound-effect-panel {
        .effect-layout {
            grid-template-columns: 1fr;
        }
        .effect-browser {
            max-height: 42%;
        }
    }
}

@media (prefers-reduced-motion: reduce) {
    .sound-effect-panel * {
        transition-duration: 0.01ms !important;
        animation-duration: 0.01ms !important;
    }
}
</style>
