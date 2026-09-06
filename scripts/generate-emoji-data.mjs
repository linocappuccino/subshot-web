// One-off generator (2026-07-19) — run manually with `node scripts/generate-emoji-data.mjs`
// whenever emojibase-data updates and the emoji set should be refreshed. Not part of the
// build; EmojiField.tsx imports the generated lib/emojiData.json directly, so the app's
// runtime bundle never depends on the full emojibase-data package (792KB de/data.json with
// skins/hexcodes/emoticons we don't need — trims to ~230KB).
import { writeFileSync } from "fs";
import de from "emojibase-data/de/data.json" with { type: "json" };

// group 2 = "component" (bare skin-tone/hair-style swatches, never a standalone pickable
// emoji) and group undefined = bare regional-indicator letters (A-Z alone, not real flags) —
// both excluded, same reasoning Lino gave for skipping skin-tone/gender VARIANTS earlier.
const filtered = de
  .filter((e) => e.group !== undefined && e.group !== 2)
  .map((e) => ({ emoji: e.emoji, name: e.label, tags: e.tags || [], group: e.group }));

writeFileSync(new URL("../lib/emojiData.json", import.meta.url), JSON.stringify(filtered));
console.log(`wrote ${filtered.length} emojis to lib/emojiData.json`);
