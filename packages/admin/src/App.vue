<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { auth, logout } from "./stores/auth";
import { api } from "./api";
import Toast from "./components/Toast.vue";
import CommandPalette from "./components/CommandPalette.vue";

const route = useRoute();
const isPublic = computed(() => route.meta.public === true);
const version = ref("");

const nav = [
  {
    group: "概览",
    items: [{ to: "/", label: "仪表盘", icon: "grid" }],
  },
  {
    group: "内容",
    items: [
      { to: "/posts", label: "文章", icon: "doc" },
      { to: "/kb", label: "知识库", icon: "tree" },
      { to: "/media", label: "媒体库", icon: "image" },
    ],
  },
  {
    group: "运维",
    items: [
      { to: "/publish", label: "发布", icon: "cloud" },
      { to: "/settings", label: "设置", icon: "gear" },
    ],
  },
];

const icons: Record<string, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  doc: "M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM14 3v5h5M9 13h8M9 17h5",
  tree: "M12 3v4M6 21v-4M18 21v-4M6 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 13a5 5 0 0 1 5-5M18 13a5 5 0 0 0-5-5M6 17h12",
  image: "M4 5h16v14H4zM8 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM4 16l5-5 4 4 3-3 4 4",
  cloud: "M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.6 4.2 4.2 0 0 1 17 18zM12 12v6M9.5 15.5 12 18l2.5-2.5",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h0a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h0a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v0a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
};

const currentPage = computed(() => {
  for (const g of nav) {
    const hit = g.items.find((i) => i.to === route.path);
    if (hit) return hit.label;
  }
  if (route.path.startsWith("/posts")) return "文章";
  return "书房";
});

const theme = reactive({
  current: (document.documentElement.dataset.theme ?? "light") as "light" | "dark",
  toggle() {
    theme.current = theme.current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme.current;
    localStorage.setItem("blog-theme", theme.current);
    window.dispatchEvent(new CustomEvent("blog-theme-change", { detail: theme.current }));
  },
});

async function onLogout(): Promise<void> {
  await logout();
  location.hash = "#/login";
}

// 顶栏搜索按钮：派发与 ⌘K 相同的快捷键事件给命令面板
function dispatchPalette(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
}

async function loadVersion(): Promise<void> {
  if (isPublic.value || version.value) return;
  try {
    const v = await api.get<{ current: string }>("/version");
    version.value = v.current;
  } catch {
    /* 版本号拿不到就不显示 */
  }
}
onMounted(loadVersion);
// 登录页挂载时 isPublic 为真，登录成功后补取
watch(isPublic, (pub) => {
  if (!pub) void loadVersion();
});
</script>

<template>
  <div class="shell" :class="{ 'shell--bare': isPublic }">
    <aside v-if="!isPublic" class="side">
      <router-link to="/" class="side__brand">
        <span class="side__logo" aria-hidden="true">✦</span>
        <span class="side__brandtext">
          <strong>Gleanlight</strong>
          <span class="side__sub">内容工作台</span>
        </span>
      </router-link>

      <nav class="side__nav" aria-label="主导航">
        <section v-for="g in nav" :key="g.group" class="side__group">
          <p class="side__grouplabel">{{ g.group }}</p>
          <router-link
            v-for="item in g.items"
            :key="item.to"
            :to="item.to"
            class="side__link"
            exact-active-class="is-active"
          >
            <svg class="side__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path :d="icons[item.icon]" />
            </svg>
            <span>{{ item.label }}</span>
          </router-link>
        </section>
      </nav>

      <div class="side__user">
        <span class="side__avatar" aria-hidden="true">{{ (auth.user?.username ?? "?").slice(0, 1).toUpperCase() }}</span>
        <div class="side__usermeta">
          <strong>{{ auth.user?.username ?? "" }}</strong>
          <button class="side__logout" type="button" @click="onLogout">退出登录</button>
        </div>
      </div>
      <p v-if="version" class="side__ver">Gleanlight v{{ version }}</p>
    </aside>

    <div v-if="!isPublic" class="content">
      <header class="topbar">
        <p class="topbar__crumb">{{ currentPage }}</p>
        <div class="topbar__actions">
          <button class="topbar__search" type="button" title="搜索（⌘K）" @click="dispatchPalette">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
              <path :d="icons.search" />
            </svg>
            <span>搜索…</span>
            <kbd>⌘K</kbd>
          </button>
          <button class="btn btn-sm" type="button" @click="theme.toggle">
            {{ theme.current === "dark" ? "浅色" : "深色" }}
          </button>
        </div>
      </header>
      <main class="main">
        <router-view :key="route.fullPath" />
      </main>
    </div>

    <main v-if="isPublic" class="main">
      <router-view :key="route.fullPath" />
    </main>
  </div>
  <CommandPalette v-if="!isPublic" />
  <Toast />
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  gap: var(--space-md);
  padding: var(--space-md);
  min-height: 100vh;
}
.shell--bare {
  display: block;
  padding: 0;
}

