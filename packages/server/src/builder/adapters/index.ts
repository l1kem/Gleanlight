import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DIST } from "../../config.js";

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

function clearDirectory(target: string): void {
  for (const entry of fs.readdirSync(target)) {
    fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  }
}
