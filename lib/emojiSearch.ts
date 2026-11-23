/** 2026-11-23 — emoji picker search (lib/emojiIndex.json rows: [emoji, group, "German + English words"]) */
export type EmojiRow = [emoji: string, group: number, words: string];

/** every typed word must match the start of a word of the emoji (German or English) — or be contained in them */
export function searchEmojis(rows: EmojiRow[], query: string): EmojiRow[] {
  const qs = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!qs.length) return rows;
  return rows.filter(([, , words]) => {
    const ws = words.split(" ");
    return qs.every((q) => ws.some((w) => w.startsWith(q)) || words.includes(q));
  });
}
