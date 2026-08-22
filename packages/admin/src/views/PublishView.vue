<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "../api";
import { toast, toastError } from "../toast";

interface BuildItem {
  id: number;
  status: "running" | "success" | "failed";
  adapter: string;
  created_at: string;
  finished_at: string | null;
  log?: string;
}

const builds = ref<BuildItem[]>([]);
const publicDist = ref("");
const runningId = ref<number | null>(null);
const liveLog = ref("");
let pollTimer: ReturnType<typeof setInterval> | undefined;

async function loadBuilds(): Promise<void> {
  const data = await api.get<{ items: BuildItem[]; publicDist: string }>("/builds");
  builds.value = data.items;
  publicDist.value = data.publicDist;
  const running = data.items.find((b) => b.status === "running");
  if (running) {
    runningId.value = running.id;
    liveLog.value = (running as BuildItem & { log?: string }).log ?? "";
    startPoll(running.id);
  }
}
onMounted(loadBuilds);

function startPoll(id: number): void {
  stopPoll();
  pollTimer = setInterval(async () => {
    try {
      const b = await api.get<BuildItem>(`/builds/${id}`);
      liveLog.value = b.log ?? "";
      const el = document.querySelector(".build-log");
      if (el) el.scrollTop = el.scrollHeight;
      if (b.status !== "running") {
        stopPoll();
        runningId.value = null;
        void loadBuilds();
      }
    } catch {
      stopPoll();
    }
  }, 1200);
}
function stopPoll(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
}
onBeforeUnmount(stopPoll);

async function publish(): Promise<void> {
  try {
    const { buildId } = await api.post<{ buildId: number }>("/publish");
    runningId.value = buildId;
    liveLog.value = "";
    startPoll(buildId);
    void loadBuilds();
  } catch (err) {
    toastError(err);
  }
}

async function removeBuild(id: number): Promise<void> {
  if (!window.confirm(`删除构建 #${id} 的记录？`)) return;
  try {
    await api.del(`/builds/${id}`);
    void loadBuilds();
  } catch (err) {
    toastError(err);
  }
}

async function clearHistory(): Promise<void> {
  if (!window.confirm("清空全部构建历史（进行中的保留）？")) return;
  try {
    const { deleted } = await api.del<{ deleted: number }>("/builds");
    toast(`已清理 ${deleted} 条记录`, "success");
    void loadBuilds();
  } catch (err) {
    toastError(err);
  }
}

/** 构建耗时（sqlite UTC 字符串 → 秒） */
function duration(b: BuildItem): string {
  if (b.status === "running") return "—";
  if (!b.finished_at) return "—";
  const start = Date.parse(`${b.created_at.replace(" ", "T")}Z`);
  const end = Date.parse(`${b.finished_at.replace(" ", "T")}Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const sec = Math.max(0, Math.round((end - start) / 1000));
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m${sec % 60}s`;
}

function fmtTime(t?: string | null): string {
  return t ? t.slice(0, 19).replace("T", " ") : "—";
}

const statusText: Record<BuildItem["status"], string> = {
  running: "进行中",
  success: "成功",
  failed: "失败",
};
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>发布</h1>
      <button
        class="btn btn-primary"
        type="button"
        :disabled="runningId !== null"
        @click="publish"
      >
        {{ runningId ? "构建中…" : "构建并发布" }}
      </button>
    </header>
    <p class="muted">
      发布流程：导出已发布内容 → Astro 静态化前台 → 同步到部署目标。前台是纯静态文件，可交给任意静态服务器/Nginx 托管。
    </p>

    <section v-if="runningId" class="panel">
      <h2>构建 #{{ runningId }} 日志</h2>
      <pre class="build-log mono">{{ liveLog || "等待输出…" }}</pre>
    </section>

    <section class="panel">
      <div class="history-head">
        <h2>构建历史（{{ builds.length }}）</h2>
        <button v-if="builds.length" class="btn btn-sm" type="button" @click="clearHistory">清空历史</button>
      </div>
      <table class="table" v-if="builds.length">
        <thead>
          <tr><th>#</th><th>状态</th><th>适配器</th><th>开始时间</th><th>耗时</th><th>日志</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="b in builds" :key="b.id" :class="{ 'is-running': b.status === 'running' }">
            <td class="mono">{{ b.id }}</td>
            <td>
              <span class="badge" :class="`badge-${b.status === 'success' ? 'published' : b.status === 'failed' ? 'draft' : ''}`">
                {{ statusText[b.status] }}
              </span>
            </td>
            <td class="mono small">{{ b.adapter }}</td>
            <td class="muted small mono">{{ fmtTime(b.created_at) }}</td>
            <td class="small">{{ duration(b) }}</td>
            <td>
              <details v-if="b.log">
                <summary class="small">展开（{{ b.log.split("\n").length }} 行）</summary>
                <pre class="build-log mono">{{ b.log }}</pre>
              </details>
              <span v-else class="muted small">—</span>
            </td>
            <td>
              <button
                v-if="b.status !== 'running'"
                class="btn btn-sm btn-danger"
                type="button"
                @click="removeBuild(b.id)"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="muted">还没有构建记录。</p>
    </section>

    <section class="panel">
      <h2>本地预览</h2>
      <p class="small">
        当前适配器为 <span class="mono">local</span>：构建产物同步到
        <span class="mono">{{ publicDist }}</span>。预览：
      </p>
      <pre class="build-log mono">npx serve {{ publicDist }}
# 或
python3 -m http.server -d {{ publicDist }} 8000</pre>
      <p class="muted small">
        接入 Cloudflare Pages / 自有 VPS 时，在 server 的 adapters/ 里加一个适配器即可，发布按钮不变。
      </p>
    </section>
  </div>
</template>

<style scoped>
.history-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
}
.history-head h2 { margin: 0; }
.is-running td { opacity: 0.75; }
.build-log {
  max-height: 18rem;
  overflow: auto;
  background: var(--color-paper-2);
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-sm);
  padding: var(--space-md);
  font-size: var(--text-xs);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
</style>
