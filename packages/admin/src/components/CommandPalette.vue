<script setup lang="ts">
/**
 * 全局命令面板：⌘K / Ctrl+K 唤起。
 * 搜索文章/主题/知识域 + 快捷动作（新文章、发布、各页面）。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { api } from "../api";

interface PalettePost {
  id: number;
  title: string;
  slug: string;
  status: string;
  topic_name: string | null;
}
interface PaletteTopic {
  id: number;
  name: string;
  domain_id: number;
  domain_name: string | null;
}
interface PaletteData {
  posts: PalettePost[];
  domains: { id: number; name: string }[];
  topics: PaletteTopic[];
}

interface Item {
  key: string;
  group: string;
  label: string;
  hint?: string;
  to?: string;
  run?: () => void;
}

const router = useRouter();
const open = ref(false);
const query = ref("");
const active = ref(0);
const inputEl = ref<HTMLInputElement>();
const data = ref<PaletteData>({ posts: [], domains: [], topics: [] });
let loaded = false;

const actions: Item[] = [
  { key: "a-new", group: "动作", label: "写新文章", hint: "N", to: "/posts/new" },
  { key: "a-publish", group: "动作", label: "发布到前台", hint: "P", to: "/publish" },
  { key: "a-dash", group: "动作", label: "回到仪表盘", to: "/" },
  { key: "a-posts", group: "动作", label: "文章列表", to: "/posts" },
  { key: "a-kb", group: "动作", label: "知识库管理", to: "/kb" },
  { key: "a-media", group: "动作", label: "媒体库", to: "/media" },
  { key: "a-settings", group: "动作", label: "设置", to: "/settings" },
];

const items = computed<Item[]>(() => {
  const q = query.value.trim().toLowerCase();
  const fromData: Item[] = [
    ...data.value.posts.map((p): Item => ({
      key: `p-${p.id}`,
      group: p.status === "published" ? "文章" : "草稿",
      label: p.title,
      hint: p.topic_name ?? p.slug,
      to: `/posts/${p.id}`,
    })),
    ...data.value.topics.map((t): Item => ({
      key: `t-${t.id}`,
      group: "主题",
      label: t.name,
      hint: t.domain_name ?? "",
      to: "/kb",
    })),
    ...data.value.domains.map((d): Item => ({
      key: `d-${d.id}`,
      group: "知识域",
      label: d.name,
      to: "/kb",
    })),
  ];
  const all = [...actions, ...fromData];
  if (!q) return all.slice(0, 12);
  return all
    .filter((it) => {
      const hay = `${it.label} ${it.hint ?? ""}`.toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      const as = a.label.toLowerCase().startsWith(q) ? 0 : 1;
      const bs = b.label.toLowerCase().startsWith(q) ? 0 : 1;
      return as - bs;
    })
    .slice(0, 14);
});

watch(items, () => {
  active.value = 0;
});

async function show(): Promise<void> {
  open.value = true;
  query.value = "";
  active.value = 0;
  await nextTick();
  inputEl.value?.focus();
  if (!loaded) {
    loaded = true;
    try {
      data.value = await api.get<PaletteData>("/palette");
    } catch {
      loaded = false; // 失败下次再拉
    }
  }
}

function hide(): void {
  open.value = false;
}

function pick(it: Item): void {
  hide();
  if (it.to) void router.push(it.to);
  it.run?.();
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    open.value ? hide() : void show();
    return;
  }
  if (!open.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    hide();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    active.value = Math.min(active.value + 1, items.value.length - 1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    active.value = Math.max(active.value - 1, 0);
  } else if (e.key === "Enter" && items.value[active.value]) {
    e.preventDefault();
    pick(items.value[active.value]);
  }
}

function onListItemOver(i: number): void {
  active.value = i;
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
defineExpose({ show });
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="palette-layer" @click.self="hide">
      <div class="palette" role="dialog" aria-label="命令面板">
        <div class="palette__bar">
          <span class="palette__icon" aria-hidden="true">⌘</span>
          <input
            ref="inputEl"
            v-model="query"
            class="palette__input"
            type="text"
            placeholder="搜索文章、主题，或执行动作…"
            aria-label="搜索"
          />
          <span class="palette__esc">esc 关闭</span>
        </div>
        <ul v-if="items.length" class="palette__list">
          <li
            v-for="(it, i) in items"
            :key="it.key"
            :class="{ 'is-active': i === active }"
            @click="pick(it)"
            @mousemove="onListItemOver(i)"
          >
            <span class="palette__group">{{ it.group }}</span>
            <span class="palette__label">{{ it.label }}</span>
            <span v-if="it.hint" class="palette__hint">{{ it.hint }}</span>
          </li>
        </ul>
        <p v-else class="palette__empty">没有匹配项</p>
        <p class="palette__foot">
          <span class="kbd">↑</span><span class="kbd">↓</span> 选择
          <span class="kbd">↵</span> 打开
          <span class="kbd">⌘K</span> 随处唤起
        </p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-layer {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: oklch(20% 0.01 60 / 0.45);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 14vh var(--space-lg) var(--space-lg);
}
.palette {
  width: min(34rem, 100%);
  background: var(--color-paper);
  border: 1px solid var(--color-rule-strong);
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-whisper);
  overflow: clip;
  display: flex;
  flex-direction: column;
  max-height: 60vh;
}
.palette__bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--color-rule);
  background: var(--color-paper-2);
}
.palette__icon {
  color: var(--color-neutral);
  font-family: var(--font-mono);
}
.palette__input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--color-ink);
  font: inherit;
  font-size: var(--text-md);
}
.palette__input:focus-visible {
  outline: none;
}
.palette__esc {
  font-size: var(--text-xs);
  color: var(--color-neutral);
  white-space: nowrap;
}
.palette__list {
  list-style: none;
  margin: 0;
  padding: var(--space-2xs);
  overflow-y: auto;
  flex: 1;
}
.palette__list li {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
}
.palette__list li.is-active {
  background: var(--color-paper-3);
}
.palette__list li.is-active .palette__label {
  color: var(--color-accent);
}
.palette__group {
  flex: none;
  width: 3em;
  font-size: var(--text-xs);
  color: var(--color-neutral);
}
.palette__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-ink);
}
.palette__hint {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--color-neutral);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 40%;
}
.palette__empty {
  margin: 0;
  padding: var(--space-lg);
  text-align: center;
  color: var(--color-neutral);
  font-size: var(--text-sm);
}
.palette__foot {
  margin: 0;
  padding: var(--space-2xs) var(--space-md);
  border-top: 1px solid var(--color-rule);
  font-size: var(--text-xs);
  color: var(--color-neutral);
  display: flex;
  gap: var(--space-2xs);
  align-items: center;
}
.kbd {
  display: inline-block;
  min-width: 1.4em;
  text-align: center;
  padding: 0 0.25em;
  border: 1px solid var(--color-rule-strong);
  border-bottom-width: 2px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.75em;
  color: var(--color-muted);
}
.palette__foot .kbd {
  margin-right: 2px;
}
</style>
