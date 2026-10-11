<script setup>
import BaseButton from './base/BaseButton.vue'
import OverflowMarquee from './base/OverflowMarquee.vue'
import { resolveImageUrl } from '../utils/imageUtils'
defineProps({ songs: { type: Array, default: () => [] }, action: { type: String, default: '' }, busy: Boolean, currentHash: String })
defineEmits(['select'])
</script>

<template>
    <ul class="together-song-list">
        <li v-for="(song, index) in songs" :key="`${song.hash}:${song.order_userid || ''}:${index}`" :class="{ current: song.hash === currentHash }">
            <span class="song-number">{{ String(index + 1).padStart(2, '0') }}</span>
            <img v-if="song.coverUrl || song.al?.picUrl" :src="resolveImageUrl(song.coverUrl || song.al.picUrl)" alt="" loading="lazy" />
            <div class="song-label"><OverflowMarquee :text="song.name" /><small>{{ song.ar?.map(artist => artist.name).filter(Boolean).join(' / ') || '未知歌手' }}</small></div>
            <slot name="actions" :song="song">
                <BaseButton v-if="action" variant="secondary" size="small" :disabled="busy" @click="$emit('select', song)">{{ action }}</BaseButton>
            </slot>
        </li>
    </ul>
</template>

<style scoped>
.together-song-list { list-style: none; margin: 0; padding: 0; }
li { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--border); min-width: 0; }
.song-number { font: 12px Bender-Bold; color: var(--muted-text); width: 24px; }
img { width: 38px; height: 38px; object-fit: cover; border-radius: 2px; }
.song-label { flex: 1; min-width: 0; font-size: 14px; }
small { display: block; color: var(--muted-text); font-size: 11px; margin-top: 4px; }
.current .song-number { color: var(--text); font-weight: bold; }
</style>
