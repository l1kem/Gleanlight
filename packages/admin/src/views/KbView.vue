<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { api } from "../api";
import AppSelect from "../components/AppSelect.vue";
import { toast, toastError } from "../toast";

interface Domain {
  id: number;
  slug: string;
  name: string;
  description: string;
  sort: number;
}
interface Topic {
  id: number;
  domain_id: number;
  slug: string;
  name: string;
  description: string;
  sort: number;
  published_count: number;
  draft_count: number;
}
interface KbPost {
  id: number;
  title: string;
  slug: string;
  status: string;
  topic_id: number | null;
  sort_in_topic: number;
  updated_at: string;
}
interface Health {
  brokenLinks: { sourceId: number; sourceTitle: string; sourceSlug: string; targetSlug: string }[];
  orphanPosts: { id: number; title: string; slug: string }[];
  emptyTopics: { id: number; name: string; domainName: string | null }[];
  missingSummary: { id: number; title: string }[];
  draftCount: number;
  scheduledCount: number;
}

const domains = ref<Domain[]>([]);
const topics = ref<Topic[]>([]);
const posts = ref<KbPost[]>([]);
const health = ref<Health | null>(null);
const expanded = ref<Set<number>>(new Set());
const newDomain = reactive({ name: "", description: "" });
const newTopic = reactive({ domain_id: null as number | null, name: "", description: "" });
const domainSelectOptions = computed(() =>
  domains.value.map((d) => ({ value: d.id as number | null, label: d.name }))
);
const editing = ref<Record<string, string>>({}); // 'd12'/'t7' -> 进行中的重命名

// ── 本地知识库导入（只读源目录，拷贝副本入库）─────────────────
interface ScanResult {
  root: string;
  totalMd: number;
  loose: number;
  attachRefs: number;
  domains: { name: string; topics: { name: string; count: number }[] }[];
}
const importPath = ref("~/Wiki");
const scan = ref<ScanResult | null>(null);
const importing = ref(false);

async function runScan(): Promise<void> {
  scan.value = null;
  try {
    scan.value = await api.post<ScanResult>("/wiki/scan", { path: importPath.value });
  } catch (err) {
    toastError(err);
  }
}

async function runImport(): Promise<void> {
  if (!scan.value) return;
  if (
    !window.confirm(
      `从 ${scan.value.root} 导入 ${scan.value.totalMd} 篇 md？\n源目录不会被修改；导入内容默认「草稿 + 私密」，不会进入发布产物。`,
    )
  )
    return;
  importing.value = true;
  try {
    const r = await api.post<{ imported: number; skipped: number; attachments: number }>(
      "/wiki/import",
      { path: importPath.value },
    );
    toast(
      `已导入 ${r.imported} 篇（跳过 ${r.skipped} 篇已存在），附件 ${r.attachments} 个——全部为草稿+私密`,
      "success",
    );
    scan.value = null;
    void load();
  } catch (err) {
    toastError(err);
  } finally {
    importing.value = false;
  }
}

// 拖拽状态：kind + 来源
const drag = ref<
  | { kind: "domain"; id: number }
  | { kind: "topic"; id: number }
  | { kind: "post"; id: number }
  | null
>(null);

const topicsOf = (domainId: number) => topics.value.filter((t) => t.domain_id === domainId);
const postsOf = (topicId: number) =>
  posts.value
    .filter((p) => p.topic_id === topicId)
    .sort((a, b) => a.sort_in_topic - b.sort_in_topic || a.id - b.id);

const issueCount = computed(() => {
  const h = health.value;
  if (!h) return 0;
  return h.brokenLinks.length + h.orphanPosts.length + h.emptyTopics.length;
});

async function load(): Promise<void> {
  const [tree, p, h] = await Promise.all([
    api.get<{ domains: Domain[]; topics: Topic[] }>("/kb/tree"),
    api.get<{ items: KbPost[] }>("/kb/posts"),
    api.get<Health>("/health").catch(() => null),
  ]);
  domains.value = tree.domains;
  topics.value = tree.topics;
  posts.value = p.items;
  health.value = h;
}
onMounted(load);

