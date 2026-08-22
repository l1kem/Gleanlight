/**
 * 前台数据层：消费 server 导出的 content/data/*.json。
 * 未发布（未导出）时优雅降级为空数据，保证 astro dev/build 不崩。
 */

export interface Post {
  id: number;
  slug: string;
  title: string;
  summary: string;
  contentMd: string;
  featured: boolean;
  topicId: number | null;
  topicSlug: string | null;
  topicName: string | null;
  domainSlug: string | null;
  domainName: string | null;
  sortInTopic: number;
  tags: string[];
  cover: string | null;
  readingTime: number;
  publishedAt: string;
  updatedAt: string;
  links: string[];
}

export interface Domain {
  id: number;
  slug: string;
  name: string;
  description: string;
  sort: number;
}

export interface Topic {
  id: number;
  domain_id: number;
  slug: string;
  name: string;
  description: string;
  sort: number;
}

export interface SiteInfo {
  title: string;
  description: string;
  author: string;
  avatar: string;
  mastheadIntro: string;
  footerNote: string;
  social: { label: string; url: string }[];
}

export interface TagStat {
  name: string;
  count: number;
}

const modules = import.meta.glob<{ default: unknown }>("../../content/data/*.json");

async function load<T>(name: string, fallback: T): Promise<T> {
  const mod = await modules[`../../content/data/${name}.json`]?.();
  return mod ? (mod.default as T) : fallback;
}

let cache: {
  posts: Post[];
  domains: Domain[];
  topics: Topic[];
  site: SiteInfo;
  tags: TagStat[];
} | null = null;

export async function getData(): Promise<{
  posts: Post[];
  domains: Domain[];
  topics: Topic[];
  site: SiteInfo;
  tags: TagStat[];
}> {
  if (cache) return cache;
  const [posts, structure, site, tags] = await Promise.all([
    load<Post[]>("posts", []),
    load<{ domains: Domain[]; topics: Topic[] }>("structure", { domains: [], topics: [] }),
    load<Partial<SiteInfo>>("site", {}),
    load<TagStat[]>("tags", []),
  ]);
  const siteInfo: SiteInfo = {
    title: site.title ?? "拾光集",
    description: site.description ?? "一个人的知识库与写作间",
    author: site.author ?? "",
    avatar: site.avatar ?? "",
    mastheadIntro: site.mastheadIntro ?? "",
    footerNote: site.footerNote ?? "",
    social: site.social ?? [],
  };
  cache = { posts, domains: structure.domains, topics: structure.topics, site: siteInfo, tags };
  return cache;
}

export function postDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.includes("T") ? iso : `${iso}Z`);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function topicPosts(posts: Post[], topicId: number): Post[] {
  return posts
    .filter((p) => p.topicId === topicId)
    .sort((a, b) => a.sortInTopic - b.sortInTopic || (a.publishedAt < b.publishedAt ? -1 : 1));
}

export function latest(posts: Post[], n: number): Post[] {
  return [...posts]
    .sort((a, b) => (a.publishedAt > b.publishedAt ? -1 : 1))
    .slice(0, n);
}

export function featured(posts: Post[], n: number): Post[] {
  const f = posts.filter((p) => p.featured);
  return (f.length ? f : latest(posts, n)).slice(0, n);
}

/** 同主题上下篇（按阅读顺序） */
export function neighbors(posts: Post[], post: Post): { prev?: Post; next?: Post } {
  if (post.topicId == null) return {};
  const seq = topicPosts(posts, post.topicId);
  const i = seq.findIndex((p) => p.id === post.id);
  if (i === -1) return {};
  return { prev: seq[i - 1], next: seq[i + 1] };
}

/** 反向引用：哪些已发布文章 [[引用]] 了 slug */
export function backlinks(posts: Post[], slug: string): Post[] {
  return posts.filter((p) => p.links.includes(slug));
}
