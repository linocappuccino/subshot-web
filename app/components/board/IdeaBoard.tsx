"use client";

import { PRIORITY_COLORS, type Priority } from "@/lib/types";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  GRID,
  STROKE_COLORS,
  STROKE_WIDTHS,
  TEXT_COLORS,
  TEXT_COLOR_STYLES,
  GROUP_CARD_H,
  GROUP_CARD_W,
  boundsOf,
  elementKindForMime,
  hiddenElementIds,
  normalizeGroups,
  guessMime,
  looksLikeUrl,
  newId,
  nextSceneNumber,
  snap,
  type BoardData,
  type BoardElement,
  type BoardView,
  type Connector,
  type DrawingElement,
  type GroupElement,
  type LinkElement,
  type LinkPreview,
  type MediaElement,
  type SceneElement,
  type StrokeColor,
  type TextColor,
  type TextAlign,
  type TextElement,
  type PaletteElement,
  type LocationElement,
  type StickyElement,
  type StickyColor,
  type BoardVote,
  type MoodboardElement,
  type MoodboardItem,
  moodboardItems,
  moodboardWith,
  fitMosaicRowH,
  mbInnerW,
  mbInnerH,
  mbCardH,
  layoutMosaic,
  tagColor,
  type ColorElement,
  STICKY_COLORS,
  STICKY_STYLES,
  type TodoElement,
  type PlaceholderElement,
  type BoardTemplate,
  MEDIA_SLOTS,
} from "@/lib/board";
import { BoardElementView, VIDEO_HEADER, boardHtmlToPlain, sanitizeBoardHtml, strokePath } from "./BoardElementView";
import { BoardTodoContext } from "./BoardTodo";
import { ImageGeneratePopup } from "../ImageGeneratePopup";
import { ColorEditor, LocationEditor, PaletteEditor } from "./BoardCardEditors";
import { BoardScenesBar } from "./BoardScenes";
import { BoardQuickAdd, type QuickAddItem } from "./BoardQuickAdd";
import { BoardPresentation } from "./BoardPresentation";
import { BoardMinimap, BoardSearchPanel, TagEditor, elementSearchText } from "./BoardNavigator";
import { BoardGifMaker, type BoardGifApi } from "./BoardGifMaker";
import { BoardTemplatesPanel, type BoardTemplateApi } from "./BoardTemplates";
import { BoardDownloadContext, BoardZoomContext, BoardScaleContext, DownloadButton } from "./BoardDownload";

/** 2026-10-08, Lino — Milanote-style idea board: a dotted, zoomable canvas
 * with text boxes, uploaded images/videos/audio/PDFs, link bookmarks,
 * freehand drawing and connectors. Everything snaps to the dot grid (hold
 * Alt/Option to place freely). The mouse wheel / trackpad pinch zooms around
 * the pointer, two fingers pinch-zoom on touch; dragging the empty canvas
 * pans, Shift-drag draws a selection rectangle.
 *
 * Pure UI: the parent (IdeaFocusView) loads/saves the document and provides
 * the upload + link-preview functions. `editable=false` is the read-only
 * viewer (team members without edit rights, the public client preview). */

type Tool = "select" | "draw" | "hand";
interface View {
  x: number;
  y: number;
  scale: number;
}
interface Pending {
  id: string;
  label: string;
  progress: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
}
type Point = { x: number; y: number };

export type BoardUploadFn = (file: File, mime: string, onProgress: (fraction: number) => void) => Promise<{ key: string; src: string }>;
export type BoardLinkPreviewFn = (url: string) => Promise<LinkPreview>;
/** 2026-10-08, Lino: Feedback-Pins — a comment pinned to a spot on a node */
export type BoardPin = { id: string; elementId: string; x: number; y: number; color: string; label: string; resolved?: boolean; active?: boolean; title?: string };
export type BoardPinAnchor = { elementId: string; x: number; y: number };
/** 2026-10-08 — live collaboration: another person on the board */
export type BoardPeer = { clientId: number; name: string; color: string; cursor: { x: number; y: number } | null; selection: string[] };
export type BoardLocationMapFn = (lat: number, lng: number, style: "satellite" | "map") => Promise<{ key: string; src: string; style?: "satellite" | "map" }>;
export type BoardPaletteFn = (key: string) => Promise<string[]>;
export type BoardImageStyle = "realistic" | "sketch" | "funny_sketch";
export type BoardGenerateImageFn = (prompt: string, style: BoardImageStyle, aspectRatio: "16:9" | "9:16") => Promise<{ key: string; src: string }>;

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const HISTORY_LIMIT = 100;
const DOUBLE_CLICK_MS = 350;

type Op =
  | { kind: "pan"; pointerId: number; sx: number; sy: number; view: View; moved: boolean; onElement: string | null; rightClick?: boolean; middle?: boolean }
  | {
      kind: "move";
      pointerId: number;
      sx: number;
      sy: number;
      ids: string[];
      origin: Map<string, Point>;
      primary: string;
      moved: boolean;
      snapshot: BoardData;
      clickedId: string;
      onGroupTitle: boolean;
      /** the clicked element was already the only selected one when pressed */
      wasSelected: boolean;
      /** smart guides: the moving set's bounds at the start + what it can align to */
      box: Rect;
      others: Rect[];
    }
  | { kind: "resize"; pointerId: number; id: string; sx: number; sy: number; w: number; h: number; aspect: number | null; header: number; snapshot: BoardData }
  | { kind: "connect"; pointerId: number; from: string; target: string | null }
  | { kind: "draw"; pointerId: number; points: [number, number][] }
  | { kind: "marquee"; pointerId: number; sx: number; sy: number; x0: number; y0: number; base: Set<string>; moved: boolean }
  | { kind: "pinch"; dist: number; center: Point; view: View };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function maxZ(elements: BoardElement[]) {
  return elements.reduce((m, el) => Math.max(m, el.z), 0);
}

// ── connector geometry (2026-10-08, Lino: smooth curved lines, no arrow,
// attached to the middle of the sides that face each other) ──────────────
type Rect = { x: number; y: number; w: number; h: number };
type Side = "left" | "right" | "top" | "bottom";
const SIDE_DIR: Record<Side, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
const CONNECT_SNAP_PX = 56;

function anchorOf(r: Rect, side: Side): Point {
  if (side === "left") return { x: r.x, y: r.y + r.h / 2 };
  if (side === "right") return { x: r.x + r.w, y: r.y + r.h / 2 };
  if (side === "top") return { x: r.x + r.w / 2, y: r.y };
  return { x: r.x + r.w / 2, y: r.y + r.h };
}

/** The pair of sides two boxes should be connected at: left/right when
 * they're further apart horizontally than vertically, otherwise top/bottom. */
function facingSides(a: Rect, b: Rect): [Side, Side] {
  const gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (gapX >= gapY) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

/** Cubic curve leaving p1 straight out of side s1 and arriving at p2
 * straight into side s2 (or just ending at p2 for a free end). */
function curveGeom(p1: Point, s1: Side, p2: Point, s2: Side | null): { d: string; mid: Point } {
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const off = Math.max(36, Math.min(180, dist * 0.45));
  const c1 = { x: p1.x + SIDE_DIR[s1][0] * off, y: p1.y + SIDE_DIR[s1][1] * off };
  const c2 = s2 ? { x: p2.x + SIDE_DIR[s2][0] * off, y: p2.y + SIDE_DIR[s2][1] * off } : p2;
  return {
    d: `M ${p1.x} ${p1.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`,
    // the curve's own midpoint (t = 0.5) — where a connector's label sits
    mid: { x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8, y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8 },
  };
}

function curvePath(p1: Point, s1: Side, p2: Point, s2: Side | null): string {
  return curveGeom(p1, s1, p2, s2).d;
}

const GUIDE_SNAP_PX = 6;
type GuideLine = { x1: number; y1: number; x2: number; y2: number };

/** Smart guides: aligns the moving box (its left/center/right and
 * top/middle/bottom) to the nearest matching line of another node within
 * `reach`; returns the corrected offset and the guide lines to draw. */
function smartGuides(box: Rect, ddx: number, ddy: number, others: Rect[], reach: number): { ddx: number; ddy: number; lines: GuideLine[] } {
  const bx = box.x + ddx;
  const by = box.y + ddy;
  const mx = [bx, bx + box.w / 2, bx + box.w];
  const my = [by, by + box.h / 2, by + box.h];
  let bestX: { d: number; adj: number } | null = null;
  let bestY: { d: number; adj: number } | null = null;
  for (const o of others) {
    const ox = [o.x, o.x + o.w / 2, o.x + o.w];
    const oy = [o.y, o.y + o.h / 2, o.y + o.h];
    for (const a of mx) for (const b of ox) {
      const d = Math.abs(a - b);
      if (d <= reach && (!bestX || d < bestX.d)) bestX = { d, adj: b - a };
    }
    for (const a of my) for (const b of oy) {
      const d = Math.abs(a - b);
      if (d <= reach && (!bestY || d < bestY.d)) bestY = { d, adj: b - a };
    }
  }
  const fx = ddx + (bestX?.adj ?? 0);
  const fy = ddy + (bestY?.adj ?? 0);
  const fb = { x: box.x + fx, y: box.y + fy, w: box.w, h: box.h };
  const lines: GuideLine[] = [];
  // one line per aligned position, spanning the box and every node on it
  if (bestX) {
    for (const a of [fb.x, fb.x + fb.w / 2, fb.x + fb.w]) {
      const hits = others.filter((o) => [o.x, o.x + o.w / 2, o.x + o.w].some((b) => Math.abs(a - b) < 0.5));
      if (!hits.length) continue;
      lines.push({ x1: a, x2: a, y1: Math.min(fb.y, ...hits.map((o) => o.y)), y2: Math.max(fb.y + fb.h, ...hits.map((o) => o.y + o.h)) });
    }
  }
  if (bestY) {
    for (const a of [fb.y, fb.y + fb.h / 2, fb.y + fb.h]) {
      const hits = others.filter((o) => [o.y, o.y + o.h / 2, o.y + o.h].some((b) => Math.abs(a - b) < 0.5));
      if (!hits.length) continue;
      lines.push({ y1: a, y2: a, x1: Math.min(fb.x, ...hits.map((o) => o.x)), x2: Math.max(fb.x + fb.w, ...hits.map((o) => o.x + o.w)) });
    }
  }
  return { ddx: fx, ddy: fy, lines };
}

function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.w));
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** First spot at or below/right of (x, y) where a w×h box doesn't overlap any
 * existing element or reserved box — so things added from the toolbar or by
 * pasting don't land on top of what's already in the middle of the screen. */
function clampInto(x: number, y: number, w: number, h: number, b: Rect): Point {
  return {
    x: w >= b.w ? b.x : Math.min(Math.max(x, b.x), b.x + b.w - w),
    y: h >= b.h ? b.y : Math.min(Math.max(y, b.y), b.y + b.h - h),
  };
}

/** 2026-10-08, Lino: things added from the toolbar, menu or by pasting must
 * land in view. Searches outward from (x, y) — first for a spot that doesn't
 * overlap anything, only ever inside `bounds` (the visible part of the
 * board); if the view is full, the spot is just clamped into view. */
function freeSpot(
  x: number,
  y: number,
  w: number,
  h: number,
  taken: Rect[],
  bounds: Rect,
  avoidOverlap = true,
): Point {
  const start = clampInto(x, y, w, h, bounds);
  const fits = (px: number, py: number) => px >= bounds.x - 0.5 && py >= bounds.y - 0.5 && px + w <= bounds.x + bounds.w + 0.5 && py + h <= bounds.y + bounds.h + 0.5;
  const hits = (px: number, py: number) =>
    taken.some((r) => px < r.x + r.w + GRID / 2 && px + w + GRID / 2 > r.x && py < r.y + r.h + GRID / 2 && py + h + GRID / 2 > r.y);
  const snapIn = (px: number, py: number) => {
    // snap to the grid, but never off the visible area because of it
    const c = clampInto(snap(px), snap(py), w, h, bounds);
    return { x: fits(snap(px), snap(py)) ? snap(px) : c.x, y: fits(snap(px), snap(py)) ? snap(py) : c.y };
  };
  if (!avoidOverlap) return snapIn(start.x, start.y);
  const s0 = snap(start.x);
  const t0 = snap(start.y);
  if (fits(s0, t0) && !hits(s0, t0)) return { x: s0, y: t0 };
  // every grid position in view where the box fits, nearest to the wish first
  // (coarser grid when zoomed far out, so this stays a few thousand checks)
  const step = Math.max(GRID, snap(Math.max(bounds.w, bounds.h) / 80) || GRID);
  const candidates: Point[] = [];
  for (let cy = Math.ceil(bounds.y / step) * step; cy + h <= bounds.y + bounds.h; cy += step) {
    for (let cx = Math.ceil(bounds.x / step) * step; cx + w <= bounds.x + bounds.w; cx += step) candidates.push({ x: cx, y: cy });
  }
  candidates.sort((p, q) => Math.hypot(p.x - start.x, p.y - start.y) - Math.hypot(q.x - start.x, q.y - start.y));
  for (const c of candidates) if (!hits(c.x, c.y)) return c;
  // view is full: the spot covering the least of what's already there
  const overlapArea = (px: number, py: number) =>
    taken.reduce((sum, r) => sum + Math.max(0, Math.min(px + w, r.x + r.w) - Math.max(px, r.x)) * Math.max(0, Math.min(py + h, r.y + r.h) - Math.max(py, r.y)), 0);
  let best: Point | null = null;
  let bestArea = Infinity;
  for (const c of candidates) {
    const area = overlapArea(c.x, c.y);
    if (area < bestArea - 1) {
      best = c;
      bestArea = area;
    }
  }
  return best ?? snapIn(start.x, start.y);
}

