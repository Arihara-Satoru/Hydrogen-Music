<script setup>
import DataCheckAnimaton from './DataCheckAnimaton.vue'
defineProps({
  image: String,
  animation: { type: Number, default: -1 },
  invalid: Boolean,
  scanned: Boolean,
  status: String,
  label: { type: String, default: 'QRCODE' },
  alt: { type: String, default: '二维码' },
  disabled: Boolean,
  refreshLabel: { type: String, default: '刷新二维码' },
})
defineEmits(['refresh'])
</script>

<template>
  <div class="qrcode-container">
    <div class="qrcode-stage">
    <button type="button" class="qrcode-border" :disabled="disabled" :aria-label="refreshLabel" title="单击二维码刷新"
      :class="{ 'qrcode-loging-1': animation === 1 || animation === 2, 'qrcode-loging-2': animation === 2 }" @click="$emit('refresh')">
      <div class="qrcode" :class="{ 'qrcode-checking': animation === 2, 'qrcode-invalid': invalid, 'qrcode-confirming': scanned, 'qrcode-recover': animation === -2 }">
        <img :src="image" :alt="alt" v-show="image">
        <span class="qrcode-loading" v-show="!image">Loading...</span>
      </div>
      <div class="qrcode-status" role="status" :class="{ 'qrcode-checking': animation === 2, 'status-1': invalid, 'status-2': scanned, hide: animation === -2 }">{{ status }}</div>
      <div class="border border1"></div>
      <div class="border border2"></div>
      <div class="border border3"></div>
      <div class="border border4"></div>
      <div class="qr-line qr-line1"></div>
      <div class="qr-line qr-line2"></div>
      <div class="qr-line qr-line3"></div>
      <div class="qr-line qr-line4"></div>
      <div class="qrcode-text">{{ label }}</div>
      <DataCheckAnimaton class="check-animation" v-if="animation === 2" />
    </button>
    </div>
    <div class="qrcode-actions"><slot /></div>
  </div>
</template>

