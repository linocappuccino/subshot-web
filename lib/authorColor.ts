/** Deterministic per-person accent color for feedback comments (2026-07-17,
 * Lino: "Feedback-Kommentare... pro Person leicht farblich unterscheiden") —
 * same name always maps to the same color (trimmed/case-insensitive, same
 * identity rule as the Preview page's per-name feedback sections), so a
 * given person's comments are visually recognizable at a glance across an
 * idea's whole feedback list. Deliberately avoids hues already meaningful
 * elsewhere in the app: blue (primary/accent), green (approved/success),
 * red (destructive). Mirrored in app/idea_share_view.py's _AUTHOR_COLORS /
 * _author_color on the backend (Preview page is server-rendered, no shared
 * JS) — keep both palettes/hash logic in sync if either changes. */
const AUTHOR_COLORS = [
  "#a78bfa", // violet
  "#fb923c", // orange
  "#f472b6", // pink
  "#2dd4bf", // teal
  "#fbbf24", // amber
  "#818cf8", // indigo
  "#22d3ee", // cyan
  "#e879f9", // fuchsia
];

export function authorColor(name: string): string {
  const key = name.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return AUTHOR_COLORS[hash % AUTHOR_COLORS.length];
}
