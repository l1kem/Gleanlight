<script setup lang="ts">
import { computed, reactive } from "vue";
import { useRoute } from "vue-router";
import { auth, logout } from "./stores/auth";
import Toast from "./components/Toast.vue";
import CommandPalette from "./components/CommandPalette.vue";

const route = useRoute();
const isPublic = computed(() => route.meta.public === true);

const nav = [
  { to: "/", label: "仪表盘" },
  { to: "/posts", label: "文章" },
  { to: "/kb", label: "知识库" },
  { to: "/media", label: "媒体库" },
  { to: "/publish", label: "发布" },
  { to: "/settings", label: "设置" },
];

const theme = reactive({
  current: (document.documentElement.dataset.theme ?? "light") as "light" | "dark",
  toggle() {
    theme.current = theme.current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme.current;
    localStorage.setItem("blog-theme", theme.current);
    window.dispatchEvent(new CustomEvent("blog-theme-change", { detail: theme.current }));
  },
});

// 界面风格：跟随前台（手帐 / 观星台），本地切换仅影响本浏览器
const skin = reactive({
  current: (document.documentElement.dataset.skin ?? "journal") as "journal" | "observatory",
  toggle() {
    skin.current = skin.current === "observatory" ? "journal" : "observatory";
    if (skin.current === "journal") delete document.documentElement.dataset.skin;
    else document.documentElement.dataset.skin = skin.current;
    localStorage.setItem("blog-skin", skin.current);
  },
});

async function onLogout(): Promise<void> {
  await logout();
  location.hash = "#/login";
}
</script>

<template>
  <div class="shell" :class="{ 'shell--bare': isPublic }">
    <aside v-if="!isPublic" class="side">
      <div class="side__mast">
        <router-link to="/" class="side__wordmark">书房</router-link>
        <span class="side__sub">Gleanlight · 后台</span>
      </div>
      <nav class="side__nav">
        <router-link
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="side__link"
          exact-active-class="is-active"
        >
          {{ item.label }}
        </router-link>
      </nav>
      <div class="side__foot">
        <span class="side__user">{{ auth.user?.username ?? "" }}</span>
        <div class="side__foot-actions">
          <button class="btn btn-sm" type="button" title="切换界面风格（与前台同步）" @click="skin.toggle">
            {{ skin.current === "observatory" ? "手帐" : "观星台" }}
          </button>
          <button class="btn btn-sm" type="button" @click="theme.toggle">
            {{ theme.current === "dark" ? "浅色" : "深色" }}
          </button>
          <button class="btn btn-sm" type="button" @click="onLogout">退出</button>
        </div>
      </div>
    </aside>
    <main class="main">
      <router-view />
    </main>
  </div>
  <CommandPalette v-if="!isPublic" />
  <Toast />
</template>

<style scoped>
.shell {
  display: grid;
  grid-template-columns: 13.75rem 1fr;
  min-height: 100vh;
}
.shell--bare {
  display: block;
}

.side {
  position: sticky;
  top: 0;
  height: 100vh;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--color-rule);
  background: var(--color-paper-2);
  padding: var(--space-lg) var(--space-md);
}

.side__mast {
  padding: 0 var(--space-sm) var(--space-lg);
  border-bottom: 3px double var(--color-rule-strong);
  margin-bottom: var(--space-lg);
}
.side__wordmark {
  font-family: var(--font-display);
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--color-ink-strong);
}
.side__wordmark:hover {
  text-decoration: none;
}
.side__sub {
  display: block;
  font-size: var(--text-xs);
  color: var(--color-neutral);
  letter-spacing: 0.14em;
  margin-top: var(--space-2xs);
}

.side__nav {
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
  flex: 1;
}
.side__link {
  padding: var(--space-sm) var(--space-sm);
  color: var(--color-muted);
  border-left: 2px solid transparent;
  font-size: var(--text-md);
}
.side__link:hover {
  color: var(--color-ink);
  background: var(--color-paper-3);
  text-decoration: none;
}
.side__link.is-active {
  color: var(--color-accent);
  border-left-color: var(--color-accent);
  font-weight: 600;
  background: var(--color-paper);
}

.side__foot {
  border-top: 1px solid var(--color-rule);
  padding-top: var(--space-md);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.side__user {
  font-size: var(--text-sm);
  color: var(--color-muted);
  padding: 0 var(--space-sm);
}
.side__foot-actions {
  display: flex;
  gap: var(--space-xs);
  padding: 0 var(--space-sm);
}

.main {
  min-width: 0;
  overflow-x: clip;
}

@media (max-width: 48rem) {
  .shell {
    grid-template-columns: 1fr;
  }
  .side {
    position: static;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: var(--space-lg);
    border-right: none;
    border-bottom: 1px solid var(--color-rule);
    padding: var(--space-sm) var(--space-md);
  }
  .side__mast {
    border: none;
    margin: 0;
    padding: 0;
  }
  .side__sub {
    display: none;
  }
  .side__nav {
    flex-direction: row;
    flex-wrap: wrap;
    gap: var(--space-2xs);
  }
  .side__link {
    border-left: none;
    padding: var(--space-2xs) var(--space-sm);
    font-size: var(--text-sm);
  }
  .side__link.is-active {
    border-bottom: 2px solid var(--color-accent);
  }
  .side__foot {
    border: none;
    margin-left: auto;
    padding: 0;
    flex-direction: row;
    align-items: center;
  }
  .side__user {
    display: none;
  }
}
</style>
