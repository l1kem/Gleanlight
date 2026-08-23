import type { APIRoute } from "astro";
import { getData } from "../lib/data";

export const GET: APIRoute = async ({ site }) => {
  const { posts, topics, tags } = await getData();
  const base = site ?? new URL("http://localhost:4321");
  const urls = [
    { path: "/", lastmod: posts[0]?.updatedAt },
    { path: "/posts", lastmod: posts[0]?.updatedAt },
    { path: "/kb", lastmod: posts[0]?.updatedAt },
    { path: "/archives", lastmod: posts[0]?.updatedAt },
    { path: "/about" },
    ...posts.map((post) => ({ path: `/posts/${encodeURIComponent(post.slug)}`, lastmod: post.updatedAt })),
    ...topics.map((topic) => ({ path: `/kb/${encodeURIComponent(topic.slug)}` })),
    ...tags.map((tag) => ({ path: `/tags/${encodeURIComponent(tag.name)}` })),
  ];
  const body = urls
    .map(({ path, lastmod }) => {
      const loc = escapeXml(new URL(path, base).toString());
      const modified = lastmod ? `\n    <lastmod>${escapeXml(toIso(lastmod))}</lastmod>` : "";
      return `  <url>\n    <loc>${loc}</loc>${modified}\n  </url>`;
    })
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};

function toIso(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString();
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    '\"': "&quot;",
  })[char] ?? char);
}
