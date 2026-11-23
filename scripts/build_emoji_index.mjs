// 2026-11-23 — builds lib/emojiIndex.json for the page-icon emoji picker from emojibase-data (de + en labels / tags):
// [[emoji, group, "search words"], …] in Unicode order, groups 0–9 without 2 (skin-tone components). Run:
//   node scripts/build_emoji_index.mjs
import { readFileSync, writeFileSync } from "node:fs";
const de = JSON.parse(readFileSync("node_modules/emojibase-data/de/compact.json", "utf8"));
const en = JSON.parse(readFileSync("node_modules/emojibase-data/en/compact.json", "utf8"));
const enBy = new Map(en.map((e) => [e.hexcode, e]));
const rows = de
  .filter((e) => typeof e.group === "number" && e.group !== 2)
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map((e) => {
    const o = enBy.get(e.hexcode) ?? {};
    const words = new Set([e.label, ...(e.tags ?? []), o.label, ...(o.tags ?? [])].filter(Boolean).map((w) => String(w).toLowerCase()));
    return [e.unicode, e.group, [...words].join(" ")];
  });
writeFileSync("lib/emojiIndex.json", JSON.stringify(rows));
console.log(rows.length, "emojis");
