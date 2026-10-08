"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n";
import {
  GRID,
  STROKE_COLORS,
  STROKE_WIDTHS,
  TEXT_COLORS,
  TEXT_COLOR_STYLES,
  boundsOf,
  elementKindForMime,
  guessMime,
  looksLikeUrl,
  newId,
  nextSceneNumber,
  snap,
  type BoardData,
  type BoardElement,
  type Connector,
  type DrawingElement,
  type LinkElement,
  type LinkPreview,
  type MediaElement,
  type SceneElement,
  type StrokeColor,
  type TextColor,
  type TextElement,
} from "@/lib/board";
import { BoardElementView, VIDEO_HEADER, boardHtmlToPlain, sanitizeBoardHtml, strokePath } from "./BoardElementView";

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

type Tool = "select" | "draw";
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

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const HISTORY_LIMIT = 100;
const DOUBLE_CLICK_MS = 350;

type Op =
  | { kind: "pan"; pointerId: number; sx: number; sy: number; view: View; moved: boolean; onElement: string | null }
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
    }
  | { kind: "resize"; pointerId: number; id: string; sx: number; sy: number; w: number; h: number; aspect: number | null; header: number; snapshot: BoardData }
  | { kind: "connect"; pointerId: number; from: string }
  | { kind: "draw"; pointerId: number; points: [number, number][] }
  | { kind: "marquee"; pointerId: number; x0: number; y0: number; base: Set<string> }
  | { kind: "pinch"; dist: number; center: Point; view: View };

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function maxZ(elements: BoardElement[]) {
  return elements.reduce((m, el) => Math.max(m, el.z), 0);
}

