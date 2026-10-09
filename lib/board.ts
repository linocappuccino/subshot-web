/** 2026-10-08, Lino — Milanote-style idea board. Document shape shared with
 * the backend (app/idea_board.py validates and stores exactly this). All
 * positions/sizes are in board ("world") pixels; `src`/`image_src` are
 * presigned URLs the API adds on read and strips again on save. */

import type { Priority } from "./types";

export const GRID = 24;

export type TextColor = "default" | "yellow" | "green" | "blue" | "pink" | "purple" | "orange" | "red" | "transparent";
export const TEXT_COLORS: TextColor[] = ["default", "yellow", "green", "blue", "pink", "purple", "orange", "red", "transparent"];
export const TEXT_COLOR_STYLES: Record<TextColor, { bg: string; fg: string; border: string }> = {
  default: { bg: "#232325", fg: "#f0f0f0", border: "rgba(255,255,255,0.10)" },
  yellow: { bg: "#fde68a", fg: "#1f1a0a", border: "rgba(0,0,0,0.08)" },
  green: { bg: "#bbf7d0", fg: "#0b2014", border: "rgba(0,0,0,0.08)" },
  blue: { bg: "#bfdbfe", fg: "#0b1a2e", border: "rgba(0,0,0,0.08)" },
  pink: { bg: "#fbcfe8", fg: "#2a0b1c", border: "rgba(0,0,0,0.08)" },
  purple: { bg: "#ddd6fe", fg: "#1a0f33", border: "rgba(0,0,0,0.08)" },
  orange: { bg: "#fed7aa", fg: "#2a1405", border: "rgba(0,0,0,0.08)" },
  red: { bg: "#fecaca", fg: "#2e0b0b", border: "rgba(0,0,0,0.08)" },
  transparent: { bg: "transparent", fg: "#f0f0f0", border: "transparent" },
};

export const STROKE_COLORS = ["#f0f0f0", "#ff5a5f", "#ffb020", "#3ecf8e", "#3b82f6", "#a855f7", "#111111"] as const;
export type StrokeColor = (typeof STROKE_COLORS)[number];
export const STROKE_WIDTHS = [2, 4, 8, 14];

interface BaseElement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  /** 2026-10-08, Lino: tags (search / filter), up to 10 */
  tags?: string[];
}

export interface TextElement extends BaseElement {
  type: "text";
  html: string;
  color: TextColor;
  /** 2026-10-08, Lino: whole text box left / centered / right (default left) */
  align?: TextAlign;
}

export type TextAlign = "left" | "center" | "right";

export interface MediaElement extends BaseElement {
  type: "image" | "video" | "audio" | "pdf" | "file";
  asset_key: string;
  name: string;
  mime: string;
  size?: number;
  src?: string | null;
  /** small display version (≤1000 px image / video poster), added on read */
  thumb_src?: string | null;
  /** all display sizes with their pixel widths (images), added on read */
  srcset?: string | null;
}

export interface LinkElement extends BaseElement {
  type: "link";
  url: string;
  title: string;
  description: string;
  site_name: string;
  image_key?: string;
  image_src?: string | null;
}

export interface DrawingElement extends BaseElement {
  type: "drawing";
  points: [number, number][];
  color: StrokeColor;
  stroke_width: number;
}

/** 2026-10-08, Lino: a scene card — number, image, title and text. On
 * "Abgenommen" every scene card becomes its own Scene in the shot list, in
 * number order (backend: approve_idea / idea_board.scenes_for_approval). */
export interface SceneElement extends BaseElement {
  type: "scene";
  number: number;
  title: string;
  html: string;
  image_key?: string;
  image_src?: string | null;
  /** 2026-10-08, Lino: width / height of the image — the card shows it in its
   * own format (9:16, 1:1, …) instead of cropping to 16:9 */
  image_ratio?: number;
  /** small display version of the image, added on read */
  image_thumb_src?: string | null;
  image_srcset?: string | null;
  /** 2026-10-08, Lino: same priorities as the shot list (number badge color),
   * carried over to the shot-list scene on "Abgenommen" */
  priority?: Priority | null;
  /** spoken lines — each becomes its own dialogue entry of the shot-list scene */
  dialogues?: string[];
}

/** 2026-10-08, Lino: a group — a frame drawn around its member elements
 * (expanded) or a compact card standing in for them (collapsed). While
 * expanded its x/y/w/h are derived from the members (see normalizeGroups);
 * while collapsed they are the card's own position/size and the members are
 * hidden (they keep their positions and move along with the card). */
export interface GroupElement extends BaseElement {
  type: "group";
  title: string;
  collapsed: boolean;
  children: string[];
  /** 2026-10-08, Lino: "Varianten zur Wahl" — members are variants people
   * vote on with 👍🏼 (votes are stored server-side, not in the board) */
  vote?: boolean;
}

/** one 👍🏼 on a variant (GET …/board/votes) */
export interface BoardVote {
  group_id: string;
  element_id: string;
  voter_name: string;
  voter_key: string;
}

const TAG_HUES = [212, 152, 32, 280, 340, 188, 48, 0, 260, 120];
/** a stable color per tag name (same tag → same color everywhere) */
export function tagColor(tag: string): { bg: string; fg: string } {
  let h = 0;
  for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = TAG_HUES[h % TAG_HUES.length];
  return { bg: `hsla(${hue}, 70%, 55%, 0.22)`, fg: `hsl(${hue}, 85%, 78%)` };
}

/** 2026-10-08, Lino: a to-do list node. The items are a real project
 * TodoList (idea_id = this idea): assignees via @, notifications and
 * "Meine To-dos" work like any other project to-do. */
export interface TodoElement extends BaseElement {
  type: "todo";
  list_id: string;
  title: string;
}

/** Read-only to-do list as the client preview gets it (names, no user ids). */
export interface PublicBoardTodoList {
  id: string;
  name: string;
  items: { id: string; text: string; done: boolean; assignee_name: string | null }[];
}

/** 2026-10-08, Lino: a color palette card (manual, or read from an image). */
export interface PaletteElement extends BaseElement {
  type: "palette";
  title: string;
  colors: string[];
}

/** 2026-10-08, Lino: a location card — address (Google Places search, same as
 * the shot list), coordinates and a rendered map stored as a board file. */
export interface LocationElement extends BaseElement {
  type: "location";
  title: string;
  address: string;
  lat?: number | null;
  lng?: number | null;
  image_key?: string;
  image_src?: string | null;
  /** the map image's style: satellite (Google) or the street map */
  map_style?: "satellite" | "map";
}

/** 2026-10-08, Lino: a post-it note — "muss wirklich wie ein Post-it
 * Klebezettel aussehen", paper color changeable. Edited like a text box. */
export type StickyColor = "yellow" | "pink" | "green" | "blue" | "orange" | "purple";
export const STICKY_COLORS: StickyColor[] = ["yellow", "pink", "green", "blue", "orange", "purple"];
export const STICKY_STYLES: Record<StickyColor, { paper: string; glue: string }> = {
  yellow: { paper: "#fff383", glue: "#f3e35e" },
  pink: { paper: "#ffbcd8", glue: "#f6a3c6" },
  green: { paper: "#c3f2ad", glue: "#a9e48f" },
  blue: { paper: "#b4e1ff", glue: "#97d0f7" },
  orange: { paper: "#ffd093", glue: "#f8bb6f" },
  purple: { paper: "#ddc9ff", glue: "#c9adfb" },
};
export interface StickyElement extends BaseElement {
  type: "sticky";
  html: string;
  color: StickyColor;
  align?: TextAlign;
}

