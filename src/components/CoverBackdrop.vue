<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
    src: { type: String, required: true },
});

// 在小尺寸画布上一次性完成模糊和饱和度处理，之后交由 GPU 直接拉伸合成，
// 避免在全屏大图上挂载高开销的实时 CSS filter: blur(50px)。
const MAX_CANVAS_SIDE = 128;
const CSS_BLUR_PX = 50;
const BACKDROP_SCALE = 1.2;

const rootRef = ref(null);
const canvasRef = ref(null);
let activeImage = null;

const draw = img => {
    const canvas = canvasRef.value;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
};

const loadAndDraw = src => {
    if (activeImage) {
        activeImage.onload = null;
        activeImage = null;
    }
    if (!src || typeof Image === 'undefined') return;

    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
        if (activeImage !== img) return;
        draw(img);
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
        activeImage = null;
    }
});
</script>

<template>
    <div ref="rootRef" class="cover-backdrop">
        <canvas ref="canvasRef" class="cover-backdrop-canvas" :width="MAX_CANVAS_SIDE" :height="MAX_CANVAS_SIDE"></canvas>
    </div>
</template>

<style scoped>
.cover-backdrop-canvas {
    display: block;
    width: 100%;
    height: 100%;
}
</style>
