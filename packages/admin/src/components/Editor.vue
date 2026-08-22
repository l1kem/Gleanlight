<script setup lang="ts">
/**
 * Vditor 封装 —— 类 Typora 体验：
 *  - 默认「分屏预览」(sv)：左写右看，滚动同步
 *  - 可切「即时渲染」(ir)：光标处直接渲染，即 Typora 主模式
 *  - 粘贴/上传图片直传媒体库；主题跟随站点明暗
 */
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import Vditor from "vditor";
import { api } from "../api";
import { toastError } from "../toast";

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ (e: "update:modelValue", v: string): void }>();

const el = ref<HTMLElement>();
let vd: Vditor | null = null;
const currentMode = ref<"sv" | "ir">("sv");

/** 上传并返回存储名（md 里写 uploads/<storedName> 相对路径） */
async function uploadFile(file: File): Promise<{ storedName: string }> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/media", { method: "POST", body: form });
  const data = (await res.json()) as { stored_name?: string; error?: string };
  if (!res.ok || !data.stored_name) throw new Error(data.error ?? "上传失败");
  return { storedName: data.stored_name };
}

const TOOLBAR = [
  "headings",
  "bold",
  "italic",
  "strike",
  "|",
  "list",
  "ordered-list",
  "check",
  "quote",
  "|",
  "code",
  "inline-code",
  "link",
  "table",
  "|",
  "undo",
  "redo",
  "|",
  "edit-mode",
  "fullscreen",
];

function init(mode: "sv" | "ir"): void {
  if (!el.value) return;
  vd?.destroy();
  vd = new Vditor(el.value, {
    value: props.modelValue,
    mode,
    theme: document.documentElement.dataset.theme === "dark" ? "dark" : "classic",
    lang: "zh_CN",
    toolbar: TOOLBAR,
    cache: { enable: false },
    counter: { enable: true, type: "chinese" as unknown as "text" },
    height: "calc(100vh - 12rem)",
    minHeight: 480,
    placeholder: "落笔即是序章 …",
    preview: {
      delay: 180,
      hljs: { lineNumber: false, style: "github" },
      // 相对路径 uploads/<file> 在预览里补根（server 提供 /uploads/ 别名）
      transform(html: string): string {
        return html.replace(/(src=")uploads\//g, "$1/uploads/");
      },
    },
    input(v: string) {
      emit("update:modelValue", v);
    },
    upload: {
      async handler(files: File[]): Promise<null> {
        try {
          for (const f of files) {
            const { storedName } = await uploadFile(f);
            // md 源文统一写相对路径：迁移时 content + uploads/ 一起搬即可
            vd?.insertValue(`![${f.name}](uploads/${storedName})\n`);
          }
        } catch (err) {
          toastError(err);
        }
        return null;
      },
    },
  });
}

onMounted(() => init(currentMode.value));
onBeforeUnmount(() => vd?.destroy());

// 外部赋值（文章异步加载/版本回滚/AI 改写）同步进编辑器。
// 编辑器聚焦中视为用户输入态，跳过回写，避免打字时 setValue 打断光标
watch(
  () => props.modelValue,
  (v) => {
    if (!vd || v === vd.getValue()) return;
    const active = document.activeElement;
    if (active && el.value?.contains(active)) return;
    vd.setValue(v);
  }
);

function setMode(mode: "sv" | "ir"): void {
  if (mode === currentMode.value) return;
  currentMode.value = mode;
  init(mode);
}

window.addEventListener("blog-theme-change", (e) => {
  const dark = (e as CustomEvent<string>).detail === "dark";
  vd?.setTheme(dark ? "dark" : "classic");
});

defineExpose({
  getSelection(): string {
    return vd?.getSelection() ?? "";
  },
  insert(text: string): void {
    vd?.insertValue(text);
  },
});
</script>

<template>
  <div class="editor-wrap">
    <div class="editor-modes">
      <button
        type="button"
        class="btn btn-sm"
        :class="{ 'is-on': currentMode === 'sv' }"
        @click="setMode('sv')"
      >
        分屏预览
      </button>
      <button
        type="button"
        class="btn btn-sm"
        :class="{ 'is-on': currentMode === 'ir' }"
        @click="setMode('ir')"
      >
        即时渲染
      </button>
      <span class="muted small editor-modes__hint">即时渲染即 Typora 主模式；[[slug]] 可引用其他文章</span>
    </div>
    <div ref="el" />
  </div>
</template>

<style scoped>
/* 外框由 wrap 统一提供；vditor 自身边框已在 vditor-theme.css 中收敛为上边线 */
.editor-wrap {
  border: 1px solid var(--color-rule-strong);
  border-radius: var(--radius-sm);
  overflow: clip;
  transition: border-color var(--dur-short) var(--ease-out);
}
.editor-wrap:focus-within {
  border-color: var(--color-accent);
}
.editor-modes {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-2xs) var(--space-xs);
  border-bottom: none;
  background: var(--color-paper-2);
}
.editor-modes__hint {
  margin-left: auto;
  margin-right: var(--space-sm);
}
.editor-modes .is-on {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
</style>