/** 2026-10-08, Lino: one color as a big square with its codes underneath. */
export interface ColorElement extends BaseElement {
  type: "color";
  hex: string;
  name?: string;
}

/** 2026-10-08, Lino: bloom.site-style moodboard — several images in one card,
 * laid out on a grid with `cols` columns; each image spans w columns × h rows
 * (drag its corner), the others flow around it; order by drag and drop. */
export interface MoodboardItem {
  id: string;
  asset_key: string;
  src?: string | null;
  name: string;
  mime: string;
  /** layout 2: width in 24ths of the card (old layout: column span) */
  w: number;
  /** old layout only: row span */
  h: number;
  /** the image's width / height — its height follows from this */
  ar?: number;
  /** layout 3: size factor (1 = normal) — bigger images make their row taller;
   * layout 4: the size level (1 = normal, 2–4 = that many rows tall) */
  s?: number;
  /** layout 4: which side a big image sits on (the edge it was pulled from
   * stays put: pulled at its right edge → it stays on the left) */
  side?: "l" | "r";
  /** small display version, added on read */
  thumb_src?: string | null;
  srcset?: string | null;
}
export interface MoodboardElement extends BaseElement {
  type: "moodboard";
  title: string;
  /** how many images fit side by side by default ("Spalten") */
  cols: number;
  items: MoodboardItem[];
  /** 2 = free sizes (2026-10-08, Lino: "keine festen Spaltenbreiten");
   * 4 = mosaic with size levels and a fixed row height (2026-10-09) */
  layout?: number;
  /** layout 4: the normal row height — set when the card is resized at its
   * corner, kept while single images are made bigger/smaller */
  row_h?: number;
}

export const MOODBOARD_UNITS = 24;

/** items in the current format (justified rows, size factor `s`) — older
 * cards stored a column/row span or a width in 24ths */
export function moodboardItems(el: MoodboardElement): MoodboardItem[] {
  if (el.layout === 3 || el.layout === 4) return el.items;
  const cols = Math.max(1, el.cols || 3);
  if (el.layout === 2) return el.items.map((it) => ({ ...it, s: it.s ?? clampS((it.w * cols) / MOODBOARD_UNITS) }));
  return el.items.map((it) => ({ ...it, ar: it.ar ?? Math.min(it.w, cols) / Math.max(1, it.h), s: it.s ?? clampS(Math.min(it.w, cols)) }));
}

const clampS = (v: number) => Math.max(0.25, Math.min(4, Math.round(v * 1000) / 1000));
export const clampMoodboardScale = clampS;

export type MoodboardBox = { id: string; x: number; y: number; w: number; h: number };

/** 2026-10-08, Lino: moodboard layout — gap-free and every image keeps its
 * aspect ratio (no cropping).
 *
 * Normal images (size factor `s` < 1.15) sit in justified rows: a row closes
 * at the image count that brings its height closest to its target (`baseH`
 * ≈ `cols` square images per row, times the images' mean `s`), then fills the
 * width exactly. An image pulled bigger (s ≥ 1.15) becomes a FEATURE (Lino:
 * "ein Bild muss über mehrere Zeilen gehen können, nur dieses wird grösser"):
 * it spans several rows on one side, the following images stack in justified
 * rows on the other side. The block's height is solved exactly so the feature
 * and the stacked rows end on the same line:
 *   side rows at width w are a·w + c tall (a = Σ 1/Σar per row, c = gaps),
 *   the feature at height H is ar_F·H wide, w = W − gap − ar_F·H
 *   ⇒ H = (a·(W − gap) + c) / (1 + a·ar_F)
 * The number of stacked images is the one whose exact H is closest to the
 * feature's target (baseH·s). Features alternate left/right. A feature with
 * nothing after it takes the images of the row before it as its side. */
export function layoutMoodboard(items: MoodboardItem[], width: number, cols: number, gap: number): { boxes: MoodboardBox[]; height: number } {
  const W = Math.max(40, width);
  return layoutMoodboardBase(items, W, (W - gap * (Math.max(1, cols) - 1)) / Math.max(1, cols), gap);
}

/** 2026-10-08, Lino: "die Moodboard-Node an der Ecke vergrössern — der
 * Content muss sich der Form der Node anpassen". Finds the row height
 * (density) whose layout comes closest to the card's height, then stretches
 * the rows vertically by the small remainder so the images fill the card
 * exactly (object-cover crops that bit). */
export function fitMoodboard(items: MoodboardItem[], width: number, height: number, gap: number): { boxes: MoodboardBox[]; height: number; baseH: number } {
  const W = Math.max(40, width);
  const H = Math.max(40, height);
  if (!items.length) return { boxes: [], height: H, baseH: W / 3 };
  const lo = 16;
  const hi = Math.max(lo * 2, Math.max(W, H) * 1.5);
  const search = (list: MoodboardItem[]) => {
    // coarse: every density as is; fine: the 4 closest get their rows tuned
    const coarse: { baseH: number; err: number }[] = [];
    for (let k = 0; k <= 90; k++) {
      const baseH = lo * Math.pow(hi / lo, k / 90);
      coarse.push({ baseH, err: Math.abs(Math.log(layoutMoodboardBase(list, W, baseH, gap).height / H)) });
    }
    coarse.sort((a, b) => a.err - b.err);
    let best: { baseH: number; layout: { boxes: MoodboardBox[]; height: number }; err: number } | null = null;
    for (const c of coarse.slice(0, 4)) {
      const layout = layoutMoodboardBase(list, W, c.baseH, gap, H);
      const err = Math.abs(Math.log(layout.height / H));
      if (!best || err < best.err) best = { baseH: c.baseH, layout, err };
    }
    return best!;
  };
  // if the card's shape can't hold the enlarged images as they are, their
  // enlargement is toned down (for display only) before images get cropped
  let best = search(items);
  for (const f of [0.66, 0.4, 0.2, 0]) {
    // the user's enlargement wins: only toned down when the card's shape
    // would otherwise crop the images by more than ~20 %
    if (best.err < Math.log(1.2)) break;
    const damped = items.map((it) => ((it.s ?? 1) > 1 ? { ...it, s: 1 + ((it.s ?? 1) - 1) * f } : it));
    const next = search(damped);
    if (next.err < best.err - 0.05) best = next;
  }
  const { layout, baseH } = best;
  const k = H / Math.max(1, layout.height);
  return { boxes: layout.boxes.map((b) => ({ ...b, y: b.y * k, h: b.h * k })), height: H, baseH };
}

/** the same fit at a fixed row height — cheap enough to run for every
 * candidate size while an image is being dragged bigger/smaller */
