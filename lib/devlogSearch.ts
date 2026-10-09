// Devlog search (2026-10-09, Lino: "eine gute Suchfunktion — ich kündige dort
// jede neue Funktion an und erkläre sie in einem Video; die Suche muss gut
// wissen, was im Video passiert"). Each post is written from the video's
// transcript, so the full text is searched — plus title, excerpt, tags
// (#internal tags in Ghost = invisible extra search words) and the meta
// description. Forgiving on purpose: umlauts/ß, simple German endings
// (Szene/Szenen, Notiz/Notizen), word starts while typing, small typos.

import MiniSearch from "minisearch";

export interface SearchablePost {
  id: string;
  title: string;
  preview: string;
  text?: string;
  tags?: string[];
  keywords?: string;
}

/** lower case, umlauts and ß folded, punctuation removed */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // "ue" typed for "ü" (no umlauts on the keyboard) counts the same
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/ue/g, "u");
}

/** a light German/English stemmer: the same word in singular/plural or
 * with common endings lands on the same term */
function stem(w: string): string {
  if (w.length <= 4) return w;
  for (const end of ["ungen", "ung", "ern", "en", "er", "es", "e", "n", "s"]) {
    if (w.endsWith(end) && w.length - end.length >= 4) return w.slice(0, -end.length);
  }
  return w;
}

// filler words of typed questions ("wie füge ich eine Notiz ein?") don't
// have to be in a post
const STOP = new Set(
  "ich du er sie es wir ihr man wie was wo wann warum wer welche welcher welches kann konnen muss mussen soll will mochte geht gibt "
    .concat("ein eine einen einem einer eines der die das den dem des und oder aber mit auf in im am an zu zum zur von vom fur bei ist sind wird werden hat haben ")
    .concat("mein meine dein deine sich nicht noch auch nur mal so dann denn ja nein the a an and or of to in on for is are how what can do i you my")
    .split(/\s+/)
    .filter(Boolean),
);

const processTerm = (term: string) => {
  const t = fold(term).replace(/[^a-z0-9+#-]/g, "");
  return t.length > 1 && !STOP.has(t) ? stem(t) : null;
};

export function buildDevlogIndex(posts: SearchablePost[]): MiniSearch<SearchablePost> {
  const ms = new MiniSearch<SearchablePost>({
    fields: ["title", "tags", "keywords", "preview", "text"],
    storeFields: ["id"],
    extractField: (doc, field) => {
      const v = (doc as unknown as Record<string, unknown>)[field];
      return Array.isArray(v) ? v.join(" ") : ((v as string) ?? "");
    },
    processTerm,
    searchOptions: {
      boost: { title: 5, tags: 4, keywords: 3, preview: 2, text: 1 },
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 0.2 : false),
    },
  });
  ms.addAll(posts);
  return ms;
}

/** ids of the matching posts, best first: every word must match; when
 * nothing does, the posts matching the most words */
export function searchDevlog(index: MiniSearch<SearchablePost>, query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  let hits = index.search(q, { combineWith: "AND" });
  if (!hits.length) hits = index.search(q, { combineWith: "OR" });
  return hits.map((h) => String(h.id));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** the passage of the post that matches best, as HTML with <mark> around
 * the hits (falls back to the start of the excerpt) */
export function snippetFor(post: SearchablePost, query: string, size = 170): string {
  const words = query
    .split(/\s+/)
    .map((w) => processTerm(w))
    .filter((w): w is string => !!w);
  const source = (post.text || post.preview || "").replace(/\s+/g, " ").trim();
  if (!words.length || !source) return escapeHtml(post.preview || source.slice(0, size));
  // the window with the most different search words in it, starting a bit
  // before a hit (folding changes lengths a little; positions are mapped
  // back proportionally)
  const folded = fold(source);
  const occ: { pos: number; w: number }[] = [];
  words.forEach((w, wi) => {
    for (let i = folded.indexOf(w), n = 0; i >= 0 && n < 60; i = folded.indexOf(w, i + 1), n++) occ.push({ pos: i, w: wi });
  });
  if (!occ.length) return escapeHtml(post.preview || source.slice(0, size));
  let best = 0;
  let bestScore = -1;
  for (const o of occ) {
    const s0 = Math.max(0, o.pos - 40);
    const score = new Set(occ.filter((x) => x.pos >= s0 && x.pos < s0 + size - 20).map((x) => x.w)).size;
    if (score > bestScore || (score === bestScore && s0 < best)) {
      bestScore = score;
      best = s0;
    }
  }
  // the original text, cut at word boundaries around the best window
  const ratio = source.length / Math.max(1, folded.length);
  let start = Math.max(0, Math.floor(best * ratio));
  let end = Math.min(source.length, start + size);
  while (start > 0 && source[start - 1] !== " ") start--;
  while (end < source.length && source[end] !== " ") end++;
  const cut = source.slice(start, end);
  // mark every word that starts like a search word (umlaut-insensitive)
  const html = cut
    .split(/(\s+)/)
    .map((tok) => {
      const f = fold(tok).replace(/[^a-z0-9+#-]/g, "");
      return f && words.some((w) => f.startsWith(w) || (w.length >= 5 && f.startsWith(w.slice(0, -1)))) ? `<mark>${escapeHtml(tok)}</mark>` : escapeHtml(tok);
    })
    .join("");
  return `${start > 0 ? "… " : ""}${html}${end < source.length ? " …" : ""}`;
}
