// 2026-11-23 — the page-icon emoji picker: German + English search over the generated index
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { searchEmojis } from "../lib/emojiSearch.ts";

const base = (e: string) => e.replace(/\uFE0F/g, "");
const rows = JSON.parse(readFileSync(new URL("../lib/emojiIndex.json", import.meta.url), "utf8"));

test("index has all groups except skin-tone components", () => {
  assert.ok(rows.length > 1800);
  const groups = new Set(rows.map((r: any) => r[1]));
  assert.deepEqual([...groups].sort(), [0, 1, 3, 4, 5, 6, 7, 8, 9]);
});
test("German and English words find the same emoji", () => {
  for (const q of ["kamera", "camera"]) assert.ok(searchEmojis(rows, q).some((r: any) => base(r[0]) === "📷"), q);
  for (const q of ["herz", "heart"]) assert.ok(searchEmojis(rows, q).some((r: any) => base(r[0]) === "❤"), q);
  assert.ok(searchEmojis(rows, "film").some((r: any) => base(r[0]) === "🎬"));
});
test("empty search = everything", () => {
  assert.equal(searchEmojis(rows, "  ").length, rows.length);
});