export function fitMoodboardAt(items: MoodboardItem[], width: number, height: number, gap: number, baseH: number): { boxes: MoodboardBox[]; height: number; baseH: number } {
  const W = Math.max(40, width);
  const H = Math.max(40, height);
  const layout = layoutMoodboardBase(items, W, baseH, gap, H);
  const k = H / Math.max(1, layout.height);
  return { boxes: layout.boxes.map((b) => ({ ...b, y: b.y * k, h: b.h * k })), height: H, baseH };
}

export function layoutMoodboardBase(items: MoodboardItem[], width: number, rowH: number, gap: number, fitH?: number): { boxes: MoodboardBox[]; height: number } {
  const W = Math.max(40, width);
  const G = gap;
  const baseH = Math.max(8, rowH);
  const ar = (it: MoodboardItem) => Math.max(0.1, it.ar || 1);
  const sc = (it: MoodboardItem) => it.s ?? 1;
  const FEATURE = 1.15;
  const isFeature = (it: MoodboardItem) => sc(it) >= FEATURE;
  const sumAr = (row: MoodboardItem[]) => row.reduce((t, it) => t + ar(it), 0);
  const heightAt = (row: MoodboardItem[], w: number) => (w - G * (row.length - 1)) / sumAr(row);
  const targetCapped = (row: MoodboardItem[]) => (baseH * row.reduce((t, it) => t + Math.min(sc(it), FEATURE) * ar(it), 0)) / sumAr(row);
  const targetFree = (row: MoodboardItem[]) => (baseH * row.reduce((t, it) => t + sc(it) * ar(it), 0)) / sumAr(row);

  /** justified rows of `list` at width w (short last row merged upward);
   * rows of big images aim for their bigger target height */
  const buildRows = (list: MoodboardItem[], w: number, big = false): MoodboardItem[][] => {
    const targetOf = big ? targetFree : targetCapped;
    const rows: MoodboardItem[][] = [];
    let cur: MoodboardItem[] = [];
    for (const it of list) {
      const next = [...cur, it];
      const h = heightAt(next, w);
      if (h > targetOf(next)) {
        cur = next;
        continue;
      }
      if (cur.length && Math.abs(heightAt(cur, w) - targetOf(cur)) < Math.abs(h - targetOf(next))) {
        rows.push(cur);
        cur = [it];
      } else {
        rows.push(next);
        cur = [];
      }
    }
    if (cur.length) {
      if (heightAt(cur, w) > targetOf(cur) * 1.5 && rows.length) rows[rows.length - 1] = [...rows[rows.length - 1], ...cur];
      else rows.push(cur);
    }
    return rows;
  };

  /** exact block height for a feature + the side rows (see doc comment) */
  const solve = (F: MoodboardItem, rows: MoodboardItem[][]) => {
    const a = rows.reduce((t, r) => t + 1 / sumAr(r), 0);
    const c = G * (rows.length - 1) - G * rows.reduce((t, r) => t + (r.length - 1) / sumAr(r), 0);
    const H = (a * (W - G) + c) / (1 + a * ar(F));
    return { H, wf: ar(F) * H, ws: W - G - ar(F) * H };
  };

  // 1) blocks: runs of normal images, or a feature with its side images
  type Block = { kind: "rows"; items: MoodboardItem[]; feature?: boolean } | { kind: "feature"; F: MoodboardItem; side: MoodboardItem[] };
  const blocks: Block[] = [];
  let i = 0;
  while (i < items.length) {
    if (!isFeature(items[i])) {
      const run: MoodboardItem[] = [];
      while (i < items.length && !isFeature(items[i])) run.push(items[i++]);
      blocks.push({ kind: "rows", items: run });
      continue;
    }
    // several big images in a row: together they form one tall justified row
    if (i + 1 < items.length && isFeature(items[i + 1])) {
      const run: MoodboardItem[] = [];
      while (i < items.length && isFeature(items[i])) run.push(items[i++]);
      blocks.push({ kind: "rows", items: run, feature: true });
      continue;
    }
    const F = items[i++];
    const Hf = baseH * sc(F);
    const wsEst = W - G - ar(F) * Hf;
    const pool: MoodboardItem[] = [];
    for (let j = i; j < items.length && !isFeature(items[j]) && pool.length < 24; j++) pool.push(items[j]);
    // a feature must visibly span several rows: candidates with at least two
    // stacked rows beside it win over a single row (which would just look
    // like an ordinary row of equally tall images)
    let best: { k: number; err: number; multi: boolean } | null = null;
    if (wsEst > W * 0.18) {
      for (let k = 1; k <= pool.length; k++) {
        const rows = buildRows(pool.slice(0, k), wsEst);
        const { H, wf, ws } = solve(F, rows);
        if (ws < W * 0.15 || wf < W * 0.15 || H <= 0) continue;
        const err = Math.abs(H - Hf);
        const multi = rows.length >= 2;
        if (!best || (multi && !best.multi) || (multi === best.multi && err < best.err)) best = { k, err, multi };
        if (H < Hf * 0.5 && best.multi) break; // only getting shorter from here
      }
    }
    const side = best ? pool.slice(0, best.k) : [];
    if (!side.length && pool.length) {
      // nothing fits beside it (too wide for the card): it joins the
      // following images as a row instead of taking a fixed full width
      const run: MoodboardItem[] = [F];
      while (i < items.length && !isFeature(items[i])) run.push(items[i++]);
      blocks.push({ kind: "rows", items: run });
      continue;
    }
    i += side.length;
    blocks.push({ kind: "feature", F, side });
  }
  // a feature with nothing beside it: at the very end it takes the images of
  // the row before it; otherwise (too wide to share the width) it becomes a
  // full-width image of its own
  for (let b = 0; b < blocks.length; b++) {
    const blk = blocks[b];
    if (blk.kind !== "feature" || blk.side.length) continue;
    const prev = blocks[b - 1];
    const atEnd = b === blocks.length - 1;
    if (atEnd && prev && prev.kind === "rows" && !prev.feature && prev.items.length) {
      const rows = buildRows(prev.items, W);
      const take = rows[rows.length - 1];
      blk.side = take;
      prev.items = prev.items.slice(0, prev.items.length - take.length);
    }
  }

  // 2) positions
  const boxes: MoodboardBox[] = [];
  let y = 0;
  let featureNo = 0;
  const placeRows = (rows: MoodboardItem[][], x0: number, w: number, y0: number) => {
    let yy = y0;
    rows.forEach((row, ri) => {
      const h = heightAt(row, w);
      let x = x0;
      for (const it of row) {
        const bw = ar(it) * h;
        boxes.push({ id: it.id, x, y: yy, w: bw, h });
        x += bw + G;
      }
      yy += h + (ri < rows.length - 1 ? G : 0);
    });
    return yy;
  };
  const live = blocks.filter((b) => b.kind === "feature" || b.items.length);
  // rows of every row block, decided up front so they can be fine-tuned
  const blockRows = live.map((blk) => (blk.kind === "rows" ? buildRows(blk.items, W, !!blk.feature) : null));
  if (fitH) tuneRows();

  /** fitting a card (2026-10-08): the total height only changes in steps
   * (it depends on which image lands in which row), so move single images
   * between neighbouring rows, or split/merge rows, while that brings the
   * total closer to the card's height — every row staying a pleasant height */
  function tuneRows() {
    const rowsH = (rows: MoodboardItem[][]) => rows.reduce((t, r) => t + heightAt(r, W), 0) + G * Math.max(0, rows.length - 1);
    const fixed = live.reduce((t, blk, bi) => {
      if (blk.kind === "rows") return t;
      const { side, F } = blk;
      if (!side.length) return t + rowsH(buildRows([F], W, true));
      return t + solve(F, buildRows(side, W - G - ar(F) * baseH * sc(F))).H;
    }, 0) + G * Math.max(0, live.length - 1);
    const total = () => fixed + blockRows.reduce((t, rows) => t + (rows ? rowsH(rows) : 0), 0);

    // 1) optimal row breaks (like text justification): for a row height t,
    //    dynamic programming finds the partition whose rows deviate least
    //    from t; t itself is searched so the total lands on the card height
    const dpRows = (list: MoodboardItem[], t: number, bigRows: boolean): MoodboardItem[][] => {
      const n = list.length;
      const best = new Array<number>(n + 1).fill(Infinity);
      const from = new Array<number>(n + 1).fill(0);
      best[0] = 0;
      for (let j = 1; j <= n; j++) {
        let A = 0;
        let S = 0;
        for (let i = j - 1; i >= 0 && j - i <= 14; i--) {
          A += ar(list[i]);
          S += (bigRows ? sc(list[i]) : Math.min(sc(list[i]), FEATURE)) * ar(list[i]);
          const h = (W - G * (j - i - 1)) / A;
          const tt = (t * S) / A;
          const c = best[i] + (j - i) * Math.pow(Math.log(h / tt), 2);
          if (c < best[j]) {
            best[j] = c;
            from[j] = i;
          }
        }
      }
      const rows: MoodboardItem[][] = [];
      for (let j = n; j > 0; j = from[j]) rows.unshift(list.slice(from[j], j));
      return rows;
    };
    const rowBlocks = live.map((blk) => (blk.kind === "rows" ? blk : null));
    let bestT = baseH;
    let bestErr = Math.abs(Math.log(total() / fitH!));
    let bestRows = blockRows.slice();
    const tryT = (t: number) => {
      rowBlocks.forEach((blk, bi) => {
        if (blk) blockRows[bi] = dpRows(blk.items, t, !!blk.feature);
      });
      const e = Math.abs(Math.log(total() / fitH!));
      if (e < bestErr) {
        bestErr = e;
        bestT = t;
        bestRows = blockRows.slice();
      }
      return total();
    };
    let lo = Math.log(10);
    let hi = Math.log(4000);
    for (let k = 0; k < 36; k++) {
      const mid = (lo + hi) / 2;
      if (tryT(Math.exp(mid)) < fitH!) lo = mid;
      else hi = mid;
    }
    for (let i = 0; i < blockRows.length; i++) blockRows[i] = bestRows[i];

    // 1b) balanced rows can't hit every height (2 even rows too short, 3 too
    //     tall …); rows of different heights can — e.g. 4 bigger images over
    //     10 smaller ones. Exact search: dynamic programming over (images
    //     placed, height so far in small steps) keeps the most even partition
    //     for every reachable height; take the one landing on the target.
    if (bestErr > 0.01) {
      const rowIdx = rowBlocks.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
      const current = rowIdx.map((i) => rowsH(blockRows[i]!));
      const rest = fitH! - fixed - (total() - fixed - current.reduce((x, y) => x + y, 0));
      const sumCur = current.reduce((x, y) => x + y, 0) || 1;
      rowIdx.forEach((bi, n) => {
        const blk = rowBlocks[bi]!;
        const list = blk.items;
        const target = Math.max(20, (rest * current[n]) / sumCur);
        const step = Math.max(2, target / 300);
        const B = Math.ceil((target * 2) / step) + 2;
        const m = list.length;
        const cost = new Float64Array((m + 1) * (B + 1)).fill(Infinity);
        const backI = new Int16Array((m + 1) * (B + 1));
        const backB = new Int32Array((m + 1) * (B + 1));
        cost[0] = 0;
        for (let j = 1; j <= m; j++) {
          let A = 0;
          let S = 0;
          for (let i = j - 1; i >= 0 && j - i <= 14; i--) {
            A += ar(list[i]);
            S += (blk.feature ? sc(list[i]) : Math.min(sc(list[i]), FEATURE)) * ar(list[i]);
            const h = (W - G * (j - i - 1)) / A;
            const tt = (bestT * S) / A;
            const rc = (j - i) * Math.pow(Math.log(h / tt), 2);
            const add = Math.round((h + (i > 0 ? G : 0)) / step);
            for (let b0 = 0; b0 + add <= B; b0++) {
              const c0 = cost[i * (B + 1) + b0];
              if (c0 === Infinity) continue;
              const k = j * (B + 1) + b0 + add;
              if (c0 + rc < cost[k]) {
                cost[k] = c0 + rc;
                backI[k] = i;
                backB[k] = b0;
              }
            }
          }
        }
        const T = Math.round(target / step);
        let pick = -1;
        let pickScore = Infinity;
        for (let b = 0; b <= B; b++) {
          const c = cost[m * (B + 1) + b];
          if (c === Infinity) continue;
          // being off the height costs much more than uneven rows
          const score = Math.abs(Math.log(Math.max(1, b) / Math.max(1, T))) * 40 + c;
          if (score < pickScore) {
            pickScore = score;
            pick = b;
          }
        }
        if (pick < 0) return;
        const rows: MoodboardItem[][] = [];
        for (let j = m, b = pick; j > 0; ) {
          const k = j * (B + 1) + b;
          const i = backI[k];
          rows.unshift(list.slice(i, j));
          b = backB[k];
          j = i;
        }
        blockRows[bi] = rows;
      });
      const e = Math.abs(Math.log(total() / fitH!));
      if (e < bestErr) {
        bestErr = e;
        bestRows = blockRows.slice();
      }
      for (let i = 0; i < blockRows.length; i++) blockRows[i] = bestRows[i];
    }

    // 2) polish: move single images between neighbouring rows
    const okRow = (r: MoodboardItem[]) => {
      const h = heightAt(r, W);
      const t = (bestT * r.reduce((x, it) => x + Math.min(sc(it), FEATURE) * ar(it), 0)) / sumAr(r);
      return r.length > 0 && h > t * 0.5 && h < t * 2;
    };
    const err = () => Math.abs(Math.log(total() / fitH!));
    let cur = err();
    for (let iter = 0; iter < 120 && cur > 0.004; iter++) {
      let bestMove: { bi: number; rows: MoodboardItem[][]; e: number } | null = null;
      blockRows.forEach((rows, bi) => {
        if (!rows) return;
        const tryRows = (next: MoodboardItem[][]) => {
          if (!next.every(okRow)) return;
          const saved = blockRows[bi];
          blockRows[bi] = next;
          const e = err();
          blockRows[bi] = saved;
          if (e < cur - 1e-4 && (!bestMove || e < bestMove.e)) bestMove = { bi, rows: next, e };
        };
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          if (r + 1 < rows.length) {
            const nxt = rows[r + 1];
            if (row.length > 1) tryRows([...rows.slice(0, r), row.slice(0, -1), [row[row.length - 1], ...nxt], ...rows.slice(r + 2)]);
            if (nxt.length > 1) tryRows([...rows.slice(0, r), [...row, nxt[0]], nxt.slice(1), ...rows.slice(r + 2)]);
            tryRows([...rows.slice(0, r), [...row, ...nxt], ...rows.slice(r + 2)]);
          }
          for (let cut = 1; cut < row.length; cut++) tryRows([...rows.slice(0, r), row.slice(0, cut), row.slice(cut), ...rows.slice(r + 1)]);
        }
      });
      if (!bestMove) break;
      const m = bestMove as { bi: number; rows: MoodboardItem[][]; e: number };
      blockRows[m.bi] = m.rows;
      cur = m.e;
    }
  }

  live.forEach((blk, bi) => {
    if (bi > 0) y += G;
    if (blk.kind === "rows") {
      y = placeRows(blockRows[bi]!, 0, W, y);
      return;
    }
    const { F, side } = blk;
    if (!side.length) {
      // nothing can sit beside it (the board's only images are features)
      y = placeRows(buildRows([F], W, true), 0, W, y);
      return;
    }
    const rowsEst = buildRows(side, W - G - ar(F) * baseH * sc(F));
    const { H, wf, ws } = solve(F, rowsEst);
    const left = featureNo++ % 2 === 0;
    boxes.push({ id: F.id, x: left ? 0 : W - wf, y, w: wf, h: H });
    placeRows(rowsEst, left ? wf + G : 0, ws, y);
    y += H;
  });
  return { boxes, height: y };
}

