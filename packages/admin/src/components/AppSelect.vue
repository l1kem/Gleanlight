<script setup lang="ts">
/**
 * 自绘下拉框 —— 替代原生 <select>：
 * 原生弹层由操作系统渲染，字体/圆角/配色无法跟随主题；
 * 这里用主题令牌自绘触发器与弹层，支持分组表头、键盘导航、上下翻转。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

interface Opt {
  value: string | number | null;
  label: string;
  group?: string;
}
type FlatItem = { header: string } | { value: string | number | null; label: string };

const props = withDefaults(
  defineProps<{
    modelValue?: string | number | null;
    options: Opt[];
    placeholder?: string;
    inline?: boolean;
  }>(),
  { placeholder: "请选择", inline: false }
);
const emit = defineEmits<{
  (e: "update:modelValue", v: string | number | null): void;
  (e: "change", v: string | number | null): void;
}>();

const root = ref<HTMLElement>();
const open = ref(false);
const up = ref(false);
const activeIndex = ref(0);

/** 展开为带分组表头的平铺列表：表头项 { header }，可选项 { value, label } */
const flat = computed<FlatItem[]>(() => {
  const out: FlatItem[] = [];
  let lastGroup: string | undefined;
  for (const o of props.options) {
    if (o.group && o.group !== lastGroup) {
      out.push({ header: o.group });
      lastGroup = o.group;
    } else if (!o.group) {
      lastGroup = undefined;
    }
    out.push({ value: o.value, label: o.label });
  }
  return out;
});

/** 可选项（跳过表头），带平铺下标便于键盘高亮 */
const selectable = computed(() => {
  const out: { item: { value: string | number | null; label: string }; index: number }[] = [];
  flat.value.forEach((it, i) => {
    if (!("header" in it)) out.push({ item: it, index: i });
  });
  return out;
});

const currentLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? props.placeholder
);

function toggle(): void {
  open.value ? close() : openMenu();
}

async function openMenu(): Promise<void> {
  const idx = selectable.value.findIndex((s) => s.item.value === props.modelValue);
  activeIndex.value = idx >= 0 ? selectable.value[idx].index : 0;
  open.value = true;
  // 视口下部空间不足时向上弹
  const rect = root.value?.getBoundingClientRect();
  up.value = !!rect && window.innerHeight - rect.bottom < 300 && rect.top > 300;
  await nextTick();
  scrollActive();
}

function close(): void {
  open.value = false;
}

function choose(v: string | number | null): void {
  emit("update:modelValue", v);
  emit("change", v);
  close();
}

function scrollActive(): void {
  root.value
    ?.querySelector(".app-select__opt.is-active")
    ?.scrollIntoView({ block: "nearest" });
}

function move(delta: number): void {
  if (!selectable.value.length) return;
  const pos = selectable.value.findIndex((s) => s.index === activeIndex.value);
  const next = Math.min(Math.max(pos + delta, 0), selectable.value.length - 1);
  activeIndex.value = selectable.value[next].index;
  scrollActive();
}

function onKey(e: KeyboardEvent): void {
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    if (!open.value) void openMenu();
    else move(e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Enter" && open.value) {
    e.preventDefault();
    const hit = selectable.value.find((s) => s.index === activeIndex.value);
    if (hit) choose(hit.item.value);
  } else if (e.key === "Escape" && open.value) {
    e.stopPropagation();
    close();
  }
}

function onDocClick(e: MouseEvent): void {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close();
}
onMounted(() => document.addEventListener("click", onDocClick));
onBeforeUnmount(() => document.removeEventListener("click", onDocClick));
</script>

<template>
  <div
    ref="root"
    class="app-select"
    :class="{ 'app-select--inline': inline, 'is-open': open }"
    @keydown="onKey"
  >
    <button type="button" class="app-select__trigger" :aria-expanded="open" aria-haspopup="listbox" @click="toggle">
      <span class="app-select__value" :class="{ 'is-placeholder': !options.some((o) => o.value === modelValue) }">
        {{ currentLabel }}
      </span>
      <svg class="app-select__arrow" viewBox="0 0 12 8" fill="none" aria-hidden="true">
        <path d="M1 1.5 6 6.5 11 1.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    </button>

    <div v-if="open" class="app-select__menu" :class="{ 'app-select__menu--up': up }" role="listbox">
      <template v-for="(item, i) in flat" :key="i">
        <p v-if="'header' in item" class="app-select__group">{{ item.header }}</p>
        <button
          v-else
          type="button"
          class="app-select__opt"
          :class="{ 'is-active': i === activeIndex, 'is-sel': item.value === modelValue }"
          role="option"
          :aria-selected="item.value === modelValue"
          @mouseenter="activeIndex = i"
          @click="choose(item.value)"
        >
          <span>{{ item.label }}</span>
          <svg v-if="item.value === modelValue" class="app-select__check" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.app-select { position: relative; width: 100%; }
.app-select--inline { width: auto; min-width: 9rem; }

.app-select__trigger {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  width: 100%;
  min-height: 2.75rem;
  padding: var(--space-2xs) var(--space-sm);
  border: 1px solid var(--color-rule-strong);
  border-radius: var(--radius-sm);
  background: var(--color-paper-2);
  color: var(--color-ink);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color var(--dur-short) var(--ease-out), box-shadow var(--dur-short) var(--ease-out);
}
.app-select__trigger:hover { border-color: var(--color-neutral); }
.app-select.is-open .app-select__trigger,
.app-select__trigger:focus-visible {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-accent) 15%, transparent);
}
.app-select__value {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-select__value.is-placeholder { color: var(--color-neutral); }
.app-select__arrow {
  width: 0.7rem;
  height: 0.5rem;
  flex: none;
  color: var(--color-neutral);
  transition: transform var(--dur-short) var(--ease-out);
}
.app-select.is-open .app-select__arrow { transform: rotate(180deg); }

.app-select__menu {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  z-index: var(--z-modal);
  max-height: 18rem;
  overflow-y: auto;
  padding: var(--space-3xs);
  border: 1px solid var(--color-rule);
  border-radius: 10px;
  background: var(--color-paper-2);
  box-shadow: var(--shadow-popover);
}
.app-select__menu--up { top: auto; bottom: calc(100% + 4px); }

.app-select__group {
  margin: var(--space-2xs) var(--space-2xs) var(--space-3xs);
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  color: var(--color-neutral);
}
.app-select__group:not(:first-child) {
  margin-top: var(--space-xs);
  padding-top: var(--space-2xs);
  border-top: 1px solid var(--color-rule);
}

.app-select__opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  width: 100%;
  padding: var(--space-2xs) var(--space-sm);
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--color-ink);
  font: inherit;
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.app-select__opt.is-active { background: var(--color-paper-3); }
.app-select__opt.is-sel { color: var(--color-accent); font-weight: 600; }
.app-select__check { width: 0.9rem; height: 0.9rem; flex: none; }
</style>
