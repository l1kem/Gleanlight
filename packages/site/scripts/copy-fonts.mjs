/**
 * 文楷字体自托管：从 node_modules 拷贝分片 webfont 到 public/fonts/wenkai。
 * 好处：不依赖 jsdelivr CDN（国内时好时坏），构建产物自带、离线可用。
 * 产物目录 public/fonts 已 gitignore，仓库保持精瘦。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve("lxgw-wenkai-webfont/package.json"));
const dest = path.join(process.cwd(), "public", "fonts", "wenkai");

if (!existsSync(path.join(pkgDir, "style.css"))) {
  console.warn("[fonts] lxgw-wenkai-webfont 未安装，跳过自托管（回退 CDN/系统字体）");
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(path.join(pkgDir, "style.css"), path.join(dest, "style.css"));
cpSync(path.join(pkgDir, "files"), path.join(dest, "files"), { recursive: true });
console.log("[fonts] 文楷 webfont 已就位 → public/fonts/wenkai");
