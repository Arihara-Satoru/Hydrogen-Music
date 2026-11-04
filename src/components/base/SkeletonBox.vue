<template>
  <div class="skeleton-box" :style="{ width, height, borderRadius }" aria-hidden="true"></div>
</template>

<script setup>
defineProps({
  width: { type: String, default: '100%' },
  height: { type: String, default: '1em' },
  borderRadius: { type: String, default: '2px' },
})
</script>

<style scoped lang="scss">
.skeleton-box {
  --skeleton-base: rgba(0, 0, 0, 0.07);
  --skeleton-highlight: rgba(0, 0, 0, 0.055);
  position: relative;
  overflow: hidden;
  background: var(--skeleton-base);
  pointer-events: none;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent, var(--skeleton-highlight), transparent);
    transform: translateX(-100%);
    animation: skeleton-shimmer 1.6s ease-in-out infinite;
  }
}
@keyframes skeleton-shimmer {
  100% { transform: translateX(100%); }
}

:global(html.dark .skeleton-box) {
  --skeleton-base: rgba(255, 255, 255, 0.08);
  --skeleton-highlight: rgba(255, 255, 255, 0.06);
}

@media (prefers-reduced-motion: reduce) {
  .skeleton-box::after {
    animation: none;
    content: none;
  }
}
</style>