export type BoardElement = TextElement | MediaElement | LinkElement | DrawingElement | SceneElement | GroupElement | TodoElement | PaletteElement | LocationElement | StickyElement | ColorElement | MoodboardElement;

/** HEX / RGB / HSL / CMYK of a "#rrggbb" color (color swatch card). */
export function colorCodes(hex: string): { hex: string; rgb: string; hsl: string; cmyk: string } {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const [rf, gf, bf] = [r / 255, g / 255, b / 255];
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rf) h = ((gf - bf) / d) % 6;
    else if (max === gf) h = (bf - rf) / d + 2;
    else h = (rf - gf) / d + 4;
    h = Math.round(h * 60 + 360) % 360;
  }
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  const k = 1 - max;
  const cmy = (v: number) => (k >= 1 ? 0 : Math.round(((1 - v - k) / (1 - k)) * 100));
  return {
    hex: hex.toUpperCase(),
    rgb: `${r}, ${g}, ${b}`,
    hsl: `${h}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%`,
    cmyk: `${cmy(rf)}, ${cmy(gf)}, ${cmy(bf)}, ${Math.round(k * 100)}`,
  };
}

export function googleMapsLink(el: LocationElement): string {
  const q = el.lat != null && el.lng != null ? `${el.lat},${el.lng}` : el.address || el.title;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export const GROUP_PAD = 24;
export const GROUP_HEADER = 40;
export const GROUP_CARD_W = 288;
export const GROUP_CARD_H = 132;

/** Expanded groups get their frame recomputed from their members after
 * every change; members of collapsed groups are hidden. */
/** 2026-10-08, Lino: no two scene cards on a board may share a number — a
 * duplicated (or otherwise clashing) card keeps its content but gets the next
 * free number; the older card (lower z) keeps the original. */
function uniqueSceneNumbers(data: BoardData): BoardData {
  const scenes = data.elements.filter((el): el is SceneElement => el.type === "scene");
  const seen = new Set<number>();
  if (scenes.every((sc) => !seen.has(sc.number) && seen.add(sc.number))) return data;
  let next = nextSceneNumber(data.elements);
  const taken = new Set<number>();
  const clashing: SceneElement[] = [];
  for (const sc of [...scenes].sort((a, b) => a.z - b.z)) {
    if (taken.has(sc.number)) clashing.push(sc);
    else taken.add(sc.number);
  }
  // several duplicated at once (e.g. 1 + 2) → new numbers in the same order
  const renumber = new Map<string, number>();
  for (const sc of clashing.sort((a, b) => a.number - b.number || a.z - b.z)) renumber.set(sc.id, next++);
  return { ...data, elements: data.elements.map((el) => (renumber.has(el.id) ? ({ ...el, number: renumber.get(el.id)! } as BoardElement) : el)) };
}

export function normalizeGroups(data: BoardData): BoardData {
  data = uniqueSceneNumbers(data);
  // a thumbnail whose element is gone (or lost its image) no longer counts
  if (data.cover) {
    const coverEl = data.elements.find((el) => el.id === data.cover);
    if (!coverEl || !(coverEl.type === "image" || (coverEl.type === "scene" && coverEl.image_key))) data = { ...data, cover: null };
  }
  if (!data.elements.some((el) => el.type === "group")) return data;
  const byId = new Map(data.elements.map((el) => [el.id, el]));
  let changed = false;
  // members that no longer exist drop out; a group left with < 2 members dissolves
  const dissolved = new Set<string>();
  const elements = data.elements.flatMap((el): BoardElement[] => {
    if (el.type !== "group") return [el];
    const alive = el.children.filter((id) => byId.has(id));
    if (alive.length < 2) {
      dissolved.add(el.id);
      changed = true;
      return [];
    }
    if (alive.length !== el.children.length) {
      changed = true;
      el = { ...el, children: alive };
    }
    if (el.collapsed) return [el];
    const members = (el as GroupElement).children.map((id) => byId.get(id)).filter((m): m is BoardElement => !!m && m.type !== "group");
    const b = boundsOf(members);
    if (!b) return [el];
    const x = b.x - GROUP_PAD;
    const y = b.y - GROUP_PAD - GROUP_HEADER;
    const w = b.w + GROUP_PAD * 2;
    const h = b.h + GROUP_PAD * 2 + GROUP_HEADER;
    if (x === el.x && y === el.y && w === el.w && h === el.h) return [el];
    changed = true;
    return [{ ...el, x, y, w, h }];
  });
  if (!changed) return data;
  const connectors = dissolved.size ? data.connectors.filter((c) => !dissolved.has(c.from) && !dissolved.has(c.to)) : data.connectors;
  return { ...data, elements, connectors };
}

export function hiddenElementIds(elements: BoardElement[]): Map<string, string> {
  const hidden = new Map<string, string>();
  for (const el of elements) if (el.type === "group" && el.collapsed) for (const c of el.children) hidden.set(c, el.id);
  return hidden;
}

export function nextSceneNumber(elements: BoardElement[]): number {
  return elements.reduce((m, el) => (el.type === "scene" ? Math.max(m, el.number) : m), 0) + 1;
}

export interface Connector {
  id: string;
  from: string;
  to: string;
  color?: StrokeColor;
  /** 2026-10-08, Lino: text on the line (e.g. "Übergang", "Rückblende") */
  label?: string;
}

export interface BoardData {
  elements: BoardElement[];
  connectors: Connector[];
  /** 2026-10-08, Lino: id of the image (or scene card with an image) chosen
   * via "Als Thumbnail verwenden" as the idea tile's cover */
  cover?: string | null;
  /** 2026-10-09, Lino: "Szenen" like Apple Freeform — saved views of the
   * board, shown at the bottom; a click flies back to exactly that spot */
  views?: BoardView[];
}

/** a saved view: the board area that was on screen (world coordinates) */
export interface BoardView {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The image URL an element can lend the idea tile as its thumbnail. */
export function coverSrcOf(el: BoardElement | undefined): string | null {
  if (!el) return null;
  if (el.type === "image") return el.src ?? null;
  if (el.type === "scene") return el.image_src ?? null;
  return null;
}

export interface BoardResponse {
  version: number;
  data: BoardData;
  editable?: boolean;
}

export interface BoardUploadTicket {
  key: string;
  kind: "image" | "video" | "audio" | "pdf";
  upload_url: string;
  url: string;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  site_name: string;
  image_key: string | null;
  image_src: string | null;
}

export function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function snap(v: number, enabled = true): number {
  return enabled ? Math.round(v / GRID) * GRID : v;
}

/** Copy without the presigned URLs (the server strips them anyway — this just
 * keeps the request small). */
export function forSave(data: BoardData): BoardData {
  return {
    cover: data.cover ?? null,
    views: data.views ?? [],
    elements: data.elements.map((el) => {
      if (el.type === "moodboard") return { ...el, items: el.items.map(({ src: _src, thumb_src: _t, srcset: _ss, ...it }) => it) } as BoardElement;
      if (!("src" in el) && !("image_src" in el)) return el;
      const copy: Record<string, unknown> = { ...el };
      delete copy.src;
      delete copy.image_src;
      delete copy.thumb_src;
      delete copy.image_thumb_src;
      delete copy.srcset;
      delete copy.image_srcset;
      return copy as unknown as BoardElement;
    }),
    connectors: data.connectors,
  };
}

/** Browsers report "" as the type for some audio/video files (e.g. .m4a on
 * some systems) — fall back to the extension. */
export function guessMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", m4v: "video/x-m4v",
    mp3: "audio/mpeg", m4a: "audio/x-m4a", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", aif: "audio/aiff", aiff: "audio/aiff",
    pdf: "application/pdf",
  };
  return map[ext] ?? "";
}