function toggleExpand(topicId: number): void {
  expanded.value.has(topicId) ? expanded.value.delete(topicId) : expanded.value.add(topicId);
}

// ── 排序持久化 ──────────────────────────────────────────────
async function saveDomainOrder(): Promise<void> {
  await api.put("/kb/domains/order", { ids: domains.value.map((d) => d.id) });
}
async function saveTopicOrder(): Promise<void> {
  await api.put("/kb/topics/order", { ids: topics.value.map((t) => t.id) });
}
async function savePostOrder(): Promise<void> {
  // 全量重排：每个主题内的文章按当前顺序写 sort（跨主题移动同时生效）
  const items: { id: number; topic_id: number | null; sort: number }[] = [];
  for (const t of topics.value) {
    postsOf(t.id).forEach((p, i) => items.push({ id: p.id, topic_id: t.id, sort: i }));
  }
  for (const p of posts.value.filter((x) => x.topic_id === null)) {
    items.push({ id: p.id, topic_id: null, sort: 0 });
  }
  await api.put("/kb/posts/order", { items });
}

// ── 拖拽 ────────────────────────────────────────────────────
function onDropDomain(targetId: number): void {
  const d = drag.value;
  drag.value = null;
  if (!d || d.kind !== "domain" || d.id === targetId) return;
  const from = domains.value.findIndex((x) => x.id === d.id);
  const to = domains.value.findIndex((x) => x.id === targetId);
  if (from < 0 || to < 0) return;
  const [moved] = domains.value.splice(from, 1);
  domains.value.splice(to, 0, moved);
  saveDomainOrder().catch(toastError);
}

function onDropTopic(topic: Topic): void {
  const d = drag.value;
  drag.value = null;
  if (!d) return;
  if (d.kind === "topic") {
    if (d.id === topic.id) return;
    if (topic.domain_id !== topics.value.find((t) => t.id === d.id)?.domain_id) {
      // 跨域移动
      api
        .put(`/topics/${d.id}`, { domain_id: topic.domain_id })
        .then(load)
        .catch(toastError);
      return;
    }
    const list = topics.value.filter((t) => t.domain_id === topic.domain_id);
    const from = list.findIndex((t) => t.id === d.id);
    const to = list.findIndex((t) => t.id === topic.id);
    if (from < 0 || to < 0) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    topics.value = [...topics.value]; // 触发响应
    saveTopicOrder().catch(toastError);
  } else if (d.kind === "post") {
    // 文章移入该主题（追加到末尾）
    const p = posts.value.find((x) => x.id === d.id);
    if (!p || p.topic_id === topic.id) return;
    p.topic_id = topic.id;
    p.sort_in_topic = postsOf(topic.id).length + 100;
    expanded.value.add(topic.id);
    savePostOrder().catch(toastError);
  }
}

function onDropPost(topicId: number, targetPostId: number): void {
  const d = drag.value;
  drag.value = null;
  if (!d || d.kind !== "post" || d.id === targetPostId) return;
  const list = posts.value.filter((p) => p.topic_id === topicId);
  const from = list.findIndex((p) => p.id === d.id);
  const to = list.findIndex((p) => p.id === targetPostId);
  if (to < 0) return;
  const moved = posts.value.find((p) => p.id === d.id);
  if (!moved) return;
  if (from >= 0) list.splice(from, 1);
  const insertAt = list.findIndex((p) => p.id === targetPostId);
  list.splice(insertAt, 0, moved);
  moved.topic_id = topicId;
  savePostOrder().catch(toastError);
}

