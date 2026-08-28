<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { api } from "../api";
import { toast, toastError } from "../toast";

interface MediaItem {
  id: number;
  filename: string;
  stored_name: string;
  mime: string;
  size: number;
  created_at: string;
  refs: { id: number; title: string }[];
  thumb: string | null;
}

const items = ref<MediaItem[]>([]);
const unusedCount = ref(0);
const uploading = ref(false);
const dragOver = ref(false);
const q = ref("");

// 服务端已有 /media?q= 查询；usage 视图本地过滤即可（≤500 条）
const filtered = computed(() => {
  const kw = q.value.trim().toLowerCase();
  if (!kw) return items.value;
  return items.value.filter((m) => m.filename.toLowerCase().includes(kw));
});

// ── 批量选择与删除 ──────────────────────────────────────────
const selected = ref<Set<number>>(new Set());
const batchBusy = ref(false);
const allSelected = computed(
  () => filtered.value.length > 0 && filtered.value.every((m) => selected.value.has(m.id))
);
function toggleAll(): void {
  selected.value = allSelected.value ? new Set() : new Set(filtered.value.map((m) => m.id));
}
function toggleOne(id: number): void {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}
async function batchDelete(): Promise<void> {
  const ids = [...selected.value];
  if (!ids.length || batchBusy.value) return;
  if (!window.confirm(`删除选中的 ${ids.length} 个文件？仍被引用的会自动跳过。`)) return;
  batchBusy.value = true;
  try {
    const { deleted, skipped } = await api.post<{ deleted: number; skipped: number }>(
      "/media/batch-delete",
      { ids }
    );
    toast(`已删除 ${deleted} 个${skipped ? `，${skipped} 个因仍被引用而跳过` : ""}`, "success");
    selected.value = new Set();
    void load();
  } catch (err) {
    toastError(err);
  } finally {
    batchBusy.value = false;
  }
}

async function load(): Promise<void> {
  const data = await api.get<{ items: MediaItem[]; unusedCount: number }>("/media/usage");
  items.value = data.items;
  unusedCount.value = data.unusedCount;
}
onMounted(load);

async function upload(files: FileList | File[] | null): Promise<void> {
  if (!files) return;
  uploading.value = true;
  try {
    for (const f of Array.from(files)) {
      await api.upload(f);
    }
    toast("已上传", "success");
    void load();
  } catch (err) {
    toastError(err);
  } finally {
    uploading.value = false;
  }
}

function onDrop(e: DragEvent): void {
  dragOver.value = false;
  void upload(e.dataTransfer?.files ?? null);
}

function onPaste(e: ClipboardEvent): void {
  const files = Array.from(e.clipboardData?.files ?? []);
  if (files.length) void upload(files);
}

async function copyUrl(m: MediaItem): Promise<void> {
  await navigator.clipboard.writeText(`uploads/${m.stored_name}`);
  toast("相对路径已复制（uploads/…，可直接粘进正文）", "success");
}

async function remove(m: MediaItem): Promise<void> {
  if (!window.confirm(`删除「${m.filename}」？已插入文章的图片会失效。`)) return;
  try {
    await api.del(`/media/${m.id}`);
    void load();
  } catch (err) {
    toastError(err);
  }
}

function fmtSize(n: number): string {
  if (n > 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

async function cleanupUnused(): Promise<void> {
  const ids = items.value.filter((m) => m.refs.length === 0).map((m) => m.id);
  if (ids.length === 0) return;
  if (!window.confirm(`清理 ${ids.length} 张未被任何文章引用的图片？不可恢复。`)) return;
  try {
    const { deleted } = await api.post<{ deleted: number }>("/media/cleanup", { ids });
    toast(`已清理 ${deleted} 张`, "success");
    void load();
  } catch (err) {
    toastError(err);
  }
}

// ── 文件查看器：图片 / PDF / 文本原生，docx·xlsx 前端解析 ─────
interface ViewerState {
  item: MediaItem;
  kind: "image" | "pdf" | "text" | "docx" | "xlsx" | "other";
  text?: string;
  tables?: string[][][];
}
const viewer = ref<ViewerState | null>(null);
const viewerBusy = ref(false);

function kindOf(m: MediaItem): ViewerState["kind"] {
  const ext = m.stored_name.split(".").pop()?.toLowerCase() ?? "";
  if (m.mime.startsWith("image/")) return "image";
  if (m.mime === "application/pdf" || ext === "pdf") return "pdf";
  if (["txt", "md", "csv", "json"].includes(ext)) return "text";
  if (ext === "docx") return "docx";
  if (ext === "xlsx") return "xlsx";
  return "other";
}

async function openViewer(m: MediaItem): Promise<void> {
  const kind = kindOf(m);
  viewer.value = { item: m, kind };
  if (kind === "text" || kind === "docx" || kind === "xlsx") {
    viewerBusy.value = true;
    try {
      const url = `/uploads/${m.stored_name}`;
      const buf = await (await fetch(url)).arrayBuffer();
      if (kind === "text") {
        viewer.value.text = new TextDecoder().decode(buf);
      } else if (kind === "docx") {
        const mammoth = await import("mammoth");
        // DOCX 属于外部输入；提取纯文本而不是把生成 HTML 交给 v-html。
        const result = await mammoth.extractRawText({ arrayBuffer: buf });
        viewer.value.text = result.value;
      } else {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buf, { type: "array" });
        viewer.value.tables = wb.SheetNames.map((name) =>
          XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false }).slice(0, 200),
        );
      }
    } catch (err) {
      toastError(err instanceof Error ? err : new Error(String(err)));
      viewer.value = null;
    } finally {
      viewerBusy.value = false;
    }
  }
}
</script>

