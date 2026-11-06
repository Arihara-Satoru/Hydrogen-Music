<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
    src: { type: String, default: '' },
});

// 在小尺寸画布上一次性完成模糊和饱和度处理，之后交由 GPU 直接拉伸合成，
// 避免在全屏大图上挂载高开销的实时 CSS filter: blur(50px)。
// 使用双缓冲画布做交叉淡化，切歌或异步加载本地封面时保留上一张已就绪的画面，避免露出底层白底。
const MAX_CANVAS_SIDE = 128;
const CSS_BLUR_PX = 50;
const BACKDROP_SCALE = 1.2;

const rootRef = ref(null);
const canvasARef = ref(null);
const canvasBRef = ref(null);
const activeSlot = ref(0);
const hasDrawnA = ref(false);
const hasDrawnB = ref(false);
let activeImage = null;
let renderedSrc = '';

const draw = (canvas, img) => {
    if (!canvas || !img) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    const rect = rootRef.value?.getBoundingClientRect?.();
    const viewW = (rect?.width > 0 ? rect.width : window.innerWidth * BACKDROP_SCALE) || 1280;
    const viewH = (rect?.height > 0 ? rect.height : window.innerHeight * BACKDROP_SCALE) || 800;

    const aspect = viewW / Math.max(viewH, 1);
    const canvasW = aspect >= 1 ? MAX_CANVAS_SIDE : Math.max(32, Math.round(MAX_CANVAS_SIDE * aspect));
    const canvasH = aspect >= 1 ? Math.max(32, Math.round(MAX_CANVAS_SIDE / aspect)) : MAX_CANVAS_SIDE;
    if (canvas.width !== canvasW) canvas.width = canvasW;
    if (canvas.height !== canvasH) canvas.height = canvasH;

    const maxViewportSide = Math.max(viewW, viewH, 1);
    const blur = Math.min(10, Math.max(1.5, (CSS_BLUR_PX * MAX_CANVAS_SIDE) / maxViewportSide));
    // 向外扩展绘制区域（>= 3 倍高斯半径），消除画布边缘采样透明像素导致的暗边/透底。
    const pad = Math.ceil(blur * 3);

    const imgW = img.naturalWidth || img.width || 1;
    const imgH = img.naturalHeight || img.height || 1;
    const targetW = canvasW + pad * 2;
    const targetH = canvasH + pad * 2;
    const scale = Math.max(targetW / imgW, targetH / imgH);
    const drawW = imgW * scale;
    const drawH = imgH * scale;
    const drawX = (canvasW - drawW) / 2;
    const drawY = (canvasH - drawH) / 2;

    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.filter = `blur(${blur.toFixed(2)}px) saturate(120%)`;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    ctx.filter = 'none';
    return true;
};

const commitLoadedImage = (img, src) => {
    const isInitialDraw = !hasDrawnA.value && !hasDrawnB.value;
    const nextSlot = isInitialDraw ? 0 : (activeSlot.value === 0 ? 1 : 0);
    const targetCanvas = nextSlot === 0 ? canvasARef.value : canvasBRef.value;
    if (!draw(targetCanvas, img)) return;

    if (nextSlot === 0) hasDrawnA.value = true;
    else hasDrawnB.value = true;
    activeSlot.value = nextSlot;
    renderedSrc = src;
};

const loadAndDraw = src => {
    if (activeImage) {
        activeImage.onload = null;
        activeImage.onerror = null;
        activeImage = null;
    }
    if (!src || src === renderedSrc || typeof Image === 'undefined') return;

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
        if (activeImage !== img) return;
        activeImage = null;
        commitLoadedImage(img, src);
    };
    img.onerror = () => {
        if (activeImage === img) activeImage = null;
    };
    activeImage = img;
    img.src = src;
};

onMounted(() => {
    loadAndDraw(props.src);
});

watch(
    () => props.src,
    newSrc => {
        loadAndDraw(newSrc);
    }
);

onBeforeUnmount(() => {
    if (activeImage) {
        activeImage.onload = null;
        activeImage.onerror = null;
        activeImage = null;
    }
});
</script>

<template>
    <div ref="rootRef" class="cover-backdrop">
        <canvas
            ref="canvasARef"
            class="cover-backdrop-canvas"
            :class="{ 'is-active': hasDrawnA && activeSlot === 0 }"
            :width="MAX_CANVAS_SIDE"
            :height="MAX_CANVAS_SIDE"
        ></canvas>
        <canvas
            ref="canvasBRef"
            class="cover-backdrop-canvas"
            :class="{ 'is-active': hasDrawnB && activeSlot === 1 }"
            :width="MAX_CANVAS_SIDE"
            :height="MAX_CANVAS_SIDE"
        ></canvas>
    </div>
</template>

<style scoped>
.cover-backdrop {
    position: relative;
}

.cover-backdrop-canvas {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0;
    transition: opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1);
}

.cover-backdrop-canvas.is-active {
    opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
    .cover-backdrop-canvas {
        transition-duration: 0.01ms;
    }
}
</style>