export function elementKindForMime(mime: string): MediaElement["type"] | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  return null;
}

export function boundsOf(elements: BoardElement[]): { x: number; y: number; w: number; h: number } | null {
  if (elements.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.w);
    maxY = Math.max(maxY, el.y + el.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function formatBytes(n: number | undefined): string {
  if (!n) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function looksLikeUrl(text: string): boolean {
  const t = text.trim();
  if (/\s/.test(t) || t.length > 2000) return false;
  return /^https?:\/\/\S+\.\S+/i.test(t) || /^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(t);
}

/** 2026-10-08, Lino: "Jegliche link-videos soll man per Klick auf dem Board
 * abspielen können" — the embeddable player for a link card's URL (YouTube
 * incl. Shorts, Vimeo, TikTok, Instagram posts/reels, direct video files),
 * or null for ordinary links. `aspect` = width / height of the player. */
export interface VideoEmbed {
  kind: "iframe" | "video";
  src: string;
  aspect: number;
}

export function videoEmbedFor(rawUrl: string): VideoEmbed | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m)\./, "");
  const path = url.pathname;

  if (host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com") {
    const id =
      (host === "youtu.be" ? path.slice(1, 12) : null) ||
      url.searchParams.get("v") ||
      path.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/)?.[1];
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = parseInt(url.searchParams.get("t") ?? "", 10);
    return {
      kind: "iframe",
      src: `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1${start > 0 ? `&start=${start}` : ""}`,
      aspect: path.startsWith("/shorts/") ? 9 / 16 : 16 / 9,
    };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = path.match(/^\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?/);
    if (!m) return null;
    return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}?autoplay=1${m[2] ? `&h=${m[2]}` : ""}`, aspect: 16 / 9 };
  }
  if (host.endsWith("tiktok.com")) {
    const id = path.match(/\/video\/(\d+)/)?.[1];
    if (!id) return null;
    return { kind: "iframe", src: `https://www.tiktok.com/player/v1/${id}?autoplay=1&music_info=1&description=1`, aspect: 9 / 16 };
  }
  if (host === "instagram.com") {
    const m = path.match(/^\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
    if (!m) return null;
    const kind = m[1] === "p" ? "p" : "reel";
    return { kind: "iframe", src: `https://www.instagram.com/${kind}/${m[2]}/embed/`, aspect: kind === "reel" ? 9 / 16 : 4 / 5 };
  }
  if (/\.(mp4|mov|webm|m4v)$/i.test(path)) {
    return { kind: "video", src: url.toString(), aspect: 16 / 9 };
  }
  return null;
}

