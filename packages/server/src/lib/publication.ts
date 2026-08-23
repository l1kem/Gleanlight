export interface StructureTopic {
  id: number;
  domain_id: number;
  [key: string]: unknown;
}

export interface StructureDomain {
  id: number;
  [key: string]: unknown;
}

export interface MediaRecord {
  stored_name: string;
  mime: string;
}

export function filterPublicStructure<TTopic extends StructureTopic, TDomain extends StructureDomain>(
  posts: { topicId: number | null }[],
  topics: TTopic[],
  domains: TDomain[],
): { topics: TTopic[]; domains: TDomain[] } {
  const publicTopicIds = new Set(
    posts.map((post) => post.topicId).filter((id): id is number => id != null),
  );
  const publicTopics = topics.filter((topic) => publicTopicIds.has(topic.id));
  const publicDomainIds = new Set(publicTopics.map((topic) => topic.domain_id));
  return {
    topics: publicTopics,
    domains: domains.filter((domain) => publicDomainIds.has(domain.id)),
  };
}

export function selectPublicMedia(
  posts: { contentMd: string; cover: string | null }[],
  media: MediaRecord[],
): { publishable: MediaRecord[]; unsafe: MediaRecord[] } {
  const referenced = media.filter((item) =>
    posts.some(
      (post) =>
        post.contentMd.includes(item.stored_name) || Boolean(post.cover?.includes(item.stored_name)),
    ),
  );
  const unsafe = referenced.filter(
    (item) => item.mime === "image/svg+xml" || item.stored_name.toLowerCase().endsWith(".svg"),
  );
  const unsafeNames = new Set(unsafe.map((item) => item.stored_name));
  return {
    publishable: referenced.filter((item) => !unsafeNames.has(item.stored_name)),
    unsafe,
  };
}