function rectEdgePoint(r: { x: number; y: number; w: number; h: number }, toward: Point, gap: number): Point {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const tx = dx !== 0 ? (r.w / 2 + gap) / Math.abs(dx) : Infinity;
  const ty = dy !== 0 ? (r.h / 2 + gap) / Math.abs(dy) : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

/** First spot at or below/right of (x, y) where a w×h box doesn't overlap any
 * existing element or reserved box — so things added from the toolbar or by
 * pasting don't land on top of what's already in the middle of the screen. */
function freeSpot(
  x: number,
  y: number,
  w: number,
  h: number,
  taken: { x: number; y: number; w: number; h: number }[],
): Point {
  const hits = (px: number, py: number) =>
    taken.some((r) => px < r.x + r.w + GRID / 2 && px + w + GRID / 2 > r.x && py < r.y + r.h + GRID / 2 && py + h + GRID / 2 > r.y);
  for (let ring = 0; ring < 30; ring++) {
    const step = GRID * 2 * ring;
    const candidates: Point[] = ring === 0 ? [{ x, y }] : [
      { x, y: y + step }, { x: x + step, y }, { x, y: y - step }, { x: x - step, y },
      { x: x + step, y: y + step }, { x: x - step, y: y + step },
    ];
    for (const c of candidates) {
      const cx = snap(c.x);
      const cy = snap(c.y);
      if (!hits(cx, cy)) return { x: cx, y: cy };
    }
  }
  return { x: snap(x), y: snap(y) };
}

export function IdeaBoard({
  initial,
  editable,
  onChange,
  uploadFile,
  fetchLinkPreview,
  onError,
  onEscape,
  className = "",
}: {
  initial: BoardData;
  editable: boolean;
  onChange?: (data: BoardData) => void;
  uploadFile?: BoardUploadFn;
  fetchLinkPreview?: BoardLinkPreviewFn;
  onError?: (message: string) => void;
  /** Escape pressed with nothing left to cancel on the board itself */
  onEscape?: () => void;
  className?: string;
}) {
  const { t } = useLanguage();
  const markerId = useId().replace(/:/g, "");
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [data, setData] = useState<BoardData>(initial);
  const dataRef = useRef(data);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
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
  const [drawPreview, setDrawPreview] = useState<[number, number][] | null>(null);
  const [connectPreview, setConnectPreview] = useState<{ from: string; to: Point } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });

  const pasteCatcherRef = useRef<HTMLTextAreaElement>(null);
  const lastPasteAt = useRef(0);
  const undoStack = useRef<BoardData[]>([]);
  const redoStack = useRef<BoardData[]>([]);
  const opRef = useRef<Op | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const lastClick = useRef<{ id: string | null; time: number; x: number; y: number }>({ id: null, time: 0, x: 0, y: 0 });
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // ── document updates ──────────────────────────────────────────────────
  const apply = useCallback((next: BoardData, opts: { history?: BoardData | null; notify?: boolean } = {}) => {
    if (opts.history) {
      undoStack.current.push(opts.history);
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
      redoStack.current = [];
      setHistorySize({ undo: undoStack.current.length, redo: 0 });
    }
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

  function undo() {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(dataRef.current);
    apply(prev);
    setHistorySize({ undo: undoStack.current.length, redo: redoStack.current.length });
    setSelection(new Set());
    setSelectedConnector(null);
  }
  function redo() {
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

  const fitToContent = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const b = boundsOf(dataRef.current.elements);
    if (!b) {
      const next = { scale: 1, x: rect.width / 2 - 216, y: Math.min(160, rect.height / 4) };
      viewRef.current = next;
      setView(next);
      return;
    }
    const pad = 96;
    const s = clamp(Math.min((rect.width - pad * 2) / Math.max(b.w, 1), (rect.height - pad * 2) / Math.max(b.h, 1), 1), MIN_SCALE, 1);
    const next = { scale: s, x: rect.width / 2 - (b.x + b.w / 2) * s, y: rect.height / 2 - (b.y + b.h / 2) * s };
    viewRef.current = next;
    setView(next);
  }, []);

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
    const spot = avoidOverlap ? freeSpot(at.x - 144, at.y - 36, 288, 72, dataRef.current.elements) : { x: snap(at.x - 120), y: snap(at.y - 24) };
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
    let cursorX = snap(at.x - 168);
    const y = snap(at.y - 120);
    const reserved: { x: number; y: number; w: number; h: number }[] = [];
    const uploads: Promise<void>[] = [];
    // placement happens one file after the other (each needs its measured
    // size to reserve its spot), the uploads themselves then run in parallel
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
      const spot = avoidOverlap ? freeSpot(cursorX, y, w, h, [...dataRef.current.elements, ...reserved]) : { x: cursorX, y };
      reserved.push({ x: spot.x, y: spot.y, w, h });
      cursorX = spot.x + w + GRID;
      const pid = newId();
      setPending((p) => [...p, { id: pid, label: file.name, progress: 0, x: spot.x, y: spot.y, w, h }]);
      uploads.push(
        (async () => {
          try {
            const { key, src } = await uploadFile(file, mime, (f) =>
              setPending((p) => p.map((it) => (it.id === pid ? { ...it, progress: f } : it))),
            );
            const el: MediaElement = {
              id: newId(),
              type: kind,
              x: spot.x,
              y: spot.y,
              w,
              h,
              z: maxZ(dataRef.current.elements) + 1,
              asset_key: key,
              src,
              name: file.name,
              mime,
              ...(kind === "pdf" ? { size: file.size } : {}),
            };
            addElements([el]);
          } catch {
            onError?.(t("ideaBoard.uploadFailed", { name: file.name }));
          } finally {
            setPending((p) => p.filter((it) => it.id !== pid));
          }
        })(),
      );
    }
    await Promise.all(uploads);
  }

  async function addLink(rawUrl: string, at: Point, avoidOverlap = false) {
    const url = /^https?:\/\//i.test(rawUrl.trim()) ? rawUrl.trim() : `https://${rawUrl.trim()}`;
    const pid = newId();
    const { x, y } = avoidOverlap ? freeSpot(at.x - 168, at.y - 80, 336, 288, dataRef.current.elements) : { x: snap(at.x - 168), y: snap(at.y - 80) };
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
    const ids = selectionRef.current;
    if (ids.size === 0 && !selectedConnector) return;
    commit((d) => ({
      elements: d.elements.filter((el) => !ids.has(el.id)),
      connectors: d.connectors.filter((c) => c.id !== selectedConnector && !ids.has(c.from) && !ids.has(c.to)),
    }));
    setSelection(new Set());
    setSelectedConnector(null);
  }

  function duplicateSelection() {
    const ids = selectionRef.current;
    if (ids.size === 0) return;
    const mapping = new Map<string, string>();
    let z = maxZ(dataRef.current.elements);
    const copies = dataRef.current.elements
      .filter((el) => ids.has(el.id))
      .sort((a, b) => a.z - b.z)
      .map((el) => {
        const id = newId();
        mapping.set(el.id, id);
        return { ...el, id, x: el.x + GRID, y: el.y + GRID, z: ++z } as BoardElement;
      });
    const connectorCopies: Connector[] = dataRef.current.connectors
      .filter((c) => mapping.has(c.from) && mapping.has(c.to))
      .map((c) => ({ ...c, id: newId(), from: mapping.get(c.from)!, to: mapping.get(c.to)! }));
    commit((d) => ({ elements: [...d.elements, ...copies], connectors: [...d.connectors, ...connectorCopies] }));
    setSelection(new Set(copies.map((c) => c.id)));
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
    if (!el || el.type !== "text") return;
    if (!boardHtmlToPlain(html) && !boardHtmlToPlain(editingStartHtml.current)) {
      // a freshly created text box left empty — drop it instead of keeping an empty card
      commit((d) => ({
        elements: d.elements.filter((e) => e.id !== id),
        connectors: d.connectors.filter((c) => c.from !== id && c.to !== id),
      }));
      setSelection(new Set());
    } else if (html !== el.html) {
      updateElement(id, { html } as Partial<TextElement>, { history: true });
    }
    if (editingRef.current === id) setEditingId(null);
  }

  // ── scene cards ───────────────────────────────────────────────────────
  const sceneImageInputRef = useRef<HTMLInputElement>(null);
  const sceneImageTarget = useRef<string | null>(null);

  function addScene(at: Point, avoidOverlap = false) {
    const w = 312;
    const h = 300;
    const spot = avoidOverlap ? freeSpot(at.x - w / 2, at.y - h / 2, w, h, dataRef.current.elements) : { x: snap(at.x - w / 2), y: snap(at.y - h / 2) };
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
    };
    commit((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? scene : e)) }));
    setSelection(new Set([id]));
    setEditingId(id);
  }

  function commitScene(id: string, patch: { title?: string; html?: string }) {
    const el = dataRef.current.elements.find((e) => e.id === id);
    if (!el || el.type !== "scene") return;
    const next: Partial<SceneElement> = {};
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

  function removeSceneImage(id: string) {
    updateElement(id, { image_key: undefined, image_src: undefined } as Partial<SceneElement>, { history: true });
  }

  function activate(el: BoardElement) {
    if ((el.type === "text" || el.type === "scene") && editable) {
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
    if (target.closest("[contenteditable='true'], input, textarea")) return;
    const elNode = target.closest<HTMLElement>("[data-el-id]");
    if (target.closest("[data-no-drag]")) {
      // media controls / links inside a card: let the browser handle the click
      if (editable && elNode) {
        setSelection(new Set([elNode.dataset.elId!]));
        setSelectedConnector(null);
      }
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
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
      return;
    }
    if (pointers.current.size > 2) return;

    if (editingRef.current) finishEditing();
    const world = toWorld(e.clientX, e.clientY);

    if (e.button === 1) {
      opRef.current = { kind: "pan", pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, view: viewRef.current, moved: false, onElement: null };
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
        opRef.current = { kind: "connect", pointerId: e.pointerId, from: id };
        setConnectPreview({ from: id, to: world });
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
      const origin = new Map<string, Point>();
      for (const el of dataRef.current.elements) if (ids.has(el.id)) origin.set(el.id, { x: el.x, y: el.y });
      opRef.current = {
        kind: "move",
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        ids: [...ids],
        origin,
        primary: id,
        moved: false,
        snapshot: dataRef.current,
        clickedId: id,
      };
      return;
    }

    // empty canvas (or any element in read-only mode)
    if (editable && (e.shiftKey || e.metaKey) && !elNode) {
      opRef.current = { kind: "marquee", pointerId: e.pointerId, x0: world.x, y0: world.y, base: new Set(selectionRef.current) };
      setMarquee({ x0: world.x, y0: world.y, x1: world.x, y1: world.y });
      return;
    }
    opRef.current = {
      kind: "pan",
      pointerId: e.pointerId,
      sx: e.clientX,
      sy: e.clientY,
      view: viewRef.current,
      moved: false,
      onElement: elNode?.dataset.elId ?? null,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
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
        const ddx = snap(p.x + dx, !freePlace) - p.x;
        const ddy = snap(p.y + dy, !freePlace) - p.y;
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
      case "connect":
        setConnectPreview({ from: op.from, to: toWorld(e.clientX, e.clientY) });
        return;
      case "draw": {
        const w = toWorld(e.clientX, e.clientY);
        const last = op.points[op.points.length - 1];
        if (Math.hypot(w.x - last[0], w.y - last[1]) * scale < 2) return;
        op.points.push([w.x, w.y]);
        setDrawPreview([...op.points]);
        return;
      }
      case "marquee": {
        const w = toWorld(e.clientX, e.clientY);
        setMarquee({ x0: op.x0, y0: op.y0, x1: w.x, y1: w.y });
        const minX = Math.min(op.x0, w.x), maxX = Math.max(op.x0, w.x);
        const minY = Math.min(op.y0, w.y), maxY = Math.max(op.y0, w.y);
        const ids = new Set(op.base);
        for (const el of dataRef.current.elements) {
          if (el.x < maxX && el.x + el.w > minX && el.y < maxY && el.y + el.h > minY) ids.add(el.id);
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

    switch (op.kind) {
      case "pan": {
        if (op.moved) return;
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
        if (op.moved) {
          apply(dataRef.current, { history: op.snapshot });
          return;
        }
        const now = Date.now();
        const last = lastClick.current;
        const isDouble = now - last.time < DOUBLE_CLICK_MS && last.id === op.clickedId;
        lastClick.current = { id: op.clickedId, time: isDouble ? 0 : now, x: e.clientX, y: e.clientY };
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) setSelection(new Set([op.clickedId]));
        if (isDouble) {
          const el = dataRef.current.elements.find((x) => x.id === op.clickedId);
          if (el) activate(el);
        }
        return;
      }
      case "resize":
        apply(dataRef.current, { history: op.snapshot });
        return;
      case "connect": {
        setConnectPreview(null);
        const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-el-id]");
        const to = hit?.dataset.elId;
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
      case "marquee":
        setMarquee(null);
        return;
    }
  }

  function onPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    const op = opRef.current;
    if (op && op.kind === "move" && op.moved) apply(dataRef.current, { history: op.snapshot });
    if (op && op.kind === "resize") apply(dataRef.current, { history: op.snapshot });
    opRef.current = null;
    setBusyOp(null);
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
      if (isTyping() || !editable) return;
      if (mod && e.key.toLowerCase() === "v") {
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
      } else if (!mod && e.key.toLowerCase() === "v") {
        setTool("select");
      } else if (!mod && e.key.toLowerCase() === "p") {
        setTool("draw");
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
      if (!editable || isTyping()) return;
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
    window.addEventListener("keydown", onKey);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("paste", onPaste);
    };
  });

  function pasteText(text: string) {
      const at = viewportCenterWorld();
      if (looksLikeUrl(text)) {
        void addLink(text, at, true);
      } else {
        const html = text
          .split(/\r?\n/)
          .map((line) => `<div>${line ? line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "<br>"}</div>`)
          .join("");
        const spot = freeSpot(at.x - 144, at.y - 36, 288, 72, dataRef.current.elements);
        const el: TextElement = { id: newId(), type: "text", x: spot.x, y: spot.y, w: 288, h: 72, z: maxZ(dataRef.current.elements) + 1, html, color: "default" };
        addElements([el]);
      }
  }

  /** Fallback for browsers that don't fire a paste event at all (Safari /
   * Chrome on iPad without a focused editable): read the clipboard directly. */
  async function pasteFromClipboardApi() {
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
          void addFiles(files, viewportCenterWorld(), true);
          return;
        }
      }
      const text = (await navigator.clipboard?.readText?.())?.trim();
      if (text) pasteText(text);
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
    if (!editingId) focusPasteCatcher();
  }, [editingId, focusPasteCatcher]);

  function onDrop(e: React.DragEvent) {
    if (!editable) return;
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    const sceneId = (e.target as HTMLElement).closest<HTMLElement>("[data-el-id]")?.dataset.elId;
    const sceneEl = sceneId ? dataRef.current.elements.find((x) => x.id === sceneId) : null;
    if (sceneEl?.type === "scene" && files.length === 1 && guessMime(files[0]).startsWith("image/")) {
      void setSceneImage(sceneEl.id, files[0]);
      return;
    }
    if (files.length) {
      void addFiles(files, at);
      return;
    }
    const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (uri && looksLikeUrl(uri.split("\n")[0])) void addLink(uri.split("\n")[0], at);
  }

  // ── rendering helpers ─────────────────────────────────────────────────
  const elements = useMemo(() => [...data.elements].sort((a, b) => a.z - b.z), [data.elements]);
  const byId = useMemo(() => new Map(data.elements.map((el) => [el.id, el])), [data.elements]);
  const selectedEls = data.elements.filter((el) => selection.has(el.id));
  const selBounds = boundsOf(selectedEls);
  const labels = {
    textPlaceholder: t("ideaBoard.textPlaceholder"),
    open: t("ideaBoard.open"),
    download: t("ideaBoard.download"),
    missingFile: t("ideaBoard.missingFile"),
    scene: t("ideaBoard.scene"),
    sceneTitlePlaceholder: t("ideaBoard.sceneTitlePlaceholder"),
    sceneTextPlaceholder: t("ideaBoard.sceneTextPlaceholder"),
    addImage: t("ideaBoard.addImage"),
  };

  let gridSize = GRID * view.scale;
  while (gridSize < 12) gridSize *= 2;
  const dot = Math.max(1, Math.min(1.6, 1.4 * Math.sqrt(view.scale)));
  const handleSize = 12 / view.scale;

  function connectorPath(c: Connector) {
    const a = byId.get(c.from);
    const b = byId.get(c.to);
    if (!a || !b) return null;
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
    const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const p1 = rectEdgePoint(a, cb, 6);
    const p2 = rectEdgePoint(b, ca, 10);
    return `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
  }

  const editingEl = editingId ? byId.get(editingId) : null;
  const showEmptyHint = editable && data.elements.length === 0 && pending.length === 0;

  return (
    <div
      ref={viewportRef}
      className={`${className.includes("absolute") ? "" : "relative"} overflow-hidden touch-none select-none ${tool === "draw" ? "cursor-crosshair" : ""} ${className}`}
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
      onDragOver={(e) => editable && e.preventDefault()}
      onDrop={onDrop}
      onContextMenu={(e) => editable && !(e.target as HTMLElement).closest("[contenteditable='true'],a,video,audio") && e.preventDefault()}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {/* connectors (under the elements) */}
        <svg className="absolute left-0 top-0 overflow-visible" width="1" height="1" style={{ zIndex: 0 }}>
          <defs>
            <marker id={`arrow-${markerId}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {data.connectors.map((c) => {
            const d = connectorPath(c);
            if (!d) return null;
            const selected = selectedConnector === c.id;
            return (
              <g key={c.id}>
                <path d={d} stroke="transparent" strokeWidth={16 / view.scale} fill="none" data-connector-id={c.id} style={{ pointerEvents: editable ? "stroke" : "none", cursor: "pointer" }} />
                <path
                  d={d}
                  stroke={selected ? "#3b82f6" : c.color ?? "#f0f0f0"}
                  strokeOpacity={selected ? 1 : 0.7}
                  strokeWidth={2 / Math.min(1, view.scale)}
                  fill="none"
                  strokeLinecap="round"
                  markerEnd={`url(#arrow-${markerId})`}
                  style={{ pointerEvents: "none" }}
                />
              </g>
            );
          })}
          {connectPreview && byId.get(connectPreview.from) && (
            <path
              d={`M ${byId.get(connectPreview.from)!.x + byId.get(connectPreview.from)!.w / 2} ${byId.get(connectPreview.from)!.y + byId.get(connectPreview.from)!.h / 2} L ${connectPreview.to.x} ${connectPreview.to.y}`}
              stroke="#3b82f6"
              strokeWidth={2 / view.scale}
              strokeDasharray={`${6 / view.scale} ${5 / view.scale}`}
              fill="none"
              style={{ pointerEvents: "none" }}
            />
          )}
        </svg>

        {elements.map((el) => {
          const selected = selection.has(el.id);
          const isDrawing = el.type === "drawing";
          const growsWithContent = el.type === "text" || el.type === "link" || el.type === "scene";
          const canResize = editable && selected && selection.size === 1 && !isDrawing && el.type !== "audio" && el.type !== "pdf" && el.type !== "file";
          return (
            <div
              key={el.id}
              data-el-id={el.id}
              className={`absolute group ${isDrawing ? "pointer-events-none" : ""} ${editable && !isDrawing && editingId !== el.id ? "cursor-grab active:cursor-grabbing" : ""}`}
              style={{
                left: el.x,
                top: el.y,
                width: el.w,
                height: growsWithContent ? undefined : el.h,
                zIndex: el.z + 10,
              }}
            >
              <BoardElementView
                el={el}
                editing={editingId === el.id}
                editable={editable}
                labels={labels}
                onCommitText={(html) => commitText(el.id, html)}
                onCommitScene={(patch) => commitScene(el.id, patch)}
                onPickSceneImage={() => pickSceneImage(el.id)}
                onMeasure={(h) => updateElement(el.id, { h: Math.ceil(h) }, { notify: editable })}
                onNaturalSize={(nw, nh) => {
                  if (!nw || !nh) return;
                  const header = el.type === "video" ? VIDEO_HEADER : 0;
                  const want = Math.round((el.w * nh) / nw) + header;
                  if (Math.abs(want - el.h) > 2) updateElement(el.id, { h: want }, { notify: editable });
                }}
              />
              {selected && (
                <div
                  className="absolute pointer-events-none rounded-[14px]"
                  style={{
                    inset: -4 / view.scale,
                    border: `${2 / view.scale}px solid #3b82f6`,
                    borderRadius: 14,
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
              {editable && tool === "select" && !isDrawing && editingId !== el.id && (
                <div
                  data-handle="connect"
                  title={t("ideaBoard.connect")}
                  className={`absolute rounded-full bg-blue-500 border-white cursor-crosshair transition-opacity ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                  style={{ width: handleSize, height: handleSize, right: -handleSize - 8 / view.scale, top: `calc(50% - ${handleSize / 2}px)`, borderWidth: 2 / view.scale }}
                />
              )}
            </div>
          );
        })}

        {pending.map((p) => (
          <div
            key={p.id}
            className="absolute rounded-xl bg-[#232325] border border-white/10 flex flex-col items-center justify-center gap-2 p-3 text-xs text-white/60"
            style={{ left: p.x, top: p.y, width: p.w, height: p.h, zIndex: 100000 }}
          >
            <span className="truncate max-w-full">{p.progress === null ? p.label : `${t("ideaBoard.uploading")} ${p.label}`}</span>
            <div className="w-3/4 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className={`h-full bg-blue-500 ${p.progress === null ? "w-1/3 animate-pulse" : ""}`} style={p.progress !== null ? { width: `${Math.round(p.progress * 100)}%` } : undefined} />
            </div>
          </div>
        ))}

        {drawPreview && (
          <svg className="absolute left-0 top-0 overflow-visible pointer-events-none" width="1" height="1" style={{ zIndex: 100001 }}>
            <path d={strokePath(drawPreview)} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}

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

      {showEmptyHint && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-sm text-white/35 text-center px-6 max-w-md">{t("ideaBoard.emptyHint")}</div>
        </div>
      )}

      {/* formatting bar while a text box is being edited */}
      {editable && editingEl && editingEl.type === "text" && (
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
            </>
          )}
          {selectedEls.length === 1 && selectedEls[0].type === "image" && (
            <>
              <BarButton title={t("ideaBoard.toScene")} onPress={() => convertToScene(selectedEls[0].id)}>
                <span className="text-xs font-semibold px-1">{t("ideaBoard.toScene")}</span>
              </BarButton>
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

      {/* tools */}
      {editable && (
        <div data-board-ui className="absolute z-30 left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 p-1.5 rounded-2xl bg-[#1c1c1e]/95 border border-white/10 shadow-xl backdrop-blur">
          <ToolButton active={tool === "select"} title={t("ideaBoard.toolSelect")} onPress={() => setTool("select")}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3l14 8-6 2-2 6z" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.toolText")} onPress={() => addText(viewportCenterWorld(), true, true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7V5h16v2M9 19h6M12 5v14" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.toolScene")} onPress={() => addScene(viewportCenterWorld(), true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11h16v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" /><path d="m4 11-.9-3.3a2 2 0 0 1 1.4-2.5l11.6-3.1a2 2 0 0 1 2.4 1.4L19.4 6" /><path d="m8.5 4.6 2.6 3.6M13.4 3.3l2.6 3.6" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.toolUpload")} onPress={() => fileInputRef.current?.click()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-5-5L5 21" /></svg>
          </ToolButton>
          <div className="relative">
            <ToolButton active={linkOpen} title={t("ideaBoard.toolLink")} onPress={() => setLinkOpen((v) => !v)}>
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
            <ToolButton active={tool === "draw"} title={t("ideaBoard.toolDraw")} onPress={() => setTool(tool === "draw" ? "select" : "draw")}>
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
          <div className="h-px bg-white/10 my-1" />
          <ToolButton title={t("ideaBoard.undo")} onPress={undo} disabled={historySize.undo === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
          </ToolButton>
          <ToolButton title={t("ideaBoard.redo")} onPress={redo} disabled={historySize.redo === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 14 5-5-5-5" /><path d="M20 9H9a5 5 0 0 0 0 10h3" /></svg>
          </ToolButton>
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
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*,audio/*,application/pdf,.m4a,.mp3,.wav,.aac,.mov,.heic"
            className="hidden"
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void addFiles(files, viewportCenterWorld(), true);
            }}
          />
        </div>
      )}

      {/* zoom */}
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
  );
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

function BarButton({ title, onPress, children, danger }: { title: string; onPress: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      title={title}
      aria-label={title}
      // keep focus (and the text selection) inside the text box being edited
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={`min-w-8 h-8 px-1.5 rounded-lg flex items-center justify-center text-sm ${danger ? "text-red-300 hover:bg-red-500/20" : "text-white/80 hover:bg-white/10"}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-white/10 mx-0.5" />;
}

function ToolButton({ title, onPress, active, disabled, children }: { title: string; onPress: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onPress}
      className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors disabled:opacity-30 ${active ? "bg-blue-600 text-white" : "text-white/75 hover:bg-white/10"}`}
    >
      {children}
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
