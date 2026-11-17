<template>
  <div
    class="selector"
    ref="select"
    role="combobox"
    tabindex="0"
    aria-label="选择"
    aria-haspopup="listbox"
    :aria-expanded="option"
    :aria-controls="listId"
    :aria-activedescendant="option ? `${listId}-${activeIndex}` : undefined"
    @click="changeOptionsVisible"
    @keydown="handleKeydown"
  >
    <div class="selector-head">
      <span class="select-head-cont" :class="{ 'long-label': isLongLabel(current?.label) }">{{ current?.label }}</span>
    </div>
    <teleport to="body">
      <transition name="selector" @enter="handleEnter">
        <div
          class="selector-option"
          :id="listId"
          role="listbox"
          :style="{
            maxHeight: maxItems * 34 + 'px',
          }"
          v-show="option"
          ref="overlay"
        >
          <div
            class="selector-option-item"
            v-for="(item, index) in options"
            :key="item.value"
            :id="`${listId}-${index}`"
            role="option"
            :aria-selected="modelValue === item.value"
            @click="changeOption(item)"
            @mousemove="activeIndex = index"
            :class="{
              'selector-option-item-selected': modelValue === item.value || activeIndex === index,
            }"
          >
            <span :class="{'long-label' :isLongLabel(item?.label)}">{{ item?.label }}</span>
          </div>
        </div>
      </transition>
    </teleport>
  </div>
</template>
<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, useId, watch } from "vue";

const props = defineProps({
  options: Array,
  modelValue: null,
  maxItems: {
    type: Number,
    default: 4,
  },
});
const emit = defineEmits(["update:modelValue"]);

const select = ref();
const overlay = ref();
const option = ref(false);
const activeIndex = ref(0);
const listId = useId();
const current = computed(() =>
  props.options.find((x) => x.value === props.modelValue)
);

const handleEnter = (el) => {
  const trigger = select.value;
  if (!trigger) return;
  const rect = trigger.getBoundingClientRect();
  let top = 0;
  let bottom = window.innerHeight;
  // Teleported menus must respect the trigger's clipping ancestors, not just the window.
  for (let parent = trigger.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
      const bounds = parent.getBoundingClientRect();
      top = Math.max(top, bounds.top);
      bottom = Math.min(bottom, bounds.bottom);
    }
  }
  if (rect.top < top || rect.bottom > bottom) {
    option.value = false;
    return;
  }
  const desiredHeight = Math.min(props.options.length, props.maxItems) * 34;
  const below = Math.max(0, bottom - rect.bottom);
  const above = Math.max(0, rect.top - top);
  const openAbove = below < desiredHeight && above > below;
  const height = Math.min(desiredHeight, openAbove ? above : below);
  el.style.width = `${rect.width}px`;
  el.style.maxHeight = `${height}px`;
  el.style.top = `${openAbove ? rect.top - height : rect.bottom}px`;
  el.style.left = `${Math.max(0, Math.min(rect.left, window.innerWidth - rect.width))}px`;
  el.dataset.placement = openAbove ? "top" : "bottom";
};

let positionFrame = null;
const schedulePosition = (event) => {
  // Scrolling the options does not move the trigger.
  if (event?.target === overlay.value || !option.value || positionFrame !== null) return;
  positionFrame = requestAnimationFrame(() => {
    positionFrame = null;
    if (option.value && overlay.value) handleEnter(overlay.value);
  });
};
const stopPositionTracking = () => {
  window.removeEventListener("scroll", schedulePosition, true);
  window.removeEventListener("resize", schedulePosition);
  if (positionFrame !== null) cancelAnimationFrame(positionFrame);
  positionFrame = null;
};
watch(option, (visible) => {
  if (visible) {
    // Capture also receives scroll events from nested page/modal containers.
    window.addEventListener("scroll", schedulePosition, { capture: true, passive: true });
    window.addEventListener("resize", schedulePosition);
  } else {
    stopPositionTracking();
  }
}, { flush: "sync" });

const changeOption = (e) => {
  emit("update:modelValue", e.value);
  option.value = false;
  select.value?.focus();
};

const isLongLabel = (label) => {
  return label?.length >= 20
}

