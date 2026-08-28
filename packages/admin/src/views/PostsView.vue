<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { api } from "../api";
import AppSelect from "../components/AppSelect.vue";
import { toast, toastError } from "../toast";

interface PostListItem {
  id: number;
  slug: string;
  title: string;
  status: "draft" | "published";
  featured: number;
  topic_name: string | null;
  domain_name: string | null;
  updated_at: string;
}
interface KbTree {
  domains: { id: number; name: string }[];
  topics: { id: number; name: string; domain_id: number }[];
}

const list = reactive<{ items: PostListItem[]; total: number }>({ items: [], total: 0 });
const filter = reactive({ status: "", q: "", topic_id: "" });
const kb = ref<KbTree>({ domains: [], topics: [] });
const loading = ref(true);

const statusOptions = [
  { value: "", label: "全部状态" },
  { value: "published", label: "已发布" },
  { value: "draft", label: "草稿" },
];
const topicOptions = computed(() => [
  { value: "", label: "全部分类" },
  ...kb.value.topics.map((t) => ({
    value: t.id as number | "",
    label: t.name,
    group: kb.value.domains.find((d) => d.id === t.domain_id)?.name ?? "未分组",
  })),
]);

// ── 批量操作 ────────────────────────────────────────────────
const selected = ref<Set<number>>(new Set());
const batchBusy = ref(false);
const allSelected = computed(
  () => list.items.length > 0 && list.items.every((p) => selected.value.has(p.id))
);

function toggleAll(): void {
  selected.value = allSelected.value
    ? new Set()
    : new Set(list.items.map((p) => p.id));
}
function toggleOne(id: number): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
const moveOptions = computed(() => [
  { value: "", label: "移动到主题…" },
  { value: null as unknown as string, label: "（不属于任何主题）" },
  ...kb.value.topics.map((t) => ({
    value: t.id as unknown as string,
    label: t.name,
    group: kb.value.domains.find((d) => d.id === t.domain_id)?.name ?? "未分组",
  })),
]);
const moveTarget = ref<string>("");
function onMove(): void {
  if (moveTarget.value === "") return;
  const v = moveTarget.value === "__none__" ? null : Number(moveTarget.value);
  void batch("move", v);
  moveTarget.value = "";
}

async function batch(action: "publish" | "draft" | "delete" | "move", topicId?: number | null): Promise<void> {
  const ids = [...selected.value];
  if (!ids.length || batchBusy.value) return;
  if (action === "delete" && !window.confirm(`删除选中的 ${ids.length} 篇文章？不可恢复。`)) return;
  batchBusy.value = true;
  try {
    const { affected } = await api.post<{ affected: number }>("/posts/batch", {
      action,
      ids,
      topic_id: topicId,
    });
    toast(
      `已${{ publish: "发布", draft: "转草稿", delete: "删除", move: "移动" }[action]} ${affected} 篇`,
      "success"
    );
    selected.value = new Set();
    await load();
  } catch (err) {
    toastError(err);
  } finally {
    batchBusy.value = false;
  }
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const params = new URLSearchParams({ pageSize: "50" });
    if (filter.status) params.set("status", filter.status);
    if (filter.q) params.set("q", filter.q);
    if (filter.topic_id) params.set("topic_id", filter.topic_id);
    const data = await api.get<{ items: PostListItem[]; total: number }>(`/posts?${params}`);
    list.items = data.items;
    list.total = data.total;
  } catch (err) {
    toastError(err);
  } finally {
    loading.value = false;
  }
}
onMounted(async () => {
  void load();
  try {
    kb.value = await api.get<KbTree>("/kb/tree");
  } catch {
    /* 分类下拉空着即可 */
  }
});

async function remove(p: PostListItem): Promise<void> {
  if (!window.confirm(`删除《${p.title}》？此操作不可恢复。`)) return;
  try {
    await api.del(`/posts/${p.id}`);
    toast("已删除", "success");
    void load();
  } catch (err) {
    toastError(err);
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>文章</h1>
      <div class="actions">
        <AppSelect v-model="filter.status" :options="statusOptions" inline @change="load" />
        <AppSelect v-model="filter.topic_id" :options="topicOptions" inline @change="load" />
        <form @submit.prevent="load">
          <input v-model="filter.q" class="input input--inline" type="search" placeholder="搜索标题/摘要" />
        </form>
        <router-link class="btn btn-primary" to="/posts/new">写新文章</router-link>
      </div>
    </header>

    <p v-if="list.total > list.items.length" class="muted small">当前筛选共 {{ list.total }} 篇，显示最近 {{ list.items.length }} 篇（可再缩小范围）</p>

    <div v-if="selected.size" class="batchbar panel">
      <span class="small">已选 <strong>{{ selected.size }}</strong> 篇</span>
      <div class="batchbar__ops">
        <button class="btn btn-sm" type="button" :data-loading="batchBusy" @click="batch('publish')">发布</button>
        <button class="btn btn-sm" type="button" :data-loading="batchBusy" @click="batch('draft')">转草稿</button>
        <AppSelect v-model="moveTarget" :options="moveOptions" inline @change="onMove" />
        <button class="btn btn-sm btn-danger" type="button" @click="batch('delete')">删除</button>
        <button class="btn btn-sm" type="button" @click="selected = new Set()">取消</button>
      </div>
    </div>

    <div class="panel">
      <table class="table" v-if="list.items.length">
        <thead>
          <tr>
            <th class="col-check"><input type="checkbox" :checked="allSelected" @change="toggleAll" aria-label="全选" /></th>
            <th>标题</th>
            <th>状态</th>
            <th>归属</th>
            <th>更新</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list.items" :key="p.id">
            <td class="col-check">
              <input type="checkbox" :checked="selected.has(p.id)" @change="toggleOne(p.id)" :aria-label="`选择 ${p.title}`" />
            </td>
            <td>
              <router-link :to="`/posts/${p.id}`">{{ p.title }}</router-link>
              <div class="muted small mono">{{ p.slug }}</div>
            </td>
            <td>
              <span class="badge" :class="`badge-${p.status}`">
                {{ p.status === "published" ? "已发布" : "草稿" }}
              </span>
              <span v-if="p.featured" class="badge badge-featured">精选</span>
            </td>
            <td class="small">
              {{ p.domain_name ? `${p.domain_name} / ${p.topic_name ?? "—"}` : "—" }}
            </td>
            <td class="muted small">{{ p.updated_at?.slice(0, 16) }}</td>
            <td>
              <button class="btn btn-sm btn-danger" type="button" @click="remove(p)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else-if="!loading" class="muted">这里还空着。第一篇文章往往决定一座知识库的气质。</p>
    </div>
  </div>
</template>

<style scoped>
.input--inline {
  width: 12rem;
}
.batchbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-wrap: wrap;
  padding: var(--space-sm) var(--space-md);
  margin-bottom: var(--space-md);
  border-left: 3px solid var(--color-accent);
}
.batchbar__ops {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  flex-wrap: wrap;
}
.col-check {
  width: 2.2rem;
}
</style>
