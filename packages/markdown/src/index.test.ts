import assert from "node:assert/strict";
import test from "node:test";
import { renderMarkdown } from "./index.js";

test("renderMarkdown escapes raw HTML", () => {
  const html = renderMarkdown('<script>alert("xss")</script><img src=x onerror=alert(1)>');
  assert.doesNotMatch(html, /<script|<img/i);
  assert.match(html, /&lt;script&gt;/);
});

test("renderMarkdown keeps ordinary markdown features", () => {
  const html = renderMarkdown("## 标题\n\n[[hello|你好]]\n\n```js\nconst ok = true\n```");
  assert.match(html, /<h2 id=/);
  assert.match(html, /href="\/posts\/hello"/);
  assert.match(html, /<figure class="code"/);
});