<template>
  <div class="page" @paste="onPaste">
    <header class="page-head">
      <h1>媒体库</h1>
      <div class="actions">
        <input
          v-model="q"
          class="input input--inline"
          type="search"
          placeholder="搜索文件名…"
          aria-label="搜索文件"
        />
        <button
          v-if="unusedCount > 0"
          class="btn btn-danger"
          type="button"
          @click="cleanupUnused"
        >
          清理未引用（{{ unusedCount }}）
        </button>
        <label class="btn btn-primary" :data-loading="uploading">
          {{ uploading ? "上传中…" : "上传图片" }}
          <input type="file" accept="image/*" multiple hidden @change="upload(($event.target as HTMLInputElement).files)" />
        </label>
      </div>
    </header>
    <p class="muted small">支持拖拽或直接粘贴；图片外的附件（pdf/docx/xlsx/pptx…）也可上传，点击缩略图查看。</p>

    <div v-if="selected.size" class="batchbar panel">
      <span class="small">已选 <strong>{{ selected.size }}</strong> 个</span>
      <div class="batchbar__ops">
        <button class="btn btn-sm btn-danger" type="button" :data-loading="batchBusy" @click="batchDelete">删除选中</button>
        <button class="btn btn-sm" type="button" @click="selected = new Set()">取消</button>
      </div>
    </div>

    <div
      class="drop"
      :class="{ 'is-over': dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <div v-if="filtered.length" class="grid">
        <figure v-for="m in filtered" :key="m.id" class="shot" :class="{ 'is-selected': selected.has(m.id) }">
          <label class="shot__check">
            <input
              type="checkbox"
              :checked="selected.has(m.id)"
              :aria-label="`选择 ${m.filename}`"
              @change="toggleOne(m.id)"
            />
          </label>
          <button class="shot__view" type="button" :title="kindOf(m) === 'other' ? '下载' : '查看'" @click="openViewer(m)">
            <img
              v-if="m.mime.startsWith('image/')"
              :src="m.thumb ?? `/uploads/${m.stored_name}`"
              :alt="m.filename"
              loading="lazy"
              decoding="async"
            />
            <span v-else class="shot__fileicon mono">.{{ m.stored_name.split(".").pop() }}</span>
          </button>
          <span v-if="m.refs.length === 0" class="shot__unused" title="未被任何文章引用">未引用</span>
          <span v-else class="shot__refs" :title="m.refs.map((r) => r.title).join('\n')">
            被 {{ m.refs.length }} 篇引用
          </span>
          <figcaption>
            <span class="shot__name" :title="m.filename">{{ m.filename }}</span>
            <span class="muted small">{{ fmtSize(m.size) }}</span>
            <span class="shot__ops">
              <button class="btn btn-sm" type="button" @click="copyUrl(m)">复制引用</button>
              <button class="btn btn-sm btn-danger" type="button" @click="remove(m)">删</button>
            </span>
          </figcaption>
        </figure>
      </div>
      <p v-else-if="items.length" class="muted drop__empty">没有匹配「{{ q }}」的文件</p>
      <p v-else class="muted drop__empty">把图片拖到这里，或 Ctrl/⌘+V 粘贴截图</p>
    </div>

    <!-- 文件查看器 -->
    <div v-if="viewer" class="viewer-layer" @click.self="viewer = null">
      <div class="viewer-box" role="dialog" aria-modal="true" :aria-label="`查看 ${viewer.item.filename}`">
        <div class="viewer-bar">
          <strong class="viewer-name">{{ viewer.item.filename }}</strong>
          <div class="viewer-ops">
            <a class="btn btn-sm" :href="`/uploads/${viewer.item.stored_name}`" :download="viewer.item.filename">下载</a>
            <button class="btn btn-sm" type="button" @click="viewer = null">关闭</button>
          </div>
        </div>
        <div class="viewer-body">
          <p v-if="viewerBusy" class="muted">解析中…</p>
          <img v-else-if="viewer.kind === 'image'" :src="`/uploads/${viewer.item.stored_name}`" :alt="viewer.item.filename" />
          <iframe
            v-else-if="viewer.kind === 'pdf'"
            :src="`/uploads/${viewer.item.stored_name}`"
            :title="viewer.item.filename"
          ></iframe>
          <pre v-else-if="viewer.kind === 'text'" class="viewer-pre mono">{{ viewer.text }}</pre>
          <div v-else-if="viewer.kind === 'docx' && viewer.text" class="viewer-doc">
            <p v-for="(paragraph, i) in viewer.text.split(/\n{2,}/).filter(Boolean)" :key="i">
              {{ paragraph }}
            </p>
          </div>
          <div v-else-if="viewer.kind === 'xlsx' && viewer.tables" class="viewer-sheet">
            <div v-for="(rows, i) in viewer.tables" :key="i" class="viewer-sheet__table">
              <p class="muted small">Sheet {{ i + 1 }}</p>
              <table class="table">
                <tbody>
                  <tr v-for="(row, ri) in rows" :key="ri">
                    <td v-for="(cell, ci) in row" :key="ci">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
          <div v-else class="viewer-other">
            <p class="muted">这个类型暂不支持在线预览，可下载后本地打开。</p>
            <a class="btn" :href="`/uploads/${viewer.item.stored_name}`" :download="viewer.item.filename">下载文件</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drop {
  border: 1px dashed var(--color-rule-strong);
  border-radius: var(--radius-sm);
  padding: var(--space-lg);
  transition: background-color var(--dur-short) var(--ease-out);
  min-height: 10rem;
  display: grid;
  place-items: center;
}
.drop.is-over {
  background: var(--color-paper-2);
}
.drop__empty {
  text-align: center;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: var(--space-lg);
  width: 100%;
}
.shot {
  margin: 0;
  min-width: 0;
  position: relative;
}
.shot.is-selected {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
.shot__check {
  position: absolute;
  top: var(--space-2xs);
  left: var(--space-2xs);
  z-index: 1;
  display: grid;
  place-items: center;
  width: 1.5rem;
  height: 1.5rem;
  background: color-mix(in oklch, var(--color-paper) 88%, transparent);
  border-radius: var(--radius-sm);
  cursor: pointer;
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
.input--inline {
  width: 12rem;
}
.shot__view {
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid var(--color-rule);
  border-radius: var(--radius-sm);
  background: var(--color-paper-2);
  cursor: pointer;
  overflow: hidden;
}
.shot__view img {
  display: block;
  width: 100%;
  height: 8rem;
  object-fit: cover;
}
.shot__fileicon {
  display: grid;
  place-items: center;
  height: 8rem;
  font-size: var(--text-lg);
  color: var(--color-neutral);
}
.shot__unused,
.shot__refs {
  position: absolute;
  top: var(--space-2xs);
  right: var(--space-2xs);
  font-size: var(--text-xs);
  padding: var(--space-3xs) var(--space-2xs);
  border-radius: var(--radius-sm);
  background: var(--color-paper);
  border: 1px solid var(--color-rule-strong);
  color: var(--color-muted);
}
.shot__unused {
  color: var(--color-danger);
  border-color: var(--color-danger);
}

/* 查看器 */
.viewer-layer {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  background: var(--color-scrim);
  display: grid;
  place-items: center;
  padding: var(--space-lg);
}
.viewer-box {
  width: min(56rem, 100%);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--color-paper);
  border: 1px solid var(--color-rule-strong);
  border-radius: var(--radius-sm);
  overflow: clip;
}
.viewer-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-md);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-paper-2);
  border-bottom: 1px solid var(--color-rule);
}
.viewer-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.viewer-ops {
  display: flex;
  gap: var(--space-2xs);
  flex: none;
}
.viewer-body {
  overflow: auto;
  padding: var(--space-md);
}
.viewer-body img {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin-inline: auto;
}
.viewer-body iframe {
  width: 100%;
  height: 70vh;
  border: none;
}
.viewer-pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: var(--text-sm);
  line-height: 1.7;
}
.viewer-doc {
  max-width: var(--measure);
  margin-inline: auto;
  line-height: 1.8;
}
.viewer-doc :deep(img) {
  max-width: 100%;
}
.viewer-sheet__table {
  margin-bottom: var(--space-lg);
}
.viewer-other {
  text-align: center;
  padding: var(--space-xl);
}
.shot figcaption {
  margin-top: var(--space-2xs);
  display: flex;
  flex-direction: column;
  gap: var(--space-3xs);
  font-size: var(--text-xs);
}
.shot__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.shot__ops {
  display: flex;
  gap: var(--space-2xs);
}
</style>
