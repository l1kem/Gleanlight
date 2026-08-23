import type { APIRoute } from "astro";
import { getData } from "../lib/data";

export const GET: APIRoute = async () => {
  const { posts } = await getData();
  const index = posts.map((post) => ({
    slug: post.slug,
    title: post.title,
    summary: post.summary,
    tags: post.tags,
    topic: post.topicName,
    date: post.publishedAt?.slice(0, 10) ?? "",
  }));
  return new Response(JSON.stringify(index), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
};
