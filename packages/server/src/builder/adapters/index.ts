import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DIST } from "../../config.js";

/**
 * 部署适配器：把 site/dist 发布到「公网托管」。
 * 本地开发用 local（拷贝到 public-dist/，用任意静态服务器预览）。
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
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(siteDist, target, { recursive: true });
    onLog(`已同步 ${siteDist} → ${target}`);
    return target;
  },
};

export const adapters: Record<string, DeployAdapter> = {
  local: localAdapter,
};
