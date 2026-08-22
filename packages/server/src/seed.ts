/**
 * 首次初始化：创建账号 + 示例知识库内容。
 * 用法：pnpm seed [--username <name>] [--password <pwd>]
 * 不传参数则创建 admin + 随机密码（打印一次，请立即登录修改）。
 */
import crypto from "node:crypto";
import { db, getSetting, setSetting } from "./db.js";
import { hashPassword } from "./auth.js";
import { extractWikilinks, readingTime } from "@gleanlight/markdown";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function insertPost(p: {
  slug: string;
  title: string;
  summary: string;
  content: string;
  topicId: number | null;
  sort: number;
  tags: string[];
  featured?: boolean;
  published: boolean;
}): void {
  const exists = db.prepare("SELECT id FROM posts WHERE slug = ?").get(p.slug);
  if (exists) return;
  const info = db
    .prepare(
      `INSERT INTO posts(slug, title, summary, content_md, status, featured, topic_id, sort_in_topic, tags, reading_time, published_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      p.slug,
      p.title,
      p.summary,
      p.content,
      p.published ? "published" : "draft",
      p.featured ? 1 : 0,
      p.topicId,
      p.sort,
      JSON.stringify(p.tags),
      readingTime(p.content),
      p.published ? new Date().toISOString().replace("T", " ").slice(0, 19) : null
    );
  const id = Number(info.lastInsertRowid);
  for (const slug of extractWikilinks(p.content)) {
    db.prepare("INSERT OR IGNORE INTO post_links(source_id, target_slug) VALUES(?,?)").run(id, slug);
  }
}

async function main(): Promise<void> {
  const userCount = (db.prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number }).c;
  if (userCount === 0) {
    const username = arg("username") ?? "admin";
    const password = arg("password") ?? crypto.randomBytes(6).toString("base64url");
    db.prepare("INSERT INTO users(username, password_hash) VALUES(?,?)").run(
      username,
      await hashPassword(password)
    );
    console.log(`✓ 账号已创建：${username} / ${password}`);
    if (!arg("password")) console.log("  （随机密码仅显示这一次，请登录后尽快修改）");
  } else {
    console.log("· 账号已存在，跳过");
  }

  if (!getSetting("site", null)) {
    setSetting("site", {
      title: "拾光集",
      description: "一个人的知识库与写作间",
      author: "",
      avatar: "",
      mastheadIntro: "写代码，也写笔记；慢慢建一座自己的图书馆。",
      footerNote: "认真书写，慢慢生长。",
      social: [],
    });
    console.log("✓ 站点设置已初始化");
  }

  // ── 示例知识结构 ─────────────────────────────────────────────
  if ((db.prepare("SELECT COUNT(*) AS c FROM domains").get() as { c: number }).c === 0) {
    db.prepare(
      "INSERT INTO domains(slug, name, description, sort) VALUES(?,?,?,?)"
    ).run("engineering", "工程", "代码、架构与工具的实践笔记", 1);
    db.prepare(
      "INSERT INTO domains(slug, name, description, sort) VALUES(?,?,?,?)"
    ).run("reading", "阅读", "读书笔记与随想", 2);

    db.prepare("INSERT INTO topics(domain_id, slug, name, description, sort) VALUES(?,?,?,?,?)").run(
      1, "web-fundamentals", "Web 基础", "从 HTTP 到渲染，把地基打牢", 1
    );
    db.prepare("INSERT INTO topics(domain_id, slug, name, description, sort) VALUES(?,?,?,?,?)").run(
      1, "devops", "部署与运维", "让服务安静地跑起来", 2
    );
    db.prepare("INSERT INTO topics(domain_id, slug, name, description, sort) VALUES(?,?,?,?,?)").run(
      2, "essays", "随笔回信", "写给未来自己的长信", 1
    );
    console.log("✓ 示例知识域/主题已创建");
  }

  if ((db.prepare("SELECT COUNT(*) AS c FROM posts").get() as { c: number }).c === 0) {
    insertPost({
      slug: "hello-shiguangji",
      title: "你好，拾光集",
      summary: "这个博客如何工作：书房书写、静态发布、知识成林。",
      topicId: null,
      sort: 0,
      tags: ["随笔", "建站"],
      featured: true,
      published: true,
      content: `## 为什么自己搭博客

写博客这件事，最难的不是写，而是**让自己的笔记长成体系**。零散的文章像散落的珠子，知识库把它们串成线。

## 这座博客如何运作

它分成两半：

- **前台**：你正在看的部分，是一堆纯静态文件。没有数据库、没有登录框、没有动态服务——攻击者无门可入。
- **后台**：跑在自己的服务器上。在那里写作、整理知识树，点一下「发布」，内容被构建成静态页，再同步到托管目录。

就像一间**书房**连着一扇**橱窗**：书桌怎么乱都无所谓，橱窗永远干净。

## 知识库的用法

文章之间可以用双方括号互相引用，比如 [[css-cascade|层叠上下文]] 这篇（可能还没写）。被引用多的文章，就是这个知识网络里的枢纽站。

> 接下来会陆续把旧笔记搬进来，按主题排好阅读顺序。
`,
    });
    insertPost({
      slug: "css-cascade",
      title: "层叠上下文：谁压过谁",
      summary: "z-index 失效的真正原因：层叠上下文的创建规则与比较链。",
      topicId: 1,
      sort: 1,
      tags: ["CSS", "Web 基础"],
      featured: true,
      published: true,
      content: `## 从 z-index 失效说起

\`\`\`css
.modal { z-index: 10; }
.header { z-index: 100; }
\`\`\`

明明 modal 的层级小，却盖住了 header？因为两者不在同一个层叠上下文里。

## 什么会创建层叠上下文

- 根元素 \`html\`
- \`position\` 非 static 且 z-index 非 auto
- \`opacity\` 小于 1
- \`transform\`、\`filter\` 非 none
- flex/grid 子元素设置 z-index

## 比较规则

同上下文内比 z-index；跨上下文时，**整个上下文作为一个整体**参与父级比较。

写组件时最稳妥的做法：把可能弹出的层挂到 body 下，或保证触发链路上没有偷偷创建上下文的属性。
`,
    });
    insertPost({
      slug: "static-site-security",
      title: "纯静态发布的安全账本",
      summary: "动态服务自己收好，静态文件对外托管，攻击面如何归零。",
      topicId: 2,
      sort: 1,
      tags: ["部署", "安全"],
      published: true,
      content: `## 攻击面清单

一个带评论、带搜索、带登录的动态博客，对外暴露的是：

1. Web 应用本身的漏洞（注入、越权）
2. 数据库端口扫描
3. 弱密码与撞库
4. 依赖供应链

## 静态化之后

对外只剩 HTML/CSS/JS 由 Nginx 或 CDN 吐出——**上述四条全部消失**。剩下的风险只有静态文件被篡改，而源数据在后台，随时可以重新构建覆盖。

这是一笔很划算的安全账：写作体验不损失（后台 + 类 Typora 编辑器），前台风险降到地板。参见 [[hello-shiguangji|这座博客的运作方式]]。
`,
    });
    insertPost({
      slug: "reading-notes-draft",
      title: "读书笔记：尚未整理的草稿",
      summary: "（草稿示例）展示后台的草稿状态——不会被发布到前台。",
      topicId: 3,
      sort: 1,
      tags: ["读书"],
      published: false,
      content: `## 待整理

- 要点一
- 要点二

> 这是一篇草稿，构建发布时不会出现在前台。
`,
    });
    console.log("✓ 示例文章已创建（3 篇已发布 + 1 篇草稿）");
  }

  // 顺手导出一次内容，让前台 dev/build 立即有数据
  const { exportContent } = await import("./builder/exporter.js");
  const { postCount } = exportContent();
  console.log(`✓ 已导出 ${postCount} 篇文章到 site/content/data/`);

  console.log("\n种子完成。启动：pnpm dev:server → http://127.0.0.1:7300");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
