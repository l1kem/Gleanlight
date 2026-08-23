import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScheduledAt } from "./time.js";

test("normalizes an offset timestamp to SQLite UTC", () => {
  assert.equal(normalizeScheduledAt("2026-08-23T10:00:00+08:00"), "2026-08-23 02:00:00");
});

test("accepts legacy SQLite UTC values and rejects invalid input", () => {
  assert.equal(normalizeScheduledAt("2026-08-23 02:00:00"), "2026-08-23 02:00:00");
  assert.equal(normalizeScheduledAt("not-a-date"), undefined);
  assert.equal(normalizeScheduledAt(""), null);
});
