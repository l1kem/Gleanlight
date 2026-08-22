# Design — 拾光集 · 手帐风（前台）

> 设计系统（单一事实来源）。改前台样式前先读本文件；系统要长，先改这里。
> 只作用于 `packages/site`（阅读端）。后台 Admin 继续使用 `packages/tokens` 的 Newsprint 主题，互不影响。
> 每次改前台样式前先读本文件；系统要长，先改这里。

## 皮肤（2026-08-22 定稿）

**只保留手帐一套风格。** 多皮肤系统（plain/ink/celadon）上线一天后按用户要求整体移除——风格差异若只是 token 覆盖等于换色，结构性重排又维护两套布局，不值。深浅色（data-theme）保留。

## 权限与附件（2026-08-22）

- **私密文章**：`posts.private=1` → 永不导出（exporter 过滤），仅存在于后台书房/图谱/搜索；编辑页 🔒 开关。
- **附件相对路径**：md 源文统一写 `uploads/<stored>`（迁移友好）；渲染时补 `/`（markdown 包 `uploads_prefix` 规则）；server 以 `/uploads/` 别名提供（`/media/` 兼容旧引用）；site 构建导出 `public/uploads/`。**数据迁移 = 拷贝 `packages/server/data/` 一个目录**（SQLite + media 全在里面）。
- **媒体类型**：图片 + pdf/doc(x)/xls(x)/ppt(x)/zip/txt/csv 等（octet-stream 走扩展名白名单）；媒体库点击查看：图片/PDF/文本原生，docx=mammoth、xlsx=SheetJS 前端解析，其余下载。
- **Wiki 导入**（功能保留，按需手动使用）：`POST /wiki/scan|import`——只读扫描 Obsidian 目录（顶级目录→域去编号前缀、二级→主题、frontmatter title、`[[双链]]` slug=文件名保持互链、引用附件复制入库并改写为 uploads/ 路径）；导入内容一律「草稿+私密」。幂等：按 slug 跳过。源目录零写入。

## 交互约定（2026-08-22）

- **搜索**：全站弹层（SearchDialog.astro）——导航「搜索」或 `/` 键唤起，页面中上弹出、即敲即搜、↵ 开第一条、esc 关闭；独立 /search 页已移除。
- **知识图谱**：滚轮以光标为锚缩放（0.3–4×）、空白拖拽平移、节点可拖动（松手后邻居松弛）、单击节点进编辑；布局收敛后存 localStorage（新增节点才重新模拟，不再每次晃荡）；自动适配视口。

## Genre

playful（手帐 / tactile-soft）：温暖、手作、个人化，但排版依然克制——不是 childish。

## Theme（studied-DNA · 手帐）

色彩全部 OKLCH，定义在 `packages/site/src/styles/global.css`（覆盖同名 token）：

| Token | 浅色（纸本手帐） | 深色（夜帐） | 用途 |
|---|---|---|---|
| `--color-paper` | `oklch(96.5% 0.016 90)` | `oklch(18% 0.012 70)` | 米黄纸底（点阵纸纹） |
| `--color-paper-2` | `oklch(98.5% 0.012 95)` | `oklch(22% 0.014 72)` | 纸片卡片面 |
| `--color-paper-3` | `oklch(93.5% 0.02 88)` | `oklch(26% 0.016 72)` | hover / 选中 |
| `--color-rule` | `oklch(86% 0.015 85)` | `oklch(32% 0.015 70)` | 细分隔 |
| `--color-rule-strong` | `oklch(72% 0.025 70)` | `oklch(46% 0.02 65)` | 手绘墨线 / 虚线框 |
| `--color-ink` | `oklch(29% 0.024 55)` | `oklch(90% 0.012 88)` | 深棕墨正文 |
| `--color-ink-strong` | `oklch(23% 0.028 52)` | `oklch(95% 0.01 90)` | 标题重墨 |
| `--color-accent` | `oklch(57% 0.135 33)` | `oklch(70% 0.12 35)` | 砖红：链接/角标/焦点 |
| `--color-sticky` | `oklch(94% 0.06 95)` | `oklch(30% 0.05 95)` | 便利贴（引用/目录） |
| `--tape-red/green/blue/lilac/honey` | 低饱和半透明色带 | 深色变体 | 和纸胶带（≤5% 视口面积） |

规则：accent 是高亮笔不是色块；胶带合计不超过视口 5%；无纯黑纯白；虚线用 `--color-rule-strong`。

## Typography（2+1）

- **Display + Body**：`"LXGW WenKai"（霞鹜文楷）`，CDN `cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1`，回退系统楷体（Kaiti SC / STKaiti / KaiTi）→ 即使 CDN 失效仍是手写感。标题 700，正文 400。
- **Outlier（仅代码块）**：`JetBrains Mono`（Google Fonts）。
- 正文 `--text-md`(1.125rem)，行高 1.9（楷体需要更宽行距）；标题不加字距。
- **禁止**：第三个字族；标题斜体。

## 手帐语汇（装饰工具类，global.css）

