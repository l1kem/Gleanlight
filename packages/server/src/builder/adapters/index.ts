import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { PUBLIC_DIST } from "../../config.js";
import { getSetting } from "../../db.js";
import type { PublishSettings } from "../../routes/settings.js";

/**
 * 部署适配器：把 site/dist 发布到静态托管目录。
 * local：同步到 public-dist/（可用卷挂载，交给 Nginx/CDN 托管）。
 * 后续按同一接口扩展 rsync（VPS）与 cloudflare（Pages API）。
 */

export interface DeployAdapter {
  readonly name: string;
  deploy(siteDist: string, onLog: (line: string) => void): Promise<string>; // 返回目标描述
}

export const localAdapter: DeployAdapter = {
  name: "local",
  async deploy(siteDist, onLog) {
    const target = PUBLIC_DIST;
    const parent = path.dirname(target);
    const base = path.basename(target);
    fs.mkdirSync(parent, { recursive: true });
    const stage = fs.mkdtempSync(path.join(parent, `.${base}-next-`));
    const previous = path.join(parent, `.${base}-previous`);
    fs.cpSync(siteDist, stage, { recursive: true });

    try {
      fs.rmSync(previous, { recursive: true, force: true });
      if (fs.existsSync(target)) fs.renameSync(target, previous);
      fs.renameSync(stage, target);
      fs.rmSync(previous, { recursive: true, force: true });
    } catch (error) {
      // Docker bind mount 的根目录不能 rename：保留一份副本，复制失败时可恢复。
      fs.mkdirSync(target, { recursive: true });
      if (!fs.existsSync(previous)) fs.cpSync(target, previous, { recursive: true });
      try {
        clearDirectory(target);
        fs.cpSync(stage, target, { recursive: true });
        fs.rmSync(previous, { recursive: true, force: true });
        fs.rmSync(stage, { recursive: true, force: true });
      } catch (copyError) {
        clearDirectory(target);
        if (fs.existsSync(previous)) fs.cpSync(previous, target, { recursive: true });
        throw copyError;
      }
      if (!(error instanceof Error) || !["EBUSY", "EXDEV", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        onLog(`目录原子切换不可用，已采用带回滚的复制：${String(error)}`);
      }
    }
    onLog(`已同步 ${siteDist} → ${target}`);
    return target;
  },
};

export const adapters: Record<string, DeployAdapter> = {
  local: localAdapter,
};

/** 外部命令执行器：日志流式回传，非零退出抛错 */
function runCommand(cmd: string, args: string[], onLog: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: true, env: process.env });
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      for (const line of d.toString().split("\n")) if (line.trim()) onLog(line);
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      for (const line of d.toString().split("\n")) if (line.trim()) onLog(line);
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} 退出码 ${code}\n${stderr.slice(-800)}`))
    );
  });
}

/** rsync：同步到远端目录（user@host:/path），需宿主机可 SSH 免密登录目标 */
export const rsyncAdapter: DeployAdapter = {
  name: "rsync",
  async deploy(siteDist, onLog) {
    const { rsyncTarget } = getSetting<PublishSettings>("publish", {
      adapter: "local",
      localDir: "",
      rsyncTarget: "",
      cfProject: "",
    });
    if (!rsyncTarget) throw new Error("未配置 rsync 目标（设置 → 发布 → 目标地址）");
    onLog(`rsync → ${rsyncTarget}`);
    await runCommand("rsync", ["-az", "--delete", `${siteDist}/`, rsyncTarget], onLog);
    onLog(`已同步到 ${rsyncTarget}`);
    return rsyncTarget;
  },
};

/** Cloudflare Pages：npx wrangler pages deploy，需 CLOUDFLARE_API_TOKEN 环境变量 */
export const cloudflareAdapter: DeployAdapter = {
  name: "cloudflare",
  async deploy(siteDist, onLog) {
    const { cfProject } = getSetting<PublishSettings>("publish", {
      adapter: "local",
      localDir: "",
      rsyncTarget: "",
      cfProject: "",
    });
    if (!cfProject) throw new Error("未配置 Cloudflare Pages 项目名（设置 → 发布）");
    if (!process.env.CLOUDFLARE_API_TOKEN) {
      throw new Error("缺少 CLOUDFLARE_API_TOKEN 环境变量（docker-compose.yml 里配置）");
    }
    onLog(`wrangler pages deploy → ${cfProject}`);
    await runCommand(
      "npx",
      ["-y", "wrangler@latest", "pages", "deploy", siteDist, "--project-name", cfProject],
      onLog
    );
    onLog(`已部署到 Cloudflare Pages：${cfProject}`);
    return `cloudflare-pages:${cfProject}`;
  },
};

function clearDirectory(target: string): void {
  for (const entry of fs.readdirSync(target)) {
    fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  }
}

// 适配器注册表：放在定义之后，便于按同一 DeployAdapter 接口扩展
adapters.rsync = rsyncAdapter;
adapters.cloudflare = cloudflareAdapter;