/** start a browser download from a presigned attachment URL */
export function startDownload(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** 2026-10-08 (Lino: "warum laden Bilder so langsam?") — <img> sources that
 * let the browser pick the small version (≤1000 px) at normal zoom and the
 * big web version only when the image is shown large. `cssWidth` is the
 * size it's drawn at (board px × zoom bucket); the browser adds the screen's
 * pixel density itself. */
export function imageSources(src: string | null | undefined, thumb: string | null | undefined, aspect: number, cssWidth: number, srcset?: string | null) {
  if (!src) return { src: thumb ?? undefined };
  // the server knows every size and its real pixel width (thumb/mid/full)
  if (srcset) return { src: thumb ?? src, srcSet: srcset, sizes: `${Math.max(40, Math.round(cssWidth))}px` };
  if (!thumb) return { src };
  const ar = aspect > 0 ? aspect : 1;
  const tw = Math.round(ar >= 1 ? 1000 : 1000 * ar);
  const ww = Math.round(ar >= 1 ? 2400 : 2400 * ar);
  return { src: thumb, srcSet: `${thumb} ${tw}w, ${src} ${ww}w`, sizes: `${Math.max(40, Math.round(cssWidth))}px` };
}


// ── moodboard mosaic, layout 4 (2026-10-09) ─────────────────────────────
// Lino: "man zieht eines gross, aber dann wird nicht das Bild gross, welches
// man grosszieht, sondern das Bild daneben … muss zu 100 % funktionieren,
// smooth und logisch". The previous layout re-fitted every row to the card's
// height on every change, so a tiny size change reshuffled everything (a
// simulation of his board: 91 of 96 drags enlarged the wrong image).
//
// Now every image has a size LEVEL: 1 = normal, 2/3/4 = it spans that many
// rows. The row height `row_h` is fixed per card (chosen only when the card
// itself is resized at its corner). Normal images sit in justified rows
// (optimal breaks, every row close to row_h); an image of level L sits on one
// side of a block and the following images stack in exactly L rows beside it
// (exact block height, see `solve`). Changing one image's level therefore
// only changes that image's block; nobody else gets bigger, and the card's
// height simply follows the content. No holes, no distortion.

export const MB_PAD = 10;
export const MB_GAP = 6;
export const MB_HEADER = 26; // header row (20) + its margin (6)
export const MB_MAX_LEVEL = 4;
/** content box of a moodboard card of the given size (1 px border each side) */
export const mbInnerW = (w: number) => Math.max(60, w - MB_PAD * 2 - 2);
export const mbInnerH = (h: number) => Math.max(40, h - MB_PAD * 2 - 2 - MB_HEADER);
export const mbCardH = (contentH: number) => Math.round(contentH + MB_PAD * 2 + 2 + MB_HEADER);

/** an image's size level (older cards stored a free size factor) */
export function mbLevel(it: MoodboardItem): number {
  const s = it.s ?? 1;
  return s >= 1.5 ? Math.min(MB_MAX_LEVEL, Math.round(s)) : 1;
}

export function layoutMosaic(items: MoodboardItem[], width: number, rowH: number, gap = MB_GAP): { boxes: MoodboardBox[]; height: number; dev: number } {
  const W = Math.max(40, width);
  const G = gap;
  const R = Math.max(8, rowH);
  const ar = (it: MoodboardItem) => Math.max(0.1, Math.min(10, it.ar || 1));
  const MAX_PER_ROW = 14;
  const MAX_BORROW = 12;
  const MAX_SIDE = 30;

  /** row helpers on a list with prefix sums of the aspect ratios */
  const prep = (list: MoodboardItem[]) => {
    const P = [0];
    for (const it of list) P.push(P[P.length - 1] + ar(it));
    const h = (i: number, j: number, w: number) => (w - G * (j - i - 1)) / (P[j] - P[i]);
    const cost = (i: number, j: number, w: number) => {
      const hh = h(i, j, w);
      return hh <= 0 ? Infinity : (j - i) * Math.log(hh / R) ** 2;
    };
    return { P, h, cost };
  };

  /** optimal row breaks (any number of rows), every row as close to R as possible */
  const rowsFree = (list: MoodboardItem[], w: number): { rows: MoodboardItem[][]; cost: number } => {
    const n = list.length;
    if (!n) return { rows: [], cost: 0 };
    const { cost } = prep(list);
    const best = new Array<number>(n + 1).fill(Infinity);
    const from = new Array<number>(n + 1).fill(0);
    best[0] = 0;
    for (let j = 1; j <= n; j++)
      for (let i = j - 1; i >= 0 && j - i <= MAX_PER_ROW; i--) {
        const c = best[i] + cost(i, j, w);
        if (c < best[j]) {
          best[j] = c;
          from[j] = i;
        }
      }
    const rows: MoodboardItem[][] = [];
    for (let j = n; j > 0; j = from[j]) rows.unshift(list.slice(from[j], j));
    return { rows, cost: best[n] };
  };

  /** exactly k rows (contiguous) with the smallest deviation, or null */
  const rowsExact = (list: MoodboardItem[], w: number, k: number): { rows: MoodboardItem[][]; cost: number } | null => {
    const n = list.length;
    if (n < k) return null;
    const { cost } = prep(list);
    const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(Infinity));
    const from = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
    best[0][0] = 0;
    for (let r = 1; r <= k; r++)
      for (let j = r; j <= n; j++)
        for (let i = j - 1; i >= r - 1 && j - i <= MAX_PER_ROW; i--) {
          if (best[r - 1][i] === Infinity) continue;
          const c = best[r - 1][i] + cost(i, j, w);
          if (c < best[r][j]) {
            best[r][j] = c;
            from[r][j] = i;
          }
        }
    if (best[k][n] === Infinity) return null;
    const rows: MoodboardItem[][] = [];
    for (let r = k, j = n; r > 0; r--) {
      const i = from[r][j];
      rows.unshift(list.slice(i, j));
      j = i;
    }
    return { rows, cost: best[k][n] };
  };

  const sumAr = (row: MoodboardItem[]) => row.reduce((t, it) => t + ar(it), 0);
  const rowHeight = (row: MoodboardItem[], w: number) => (w - G * (row.length - 1)) / sumAr(row);

  /** features Fs (one, or a pair left + right) beside `rows`: one exact
   *  height H for all (side rows at width ws are a·ws + c tall; the features
   *  are ΣarF·H wide) */
  const solve = (Fs: MoodboardItem[], rows: MoodboardItem[][]) => {
    const arF = Fs.reduce((t, f) => t + ar(f), 0);
    const room = W - G * Fs.length;
    const a = rows.reduce((t, r) => t + 1 / sumAr(r), 0);
    const c = G * (rows.length - 1) - G * rows.reduce((t, r) => t + (r.length - 1) / sumAr(r), 0);
    const H = (a * room + c) / (1 + a * arF);
    return { H, wf: arF * H, ws: room - arF * H };
  };

  /** Fs at level L beside `list` (all of it, in rows close to R), or null */
  const side = (Fs: MoodboardItem[], L: number, list: MoodboardItem[]) => {
    const T = L * R + (L - 1) * G;
    const ws0 = W - G * Fs.length - Fs.reduce((t, f) => t + ar(f), 0) * T;
    if (ws0 < W * 0.15) return null; // F alone would be (almost) as wide as the card
    let ex = rowsFree(list, ws0);
    let sol = solve(Fs, ex.rows);
    if (sol.ws > 0) {
      const again = rowsFree(list, sol.ws);
      const sol2 = solve(Fs, again.rows);
      if (sol2.ws > 0) {
        ex = again;
        sol = sol2;
      }
    }
    // a big image must visibly span several rows
    if (ex.rows.length < 2) return null;
    if (sol.H <= 0 || sol.ws < W * 0.15 || sol.wf < W * 0.15 * Fs.length) return null;
    for (const r of ex.rows) {
      const h = rowHeight(r, sol.ws);
      if (h < R * 0.5 || h > R * 1.8) return null;
    }
    const err = Math.log(sol.H / T);
    if (Math.abs(err) > Math.log(1.6)) return null;
    // the side rows' own deviation + how far the feature is from its size
    return { rows: ex.rows, ...sol, cost: ex.cost + (list.length + 1) * err * err * 3 };
  };

  type Block = { kind: "rows"; rows: MoodboardItem[][] } | { kind: "feature"; Fs: MoodboardItem[]; rows: MoodboardItem[][]; H: number; ws: number; left: boolean; T: number };
  const index = new Map(items.map((it, i) => [it.id, i]));
  // a big image that finds no room at all is treated as a normal one, and
  // the layout is built again so its neighbours take it into their rows
  const demoted = new Set<string>();
  const levelOf = (it: MoodboardItem) => (demoted.has(it.id) ? 1 : mbLevel(it));
  const build = (): Block[] | string => {
  const blocks: Block[] = [];
  let run: MoodboardItem[] = [];
  const flush = () => {
    if (run.length) blocks.push({ kind: "rows", rows: rowsFree(run, W).rows });
    run = [];
  };
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    const level = levelOf(it);
    if (level === 1) {
      run.push(it);
      i++;
      continue;
    }
    // choose how many images go beside it — a few from just before it may
    // join (b), the rest come after it (k) — so that the whole stretch looks
    // best: the feature close to its size AND the rows left before and after
    // it close to the normal row height (no lonely leftover image that would
    // get a whole row to itself)
    type Choice = { L: number; b: number; k: number; s: NonNullable<ReturnType<typeof side>>; total: number };
    const choose = (Fs: MoodboardItem[], wantL: number): Choice | null => {
      const pool: MoodboardItem[] = [];
      for (let j = i + Fs.length; j < items.length && levelOf(items[j]) === 1 && pool.length < 40; j++) pool.push(items[j]);
      let best = null as Choice | null;
      const headCost = new Map<number, number>();
      for (let L = wantL; L >= 2; L--) {
        for (let b = 0; b <= Math.min(run.length, MAX_BORROW); b++) {
          if (!headCost.has(b)) headCost.set(b, rowsFree(run.slice(0, run.length - b), W).cost);
          if (b === 0) {
            // too wide to have images beside it: alone across the full width
            const T = L * R + (L - 1) * G;
            const H = (W - G * (Fs.length - 1)) / Fs.reduce((t, f) => t + ar(f), 0);
            const err = Math.log(H / T);
            if (W - G * Fs.length - Fs.reduce((t, f) => t + ar(f), 0) * T < W * 0.15 && Math.abs(err) < Math.log(1.6) && H > R * 1.3) {
              const total = headCost.get(0)! + 3 * err * err + rowsFree(pool, W).cost + (wantL - L) * 4;
              if (!best || total < best.total) best = { L, b: 0, k: 0, s: { rows: [], H, wf: W, ws: 0, cost: 3 * err * err }, total };
            }
          }
          for (let k = 0; k + b <= MAX_SIDE && k <= pool.length; k++) {
            if (k + b < L) continue;
            const sd = side(Fs, L, [...run.slice(run.length - b), ...pool.slice(0, k)]);
            if (!sd) continue;
            const total = headCost.get(b)! + sd.cost + rowsFree(pool.slice(k), W).cost + (wantL - L) * 4;
            if (!best || total < best.total) best = { L, b, k, s: sd, total };
          }
        }
        if (best) break; // the wanted level works: don't settle for less
      }
      return best;
    };
    // two big images in a row: a pair, left and right, the images after them
    // stack in the middle (each alone would fight over the same images)
    let Fs = [it];
    let best: Choice | null = null;
    if (i + 1 < items.length && levelOf(items[i + 1]) > 1) {
      Fs = [it, items[i + 1]];
      best = choose(Fs, Math.max(level, levelOf(items[i + 1])));
      if (!best) Fs = [it];
    }
    if (!best) best = choose(Fs, level);
    if (!best) return it.id;
    run.splice(run.length - best.b, best.b);
    flush();
    blocks.push({ kind: "feature", Fs, rows: best.s.rows, H: best.s.H, ws: best.s.ws, left: it.side ? it.side === "l" : (index.get(it.id) ?? 0) % 2 === 0, T: best.L * R + (best.L - 1) * G });
    i += Fs.length + best.k;
  }
  flush();
  return blocks;
  };
  let blocks: Block[] = [];
  for (let pass = 0; pass <= items.length; pass++) {
    const r = build();
    if (typeof r !== "string") {
      blocks = r;
      break;
    }
    demoted.add(r);
  }

  const boxes: MoodboardBox[] = [];
  let y = 0;
  // how far the images are from their intended size (for fitting a card)
  let devSum = 0;
  const placeRows = (rows: MoodboardItem[][], x0: number, w: number, y0: number) => {
    let yy = y0;
    rows.forEach((row, ri) => {
      const h = rowHeight(row, w);
      devSum += row.length * Math.log(h / R) ** 2;
      let x = x0;
      for (const it of row) {
        const bw = ar(it) * h;
        boxes.push({ id: it.id, x, y: yy, w: bw, h });
        x += bw + G;
      }
      yy += h + (ri < rows.length - 1 ? G : 0);
    });
    return yy;
  };
  blocks.forEach((blk, bi) => {
    if (bi > 0) y += G;
    if (blk.kind === "rows") {
      y = placeRows(blk.rows, 0, W, y);
      return;
    }
    devSum += blk.Fs.length * Math.log(blk.H / blk.T) ** 2;
    if (!blk.rows.length) {
      // alone across the full width (a pair: side by side)
      let x = 0;
      for (const F of blk.Fs) {
        const w = ar(F) * blk.H;
        boxes.push({ id: F.id, x, y, w, h: blk.H });
        x += w + G;
      }
    } else if (blk.Fs.length === 2) {
      // pair: first on the left, second on the right, the rows in between
      const [A, B] = blk.Fs;
      const wa = ar(A) * blk.H;
      const wb = ar(B) * blk.H;
      boxes.push({ id: A.id, x: 0, y, w: wa, h: blk.H });
      boxes.push({ id: B.id, x: W - wb, y, w: wb, h: blk.H });
      placeRows(blk.rows, wa + G, blk.ws, y);
    } else {
      const F = blk.Fs[0];
      const wf = ar(F) * blk.H;
      boxes.push({ id: F.id, x: blk.left ? 0 : W - wf, y, w: wf, h: blk.H });
      placeRows(blk.rows, blk.left ? wf + G : 0, blk.ws, y);
    }
    y += blk.H;
  });
  return { boxes, height: y, dev: items.length ? devSum / items.length : 0 };
}

