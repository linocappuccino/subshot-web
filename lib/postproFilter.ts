/* 2026-11-16, Lino (harte Regel): «Filter und Zähler müssen zu 100 Prozent stimmen». ONE function for counting and
   filtering — Post-Production page, client preview and Deliver all use it, the server (app/postpro_filter.py, MCP)
   mirrors it 1:1 and tests/test_postpro_filter.py checks every project and every filter combination.

   Faceted rule: the counter of a chip = the number of videos that match the OTHER two active filters AND this chip.
   So clicking a chip shows exactly the number it showed. «none» = no language / no platform icon. */

export type PFilter = { lang: string; fmt: string; plat: string };
export type PCtx = { assignments: Record<string, string>; formats: Record<string, string> };
export type PVideo = { id: string; platform?: string | null; platforms?: string[] | null };

export const PLATFORM_KEYS = ["youtube", "instagram", "meta", "tiktok"] as const;
export const FORMAT_KEYS = ["9:16", "16:9", "1:1", "4:5", "5:4"] as const;

/** all platform icons of a video (several possible), fixed order; old answers only had `platform` */
export function platformsOf(v: PVideo): string[] {
  const ps = v.platforms && v.platforms.length ? v.platforms : v.platform ? [v.platform] : [];
  return PLATFORM_KEYS.filter((k) => ps.includes(k));
}
export function langKeyOf(v: PVideo, ctx: PCtx): string {
  return ctx.assignments[v.id] || "none";
}
export function fmtKeyOf(v: PVideo, ctx: PCtx): string {
  const f = ctx.formats[v.id];
  return f && (FORMAT_KEYS as readonly string[]).includes(f) ? f : "other";
}

function langOk(v: PVideo, f: PFilter, ctx: PCtx) {
  return f.lang === "all" || langKeyOf(v, ctx) === f.lang;
}
function fmtOk(v: PVideo, f: PFilter, ctx: PCtx) {
  return f.fmt === "all" || fmtKeyOf(v, ctx) === f.fmt;
}
function platOk(v: PVideo, f: PFilter) {
  if (f.plat === "all") return true;
  const ps = platformsOf(v);
  return f.plat === "none" ? ps.length === 0 : ps.includes(f.plat);
}

export function matchesAll(v: PVideo, f: PFilter, ctx: PCtx): boolean {
  return langOk(v, f, ctx) && fmtOk(v, f, ctx) && platOk(v, f);
}

export function filterVideos<T extends PVideo>(videos: T[], f: PFilter, ctx: PCtx): T[] {
  return videos.filter((v) => matchesAll(v, f, ctx));
}

/** `present` = every format / platform that occurs in the whole list (chips stay visible with 0 when filtered out) */
export type FacetCounts = { lang: Record<string, number>; fmt: Record<string, number>; plat: Record<string, number>; present: { fmt: string[]; plat: string[] } };

/** counters for every chip; key «all» = the «Alle» chip of that row */
export function facetCounts(videos: PVideo[], f: PFilter, ctx: PCtx): FacetCounts {
  const lang: Record<string, number> = { all: 0 };
  const fmt: Record<string, number> = { all: 0 };
  const plat: Record<string, number> = { all: 0 };
  const inc = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
  const pf = new Set<string>(), pp = new Set<string>();
  for (const v of videos) {
    pf.add(fmtKeyOf(v, ctx));
    const all = platformsOf(v);
    if (all.length === 0) pp.add("none");
    for (const k of all) pp.add(k);
    const l = langOk(v, f, ctx), fo = fmtOk(v, f, ctx), p = platOk(v, f);
    if (fo && p) { inc(lang, "all"); inc(lang, langKeyOf(v, ctx)); }
    if (l && p) { inc(fmt, "all"); inc(fmt, fmtKeyOf(v, ctx)); }
    if (l && fo) {
      inc(plat, "all");
      const ps = platformsOf(v);
      if (ps.length === 0) inc(plat, "none");
      for (const k of ps) inc(plat, k);
    }
  }
  const present = {
    fmt: [...FORMAT_KEYS.filter((k) => pf.has(k)), ...(pf.has("other") ? ["other"] : [])],
    plat: [...PLATFORM_KEYS.filter((k) => pp.has(k)), ...(pp.has("none") ? ["none"] : [])],
  };
  return { lang, fmt, plat, present };
}

// ── 2026-11-17, Lino: list view — twin of app/postpro_filter.py list_groups() (tests compare) ──
/** the list view's groups: section order, ids in page order (filtered videos only) */
export function listGroups(videos: PVideo[], sectionOf: Record<string, string>, sectionOrder: string[]): { section: string; ids: string[] }[] {
  const so = new Map(sectionOrder.map((k, i) => [k, i]));
  const g = new Map<string, string[]>();
  for (const v of videos) { const s = sectionOf[v.id] ?? ""; if (!g.has(s)) g.set(s, []); g.get(s)!.push(v.id); }
  return [...g.keys()].sort((a, b) => (so.get(a) ?? so.size) - (so.get(b) ?? so.size)).map((s) => ({ section: s, ids: g.get(s)! }));
}
