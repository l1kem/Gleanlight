<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { api } from "../api";
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
        <select v-model="filter.status" class="select select--inline" @change="load">
          <option value="">全部状态</option>
          <option value="published">已发布</option>
          <option value="draft">草稿</option>
        </select>
        <select v-model="filter.topic_id" class="select select--inline" @change="load">
          <option value="">全部分类</option>
          <optgroup
            v-for="d in kb.domains"
            :key="d.id"
            :label="d.name"
          >
            <option
              v-for="t in kb.topics.filter((t) => t.domain_id === d.id)"
              :key="t.id"
              :value="t.id"
            >
              {{ t.name }}
            </option>
          </optgroup>
        </select>
        <form @submit.prevent="load">
          <input v-model="filter.q" class="input input--inline" type="search" placeholder="搜索标题/摘要" />
        </form>
        <router-link class="btn btn-primary" to="/posts/new">写新文章</router-link>
      </div>
    </header>

    <p v-if="list.total > list.items.length" class="muted small">当前筛选共 {{ list.total }} 篇，显示最近 {{ list.items.length }} 篇（可再缩小范围）</p>

    <div class="panel">
      <table class="table" v-if="list.items.length">
        <thead>
          <tr>
            <th>标题</th>
            <th>状态</th>
            <th>归属</th>
            <th>更新</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in list.items" :key="p.id">
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
.select--inline {
  width: auto;
}
</style>