- `.tape--{red|green|blue|lilac|honey}` + `.tape--{tc|tl|tr}`：和纸胶带，`aria-hidden` 装饰，放卡片顶边，微旋转。
- `.paper-card`：纸片卡片（paper-2 面 + 1px rule 边 + 单层软阴影 + 12px 圆角），`.tilt-l/.tilt-r` 交替 ±0.5–0.9° 微倾；hover 摆正 + 1px 上浮（transform-only）。
- `.badge-num`：砖红编号角标（01/02/03…），微旋转，白字——仅用于真正有序的位置（首页横带、主题阅读路径、归档年份），首页 ≤3 个，纵向叠放在标题上方。
- `.squiggle`：标题手绘波浪线（`text-decoration: underline wavy var(--color-accent)`）。
- `.stamp`：邮戳（虚线边框 + 旋转 + 砖红 85% 透明度）。
- `.taglink`：贴纸药丸（paper-2 底 + rule 边 + 999px 圆角）。
- 纸纹：body 点阵 `radial-gradient` 22px 网格，透明度 ≤14%。
- 涂鸦：footer 手绘猫 SVG（stroke=currentColor，Tier B 手作）。
- **禁止**：emoji 当图标；重画浏览器窗口；第三层卡片嵌套。

## Motion（动效系统 · 2026-08-21 大改版扩充）

全部 transform/opacity（进度条为 scaleX），时长只用 `--dur-*`，缓动只用三命名；焦点环即时出现不动画；`prefers-reduced-motion` 全量降级（tokens.css 全局封顶 150ms + 位移归零）。七个命名原语：

1. **滚动显现**：`.reveal`（上浮淡入）/ `.reveal-fade`（仅淡入，供吸顶/树）/ `.reveal-stagger`（容器进场后子项按 `--i` 依次落纸，keyframes 只写 from，结束后释放 transform 不锁微倾）——IntersectionObserver 加 `.is-in`，无 JS 直接可见；钩子挂 `astro:page-load` 兼容软导航。
2. **视图过渡**：Astro ClientRouter，`::view-transition-old/new` 自定义（旧页上收 / 新页落纸）。
3. **卡片 hover**：摆正上浮 + 阴影加深；**胶带摆动** `.tape--{tc|tl|tr}` 各自 keyframes（700ms 单次）。
4. **邮戳盖印** `stamp-in`：`.badge-num`/`.stamp`/路径圆章随所在段落进场后缩放盖章（`--stamp-rot`/`--stamp-opacity` 变量化适配各自基态）。
5. **行缩进**：`.rowlist__title` hover 右移 4px。
6. **进度条**：`.progress` scroll-driven CSS（`@supports` 守卫，零 JS）。
7. **文件树展开** `tree-in`：`<details>` 打开时子项依次落纸 + 折纸箭头旋转。

## 布局

- **导航**：吸顶纸条（N9 边缘对齐）——左书商标 + 小注，右上角贴纸页签（active 砖红）+ 主题切换；滚动加投影（`.is-scrolled`）。移动端小注隐藏、页签换行。
- **知识库**：`KbTree.astro` 左文件树（17rem 吸顶、纸片卡化）+ 右内容双栏；树 = 域 → 主题 → 文章 三层原生 `<details>`，当前域/主题服务端预展开高亮（`.is-here` 砖红 + 朱砂晕染）；移动端树置顶限高 40vh 自滚。
- 沿用 Ecosystem Index 信息架构与全部路由；间距/层级/缓动继续消费 `@blog/tokens`。
- 首页横带头：角标纵排在标题上方（禁止左右分栏眉标）。
- 纸片卡片可微倾，整段 section 不倾；`html/body` 已 `overflow-x: clip` 防横向滚动。

## 页面分工

| 页面 | 手帐化要点 |
|---|---|
| Masthead | 吸顶纸条：左胶带字标 + 小注；导航 = 右上角贴纸页签（active 砖红）+ 主题切换 |
| 首页 | 简介纸片卡 + 胶带；精选 = 纸片卡不对称栅格；知识库 = 书架贴纸卡；最新 = 虚线行列表；各横带子项 `reveal-stagger` 错峰落纸 |
| 文章页 | 有主题的文章：左侧文件树常驻（当前文章高亮），正文右移优先展示；无主题文章保持单栏。标题 + 胶带；目录 = 便利贴；引用 = 便利贴；上下篇 = 纸片卡 |
| 知识库 | 左 `KbTree` 文件树（域→主题→文章 三层 `<details>`，预展开高亮当前位）；右 = 书架总览 / 主题册阅读路径（圆章随编排盖印） |
| 归档 | 年份 = 角标圆章 + 邮戳点缀 |
| 标签/搜索/关于 | 贴纸药丸、虚线下划线输入框、信纸卡 + 邮戳 |

## 后台（不在本系统内，但编辑器已融合）

`packages/admin` 维持 Newsprint（共享 `packages/tokens/tokens.css`）。前台对手帐 token 的覆盖全部收敛在 `packages/site` 内，不改共享包。

**vditor 融合层**（`packages/admin/src/styles/vditor-theme.css`，`main.ts` 中置于 vditor 自带 CSS 之后）：vditor 全部 CSS 变量（边框/工具栏/编辑区/预览/计数/IR 标记/callout）改接设计 token；预览排版与前台 prose 同规则（Newsprint 字族）；`hljs` 配色沿用前台映射；编辑器嵌入 `Editor.vue` 的 `.editor-wrap` 时去掉自身边框只留上边线，聚焦 = 外框整圈转朱红。深浅色随 `[data-theme]` 自动翻转，不依赖 vditor dark 类。

## Exports

前台 token 覆盖层即 `packages/site/src/styles/global.css` 顶部 `:root` / `[data-theme="dark"]` 块；装饰工具类同文件。颜色/字体一律 `var(--token)` 引用，禁止内联色值。
