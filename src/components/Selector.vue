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
      <transition name="selector" @enter="absolutePosition(overlay, select)">
        <div
          class="selector-option"
          :id="listId"
          role="listbox"
          :style="{
            '--count': options.length < maxItems ? options.length : maxItems,
            maxHeight: maxItems * 34 + 16 + 'px',
          }"
          v-if="option"
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
import { computed, nextTick, onActivated, onDeactivated, ref, useId } from "vue";
import { absolutePosition } from "../utils/domHandler";

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

const changeOption = (e) => {
  emit("update:modelValue", e.value);
  option.value = false;
  select.value?.focus();
};

const isLongLabel = (label) => {
  return label?.length >= 20
}

let clickOutside = (event) => {
  if (select.value && !select.value.contains(event.target)) {
    option.value = false;
  }
};
onActivated(() => {
  window.addEventListener("click", clickOutside);
});
onDeactivated(() => {
  window.removeEventListener("click", clickOutside);
});

const scrollActiveOption = () => nextTick(() =>
  overlay.value?.children[activeIndex.value]?.scrollIntoView({ block: "nearest" })
);
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
  position: absolute;
  overflow-y: overlay;
  background: rgb(228, 240, 240);
  box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
  line-height: 25px;
  user-select: none;
  padding: 8px 0;
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
  width: 200px;
  height: 34px;
  font: 13px SourceHanSansCN-Bold;
  background-image: linear-gradient(90deg, black, black);
  background-repeat: repeat-y;
  background-position: -200px 0;
  padding: 0 16px;
  line-height: 34px;
  transition: background-position 0.2s, color 0.2s;
  cursor: pointer;
  text-align: center;
  &:hover {
    background-position: 0 0;
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

::-webkit-scrollbar-track {
  border-radius: 0;
}

::-webkit-scrollbar {
  -webkit-appearance: none;
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-thumb {
  cursor: pointer;
  border-radius: 0;
  background: rgba(0, 0, 0, 0.15);
  transition: color 0.2s ease;
}
</style>
<style lang="scss">
.selector-enter-active,
.selector-leave-active {
  transition: all .225s;
  overflow: hidden;
  box-sizing: content-box;
}
.selector-enter-from,
.selector-leave-to {
  height: 0;
  &.selector-option {
    padding: 0;
  }
}
.selector-enter-to,
.selector-leave-from {
  height: calc(var(--count) * 34px);
  &.selector-option {
    padding: 8px 0;
  }
}
</style>
