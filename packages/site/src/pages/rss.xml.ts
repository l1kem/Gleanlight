import type { APIRoute } from "astro";
import { getData } from "../lib/data";

export const GET: APIRoute = async ({ site }) => {
  const { posts, site: info } = await getData();
  const base = site?.toString().replace(/\/$/, "") ?? "";
  const items = [...posts]
    .sort((a, b) => (a.publishedAt > b.publishedAt ? -1 : 1))
    .map((p) => {
      const url = `${base}/posts/${p.slug}`;
      return `    <item>
      <title><![CDATA[${p.title}]]></title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${new Date(`${p.publishedAt.replace(" ", "T")}Z`).toUTCString()}</pubDate>
      <description><![CDATA[${p.summary}]]></description>
      ${p.tags.map((t) => `<category><![CDATA[${t}]]></category>`).join("\n      ")}
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${info.title}</title>
    <link>${base}</link>
    <description>${info.description}</description>
    <language>zh-CN</language>
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
};
