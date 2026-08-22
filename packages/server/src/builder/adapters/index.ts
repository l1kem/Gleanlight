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
    // 只清空内容、保留目录本身（目录可能是 Docker 挂载点，不可删除）
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(target)) {
      fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    }
    fs.cpSync(siteDist, target, { recursive: true });
    onLog(`已同步 ${siteDist} → ${target}`);
    return target;
  },
};

export const adapters: Record<string, DeployAdapter> = {
  local: localAdapter,
};
