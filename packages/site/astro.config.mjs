import { defineConfig } from "astro/config";

export default defineConfig({
  // 正式上线时改为公网域名（影响 RSS/sitemap 绝对地址）
  site: process.env.BLOG_SITE_URL ?? "http://localhost:4321",
  build: { inlineStylesheets: "auto" },
  vite: {
    // 纯静态站：禁用所有客户端路由/服务端 API
  },
});
