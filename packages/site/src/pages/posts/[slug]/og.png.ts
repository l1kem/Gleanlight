import type { APIRoute } from "astro";
import { getData } from "../../../lib/data";
import { renderOg } from "../../../lib/og";

export async function getStaticPaths() {
  const { posts } = await getData();
  return posts.map((post) => ({ params: { slug: post.slug }, props: { post } }));
}

export const GET: APIRoute = async ({ props }) => {
  const { site } = await getData();
  const png = await renderOg({
    title: props.post.title,
    siteName: site.title,
    author: site.author,
  });
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png" },
  });
};
