import assert from "node:assert/strict";
import test from "node:test";
import { filterPublicStructure, selectPublicMedia } from "./publication.js";

test("filters out private-only topics and domains", () => {
  const result = filterPublicStructure(
    [{ topicId: 10 }],
    [
      { id: 10, domain_id: 1, name: "公开" },
      { id: 20, domain_id: 2, name: "私密" },
    ],
    [
      { id: 1, name: "公开域" },
      { id: 2, name: "私密域" },
    ],
  );
  assert.deepEqual(result.topics.map((topic) => topic.id), [10]);
  assert.deepEqual(result.domains.map((domain) => domain.id), [1]);
});

test("publishes only referenced safe media", () => {
  const result = selectPublicMedia(
    [{ contentMd: "![图](uploads/public.png)", cover: null }],
    [
      { stored_name: "public.png", mime: "image/png" },
      { stored_name: "private.png", mime: "image/png" },
      { stored_name: "unsafe.svg", mime: "image/svg+xml" },
    ],
  );
  assert.deepEqual(result.publishable.map((item) => item.stored_name), ["public.png"]);
  assert.equal(result.unsafe.length, 0);
});

test("rejects a referenced SVG from public output", () => {
  const result = selectPublicMedia(
    [{ contentMd: "![图](uploads/unsafe.svg)", cover: null }],
    [{ stored_name: "unsafe.svg", mime: "image/svg+xml" }],
  );
  assert.equal(result.publishable.length, 0);
  assert.deepEqual(result.unsafe.map((item) => item.stored_name), ["unsafe.svg"]);
});
