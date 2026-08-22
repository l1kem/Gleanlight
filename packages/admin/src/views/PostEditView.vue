<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { toast, toastError } from "../toast";
import Editor from "../components/Editor.vue";

interface PostDetail {
  id: number;
  slug: string;
  title: string;
  summary: string;
  content_md: string;
  status: "draft" | "published";
  featured: boolean;
  topic_id: number | null;
  sort_in_topic: number;
  tags: string[];
  cover: string | null;
  links: string[];
  scheduled_at?: string | null;
  private?: number;
  updated_at?: string;
  backlinks: { id: number; slug: string; title: string }[];
}

interface RevisionItem {
  id: number;
  title: string;
  summary: string;
  chars: number;
  created_at: string;
}

interface KbTree {
  domains: { id: number; slug: string; name: string }[];
  topics: { id: number; domain_id: number; slug: string; name: string }[];
}

const route = useRoute();
const router = useRouter();
const postId = computed(() => (route.params.id ? Number(route.params.id) : null));

const form = reactive({
  id: null as number | null,
  title: "",
  slug: "",
  summary: "",
  content_md: "",
  status: "draft" as "draft" | "published",
  featured: false,
  topic_id: null as number | null,
  sort_in_topic: 0,
  tags: [] as string[],
  cover: "" as string,
  links: [] as string[],
  backlinks: [] as PostDetail["backlinks"],
  scheduled_at: "" as string,
  private: false,
});
const kb = ref<KbTree>({ domains: [], topics: [] });
const editorRef = ref<InstanceType<typeof Editor>>();
const saving = ref(false);
const dirty = ref(false);
const savedAt = ref("");
const aiBusy = ref("");
const titleCandidates = ref<string[]>([]);
const tagCandidates = ref<string[]>([]);

// 前台预览弹层
const previewHtml = ref("");
const previewOpen = ref(false);

// 版本历史
const revisions = ref<RevisionItem[]>([]);
const revView = ref<RevisionItem & { content_md: string } | null>(null);

function markDirty(): void {
  dirty.value = true;
}

function onTagsChange(e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  form.tags = value
    .split(/[,，]/)
    .map((s: string) => s.trim())
    .filter(Boolean);
  markDirty();
}

onMounted(async () => {
  const tree = await api.get<KbTree>("/kb/tree");
  kb.value = tree;
  if (postId.value) {
    const p = await api.get<PostDetail>(`/posts/${postId.value}`);
    Object.assign(form, {
      ...p,
      tags: Array.isArray(p.tags) ? p.tags : JSON.parse(p.tags || "[]"),
      cover: p.cover ?? "",
      scheduled_at: toLocalInput(p.scheduled_at ?? ""),
      private: Boolean(p.private),
    });
    savedAt.value = p.updated_at ?? "";
    void loadRevisions();
  }
  window.addEventListener("blog-open-preview", openPreview);
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("beforeunload", onBeforeUnload);
  autoSaveTimer = setInterval(autoSave, 30_000);
});

let autoSaveTimer: ReturnType<typeof setInterval> | undefined;

onBeforeUnmount(() => {
  clearInterval(autoSaveTimer);
  window.removeEventListener("blog-open-preview", openPreview);
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("beforeunload", onBeforeUnload);
});

// 离开保护：有未保存修改时拦截刷新/关页
function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (!dirty.value) return;
  e.preventDefault();
  e.returnValue = "";
}

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") {
    e.preventDefault();
    void save();
  }
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  try {
    const payload = {
      title: form.title,
      slug: form.slug || undefined,
      summary: form.summary,
      content_md: form.content_md,
      status: form.status,
      featured: form.featured,
      topic_id: form.topic_id,
      sort_in_topic: form.sort_in_topic,
      tags: form.tags,
      cover: form.cover || null,
      scheduled_at: toSqlTs(form.scheduled_at),
      private: form.private,
    };
    if (form.id) {
      await api.put(`/posts/${form.id}`, payload);
    } else {
      const created = await api.post<{ id: number; slug: string }>("/posts", payload);
      form.id = created.id;
      form.slug = created.slug;
      router.replace(`/posts/${created.id}`);
    }
    dirty.value = false;
    savedAt.value = new Date().toLocaleTimeString("zh-CN");
    void loadRevisions(); // 保存产生快照，刷新列表
  } catch (err) {
    toastError(err);
  } finally {
    saving.value = false;
  }
}

