<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import LinkGraph from "../components/LinkGraph.vue";

interface PostListItem {
  id: number;
  title: string;
  status: string;
  updated_at: string;
}
interface BuildItem {
  id: number;
  status: string;
  created_at: string;
}
interface Stats {
  wordsThisMonth: number;
  totalWords: number;
  postsThisMonth: number;
  writingDays: number;
  streak: number;
  lastPublishAt: string | null;
}
interface Overview {
  published: number;
  drafts: number;
  scheduled: number;
  topics: number;
  domains: number;
  media: number;
  privatePosts: number;
}

const posts = ref<PostListItem[]>([]);
const recentBuilds = ref<BuildItem[]>([]);
const stats = ref<Stats | null>(null);
const counts = ref<Overview | null>(null);
const loading = ref(true);

function fmtWords(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
}

onMounted(async () => {
  try {
    const [p, b, s, overview] = await Promise.all([
      api.get<{ items: PostListItem[] }>("/posts?pageSize=5"),
      api.get<{ items: BuildItem[] }>("/builds"),
      api.get<Stats>("/stats"),
      api.get<Overview>("/stats/overview"),
    ]);
    posts.value = p.items;
    recentBuilds.value = b.items.slice(0, 3);
    stats.value = s;
    counts.value = overview;
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>仪表盘</h1>
      <div class="actions">
        <router-link class="btn" to="/posts/new">写新文章</router-link>
        <router-link class="btn btn-primary" to="/publish">发布到前台</router-link>
      </div>
    </header>

    <div class="stat-row" :aria-busy="loading">
      <div class="panel stat">
        <span class="stat__num">{{ counts?.published ?? "—" }}</span>
        <span class="stat__label">已发布</span>
      </div>
      <div class="panel stat">
        <span class="stat__num">{{ counts?.drafts ?? "—" }}</span>
        <span class="stat__label">草稿箱</span>
      </div>
      <div class="panel stat" v-if="counts?.scheduled">
        <span class="stat__num">{{ counts.scheduled }}</span>
        <span class="stat__label">待定时发布</span>
      </div>
      <div class="panel stat">
        <span class="stat__num">{{ stats ? fmtWords(stats.wordsThisMonth) : "—" }}</span>
        <span class="stat__label">本月字数</span>
      </div>
      <div class="panel stat stat--accent">
        <span class="stat__num">{{ stats ? stats.streak : "—" }}</span>
        <span class="stat__label">连续写作天数</span>
      </div>
      <div class="panel stat">
        <span class="stat__num">{{ counts?.topics ?? "—" }}</span>
        <span class="stat__label">知识主题</span>
      </div>
    </div>

    <section class="panel">
      <h2>知识图谱</h2>
      <LinkGraph />
    </section>

    <div class="two-col">
      <section class="panel">
        <h2>最近编辑</h2>
        <table class="table" v-if="posts.length">
          <tbody>
            <tr v-for="p in posts" :key="p.id">
              <td>
                <router-link :to="`/posts/${p.id}`">{{ p.title }}</router-link>
              </td>
              <td class="muted small">{{ p.updated_at?.slice(0, 16) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else-if="!loading" class="muted">还没有文章，从「写新文章」开始。</p>
      </section>

      <section class="panel">
        <h2>最近构建</h2>
        <table class="table" v-if="recentBuilds.length">
          <tbody>
            <tr v-for="b in recentBuilds" :key="b.id">
              <td>
                <span class="badge" :class="`badge-${b.status}`">{{
                  b.status === "success" ? "成功" : b.status === "failed" ? "失败" : "进行中"
                }}</span>
              </td>
              <td class="muted small">{{ b.created_at?.slice(0, 16) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="muted">尚未构建过。第一次发布会生成完整静态站。</p>
        <p v-if="stats?.lastPublishAt" class="muted small">
          上次上线：{{ stats.lastPublishAt.slice(0, 16) }}
        </p>
        <p v-if="stats" class="muted small">
          累计 {{ fmtWords(stats.totalWords) }} 字 · 写作 {{ stats.writingDays }} 天 · 本月新篇 {{ stats.postsThisMonth }}
        </p>
        <router-link to="/publish" class="small">前往发布中心 →</router-link>
      </section>
    </div>
  </div>
</template>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}
.stat {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs);
  padding: var(--space-md) var(--space-lg);
}
.stat__num {
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--color-ink-strong);
  font-variant-numeric: tabular-nums;
}
.stat--accent .stat__num {
  color: var(--color-accent);
}
.stat__label {
  font-size: var(--text-sm);
  color: var(--color-neutral);
}
.two-col {
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: var(--space-lg);
  align-items: start;
  margin-top: var(--space-lg);
}
@media (max-width: 56rem) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
</style>