/** the row height at which the mosaic fills a card of this content size best */
export function fitMosaicRowH(items: MoodboardItem[], width: number, height: number, gap = MB_GAP): number {
  const W = Math.max(40, width);
  const H = Math.max(40, height);
  if (!items.length) return W / 3;
  // close to the card's height, but only with sensible rows (14 tiny images
  // in a row and 2 huge ones below would match a height too); the card then
  // snaps to the exact content height
  const err = (R: number) => {
    const l = layoutMosaic(items, W, R, gap);
    return 3 * Math.log(l.height / H) ** 2 + l.dev;
  };
  const lo = Math.log(Math.max(12, W / 24));
  const hi = Math.log(Math.max(W, H) * 1.2);
  let bestR = Math.exp(lo);
  let bestE = Infinity;
  const N = 80;
  for (let k = 0; k <= N; k++) {
    const R = Math.exp(lo + ((hi - lo) * k) / N);
    const e = err(R);
    if (e < bestE) {
      bestE = e;
      bestR = R;
    }
  }
  const step = (hi - lo) / N;
  for (let k = -10; k <= 10; k++) {
    const R = bestR * Math.exp((step * k) / 10);
    const e = err(R);
    if (e < bestE) {
      bestE = e;
      bestR = R;
    }
  }
  return bestR;
}

/** boxes for display: the mosaic at the card's row height, stretched to the
 * card's height (normally 1:1 — the card follows its content) */
export function mosaicBoxes(items: MoodboardItem[], width: number, height: number, rowH: number, gap = MB_GAP): { boxes: MoodboardBox[]; height: number; natural: number } {
  const layout = layoutMosaic(items, width, rowH, gap);
  const k = layout.height > 0 ? Math.max(40, height) / layout.height : 1;
  return { boxes: layout.boxes.map((b) => ({ ...b, y: b.y * k, h: b.h * k })), height: Math.max(40, height), natural: layout.height };
}

/** a moodboard card with new items: same row height, height follows content */
export function moodboardWith(el: MoodboardElement, items: MoodboardItem[]): MoodboardElement {
  const rowH = el.row_h ?? fitMosaicRowH(moodboardItems(el), mbInnerW(el.w), mbInnerH(el.h));
  const natural = items.length ? layoutMosaic(items, mbInnerW(el.w), rowH).height : mbInnerH(el.h);
  return { ...el, items, layout: 4, row_h: Math.round(rowH * 100) / 100, h: items.length ? mbCardH(natural) : el.h };
}