// ── 定时发布：datetime-local ⇆ sqlite "YYYY-MM-DD HH:MM:SS" ──
function toLocalInput(sqlTs: string): string {
  if (!sqlTs) return "";
  return sqlTs.slice(0, 16).replace(" ", "T");
}
function toSqlTs(localInput: string): string | null {
  if (!localInput) return null;
  return `${localInput.replace("T", " ")}:00`;
}

// ── 版本历史 ─────────────────────────────────────────────────
async function loadRevisions(): Promise<void> {
  if (!form.id) return;
  try {
    const { items } = await api.get<{ items: RevisionItem[] }>(`/posts/${form.id}/revisions`);
    revisions.value = items;
  } catch {
    revisions.value = [];
  }
}

async function viewRevision(r: RevisionItem): Promise<void> {
  revView.value = await api.get<RevisionItem & { content_md: string }>(
    `/posts/${form.id}/revisions/${r.id}`,
  );
}

async function restoreRevision(r: RevisionItem): Promise<void> {
  if (!window.confirm(`回滚到「${r.created_at.slice(0, 16)}」的版本？当前内容会先存为一个新版本。`)) return;
  try {
    await save(); // 先落当前修改，再回滚
    await api.post(`/posts/${form.id}/revisions/${r.id}/restore`);
    const p = await api.get<PostDetail>(`/posts/${form.id}`);
    Object.assign(form, {
      ...p,
      tags: Array.isArray(p.tags) ? p.tags : JSON.parse(p.tags || "[]"),
      cover: p.cover ?? "",
      scheduled_at: toLocalInput(p.scheduled_at ?? ""),
      private: Boolean(p.private),
    });
    dirty.value = false;
    savedAt.value = p.updated_at ?? "";
    void loadRevisions();
    toast("已回滚", "success");
  } catch (err) {
    toastError(err);
  }
}