let clickOutside = (event) => {
  if (select.value && !select.value.contains(event.target) && overlay.value && !overlay.value.contains(event.target)) {
    option.value = false;
  }
};

onMounted(() => {
  window.addEventListener("click", clickOutside);
});
onBeforeUnmount(() => {
  window.removeEventListener("click", clickOutside);
  stopPositionTracking();
});
onActivated(() => {
  window.addEventListener("click", clickOutside);
});
onDeactivated(() => {
  window.removeEventListener("click", clickOutside);
  option.value = false;
  stopPositionTracking();
});

const scrollActiveOption = () => nextTick(() => {
  const list = overlay.value;
  const item = list?.children[activeIndex.value];
  if (!option.value || !list || !item) return;
  const top = item.offsetTop;
  const bottom = top + item.offsetHeight;
  if (top < list.scrollTop) list.scrollTop = top;
  else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight;
  }
});
const changeOptionsVisible = () => {
  option.value = !option.value;
  if (option.value) {
    activeIndex.value = Math.max(0, props.options.findIndex(item => item.value === props.modelValue));
    scrollActiveOption();
  }
};
const handleKeydown = (event) => {
  if (event.key === "Tab") { option.value = false; return; }
  if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "Escape"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Escape") { option.value = false; return; }
  if (!props.options.length) return;
  if (event.key === "Enter" || event.key === " ") {
    if (option.value) changeOption(props.options[Math.min(activeIndex.value, props.options.length - 1)]);
    else changeOptionsVisible();
    return;
  }
  if (!option.value) changeOptionsVisible();
  activeIndex.value = event.key === "Home" ? 0 : event.key === "End" ? props.options.length - 1
    : Math.max(0, Math.min(props.options.length - 1, activeIndex.value + (event.key === "ArrowDown" ? 1 : -1)));
  scrollActiveOption();
};
</script>

<style scoped lang="scss">
.selector {
  position: relative;
  &:focus-visible .selector-head { outline: 2px solid currentColor; outline-offset: 2px; }
  &-head {
    text-align: center;
    box-sizing: border-box;
  }
}

.selector-option {
  position: fixed;
  z-index: 2000;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: none;
  background: var(--panel);
  color: var(--text);
  -webkit-backdrop-filter: blur(18px) saturate(120%);
  backdrop-filter: blur(18px) saturate(120%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 12%);
  line-height: 25px;
  user-select: none;
  padding: 0;
  box-sizing: border-box;
}

.selector-head{
  padding: 0 10px;
  width: 100%;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(255, 255, 255, 0.35);
  font: 13px SourceHanSansCN-Bold;
  cursor: pointer;
}
.selector-head,.selector-option-item{
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.selector-head:hover .long-label, .selector-option-item:hover .long-label{
    display: block;
    width: fit-content;
    animation: slide-label 5s linear infinite alternate;
}

.selector-option-item {
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
  height: 34px;
  font: 13px SourceHanSansCN-Bold;
  padding: 0 16px;
  line-height: 34px;
  transition: background-color 0.2s, color 0.2s;
  cursor: pointer;
  text-align: center;
  &:hover {
    background-color: black;
    color: white;
  }
  &-selected {
    background-color: black;
    color: white;
  }
}

@keyframes slide-label{
  from {
    transform: translatex(0%);
  }
  to{
    transform: translatex(-60%);
  }
}

.selector-option::-webkit-scrollbar {
  display: none;
  width: 0;
  height: 0;
}
.selector-enter-active,
.selector-leave-active {
  // Reveal the fully laid-out content without resizing or stretching text.
  transition: clip-path .18s ease-out;
  overflow: hidden;
}
.selector-enter-from,
.selector-leave-to {
  clip-path: inset(0 0 100% 0);
  &[data-placement="top"] {
    clip-path: inset(100% 0 0 0);
  }
}
.selector-enter-to,
.selector-leave-from {
  clip-path: inset(0);
}
@media (prefers-reduced-motion: reduce) {
  .selector-enter-active,
  .selector-leave-active {
    transition: none;
  }
}
@media (prefers-reduced-transparency: reduce) {
  .selector-option {
    background: var(--panel);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}
</style>