export function IdeaBoard({
  initial,
  editable,
  onChange,
  uploadFile,
  fetchLinkPreview,
  generateImage,
  createLocationMap,
  extractPalette,
  pins,
  onPinClick,
  pinPlacing = false,
  onPlacePin,
  pendingPin,
  focusRequest,
  votes,
  myVoterKey,
  onVote,
  gifMaker,
  clipboard,
  templates,
  allowPresentation = true,
  externalData,
  historyApi,
  peers,
  onPresence,
  downloadFile,
  onError,
  onNotice,
  onEscape,
  className = "",
}: {
  initial: BoardData;
  editable: boolean;
  onChange?: (data: BoardData) => void;
  uploadFile?: BoardUploadFn;
  fetchLinkPreview?: BoardLinkPreviewFn;
  /** scene cards' "AI generieren" — same popup/engine as the shot list */
  generateImage?: BoardGenerateImageFn;
  /** location card: renders + stores the static map for picked coordinates */
  createLocationMap?: BoardLocationMapFn;
  /** palette card from an image: the image's dominant colors */
  extractPalette?: BoardPaletteFn;
  /** feedback pins shown on their nodes (team board and client preview) */
  pins?: BoardPin[];
  onPinClick?: (id: string) => void;
  /** pin mode: the next click on a node places a pin there (works read-only) */
  pinPlacing?: boolean;
  onPlacePin?: (anchor: BoardPinAnchor) => void;
  /** the pin being composed, before it's saved */
  pendingPin?: (BoardPinAnchor & { color?: string }) | null;
  /** zoom to a node (e.g. clicking a pinned comment in the sidebar) */
  focusRequest?: { elementId: string; nonce: number } | null;
  /** 👍🏼 on the variants of vote groups (see GroupElement.vote) */
  votes?: BoardVote[];
  /** whose vote is "mine" (highlighted) — "user:<id>" or "name:<name>" */
  myVoterKey?: string | null;
  onVote?: (groupId: string, elementId: string) => void;
  /** GIF maker (video link/upload → ≤3 s GIF image on the board) */
  gifMaker?: BoardGifApi;
  /** presentation mode button (2026-10-09, Lino: not on the client page) */
  allowPresentation?: boolean;
  /** 2026-10-09, Lino: ⌘C / ⌘V of nodes between boards — this board's idea,
   * and the server copy of another board's files / to-do lists */
  clipboard?: {
    ideaId: string;
    importFrom: (sourceIdeaId: string, keys: string[], todoLists: string[]) => Promise<{ keys: Record<string, { key: string; src: string }>; todo_lists: Record<string, string> }>;
  };
  /** 2026-10-09, Lino: board templates — save the board / selection, load a
   * saved one (`use` creates its to-do lists and returns the document) */
  templates?: BoardTemplateApi & { use: (templateId: string) => Promise<BoardData> };
  /** live collaboration: the board as changed by someone else (or by a
   * live undo) — taken over as is, without notifying onChange */
  externalData?: { data: BoardData; nonce: number } | null;
  /** live collaboration: undo/redo of only MY changes (Y.UndoManager) */
  historyApi?: { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean };
  /** live collaboration: the others' cursors and selections */
  peers?: BoardPeer[];
  /** live collaboration: my pointer (board coordinates) and selection */
  onPresence?: (p: { cursor?: { x: number; y: number } | null; selection?: string[] }) => void;
  /** download the ORIGINAL of a board file (key + original file name) */
  downloadFile?: (key: string, name: string) => void;
  onError?: (message: string) => void;
  /** a short success message (toast) */
  onNotice?: (message: string) => void;
  /** Escape pressed with nothing left to cancel on the board itself */
  onEscape?: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<BoardData>(() => normalizeGroups(initial));
  const dataRef = useRef(data);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  // 2026-10-08 (Lino, iPad: "immer noch super unscharf und verpixelt"):
  // WebKit on Apple devices paints a composited layer at device resolution
  // and IGNORES CSS scale transforms (GraphicsLayerCA::updateRootRelativeScale
  // is disabled), so a board zoomed with transform: scale(4) is a 4× blown-up
  // bitmap — images and text alike. The board is therefore zoomed with CSS
  // `zoom` (real layout → painted at full resolution). While a zoom gesture is
  // running, a cheap transform covers the difference; ~150 ms after it stops
  // the layout zoom catches up and everything is repainted sharp.
  // Only for zooming IN: below 100 % WebKit's minimum font size (9 px) would
  // blow text up inside a `zoom`ed layout (Lino: "warum skaliert jetzt die
  // Schrift mit?!") — and shrinking with a transform is sharp anyway.
  const [settledScale, setSettledScale] = useState(1);
  const targetZoom = Math.max(1, view.scale);
  useEffect(() => {
    if (targetZoom === settledScale) return;
    const t = window.setTimeout(() => setSettledScale(targetZoom), 150);
    return () => window.clearTimeout(t);
  }, [targetZoom, settledScale]);
  const viewScaleRef = useRef(view.scale);
  viewScaleRef.current = view.scale;
  const viewRef = useRef(view);
  viewRef.current = view;
  const [tool, setTool] = useState<Tool>("select");
  const [strokeColor, setStrokeColor] = useState<StrokeColor>("#f0f0f0");
  const [strokeWidth, setStrokeWidth] = useState(4);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const [selectedConnector, setSelectedConnector] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRef = useRef(editingId);
  editingRef.current = editingId;
  const editingStartHtml = useRef("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [busyOp, setBusyOp] = useState<null | "move" | "resize">(null);
  const [guides, setGuides] = useState<GuideLine[] | null>(null);
  const [drawPreview, setDrawPreview] = useState<[number, number][] | null>(null);
  const [connectPreview, setConnectPreview] = useState<{ from: string; to: Point; target: string | null } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });

  const pasteCatcherRef = useRef<HTMLTextAreaElement>(null);
  const spaceHeld = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const lastPasteAt = useRef(0);
  const undoStack = useRef<BoardData[]>([]);
  const redoStack = useRef<BoardData[]>([]);
  const opRef = useRef<Op | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const lastClick = useRef<{ id: string | null; time: number; x: number; y: number }>({ id: null, time: 0, x: 0, y: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // ── document updates ──────────────────────────────────────────────────
  const historyApiRef = useRef(historyApi);
  historyApiRef.current = historyApi;
  const apply = useCallback((next: BoardData, opts: { history?: BoardData | null; notify?: boolean } = {}) => {
    if (opts.history && !historyApiRef.current) {
      undoStack.current.push(opts.history);
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      setHistorySize({ undo: undoStack.current.length, redo: 0 });
    }
    next = normalizeGroups(next);
    dataRef.current = next;
    setData(next);
    if (opts.notify !== false) onChangeRef.current?.(next);
  }, []);

  const commit = useCallback(
    (fn: (d: BoardData) => BoardData) => {
      const before = dataRef.current;
      const next = fn(before);
      if (next !== before) apply(next, { history: before });
    },
    [apply],
  );

  const updateElement = useCallback(
    (id: string, patch: Partial<BoardElement>, opts: { history?: boolean; notify?: boolean } = {}) => {
      const before = dataRef.current;
      const next: BoardData = {
        ...before,
        elements: before.elements.map((el) => (el.id === id ? ({ ...el, ...patch } as BoardElement) : el)),
      };
      apply(next, { history: opts.history ? before : null, notify: opts.notify });
    },
    [apply],
  );

  // live collaboration: someone else's change (or a live undo) arrives as a
  // whole board — taken over without echoing it back through onChange
  const onPresenceRef = useRef(onPresence);
  onPresenceRef.current = onPresence;
  useEffect(() => {
    if (!externalData) return;
    const op = opRef.current;
    let next = externalData.data;
    // a drag in progress keeps its own nodes where the pointer has them
    if (op && op.kind === "move" && op.moved) {
      const mine = new Map(dataRef.current.elements.filter((el) => op.origin.has(el.id)).map((el) => [el.id, el]));
      next = { ...next, elements: next.elements.map((el) => mine.get(el.id) ?? el) };
    }
    apply(next, { notify: false });
    const ids = new Set(next.elements.map((el) => el.id));
    if ([...selectionRef.current].some((id) => !ids.has(id))) setSelection(new Set([...selectionRef.current].filter((id) => ids.has(id))));
    if (editingRef.current && !ids.has(editingRef.current)) setEditingId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalData?.nonce]);
  useEffect(() => {
    onPresenceRef.current?.({ selection: [...selection] });
  }, [selection]);

  function undo() {
    if (historyApiRef.current) {
      historyApiRef.current.undo();
      return;
    }
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(dataRef.current);
    apply(prev);
    setHistorySize({ undo: undoStack.current.length, redo: redoStack.current.length });
    setSelection(new Set());
    setSelectedConnector(null);
  }
  function redo() {
    if (historyApiRef.current) {
      historyApiRef.current.redo();
      return;
    }
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(dataRef.current);
    apply(next);
    setHistorySize({ undo: undoStack.current.length, redo: redoStack.current.length });
  }

  // ── coordinates ───────────────────────────────────────────────────────
  function toWorld(clientX: number, clientY: number): Point {
    const rect = viewportRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - rect.left - v.x) / v.scale, y: (clientY - rect.top - v.y) / v.scale };
  }
  /** The part of the board currently on screen (world coords), minus the
   * tool bar on the left and the zoom bar at the bottom. */
  function visibleWorldRect(): Rect {
    const rect = viewportRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    const left = editable ? 84 : 16;
    const top = 16;
    const right = 16;
    const bottom = 64;
    return {
      x: (left - v.x) / v.scale,
      y: (top - v.y) / v.scale,
      w: Math.max(1, (rect.width - left - right) / v.scale),
      h: Math.max(1, (rect.height - top - bottom) / v.scale),
    };
  }
  function place(x: number, y: number, w: number, h: number, avoidOverlap: boolean, extra: Rect[] = []): Point {
    const hiddenNow = hiddenElementIds(dataRef.current.elements);
    // an open group's whole (frosted) frame counts as taken — something new
    // placed inside it would end up blurred behind the glass
    const taken = dataRef.current.elements.filter((el) => !hiddenNow.has(el.id));
    return freeSpot(x, y, w, h, [...taken, ...extra], visibleWorldRect(), avoidOverlap);
  }

  /** where pasted things go: at the mouse pointer, else the screen centre */
  function pointerOrCenterWorld(): Point {
    const rect = viewportRef.current?.getBoundingClientRect();
    const p = lastPointer.current;
    if (rect && p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) return toWorld(p.x, p.y);
    return viewportCenterWorld();
  }

  function viewportCenterWorld(): Point {
    const rect = viewportRef.current!.getBoundingClientRect();
    return toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
  const zoomAt = useCallback((clientX: number, clientY: number, nextScale: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const v = viewRef.current;
    const s = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const wx = (px - v.x) / v.scale;
    const wy = (py - v.y) / v.scale;
    const next = { scale: s, x: px - wx * s, y: py - wy * s };
    viewRef.current = next;
    setView(next);
  }, []);

  // smooth camera move (storyboard, feedback pins); a new move cancels the last
  const viewAnim = useRef<number | null>(null);
  const animateViewTo = useCallback((target: View) => {
    if (viewAnim.current) cancelAnimationFrame(viewAnim.current);
    const from = viewRef.current;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 380);
      const e = 1 - Math.pow(1 - k, 3);
      const next = { scale: from.scale + (target.scale - from.scale) * e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e };
      viewRef.current = next;
      setView(next);
      viewAnim.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    viewAnim.current = requestAnimationFrame(step);
  }, []);

  /** frames a world rect in the viewport (null = the empty-board default) */
  const zoomToRect = useCallback(
    (b: Rect | null, opts: { pad?: number; maxScale?: number; animate?: boolean } = {}) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      let next: View;
      if (!b) {
        next = { scale: 1, x: rect.width / 2 - 216, y: Math.min(160, rect.height / 4) };
      } else {
        const pad = opts.pad ?? 96;
        const s = clamp(Math.min((rect.width - pad * 2) / Math.max(b.w, 1), (rect.height - pad * 2) / Math.max(b.h, 1), opts.maxScale ?? 1), MIN_SCALE, opts.maxScale ?? 1);
        next = { scale: s, x: rect.width / 2 - (b.x + b.w / 2) * s, y: rect.height / 2 - (b.y + b.h / 2) * s };
      }
      if (opts.animate) {
        animateViewTo(next);
        return;
      }
      viewRef.current = next;
      setView(next);
    },
    [animateViewTo],
  );

  const fitToContent = useCallback(() => zoomToRect(boundsOf(dataRef.current.elements)), [zoomToRect]);

  // "zoom to the commented node" (Feedback-Pins): frame it and let it light up
  const [flash, setFlash] = useState<string | null>(null);
  const [innerFocus, setInnerFocus] = useState<{ elementId: string; nonce: number } | null>(null);
  const activeFocus = !focusRequest ? innerFocus : !innerFocus ? focusRequest : focusRequest.nonce > innerFocus.nonce ? focusRequest : innerFocus;
  useEffect(() => {
    if (!activeFocus) return;
    const els = dataRef.current.elements;
    const groupId = hiddenElementIds(els).get(activeFocus.elementId);
    const el = els.find((x) => x.id === (groupId ?? activeFocus.elementId));
    if (!el) return;
    zoomToRect(el, { animate: true, maxScale: 1.25, pad: 140 });
    setFlash(activeFocus.elementId);
    const timer = setTimeout(() => setFlash(null), 1800);
    return () => clearTimeout(timer);
  }, [activeFocus, zoomToRect]);

  // ── Szenen (2026-10-09, Lino: like Apple Freeform) ────────────────────
  // a scene = the board area on screen when it was saved; a click frames
  // exactly that area again (animated)
  const [activeScene, setActiveScene] = useState<string | null>(null);
  function captureScene(name: string) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const v = viewRef.current;
    const scene: BoardView = { id: newId(), name: name.slice(0, 80), x: -v.x / v.scale, y: -v.y / v.scale, w: rect.width / v.scale, h: rect.height / v.scale };
    commit((d) => ({ ...d, views: [...(d.views ?? []), scene].slice(0, 50) }));
    setActiveScene(scene.id);
  }
  function renameScene(id: string, name: string) {
    commit((d) => ({ ...d, views: (d.views ?? []).map((s) => (s.id === id ? { ...s, name: name.slice(0, 80) } : s)) }));
  }
  function deleteScene(id: string) {
    commit((d) => ({ ...d, views: (d.views ?? []).filter((s) => s.id !== id) }));
    if (activeScene === id) setActiveScene(null);
  }
  function goToScene(scene: BoardView) {
    zoomToRect(scene, { animate: true, pad: 0, maxScale: MAX_SCALE });
    setActiveScene(scene.id);
  }

  // ── search, tags, navigation (2026-10-08) ─────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  /** ids matching the search + tag filter (an open group counts when any
   * member matches); null = no filter, nothing dimmed */
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!searchOpen || (!words.length && !tagFilter.length)) return null;
    const want = tagFilter.map((x) => x.toLowerCase());
    const set = new Set<string>();
    for (const el of data.elements) {
      const text = elementSearchText(el).toLowerCase();
      const tags = (el.tags ?? []).map((x) => x.toLowerCase());
      if (words.every((w) => text.includes(w)) && want.every((w) => tags.includes(w))) set.add(el.id);
    }
    for (const el of data.elements) if (el.type === "group" && el.children.some((c) => set.has(c))) set.add(el.id);
    return set;
  }, [data.elements, query, tagFilter, searchOpen]);

  function pickFromSearch(el: BoardElement) {
    setSelection(new Set([el.id]));
    setInnerFocus({ elementId: el.id, nonce: Date.now() });
  }

  const allTags = useMemo(() => {
    const seen = new Map<string, string>();
    for (const el of data.elements) for (const tg of el.tags ?? []) if (!seen.has(tg.toLowerCase())) seen.set(tg.toLowerCase(), tg);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [data.elements]);

  function saveTags(add: string[], remove: string[]) {
    setTagEditorOpen(false);
    const ids = new Set(selectionRef.current);
    const rm = remove.map((x) => x.toLowerCase());
    commit((d) => ({
      ...d,
      elements: d.elements.map((el) => {
        if (!ids.has(el.id)) return el;
        const kept = (el.tags ?? []).filter((x) => !rm.includes(x.toLowerCase()));
        const next = [...kept, ...add.filter((x) => !kept.some((k) => k.toLowerCase() === x.toLowerCase()))].slice(0, 10);
        const out = { ...el, tags: next } as BoardElement;
        if (!next.length) delete out.tags;
        return out;
      }),
    }));
  }

  // ── variant votes (2026-10-08) ────────────────────────────────────────
  function toggleVoteGroup(id: string) {
    const g = dataRef.current.elements.find((e) => e.id === id);
    if (!g || g.type !== "group") return;
    updateElement(id, { vote: !g.vote } as Partial<GroupElement>, { history: true });
  }

  /** per open vote group: its variants in reading order with letter + votes */
  const voteInfo = useMemo(() => {
    const out: { groupId: string; el: BoardElement; letter: string; voters: BoardVote[]; mine: boolean; leader: boolean }[] = [];
    for (const g of data.elements) {
      if (g.type !== "group" || !g.vote || g.collapsed) continue;
      const members = data.elements
        .filter((e) => g.children.includes(e.id))
        .sort((a, b) => (Math.abs(a.y - b.y) > GRID * 2 ? a.y - b.y : a.x - b.x));
      const rows = members.map((el, i) => {
        const voters = (votes ?? []).filter((v) => v.group_id === g.id && v.element_id === el.id);
        return { groupId: g.id, el, letter: String.fromCharCode(65 + (i % 26)), voters, mine: !!myVoterKey && voters.some((v) => v.voter_key === myVoterKey), leader: false };
      });
      const top = Math.max(0, ...rows.map((r) => r.voters.length));
      for (const r of rows) r.leader = top > 0 && r.voters.length === top;
      out.push(...rows);
    }
    return out;
  }, [data.elements, votes, myVoterKey]);

  useLayoutEffect(() => {
    fitToContent();
  }, [fitToContent]);

  // Wheel = zoom around the pointer (Lino's spec), trackpad pinch arrives as
  // ctrl+wheel and zooms faster per delta. Native listener: React's onWheel
  // is passive and can't stop the page from scrolling/zooming.
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    function onWheel(e: WheelEvent) {
      if ((e.target as HTMLElement).closest("[data-board-ui]")) return;
      e.preventDefault();
      setMenu(null);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0018));
      zoomAt(e.clientX, e.clientY, viewRef.current.scale * factor);
    }
    vp.addEventListener("wheel", onWheel, { passive: false });
    // Safari pinch on a trackpad fires gesture events instead of ctrl+wheel
    const prevent = (e: Event) => e.preventDefault();
    vp.addEventListener("gesturestart", prevent);
    vp.addEventListener("gesturechange", prevent);
    return () => {
      vp.removeEventListener("wheel", onWheel);
      vp.removeEventListener("gesturestart", prevent);
      vp.removeEventListener("gesturechange", prevent);
    };
  }, [zoomAt]);

  // ── adding content ────────────────────────────────────────────────────
  function addElements(els: BoardElement[], select = true) {
    commit((d) => ({ ...d, elements: [...d.elements, ...els] }));
    if (select) setSelection(new Set(els.map((e) => e.id)));
  }

  function addText(at: Point, edit = true, avoidOverlap = false) {
    const spot = avoidOverlap ? place(at.x - 144, at.y - 36, 288, 72, true) : place(at.x - 120, at.y - 24, 288, 72, false);
    const el: TextElement = {
      id: newId(),
      type: "text",
      x: spot.x,
      y: spot.y,
      w: 288,
      h: 72,
      z: maxZ(dataRef.current.elements) + 1,
      html: "",
      color: "default",
    };
    addElements([el]);
    setTool("select");
    if (edit) {
      editingStartHtml.current = "";
      setEditingId(el.id);
    }
  }

  // 2026-10-08, Lino: post-it note — square, edited like a text box
  function addSticky(at: Point) {
    const spot = place(at.x - 120, at.y - 120, 240, 240, true);
    const el: StickyElement = { id: newId(), type: "sticky", x: spot.x, y: spot.y, w: 240, h: 240, z: maxZ(dataRef.current.elements) + 1, html: "", color: "yellow" };
    addElements([el]);
    setTool("select");
    editingStartHtml.current = "";
    setEditingId(el.id);
  }

  // ── GIF maker (2026-10-08) ────────────────────────────────────────────
  const [gifAt, setGifAt] = useState<Point | null>(null);

  // ── quick add: Shift + Space (2026-10-09, Lino) ───────────────────────
  // a search field in the middle: type, ↑/↓, Enter → the node is placed
  // where the mouse pointer is (the centre of the screen without one)
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const [quickAdd, setQuickAdd] = useState<{ world: Point; client: { x: number; y: number } } | null>(null);
  function openQuickAdd() {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const p = lastPointer.current;
    const inside = p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom;
    const client = inside ? p : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    setMenu(null);
    setQuickAdd({ world: toWorld(client.x, client.y), client });
  }
  function addGif(gif: { key: string; src: string; w: number; h: number }, slot?: Rect) {
    const at = gifAt ?? viewportCenterWorld();
    setGifAt(null);
    const w = Math.min(360, gif.w);
    const h = Math.round((w * gif.h) / Math.max(1, gif.w));
    // from a progress node: exactly where it was (top-left, its width)
    const spot = slot ? { x: slot.x, y: slot.y } : place(at.x - w / 2, at.y - h / 2, w, h, true);
    const el: MediaElement = { id: newId(), type: "image", x: spot.x, y: spot.y, w, h, z: maxZ(dataRef.current.elements) + 1, asset_key: gif.key, src: gif.src, name: "clip.gif", mime: "image/gif" };
    addElements([el]);
    setSelection(new Set([el.id]));
  }

  // 2026-10-09, Lino: an image dragged over a scene card (from the canvas or
  // from the Finder) becomes its image — while hovering, the card shows that
  // its image will be set / replaced. Moodboards get the same hint.
  const [imageDropTarget, setImageDropTarget] = useState<string | null>(null);
  function imageTargetAt(w: Point, exclude: Set<string>, kinds: ("scene" | "moodboard")[]): BoardElement | null {
    const hiddenNow = hiddenElementIds(dataRef.current.elements);
    let best: BoardElement | null = null;
    for (const x of dataRef.current.elements) {
      if (!kinds.includes(x.type as "scene") || exclude.has(x.id) || hiddenNow.has(x.id)) continue;
      if (w.x < x.x || w.x > x.x + x.w || w.y < x.y || w.y > x.y + x.h) continue;
      if (!best || x.z > best.z) best = x;
    }
    return best;
  }

  // "Make GIF" (2026-10-09, Lino): the maker closes, a progress node in the
  // video's format holds the spot until the GIF is ready and replaces it.
  // Local to this browser — nothing is saved until the GIF exists.
  const [pendingGifs, setPendingGifs] = useState<{ id: string; x: number; y: number; w: number; h: number; started: number }[]>([]);
  function startGif(render: () => Promise<{ key: string; src: string; w: number; h: number }>, aspect: number) {
    const at = gifAt ?? viewportCenterWorld();
    setGifAt(null);
    const a = Math.max(0.3, Math.min(4, aspect || 16 / 9));
    const w = a >= 1 ? 360 : Math.round(360 * a);
    const h = Math.round(w / a);
    const spot = place(at.x - w / 2, at.y - h / 2, w, h, true);
    const slot = { id: newId(), x: spot.x, y: spot.y, w, h, started: Date.now() };
    setPendingGifs((p) => [...p, slot]);
    render()
      .then((gif) => addGif(gif, slot))
      .catch(() => onError?.(t("ideaBoard.gif.renderFailed" as never)))
      .finally(() => setPendingGifs((p) => p.filter((x) => x.id !== slot.id)));
  }

  // ── moodboard cards (2026-10-08) ──────────────────────────────────────
  const moodboardInputRef = useRef<HTMLInputElement>(null);
  const moodboardTarget = useRef<string | null>(null);
  const [moodboardBusy, setMoodboardBusy] = useState<Record<string, number>>({});

  function addMoodboard(at: Point) {
    const w = 528;
    const h = 420;
    const spot = place(at.x - w / 2, at.y - h / 2, w, h, true);
    const el: MoodboardElement = { id: newId(), type: "moodboard", x: spot.x, y: spot.y, w, h, z: maxZ(dataRef.current.elements) + 1, title: "", cols: 3, items: [], layout: 4 };
    addElements([el]);
    setTool("select");
    setSelection(new Set([el.id]));
    pickMoodboardImages(el.id);
  }

  function pickMoodboardImages(id: string) {
    moodboardTarget.current = id;
    moodboardInputRef.current?.click();
  }

  /** a new image: normal size, its own aspect ratio */
  function spanFor(size: { w: number; h: number } | null, _cols: number): { w: number; h: number; ar: number; s: number } {
    const ar = size && size.w && size.h ? Math.round((size.w / size.h) * 1000) / 1000 : 1;
    return { w: 1, h: 1, ar, s: 1 };
  }

  function appendMoodboardItems(id: string, add: MoodboardItem[]) {
    if (!add.length) return;
    commit((d) => ({
      ...d,
      elements: d.elements.map((el) =>
        el.id === id && el.type === "moodboard" ? moodboardWith(el, [...moodboardItems(el), ...add].slice(0, 60)) : el,
      ),
    }));
  }

  async function addMoodboardFiles(id: string, files: File[]) {
    const images = files.filter((f) => guessMime(f).startsWith("image/"));
    if (!images.length || !uploadFile) return;
    setMoodboardBusy((b) => ({ ...b, [id]: (b[id] ?? 0) + images.length }));
    await Promise.all(
      images.map(async (file) => {
        try {
          const mime = guessMime(file);
          const [size, up] = await Promise.all([mediaSize(file, "image"), uploadFile(file, mime, () => {})]);
          const mb = dataRef.current.elements.find((e) => e.id === id);
          const cols = mb?.type === "moodboard" ? mb.cols : 3;
          appendMoodboardItems(id, [{ id: newId(), asset_key: up.key, src: up.src, name: file.name, mime, ...spanFor(size, cols) }]);
        } catch {
          onError?.(t("ideaBoard.uploadFailed", { name: file.name }));
        } finally {
          setMoodboardBusy((b) => ({ ...b, [id]: Math.max(0, (b[id] ?? 1) - 1) }));
        }
      }),
    );
  }

  function setMoodboardItems(id: string, items: MoodboardItem[]) {
    const el = dataRef.current.elements.find((x) => x.id === id);
    if (el?.type !== "moodboard") return;
    // same row height; the card's height follows the content (2026-10-09)
    const next = moodboardWith(el, items);
    updateElement(id, { items: next.items, layout: 4, row_h: next.row_h, h: next.h } as Partial<MoodboardElement>, { history: true });
  }


  function setStickyColor(color: StickyColor) {
    const ids = selectionRef.current;
    commit((d) => ({ ...d, elements: d.elements.map((el) => (ids.has(el.id) && el.type === "sticky" ? { ...el, color } : el)) }));
  }

  async function mediaSize(file: File, kind: MediaElement["type"]): Promise<{ w: number; h: number } | null> {
    if (kind !== "image" && kind !== "video") return null;
    const url = URL.createObjectURL(file);
    try {
      if (kind === "image") {
        const img = new Image();
        img.src = url;
        await img.decode();
        return img.naturalWidth && img.naturalHeight ? { w: img.naturalWidth, h: img.naturalHeight } : null;
      }
      return await new Promise((resolve) => {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.muted = true;
        const done = (r: { w: number; h: number } | null) => resolve(r);
        v.onloadedmetadata = () => done(v.videoWidth ? { w: v.videoWidth, h: v.videoHeight } : null);
        v.onerror = () => done(null);
        setTimeout(() => done(null), 5000);
        v.src = url;
      });
    } catch {
      return null;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 8000);
    }
  }

  async function addFiles(files: File[], at: Point, avoidOverlap = false) {
    if (!uploadFile) return;
    // 1) measure every file first (sizes decide the layout)
    const items: { file: File; mime: string; kind: MediaElement["type"]; w: number; h: number }[] = [];
    for (const file of files) {
      const mime = guessMime(file);
      const kind = elementKindForMime(mime);
      if (!kind) {
        onError?.(t("ideaBoard.unsupportedType", { name: file.name }));
        continue;
      }
      const natural = await mediaSize(file, kind);
      let w = 312;
      let h = 96;
      if (kind === "image") {
        w = snap(Math.min(336, Math.max(96, natural?.w ?? 336)));
        h = natural ? Math.round((w * natural.h) / natural.w) : 252;
      } else if (kind === "video") {
        w = 432;
        h = VIDEO_HEADER + Math.round((w * (natural?.h ?? 9)) / (natural?.w ?? 16));
      } else if (kind === "audio") {
        w = 336;
        h = 120;
      }
      items.push({ file, mime, kind, w, h });
    }
    if (items.length === 0) return;

    // 2) positions. One file: the usual free spot. Several files from one
    // upload (2026-10-08, Lino): a compact, slightly overlapping stack
    // centred on the drop point / view centre, so it's obvious these just
    // came in together — rows of ~√n, each card overlapping the previous
    // one by ~20%, squeezed tighter if the stack wouldn't fit in view.
    let spots: Point[];
    if (items.length === 1) {
      const it = items[0];
      spots = [place(at.x - it.w / 2, at.y - it.h / 2, it.w, it.h, avoidOverlap)];
    } else {
      const cols = Math.ceil(Math.sqrt(items.length));
      const view = visibleWorldRect();
      const layout = (f: number) => {
        const pos: Point[] = [];
        let y = 0;
        let width = 0;
        for (let r = 0; r * cols < items.length; r++) {
          const row = items.slice(r * cols, r * cols + cols);
          let x = 0;
          row.forEach((it, i) => {
            pos.push({ x, y });
            width = Math.max(width, x + it.w);
            if (i < row.length - 1) x += it.w * f;
          });
          const rowH = Math.max(...row.map((it) => it.h));
          if ((r + 1) * cols < items.length) y += rowH * f;
          else y += rowH;
        }
        return { pos, width, height: y };
      };
      let f = 0.8;
      let lay = layout(f);
      while (f > 0.3 && (lay.width > view.w || lay.height > view.h)) {
        f -= 0.05;
        lay = layout(f);
      }
      const origin = clampInto(at.x - lay.width / 2, at.y - lay.height / 2, lay.width, lay.height, view);
      const ox = snap(origin.x);
      const oy = snap(origin.y);
      spots = lay.pos.map((p) => ({ x: Math.round(ox + p.x), y: Math.round(oy + p.y) }));
    }

    // 3) placeholders right away, uploads in parallel; stacking order is the
    // upload order, not whichever finishes first
    const zBase = maxZ(dataRef.current.elements) + 1;
    const added: string[] = [];
    await Promise.all(
      items.map(async (it, i) => {
        const { x, y } = spots[i];
        const pid = newId();
        setPending((p) => [...p, { id: pid, label: it.file.name, progress: 0, x, y, w: it.w, h: it.h }]);
        try {
          const { key, src } = await uploadFile(it.file, it.mime, (fr) =>
            setPending((p) => p.map((pi) => (pi.id === pid ? { ...pi, progress: fr } : pi))),
          );
          const el: MediaElement = {
            id: newId(),
            type: it.kind,
            x,
            y,
            w: it.w,
            h: it.h,
            z: zBase + i,
            asset_key: key,
            src,
            name: it.file.name,
            mime: it.mime,
            ...(it.kind === "pdf" ? { size: it.file.size } : {}),
          };
          addElements([el], items.length === 1);
          added.push(el.id);
        } catch {
          onError?.(t("ideaBoard.uploadFailed", { name: it.file.name }));
        } finally {
          setPending((p) => p.filter((pi) => pi.id !== pid));
        }
      }),
    );
    // the new stack ends up selected, ready to be moved as one
    if (added.length > 1) setSelection(new Set(added));
  }

  async function addLink(rawUrl: string, at: Point, avoidOverlap = false) {
    const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    const pid = newId();
    const { x, y } = place(at.x - 168, at.y - 80, 336, 288, avoidOverlap);
    setPending((p) => [...p, { id: pid, label: t("ideaBoard.linkLoading"), progress: null, x, y, w: 336, h: 120 }]);
    let preview: LinkPreview | null = null;
    try {
      preview = fetchLinkPreview ? await fetchLinkPreview(url) : null;
    } catch {
      onError?.(t("ideaBoard.linkFailed"));
    } finally {
      setPending((p) => p.filter((it) => it.id !== pid));
    }
    const el: LinkElement = {
      id: newId(),
      type: "link",
      x,
      y,
      w: 336,
      h: preview?.image_src ? 288 : 120,
      z: maxZ(dataRef.current.elements) + 1,
      url: preview?.url ?? url,
      title: preview?.title ?? "",
      description: preview?.description ?? "",
      site_name: preview?.site_name ?? "",
      ...(preview?.image_key ? { image_key: preview.image_key, image_src: preview.image_src } : {}),
    };
    addElements([el]);
  }

  // ── selection actions ─────────────────────────────────────────────────
  function deleteSelection() {
    const ids = new Set(selectionRef.current);
    // a selected group goes together with everything in it
    for (const el of dataRef.current.elements) if (el.type === "group" && ids.has(el.id)) el.children.forEach((c) => ids.add(c));
    if (ids.size === 0 && !selectedConnector) return;
    commit((d) => ({
      ...d,
      elements: d.elements.filter((el) => !ids.has(el.id)),
      connectors: d.connectors.filter((c) => c.id !== selectedConnector && !ids.has(c.from) && !ids.has(c.to)),
    }));
    setSelection(new Set());
    setSelectedConnector(null);
  }

  function duplicateSelection() {
    const ids = new Set(selectionRef.current);
    if (ids.size === 0) return;
    for (const el of dataRef.current.elements) if (el.type === "group" && ids.has(el.id)) el.children.forEach((c) => ids.add(c));
    const mapping = new Map<string, string>();
    let z = maxZ(dataRef.current.elements);
    const copies = dataRef.current.elements
      .filter((el) => ids.has(el.id))
      .sort((a, b) => a.z - b.z)
      .map((el) => {
        const id = newId();
        mapping.set(el.id, id);
        return { ...el, id, x: el.x + GRID, y: el.y + GRID, z: ++z } as BoardElement;
      })
      .map((el) => (el.type === "group" ? { ...el, children: el.children.map((c) => mapping.get(c) ?? c) } : el));
    const connectorCopies: Connector[] = dataRef.current.connectors
      .filter((c) => mapping.has(c.from) && mapping.has(c.to))
      .map((c) => ({ ...c, id: newId(), from: mapping.get(c.from)!, to: mapping.get(c.to)! }));
    commit((d) => ({ ...d, elements: [...d.elements, ...copies], connectors: [...d.connectors, ...connectorCopies] }));
    const groupIds = copies.filter((c) => c.type === "group").map((c) => c.id);
    const inGroups = new Set(copies.flatMap((c) => (c.type === "group" ? c.children : [])));
    setSelection(new Set(groupIds.length ? [...groupIds, ...copies.filter((c) => c.type !== "group" && !inGroups.has(c.id)).map((c) => c.id)] : copies.map((c) => c.id)));
  }

  // ── copy & paste nodes, also into another board (2026-10-09, Lino) ─────
  // ⌘C puts the selection on the clipboard as marked JSON (and in
  // localStorage, for browsers that won't hand the clipboard over); ⌘V on any
  // board recognises it. From another board, files and to-do lists are copied
  // server side first, so the pasted nodes don't depend on the original.
  function selectionPayload(): string | null {
    const ids = new Set(selectionRef.current);
    if (!ids.size) return null;
    for (const el of dataRef.current.elements) if (el.type === "group" && ids.has(el.id)) el.children.forEach((c) => ids.add(c));
    const elements = dataRef.current.elements.filter((el) => ids.has(el.id));
    if (!elements.length) return null;
    const connectors = dataRef.current.connectors.filter((c) => ids.has(c.from) && ids.has(c.to));
    return BOARD_CLIPBOARD_MARKER + JSON.stringify({ v: 1, ideaId: clipboard?.ideaId ?? null, elements, connectors });
  }
  function copySelection(e?: ClipboardEvent): boolean {
    const text = selectionPayload();
    if (!text) return false;
    try {
      localStorage.setItem(BOARD_CLIPBOARD_KEY, JSON.stringify({ at: Date.now(), text }));
    } catch {
      // storage unavailable — the system clipboard still has it
    }
    if (e?.clipboardData) {
      e.clipboardData.setData("text/plain", text);
      e.preventDefault();
    } else {
      void navigator.clipboard?.writeText?.(text).catch(() => {});
    }
    return true;
  }

  async function pasteNodes(text: string, at: Point) {
    let payload: { ideaId: string | null; elements: BoardElement[]; connectors: Connector[] };
    try {
      payload = JSON.parse(text.slice(BOARD_CLIPBOARD_MARKER.length));
    } catch {
      return;
    }
    let elements = payload.elements ?? [];
    if (!elements.length) return;
    const fromElsewhere = !!payload.ideaId && !!clipboard && payload.ideaId !== clipboard.ideaId;
    if (fromElsewhere && clipboard && payload.ideaId) {
      const keys = new Set<string>();
      const lists = new Set<string>();
      for (const el of elements) {
        if ("asset_key" in el && el.asset_key) keys.add(el.asset_key);
        if ("image_key" in el && el.image_key) keys.add(el.image_key);
        if (el.type === "moodboard") el.items.forEach((it) => it.asset_key && keys.add(it.asset_key));
        if (el.type === "todo") lists.add(el.list_id);
      }
      let res: Awaited<ReturnType<typeof clipboard.importFrom>>;
      try {
        res = await clipboard.importFrom(payload.ideaId, [...keys], [...lists]);
      } catch {
        onError?.(t("ideaBoard.pasteFailed"));
        return;
      }
      const k = res.keys;
      elements = elements
        .map((el): BoardElement | null => {
          let out = el;
          if ("asset_key" in out && out.asset_key) {
            const m = k[out.asset_key];
            if (!m) return null; // its file couldn't be copied
            out = { ...out, asset_key: m.key, src: m.src, thumb_src: null, srcset: null } as BoardElement;
          }
          if ("image_key" in out && out.image_key) {
            const m = k[out.image_key];
            out = (m ? { ...out, image_key: m.key, image_src: m.src, image_thumb_src: null, image_srcset: null } : { ...out, image_key: undefined, image_src: null }) as BoardElement;
          }
          if (out.type === "moodboard") {
            out = { ...out, items: out.items.filter((it) => k[it.asset_key]).map((it) => ({ ...it, asset_key: k[it.asset_key].key, src: k[it.asset_key].src, thumb_src: null, srcset: null })) };
          }
          if (out.type === "todo") {
            const nl = res.todo_lists[out.list_id];
            if (!nl) return null;
            out = { ...out, list_id: nl };
          }
          return out;
        })
        .filter((el): el is BoardElement => !!el);
      if (!elements.length) return;
    }
    // new ids, placed around the pointer, on top of everything
    const mapping = new Map<string, string>();
    const box = boundsOf(elements);
    const dx = box ? at.x - (box.x + box.w / 2) : 0;
    const dy = box ? at.y - (box.y + box.h / 2) : 0;
    let z = maxZ(dataRef.current.elements);
    const copies = elements
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((el) => {
        const id = newId();
        mapping.set(el.id, id);
        return { ...el, id, x: Math.round(el.x + dx), y: Math.round(el.y + dy), z: ++z } as BoardElement;
      })
      .map((el) => (el.type === "group" ? { ...el, children: el.children.map((c) => mapping.get(c)).filter((c): c is string => !!c) } : el));
    const connectorCopies: Connector[] = (payload.connectors ?? [])
      .filter((c) => mapping.has(c.from) && mapping.has(c.to))
      .map((c) => ({ ...c, id: newId(), from: mapping.get(c.from)!, to: mapping.get(c.to)! }));
    commit((d) => ({ ...d, elements: [...d.elements, ...copies], connectors: [...d.connectors, ...connectorCopies] }));
    const inGroups = new Set(copies.flatMap((c) => (c.type === "group" ? c.children : [])));
    setSelection(new Set(copies.filter((c) => !inGroups.has(c.id)).map((c) => c.id)));
  }

  // ── groups ────────────────────────────────────────────────────────────
  function groupSelection() {
    const sel = selectionRef.current;
    const els = dataRef.current.elements;
    const groupsInSel = els.filter((el): el is GroupElement => el.type === "group" && sel.has(el.id));
    const members = new Set<string>();
    for (const el of els) if (sel.has(el.id) && el.type !== "group") members.add(el.id);
    for (const g of groupsInSel) g.children.forEach((c) => members.add(c));
    // an element already in another (unselected) group moves to the new one
    if (members.size < 2) return;
    const memberEls = els.filter((el) => members.has(el.id));
    const group: GroupElement = {
      id: newId(),
      type: "group",
      x: 0,
      y: 0,
      w: 0,
      h: 0,
      z: Math.min(...memberEls.map((el) => el.z)) - 1,
      title: "",
      collapsed: false,
      children: memberEls.map((el) => el.id),
    };
    const dropGroups = new Set(groupsInSel.map((g) => g.id));
    commit((d) => ({
      ...d,
      elements: [
        ...d.elements
          .filter((el) => !dropGroups.has(el.id))
          .map((el) => (el.type === "group" ? { ...el, children: el.children.filter((c) => !members.has(c)) } : el)),
        group,
      ],
      connectors: d.connectors.filter((c) => !dropGroups.has(c.from) && !dropGroups.has(c.to)),
    }));
    setSelection(new Set([group.id]));
    setEditingId(group.id);
  }

  function ungroup(id: string) {
    const g = dataRef.current.elements.find((el) => el.id === id);
    if (!g || g.type !== "group") return;
    commit((d) => ({
      ...d,
      elements: d.elements.filter((el) => el.id !== id),
      connectors: d.connectors.filter((c) => c.from !== id && c.to !== id),
    }));
    setSelection(new Set(g.children));
  }

  function toggleGroup(id: string) {
    const g = dataRef.current.elements.find((el) => el.id === id);
    if (!g || g.type !== "group") return;
    // collapsing: the card takes the frame's top-left corner; expanding: the
    // frame is recomputed from the members (normalizeGroups)
    const patch: Partial<GroupElement> = g.collapsed
      ? { collapsed: false }
      : { collapsed: true, w: GROUP_CARD_W, h: GROUP_CARD_H };
    if (editable) updateElement(id, patch, { history: true });
    else updateElement(id, patch, { notify: false });
    setSelection((sel) => {
      const next = new Set(sel);
      g.children.forEach((c) => next.delete(c));
      return next;
    });
  }

  function commitGroupTitle(id: string, title: string) {
    const g = dataRef.current.elements.find((el) => el.id === id);
    if (g && g.type === "group" && title.trim() !== g.title) updateElement(id, { title: title.trim() } as Partial<GroupElement>, { history: true });
    if (editingRef.current === id) setEditingId(null);
  }

  function reorderSelection(front: boolean) {
    const ids = selectionRef.current;
    if (ids.size === 0) return;
    commit((d) => {
      const others = d.elements.filter((el) => !ids.has(el.id));
      const picked = d.elements.filter((el) => ids.has(el.id)).sort((a, b) => a.z - b.z);
      const base = front ? maxZ(others) + 1 : Math.min(0, ...others.map((el) => el.z)) - picked.length;
      const z = new Map(picked.map((el, i) => [el.id, base + i]));
      return { ...d, elements: d.elements.map((el) => (z.has(el.id) ? { ...el, z: z.get(el.id)! } : el)) };
    });
  }

  function setTextAlign(ids: Set<string>, align: TextAlign) {
    commit((d) => ({
      ...d,
      elements: d.elements.map((el) => (ids.has(el.id) && (el.type === "text" || el.type === "sticky") ? { ...el, align } : el)),
    }));
  }

  function setScenePriority(priority: Priority | null) {
    const ids = selectionRef.current;
    commit((d) => ({
      ...d,
      elements: d.elements.map((el) => (ids.has(el.id) && el.type === "scene" ? { ...el, priority } : el)),
    }));
  }

  function setTextColor(color: TextColor) {
    const ids = selectionRef.current;
    commit((d) => ({
      ...d,
      elements: d.elements.map((el) => (ids.has(el.id) && el.type === "text" ? { ...el, color } : el)),
    }));
  }

  function finishEditing() {
    // blur first so the focused field (text box, or a scene card's title
    // input / text) commits via its onBlur before it unmounts
    const active = document.activeElement as HTMLElement | null;
    if (active && viewportRef.current?.contains(active) && (active.isContentEditable || active.tagName === "INPUT" || active.tagName === "TEXTAREA")) {
      active.blur();
    }
    setEditingId(null);
  }

  function commitText(id: string, rawHtml: string) {
    const html = sanitizeBoardHtml(rawHtml);
    const el = dataRef.current.elements.find((e) => e.id === id);
    if (!el || (el.type !== "text" && el.type !== "sticky")) return;
    if (el.type === "text" && !boardHtmlToPlain(html) && !boardHtmlToPlain(editingStartHtml.current)) {
      // a freshly created text box left empty — drop it instead of keeping an empty card
      commit((d) => ({
        ...d,
        elements: d.elements.filter((e) => e.id !== id),
        connectors: d.connectors.filter((c) => c.from !== id && c.to !== id),
      }));
      setSelection(new Set());
    } else if (html !== el.html) {
      updateElement(id, { html } as Partial<TextElement | StickyElement>, { history: true });
    }
    if (editingRef.current === id) setEditingId(null);
  }

  // ── board templates (2026-10-09, Lino) ─────────────────────────────────
  // "Templates, die man immer wieder für neue Projekte laden kann — nur mit
  // leeren Nodes". Saving sends the board (or the selection); the server
  // keeps layout + texts and turns content into placeholders. Loading puts
  // the template on this board with new ids — on an empty board where it
  // was, otherwise to the right of what's there — and flies to it.
  const [templatesOpen, setTemplatesOpen] = useState(false);
  function templateSource(selectionOnly: boolean): BoardData | null {
    const d = dataRef.current;
    if (!selectionOnly) return { elements: d.elements, connectors: d.connectors, views: d.views };
    const ids = new Set(selectionRef.current);
    for (const el of d.elements) if (el.type === "group" && ids.has(el.id)) el.children.forEach((c) => ids.add(c));
    const elements = d.elements
      .filter((el) => ids.has(el.id))
      .map((el) => (el.type === "group" ? { ...el, children: el.children.filter((c) => ids.has(c)) } : el));
    return { elements, connectors: d.connectors.filter((c) => ids.has(c.from) && ids.has(c.to)) };
  }
  async function loadTemplate(tpl: BoardTemplate) {
    if (!templates) return;
    setTemplatesOpen(false);
    let doc: BoardData;
    try {
      doc = await templates.use(tpl.id);
    } catch {
      onError?.(t("ideaBoard.templates.failed"));
      return;
    }
    const els = doc.elements ?? [];
    const box = boundsOf(els);
    if (!box) return;
    const current = dataRef.current;
    const existing = boundsOf(current.elements.filter((el) => !hiddenElementIds(current.elements).has(el.id)));
    const dx = existing ? snap(existing.x + existing.w + 240 - box.x) : 0;
    const dy = existing ? snap(existing.y - box.y) : 0;
    const mapping = new Map<string, string>();
    let z = maxZ(current.elements);
    const copies = els
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((el) => {
        const id = newId();
        mapping.set(el.id, id);
        return { ...el, id, x: Math.round(el.x + dx), y: Math.round(el.y + dy), z: ++z } as BoardElement;
      })
      .map((el) => (el.type === "group" ? { ...el, children: el.children.map((c) => mapping.get(c)).filter((c): c is string => !!c) } : el));
    const connectors: Connector[] = (doc.connectors ?? [])
      .filter((c) => mapping.has(c.from) && mapping.has(c.to))
      .map((c) => ({ ...c, id: newId(), from: mapping.get(c.from)!, to: mapping.get(c.to)! }));
    const views: BoardView[] = (doc.views ?? []).map((v) => ({ ...v, id: newId(), x: v.x + dx, y: v.y + dy }));
    commit((d) => ({
      ...d,
      elements: [...d.elements, ...copies],
      connectors: [...d.connectors, ...connectors],
      ...(views.length ? { views: [...(d.views ?? []), ...views].slice(0, 50) } : {}),
    }));
    setSelection(new Set());
    zoomToRect({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, { animate: true });
  }

  // template placeholders: filled in place — the node keeps its id (arrows,
  // groups) and its spot; its height follows the new content
  function fillPlaceholder(id: string, make: (ph: PlaceholderElement) => BoardElement, history: BoardData | null = null) {
    const ph = dataRef.current.elements.find((x): x is PlaceholderElement => x.id === id && x.type === "placeholder");
    if (!ph) return;
    const next = { ...make(ph), id: ph.id, z: ph.z, ...(ph.tags?.length ? { tags: ph.tags } : {}) } as BoardElement;
    if (history) apply({ ...dataRef.current, elements: dataRef.current.elements.map((x) => (x.id === id ? next : x)) }, { history });
    else commit((d) => ({ ...d, elements: d.elements.map((x) => (x.id === id ? next : x)) }));
    setSelection(new Set([id]));
  }
  async function fillPlaceholderWithFile(id: string, picked: File) {
    const ph = dataRef.current.elements.find((x): x is PlaceholderElement => x.id === id && x.type === "placeholder");
    if (!ph || !uploadFile) return;
    const mime = guessMime(picked);
    const kind = elementKindForMime(mime);
    if (!kind) {
      onError?.(t("ideaBoard.unsupportedType", { name: picked.name }));
      return;
    }
    const natural = await mediaSize(picked, kind);
    const w = ph.w;
    const h =
      kind === "image" && natural
        ? Math.round((w * natural.h) / natural.w)
        : kind === "video"
          ? VIDEO_HEADER + Math.round((w * (natural?.h ?? 9)) / (natural?.w ?? 16))
          : kind === "audio"
            ? 120
            : ph.h;
    const pid = newId();
    setPending((p) => [...p, { id: pid, label: picked.name, progress: 0, x: ph.x, y: ph.y, w: ph.w, h: ph.h }]);
    try {
      const { key, src } = await uploadFile(picked, mime, (fr) => setPending((p) => p.map((pi) => (pi.id === pid ? { ...pi, progress: fr } : pi))));
      fillPlaceholder(id, (cur) => ({
        id: cur.id,
        type: kind,
        x: cur.x,
        y: cur.y,
        w,
        h,
        z: cur.z,
        asset_key: key,
        src,
        name: picked.name,
        mime,
        ...(kind === "pdf" ? { size: picked.size } : {}),
      }) as MediaElement);
    } catch {
      onError?.(t("ideaBoard.uploadFailed", { name: picked.name }));
    } finally {
      setPending((p) => p.filter((pi) => pi.id !== pid));
    }
  }
  async function fillPlaceholderWithLink(id: string, rawUrl: string) {
    const ph = dataRef.current.elements.find((x): x is PlaceholderElement => x.id === id && x.type === "placeholder");
    if (!ph) return;
    const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    let preview: LinkPreview | null = null;
    try {
      preview = fetchLinkPreview ? await fetchLinkPreview(url) : null;
    } catch {
      onError?.(t("ideaBoard.linkFailed"));
    }
    fillPlaceholder(id, (cur) => ({
      id: cur.id,
      type: "link",
      x: cur.x,
      y: cur.y,
      w: cur.w,
      h: preview?.image_src ? Math.max(cur.h, 288) : 120,
      z: cur.z,
      url: preview?.url ?? url,
      title: preview?.title ?? "",
      description: preview?.description ?? "",
      site_name: preview?.site_name ?? "",
      ...(preview?.image_key ? { image_key: preview.image_key, image_src: preview.image_src } : {}),
    }) as LinkElement);
  }
  const placeholderFileRef = useRef<HTMLInputElement>(null);
  const placeholderTarget = useRef<string | null>(null);
  /** the placeholder under a point that takes this kind of thing */
  function placeholderAt(w: Point, exclude: Set<string>, accepts: (ph: PlaceholderElement) => boolean): PlaceholderElement | null {
    const hiddenNow = hiddenElementIds(dataRef.current.elements);
    let best: PlaceholderElement | null = null;
    for (const x of dataRef.current.elements) {
      if (x.type !== "placeholder" || exclude.has(x.id) || hiddenNow.has(x.id) || !accepts(x)) continue;
      if (w.x < x.x || w.x > x.x + x.w || w.y < x.y || w.y > x.y + x.h) continue;
      if (!best || x.z > best.z) best = x;
    }
    return best;
  }
  const takesFiles = (ph: PlaceholderElement) => MEDIA_SLOTS.includes(ph.slot);
  /** a board node that can go into a placeholder: any file into a file slot,
   * a link into a link slot, a color card into a color slot */
  function placeholderTakes(ph: PlaceholderElement, node: BoardElement): boolean {
    if (MEDIA_SLOTS.includes(node.type as PlaceholderElement["slot"])) return takesFiles(ph);
    if (node.type === "link") return ph.slot === "link";
    if (node.type === "color") return ph.slot === "color";
    return false;
  }

  // ── to-do lists ───────────────────────────────────────────────────────
  const todoCtx = useContext(BoardTodoContext);
  async function addTodo(at: Point, avoidOverlap = true) {
    const todoApi = todoCtx?.api;
    if (!todoApi) return;
    const w = 336;
    const h = 120;
    const spot = place(at.x - w / 2, at.y - h / 2, w, h, avoidOverlap);
    try {
      const list = await todoApi.createList(t("ideaBoard.todoDefaultName"));
      const el: TodoElement = { id: newId(), type: "todo", x: spot.x, y: spot.y, w, h, z: maxZ(dataRef.current.elements) + 1, list_id: list.id, title: list.name };
      addElements([el]);
    } catch {
      onError?.(t("ideaBoard.todoCreateFailed"));
    }
  }

  // ── palette + location cards (2026-10-08) ─────────────────────────────
  // edited in a popup; `id` null = a new card at `at`
  const [cardEditor, setCardEditor] = useState<{ kind: "palette" | "location" | "color"; id: string | null; at: Point } | null>(null);

  function saveColor(hex: string, name: string) {
    const ed = cardEditor;
    setCardEditor(null);
    if (!ed) return;
    if (ed.id && dataRef.current.elements.some((x) => x.id === ed.id && x.type === "placeholder")) {
      fillPlaceholder(ed.id, (ph) => ({ id: ph.id, type: "color", x: ph.x, y: ph.y, w: ph.w, h: ph.h, z: ph.z, hex, name: name || ph.title }) as ColorElement);
      return;
    }
    if (ed.id) {
      updateElement(ed.id, { hex, name } as Partial<ColorElement>, { history: true });
      return;
    }
    const w = 192;
    const h = 290;
    const spot = place(ed.at.x - w / 2, ed.at.y - h / 2, w, h, true);
    addElements([{ id: newId(), type: "color", x: spot.x, y: spot.y, w, h, z: maxZ(dataRef.current.elements) + 1, hex, name } as ColorElement]);
  }
  const [cardBusy, setCardBusy] = useState(false);

  function savePalette(title: string, colors: string[]) {
    const ed = cardEditor;
    setCardEditor(null);
    if (!ed) return;
    if (ed.id) {
      updateElement(ed.id, { title, colors } as Partial<PaletteElement>, { history: true });
      return;
    }
    const w = 360;
    const h = 150;
    const spot = place(ed.at.x - w / 2, ed.at.y - h / 2, w, h, true);
    const el: PaletteElement = { id: newId(), type: "palette", x: spot.x, y: spot.y, w, h, z: maxZ(dataRef.current.elements) + 1, title, colors };
    addElements([el]);
  }

  async function saveLocation(title: string, address: string, lat: number | null, lng: number | null, style: "satellite" | "map") {
    const ed = cardEditor;
    if (!ed) return;
    const prev = ed.id ? (dataRef.current.elements.find((e) => e.id === ed.id) as LocationElement | undefined) : undefined;
    let map: { key: string; src: string; style?: "satellite" | "map" } | null = null;
    // a new map image when the spot moved or another view was picked
    const moved = !prev || prev.lat !== lat || prev.lng !== lng || (prev.map_style ?? "map") !== style;
    if (lat != null && lng != null && moved && createLocationMap) {
      setCardBusy(true);
      try {
        map = await createLocationMap(lat, lng, style);
      } catch {
        onError?.(t("ideaBoard.location.mapFailed"));
      } finally {
        setCardBusy(false);
      }
    }
    setCardEditor(null);
    const patch: Partial<LocationElement> = {
      title,
      address,
      lat,
      lng,
      ...(map ? { image_key: map.key, image_src: map.src, map_style: map.style ?? style } : moved ? { image_key: undefined, image_src: null } : {}),
    };
    if (prev) {
      updateElement(prev.id, patch, { history: true });
      return;
    }
    const w = 320;
    const h = 280;
    const spot = place(ed.at.x - w / 2, ed.at.y - h / 2, w, h, true);
    addElements([{ id: newId(), type: "location", x: spot.x, y: spot.y, w, h, z: maxZ(dataRef.current.elements) + 1, title, address, ...patch } as LocationElement]);
  }

  async function paletteFromImage(id: string) {
    const img = dataRef.current.elements.find((e) => e.id === id);
    if (!img || img.type !== "image" || !extractPalette) return;
    try {
      const colors = await extractPalette(img.asset_key);
      const w = 360;
      const h = 150;
      const spot = place(img.x + img.w + GRID, img.y, w, h, true);
      const el: PaletteElement = { id: newId(), type: "palette", x: spot.x, y: spot.y, w, h, z: maxZ(dataRef.current.elements) + 1, title: "", colors };
      addElements([el]);
      setSelection(new Set([el.id]));
    } catch (e) {
      onError?.(e instanceof Error && e.message ? e.message : t("ideaBoard.palette.failed"));
    }
  }

  /** 2026-10-08, Lino: sort a group's members — one row, or a grid
   * (≈ square, reading order kept); the frame follows (normalizeGroups) */
  function arrangeGroup(groupId: string, mode: "row" | "grid") {
    const els = dataRef.current.elements;
    const g = els.find((e) => e.id === groupId);
    if (!g || g.type !== "group") return;
    const members = els.filter((e) => g.children.includes(e.id));
    if (members.length < 2) return;
    // reading order: rows (by top, with tolerance), then left to right
    const sorted = [...members].sort((a, b) => (Math.abs(a.y - b.y) > GRID * 2 ? a.y - b.y : a.x - b.x));
    const gap = GRID;
    const x0 = Math.min(...members.map((m) => m.x));
    const y0 = Math.min(...members.map((m) => m.y));
    const cols = mode === "row" ? sorted.length : Math.ceil(Math.sqrt(sorted.length));
    // columns as wide as their widest member, so a grid lines up
    const colX: number[] = [];
    for (let c = 0, x = x0; c < cols; c++) {
      colX.push(x);
      const w = Math.max(0, ...sorted.filter((_, i) => i % cols === c).map((m) => m.w));
      x = snap(x + w + gap);
    }
    const pos = new Map<string, Point>();
    let y = y0;
    for (let r = 0; r * cols < sorted.length; r++) {
      const row = sorted.slice(r * cols, r * cols + cols);
      row.forEach((m, c) => pos.set(m.id, { x: colX[c], y }));
      y = snap(y + Math.max(...row.map((m) => m.h)) + gap);
    }
    commit((d) => ({ ...d, elements: d.elements.map((el) => (pos.has(el.id) ? ({ ...el, ...pos.get(el.id)! } as BoardElement) : el)) }));
  }

  // ── storyboard + presentation (2026-10-08) ────────────────────────────
  const [presenting, setPresenting] = useState<number | null>(null);
  const storyScenes = useMemo(() => {
    const hiddenNow = hiddenElementIds(data.elements);
    return data.elements
      .filter((el): el is SceneElement => el.type === "scene" && !hiddenNow.has(el.id))
      .sort((a, b) => a.number - b.number || a.y - b.y || a.x - b.x);
  }, [data.elements]);

  /** the presentation shows EVERY scene of the board, lowest number first —
   * also those folded away in a collapsed group (2026-10-09, Lino) */
  const presentScenes = useMemo(
    () => data.elements.filter((el): el is SceneElement => el.type === "scene").sort((a, b) => a.number - b.number || a.y - b.y || a.x - b.x),
    [data.elements],
  );
  // the storyboard/presentation bar (bottom right)
  const storyBar = presentScenes.length > 0 && (allowPresentation || (editable && storyScenes.length > 1));

  /** "Storyboard anordnen": the scene cards in number order as a grid
   * (4 per row), starting where the scenes currently begin; one undo step. */
  function arrangeStoryboard() {
    const scenes = storyScenes;
    if (!scenes.length) return;
    const cols = 4;
    const gap = GRID * 2;
    const x0 = snap(Math.min(...scenes.map((s) => s.x)));
    const y0 = snap(Math.min(...scenes.map((s) => s.y)));
    const colW = Math.max(...scenes.map((s) => s.w));
    const layout = (ox: number, oy: number) => {
      const pos = new Map<string, Point>();
      let y = oy;
      for (let r = 0; r * cols < scenes.length; r++) {
        const row = scenes.slice(r * cols, r * cols + cols);
        row.forEach((s, i) => pos.set(s.id, { x: ox + i * (colW + gap), y }));
        y += Math.max(...row.map((s) => s.h)) + gap;
      }
      return pos;
    };
    // where the scenes begin — unless other nodes are in the way, then the
    // storyboard goes below everything else on the board
    const sceneIds = new Set(scenes.map((s) => s.id));
    const hiddenNow = hiddenElementIds(dataRef.current.elements);
    const others = dataRef.current.elements.filter(
      (el) => !sceneIds.has(el.id) && !hiddenNow.has(el.id) && el.type !== "drawing" && !(el.type === "group" && !el.collapsed),
    );
    let pos = layout(x0, y0);
    const hits = (p: Map<string, Point>) =>
      scenes.some((s) => {
        const q = p.get(s.id)!;
        return others.some((o) => q.x < o.x + o.w && q.x + s.w > o.x && q.y < o.y + o.h && q.y + s.h > o.y);
      });
    if (hits(pos)) {
      const below = boundsOf(others)!;
      pos = layout(x0, snap(below.y + below.h + gap * 2));
    }
    commit((d) => ({ ...d, elements: d.elements.map((el) => (pos.has(el.id) ? ({ ...el, ...pos.get(el.id)! } as BoardElement) : el)) }));
    setSelection(new Set(scenes.map((s) => s.id)));
    const cards = scenes.map((s) => ({ ...s, ...pos.get(s.id)! }));
    requestAnimationFrame(() => zoomToRect(boundsOf(cards), { animate: true }));
  }

  // ── scene cards ───────────────────────────────────────────────────────
  const sceneImageInputRef = useRef<HTMLInputElement>(null);
  const sceneImageTarget = useRef<string | null>(null);
  /** scene whose edit mode was opened by "+ Dialog" (starts with a new empty line) */
  const dialogueOnEdit = useRef<string | null>(null);

  function addScene(at: Point, avoidOverlap = false) {
    const w = 312;
    const h = 300;
    const spot = place(at.x - w / 2, at.y - h / 2, w, h, avoidOverlap);
    const el: SceneElement = {
      id: newId(),
      type: "scene",
      x: spot.x,
      y: spot.y,
      w,
      h,
      z: maxZ(dataRef.current.elements) + 1,
      number: nextSceneNumber(dataRef.current.elements),
      title: "",
      html: "",
    };
    addElements([el]);
    setTool("select");
    setEditingId(el.id);
  }

  /** An image card becomes a scene card in place (same id, so its connectors
   * stay attached); the image is taken over as the scene's image. */
  function convertToScene(id: string) {
    const el = dataRef.current.elements.find((e) => e.id === id);
    if (!el || el.type !== "image") return;
    const scene: SceneElement = {
      id: el.id,
      type: "scene",
      x: el.x,
      y: el.y,
      w: Math.max(312, el.w),
      h: 300,
      z: el.z,
      number: nextSceneNumber(dataRef.current.elements),
      title: "",
      html: "",
      image_key: el.asset_key,
      image_src: el.src ?? null,
      ...(el.w > 0 && el.h > 0 ? { image_ratio: Math.round((el.w / el.h) * 1000) / 1000 } : {}),
    };
    commit((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? scene : e)) }));
    setSelection(new Set([id]));
    setEditingId(id);
  }

  function commitScene(id: string, patch: { title?: string; html?: string; dialogues?: string[] }) {
    const el = dataRef.current.elements.find((e) => e.id === id);
    if (!el || el.type !== "scene") return;
    const next: Partial<SceneElement> = {};
    if (patch.dialogues !== undefined) {
      // empty lines are kept while typing in edit mode, but never saved
      const lines = patch.dialogues.map((l) => l.trim()).filter(Boolean);
      if (JSON.stringify(lines) !== JSON.stringify(el.dialogues ?? [])) next.dialogues = lines;
    }
    if (patch.title !== undefined && patch.title.trim() !== el.title) next.title = patch.title.trim();
    if (patch.html !== undefined) {
      const html = boardHtmlToPlain(patch.html) ? sanitizeBoardHtml(patch.html) : "";
      if (html !== el.html) next.html = html;
    }
    if (Object.keys(next).length) updateElement(id, next, { history: true });
  }

  /** Moves a scene one place up/down in the shot-list order: it takes the
   * target number and the scene that had it gets this scene's old number,
   * so the numbering stays unique. */
  function setSceneNumber(id: string, delta: number) {
    const el = dataRef.current.elements.find((e) => e.id === id);
    if (!el || el.type !== "scene") return;
    const target = Math.max(1, el.number + delta);
    if (target === el.number) return;
    commit((d) => ({
      ...d,
      elements: d.elements.map((e) => {
        if (e.id === id) return { ...e, number: target } as BoardElement;
        if (e.type === "scene" && e.number === target) return { ...e, number: el.number };
        return e;
      }),
    }));
  }

  function pickSceneImage(id: string) {
    sceneImageTarget.current = id;
    sceneImageInputRef.current?.click();
  }

  async function setSceneImage(id: string, file: File) {
    if (!uploadFile) return;
    const mime = guessMime(file);
    if (!mime.startsWith("image/")) {
      onError?.(t("ideaBoard.unsupportedType", { name: file.name }));
      return;
    }
    const el = dataRef.current.elements.find((e) => e.id === id);
    if (!el) return;
    const pid = newId();
    setPending((p) => [...p, { id: pid, label: file.name, progress: 0, x: el.x, y: el.y, w: el.w, h: 64 }]);
    try {
      const { key, src } = await uploadFile(file, mime, (f) => setPending((p) => p.map((it) => (it.id === pid ? { ...it, progress: f } : it))));
      updateElement(id, { image_key: key, image_src: src } as Partial<SceneElement>, { history: true });
    } catch {
      onError?.(t("ideaBoard.uploadFailed", { name: file.name }));
    } finally {
      setPending((p) => p.filter((it) => it.id !== pid));
    }
  }

  // AI image for a scene card (2026-10-08): popup (style / format / prompt),
  // the card pulses while the job runs, the result becomes the scene image
  const [aiFor, setAiFor] = useState<string | null>(null);
  const [aiRunning, setAiRunning] = useState<Set<string>>(new Set());
  async function runSceneAi(id: string, prompt: string, style: BoardImageStyle, aspect: "16:9" | "9:16") {
    if (!generateImage) return;
    setAiRunning((s) => new Set(s).add(id));
    try {
      const { key, src } = await generateImage(prompt, style, aspect);
      if (dataRef.current.elements.some((e) => e.id === id)) updateElement(id, { image_key: key, image_src: src } as Partial<SceneElement>, { history: true });
    } catch (e) {
      if (e instanceof Error && e.message) onError?.(e.message);
    } finally {
      setAiRunning((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  }

  function removeSceneImage(id: string) {
    updateElement(id, { image_key: undefined, image_src: undefined } as Partial<SceneElement>, { history: true });
  }

  // ── right-click / long-press menu ─────────────────────────────────────
  const [menu, setMenu] = useState<{ x: number; y: number; world: Point; targetId: string | null; linkInput: boolean; fillId?: string } | null>(null);
  const uploadAtRef = useRef<Point | null>(null);

  function openContextMenu(clientX: number, clientY: number, targetId: string | null) {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (targetId && !selectionRef.current.has(targetId)) setSelection(new Set([targetId]));
    if (!targetId) setSelectedConnector(null);
    setMenu({ x: clientX - rect.left, y: clientY - rect.top, world: toWorld(clientX, clientY), targetId, linkInput: false });
  }

  function setCover(id: string | null) {
    commit((d) => ({ ...d, cover: id }));
  }

  function menuAction(fn: () => void) {
    setMenu(null);
    fn();
  }
  // what the quick add (Shift + Space) can place — the words cover German,
  // English and the usual synonyms
  const quickAddItems: QuickAddItem[] = [
    { id: "text", icon: "T", label: t("ideaBoard.menu.text"), hint: "T", keywords: "text textbox schrift titel überschrift notiz text box heading" },
    { id: "sticky", icon: "🟨", label: t("ideaBoard.menu.sticky"), hint: "N", keywords: "notizzettel post-it postit zettel klebezettel notiz sticky note" },
    { id: "scene", icon: "🎬", label: t("ideaBoard.menu.scene"), hint: "S", keywords: "szene szenenkarte shot einstellung storyboard scene card" },
    { id: "moodboard", icon: "▦", label: t("ideaBoard.menu.moodboard"), keywords: "moodboard bilder collage galerie referenzen images gallery" },
    { id: "upload", icon: "🖼", label: t("ideaBoard.menu.upload"), keywords: "bild foto video audio pdf datei hochladen upload image photo file" },
    { id: "link", icon: "🔗", label: t("ideaBoard.menu.link"), keywords: "link url webseite website youtube vimeo instagram" },
    { id: "color", icon: "🎨", label: t("ideaBoard.menu.color"), keywords: "farbe hex farbcode swatch color colour" },
    { id: "palette", icon: "🌈", label: t("ideaBoard.menu.palette"), keywords: "farbpalette palette farben colors colours" },
    ...(createLocationMap ? [{ id: "location", icon: "📍", label: t("ideaBoard.menu.location"), keywords: "location ort adresse karte drehort map address satellit" }] : []),
    ...(todoCtx?.api ? [{ id: "todo", icon: "☑️", label: t("ideaBoard.menu.todo"), keywords: "todo to-do aufgaben liste checkliste tasks checklist" }] : []),
    ...(gifMaker ? [{ id: "gif", icon: "🎞", label: t("ideaBoard.menu.gif"), keywords: "gif animation loop clip video ausschnitt" }] : []),
    { id: "draw", icon: "✏️", label: t("ideaBoard.menu.draw"), hint: "P", keywords: "zeichnen malen stift skizze draw pen sketch" },
    ...(templates ? [{ id: "template", icon: "▤", label: t("ideaBoard.templates.quickAdd"), keywords: "template vorlage layout struktur laden speichern preset" }] : []),
  ];
  function quickAddPick(id: string) {
    const q = quickAdd;
    setQuickAdd(null);
    if (!q) return;
    const at = q.world;
    switch (id) {
      case "text": return addText(at);
      case "sticky": return addSticky(at);
      case "scene": return addScene(at, true);
      case "moodboard": return addMoodboard(at);
      case "todo": return void addTodo(at);
      case "gif": return setGifAt(at);
      case "color": return setCardEditor({ kind: "color", id: null, at });
      case "palette": return setCardEditor({ kind: "palette", id: null, at });
      case "location": return setCardEditor({ kind: "location", id: null, at });
      case "draw": return setTool("draw");
      case "template": return setTemplatesOpen(true);
      case "upload":
        uploadAtRef.current = at;
        fileInputRef.current?.click();
        return;
      case "link": {
        const rect = viewportRef.current?.getBoundingClientRect();
        if (rect) setMenu({ x: q.client.x - rect.left, y: q.client.y - rect.top, world: at, targetId: null, linkInput: true });
        return;
      }
    }
  }


  function activate(el: BoardElement) {
    if (el.type === "group" && editable) {
      setSelection(new Set([el.id]));
      setEditingId(el.id);
      return;
    }
    if (el.type === "moodboard" && editable) {
      setSelection(new Set([el.id]));
      return;
    }
    if (el.type === "placeholder" && editable) {
      setSelection(new Set([el.id]));
      if (el.slot === "color") setCardEditor({ kind: "color", id: el.id, at: { x: el.x, y: el.y } });
      else if (el.slot === "link") {
        const rect = viewportRef.current?.getBoundingClientRect();
        const v = viewRef.current;
        if (rect) setMenu({ x: el.x * v.scale + v.x, y: (el.y + el.h / 2) * v.scale + v.y, world: { x: el.x, y: el.y }, targetId: null, linkInput: true, fillId: el.id });
      } else {
        placeholderTarget.current = el.id;
        placeholderFileRef.current?.click();
      }
      return;
    }
    if ((el.type === "palette" || el.type === "location" || el.type === "color") && editable) {
      setSelection(new Set([el.id]));
      setCardEditor({ kind: el.type, id: el.id, at: { x: el.x, y: el.y } });
      return;
    }
    if ((el.type === "text" || el.type === "scene" || el.type === "sticky") && editable) {
      editingStartHtml.current = el.html;
      setSelection(new Set([el.id]));
      setEditingId(el.id);
    } else if (el.type === "link") {
      window.open(el.url, "_blank", "noopener,noreferrer");
    } else if ((el.type === "pdf" || el.type === "file" || el.type === "image") && el.src) {
      window.open(el.src, "_blank", "noopener,noreferrer");
    }
  }

  // ── pointer handling ──────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.closest("[data-board-ui]")) return;
    // pin mode: a click on a node places the feedback pin at that spot
    if (pinPlacing && onPlacePin && e.button === 0 && pointers.current.size === 0) {
      const node = target.closest<HTMLElement>("[data-el-id]");
      const el = node ? dataRef.current.elements.find((x) => x.id === node.dataset.elId) : null;
      if (el && el.type !== "drawing") {
        const w = toWorld(e.clientX, e.clientY);
        e.preventDefault();
        onPlacePin({ elementId: el.id, x: clamp((w.x - el.x) / Math.max(1, el.w), 0, 1), y: clamp((w.y - el.y) / Math.max(1, el.h), 0, 1) });
        return;
      }
    }
    if (menu) setMenu(null);
    // 2026-10-09, Lino: press and hold the middle mouse button (wheel) = move
    // the view like the hand tool — anywhere, also over text, links, videos;
    // preventDefault stops the browser's own middle-click auto-scroll
    if (e.pointerType === "mouse" && e.button === 1) {
      e.preventDefault();
      if (editingRef.current) finishEditing();
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      viewportRef.current?.setPointerCapture(e.pointerId);
      opRef.current = { kind: "pan", pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current, moved: false, onElement: null, middle: true };
      setPanning(true);
      return;
    }
    if (target.closest("[contenteditable='true'], input, textarea")) return;
    // the empty inside of an open group's (blurred) frame acts like the empty board
    const elNode = target.closest("[data-group-body]") && !target.closest("[data-group-header]") ? null : target.closest<HTMLElement>("[data-el-id]");
    if (target.closest("[data-no-drag]")) {
      // media controls / links inside a card: let the browser handle the click
      if (editable && elNode) {
        setSelection(new Set([elNode.dataset.elId!]));
        setSelectedConnector(null);
      }
      return;
    }
    if (e.pointerType === "mouse" && e.button > 2) return;
    if (linkOpen) setLinkOpen(false);

    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    viewportRef.current?.setPointerCapture(e.pointerId);

    if (pointers.current.size === 2) {
      // second finger: whatever the first one started becomes a pinch
      const op = opRef.current;
      if (op && op.kind === "move" && op.moved) apply(dataRef.current, { history: op.snapshot });
      setDrawPreview(null);
      setMarquee(null);
      setConnectPreview(null);
      const [a, b] = [...pointers.current.values()];
      opRef.current = {
        kind: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: viewRef.current,
      };
      setBusyOp(null);
      setGuides(null);
      return;
    }
    if (pointers.current.size > 2) return;

    if (editingRef.current) finishEditing();
    const world = toWorld(e.clientX, e.clientY);

    // panning without touch: middle/right mouse button, Space held, or the hand tool
    if (e.button === 1 || e.button === 2 || spaceHeld.current || tool === "hand") {
      opRef.current = {
        kind: "pan",
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        view: viewRef.current,
        moved: false,
        onElement: e.button === 2 ? elNode?.dataset.elId ?? null : null,
        rightClick: e.button === 2,
      };
      setPanning(true);
      return;
    }

    if (editable && tool === "draw") {
      opRef.current = { kind: "draw", pointerId: e.pointerId, points: [[world.x, world.y]] };
      setDrawPreview([[world.x, world.y]]);
      setSelection(new Set());
      return;
    }

    const handle = target.closest<HTMLElement>("[data-handle]");
    if (editable && handle && elNode) {
      const id = elNode.dataset.elId!;
      const el = dataRef.current.elements.find((x) => x.id === id);
      if (!el) return;
      if (handle.dataset.handle === "connect") {
        opRef.current = { kind: "connect", pointerId: e.pointerId, from: id, target: null };
        setConnectPreview({ from: id, to: world, target: null });
        return;
      }
      const header = el.type === "video" ? VIDEO_HEADER : 0;
      const keepAspect = el.type === "image" || el.type === "video";
      opRef.current = {
        kind: "resize",
        pointerId: e.pointerId,
        id,
        sx: e.clientX,
        sy: e.clientY,
        w: el.w,
        h: el.h,
        aspect: keepAspect ? el.w / Math.max(1, el.h - header) : null,
        header,
        snapshot: dataRef.current,
      };
      setBusyOp("resize");
      return;
    }

    const connNode = target.closest<SVGElement>("[data-connector-id]");
    if (editable && connNode) {
      setSelectedConnector(connNode.dataset.connectorId ?? null);
      setSelection(new Set());
      opRef.current = null;
      return;
    }

    if (elNode && editable) {
      const id = elNode.dataset.elId!;
      setSelectedConnector(null);
      let ids = selectionRef.current;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        ids = new Set(ids);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        setSelection(ids);
        if (!ids.has(id)) return;
      } else if (!ids.has(id)) {
        ids = new Set([id]);
        setSelection(ids);
      }
      const moving = new Set(ids);
      for (const el of dataRef.current.elements) if (el.type === "group" && ids.has(el.id)) el.children.forEach((c) => moving.add(c));
      const origin = new Map<string, Point>();
      for (const el of dataRef.current.elements) if (moving.has(el.id)) origin.set(el.id, { x: el.x, y: el.y });
      opRef.current = {
        kind: "move",
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        ids: [...ids],
        origin,
        // dragging a group snaps its members to the grid, not the frame
        primary: (() => {
          const el = dataRef.current.elements.find((x) => x.id === id);
          return el?.type === "group" ? el.children.find((c) => origin.has(c)) ?? id : id;
        })(),
        moved: false,
        snapshot: dataRef.current,
        clickedId: id,
        onGroupTitle: !!target.closest("[data-group-title]"),
        wasSelected: selectionRef.current.size === 1 && selectionRef.current.has(id),
        ...(() => {
          const all = dataRef.current.elements;
          const hiddenNow = hiddenElementIds(all);
          const movingEls = all.filter((el) => moving.has(el.id) && !(el.type === "group" && !el.collapsed));
          return {
            box: boundsOf(movingEls.length ? movingEls : all.filter((el) => moving.has(el.id))) ?? { x: 0, y: 0, w: 0, h: 0 },
            others: all
              .filter((el) => !moving.has(el.id) && !hiddenNow.has(el.id) && el.type !== "drawing")
              // an open group that contains what's being moved isn't a target
              .filter((el) => !(el.type === "group" && !el.collapsed && el.children.some((c) => moving.has(c))))
              .map((el) => ({ x: el.x, y: el.y, w: el.w, h: el.h })),
          };
        })(),
      };
      return;
    }

    // 2026-10-08, Lino: click-and-drag on the empty board draws a selection
    // rectangle (mouse/pen); with Shift it adds to the current selection.
    // A finger on the empty board still pans (touch has two-finger zoom and
    // no hover, a rectangle there would block moving around).
    if (editable && !elNode && e.pointerType !== "touch") {
      opRef.current = {
        kind: "marquee",
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        x0: world.x,
        y0: world.y,
        base: e.shiftKey || e.metaKey ? new Set(selectionRef.current) : new Set(),
        moved: false,
      };
      return;
    }
    const panOp: Op = {
      kind: "pan",
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      view: viewRef.current,
      moved: false,
      onElement: elNode?.dataset.elId ?? null,
    };
    opRef.current = panOp;
    if (editable && e.pointerType === "touch") {
      // long press with a finger = the right-click menu (iPad without trackpad)
      const cx = e.clientX;
      const cy = e.clientY;
      const elId = elNode?.dataset.elId ?? null;
      window.setTimeout(() => {
        if (opRef.current === panOp && !panOp.moved) {
          opRef.current = null;
          openContextMenu(cx, cy, elId);
        }
      }, 550);
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType !== "touch") lastPointer.current = { x: e.clientX, y: e.clientY };
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (onPresenceRef.current && e.pointerType !== "touch") onPresenceRef.current({ cursor: toWorld(e.clientX, e.clientY) });
    const op = opRef.current;
    if (!op) return;

    if (op.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const rect = viewportRef.current!.getBoundingClientRect();
      const s = clamp(op.view.scale * (dist / op.dist), MIN_SCALE, MAX_SCALE);
      const wx = (op.center.x - rect.left - op.view.x) / op.view.scale;
      const wy = (op.center.y - rect.top - op.view.y) / op.view.scale;
      const next = { scale: s, x: center.x - rect.left - wx * s, y: center.y - rect.top - wy * s };
      viewRef.current = next;
      setView(next);
      return;
    }
    if ("pointerId" in op && op.pointerId !== e.pointerId) return;

    const scale = viewRef.current.scale;
    const freePlace = e.altKey;
    switch (op.kind) {
      case "pan": {
        const dx = e.clientX - op.sx;
        const dy = e.clientY - op.sy;
        if (!op.moved && Math.hypot(dx, dy) < 4) return;
        op.moved = true;
        const next = { ...op.view, x: op.view.x + dx, y: op.view.y + dy };
        viewRef.current = next;
        setView(next);
        return;
      }
      case "move": {
        const dx = (e.clientX - op.sx) / scale;
        const dy = (e.clientY - op.sy) / scale;
        if (!op.moved && Math.hypot(e.clientX - op.sx, e.clientY - op.sy) < 4) return;
        if (!op.moved) setBusyOp("move");
        op.moved = true;
        const p = op.origin.get(op.primary)!;
        let ddx = snap(p.x + dx, !freePlace) - p.x;
        let ddy = snap(p.y + dy, !freePlace) - p.y;
        // 2026-10-08, Lino: smart guides — edges/centers within a few screen
        // pixels of another node's edges/centers snap onto them exactly
        const g = smartGuides(op.box, ddx, ddy, op.others, GUIDE_SNAP_PX / scale);
        ddx = g.ddx;
        ddy = g.ddy;
        setGuides(g.lines.length ? g.lines : null);
        // dragging image cards: the scene card (one image) or moodboard under
        // the pointer is highlighted as the place they'll go into
        {
          const moving = dataRef.current.elements.filter((x) => op.origin.has(x.id));
          const images = moving.length > 0 && moving.every((x) => x.type === "image");
          const wp = toWorld(e.clientX, e.clientY);
          const ph = moving.length === 1 ? placeholderAt(wp, new Set(op.origin.keys()), (p) => placeholderTakes(p, moving[0])) : null;
          const target = ph ?? (images ? imageTargetAt(wp, new Set(op.origin.keys()), moving.length === 1 ? ["scene", "moodboard"] : ["moodboard"]) : null);
          if ((target?.id ?? null) !== imageDropTarget) setImageDropTarget(target?.id ?? null);
        }
        const next: BoardData = {
          ...dataRef.current,
          elements: dataRef.current.elements.map((el) => {
            const o = op.origin.get(el.id);
            return o ? ({ ...el, x: o.x + ddx, y: o.y + ddy } as BoardElement) : el;
          }),
        };
        apply(next, { notify: false });
        return;
      }
      case "resize": {
        const dx = (e.clientX - op.sx) / scale;
        const dy = (e.clientY - op.sy) / scale;
        const w = Math.max(GRID * 2, snap(op.w + dx, !freePlace));
        const h = op.aspect
          ? Math.round(w / op.aspect) + op.header
          : Math.max(GRID * 2, snap(op.h + dy, !freePlace));
        updateElement(op.id, { w, h }, { notify: false });
        return;
      }
      case "connect": {
        // the nearest other element within reach becomes the target: it gets
        // highlighted, shows its connection point and the line snaps to it
        const w = toWorld(e.clientX, e.clientY);
        const hiddenNow = hiddenElementIds(dataRef.current.elements);
        const reach = CONNECT_SNAP_PX / viewRef.current.scale;
        let best: { id: string; d: number; area: number } | null = null;
        for (const el of dataRef.current.elements) {
          if (el.id === op.from || hiddenNow.has(el.id) || el.type === "drawing") continue;
          if (el.type === "group" && !el.collapsed && el.children.includes(op.from)) continue;
          const d = distanceToRect(w, el);
          if (d > reach) continue;
          const area = el.w * el.h;
          // inside several (e.g. an element inside a group frame): the smallest wins
          if (!best || d < best.d - 0.5 || (d < 0.5 && best.d < 0.5 && area < best.area)) best = { id: el.id, d, area };
        }
        op.target = best?.id ?? null;
        setConnectPreview({ from: op.from, to: w, target: op.target });
        return;
      }
      case "draw": {
        const w = toWorld(e.clientX, e.clientY);
        const last = op.points[op.points.length - 1];
        if (Math.hypot(w.x - last[0], w.y - last[1]) * scale < 2) return;
        op.points.push([w.x, w.y]);
        setDrawPreview([...op.points]);
        return;
      }
      case "marquee": {
        if (!op.moved && Math.hypot(e.clientX - op.sx, e.clientY - op.sy) < 4) return;
        if (!op.moved) setSelectedConnector(null);
        op.moved = true;
        const w = toWorld(e.clientX, e.clientY);
        setMarquee({ x0: op.x0, y0: op.y0, x1: w.x, y1: w.y });
        const minX = Math.min(op.x0, w.x), maxX = Math.max(op.x0, w.x);
        const minY = Math.min(op.y0, w.y), maxY = Math.max(op.y0, w.y);
        const ids = new Set(op.base);
        const hidden = hiddenElementIds(dataRef.current.elements);
        for (const el of dataRef.current.elements) {
          if (hidden.has(el.id)) continue;
          if (el.type === "group" && !el.collapsed) {
            // a frame counts only when the rectangle encloses it completely —
            // otherwise selecting a few things inside a group would grab the whole group
            if (el.x >= minX && el.x + el.w <= maxX && el.y >= minY && el.y + el.h <= maxY) ids.add(el.id);
          } else if (el.x < maxX && el.x + el.w > minX && el.y < maxY && el.y + el.h > minY) ids.add(el.id);
        }
        setSelection(ids);
        return;
      }
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (!editingRef.current) window.setTimeout(focusPasteCatcher, 0);
    const op = opRef.current;
    if (!op) return;
    if (op.kind === "pinch") {
      if (pointers.current.size < 2) opRef.current = null;
      return;
    }
    if (op.pointerId !== e.pointerId) return;
    opRef.current = null;
    setBusyOp(null);
      setGuides(null);
    setPanning(false);

    switch (op.kind) {
      case "pan": {
        if (op.moved || op.middle) return;
        if (op.rightClick) {
          if (editable) openContextMenu(e.clientX, e.clientY, op.onElement);
          return;
        }
        // a click: on an element in read-only mode, or on the empty canvas
        const now = Date.now();
        const last = lastClick.current;
        const isDouble = now - last.time < DOUBLE_CLICK_MS && last.id === op.onElement && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 10;
        lastClick.current = { id: op.onElement, time: isDouble ? 0 : now, x: e.clientX, y: e.clientY };
        if (op.onElement) {
          if (isDouble) {
            const el = dataRef.current.elements.find((x) => x.id === op.onElement);
            if (el) activate(el);
          }
          return;
        }
        setSelection(new Set());
        setSelectedConnector(null);
        if (isDouble && editable) addText(toWorld(e.clientX, e.clientY));
        return;
      }
      case "move": {
        setImageDropTarget(null);
        if (op.moved) {
          // image cards dropped onto a moodboard card go into it (2026-10-08)
          const w = toWorld(e.clientX, e.clientY);
          const els = dataRef.current.elements;
          const moving = els.filter((x) => op.origin.has(x.id));
          // a node dropped onto a template placeholder of its kind takes its
          // place (2026-10-09): placeholder id/spot kept, the node's content moves in
          const phTarget = moving.length === 1 ? placeholderAt(w, new Set(op.origin.keys()), (p) => placeholderTakes(p, moving[0])) : null;
          if (phTarget) {
            const node = moving[0];
            const nodeH = node.type === "image" || node.type === "video" ? Math.round((node.h * phTarget.w) / Math.max(1, node.w)) : node.type === "color" ? phTarget.h : node.h;
            const filled = { ...node, id: phTarget.id, x: phTarget.x, y: phTarget.y, w: phTarget.w, h: nodeH, z: phTarget.z } as BoardElement;
            apply(
              {
                ...dataRef.current,
                elements: els
                  .filter((x) => x.id !== node.id)
                  .map((x) => (x.id === phTarget.id ? filled : x))
                  .map((x) => (x.type === "group" ? { ...x, children: x.children.filter((c) => c !== node.id) } : x)),
                connectors: dataRef.current.connectors
                  .map((c) => ({ ...c, from: c.from === node.id ? phTarget.id : c.from, to: c.to === node.id ? phTarget.id : c.to }))
                  .filter((c) => c.from !== c.to),
              },
              { history: op.snapshot },
            );
            setSelection(new Set([phTarget.id]));
            return;
          }
          // one image dropped onto a scene card becomes (replaces) its image
          // (2026-10-09, Lino) — the image card itself goes into the scene
          const sceneTarget = moving.length === 1 && moving[0].type === "image" ? imageTargetAt(w, new Set(op.origin.keys()), ["scene", "moodboard"]) : null;
          if (sceneTarget?.type === "scene") {
            const img = moving[0] as MediaElement;
            apply(
              {
                ...dataRef.current,
                elements: els
                  .filter((x) => x.id !== img.id)
                  .map((x) =>
                    x.id === sceneTarget.id
                      ? ({ ...x, image_key: img.asset_key, image_src: img.src ?? null, image_thumb_src: img.thumb_src ?? null, image_srcset: img.srcset ?? null, image_ratio: img.w / Math.max(1, img.h) } as BoardElement)
                      : x,
                  )
                  .map((x) => (x.type === "group" ? { ...x, children: x.children.filter((c) => c !== img.id) } : x)),
                connectors: dataRef.current.connectors.filter((c) => c.from !== img.id && c.to !== img.id),
              },
              { history: op.snapshot },
            );
            setSelection(new Set([sceneTarget.id]));
            return;
          }
          const mb = els.find(
            (x): x is MoodboardElement =>
              x.type === "moodboard" && !op.origin.has(x.id) && w.x >= x.x && w.x <= x.x + x.w && w.y >= x.y && w.y <= x.y + x.h,
          );
          if (mb && moving.length && moving.every((x) => x.type === "image")) {
            const ids = new Set(moving.map((x) => x.id));
            const add = moving.map((x) => {
              const img = x as MediaElement;
              return { id: newId(), asset_key: img.asset_key, src: img.src ?? null, name: img.name, mime: img.mime, ...spanFor({ w: img.w, h: img.h }, mb.cols) };
            });
            apply(
              {
                ...dataRef.current,
                elements: els
                  .filter((x) => !ids.has(x.id))
                  .map((x) => (x.id === mb.id && x.type === "moodboard" ? moodboardWith(x, [...moodboardItems(x), ...add].slice(0, 60)) : x))
                  .map((x) => (x.type === "group" ? { ...x, children: x.children.filter((c) => !ids.has(c)) } : x)),
                connectors: dataRef.current.connectors.filter((c) => !ids.has(c.from) && !ids.has(c.to)),
              },
              { history: op.snapshot },
            );
            setSelection(new Set([mb.id]));
            return;
          }
          apply(dataRef.current, { history: op.snapshot });
          return;
        }
        const now = Date.now();
        const last = lastClick.current;
        const isDouble = now - last.time < DOUBLE_CLICK_MS && last.id === op.clickedId;
        lastClick.current = { id: op.clickedId, time: isDouble ? 0 : now, x: e.clientX, y: e.clientY };
        const wasSelected = op.wasSelected;
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) setSelection(new Set([op.clickedId]));
        const clickedEl = dataRef.current.elements.find((x) => x.id === op.clickedId);
        if (!isDouble && wasSelected && clickedEl?.type === "group" && op.onGroupTitle) {
          setEditingId(clickedEl.id);
          return;
        }
        if (isDouble) {
          const el = dataRef.current.elements.find((x) => x.id === op.clickedId);
          if (el) activate(el);
        }
        return;
      }
      case "resize": {
        // a moodboard card resized at its corner: a new row height so the
        // images fill its new shape (while dragging they're just stretched)
        const el = dataRef.current.elements.find((x) => x.id === op.id);
        if (el?.type === "moodboard" && moodboardItems(el).length) {
          // the height then snaps to the content (rows come in steps; nothing cropped)
          const rowH = Math.round(fitMosaicRowH(moodboardItems(el), mbInnerW(el.w), mbInnerH(el.h)) * 100) / 100;
          const h = mbCardH(layoutMosaic(moodboardItems(el), mbInnerW(el.w), rowH).height);
          apply(
            { ...dataRef.current, elements: dataRef.current.elements.map((x) => (x.id === el.id ? { ...el, layout: 4, row_h: rowH, h } : x)) },
            { history: op.snapshot },
          );
          return;
        }
        apply(dataRef.current, { history: op.snapshot });
        return;
      }
      case "connect": {
        setConnectPreview(null);
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-el-id]");
        const to = op.target ?? hit?.dataset.elId;
        if (!to || to === op.from) return;
        const exists = dataRef.current.connectors.some(
          (c) => (c.from === op.from && c.to === to) || (c.from === to && c.to === op.from),
        );
        if (exists) return;
        commit((d) => ({ ...d, connectors: [...d.connectors, { id: newId(), from: op.from, to, color: "#f0f0f0" }] }));
        return;
      }
      case "draw": {
        setDrawPreview(null);
        const pts = op.points;
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const pad = strokeWidth / 2 + 2;
        const minX = Math.min(...xs) - pad;
        const minY = Math.min(...ys) - pad;
        const el: DrawingElement = {
          id: newId(),
          type: "drawing",
          x: Math.round(minX * 10) / 10,
          y: Math.round(minY * 10) / 10,
          w: Math.max(8, Math.max(...xs) - minX + pad),
          h: Math.max(8, Math.max(...ys) - minY + pad),
          z: maxZ(dataRef.current.elements) + 1,
          points: pts.map(([x, y]) => [Math.round((x - minX) * 10) / 10, Math.round((y - minY) * 10) / 10]),
          color: strokeColor,
          stroke_width: strokeWidth,
        };
        addElements([el], false);
        return;
      }
      case "marquee": {
        setMarquee(null);
        if (op.moved) return;
        // no drag: a plain click on the empty board (same as the pan case)
        const now = Date.now();
        const last = lastClick.current;
        const isDouble = now - last.time < DOUBLE_CLICK_MS && last.id === null && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 10;
        lastClick.current = { id: null, time: isDouble ? 0 : now, x: e.clientX, y: e.clientY };
        if (!e.shiftKey && !e.metaKey) setSelection(new Set());
        setSelectedConnector(null);
        if (isDouble) addText(toWorld(e.clientX, e.clientY));
        return;
      }
    }
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    const op = opRef.current;
    if (op && op.kind === "move" && op.moved) apply(dataRef.current, { history: op.snapshot });
    if (op && op.kind === "resize") apply(dataRef.current, { history: op.snapshot });
    opRef.current = null;
    setBusyOp(null);
      setGuides(null);
    setDrawPreview(null);
    setMarquee(null);
    setConnectPreview(null);
  }

  // ── keyboard, paste, drop ─────────────────────────────────────────────
  useEffect(() => {
    function isTyping() {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === pasteCatcherRef.current) return false;
      return a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable;
    }
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") {
        if (menu) {
          setMenu(null);
          return;
        }
        if (editingRef.current) {
          finishEditing();
          e.stopPropagation();
          return;
        }
        if (linkOpen) return setLinkOpen(false);
        if (tool === "draw") return setTool("select");
        if (selectionRef.current.size || selectedConnector) {
          setSelection(new Set());
          setSelectedConnector(null);
          return;
        }
        onEscape?.();
        return;
      }
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (isTyping() || !editable) return;
      if (e.code === "Space" && e.shiftKey && !mod) {
        e.preventDefault();
        openQuickAdd();
        return;
      }
      if (mod && e.key.toLowerCase() === "c" && selectionRef.current.size && !window.getSelection()?.toString()) {
        // the copy event (if the browser fires one) fills the clipboard too
        copySelection();
        return;
      }
      if (mod && e.key.toLowerCase() === "v" && !gifAt) {
        // a real paste event normally follows; if it doesn't, read the clipboard
        const pressedAt = Date.now();
        window.setTimeout(() => {
          if (lastPasteAt.current < pressedAt) void pasteFromClipboardApi();
        }, 150);
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) {
          const g = dataRef.current.elements.find((el) => el.type === "group" && selectionRef.current.has(el.id));
          if (g) ungroup(g.id);
        } else groupSelection();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelection(new Set(dataRef.current.elements.map((el) => el.id)));
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelection();
      } else if (e.key.startsWith("Arrow") && selectionRef.current.size) {
        e.preventDefault();
        const step = e.shiftKey ? GRID * 4 : GRID;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        const ids = selectionRef.current;
        commit((d) => ({ ...d, elements: d.elements.map((el) => (ids.has(el.id) ? { ...el, x: el.x + dx, y: el.y + dy } : el)) }));
      } else if (!mod && e.key.toLowerCase() === "h") {
        setTool("hand");
      } else if (!mod && e.key.toLowerCase() === "v") {
        setTool("select");
      } else if (!mod && e.key.toLowerCase() === "p") {
        setTool("draw");
      } else if (!mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        addSticky(viewportCenterWorld());
      } else if (!mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        addScene(viewportCenterWorld(), true);
      } else if (!mod && e.key.toLowerCase() === "t") {
        e.preventDefault();
        addText(viewportCenterWorld(), true, true);
      }
    }
    function onPaste(e: ClipboardEvent) {
      lastPasteAt.current = Date.now();
      // the GIF maker handles its own paste (a video for the GIF only)
      if (!editable || isTyping() || gifAt) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void addFiles(files, viewportCenterWorld(), true);
        return;
      }
      const text = e.clipboardData?.getData("text/plain")?.trim();
      if (!text) return;
      e.preventDefault();
      pasteText(text);
    }
    function onCopy(e: ClipboardEvent) {
      if (!editable || isTyping() || window.getSelection()?.toString()) return;
      copySelection(e);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    window.addEventListener("copy", onCopy);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("copy", onCopy);
    };
  });

  function pasteText(text: string, at: Point = pointerOrCenterWorld()) {
      if (text.startsWith(BOARD_CLIPBOARD_MARKER)) {
        void pasteNodes(text, at);
        return;
      }
      if (looksLikeUrl(text)) {
        void addLink(text, at, true);
      } else {
        const html = text
          .split(/\r?\n/)
          .map((line) => `<div>${line ? line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "<br>"}</div>`)
          .join("");
        const spot = place(at.x - 144, at.y - 36, 288, 72, true);
        const el: TextElement = { id: newId(), type: "text", x: spot.x, y: spot.y, w: 288, h: 72, z: maxZ(dataRef.current.elements) + 1, html, color: "default" };
        addElements([el]);
      }
  }

  /** Fallback for browsers that don't fire a paste event at all (Safari /
   * Chrome on iPad without a focused editable): read the clipboard directly. */
  async function pasteFromClipboardApi(at: Point = viewportCenterWorld()) {
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        const files: File[] = [];
        for (const item of items) {
          const type = item.types.find((t) => t.startsWith("image/"));
          if (type) {
            const blob = await item.getType(type);
            files.push(new File([blob], `Bild.${type.split("/")[1] || "png"}`, { type }));
          }
        }
        if (files.length) {
          void addFiles(files, at, true);
          return;
        }
      }
      const read: string | undefined = (await navigator.clipboard?.readText?.())?.trim();
      const text = read || recentBoardClipboard();
      if (text) pasteText(text, at);
    } catch {
      // permission denied / not supported — nothing to paste
    }
  }

  /** Keeps keyboard focus on an invisible field while working on the board,
   * so ⌘V / Ctrl+V reaches the board as a real paste event in every browser
   * (Safari and Chrome on iPad only fire paste into something focused). */
  const focusPasteCatcher = useCallback(() => {
    const catcher = pasteCatcherRef.current;
    if (!catcher || !editable) return;
    const a = document.activeElement as HTMLElement | null;
    if (a && a !== catcher && a !== document.body && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return;
    catcher.focus({ preventScroll: true });
  }, [editable]);

  useEffect(() => {
    if (!editingId) {
      dialogueOnEdit.current = null;
      focusPasteCatcher();
    }
  }, [editingId, focusPasteCatcher]);

  // Space held = temporary hand tool (like Figma/Milanote)
  useEffect(() => {
    function typing() {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === pasteCatcherRef.current) return false;
      return a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable;
    }
    function down(e: KeyboardEvent) {
      // Shift + Space opens the quick add instead of panning
      if (e.code !== "Space" || e.shiftKey || typing()) return;
      e.preventDefault();
      if (!spaceHeld.current) {
        spaceHeld.current = true;
        setSpaceDown(true);
      }
    }
    function up(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      spaceHeld.current = false;
      setSpaceDown(false);
    }
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", () => up({ code: "Space" } as KeyboardEvent));
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  function onDrop(e: React.DragEvent) {
    setImageDropTarget(null);
    if (!editable) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    const phFile = files.length === 1 ? placeholderAt(at, new Set(), takesFiles) : null;
    if (phFile) {
      void fillPlaceholderWithFile(phFile.id, files[0]);
      return;
    }
    // the same card the drop hint showed (topmost scene / moodboard under the pointer)
    const sceneEl = imageTargetAt(at, new Set(), files.length === 1 ? ["scene", "moodboard"] : ["moodboard"]);
    if (sceneEl?.type === "moodboard" && files.some((f) => guessMime(f).startsWith("image/"))) {
      void addMoodboardFiles(sceneEl.id, files);
      return;
    }
    if (sceneEl?.type === "scene" && files.length === 1 && guessMime(files[0]).startsWith("image/")) {
      void setSceneImage(sceneEl.id, files[0]);
      return;
    }
    if (files.length) {
      void addFiles(files, at, files.length > 1);
      return;
    }
    const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (uri && looksLikeUrl(uri.split("\n")[0])) {
      const phLink = placeholderAt(at, new Set(), (ph) => ph.slot === "link");
      if (phLink) void fillPlaceholderWithLink(phLink.id, uri.split("\n")[0]);
      else void addLink(uri.split("\n")[0], at);
    }
  }

  // ── rendering helpers ─────────────────────────────────────────────────
  // 2026-10-08, Lino: drawings always lie on top of the nodes — they're
  // rendered as their own layer above everything else (z order kept within
  // each layer); stacking uses the render position, not the raw z
  // 2026-10-08, Lino: an expanded group (frame + its members) lies above the
  // loose nodes, its frame blurring whatever is behind it — so opening a
  // collapsed group next to other nodes doesn't end up in a tangle
  const elements = useMemo(() => {
    const byZ = (a: BoardElement, b: BoardElement) => a.z - b.z;
    const openGroups = data.elements.filter((el): el is GroupElement => el.type === "group" && !el.collapsed).sort(byZ);
    const inOpenGroup = new Set(openGroups.flatMap((g) => g.children));
    const drawings = data.elements.filter((el) => el.type === "drawing").sort(byZ);
    const loose = data.elements.filter((el) => el.type !== "drawing" && !(el.type === "group" && !el.collapsed) && !inOpenGroup.has(el.id)).sort(byZ);
    const grouped = openGroups.flatMap((g) => [
      g,
      ...data.elements.filter((el) => el.type !== "drawing" && g.children.includes(el.id)).sort(byZ),
    ]);
    // a loose node being dragged stays visible above the glass
    if (busyOp === "move" && openGroups.length) {
      const lifted = loose.filter((el) => selection.has(el.id));
      return [...loose.filter((el) => !selection.has(el.id)), ...grouped, ...lifted, ...drawings];
    }
    return [...loose, ...grouped, ...drawings];
  }, [data.elements, busyOp, selection]);
  const hidden = useMemo(() => hiddenElementIds(data.elements), [data.elements]);
  const byId = useMemo(() => new Map(data.elements.map((el) => [el.id, el])), [data.elements]);
  const selectedEls = data.elements.filter((el) => selection.has(el.id));
  const selBounds = boundsOf(selectedEls);
  const labels = {
    textPlaceholder: t("ideaBoard.textPlaceholder"),
    open: t("ideaBoard.open"),
    download: t("ideaBoard.download"),
    missingFile: t("ideaBoard.missingFile"),
    scene: t("ideaBoard.scene"),
    priorities: { must: t("priority.must"), should: t("priority.should"), optional: t("priority.optional") },
    palette: t("ideaBoard.palette.label"),
    stickyPlaceholder: t("ideaBoard.sticky.placeholder"),
    moodboard: t("ideaBoard.moodboard.label"),
    moodboardEmpty: t("ideaBoard.moodboard.empty"),
    moodboardAdd: t("ideaBoard.moodboard.add"),
    voteGroup: t("ideaBoard.vote.label"),
    location: t("ideaBoard.location.label"),
    openInMaps: t("ideaBoard.location.openInMaps"),
    sceneTitlePlaceholder: t("ideaBoard.sceneTitlePlaceholder"),
    sceneTextPlaceholder: t("ideaBoard.sceneTextPlaceholder"),
    addImage: t("ideaBoard.addImage"),
    uploadImage: t("ideaBoard.uploadImage"),
    aiImage: t("ideaBoard.aiImage"),
    aiGenerating: t("ideaBoard.aiGenerating"),
    todoDefaultName: t("ideaBoard.todoDefaultName"),
    todoAddPlaceholder: t("ideaBoard.todoAddPlaceholder"),
    todoMissing: t("ideaBoard.todoMissing"),
    todoUnassign: t("ideaBoard.todoUnassign"),
    todoDelete: t("ideaBoard.todoDelete"),
    todoNoMatch: t("ideaBoard.todoNoMatch"),
    addDialogue: t("ideaBoard.addDialogue"),
    dialoguePlaceholder: t("ideaBoard.dialoguePlaceholder"),
    removeDialogue: t("ideaBoard.removeDialogue"),
    play: t("ideaBoard.playVideo"),
    stop: t("ideaBoard.stopVideo"),
    group: t("ideaBoard.group"),
    groupNamePlaceholder: t("ideaBoard.groupNamePlaceholder"),
    groupItems: t("ideaBoard.groupItems"),
    collapse: t("ideaBoard.collapse"),
    expand: t("ideaBoard.expand"),
    placeholder: {
      image: t("ideaBoard.placeholder.image"),
      video: t("ideaBoard.placeholder.video"),
      audio: t("ideaBoard.placeholder.audio"),
      pdf: t("ideaBoard.placeholder.pdf"),
      file: t("ideaBoard.placeholder.file"),
      link: t("ideaBoard.placeholder.link"),
      color: t("ideaBoard.placeholder.color"),
    },
    placeholderHint: { file: t("ideaBoard.placeholder.hintFile"), link: t("ideaBoard.placeholder.hintLink"), color: t("ideaBoard.placeholder.hintColor") },
  };

  let gridSize = GRID * view.scale;
  while (gridSize < 12) gridSize *= 2;
  const dot = Math.max(0.7, Math.min(1.15, 1.0 * Math.sqrt(view.scale)));
  const handleSize = 12 / view.scale;

  function connectorPath(c: Connector) {
    // an end inside a collapsed group attaches to the group's card instead
    const a = byId.get(hidden.get(c.from) ?? c.from);
    const b = byId.get(hidden.get(c.to) ?? c.to);
    if (!a || !b || a.id === b.id) return null;
    const [s1, s2] = facingSides(a, b);
    return curveGeom(anchorOf(a, s1), s1, anchorOf(b, s2), s2);
  }

  function setConnectorLabel(id: string, label: string) {
    const c = dataRef.current.connectors.find((x) => x.id === id);
    if (!c || (c.label ?? "") === label.trim()) return;
    commit((d) => ({
      ...d,
      connectors: d.connectors.map((x) => {
        if (x.id !== id) return x;
        const next: Connector = { ...x, label: label.trim() };
        if (!next.label) delete next.label;
        return next;
      }),
    }));
  }

  const editingEl = editingId ? byId.get(editingId) : null;
  const showEmptyHint = editable && data.elements.length === 0 && pending.length === 0;

  // where a pin sits in world space — on its node, or on the collapsed
  // group's card while the node is folded away
  function pinPoint(elementId: string, x: number, y: number): Point | null {
    const groupId = hidden.get(elementId);
    const el = byId.get(groupId ?? elementId);
    if (!el) return null;
    if (groupId) return { x: el.x + el.w - 18, y: el.y + 10 };
    return { x: el.x + x * el.w, y: el.y + y * el.h };
  }

  return (
    <BoardDownloadContext.Provider value={downloadFile ?? null}>
    <BoardZoomContext.Provider value={settledScale <= 1.05 ? 1 : settledScale <= 2.1 ? 2 : 4}>
    <BoardScaleContext.Provider value={viewScaleRef}>
    <div
      ref={viewportRef}
      className={`${className.includes("absolute") ? "" : "relative"} overflow-hidden touch-none select-none ${pinPlacing ? "cursor-crosshair [&_*]:!cursor-crosshair" : ""} ${tool === "draw" ? "cursor-crosshair" : panning ? "cursor-grabbing" : tool === "hand" || spaceDown ? "cursor-grab" : ""} ${className}`}
      style={{
        backgroundColor: "#161616",
        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.09) ${dot}px, transparent ${dot + 0.6}px)`,
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${view.x - gridSize / 2}px ${view.y - gridSize / 2}px`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={() => {
        lastPointer.current = null;
        onPresenceRef.current?.({ cursor: null });
      }}
      onDragOver={(e) => {
        if (!editable) return;
        e.preventDefault();
        // a file from the Finder over a scene card / moodboard: show where it goes
        const files = e.dataTransfer.types.includes("Files");
        const one = e.dataTransfer.items.length <= 1;
        const wp = toWorld(e.clientX, e.clientY);
        const target = files ? ((one ? placeholderAt(wp, new Set(), takesFiles) : null) ?? imageTargetAt(wp, new Set(), one ? ["scene", "moodboard"] : ["moodboard"])) : null;
        if ((target?.id ?? null) !== imageDropTarget) setImageDropTarget(target?.id ?? null);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setImageDropTarget(null);
      }}
      onDrop={onDrop}
      // middle-click pans the view — no "open link in new tab" on release
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onContextMenu={(e) => {
        // read-only without downloads (client view): no browser menu either,
        // so no "save image / video as" (2026-10-09, Lino)
        if (!editable && !downloadFile) return e.preventDefault();
        if (editable && !(e.target as HTMLElement).closest("[contenteditable='true'],a,video,audio")) e.preventDefault();
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px)${view.scale === settledScale ? "" : ` scale(${view.scale / settledScale})`}` }}
      >
      <div className="absolute left-0 top-0" style={{ zoom: settledScale }}>
        {/* connectors (under the elements) */}
        <svg className="absolute left-0 top-0 overflow-visible pointer-events-none" width="1" height="1" style={{ zIndex: connectPreview ? 100003 : 0 }}>
          {data.connectors.map((c) => {
            const d = connectorPath(c)?.d;
            if (!d) return null;
            const selected = selectedConnector === c.id;
            return (
              <g key={c.id}>
                <path d={d} stroke="transparent" strokeWidth={16 / view.scale} fill="none" data-connector-id={c.id} style={{ pointerEvents: editable ? "stroke" : "none", cursor: "pointer" }} />
                <path
                  d={d}
                  stroke={selected ? "#3b82f6" : c.color ?? "#f0f0f0"}
                  strokeOpacity={selected ? 1 : 0.7}
                  strokeWidth={1.4 / Math.min(1, view.scale)}
                  fill="none"
                  strokeLinecap="round"
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}
          {connectPreview && byId.get(connectPreview.from) && (() => {
            const src = byId.get(connectPreview.from)!;
            const tgt = connectPreview.target ? byId.get(connectPreview.target) : null;
            const point = { x: connectPreview.to.x, y: connectPreview.to.y, w: 0, h: 0 };
            const [s1, s2] = facingSides(src, tgt ?? point);
            const p1 = anchorOf(src, s1);
            const p2 = tgt ? anchorOf(tgt, s2) : connectPreview.to;
            const r = 7 / view.scale;
            return (
              <g style={{ pointerEvents: "none" }}>
                <path d={curvePath(p1, s1, p2, tgt ? s2 : null)} stroke="#3b82f6" strokeWidth={1.8 / view.scale} fill="none" strokeLinecap="round" />
                <circle cx={p1.x} cy={p1.y} r={r * 0.75} fill="#3b82f6" />
                {tgt && (
                  <>
                    <rect
                      x={tgt.x - 4 / view.scale}
                      y={tgt.y - 4 / view.scale}
                      width={tgt.w + 8 / view.scale}
                      height={tgt.h + 8 / view.scale}
                      rx={10}
                      fill="rgba(59,130,246,0.08)"
                      stroke="#3b82f6"
                      strokeWidth={1.5 / view.scale}
                    />
                    <circle cx={p2.x} cy={p2.y} r={r * 1.8} fill="rgba(59,130,246,0.25)" />
                    <circle cx={p2.x} cy={p2.y} r={r} fill="#ffffff" stroke="#3b82f6" strokeWidth={3 / view.scale} />
                  </>
                )}
              </g>
            );
          })()}
        </svg>

        {/* connector labels — on the line's midpoint, under the nodes */}
        {data.connectors.map((c) => {
          if (!c.label) return null;
          const geom = connectorPath(c);
          if (!geom) return null;
          const selected = selectedConnector === c.id;
          return (
            <div
              key={`label-${c.id}`}
              data-connector-id={c.id}
              className={`absolute max-w-[240px] truncate rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${editable ? "cursor-pointer" : ""} ${selected ? "bg-blue-600 text-white" : "bg-[#1c1c1e] text-white/80 border border-white/15"}`}
              style={{ left: geom.mid.x, top: geom.mid.y, transform: "translate(-50%, -50%)", zIndex: 9 }}
            >
              {c.label}
            </div>
          );
        })}

        {elements.map((el, rank) => {
          if (hidden.has(el.id)) return null;
          const selected = selection.has(el.id);
          const isDrawing = el.type === "drawing";
          const isFrame = el.type === "group" && !el.collapsed;
          const growsWithContent = el.type === "text" || el.type === "link" || el.type === "scene" || el.type === "todo" || el.type === "palette" || el.type === "location" || el.type === "sticky" || el.type === "color";
          const canResize = editable && selected && selection.size === 1 && !isDrawing && el.type !== "audio" && el.type !== "pdf" && el.type !== "file" && el.type !== "group";
          return (
            <div
              key={el.id}
              data-el-id={el.id}
              // draw tool: nodes ignore the pointer so a stroke can start anywhere on top of them
              className={`absolute group ${isDrawing || isFrame || (editable && tool === "draw") ? "pointer-events-none" : ""} ${editable && !isDrawing && !isFrame && editingId !== el.id ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{
                left: el.x,
                top: el.y,
                width: el.w,
                height: growsWithContent ? undefined : el.h,
                zIndex: rank + 10,
                opacity: matches && !matches.has(el.id) ? 0.18 : undefined,
                transition: "opacity .2s",
              }}
            >
              <BoardElementView
                el={el}
                editing={editingId === el.id}
                editable={editable}
                moodboardActive={el.type === "moodboard" && editable && selected && selection.size === 1 && !busyOp}
                onMoodboardChange={(items) => setMoodboardItems(el.id, items)}
                onMoodboardAdd={editable && uploadFile ? () => pickMoodboardImages(el.id) : undefined}
                labels={labels}
                onCommitText={(html) => commitText(el.id, html)}
                onCommitScene={(patch) => commitScene(el.id, patch)}
                onGenerateSceneImage={editable && generateImage ? () => setAiFor(el.id) : undefined}
                sceneGenerating={aiRunning.has(el.id)}
                onRequestDialogue={() => {
                  dialogueOnEdit.current = el.id;
                  setSelection(new Set([el.id]));
                  setEditingId(el.id);
                }}
                addDialogueOnEdit={editingId === el.id && dialogueOnEdit.current === el.id}
                onPickSceneImage={() => pickSceneImage(el.id)}
                groupMembers={el.type === "group" ? el.children.map((c) => byId.get(c)).filter((m): m is BoardElement => !!m) : undefined}
                onToggleGroup={() => toggleGroup(el.id)}
                onCommitGroupTitle={(title) => commitGroupTitle(el.id, title)}
                onMeasure={(h) => updateElement(el.id, { h: Math.ceil(h) }, { notify: editable })}
                onNaturalSize={(nw, nh) => {
                  if (!nw || !nh) return;
                  if (el.type === "scene") {
                    const ratio = Math.round((nw / nh) * 1000) / 1000;
                    if (Math.abs(ratio - (el.image_ratio ?? 0)) > 0.005) updateElement(el.id, { image_ratio: ratio } as Partial<SceneElement>, { notify: editable });
                    return;
                  }
                  const header = el.type === "video" ? VIDEO_HEADER : 0;
                  const want = Math.round((el.w * nh) / nw) + header;
                  if (Math.abs(want - el.h) > 2) updateElement(el.id, { h: want }, { notify: editable });
                }}
              />
              {el.type === "moodboard" && (moodboardBusy[el.id] ?? 0) > 0 && (
                <div
                  className="absolute left-1/2 bottom-3 z-10 pointer-events-none rounded-full bg-black/70 px-3 py-1 text-xs font-semibold text-white animate-pulse whitespace-nowrap"
                  style={{ transform: `translateX(-50%) scale(${1 / Math.max(view.scale, 0.5)})`, transformOrigin: "50% 100%" }}
                >
                  {t("ideaBoard.moodboard.uploading", { count: moodboardBusy[el.id] })}
                </div>
              )}
              {/* download the original (2026-10-08) — every uploaded file */}
              {(() => {
                const f =
                  el.type === "image" || el.type === "video" || el.type === "audio" || el.type === "pdf" || el.type === "file"
                    ? { key: el.asset_key, name: el.name || el.asset_key.split("/").pop() || "download" }
                    : el.type === "scene" && el.image_key
                      ? { key: el.image_key, name: `${el.title || `${t("ideaBoard.scene")} ${el.number}`}.${el.image_key.split(".").pop()}` }
                      : null;
                return f ? <DownloadButton fileKey={f.key} name={f.name} title={t("ideaBoard.download")} scale={1 / Math.max(view.scale, 0.5)} className="right-2 top-2" /> : null;
              })()}
              {data.cover === el.id && (
                <div
                  className="absolute left-2 top-2 z-10 pointer-events-none flex items-center gap-1 rounded-full bg-black/65 backdrop-blur px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white"
                  style={{ transform: `scale(${1 / Math.max(view.scale, 0.5)})`, transformOrigin: "top left" }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" /></svg>
                  {t("ideaBoard.thumbnailBadge")}
                </div>
              )}
              {selected && (
                <div
                  className="absolute pointer-events-none rounded-[12px]"
                  style={{
                    inset: -4 / view.scale,
                    border: `${2 / view.scale}px solid #3b82f6`,
                    borderRadius: 12,
                  }}
                />
              )}
              {canResize && editingId !== el.id && (
                <div
                  data-handle="resize"
                  className="absolute rounded-full bg-white border-2 border-blue-500 cursor-nwse-resize"
                  style={{ width: handleSize, height: handleSize, right: -handleSize / 2 - 2 / view.scale, bottom: -handleSize / 2 - 2 / view.scale, borderWidth: 2 / view.scale }}
                />
              )}
              {editable && tool === "select" && !isDrawing && editingId !== el.id && !connectPreview &&
                (["right", "left", "top", "bottom"] as const).map((side) => {
                  const out = -handleSize - 6 / view.scale;
                  const pos: React.CSSProperties =
                    side === "right"
                      ? { right: out, top: `calc(50% - ${handleSize / 2}px)` }
                      : side === "left"
                        ? { left: out, top: `calc(50% - ${handleSize / 2}px)` }
                        : side === "top"
                          ? { top: out, left: `calc(50% - ${handleSize / 2}px)` }
                          : { bottom: out, left: `calc(50% - ${handleSize / 2}px)` };
                  return (
                    <div
                      key={side}
                      data-handle="connect"
                      title={t("ideaBoard.connect")}
                      className={`absolute pointer-events-auto rounded-full bg-blue-500 border-white cursor-crosshair transition-opacity hover:scale-125 ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                      style={{ width: handleSize, height: handleSize, borderWidth: 2 / view.scale, ...pos }}
                    />
                  );
                })}
            </div>
          );
        })}

        {/* tags on the nodes (2026-10-08) — little labels above the top edge */}
        {view.scale >= 0.35 &&
          elements.map((el) => {
            if (!el.tags?.length || hidden.has(el.id) || (matches && !matches.has(el.id))) return null;
            return (
              <div
                key={`tags-${el.id}`}
                className="absolute flex gap-1 pointer-events-none"
                style={{ left: el.x, top: el.y - 4 / view.scale, zIndex: 97000, transform: `translateY(-100%) scale(${1 / view.scale})`, transformOrigin: "0 100%" }}
              >
                {el.tags.map((tg) => (
                  <span key={tg} className="rounded-full px-1.5 py-px text-[10px] font-semibold whitespace-nowrap" style={{ background: tagColor(tg).bg, color: tagColor(tg).fg }}>
                    #{tg}
                  </span>
                ))}
              </div>
            );
          })}

        {/* variant votes (2026-10-08): letter top-left, 👍🏼 bottom-right */}
        {voteInfo.map((v) => (
          <div key={`vote-${v.el.id}`} style={{ opacity: matches && !matches.has(v.el.id) ? 0.18 : undefined, transition: "opacity .2s" }}>
            {v.leader && (
              <div
                className="absolute pointer-events-none rounded-[12px]"
                style={{ left: v.el.x - 5 / view.scale, top: v.el.y - 5 / view.scale, width: v.el.w + 10 / view.scale, height: v.el.h + 10 / view.scale, border: `${2.5 / view.scale}px solid #f59e0b`, zIndex: 98500 }}
              />
            )}
            <div
              className="absolute pointer-events-none"
              style={{ left: v.el.x, top: v.el.y, zIndex: 98600, transform: `translate(-35%, -35%) scale(${1 / view.scale})`, transformOrigin: "0 0" }}
            >
              <span className={`flex items-center justify-center min-w-7 h-7 px-1.5 rounded-full text-xs font-bold shadow-lg border-2 border-[#161616] ${v.leader ? "bg-amber-500 text-black" : "bg-white text-black"}`}>
                {v.letter}
                {v.leader && <span className="ml-0.5">★</span>}
              </span>
            </div>
            <button
              data-board-ui
              onClick={() => onVote?.(v.groupId, v.el.id)}
              disabled={!onVote}
              title={v.voters.length ? v.voters.map((x) => x.voter_name).join(", ") : t("ideaBoard.vote.hint")}
              className="absolute"
              style={{ left: v.el.x + v.el.w, top: v.el.y + v.el.h, zIndex: 98700, transform: `translate(-80%, -60%) scale(${1 / view.scale})`, transformOrigin: "0 0" }}
            >
              <span
                className={`flex items-center gap-1 h-8 pl-2 pr-2.5 rounded-full text-sm font-semibold shadow-lg border transition-colors ${
                  v.mine ? "bg-blue-600 border-blue-400 text-white" : "bg-[#1c1c1e] border-white/20 text-white hover:bg-[#2a2a2d]"
                }`}
              >
                👍🏼 <span className="tabular-nums">{v.voters.length}</span>
              </span>
            </button>
          </div>
        ))}

        {/* live collaboration: the others' selections + cursors (2026-10-08) */}
        {(peers ?? []).map((peer) =>
          peer.selection.map((id) => {
            const el = byId.get(hidden.get(id) ?? id);
            if (!el) return null;
            return (
              <div
                key={`peer-sel-${peer.clientId}-${id}`}
                className="absolute pointer-events-none rounded-[12px]"
                style={{ left: el.x - 4 / view.scale, top: el.y - 4 / view.scale, width: el.w + 8 / view.scale, height: el.h + 8 / view.scale, border: `${2 / view.scale}px solid ${peer.color}`, zIndex: 98800 }}
              >
                <span
                  className="absolute left-0 top-0 rounded px-1.5 py-px text-[10px] font-semibold text-white whitespace-nowrap"
                  style={{ background: peer.color, transform: `translateY(-100%) scale(${1 / view.scale})`, transformOrigin: "0 100%" }}
                >
                  {peer.name}
                </span>
              </div>
            );
          }),
        )}
        {(peers ?? []).map((peer) =>
          peer.cursor ? (
            <div
              key={`peer-cur-${peer.clientId}`}
              className="absolute pointer-events-none"
              style={{ left: peer.cursor.x, top: peer.cursor.y, zIndex: 99900, transform: `scale(${1 / view.scale})`, transformOrigin: "0 0", transition: "left 80ms linear, top 80ms linear" }}
            >
              <svg width="18" height="20" viewBox="0 0 18 20" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,.5))" }}>
                <path d="M1 1 L1 16 L5.5 12 L9 19 L11.5 18 L8 11 L14 11 Z" fill={peer.color} stroke="white" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              <span className="absolute left-3.5 top-4 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-white whitespace-nowrap shadow" style={{ background: peer.color }}>
                {peer.name}
              </span>
            </div>
          ) : null,
        )}

        {/* feedback pins (2026-10-08) — constant screen size, above the nodes */}
        {(pins ?? []).map((p) => {
          const pt = pinPoint(p.elementId, p.x, p.y);
          if (!pt) return null;
          return (
            <button
              key={p.id}
              data-board-ui
              data-pin-id={p.id}
              title={p.title}
              onClick={() => onPinClick?.(p.id)}
              className="absolute"
              style={{ left: pt.x, top: pt.y, zIndex: p.active ? 99500 : 99000, transform: `translate(-50%, -100%) scale(${1 / view.scale})`, transformOrigin: "50% 100%" }}
            >
              <span
                className={`flex items-center justify-center w-7 h-7 rounded-full rounded-br-none rotate-45 border-2 shadow-lg transition-transform ${p.active ? "scale-125 border-white" : "border-white/80 hover:scale-110"} ${p.resolved ? "opacity-45" : ""}`}
                style={{ background: p.color }}
              >
                <span className="-rotate-45 text-[11px] font-bold text-white leading-none">{p.resolved ? "✓" : p.label}</span>
              </span>
            </button>
          );
        })}
        {pendingPin && (() => {
          const pt = pinPoint(pendingPin.elementId, pendingPin.x, pendingPin.y);
          if (!pt) return null;
          return (
            <div className="absolute pointer-events-none" style={{ left: pt.x, top: pt.y, zIndex: 99600, transform: `translate(-50%, -100%) scale(${1 / view.scale})`, transformOrigin: "50% 100%" }}>
              <span className="flex items-center justify-center w-7 h-7 rounded-full rounded-br-none rotate-45 border-2 border-white shadow-lg animate-pulse" style={{ background: pendingPin.color ?? "#3b82f6" }}>
                <span className="-rotate-45 text-xs text-white leading-none">+</span>
              </span>
            </div>
          );
        })()}
        {flash && byId.get(hidden.get(flash) ?? flash) && (() => {
          const el = byId.get(hidden.get(flash) ?? flash)!;
          return (
            <div
              className="absolute pointer-events-none rounded-[12px] subshot-pin-flash"
              style={{ left: el.x - 6 / view.scale, top: el.y - 6 / view.scale, width: el.w + 12 / view.scale, height: el.h + 12 / view.scale, border: `${3 / view.scale}px solid #f59e0b`, zIndex: 98900 }}
            />
          );
        })()}

        {pending.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-lg bg-[#232325] border border-white/10 flex flex-col items-center justify-center gap-2 p-3 text-xs text-white/60"
            style={{ left: p.x, top: p.y, width: p.w, height: p.h, zIndex: 100000 }}
          >
            <span className="truncate max-w-full">{p.progress === null ? p.label : `${t("ideaBoard.uploading")} ${p.label}`}</span>
            <div className="w-3/4 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className={`h-full bg-blue-500 ${p.progress === null ? "w-1/3 animate-pulse" : ""}`} style={p.progress !== null ? { width: `${Math.round(p.progress * 100)}%` } : undefined} />
            </div>
          </div>
        ))}

        {guides && (
          <svg className="absolute left-0 top-0 overflow-visible pointer-events-none" width="1" height="1" style={{ zIndex: 100001 }}>
            {guides.map((l, i) => (
              <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#f43f5e" strokeWidth={1 / view.scale} />
            ))}
          </svg>
        )}
        {drawPreview && (
          <svg className="absolute left-0 top-0 overflow-visible pointer-events-none" width="1" height="1" style={{ zIndex: 100001 }}>
            <path d={strokePath(drawPreview)} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}

        {(() => {
          const tgt = imageDropTarget ? data.elements.find((x) => x.id === imageDropTarget) : null;
          if (!tgt) return null;
          const label =
            tgt.type === "placeholder"
              ? t("ideaBoard.placeholder.drop")
              : tgt.type === "scene"
              ? t((tgt.image_key ? "ideaBoard.dropReplaceSceneImage" : "ideaBoard.dropSetSceneImage") as never)
              : t("ideaBoard.dropIntoMoodboard" as never);
          return (
            // "the image goes here" — ring + veil over the target card
            <div
              className="absolute rounded-lg pointer-events-none flex items-center justify-center bg-blue-500/15"
              style={{ left: tgt.x, top: tgt.y, width: tgt.w, height: tgt.h, zIndex: 100000, boxShadow: `0 0 0 ${3 / view.scale}px #3b82f6` }}
            >
              <span
                className="flex items-center gap-2 rounded-full bg-blue-600 text-white font-semibold shadow-lg whitespace-nowrap"
                style={{ fontSize: 13 / view.scale, padding: `${6 / view.scale}px ${12 / view.scale}px` }}
              >
                <svg width={14 / view.scale} height={14 / view.scale} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>
                {label}
              </span>
            </div>
          );
        })()}
        {pendingGifs.map((g) => (
          // "GIF wird erstellt …" — holds the GIF's spot until it's ready
          <div
            key={g.id}
            className="absolute rounded-lg border border-white/15 bg-[#232325] shadow-[0_2px_10px_rgba(0,0,0,0.35)] flex flex-col items-center justify-center gap-3 px-6 pointer-events-none"
            style={{ left: g.x, top: g.y, width: g.w, height: g.h, zIndex: 100001 }}
          >
            <span className="text-2xl">🎞</span>
            <span className="text-xs text-white/70">{t("ideaBoard.gif.making" as never)}</span>
            <div className="w-full max-w-[220px] h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-blue-500 gif-progress" />
            </div>
          </div>
        ))}
        {marquee && (
          <div
            className="absolute border border-blue-400 bg-blue-500/10 pointer-events-none"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
              zIndex: 100002,
              borderWidth: 1 / view.scale,
            }}
          />
        )}
      </div>
      </div>

      {showEmptyHint && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none">
          <div className="text-sm text-white/35 text-center px-6 max-w-md">{t("ideaBoard.emptyHint")}</div>
          {templates && (
            <button
              data-board-ui
              onClick={() => setTemplatesOpen(true)}
              className="pointer-events-auto rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-sm font-semibold text-white shadow-lg"
            >
              {t("ideaBoard.templates.startWith")}
            </button>
          )}
        </div>
      )}

      {/* formatting bar while a text box is being edited */}
      {editable && editingEl && (editingEl.type === "text" || editingEl.type === "sticky") && (
        <FloatingBar view={view} bounds={editingEl}>
          {(
            [
              ["bold", "B", "font-bold"],
              ["italic", "I", "italic"],
              ["underline", "U", "underline"],
              ["strikeThrough", "S", "line-through"],
            ] as const
          ).map(([cmd, label, cls]) => (
            <BarButton key={cmd} title={t(`ideaBoard.format.${cmd}` as Parameters<typeof t>[0])} onPress={() => document.execCommand(cmd)}>
              <span className={cls}>{label}</span>
            </BarButton>
          ))}
          <Divider />
          <BarButton title={t("ideaBoard.format.heading1")} onPress={() => document.execCommand("formatBlock", false, "h1")}>H1</BarButton>
          <BarButton title={t("ideaBoard.format.heading2")} onPress={() => document.execCommand("formatBlock", false, "h2")}>H2</BarButton>
          <BarButton title={t("ideaBoard.format.paragraph")} onPress={() => document.execCommand("formatBlock", false, "div")}>¶</BarButton>
          <Divider />
          <BarButton title={t("ideaBoard.format.bulletList")} onPress={() => document.execCommand("insertUnorderedList")}>•</BarButton>
          <BarButton title={t("ideaBoard.format.numberList")} onPress={() => document.execCommand("insertOrderedList")}>1.</BarButton>
          <BarButton title={t("ideaBoard.format.quote")} onPress={() => document.execCommand("formatBlock", false, "blockquote")}>❝</BarButton>
          <Divider />
          {TEXT_ALIGNS.map((a) => (
            <BarButton key={a} title={t(`ideaBoard.align.${a}`)} active={(editingEl.align ?? "left") === a} onPress={() => setTextAlign(new Set([editingEl.id]), a)}>
              <AlignIcon align={a} />
            </BarButton>
          ))}
        </FloatingBar>
      )}

      {/* selection actions */}
      {editable && !editingEl && !busyOp && (selBounds || selectedConnector) && (
        <FloatingBar
          view={view}
          bounds={
            selBounds ??
            (() => {
              const c = data.connectors.find((x) => x.id === selectedConnector);
              const a = c && byId.get(c.from);
              const b = c && byId.get(c.to);
              return a && b ? boundsOf([a, b])! : { x: 0, y: 0, w: 0, h: 0 };
            })()
          }
        >
          {selectedEls.length > 0 && selectedEls.every((el) => el.type === "sticky") && (
            <>
              {STICKY_COLORS.map((c) => (
                <button
                  key={c}
                  title={t("ideaBoard.color")}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setStickyColor(c)}
                  className={`w-5 h-5 rounded-[3px] shrink-0 hover:scale-110 transition-transform ${selectedEls.every((el) => (el as StickyElement).color === c) ? "ring-2 ring-white ring-offset-1 ring-offset-[#1c1c1e]" : ""}`}
                  style={{ background: STICKY_STYLES[c].paper }}
                />
              ))}
              <Divider />
              {TEXT_ALIGNS.map((a) => (
                <BarButton
                  key={a}
                  title={t(`ideaBoard.align.${a}`)}
                  active={selectedEls.every((el) => ((el as StickyElement).align ?? "left") === a)}
                  onPress={() => setTextAlign(new Set(selectedEls.map((el) => el.id)), a)}
                >
                  <AlignIcon align={a} />
                </BarButton>
              ))}
              <Divider />
            </>
          )}
          {selectedEls.length > 0 && selectedEls.every((el) => el.type === "text") && (
            <>
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  title={t("ideaBoard.color")}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => setTextColor(c)}
                  className="w-5 h-5 rounded-full border border-white/25 shrink-0 hover:scale-110 transition-transform"
                  style={{
                    background: c === "transparent" ? "repeating-conic-gradient(#555 0 25%, #333 0 50%) 50% / 8px 8px" : TEXT_COLOR_STYLES[c].bg,
                  }}
                />
              ))}
              <Divider />
              {TEXT_ALIGNS.map((a) => (
                <BarButton
                  key={a}
                  title={t(`ideaBoard.align.${a}`)}
                  active={selectedEls.every((el) => ((el as TextElement).align ?? "left") === a)}
                  onPress={() => setTextAlign(new Set(selectedEls.map((el) => el.id)), a)}
                >
                  <AlignIcon align={a} />
                </BarButton>
              ))}
              <Divider />
            </>
          )}
          {selectedEls.length >= 2 && (
            <>
              <BarButton title={t("ideaBoard.groupAction")} onPress={groupSelection}>
                <span className="text-xs font-semibold px-1 whitespace-nowrap">{t("ideaBoard.groupAction")}</span>
              </BarButton>
              <Divider />
            </>
          )}
          {selectedEls.length === 1 && selectedEls[0].type === "group" && (
            <>
              <BarButton title={(selectedEls[0] as GroupElement).collapsed ? t("ideaBoard.expand") : t("ideaBoard.collapse")} onPress={() => toggleGroup(selectedEls[0].id)}>
                <span className="text-xs font-semibold px-1 whitespace-nowrap">{(selectedEls[0] as GroupElement).collapsed ? t("ideaBoard.expand") : t("ideaBoard.collapse")}</span>
              </BarButton>
              <BarButton title={t("ideaBoard.renameGroup")} onPress={() => setEditingId(selectedEls[0].id)}>
                <span className="text-xs font-semibold px-1 whitespace-nowrap">{t("ideaBoard.renameGroup")}</span>
              </BarButton>
              <BarButton title={t("ideaBoard.ungroup")} onPress={() => ungroup(selectedEls[0].id)}>
                <span className="text-xs font-semibold px-1 whitespace-nowrap">{t("ideaBoard.ungroup")}</span>
              </BarButton>
              <Divider />
              <BarButton title={t("ideaBoard.vote.toggle")} active={!!(selectedEls[0] as GroupElement).vote} onPress={() => toggleVoteGroup(selectedEls[0].id)}>
                <span className="text-xs font-semibold px-1 whitespace-nowrap">🗳️ {t("ideaBoard.vote.label")}</span>
              </BarButton>
              <BarButton title={`${t("ideaBoard.groupArrange.title")}: ${t("ideaBoard.groupArrange.row")}`} onPress={() => arrangeGroup(selectedEls[0].id, "row")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="5" height="10" rx="1" /><rect x="9.5" y="7" width="5" height="10" rx="1" /><rect x="17" y="7" width="5" height="10" rx="1" /></svg>
              </BarButton>
              <BarButton title={`${t("ideaBoard.groupArrange.title")}: ${t("ideaBoard.groupArrange.grid")}`} onPress={() => arrangeGroup(selectedEls[0].id, "grid")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
              </BarButton>
              <Divider />
            </>
          )}
          {selectedEls.length === 1 && selectedEls[0].type === "moodboard" && (
            <>
              <BarButton title={t("ideaBoard.moodboard.add")} onPress={() => pickMoodboardImages(selectedEls[0].id)}>
                <span className="text-xs font-semibold px-1 whitespace-nowrap">+ {t("ideaBoard.moodboard.addShort")}</span>
              </BarButton>
              <Divider />
            </>
          )}
          {selectedEls.length === 1 && (selectedEls[0].type === "palette" || selectedEls[0].type === "location" || selectedEls[0].type === "color") && (
            <>
              <BarButton
                title={t("ideaBoard.editCard")}
                onPress={() => setCardEditor({ kind: selectedEls[0].type as "palette" | "location" | "color", id: selectedEls[0].id, at: { x: selectedEls[0].x, y: selectedEls[0].y } })}
              >
                <span className="text-xs font-semibold px-1">{t("ideaBoard.editCard")}</span>
              </BarButton>
              <Divider />
            </>
          )}
          {selectedEls.length === 1 && selectedEls[0].type === "image" && (
            <>
              <BarButton title={t("ideaBoard.toScene")} onPress={() => convertToScene(selectedEls[0].id)}>
                <span className="text-xs font-semibold px-1">{t("ideaBoard.toScene")}</span>
              </BarButton>
              {extractPalette && (
                <BarButton title={t("ideaBoard.palette.fromImage")} onPress={() => void paletteFromImage(selectedEls[0].id)}>
                  <span className="text-xs font-semibold px-1 whitespace-nowrap">🎨 {t("ideaBoard.palette.fromImageShort")}</span>
                </BarButton>
              )}
              <Divider />
            </>
          )}
          {selectedEls.length > 0 && selectedEls.every((el) => el.type === "scene") && (
            <>
              {(["none", "must", "should", "optional"] as const).map((p) => {
                const current = selectedEls.every((el) => ((el as SceneElement).priority ?? "none") === p);
                return (
                  <button
                    key={p}
                    title={`${t("sceneEditModal.priority")}: ${p === "none" ? t("sceneEditModal.none") : t(`priority.${p}`)}`}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setScenePriority(p === "none" ? null : p)}
                    className={`w-5 h-5 rounded-full shrink-0 hover:scale-110 transition-transform ${current ? "ring-2 ring-white ring-offset-1 ring-offset-[#1c1c1e]" : ""}`}
                    style={{ background: PRIORITY_COLORS[p] }}
                  />
                );
              })}
              <Divider />
            </>
          )}
          {selectedEls.length === 1 && selectedEls[0].type === "scene" && (
            <>
              <BarButton title={t("ideaBoard.sceneNumberDown")} onPress={() => setSceneNumber(selectedEls[0].id, -1)}>−</BarButton>
              <span className="text-xs font-semibold tabular-nums px-1 text-white/80 whitespace-nowrap">
                {t("ideaBoard.scene")} {(selectedEls[0] as SceneElement).number}
              </span>
              <BarButton title={t("ideaBoard.sceneNumberUp")} onPress={() => setSceneNumber(selectedEls[0].id, 1)}>+</BarButton>
              <Divider />
              {generateImage && (
                <BarButton title={t("ideaBoard.aiImage")} onPress={() => setAiFor(selectedEls[0].id)}>
                  <span className="text-xs font-semibold px-0.5">✨</span>
                </BarButton>
              )}
              <BarButton title={t("ideaBoard.addImage")} onPress={() => pickSceneImage(selectedEls[0].id)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
              </BarButton>
              {(selectedEls[0] as SceneElement).image_key && (
                <BarButton title={t("ideaBoard.removeImage")} onPress={() => removeSceneImage(selectedEls[0].id)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m4 4 16 16" /></svg>
                </BarButton>
              )}
              <Divider />
            </>
          )}
          {selectedEls.length > 0 && (
            <>
              <BarButton title={t("ideaBoard.tags.title")} onPress={() => setTagEditorOpen(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" /></svg>
              </BarButton>
              <BarButton title={t("ideaBoard.bringFront")} onPress={() => reorderSelection(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="8" width="12" height="12" rx="2" fill="currentColor" fillOpacity="0.35" /><path d="M4 16V6a2 2 0 0 1 2-2h10" /></svg>
              </BarButton>
              <BarButton title={t("ideaBoard.sendBack")} onPress={() => reorderSelection(false)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="12" height="12" rx="2" /><path d="M20 8v10a2 2 0 0 1-2 2H8" /></svg>
              </BarButton>
              <BarButton title={t("ideaBoard.duplicate")} onPress={duplicateSelection}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></svg>
              </BarButton>
            </>
          )}
          {selectedConnector && selectedEls.length === 0 && (
            <>
              <ConnectorLabelInput
                key={selectedConnector}
                initial={data.connectors.find((c) => c.id === selectedConnector)?.label ?? ""}
                placeholder={t("ideaBoard.connectorLabel")}
                onCommit={(label) => setConnectorLabel(selectedConnector, label)}
              />
              <Divider />
            </>
          )}
          <BarButton title={t("ideaBoard.delete")} onPress={deleteSelection} danger>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
          </BarButton>
        </FloatingBar>
      )}

      {editable && (
        <textarea
          ref={pasteCatcherRef}
          data-board-ui
          aria-hidden
          tabIndex={-1}
          inputMode="none"
          value=""
          onChange={() => {}}
          className="absolute left-0 top-0 w-px h-px opacity-0 pointer-events-none resize-none overflow-hidden"
        />
      )}

      {menu && editable && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {(() => {
            const target = menu.targetId ? byId.get(menu.targetId) : null;
            if (!target) {
              return menu.linkInput ? (
                <form
                  className="flex gap-1.5 p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = (e.currentTarget.elements.namedItem("url") as HTMLInputElement).value;
                    if (value.trim()) menuAction(() => void (menu.fillId ? fillPlaceholderWithLink(menu.fillId, value) : addLink(value, menu.world)));
                  }}
                >
                  <input
                    name="url"
                    autoFocus
                    inputMode="url"
                    placeholder={t("ideaBoard.linkPlaceholder")}
                    className="w-56 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 select-text"
                  />
                  <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3 text-sm font-semibold">
                    {t("ideaBoard.linkAdd")}
                  </button>
                </form>
              ) : (
                <>
                  <MenuItem label={t("ideaBoard.menu.text")} hint="T" onPress={() => menuAction(() => addText(menu.world))} />
                  <MenuItem label={t("ideaBoard.menu.scene")} hint="S" onPress={() => menuAction(() => addScene(menu.world, true))} />
                  {todoCtx?.api && <MenuItem label={t("ideaBoard.menu.todo")} onPress={() => menuAction(() => void addTodo(menu.world))} />}
                  {storyScenes.length > 1 && <MenuItem label={t("ideaBoard.menu.arrange")} onPress={() => menuAction(arrangeStoryboard)} />}
                  <MenuItem label={t("ideaBoard.menu.moodboard")} onPress={() => menuAction(() => addMoodboard(menu.world))} />
                  {gifMaker && <MenuItem label={t("ideaBoard.menu.gif")} onPress={() => menuAction(() => setGifAt(menu.world))} />}
                  <MenuItem label={t("ideaBoard.menu.sticky")} hint="N" onPress={() => menuAction(() => addSticky(menu.world))} />
                  <MenuItem label={t("ideaBoard.menu.color")} onPress={() => menuAction(() => setCardEditor({ kind: "color", id: null, at: menu.world }))} />
                  <MenuItem label={t("ideaBoard.menu.palette")} onPress={() => menuAction(() => setCardEditor({ kind: "palette", id: null, at: menu.world }))} />
                  {createLocationMap && <MenuItem label={t("ideaBoard.menu.location")} onPress={() => menuAction(() => setCardEditor({ kind: "location", id: null, at: menu.world }))} />}
                  <MenuItem
                    label={t("ideaBoard.menu.upload")}
                    onPress={() =>
                      menuAction(() => {
                        uploadAtRef.current = menu.world;
                        fileInputRef.current?.click();
                      })
                    }
                  />
                  <MenuItem label={t("ideaBoard.menu.link")} onPress={() => setMenu({ ...menu, linkInput: true })} />
                  <MenuItem label={t("ideaBoard.menu.draw")} hint="P" onPress={() => menuAction(() => setTool("draw"))} />
                  <MenuDivider />
                  <MenuItem label={t("ideaBoard.menu.paste")} hint="⌘V" onPress={() => menuAction(() => void pasteFromClipboardApi(menu.world))} />
                  <MenuItem label={t("ideaBoard.menu.selectAll")} hint="⌘A" onPress={() => menuAction(() => setSelection(new Set(dataRef.current.elements.filter((el) => !hidden.has(el.id)).map((el) => el.id))))} />
                  <MenuItem label={t("ideaBoard.zoomFit")} onPress={() => menuAction(fitToContent)} />
                </>
              );
            }
            const multi = selection.size >= 2;
            return (
              <>
                {!multi && (target.type === "text" || target.type === "scene") && <MenuItem label={t("ideaBoard.menu.edit")} onPress={() => menuAction(() => activate(target))} />}
                {!multi && target.type === "group" && (
                  <>
                    <MenuItem label={t("ideaBoard.renameGroup")} onPress={() => menuAction(() => setEditingId(target.id))} />
                    <MenuItem label={target.collapsed ? t("ideaBoard.expand") : t("ideaBoard.collapse")} onPress={() => menuAction(() => toggleGroup(target.id))} />
                    <MenuItem label={t("ideaBoard.ungroup")} hint="⇧⌘G" onPress={() => menuAction(() => ungroup(target.id))} />
                    <MenuItem label={target.vote ? t("ideaBoard.vote.off") : t("ideaBoard.vote.on")} onPress={() => menuAction(() => toggleVoteGroup(target.id))} />
                    <MenuItem label={`${t("ideaBoard.groupArrange.title")}: ${t("ideaBoard.groupArrange.row")}`} onPress={() => menuAction(() => arrangeGroup(target.id, "row"))} />
                    <MenuItem label={`${t("ideaBoard.groupArrange.title")}: ${t("ideaBoard.groupArrange.grid")}`} onPress={() => menuAction(() => arrangeGroup(target.id, "grid"))} />
                  </>
                )}
                {!multi && (target.type === "link" || target.type === "pdf" || target.type === "file") && <MenuItem label={t("ideaBoard.open")} onPress={() => menuAction(() => activate(target))} />}
                {!multi && (target.type === "image" || (target.type === "scene" && target.image_key)) &&
                  (data.cover === target.id ? (
                    <MenuItem label={t("ideaBoard.removeThumbnail")} onPress={() => menuAction(() => setCover(null))} />
                  ) : (
                    <MenuItem label={t("ideaBoard.useAsThumbnail")} onPress={() => menuAction(() => setCover(target.id))} />
                  ))}
                {!multi && target.type === "image" && <MenuItem label={t("ideaBoard.toScene")} onPress={() => menuAction(() => convertToScene(target.id))} />}
                {multi && <MenuItem label={t("ideaBoard.groupAction")} hint="⌘G" onPress={() => menuAction(groupSelection)} />}
                <MenuItem label={t("ideaBoard.duplicate")} hint="⌘D" onPress={() => menuAction(duplicateSelection)} />
                <MenuItem label={t("ideaBoard.bringFront")} onPress={() => menuAction(() => reorderSelection(true))} />
                <MenuItem label={t("ideaBoard.sendBack")} onPress={() => menuAction(() => reorderSelection(false))} />
                <MenuDivider />
                <MenuItem label={t("ideaBoard.delete")} danger onPress={() => menuAction(deleteSelection)} />
              </>
            );
          })()}
        </ContextMenu>
      )}

      {editable && cardEditor && (
        <div
          className="contents"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {cardEditor.kind === "color" ? (
            (() => {
              const raw = cardEditor.id ? byId.get(cardEditor.id) : undefined;
              const cur = raw?.type === "color" ? raw : undefined;
              const phName = raw?.type === "placeholder" ? raw.title : "";
              return <ColorEditor open initialHex={cur?.hex ?? ""} initialName={cur?.name ?? phName} onClose={() => setCardEditor(null)} onSave={saveColor} />;
            })()
          ) : cardEditor.kind === "palette" ? (
            (() => {
              const cur = cardEditor.id ? (byId.get(cardEditor.id) as PaletteElement | undefined) : undefined;
              return (
                <PaletteEditor open initialTitle={cur?.title ?? ""} initialColors={cur?.colors ?? []} onClose={() => setCardEditor(null)} onSave={savePalette} />
              );
            })()
          ) : (
            (() => {
              const cur = cardEditor.id ? (byId.get(cardEditor.id) as LocationElement | undefined) : undefined;
              return (
                <LocationEditor
                  open
                  busy={cardBusy}
                  initialTitle={cur?.title ?? ""}
                  initialAddress={cur?.address ?? ""}
                  initialLat={cur?.lat ?? null}
                  initialLng={cur?.lng ?? null}
                  initialStyle={cur ? cur.map_style ?? "map" : "satellite"}
                  onClose={() => setCardEditor(null)}
                  onSave={(title, address, lat, lng, style) => void saveLocation(title, address, lat, lng, style)}
                />
              );
            })()
          )}
        </div>
      )}

      {editable && generateImage && (
        // the Modal is a portal, but React still bubbles its events through
        // the board — keep the board's pointer/keyboard handlers out of it
        <div
          className="contents"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
        <ImageGeneratePopup
          open={aiFor !== null}
          onClose={() => setAiFor(null)}
          initialPrompt={(() => {
            const sc = aiFor ? byId.get(aiFor) : null;
            if (!sc || sc.type !== "scene") return "";
            return [sc.title, boardHtmlToPlain(sc.html)].filter(Boolean).join(". ");
          })()}
          onGenerate={(prompt, style, aspect) => {
            const id = aiFor;
            setAiFor(null);
            if (id) void runSceneAi(id, prompt, style, aspect);
          }}
        />
        </div>
      )}

      {/* tools */}
      {editable && (
        <div data-board-ui className="absolute z-30 left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 p-1.5 rounded-2xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur">
          <ToolButton active={tool === "select"} title={t("ideaBoard.toolSelect")} onPress={() => setTool("select")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l14 8-6 2-2 6z" /></svg>
          </ToolButton>
          <ToolButton active={tool === "hand"} title={t("ideaBoard.toolHand")} onPress={() => setTool(tool === "hand" ? "select" : "hand")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.toolText")} onPress={() => addText(viewportCenterWorld(), true, true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5h16v2M9 19h6M12 5v14" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.toolScene")} onPress={() => addScene(viewportCenterWorld(), true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="m4 11-.9-3.3a2 2 0 0 1 1.4-2.5l11.6-3.1a2 2 0 0 1 2.4 1.4L19.4 6" /><path d="m8.5 4.6 2.6 3.6M13.4 3.3l2.6 3.6" /></svg>
          </ToolButton>
          {todoCtx?.api && (
            <ToolButton title={t("ideaBoard.toolTodo")} onPress={() => void addTodo(viewportCenterWorld())}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 7 2 2 4-4" /><path d="m3 17 2 2 4-4" /><path d="M13 6h8M13 12h8M13 18h8" /></svg>
            </ToolButton>
          )}
          <ToolButton title={t("ideaBoard.toolMoodboard")} onPress={() => addMoodboard(viewportCenterWorld())}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>
          </ToolButton>
          {gifMaker && (
            <ToolButton title={t("ideaBoard.toolGif")} onPress={() => setGifAt(viewportCenterWorld())}>
              <span className="text-[11px] font-bold tracking-tight">GIF</span>
            </ToolButton>
          )}
          <ToolButton title={t("ideaBoard.toolSticky")} onPress={() => addSticky(viewportCenterWorld())}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z" /><path d="M15 21v-4a2 2 0 0 1 2-2h4" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.toolColor")} onPress={() => setCardEditor({ kind: "color", id: null, at: viewportCenterWorld() })}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="13" rx="2" fill="currentColor" fillOpacity="0.35" /><path d="M4 20h16" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.toolPalette")} onPress={() => setCardEditor({ kind: "palette", id: null, at: viewportCenterWorld() })}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-1.5a1.5 1.5 0 0 0-1.1 2.5A2 2 0 0 1 12 22z" /><circle cx="7.5" cy="10.5" r="1.2" fill="currentColor" /><circle cx="11" cy="7" r="1.2" fill="currentColor" /><circle cx="15.5" cy="8" r="1.2" fill="currentColor" /></svg>
          </ToolButton>
          {createLocationMap && (
            <ToolButton title={t("ideaBoard.toolLocation")} onPress={() => setCardEditor({ kind: "location", id: null, at: viewportCenterWorld() })}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
            </ToolButton>
          )}
          <ToolButton title={t("ideaBoard.toolUpload")} onPress={() => fileInputRef.current?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
          </ToolButton>
          <div className="relative">
            <ToolButton active={linkOpen} popoverOpen={linkOpen} title={t("ideaBoard.toolLink")} onPress={() => setLinkOpen((v) => !v)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
            </ToolButton>
            {linkOpen && (
              <form
                className="absolute left-full top-0 ml-2 flex gap-1.5 p-1.5 rounded-xl bg-[#1c1c1e] border border-white/10 shadow-xl"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!linkValue.trim()) return;
                  void addLink(linkValue, viewportCenterWorld(), true);
                  setLinkValue("");
                  setLinkOpen(false);
                }}
              >
                <input
                  autoFocus
                  value={linkValue}
                  onChange={(e) => setLinkValue(e.target.value)}
                  placeholder={t("ideaBoard.linkPlaceholder")}
                  inputMode="url"
                  className="w-64 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 select-text"
                />
                <button type="submit" className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3 text-sm font-semibold">
                  {t("ideaBoard.linkAdd")}
                </button>
              </form>
            )}
          </div>
          <div className="relative">
            <ToolButton active={tool === "draw"} popoverOpen={tool === "draw"} title={t("ideaBoard.toolDraw")} onPress={() => setTool(tool === "draw" ? "select" : "draw")}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
            </ToolButton>
            {tool === "draw" && (
              <div className="absolute left-full top-0 ml-2 flex flex-col gap-2 p-2 rounded-xl bg-[#1c1c1e] border border-white/10 shadow-xl">
                <div className="flex gap-1.5">
                  {STROKE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setStrokeColor(c)}
                      className={`w-6 h-6 rounded-full border-2 ${strokeColor === c ? "border-blue-500" : "border-white/20"}`}
                      style={{ background: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
                <div className="flex gap-1.5">
                  {STROKE_WIDTHS.map((w) => (
                    <button
                      key={w}
                      onClick={() => setStrokeWidth(w)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center ${strokeWidth === w ? "bg-white/15" : "hover:bg-white/10"}`}
                      aria-label={`${w}px`}
                    >
                      <span className="rounded-full bg-white" style={{ width: Math.min(18, w + 2), height: Math.min(18, w + 2) }} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {templates && (
            <ToolButton active={templatesOpen} title={t("ideaBoard.templates.button")} onPress={() => setTemplatesOpen(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></svg>
            </ToolButton>
          )}
          <div className="h-px bg-white/10 my-1" />
          <ToolButton title={t("ideaBoard.undo")} onPress={undo} disabled={historyApi ? !historyApi.canUndo : historySize.undo === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.redo")} onPress={redo} disabled={historyApi ? !historyApi.canRedo : historySize.redo === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>
          </ToolButton>
          <input
            ref={moodboardInputRef}
            type="file"
            multiple
            accept="image/*,.heic"
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length && moodboardTarget.current) void addMoodboardFiles(moodboardTarget.current, files);
            }}
          />
          <input
            ref={sceneImageInputRef}
            type="file"
            accept="image/*,.heic"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file && sceneImageTarget.current) void setSceneImage(sceneImageTarget.current, file);
            }}
          />
          <input
            ref={placeholderFileRef}
            type="file"
            accept="image/*,video/*,audio/*,application/pdf,.m4a,.mp3,.wav,.aac,.mov,.heic,*/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file && placeholderTarget.current) void fillPlaceholderWithFile(placeholderTarget.current, file);
              placeholderTarget.current = null;
            }}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,application/pdf,.m4a,.mp3,.wav,.aac,.mov,.heic"
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              const at = uploadAtRef.current ?? viewportCenterWorld();
              uploadAtRef.current = null;
              if (files.length) void addFiles(files, at, true);
            }}
          />
        </div>
      )}

      {/* zoom */}
      {searchOpen ? (
        <BoardSearchPanel
          elements={data.elements.filter((el) => !hidden.has(el.id))}
          query={query}
          onQuery={setQuery}
          tagFilter={tagFilter}
          onTagFilter={setTagFilter}
          matches={matches}
          onPick={pickFromSearch}
          onClose={() => setSearchOpen(false)}
        />
      ) : (
        <button
          data-board-ui
          onClick={() => setSearchOpen(true)}
          title={t("ideaBoard.search.hint")}
          className="absolute z-30 top-3 right-3 h-9 pl-3 pr-2.5 flex items-center gap-2 rounded-xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur text-sm text-white/70 hover:text-white"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <span className="hidden sm:inline">{t("ideaBoard.search.button")}</span>
          <kbd className="hidden sm:inline text-[10px] text-white/40 border border-white/15 rounded px-1">⌘K</kbd>
        </button>
      )}
      {data.elements.length > 0 && viewportRef.current && (
        <BoardMinimap
          elements={data.elements.filter((el) => !hidden.has(el.id))}
          view={view}
          size={{ w: viewportRef.current.clientWidth, h: viewportRef.current.clientHeight }}
          dimmed={matches}
          bottom={storyBar ? 104 : 58}
          onNavigate={(wx, wy) => {
            const r = viewportRef.current!;
            const next = { scale: view.scale, x: r.clientWidth / 2 - wx * view.scale, y: r.clientHeight / 2 - wy * view.scale };
            viewRef.current = next;
            setView(next);
          }}
        />
      )}
      {editable && gifMaker && gifAt && (
        <div
          className="contents"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          // a video dropped onto the maker is only for the GIF (2026-10-09, Lino)
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <BoardGifMaker api={gifMaker} onClose={() => setGifAt(null)} onDone={(g) => addGif(g)} onStart={startGif} />
        </div>
      )}
      {editable && tagEditorOpen && (
        <div
          className="contents"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <TagEditor
            open
            current={(() => {
              const seen = new Map<string, string>();
              for (const el of selectedEls) for (const tg of el.tags ?? []) if (!seen.has(tg.toLowerCase())) seen.set(tg.toLowerCase(), tg);
              return [...seen.values()];
            })()}
            allTags={allTags}
            onClose={() => setTagEditorOpen(false)}
            onSave={saveTags}
          />
        </div>
      )}
      {storyBar && (
        <div data-board-ui className="absolute z-30 right-3 bottom-14 flex items-center gap-0.5 p-1 rounded-xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur text-white/80">
          {editable && storyScenes.length > 1 && (
            <button title={t("ideaBoard.arrangeHint")} onClick={arrangeStoryboard} className="h-8 px-2.5 rounded-lg text-xs font-semibold hover:bg-white/10 flex items-center gap-1.5">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
              {t("ideaBoard.arrange")}
            </button>
          )}
          {allowPresentation && (
          <button
            title={t("ideaBoard.present.hint")}
            onClick={() => {
              const sel = presentScenes.findIndex((s) => selectionRef.current.has(s.id));
              setPresenting(Math.max(0, sel));
            }}
            className="h-8 px-2.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4v16l13-8z" /></svg>
            {t("ideaBoard.present.button")}
          </button>
          )}
        </div>
      )}
      {presenting !== null && (
        <BoardPresentation
          scenes={presentScenes}
          startIndex={presenting}
          onClose={(i) => {
            setPresenting(null);
            const sc = presentScenes[i];
            if (sc) {
              // a scene in a collapsed group: its group card is what's on the board
              const groupId = hiddenElementIds(dataRef.current.elements).get(sc.id);
              const target = (groupId && dataRef.current.elements.find((x) => x.id === groupId)) || sc;
              setSelection(new Set([target.id]));
              zoomToRect(target, { animate: true, maxScale: 1, pad: 120 });
            }
          }}
        />
      )}
      {templatesOpen && templates && (
        <BoardTemplatesPanel
          api={templates}
          canSave={editable}
          selectionCount={selection.size}
          hasContent={data.elements.length > 0}
          onSave={templateSource}
          onUse={(tpl) => void loadTemplate(tpl)}
          onClose={() => setTemplatesOpen(false)}
          onError={onError}
          onSaved={(name) => onNotice?.(t("ideaBoard.templates.saved", { name }))}
        />
      )}
      {quickAdd && (
        <BoardQuickAdd items={quickAddItems} placeholder={t("ideaBoard.quickAdd.placeholder")} emptyLabel={t("ideaBoard.quickAdd.empty")} onPick={quickAddPick} onClose={() => setQuickAdd(null)} />
      )}
      <BoardScenesBar
        views={data.views ?? []}
        elements={data.elements}
        editable={editable}
        activeId={activeScene}
        onCapture={captureScene}
        onRename={renameScene}
        onDelete={deleteScene}
        onGo={goToScene}
      />
      <div data-board-ui className="absolute z-30 right-3 bottom-3 flex items-center gap-0.5 p-1 rounded-xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur text-white/80">
        <ZoomButton title={t("ideaBoard.zoomOut")} onPress={() => { const r = viewportRef.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.scale / 1.25); }}>−</ZoomButton>
        <button
          title={t("ideaBoard.zoomReset")}
          onClick={() => { const r = viewportRef.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1); }}
          className="min-w-[52px] h-8 rounded-lg text-xs tabular-nums hover:bg-white/10"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <ZoomButton title={t("ideaBoard.zoomIn")} onPress={() => { const r = viewportRef.current!.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, view.scale * 1.25); }}>+</ZoomButton>
        <ZoomButton title={t("ideaBoard.zoomFit")} onPress={fitToContent}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>
        </ZoomButton>
      </div>
    </div>
    </BoardScaleContext.Provider>
    </BoardZoomContext.Provider>
    </BoardDownloadContext.Provider>
  );
}

const BOARD_CLIPBOARD_MARKER = "subshot-board-nodes:";
const BOARD_CLIPBOARD_KEY = "subshot-board-clipboard";
/** the last copied nodes (≤ 1 h old) when the system clipboard can't be read */
function recentBoardClipboard(): string | null {
  try {
    const raw = localStorage.getItem(BOARD_CLIPBOARD_KEY);
    if (!raw) return null;
    const { at, text } = JSON.parse(raw) as { at: number; text: string };
    return Date.now() - at < 3600_000 ? text : null;
  } catch {
    return null;
  }
}

function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // keep the menu inside the board when opened near an edge
  useLayoutEffect(() => {
    const node = ref.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    setPos({
      left: Math.max(8, Math.min(x, parent.clientWidth - node.offsetWidth - 8)),
      top: Math.max(8, Math.min(y, parent.clientHeight - node.offsetHeight - 8)),
    });
  }, [x, y]);
  useEffect(() => {
    function onDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose();
    }
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);
  return (
    <div
      ref={ref}
      data-board-ui
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className="absolute z-40 min-w-[220px] p-1 rounded-xl bg-[#1c1c1e]/95 border border-white/10 shadow-2xl backdrop-blur text-sm"
      style={pos}
    >
      {children}
    </div>
  );
}

function MenuItem({ label, hint, onPress, danger }: { label: string; hint?: string; onPress: () => void; danger?: boolean }) {
  return (
    <button
      role="menuitem"
      onClick={onPress}
      className={`w-full flex items-center justify-between gap-6 px-3 py-1.5 rounded-lg text-left ${danger ? "text-red-300 hover:bg-red-500/20" : "text-white/85 hover:bg-white/10"}`}
    >
      <span>{label}</span>
      {hint && <span className="text-xs text-white/35">{hint}</span>}
    </button>
  );
}

function MenuDivider() {
  return <div className="h-px bg-white/10 my-1 mx-1" />;
}

function FloatingBar({ view, bounds, children }: { view: View; bounds: { x: number; y: number; w: number; h: number }; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const left = view.x + (bounds.x + bounds.w / 2) * view.scale;
  const top = view.y + bounds.y * view.scale - 12;
  // keep the bar fully on screen when the selection sits near an edge
  useLayoutEffect(() => {
    const node = ref.current;
    const parent = node?.parentElement;
    if (!node || !parent) return;
    const half = node.offsetWidth / 2;
    const max = parent.clientWidth - 8 - half;
    const min = 8 + half;
    setShift(left < min ? min - left : left > max ? max - left : 0);
  }, [left]);
  return (
    <div
      ref={ref}
      data-board-ui
      className="absolute z-20 flex items-center gap-0.5 p-1 rounded-xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur -translate-x-1/2 -translate-y-full"
      style={{ left: left + shift, top: Math.max(56, top) }}
    >
      {children}
    </div>
  );
}

/** the label field in a selected connector's bar — commits on Enter, blur
 * and also when the bar goes away (clicking elsewhere unmounts it first) */
function ConnectorLabelInput({ initial, placeholder, onCommit }: { initial: string; placeholder: string; onCommit: (label: string) => void }) {
  const [value, setValue] = useState(initial);
  const latest = useRef({ value, onCommit });
  latest.current = { value, onCommit };
  useEffect(() => () => latest.current.onCommit(latest.current.value), []);
  return (
    <input
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      maxLength={200}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
      }}
      className="w-44 h-8 rounded-md bg-white/5 border border-white/10 px-2 text-sm text-white outline-none focus:border-blue-500 select-text"
    />
  );
}

const TEXT_ALIGNS: TextAlign[] = ["left", "center", "right"];

function AlignIcon({ align }: { align: TextAlign }) {
  const rows: [number, number][] = align === "left" ? [[4, 20], [4, 14], [4, 18]] : align === "right" ? [[4, 20], [10, 20], [6, 20]] : [[4, 20], [7, 17], [5, 19]];
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      {rows.map(([x1, x2], i) => (
        <line key={i} x1={x1} x2={x2} y1={6 + i * 6} y2={6 + i * 6} />
      ))}
    </svg>
  );
}

function BarButton({ title, onPress, children, danger, active }: { title: string; onPress: () => void; children: React.ReactNode; danger?: boolean; active?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      // keep focus (and the text selection) inside the text box being edited
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`min-w-8 h-8 px-1.5 rounded-lg flex items-center justify-center text-sm ${danger ? "text-red-300 hover:bg-red-500/20" : active ? "text-white bg-white/15" : "text-white/80 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-white/10 mx-0.5" />;
}

// 2026-10-09, Lino: the tool name shows IMMEDIATELY on hover (the browser's
// own title tooltip only appears after a delay) — only with a real mouse
// (hover: hover), so a tap on the iPad doesn't leave a label hanging; hidden
// while the tool's own popover (link field, pen colors) is open next to it
function ToolButton({ title, onPress, active, disabled, popoverOpen, children }: { title: string; onPress: () => void; active?: boolean; disabled?: boolean; popoverOpen?: boolean; children: React.ReactNode }) {
  return (
    <button
      aria-label={title}
      disabled={disabled}
      onClick={onPress}
      className={`group/tool relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors disabled:opacity-30 ${active ? "bg-blue-600 text-white" : "text-white/75 hover:bg-white/10"}`}
    >
      {children}
      {!popoverOpen && (
        <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 whitespace-nowrap rounded-lg bg-[#2c2c2e] border border-white/10 px-2.5 py-1 text-xs font-medium text-white shadow-lg opacity-0 [@media(hover:hover)]:group-hover/tool:opacity-100 z-50">
          {title}
        </span>
      )}
    </button>
  );
}

function ZoomButton({ title, onPress, children }: { title: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onPress} className="w-8 h-8 rounded-lg flex items-center justify-center text-base hover:bg-white/10">
      {children}
    </button>
  );
}