// ── 大纲：从 markdown 提取 h2/h3，点击滚动编辑器预览区 ──────────
const outline = computed(() => {
  const out: { level: number; text: string }[] = [];
  for (const m of form.content_md.matchAll(/^(#{2,3})\s+(.+)$/gm)) {
    out.push({ level: m[1].length, text: m[2].trim().replace(/[#*`]+/g, "") });
  }
  return out;
});

function scrollOutline(text: string): void {
  const root = document.querySelector(".vditor");
  if (!root) return;
  const heads = [...root.querySelectorAll<HTMLElement>("h1,h2,h3,h4")];
  const hit = heads.find((h) => (h.textContent ?? "").trim().startsWith(text));
  hit?.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function autoSave(): Promise<void> {
  if (dirty.value && form.id && !saving.value) {
    await save();
    toast("已自动保存草稿", "success");
  }
}

async function togglePublish(): Promise<void> {
  form.status = form.status === "published" ? "draft" : "published";
  if (form.status === "published") form.scheduled_at = ""; // 已手动发布，定时失义
  await save();
  toast(form.status === "published" ? "已标记发布，下次构建生效" : "已撤回为草稿", "success");
}

async function removePost(): Promise<void> {
  if (!form.id) return;
  if (!window.confirm(`删除《${form.title}》？不可恢复。`)) return;
  await api.del(`/posts/${form.id}`);
  toast("已删除", "success");
  router.replace("/posts");
}

// ── AI 辅助 ─────────────────────────────────────────────────
async function ai(action: string, after: (text: string) => void): Promise<void> {
  if (!form.content_md.trim()) {
    toast("先写点内容，AI 才有料可循", "error");
    return;
  }
  aiBusy.value = action;
  try {
    const { result } = await api.post<{ result: string }>(`/ai/${action}`, {
      content: form.content_md,
    });
    after(result);
  } catch (err) {
    toastError(err);
  } finally {
    aiBusy.value = "";
  }
}

function applyAiSummary(text: string): void {
  form.summary = text.trim();
  markDirty();
}
function offerAiTitles(text: string): void {
  titleCandidates.value = text.split("\n").map((s) => s.replace(/^[\d.、\-\s]+/, "").trim()).filter(Boolean);
}
function offerAiTags(text: string): void {
  tagCandidates.value = text.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
}
async function aiPolishSelection(): Promise<void> {
  const sel = editorRef.value?.getSelection() ?? "";
  if (!sel.trim()) {
    toast("请先在编辑器中选中一段文字", "error");
    return;
  }
  aiBusy.value = "polish";
  try {
    const { result } = await api.post<{ result: string }>("/ai/polish", { content: sel });
    editorRef.value?.insert(result);
    markDirty();
  } catch (err) {
    toastError(err);
  } finally {
    aiBusy.value = "";
  }
}
async function aiContinue(): Promise<void> {
  aiBusy.value = "continue";
  try {
    const { result } = await api.post<{ result: string }>("/ai/continue", {
      content: form.content_md,
    });
    editorRef.value?.insert(`\n\n${result.trim()}\n`);
    markDirty();
  } catch (err) {
    toastError(err);
  } finally {
    aiBusy.value = "";
  }
}

async function openPreview(): Promise<void> {
  await save();
  const { html } = await api.post<{ html: string }>("/preview", { md: form.content_md });
  previewHtml.value = html;
  previewOpen.value = true;
}

const topicOptions = computed(() => kb.value.topics);
const domainOf = (domainId: number) => kb.value.domains.find((d) => d.id === domainId);
</script>

<template>
  <div class="edit">
    <header class="edit__head">
      <div class="edit__status">
        <h1>{{ form.id ? "编辑文章" : "新文章" }}</h1>
        <span class="badge" :class="`badge-${form.status}`">
          {{ form.status === "published" ? "已发布" : "草稿" }}
        </span>
        <span v-if="form.scheduled_at" class="badge badge-featured">定时 {{ form.scheduled_at.replace("T", " ") }}</span>
        <span v-if="form.private" class="badge badge-draft">🔒 私密</span>
        <span v-if="savedAt" class="muted small">已保存 {{ savedAt }}</span>
        <span v-else-if="dirty" class="small" style="color: var(--color-danger)">有未保存修改</span>
      </div>
      <div class="edit__actions">
        <button class="btn" type="button" :data-loading="aiBusy !== ''" @click="openPreview">
          前台预览
        </button>
        <button class="btn" type="button" :data-loading="saving" @click="save">保存 ⌘S</button>
        <button class="btn btn-primary" type="button" @click="togglePublish">
          {{ form.status === "published" ? "撤回草稿" : "标记发布" }}
        </button>
        <button v-if="form.id" class="btn btn-danger" type="button" @click="removePost">删除</button>
      </div>
    </header>

    <div class="edit__body">
      <div class="edit__main">
        <input
          v-model="form.title"
          class="edit__title"
          type="text"
          placeholder="标题"
          @input="markDirty"
        />
        <Editor ref="editorRef" v-model="form.content_md" @update:model-value="markDirty" />

        <section class="ai-panel">
          <h2 class="ai-panel__title">AI 助手</h2>
          <div class="ai-panel__row">
            <button class="btn btn-sm" type="button" :data-loading="aiBusy === 'summary'" @click="ai('summary', applyAiSummary)">
              生成摘要
            </button>
            <button class="btn btn-sm" type="button" :data-loading="aiBusy === 'titles'" @click="ai('titles', offerAiTitles)">
              候选标题
            </button>
            <button class="btn btn-sm" type="button" :data-loading="aiBusy === 'tags'" @click="ai('tags', offerAiTags)">
              标签建议
            </button>
            <button class="btn btn-sm" type="button" :data-loading="aiBusy === 'polish'" @click="aiPolishSelection">
              润色选中
            </button>
            <button class="btn btn-sm" type="button" :data-loading="aiBusy === 'continue'" @click="aiContinue">
              续写
            </button>
            <span class="muted small">模型在「设置」中配置；润色请先选中文字</span>
          </div>
          <div v-if="titleCandidates.length" class="ai-panel__candidates">
            <button
              v-for="t in titleCandidates"
              :key="t"
              class="btn btn-sm"
              type="button"
              @click="form.title = t; titleCandidates = []; markDirty()"
            >
              {{ t }}
            </button>
          </div>
          <div v-if="tagCandidates.length" class="ai-panel__candidates">
            <button
              v-for="t in tagCandidates"
              :key="t"
              class="btn btn-sm"
              type="button"
              @click="!form.tags.includes(t) && form.tags.push(t); tagCandidates = []; markDirty()"
            >
              + {{ t }}
            </button>
          </div>
        </section>
      </div>

      <aside class="edit__meta">
        <section v-if="outline.length" class="outline">
          <h2>大纲</h2>
          <button
            v-for="(h, i) in outline"
            :key="i"
            class="outline__item"
            :class="{ 'outline__item--sub': h.level === 3 }"
            type="button"
            @click="scrollOutline(h.text)"
          >
            {{ h.text }}
          </button>
        </section>

        <div class="field">
          <label for="slug">slug（URL）</label>
          <input id="slug" v-model="form.slug" class="input mono" type="text" placeholder="留空按标题生成" @input="markDirty" />
        </div>
        <div class="field">
          <label for="summary">摘要</label>
          <textarea id="summary" v-model="form.summary" class="textarea" rows="4" placeholder="80–140 字，前台列表与搜索使用" @input="markDirty" />
        </div>
        <div class="field">
          <label for="tags">标签（逗号分隔）</label>
          <input
            id="tags"
            :value="form.tags.join(', ')"
            class="input"
            type="text"
            @change="onTagsChange"
          />
        </div>
        <div class="field">
          <label for="topic">知识主题</label>
          <select id="topic" v-model="form.topic_id" class="select" @change="markDirty">
            <option :value="null">（不属于任何主题）</option>
            <option v-for="t in topicOptions" :key="t.id" :value="t.id">
              {{ domainOf(t.domain_id)?.name }} / {{ t.name }}
            </option>
          </select>
          <span class="hint">主题内的阅读顺序由下方序号决定</span>
        </div>
        <div class="field field--row">
          <div>
            <label for="sort">主题内序号</label>
            <input id="sort" v-model.number="form.sort_in_topic" class="input" type="number" min="0" @input="markDirty" />
          </div>
          <label class="check">
            <input v-model="form.featured" type="checkbox" @change="markDirty" />
            精选文章
          </label>
        </div>

        <div class="field">
          <label for="scheduled">定时发布（草稿到点自动发布并构建）</label>
          <div class="scheduled-row">
            <input
              id="scheduled"
              v-model="form.scheduled_at"
              class="input"
              type="datetime-local"
              :disabled="form.status === 'published'"
              @input="markDirty"
            />
            <button v-if="form.scheduled_at" class="btn btn-sm" type="button" @click="form.scheduled_at = ''; markDirty()">
              取消
            </button>
          </div>
          <span class="hint">到点后服务器自动转为已发布并触发前台构建</span>
        </div>

        <div class="field">
          <label class="check">
            <input v-model="form.private" type="checkbox" @change="markDirty" />
            🔒 私密可见（不进入发布产物）
          </label>
          <span class="hint">开启后这篇文章只存在于后台书房与知识图谱，永远不进入发布产物</span>
        </div>

        <div v-if="form.links.length || form.backlinks.length" class="edit__links">
          <h2>知识关联</h2>
          <p v-if="form.links.length" class="small muted">本文引用：</p>
          <div v-for="s in form.links" :key="s" class="tag mono">{{ s }}</div>
          <p v-if="form.backlinks.length" class="small muted">引用本文：</p>
          <div v-for="b in form.backlinks" :key="b.id" class="tag">{{ b.title }}</div>
        </div>

        <section class="revisions">
          <h2>版本历史</h2>
          <p v-if="!revisions.length" class="hint">每次保存自动留快照；改坏了随时回滚。</p>
          <ul v-else class="revisions__list">
            <li v-for="r in revisions" :key="r.id">
              <button class="revisions__when" type="button" title="查看该版本内容" @click="viewRevision(r)">
                {{ r.created_at.slice(0, 16) }}
              </button>
              <span class="revisions__meta">{{ r.chars }} 字</span>
              <button class="btn btn-sm" type="button" @click="restoreRevision(r)">回滚</button>
            </li>
          </ul>
        </section>
      </aside>
    </div>

    <div v-if="previewOpen" class="preview-layer" @click.self="previewOpen = false">
      <div class="preview-box">
        <div class="preview-bar">
          <strong>前台渲染预览</strong>
          <button class="btn btn-sm" type="button" @click="previewOpen = false">关闭</button>
        </div>
        <!-- html 来自自家渲染器（markdown-it），非用户输入裸 HTML 直传 -->
        <div class="preview-body prose" v-html="previewHtml" />
      </div>
    </div>

    <div v-if="revView" class="preview-layer" @click.self="revView = null">
      <div class="preview-box">
        <div class="preview-bar">
          <strong>版本快照 · {{ revView.created_at.slice(0, 16) }} · {{ revView.title }}</strong>
          <div class="preview-bar__ops">
            <button class="btn btn-sm" type="button" @click="restoreRevision(revView); revView = null">回滚到此版本</button>
            <button class="btn btn-sm" type="button" @click="revView = null">关闭</button>
          </div>
        </div>
        <pre class="rev-body mono">{{ revView.content_md }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.edit {
  max-width: 90rem;
  margin: 0 auto;
  padding: var(--space-lg) var(--space-lg) var(--space-3xl);
}
.edit__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  flex-wrap: wrap;
  margin-bottom: var(--space-md);
}
.edit__status {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.edit__status h1 {
  margin: 0;
  font-size: var(--text-xl);
}
.edit__actions {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
}
.edit__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18rem;
  gap: var(--space-lg);
  align-items: start;
}
.edit__title {
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--color-rule);
  background: transparent;
  font-family: var(--font-display);
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--color-ink-strong);
  padding: var(--space-xs) 0;
  margin-bottom: var(--space-md);
}
.edit__title:focus-visible {
  outline: none;
  border-bottom-color: var(--color-accent);
}
.edit__meta {
  position: sticky;
  top: var(--space-md);
}
.field--row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  align-items: end;
}
.check {
  display: flex;
  gap: var(--space-2xs);
  align-items: center;
  font-size: var(--text-sm);
  color: var(--color-ink);
  padding-bottom: var(--space-sm);
}
.edit__links h2 {
  font-size: var(--text-md);
  margin: var(--space-lg) 0 var(--space-xs);
}

/* ── 大纲 / 定时 / 版本 ─────────────────────────────────────── */
.outline h2,
.revisions h2 {
  font-size: var(--text-md);
  margin: var(--space-lg) 0 var(--space-xs);
}
.outline {
  max-height: 14rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.outline__item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: none;
  color: var(--color-muted);
  font: inherit;
  font-size: var(--text-sm);
  line-height: 1.7;
  padding: var(--space-3xs) var(--space-2xs);
  border-radius: var(--radius-sm);
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.outline__item:hover {
  color: var(--color-accent);
  background: var(--color-paper-3);
}
.outline__item--sub {
  padding-left: var(--space-md);
}
.scheduled-row {
  display: flex;
  gap: var(--space-2xs);
  align-items: center;
}
.revisions__list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.revisions__list li {
  display: flex;
  align-items: center;
  gap: var(--space-2xs);
  padding-block: var(--space-3xs);
  border-bottom: 1px dashed var(--color-rule);
}
.revisions__when {
  border: none;
  background: none;
  font: inherit;
  font-size: var(--text-xs);
  color: var(--color-ink);
  cursor: pointer;
  font-variant-numeric: tabular-nums;
  padding: 0;
}
.revisions__when:hover {
  color: var(--color-accent);
  text-decoration: underline;
}
.revisions__meta {
  flex: 1;
  font-size: var(--text-xs);
  color: var(--color-neutral);
}
.preview-bar__ops {
  display: flex;
  gap: var(--space-2xs);
}
.rev-body {
  margin: 0;
  padding: var(--space-lg) var(--space-xl);
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--text-sm);
  line-height: 1.8;
  color: var(--color-ink);
}

.ai-panel {
  margin-top: var(--space-lg);
  border-top: 3px double var(--color-rule-strong);
  padding-top: var(--space-md);
}
.ai-panel__title {
  font-size: var(--text-md);
  margin-bottom: var(--space-sm);
}
.ai-panel__row {
  display: flex;
  gap: var(--space-xs);
  flex-wrap: wrap;
  align-items: center;
}
.ai-panel__candidates {
  display: flex;
  gap: var(--space-2xs);
  flex-wrap: wrap;
  margin-top: var(--space-sm);
}

.preview-layer {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: oklch(20% 0.01 60 / 0.5);
  display: grid;
  place-items: center;
  padding: var(--space-lg);
}
.preview-box {
  width: min(48rem, 100%);
  max-height: 85vh;
  overflow: auto;
  background: var(--color-paper);
  border: 1px solid var(--color-rule-strong);
}
.preview-bar {
  position: sticky;
  top: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-lg);
  background: var(--color-paper-2);
  border-bottom: 1px solid var(--color-rule);
}
.preview-body {
  padding: var(--space-xl) var(--space-2xl);
}

@media (max-width: 64rem) {
  .edit__body {
    grid-template-columns: 1fr;
  }
  .edit__meta {
    position: static;
  }
}
</style>