<style scoped lang="scss">
  .qrcode-container {
    margin-top: 7vh;
    display: flex;
    flex-direction: column;
    gap: 16px;
    justify-content: center;
    align-items: center;
    --qrcode-size: clamp(144px, 26vh, 192px);
    --qrcode-text: var(--text);
    --qrcode-border: var(--text);
    --qrcode-line: var(--text);
    --qrcode-line-fade: var(--border);
    --qrcode-status-bg: #000000;
    --qrcode-status-text: #ffffff;
    --qrcode-status-danger: #d10000;

    .qrcode-stage { width: calc(var(--qrcode-size) + 16px); height: calc(var(--qrcode-size) + 16px); display: grid; place-items: center; }
    .qrcode-actions { width: calc(var(--qrcode-size) + 16px); min-height: 24px; display: flex; align-items: center; justify-content: center; }
    .qrcode-actions :deep(.qrcode-action) { padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--text); font-size: 12px; text-decoration: underline; text-underline-offset: 4px; cursor: pointer; }
    .qrcode-actions :deep(.qrcode-action:disabled) { opacity: .5; cursor: default; }

    .qrcode-border {
      width: calc(var(--qrcode-size) + 16px);
      height: calc(var(--qrcode-size) + 16px);
      position: relative;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      transition: 0.3s;

      &:focus-visible { outline: 2px solid var(--qrcode-border); outline-offset: 8px; }
      &:disabled { cursor: default; }

      .qrcode {
        width: calc(100% - 16px);
        height: calc(100% - 16px);
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);

        img {
          width: 100%;
          height: 100%;
          object-fit: contain;
          background: white;
        }

        .qrcode-loading {
          font: 18px Gilroy-ExtraBold;
          line-height: var(--qrcode-size);
          color: var(--qrcode-text);
        }
      }

      .qrcode-checking {
        opacity: 0 !important;
        transition: 0.2s 1s !important;
      }

      .qrcode-invalid {
        opacity: 0.5;
        transition: 0.3s;
      }

      .qrcode-confirming {
        opacity: 0.2;
        transition: opacity 0.2s;
      }

      .qrcode-recover {
        opacity: 1 !important;
      }

      .qrcode-status {
        width: 0;
        background-color: var(--qrcode-status-bg);
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font: 14px SourceHanSansCN-Bold;
        color: rgba(255, 255, 255, 0);
        white-space: nowrap;
        opacity: 0;
        transition: 0.3s;
      }

      .hide {
        opacity: 0 !important;
      }

      .status-1 {
        background-color: var(--qrcode-status-danger);
        animation: status 0.3s cubic-bezier(.13, .86, .51, .98) forwards;
      }

      .status-2 {
        background-color: var(--qrcode-status-bg);
        animation: status 0.3s cubic-bezier(.13, .86, .51, .98) forwards;
      }

      @keyframes status {
        0% {
          opacity: 1;
        }

        100% {
          width: 100%;
          opacity: 1;
          color: var(--qrcode-status-text);
        }
      }

      .border {
        width: 40px;
        height: 40px;
        position: absolute;
      }

      $borderWidth: 2 + px;

      .border1 {
        border: {
          top: $borderWidth solid var(--qrcode-border);
          left: $borderWidth solid var(--qrcode-border);
        };

        top: 0;
        left: 0;
      }

      .border2 {
        border: {
          top: $borderWidth solid var(--qrcode-border);
          right: $borderWidth solid var(--qrcode-border);
        };

        top: 0;
        right: 0;
      }

      .border3 {
        border: {
          bottom: $borderWidth solid var(--qrcode-border);
          right: $borderWidth solid var(--qrcode-border);
        };

        bottom: 0;
        right: 0;
      }

      .border4 {
        border: {
          bottom: $borderWidth solid var(--qrcode-border);
          left: $borderWidth solid var(--qrcode-border);
        };

        bottom: 0;
        left: 0;
      }

      .qr-line {
        width: 40px;
        height: 1px;
        background: linear-gradient(to right, var(--qrcode-line) 30%, var(--qrcode-line-fade));
        position: absolute;
      }

      .qr-line1 {
        top: -13px;
        left: -32px;
        transform: rotate(-135deg);
      }

      .qr-line2 {
        top: -13px;
        right: -32px;
        transform: rotate(-45deg);
      }

      .qr-line3 {
        bottom: -13px;
        right: -32px;
        transform: rotate(45deg);
      }

      .qr-line4 {
        bottom: -13px;
        left: -32px;
        transform: rotate(135deg);
      }

      .qrcode-text {
        font: 1vh Geometos;
        color: var(--qrcode-text);
        position: absolute;
        top: -1.2vh;
        left: 0.2vh;
      }

      .check-animation {
        width: 100%;
        height: 100%;
        position: absolute;
        top: 0;
        left: 0;
      }
    }

    .qrcode-loging-1 {
      width: calc(var(--qrcode-size) * 22 / 26);
      height: calc(var(--qrcode-size) * 22 / 26);
      transition: 0.2s ease;
    }

    .qrcode-loging-2 {
      .border,
      .qr-line {
        animation: qrcode-acticity 0.3s 0.2s forwards;
      }

      @keyframes qrcode-acticity {
        0% {
          opacity: 0;
        }

        20% {
          opacity: 1;
        }

        40% {
          opacity: 0;
        }

        60% {
          opacity: 1;
        }

        80% {
          opacity: 0;
        }

        90% {
          opacity: 1;
        }

        100% {
          opacity: 0;
        }
      }
    }
  }

  .dark .qrcode-container .qrcode-border { background: transparent !important; }
  .dark .qrcode-actions :deep(.qrcode-action) { background: transparent !important; }

  .dark .qrcode-container {
    --qrcode-text: var(--text);
    --qrcode-border: var(--text);
    --qrcode-line: var(--text);
    --qrcode-line-fade: var(--border);
    --qrcode-status-bg: rgba(17, 24, 33, 0.92);
    --qrcode-status-text: #f2f5f7;
    --qrcode-status-danger: #ef5350;
  }
</style>
