import { spawn } from "node:child_process";
import path from "node:path";
import { PKG_SITE } from "../config.js";

/** 在 site 包内执行 astro build，日志流式回传 */
export function runSiteBuild(onLog: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", ["run", "build"], {
      cwd: PKG_SITE,
      shell: true, // Windows 兼容 + 继承 PATH 中的 pnpm
      env: { ...process.env, FORCE_COLOR: "0" },
    });
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) if (line.trim()) onLog(line);
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      for (const line of s.split("\n")) if (line.trim()) onLog(line);
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`astro build 退出码 ${code}（目录 ${path.basename(PKG_SITE)}）\n${stderr.slice(-2000)}`));
    });
  });
}