// ── 增删改（原有）───────────────────────────────────────────
async function addDomain(): Promise<void> {
  if (!newDomain.name.trim()) return;
  try {
    await api.post("/domains", newDomain);
    newDomain.name = "";
    newDomain.description = "";
    void load();
  } catch (err) {
    toastError(err);
  }
}
async function addTopic(): Promise<void> {
  if (!newTopic.domain_id || !newTopic.name.trim()) {
    toast("需要选择知识域并填写主题名", "error");
    return;
  }
  try {
    await api.post("/topics", newTopic);
    newTopic.name = "";
    newTopic.description = "";
    void load();
  } catch (err) {
    toastError(err);
  }
}
async function rename(key: string, id: number, kind: "domains" | "topics"): Promise<void> {
  const name = editing.value[key]?.trim();
  if (!name) {
    delete editing.value[key];
    return;
  }
  try {
    await api.put(`/${kind}/${id}`, { name });
    delete editing.value[key];
    void load();
  } catch (err) {
    toastError(err);
  }
}
async function remove(kind: "domains" | "topics", id: number, name: string): Promise<void> {
  if (!window.confirm(`删除「${name}」？其下内容不会被删除（文章会变为未分组）。`)) return;
  try {
    await api.del(`/${kind}/${id}`);
    void load();
  } catch (err) {
    toastError(err);
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1>知识库</h1>
      <span class="muted small">域 → 主题 → 文章；行前 ⠿ 可拖拽排序，文章可拖到别的主题</span>
    </header>

    <!-- 本地知识库导入 -->
    <section class="panel importer">
      <h2>从本地知识库导入</h2>
      <p class="muted small">
        指向 Obsidian 目录（如 <span class="mono">~/Wiki</span>）：只读扫描、拷贝副本入库，源目录零修改。
        顶级目录 → 知识域，二级目录 → 主题；<span class="mono">[[双链]]</span> 与引用的附件一并迁入。
        导入内容默认「草稿 + 私密」，确认后再手动逐篇发布。
      </p>
      <div class="importer__row">
        <input v-model="importPath" class="input mono" type="text" placeholder="~/Wiki" @keyup.enter="runScan" />
        <button class="btn" type="button" @click="runScan">扫描</button>
        <button
          v-if="scan"
          class="btn btn-primary"
          type="button"
          :data-loading="importing"
          @click="runImport"
        >
          导入 {{ scan.totalMd }} 篇
        </button>
      </div>
      <div v-if="scan" class="importer__preview">
        <p class="small">
          <strong>{{ scan.root }}</strong> · 共 {{ scan.totalMd }} 篇 md · 引用附件约 {{ scan.attachRefs }} 处
        </p>
        <ul class="importer__tree">
          <li v-for="d in scan.domains" :key="d.name">
            <strong>{{ d.name }}</strong>
            <ul>
              <li v-for="t in d.topics" :key="t.name" class="muted small">
                {{ t.name }}（{{ t.count }}）
              </li>
            </ul>
          </li>
        </ul>
      </div>
    </section>

    <!-- 健康检查 -->
    <section v-if="health" class="panel health" :class="{ 'health--ok': issueCount === 0 }">
      <template v-if="issueCount === 0">
        <h2>体检 ✓</h2>
        <p class="muted small">
          无断链、无孤立文章、无空主题<template v-if="health.scheduledCount">；{{ health.scheduledCount }} 篇定时待发</template>。
        </p>
      </template>
      <template v-else>
        <h2>体检发现 {{ issueCount }} 个问题</h2>
        <div v-if="health.brokenLinks.length" class="health__group">
          <p class="small"><strong>断链 {{ health.brokenLinks.length }}</strong>（[[引用]] 了不存在的文章）</p>
          <ul class="health__list">
            <li v-for="b in health.brokenLinks" :key="`${b.sourceId}-${b.targetSlug}`">
              <router-link :to="`/posts/${b.sourceId}`">{{ b.sourceTitle }}</router-link>
              <span class="muted">→ [[{{ b.targetSlug }}]]</span>
            </li>
          </ul>
        </div>
        <div v-if="health.orphanPosts.length" class="health__group">
          <p class="small"><strong>孤立文章 {{ health.orphanPosts.length }}</strong>（不属于任何主题、也没被引用）</p>
          <ul class="health__list">
            <li v-for="o in health.orphanPosts" :key="o.id">
              <router-link :to="`/posts/${o.id}`">{{ o.title }}</router-link>
            </li>
          </ul>
        </div>
        <div v-if="health.emptyTopics.length" class="health__group">
          <p class="small"><strong>空主题 {{ health.emptyTopics.length }}</strong></p>
          <ul class="health__list">
            <li v-for="t in health.emptyTopics" :key="t.id" class="muted">
              {{ t.domainName }} / {{ t.name }}
            </li>
          </ul>
        </div>
      </template>
    </section>

    <section
      v-for="d in domains"
      :key="d.id"
      class="panel domain"
      draggable="true"
      @dragstart="drag = { kind: 'domain', id: d.id }"
      @dragover.prevent
      @drop="onDropDomain(d.id)"
    >
      <div class="domain__head">
        <span class="drag-hint" aria-hidden="true">⠿</span>
        <h2 class="domain__name">{{ d.name }}</h2>
        <span class="muted small mono">{{ d.slug }}</span>
        <div class="domain__actions">
          <button
            v-if="editing[`d${d.id}`] === undefined"
            class="btn btn-sm"
            type="button"
            @click="editing[`d${d.id}`] = d.name"
          >
            重命名
          </button>
          <template v-else>
            <input v-model="editing[`d${d.id}`]" class="input input--s" type="text" @keyup.enter="rename(`d${d.id}`, d.id, 'domains')" />
            <button class="btn btn-sm" type="button" @click="rename(`d${d.id}`, d.id, 'domains')">存</button>
            <button class="btn btn-sm" type="button" @click="delete editing[`d${d.id}`]">取消</button>
          </template>
          <button class="btn btn-sm btn-danger" type="button" @click="remove('domains', d.id, d.name)">
            删除域
          </button>
        </div>
      </div>
      <p v-if="d.description" class="muted small">{{ d.description }}</p>

      <div class="topics">
        <div
          v-for="t in topicsOf(d.id)"
          :key="t.id"
          class="topic"
          draggable="true"
          @dragstart="drag = { kind: 'topic', id: t.id }"
          @dragover.prevent
          @drop.stop="onDropTopic(t)"
        >
          <template v-if="editing[`t${t.id}`] === undefined">
            <button class="topic__expand" type="button" :aria-expanded="expanded.has(t.id)" @click="toggleExpand(t.id)">
              <span class="topic__chev" :class="{ 'topic__chev--open': expanded.has(t.id) }" aria-hidden="true">▸</span>
              <strong>{{ t.name }}</strong>
              <span class="muted small">
                {{ t.published_count }} 篇<template v-if="t.draft_count"> · {{ t.draft_count }} 草稿</template>
              </span>
            </button>
            <div class="topic__actions">
              <button class="btn btn-sm" type="button" @click="editing[`t${t.id}`] = t.name">重命名</button>
              <button class="btn btn-sm btn-danger" type="button" @click="remove('topics', t.id, t.name)">
                删除
              </button>
            </div>
          </template>
          <template v-else>
            <input v-model="editing[`t${t.id}`]" class="input input--s" type="text" @keyup.enter="rename(`t${t.id}`, t.id, 'topics')" />
            <button class="btn btn-sm" type="button" @click="rename(`t${t.id}`, t.id, 'topics')">存</button>
            <button class="btn btn-sm" type="button" @click="delete editing[`t${t.id}`]">取消</button>
          </template>

          <!-- 主题内文章（展开后可拖拽排序/跨主题移动） -->
          <div v-if="expanded.has(t.id)" class="topic__posts">
            <div
              v-for="p in postsOf(t.id)"
              :key="p.id"
              class="post-row"
              draggable="true"
              @dragstart="drag = { kind: 'post', id: p.id }"
              @dragover.prevent
              @drop.stop="onDropPost(t.id, p.id)"
            >
              <span class="drag-hint" aria-hidden="true">⠿</span>
              <router-link :to="`/posts/${p.id}`" class="post-row__title">{{ p.title }}</router-link>
              <span class="badge" :class="`badge-${p.status}`">{{ p.status === "published" ? "已发布" : "草稿" }}</span>
            </div>
            <p v-if="!postsOf(t.id).length" class="muted small topic__empty">还没有文章。在编辑页把文章归属到本主题，或从别的主题拖过来。</p>
          </div>
        </div>
        <p v-if="!topicsOf(d.id).length" class="muted small">还没有主题。</p>
      </div>
    </section>

    <div class="two-col">
      <section class="panel">
        <h2>新增知识域</h2>
        <div class="field">
          <label for="dname">名称</label>
          <input id="dname" v-model="newDomain.name" class="input" type="text" placeholder="如：工程 / 阅读 / 生活" />
        </div>
        <div class="field">
          <label for="ddesc">一句话描述</label>
          <input id="ddesc" v-model="newDomain.description" class="input" type="text" />
        </div>
        <button class="btn" type="button" @click="addDomain">添加</button>
      </section>

      <section class="panel">
        <h2>新增主题</h2>
        <div class="field">
          <label for="tdomain">所属知识域</label>
          <AppSelect v-model="newTopic.domain_id" :options="domainSelectOptions" />
        </div>
        <div class="field">
          <label for="tname">名称</label>
          <input id="tname" v-model="newTopic.name" class="input" type="text" placeholder="如：Web 基础" />
        </div>
        <div class="field">
          <label for="tdesc">一句话描述</label>
          <input id="tdesc" v-model="newTopic.description" class="input" type="text" />
        </div>
        <button class="btn" type="button" @click="addTopic">添加</button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.domain {
  transition: border-color var(--dur-short) var(--ease-out);
}
.domain[draggable="true"] {
  cursor: grab;
}
.domain:active {
  cursor: grabbing;
}
.domain__head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.domain__name {
  margin: 0;
  font-size: var(--text-lg);
}
.domain__actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-2xs);
  align-items: center;
}
.drag-hint {
  color: var(--color-neutral);
  cursor: grab;
  user-select: none;
  font-size: var(--text-sm);
}
.topics {
  margin-top: var(--space-md);
  border-top: 1px solid var(--color-rule);
  padding-top: var(--space-sm);
}
.topic {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-2xs) 0;
  flex-wrap: wrap;
}
.topic[draggable="true"] {
  cursor: grab;
}
.topic__expand {
  display: flex;
  align-items: baseline;
  gap: var(--space-xs);
  border: none;
  background: none;
  font: inherit;
  padding: 0;
  cursor: pointer;
  color: var(--color-ink);
}
.topic__expand strong {
  font-size: var(--text-md);
}
.topic__chev {
  display: inline-block;
  color: var(--color-neutral);
  transition: transform var(--dur-short) var(--ease-out);
  font-size: var(--text-xs);
}
.topic__chev--open {
  transform: rotate(90deg);
}
.topic__actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-2xs);
}
.topic__posts {
  flex-basis: 100%;
  margin: var(--space-2xs) 0 var(--space-sm);
  padding-left: var(--space-md);
  border-left: 2px solid var(--color-rule);
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
}
.topic__empty {
  margin: 0;
}
.post-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-3xs) var(--space-2xs);
  border-radius: var(--radius-sm);
  cursor: grab;
}
.post-row:hover {
  background: var(--color-paper-2);
}
.post-row__title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-lg);
  margin-top: var(--space-lg);
  align-items: start;
}
@media (max-width: 48rem) {
  .two-col {
    grid-template-columns: 1fr;
  }
}
.input--s {
  width: 10rem;
}

.importer__row {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}
.importer__row .input {
  max-width: 24rem;
}
.importer__preview {
  margin-top: var(--space-md);
  border-top: 1px dashed var(--color-rule);
  padding-top: var(--space-sm);
}
.importer__tree {
  list-style: none;
  margin: var(--space-xs) 0 0;
  padding-left: var(--space-md);
  columns: 2;
  column-gap: var(--space-2xl);
}
.importer__tree ul {
  list-style: none;
  margin: 0;
  padding-left: var(--space-md);
}
@media (max-width: 48rem) {
  .importer__tree { columns: 1; }
}

.health {
  border-left: 3px solid var(--color-accent);
}
.health--ok {
  border-left-color: var(--color-success);
}
.health h2 {
  font-size: var(--text-md);
  margin: 0 0 var(--space-xs);
}
.health__group + .health__group {
  margin-top: var(--space-sm);
}
.health__list {
  list-style: none;
  margin: var(--space-2xs) 0 0;
  padding: 0;
  font-size: var(--text-sm);
}
.health__list li {
  padding-block: var(--space-3xs);
  border-bottom: 1px dashed var(--color-rule);
}
.health__list li:last-child {
  border-bottom: none;
}
</style>