/* ── 悬浮侧栏：四周留边、圆角矩形卡片、轻投影 ──────────────── */
.side {
  position: sticky;
  top: var(--space-md);
  height: calc(100vh - var(--space-md) * 2);
  display: flex;
  flex-direction: column;
  background: var(--side-bg);
  color: var(--side-ink);
  border: 1px solid var(--color-rule);
  border-radius: 18px;
  box-shadow: var(--shadow-card);
  padding: var(--space-md) var(--space-sm);
  overflow-y: auto;
}

.side__brand {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  margin-bottom: var(--space-lg);
  text-decoration: none;
  color: inherit;
}
.side__logo {
  display: grid;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  border-radius: var(--radius-sm);
  background: linear-gradient(135deg, oklch(62% 0.14 35), oklch(50% 0.13 30));
  color: oklch(98% 0.01 90);
  font-size: 1rem;
}
.side__brandtext {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}
.side__brandtext strong {
  font-size: var(--text-md);
  letter-spacing: -0.01em;
}
.side__sub {
  font-size: var(--text-xs);
  color: var(--side-muted);
}

.side__nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.side__grouplabel {
  margin: 0 0 var(--space-2xs);
  padding: 0 var(--space-sm);
  font-size: var(--text-xs);
  font-weight: 500;
  letter-spacing: 0.08em;
  color: var(--side-muted);
}
.side__group {
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
}
.side__link {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-2xs) var(--space-sm);
  min-height: 2.25rem;
  border-radius: var(--radius-sm);
  color: var(--color-muted);
  font-size: var(--text-sm);
  font-weight: 500;
  text-decoration: none;
  transition: background-color var(--dur-short) var(--ease-out), color var(--dur-short) var(--ease-out);
}
.side__link:hover {
  background: var(--side-hover);
  color: var(--side-ink);
  text-decoration: none;
}
.side__link.is-active {
  background: var(--side-active);
  color: var(--color-accent);
  font-weight: 600;
}
.side__icon {
  width: 1.15rem;
  height: 1.15rem;
  flex: none;
  opacity: 0.85;
}

.side__user {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-lg);
  padding: var(--space-sm);
  border-top: 1px solid var(--color-rule);
}
.side__avatar {
  display: grid;
  place-items: center;
  width: 2.1rem;
  height: 2.1rem;
  border-radius: 50%;
  background: linear-gradient(135deg, oklch(58% 0.12 80), oklch(50% 0.13 35));
  color: oklch(98% 0.01 90);
  font-weight: 600;
  font-size: var(--text-sm);
}
.side__usermeta {
  display: flex;
  flex-direction: column;
  line-height: 1.3;
  min-width: 0;
}
.side__usermeta strong {
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.side__logout {
  border: none;
  background: none;
  padding: 0;
  color: var(--side-muted);
  font: inherit;
  font-size: var(--text-xs);
  cursor: pointer;
  text-align: left;
}
.side__logout:hover { color: oklch(70% 0.13 25); text-decoration: underline; }
.side__ver {
  margin: var(--space-xs) 0 0;
  padding: 0 var(--space-sm);
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  color: var(--side-muted);
}

/* ── 内容区 + 顶部工具栏 ──────────────────────────────────── */
.content {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-2xs) var(--space-xl);
  min-height: 3.5rem;
  background: color-mix(in oklch, var(--color-paper) 82%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--color-rule);
}
.topbar__crumb {
  margin: 0;
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  color: var(--color-neutral);
}
.topbar__actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.topbar__search {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2xs);
  min-width: 14rem;
  padding: var(--space-3xs) var(--space-sm);
  border: 1px solid var(--color-rule-strong);
  border-radius: var(--radius-sm);
  background: var(--color-paper-2);
  color: var(--color-neutral);
  font: inherit;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color var(--dur-short) var(--ease-out), box-shadow var(--dur-short) var(--ease-out);
}
.topbar__search:hover {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-accent) 12%, transparent);
}
.topbar__search svg {
  width: 1rem;
  height: 1rem;
}
.topbar__search span { flex: 1; text-align: left; }
.topbar__search kbd {
  font-family: var(--font-mono);
  font-size: 0.7rem;
  padding: 0.1em 0.4em;
  border: 1px solid var(--color-rule-strong);
  border-radius: 4px;
  color: var(--color-neutral);
}

.main {
  flex: 1;
  min-width: 0;
  overflow-x: clip;
}

@media (max-width: 48rem) {
  .shell { grid-template-columns: 1fr; }
  .side {
    position: static;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: var(--space-md);
    padding: var(--space-sm) var(--space-md);
    overflow-x: auto;
  }
  .side__brand { margin: 0; flex: none; }
  .side__nav {
    flex-direction: row;
    gap: var(--space-xs);
  }
  .side__group { flex-direction: row; gap: var(--space-2xs); }
  .side__grouplabel { display: none; }
  .side__link span:not(.side__brandtext) { display: none; } /* 移动端只留图标 */
  .side__user { display: none; }
  .topbar__search { min-width: 0; }
  .topbar__search span { display: none; }
}
</style>
