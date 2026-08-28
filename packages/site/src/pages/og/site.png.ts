import type { APIRoute } from "astro";
import { getData } from "../../lib/data";
import { renderOg } from "../../lib/og";

export const GET: APIRoute = async () => {
  const { site } = await getData();
  const png = await renderOg({
    title: site.description || "一个人的知识库与写作间",
    siteName: site.title,
    author: site.author,
  });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
};
