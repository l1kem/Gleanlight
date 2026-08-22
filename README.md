# Gleanlight · 拾光集

> 拾一点光，集成一册 —— 个人知识库 + 博客一体站。

**Gleanlight**（拾光集）是一个自托管的知识管理 + 博客发布系统：在后台像 Obsidian 一样组织与互链笔记，一键发布成纯静态站点。写作数据属于你自己——一个目录就是全部。

```text
┌─────────────────────────────────────────────┐
│  书房（后台）                                 
│  Markdown 编辑 · [[双链]] · 知识图谱 · 媒体库  
│  Vue3 + Fastify + SQLite                    
└──────────────────┬──────────────────────────┘
                   │ 发布（导出 → Astro 构建 → 同步）
                   ▼
┌─────────────────────────────────────────────┐
│  橱窗（前台）                                 
│  纯静态 HTML/CSS/JS                          
│  任意静态托管：Nginx / CDN / 对象存储          
└─────────────────────────────────────────────┘
```

## 特性

**知识库**
- 三层结构：知识域 → 主题 → 文章，阅读路径有序装订
- `[[双向链接]]` + 自动反向引用 + 关系图谱（可缩放 / 平移 / 拖拽，布局记忆）
- 从本地 Obsidian 库一键导入（只读源目录，附件与双链一并迁入）
- 健康检查：断链、孤立文章、空主题一目了然

**写作**
- 类 Typora 编辑器（Vditor）：分屏预览 / 即时渲染双模式
- 粘贴图片自动上传，正文写入相对路径 `uploads/…`（数据迁移友好）
- 版本历史（自动快照 / 一键回滚）、编辑器内大纲、离开保护
- 定时发布、私密文章（不进入发布产物）
- AI 辅助：摘要 / 候选标题 / 标签 / 润色 / 续写（OpenAI 兼容协议，模型可配置）
- 全局命令面板 `⌘K / Ctrl+K`

**发布**
- 一键流水线：预检 → 导出 → Astro 静态构建 → 部署适配器（local / 可扩展）
- 前台手帐风格，深浅色切换，滚动显现等克制动效，全端响应式
- 写作统计：本月字数、连续写作天数、构建历史

**附件与文件**
- 图片 / PDF / Word(docx) / Excel(xlsx) / PPT / zip 等
- 后台在线预览：图片、PDF、文本原生；docx / xlsx 浏览器端解析

## 快速开始

要求：Node.js ≥ 20，pnpm ≥ 9

```bash
git clone git@github.com:l1kem/Gleanlight.git
cd Gleanlight
pnpm install

# 初始化账号（创建 admin + 随机密码，打印一次）+ 示例内容
pnpm seed

# 启动后台（http://127.0.0.1:7300）
pnpm start
```

登录后台 → 写文章 → 「发布」→ 静态站点输出到 `public-dist/`，交给任意静态服务器即可。

自定义账号：

```bash
pnpm seed -- --username admin --password your-password
```

### 开发模式

```bash
pnpm dev:server   # Fastify    → http://127.0.0.1:7300
pnpm dev:admin    # Vite HMR   → http://localhost:5173（代理 API）
pnpm dev:site     # Astro      → http://localhost:4321
```

### Docker 部署

```bash
docker compose up -d --build
```

- 前台：`http://<host>:4321`（发布后的静态站，容器内由独立端口托管，发布后刷新即更新）
- 后台：`http://<host>:7300`
- 数据（SQLite + 附件）：挂载在 `./docker-data`，**备份 = 拷贝这个目录**
- 发布产物：挂载在 `./public-dist`；自带的前台端口够日常使用，流量大时也可改用 Nginx / Caddy 直接托管该目录
- 对外部署时只放行前台端口，后台端口用防火墙留在内网
- 首次启动自动初始化；可用环境变量预设账号（见 `docker-compose.yml`）：

```yaml
environment:
  - ADMIN_USER=admin
  - ADMIN_PASSWORD=change-me    # 留空则生成随机密码（docker logs 查看）
```

用 Nginx 托管发布产物的参考配置：

```nginx
server {
    listen 80;
    root /var/www/gleanlight;   # 指向 public-dist 卷
    location / { try_files $uri $uri/ $uri.html =404; }
}
```

## 数据与迁移

所有运行数据收敛在一个目录（默认 `packages/server/data/`，Docker 中为挂载卷）：

```text
data/
├── blog.db        # SQLite：账号、文章、知识结构、版本、构建历史
├── media/         # 上传的附件（正文以 uploads/ 相对路径引用）
└── .jwt-secret    # 会话密钥
```

迁移 / 备份：停服 → 拷贝该目录 → 新环境起服。正文中的附件引用是相对路径，随目录整体迁移不断链。

## 目录结构

```text
packages/
├── site/       # 前台（Astro 5，纯静态输出）
├── admin/      # 后台（Vue 3 + Vite + Vditor）
├── server/     # 服务端（Fastify 5 + better-sqlite3，含构建器与部署适配器）
├── markdown/   # Markdown 渲染器（前台构建与后台预览共用，[[双链]]规则单一来源）
└── tokens/     # 设计 token（前后台共享的色彩/字号/间距/动效变量）
design.md       # 设计系统说明
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `BLOG_HOST` | `127.0.0.1` | 监听地址（Docker / 局域网设为 `0.0.0.0`） |
| `BLOG_PORT` | `7300` | 后台端口 |
| `BLOG_DATA_DIR` | `packages/server/data` | 数据目录（SQLite + 附件） |
| `BLOG_SITE_URL` | `http://localhost:4321` | 站点绝对地址（RSS / sitemap 用） |

## 路线图

- [ ] 全文检索（Pagefind）
- [ ] KaTeX / Mermaid 渲染
- [ ] WebP 自动压缩、TOTP 两步验证

## 贡献

欢迎 Issue 与 PR。主线开发在 `main` 分支。

## 许可

[MIT](./LICENSE) © Gleanlight Contributors
