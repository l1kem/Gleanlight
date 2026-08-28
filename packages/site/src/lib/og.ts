/**
 * OG 分享图：1200×630 纸面卡片（米纸底 + 砖红印章条 + 标题 + 站名）。
 * sharp 内置 librsvg 渲染文本；Docker 内需 fonts-noto-cjk 才有中文字形
 * （Dockerfile 已装，装不上时优雅降级为方框，不影响构建）。
 */
import sharp from "sharp";

const W = 1200;
const H = 630;
const FONT = "Noto Sans CJK SC, PingFang SC, Hiragino Sans GB, Microsoft YaHei, sans-serif";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 中文标题折行：每行 n 字，最多 maxLines 行，超出加省略号 */
function wrap(text: string, perLine: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let rest = clean;
  while (rest.length > 0 && lines.length < maxLines) {
    if (rest.length <= perLine) {
      lines.push(rest);
      rest = "";
      break;
    }
    lines.push(rest.slice(0, perLine));
    rest = rest.slice(perLine);
  }
  if (rest.length > 0) lines[lines.length - 1] = lines[lines.length - 1].slice(0, perLine - 1) + "…";
  return lines;
}

export async function renderOg(opts: {
  title: string;
  siteName: string;
  author?: string;
}): Promise<Buffer> {
  const lines = wrap(opts.title, 15, 3);
  const fontSize = lines.length >= 3 ? 60 : 72;
  const lineHeight = Math.round(fontSize * 1.34);
  const tspans = lines
    .map((l, i) => `<tspan x="96" y="${300 + i * lineHeight}">${esc(l)}</tspan>`)
    .join("");
  const byline = [opts.author, opts.siteName].filter(Boolean).join(" · ");
  const footline = opts.siteName;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#f5efe2"/>
  <rect x="0" y="0" width="14" height="${H}" fill="#a4432f"/>
  <rect x="96" y="120" width="120" height="8" fill="#a4432f" rx="4"/>
  <text font-family="${FONT}" font-size="30" fill="#77766b" x="96" y="86">${esc(byline)}</text>
  <text font-family="${FONT}" font-weight="700" font-size="${fontSize}" fill="#33291d">${tspans}</text>
  <text font-family="${FONT}" font-size="26" fill="#9a938a" x="96" y="${H - 70}">${esc(footline)}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png({ quality: 90 }).toBuffer();
}
