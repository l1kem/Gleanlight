/// <reference path="./types.d.ts" />
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import taskLists from "markdown-it-task-lists";
import hljs from "highlight.js";

/**
 * 前台(Astro 构建时)与后台(预览接口)共用的 Markdown 渲染器。
 * 规则单一来源，保证「编辑预览 ≈ 前台效果」。
 * 扩展：[[slug]] / [[slug|标题]] 双向关联链接（知识库体系核心）。
 */

const md: MarkdownIt = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
      } catch {
        /* fallthrough */
      }
    }
    return md.utils.escapeHtml(code);
  },
})
  .use(anchor, { slugify: slugifyZh, permalink: false })
  .use(taskLists, { label: true });

/** 中英混排标题 slug：保留中文，转小写、空格转连字符 */
export function slugifyZh(s: string): string {
  return encodeURIComponent(
    String(s).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\p{L}\p{N}-]/gu, "")
  );
}

/** 行内 wikilink：[[slug]] 或 [[slug|显示名]] —— 在 render 前展开为标准链接 */
function expandWikilinks(src: string): string {
  return src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, slug: string, label?: string) => {
    const target = slug.trim();
    const text = (label ?? slug).trim();
    return `[${text}](/posts/${target})`;
  });
}

md.core.ruler.before("normalize", "wikilink_expand", (state) => {
  state.src = expandWikilinks(state.src);
});

// 附件相对路径：md 源文统一写 uploads/<file>（数据迁移友好），
// 渲染时补根斜杠 → /uploads/<file>（后台由 server 别名、前台由 public/uploads 提供）
md.core.ruler.before("normalize", "uploads_prefix", (state) => {
  state.src = state.src.replace(/(\]\()(uploads\/[^)\s]+)(?=\))/g, "$1/$2");
});

// 代码块：印刷式框架（顶部语言标签行 + 上下细线），不画假窗口 chrome
const defaultFence = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const lang = (token.info || "").trim().split(/\s+/)[0];
  const rendered = defaultFence(tokens, idx, options, env, self);
  return `<figure class="code" data-lang="${md.utils.escapeHtml(lang)}">${rendered}</figure>`;
};

export interface TocItem {
  id: string;
  text: string;
  level: number;
}

/** 提取 h2/h3 生成目录（与 anchor 生成的 id 对齐） */
export function extractToc(src: string): TocItem[] {
  const out: TocItem[] = [];
  const lines = expandWikilinks(src).split("\n");
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (m) {
      const text = m[2].replace(/[*`_]/g, "").trim();
      out.push({ id: slugifyZh(text), text, level: m[1].length });
    }
  }
  return out;
}

/** 提取正文中引用的 wikilink slug 列表（保存 post_links 用） */
export function extractWikilinks(src: string): string[] {
  const set = new Set<string>();
  for (const m of src.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) set.add(m[1].trim());
  return [...set];
}

/** 阅读时长：中文 ~400 字/分钟 + 代码块行数折算 */
export function readingTime(src: string): number {
  const codeLines = [...src.matchAll(/```[\s\S]*?```/g)].reduce((n, m) => n + m[0].split("\n").length, 0);
  const plain = src
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#*`>\-\[\]()!|]/g, "");
  const cjk = (plain.match(/[\p{Script=Han}]/gu) ?? []).length;
  const words = (plain.replace(/[\p{Script=Han}]/gu, " ").match(/[A-Za-z0-9]+/g) ?? []).length;
  return Math.max(1, Math.round(cjk / 400 + words / 200 + codeLines / 80));
}

export function renderMarkdown(src: string): string {
  return md.render(src);
}

export default md;
