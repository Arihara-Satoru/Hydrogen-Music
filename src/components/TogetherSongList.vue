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
            <div class="song-label">
                <OverflowMarquee :text="song.name" />
                <small>{{ song.ar?.map(artist => artist.name).filter(Boolean).join(' / ') || '未知歌手' }}</small>
            </div>
            <div class="song-actions">
                <slot name="actions" :song="song">
                    <BaseButton v-if="action" variant="secondary" size="small" :disabled="busy" @click="$emit('select', song)">{{ action }}</BaseButton>
                </slot>
            </div>
        </li>
    </ul>
</template>

<style scoped>
.together-song-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px 16px;
}
li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--layer);
    border: 1px solid var(--border);
    min-width: 0;
    box-sizing: border-box;
    transition: background-color 0.16s ease, border-color 0.16s ease;
}
li:hover {
    background: color-mix(in srgb, var(--panel) 94%, transparent);
    border-color: var(--text);
}
li.current {
    border-color: var(--text);
    background: color-mix(in srgb, var(--panel) 96%, transparent);
}
li.current .song-number {
    color: var(--text);
    font-weight: bold;
}
li.current .song-label {
    font-weight: bold;
}
.song-number {
    font: 12px/1 Bender-Bold, monospace;
    color: var(--muted-text);
    width: 22px;
    flex-shrink: 0;
    text-align: center;
}
img {
    width: 38px;
    height: 38px;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid var(--border);
}
.song-label {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text);
}
small {
    display: block;
    color: var(--muted-text);
    font-size: 11px;
    margin-top: 3px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.song-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
}

@media (max-width: 720px) {
    .together-song-list {
        grid-template-columns: 1fr;
        gap: 8px;
    }
}
</style>
