"use client";

// 2026-11-20, Lino: «Lichtplan» full-screen editor — a top-down light plot in metres: walls / curved walls / windows /
// doors / openings, set pieces, labels, a traced floor-plan photo; talent and cameras (angle of view from the lens);
// a light library (presets with role, Kelvin, intensity, modifier, beam, rotation) plus flags / diffusion frames;
// beams coloured by Kelvin; looks (variants) with a numbered fixture list; undo / redo; PNG / PDF export done in the
// browser (no server files). SVG only. Touch: one finger drags, two fingers zoom / pan. Read-only for guests.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  activeLook, cameraFov, emptyPlot, ITEM_SIZE, kelvinColor, kelvinRange, LIGHT_PRESETS, lpId, lpLabels, MODIFIER_BEAM, MODIFIERS, modifierText,
  newLight, plotBounds, plotOf, presetOf, ROLES, roleText,
  type ItemKind, type LightPlotData, type LpLook, type Modifier, type Role, type WallKind,
} from "@/lib/lightPlot";
import type { LightPlotElement } from "@/lib/board";
import { useLanguage } from "@/lib/i18n";
import { LightPlotDrawing, PX } from "./LightPlotDrawing";
import dynamic from "next/dynamic";
import type { LightPlot3DHandle } from "./LightPlot3D";
// three.js only loads when the camera view is opened (never with the board)
const LightPlot3D = dynamic(() => import("./LightPlot3D").then((m) => m.LightPlot3D), { ssr: false });

type Tool = "select" | "box" | "hand" | "walls" | "measure" | "text";
type Pt = { x: number; y: number };
type Drag =
  | { kind: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { kind: "move"; start: Pt; base: LightPlotData; moved: boolean }
  | { kind: "end"; id: string; part: "p1" | "p2"; base: LightPlotData }
  | { kind: "rot"; id: string; center: Pt; base: LightPlotData }
  | { kind: "box"; a: Pt; b: Pt }
  | { kind: "measure"; a: Pt; b: Pt }
  | { kind: "pinch"; d: number; c: Pt; view: View };
type View = { x: number; y: number; k: number };

const SNAP = 0.25;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export function LightPlotEditor({
  el,
  editable,
  onCommit,
  onClose,
  uploadFile,
}: {
  el: LightPlotElement;
  editable: boolean;
  onCommit: (patch: Record<string, unknown>) => void;
  onClose: () => void;
  uploadFile?: (file: File, mime: string, onProgress: (f: number) => void) => Promise<{ key: string; src: string }>;
}) {
  const { language } = useLanguage();
  const L = lpLabels(language);
  const [plot, setPlot] = useState<LightPlotData>(() => plotOf(el));
  const [title, setTitle] = useState(el.title || L.node);
  const [bg, setBg] = useState<{ key?: string; src?: string | null }>({ key: el.image_key, src: el.image_src });
  const [past, setPast] = useState<LightPlotData[]>([]);
  const [future, setFuture] = useState<LightPlotData[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tool, setTool] = useState<Tool>("select");
  const [wallKind, setWallKind] = useState<WallKind>("wall");
  const [draft, setDraft] = useState<Pt[] | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [measure, setMeasure] = useState<{ a: Pt; b: Pt } | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [libOpen, setLibOpen] = useState(false);
  const [setOpen, setSetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // phones: the side panel (properties + fixture list) is a sheet you open
  const [panelOpen, setPanelOpen] = useState(false);
  // v2: the camera view (3D) — split view on desktop, instead of the plan on a phone
  const [camView, setCamView] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const view3d = useRef<LightPlot3DHandle>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const exportRef = useRef<SVGSVGElement>(null);
  const pointers = useRef(new Map<number, Pt>());
  const plotRef = useRef(plot);
  plotRef.current = plot;
  const look = activeLook(plot);

  // ── history + saving ────────────────────────────────────────────────────
  const save = useCallback((next: LightPlotData, extra: Record<string, unknown> = {}) => {
    if (!editable) return;
    onCommit({ room: next.room, people: next.people, looks: next.looks, active_look: next.active_look, view: next.view, ...extra });
  }, [editable, onCommit]);
  const commit = useCallback((next: LightPlotData, before: LightPlotData = plotRef.current) => {
    if (!editable) return;
    setPast((p) => [...p.slice(-80), before]);
    setFuture([]);
    setPlot(next);
    save(next);
  }, [editable, save]);
  const undo = () => {
    if (!past.length) return;
    const prev = past[past.length - 1];
    setPast(past.slice(0, -1));
    setFuture([plot, ...future]);
    setPlot(prev);
    save(prev);
  };
  const redo = () => {
    if (!future.length) return;
    const next = future[0];
    setFuture(future.slice(1));
    setPast([...past, plot]);
    setPlot(next);
    save(next);
  };

  // ── view ────────────────────────────────────────────────────────────────
  const fit = useCallback(() => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const b = plotBounds(plotRef.current, 1.2);
    const k = Math.min(r.width / (b.w * PX), r.height / (b.h * PX));
    setView({ k, x: r.width / 2 - (b.x + b.w / 2) * PX * k, y: r.height / 2 - (b.y + b.h / 2) * PX * k });
  }, []);
  useEffect(() => { fit(); }, [fit]);
  const toWorld = (cx: number, cy: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (cx - r.left - view.x) / view.k / PX, y: (cy - r.top - view.y) / view.k / PX };
  };
  const snap = (v: number) => (plot.view.snap ? Math.round(v / SNAP) * SNAP : Math.round(v * 100) / 100);
  const center = (): Pt => {
    const r = svgRef.current?.getBoundingClientRect();
    return r ? { x: snap((r.width / 2 - view.x) / view.k / PX), y: snap((r.height / 2 - view.y) / view.k / PX) } : { x: 3, y: 3 };
  };
  const zoomAt = (cx: number, cy: number, k: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const nk = Math.min(8, Math.max(0.08, k));
    const wx = (cx - r.left - view.x) / view.k, wy = (cy - r.top - view.y) / view.k;
    setView({ k: nk, x: cx - r.left - wx * nk, y: cy - r.top - wy * nk });
  };

  // ── object helpers ──────────────────────────────────────────────────────
  type AnyObj = { id: string; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number; rot?: number };
  const mapObjects = (p: LightPlotData, fn: (o: AnyObj) => AnyObj | null): LightPlotData => {
    const m = <T extends AnyObj>(arr: T[]) => arr.map((o) => fn(o) as T | null).filter((o): o is T => !!o);
    return {
      ...p,
      room: { ...p.room, walls: m(p.room.walls), labels: m(p.room.labels), items: m(p.room.items) },
      people: m(p.people),
      looks: p.looks.map((lk) => (lk.id === p.active_look ? { ...lk, lights: m(lk.lights), mods: m(lk.mods) } : lk)),
    };
  };
  const findObj = (p: LightPlotData, id: string): { type: string; obj: AnyObj } | null => {
    const lk = activeLook(p);
    for (const [type, arr] of [["wall", p.room.walls], ["label", p.room.labels], ["item", p.room.items], ["person", p.people], ["light", lk.lights], ["mod", lk.mods]] as const) {
      const o = (arr as AnyObj[]).find((x) => x.id === id);
      if (o) return { type, obj: o };
    }
    return null;
  };
  const update = (id: string, patch: Record<string, unknown>) => commit(mapObjects(plot, (o) => (o.id === id ? { ...o, ...patch } : o)));
  const setLook = (fn: (lk: LpLook) => LpLook, p = plot) => ({ ...p, looks: p.looks.map((lk) => (lk.id === p.active_look ? fn(lk) : lk)) });
  const deleteSelected = () => {
    if (!selected.size) return;
    commit(mapObjects(plot, (o) => (selected.has(o.id) ? null : o)));
    setSelected(new Set());
  };
  const add = (next: LightPlotData, id: string) => { commit(next); setSelected(new Set([id])); setTool("select"); };

  // ── pointer ─────────────────────────────────────────────────────────────
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      setDrag({ kind: "pinch", d: Math.hypot(a.x - b.x, a.y - b.y) || 1, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view });
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    const target = (e.target as Element).closest("[data-lp-id]") as SVGElement | null;
    const id = target?.getAttribute("data-lp-id") ?? null;
    const part = target?.getAttribute("data-lp-part") ?? "body";
    if (tool === "hand" || e.button === 1 || (!editable && tool !== "measure" && tool !== "select")) {
      setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
      return;
    }
    if (tool === "measure") {
      const p = { x: snap(w.x), y: snap(w.y) };
      setMeasure({ a: p, b: p });
      setDrag({ kind: "measure", a: p, b: p });
      return;
    }
    if (tool === "walls" && editable) {
      const p = { x: snap(w.x), y: snap(w.y) };
      if (!draft) { setDraft([p]); return; }
      const last = draft[draft.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 0.05) { setDraft(null); return; }
      const wall = { id: lpId(), kind: wallKind, x1: last.x, y1: last.y, x2: p.x, y2: p.y, ...(wallKind === "curve" ? { bend: 0.25 } : {}) };
      commit({ ...plot, room: { ...plot.room, walls: [...plot.room.walls, wall] } });
      setDraft(wallKind === "wall" || wallKind === "curve" ? [...draft, p] : null);
      return;
    }
    if (tool === "text" && editable) {
      const text = window.prompt(L.label, "")?.trim();
      if (text) add({ ...plot, room: { ...plot.room, labels: [...plot.room.labels, { id: lpId(), x: snap(w.x), y: snap(w.y), text: text.slice(0, 80) }] } }, "");
      setTool("select");
      return;
    }
    if (tool === "box") {
      setDrag({ kind: "box", a: w, b: w });
      return;
    }
    // select
    if (id) {
      let sel = selected;
      if (!sel.has(id)) { sel = e.shiftKey ? new Set([...sel, id]) : new Set([id]); setSelected(sel); }
      if (!editable) return;
      if (part === "p1" || part === "p2") { setDrag({ kind: "end", id, part, base: plot }); return; }
      if (part === "rot") {
        const f = findObj(plot, id);
        const o = f?.obj;
        const c = o ? (o.x !== undefined ? { x: o.x, y: o.y! } : { x: (o.x1! + o.x2!) / 2, y: (o.y1! + o.y2!) / 2 }) : w;
        setDrag({ kind: "rot", id, center: c, base: plot });
        return;
      }
      setDrag({ kind: "move", start: w, base: plot, moved: false });
      return;
    }
    if (!e.shiftKey) setSelected(new Set());
    setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const w = toWorld(e.clientX, e.clientY);
    if (tool === "walls") setHover({ x: snap(w.x), y: snap(w.y) });
    if (!drag) return;
    if (drag.kind === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const r = svgRef.current!.getBoundingClientRect();
      const k = Math.min(8, Math.max(0.08, drag.view.k * (d / drag.d)));
      const wx = (drag.c.x - r.left - drag.view.x) / drag.view.k, wy = (drag.c.y - r.top - drag.view.y) / drag.view.k;
      setView({ k, x: c.x - r.left - wx * k, y: c.y - r.top - wy * k });
      return;
    }
    if (drag.kind === "pan") { setView({ ...view, x: drag.vx + e.clientX - drag.sx, y: drag.vy + e.clientY - drag.sy }); return; }
    if (drag.kind === "measure") { const b = { x: snap(w.x), y: snap(w.y) }; setMeasure({ a: drag.a, b }); setDrag({ ...drag, b }); return; }
    if (drag.kind === "box") { setDrag({ ...drag, b: w }); return; }
    if (drag.kind === "move") {
      const dx = snap(w.x - drag.start.x), dy = snap(w.y - drag.start.y);
      if (!drag.moved && Math.hypot(dx, dy) < 0.01) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      setPlot(mapObjects(drag.base, (o) => {
        if (!selected.has(o.id)) return o;
        return o.x !== undefined ? { ...o, x: o.x + dx, y: o.y! + dy } : { ...o, x1: o.x1! + dx, y1: o.y1! + dy, x2: o.x2! + dx, y2: o.y2! + dy };
      }));
      return;
    }
    if (drag.kind === "end") {
      const p = { x: snap(w.x), y: snap(w.y) };
      setPlot(mapObjects(drag.base, (o) => (o.id === drag.id ? (drag.part === "p1" ? { ...o, x1: p.x, y1: p.y } : { ...o, x2: p.x, y2: p.y }) : o)));
      return;
    }
    if (drag.kind === "rot") {
      let a = (Math.atan2(w.y - drag.center.y, w.x - drag.center.x) * 180) / Math.PI;
      if (plot.view.snap) a = Math.round(a / 15) * 15;
      setPlot(mapObjects(drag.base, (o) => (o.id === drag.id ? { ...o, rot: Math.round(a) } : o)));
    }
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(e.pointerId);
    const d = drag;
    if (!d) return;
    if (d.kind === "pinch") { if (pointers.current.size < 2) setDrag(null); return; }
    setDrag(null);
    if (d.kind === "box") {
      const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y);
      const ids = new Set<string>();
      mapObjects(plot, (o) => {
        const cx = o.x ?? (o.x1! + o.x2!) / 2, cy = o.y ?? (o.y1! + o.y2!) / 2;
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) ids.add(o.id);
        return o;
      });
      setSelected(ids);
      return;
    }
    if ((d.kind === "move" && d.moved) || d.kind === "end" || d.kind === "rot") commit(plotRef.current, d.base);
  }

  // wheel zoom (native, non-passive)
  useEffect(() => {
    const s = svgRef.current;
    if (!s) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setView((v) => {
        const r = s.getBoundingClientRect();
        const k = Math.min(8, Math.max(0.08, v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018))));
        const wx = (e.clientX - r.left - v.x) / v.k, wy = (e.clientY - r.top - v.y) / v.k;
        return { k, x: e.clientX - r.left - wx * k, y: e.clientY - r.top - wy * k };
      });
    };
    s.addEventListener("wheel", onWheel, { passive: false });
    return () => s.removeEventListener("wheel", onWheel);
  }, []);

  // keys (capture: the board behind must not see them — Delete would delete board nodes)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable='true']");
      e.stopImmediatePropagation();
      if (typing) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === "Escape") { if (draft) setDraft(null); else if (selected.size) setSelected(new Set()); else onClose(); return; }
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (!editable) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
      const map: Record<string, Tool> = { v: "select", b: "box", h: "hand", w: "walls", m: "measure", t: "text" };
      if (!mod && map[e.key.toLowerCase()]) setTool(map[e.key.toLowerCase()]);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // ── adding things ───────────────────────────────────────────────────────
  const addPerson = (kind: "talent" | "camera") => {
    const c = center();
    const p = kind === "camera"
      ? { id: lpId(), kind, x: c.x, y: c.y + 2, rot: -90, name: "", body: "", kelvin: 5600, lens_mm: 35, sensor: "s35" as const, z: 1.5, tilt: 0 }
      : { id: lpId(), kind, x: c.x, y: c.y, rot: 90, name: "", pose: "standing" as const, height_m: 1.75 };
    add({ ...plot, people: [...plot.people, p] }, p.id);
  };
  const addLight = (preset: string) => {
    const c = center();
    // new lights go round the middle (not on top of each other), pointing at it
    const n = look.lights.length;
    const ang = ((-150 + n * 70) * Math.PI) / 180;
    const li = newLight(preset, snap(c.x + 2 * Math.cos(ang)), snap(c.y + 2 * Math.sin(ang)), n === 0 ? "key" : n === 1 ? "fill" : n === 2 ? "rim" : "back");
    if (!preset) li.name = L.customName;
    li.rot = Math.round((Math.atan2(c.y - li.y, c.x - li.x) * 180) / Math.PI);
    add(setLook((lk) => ({ ...lk, lights: [...lk.lights, li] })), li.id);
    setLibOpen(false);
  };
  const addMod = (kind: "flag" | "diffusion") => {
    const c = center();
    const m = { id: lpId(), kind, x1: c.x - 0.6, y1: c.y - 1.5, x2: c.x + 0.6, y2: c.y - 1.5, label: "" };
    add(setLook((lk) => ({ ...lk, mods: [...lk.mods, m] })), m.id);
  };
  const addItem = (kind: ItemKind) => {
    const c = center();
    const [w, h] = ITEM_SIZE[kind];
    const it = { id: lpId(), kind, x: c.x, y: c.y, w, h, rot: 0, label: "" };
    add({ ...plot, room: { ...plot.room, items: [...plot.room.items, it] } }, it.id);
    setSetOpen(false);
  };
  const pickPhoto = () => {
    if (!uploadFile) return;
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      setBusy(true);
      try {
        const up = await uploadFile(f, f.type || "image/jpeg", () => {});
        const size = await new Promise<{ w: number; h: number }>((res) => {
          const im = new Image();
          im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
          im.onerror = () => res({ w: 4, h: 3 });
          im.src = up.src;
        });
        const b = plotBounds(plot, 0);
        const wM = Math.max(6, b.w);
        const next = { ...plot, room: { ...plot.room, bg: { x: b.x, y: b.y, w: wM, h: (wM * size.h) / Math.max(1, size.w), opacity: 0.5 } } };
        setBg({ key: up.key, src: up.src });
        setPast((p) => [...p, plot]);
        setPlot(next);
        save(next, { image_key: up.key });
      } finally {
        setBusy(false);
      }
    };
    inp.click();
  };
  const removePhoto = () => {
    const room = { ...plot.room };
    delete room.bg;
    const next = { ...plot, room };
    setBg({});
    setPlot(next);
    save(next, { image_key: undefined });
  };

  // ── looks ───────────────────────────────────────────────────────────────
  const switchLook = (id: string) => { const next = { ...plot, active_look: id }; setPlot(next); save(next); setSelected(new Set()); };
  const addLook = (copy: boolean) => {
    const src = look;
    const nl: LpLook = copy
      ? { ...clone(src), id: lpId(), name: `${src.name} (2)`, lights: src.lights.map((l) => ({ ...l, id: lpId() })), mods: src.mods.map((m) => ({ ...m, id: lpId() })) }
      : { id: lpId(), name: `Look ${plot.looks.length + 1}`, lights: [], mods: [] };
    commit({ ...plot, looks: [...plot.looks, nl].slice(0, 20), active_look: nl.id });
  };
  const renameLook = () => {
    const name = window.prompt(L.rename, look.name)?.trim();
    if (name) commit(setLook((lk) => ({ ...lk, name: name.slice(0, 40) })));
  };
  const deleteLook = () => {
    if (plot.looks.length < 2) return;
    const rest = plot.looks.filter((l) => l.id !== look.id);
    commit({ ...plot, looks: rest, active_look: rest[0].id });
  };
  const setViewOpt = (patch: Partial<LightPlotData["view"]>) => { const next = { ...plot, view: { ...plot.view, ...patch } }; setPlot(next); save(next); };

  // ── export (browser only) ───────────────────────────────────────────────
  async function renderCanvas(): Promise<HTMLCanvasElement> {
    const svg = exportRef.current!.cloneNode(true) as SVGSVGElement;
    const img = svg.querySelector("image");
    if (img && bg.src) {
      try {
        const blob = await (await fetch(bg.src, { mode: "cors" })).blob();
        const data = await new Promise<string>((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.readAsDataURL(blob); });
        img.setAttribute("href", data);
      } catch {
        img.remove(); // the photo's server doesn't allow it → export without the photo
      }
    }
    const vb = svg.viewBox.baseVal;
    const scale = Math.min(3, 2400 / Math.max(vb.width, vb.height) * 2);
    svg.setAttribute("width", String(vb.width * scale / 2));
    svg.setAttribute("height", String(vb.height * scale / 2));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
    const im = new Image();
    await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; });
    const c = document.createElement("canvas");
    c.width = Math.round(vb.width * scale / 2 * 2);
    c.height = Math.round(vb.height * scale / 2 * 2);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#141416";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(im, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    return c;
  }
  const fileBase = () => `${(title || L.node).replace(/[\\/:*?"<>|]+/g, "_")} – ${look.name}`;
  const download = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  async function exportPng() {
    setBusy(true);
    try {
      const c = await renderCanvas();
      c.toBlob((b) => b && download(b, `${fileBase()}.png`), "image/png");
    } finally { setBusy(false); }
  }
  async function exportPdf() {
    setBusy(true);
    try {
      const c = await renderCanvas();
      const jpg = await new Promise<Uint8Array>((res) => c.toBlob(async (b) => res(new Uint8Array(await b!.arrayBuffer())), "image/jpeg", 0.92));
      download(makePdf(jpg, c.width, c.height), `${fileBase()}.pdf`);
    } finally { setBusy(false); }
  }

  // ── camera view ─────────────────────────────────────────────────────────
  const cameras = plot.people.filter((p) => p.kind === "camera");
  const viewCam = cameras.find((c) => c.id === plot.view.camera) ?? cameras[0] ?? null;
  async function renderStill() {
    if (!uploadFile || !view3d.current) return;
    setBusy(true);
    setNotice(L.rendering);
    try {
      const blob = await view3d.current.capture(1600, 900, "image/jpeg");
      if (!blob) return;
      const up = await uploadFile(new File([blob], `${fileBase()} – render.jpg`, { type: "image/jpeg" }), "image/jpeg", () => {});
      // the look keeps one still; the previous one leaves the board (→ board trash) on the next save
      const next = setLook((lk) => ({ ...lk, render_key: up.key, render_src: up.src }), plotRef.current);
      setPlot(next);
      save(next);  // render_src only lives in the board's state (the server keeps render_key and presigns on read)
      setNotice(L.rendered);
      setTimeout(() => setNotice(null), 2500);
    } catch {
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }
  async function exportCamPng() {
    const blob = await view3d.current?.capture(1920, 1080, "image/png");
    if (blob) download(blob, `${fileBase()} – ${viewCam?.name || L.camera}.png`);
  }

  // ── selection panel ─────────────────────────────────────────────────────
  const one = selected.size === 1 ? findObj(plot, [...selected][0]) : null;
  const vb = useMemo(() => plotBounds(plot, 1.2), [plot]);
  const legendW = 4.6;
  const exportH = Math.max(vb.h, 1.2 + look.lights.length * 0.42);

  const grid = useMemo(() => {
    const step = PX * (view.k < 0.25 ? 5 : 1);
    return step;
  }, [view.k]);

  const root = (
    <div
      data-light-plot-editor
      className="fixed inset-0 z-[2147483000] flex flex-col bg-[#111113] text-white select-none"
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* top bar */}
      <div data-lp-topbar className="flex flex-wrap md:flex-nowrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5 md:py-0 md:h-12 border-b border-white/10 shrink-0 md:overflow-x-auto">
        <button onClick={onClose} aria-label={L.close} className="md:hidden shrink-0 h-8 w-8 rounded-md bg-blue-600 text-[14px] font-bold">✕</button>
        <span className="text-[15px]">💡</span>
        <input
          value={title}
          disabled={!editable}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => editable && onCommit({ title: title.trim().slice(0, 200) })}
          className="w-32 md:w-48 shrink-0 min-w-0 bg-transparent text-[14px] font-semibold outline-none border-b border-transparent focus:border-white/30"
          aria-label={L.title}
        />
        <div className="flex flex-wrap items-center gap-1 md:ml-2" data-lp-looks>
          {plot.looks.map((lk) => (
            <button key={lk.id} onClick={() => switchLook(lk.id)} onDoubleClick={() => editable && renameLook()}
              className={`h-7 px-2.5 rounded-md text-[12px] font-medium whitespace-nowrap ${lk.id === look.id ? "bg-white/15 text-white" : "text-white/55 hover:bg-white/8"}`}>{lk.name}</button>
          ))}
          {editable && (
            <>
              <button data-lp-add-look onClick={() => addLook(false)} className="h-7 px-2 rounded-md text-[12px] text-white/70 hover:bg-white/10 whitespace-nowrap">{L.addLook}</button>
              <button onClick={() => addLook(true)} className="h-7 px-2 rounded-md text-[12px] text-white/70 hover:bg-white/10 whitespace-nowrap">{L.duplicate}</button>
              <button onClick={renameLook} className="h-7 px-2 rounded-md text-[12px] text-white/70 hover:bg-white/10 whitespace-nowrap">{L.rename}</button>
              {plot.looks.length > 1 && <button onClick={deleteLook} className="h-7 px-2 rounded-md text-[12px] text-red-300/80 hover:bg-red-500/15 whitespace-nowrap">{L.deleteLook}</button>}
            </>
          )}
        </div>
        <div className="ml-auto flex flex-wrap md:flex-nowrap items-center gap-2 md:shrink-0">
          {(["snap", "labels", "beams"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-[12px] text-white/70">
              <input type="checkbox" checked={plot.view[k]} onChange={(e) => setViewOpt({ [k]: e.target.checked })} />
              {k === "labels" ? L.showLabels : L[k]}
            </label>
          ))}
          <label className="flex items-center gap-1 text-[12px] text-white/70">
            {L.spill}
            <input type="range" min={0} max={100} value={plot.view.spill} onChange={(e) => setPlot({ ...plot, view: { ...plot.view, spill: +e.target.value } })} onPointerUp={() => save(plotRef.current)} className="w-20" />
          </label>
          {editable && (
            <>
              <button onClick={undo} disabled={!past.length} title={L.undo} className="h-8 w-8 rounded-md hover:bg-white/10 disabled:opacity-30">↶</button>
              <button onClick={redo} disabled={!future.length} title={L.redo} className="h-8 w-8 rounded-md hover:bg-white/10 disabled:opacity-30">↷</button>
            </>
          )}
          <button data-lp-camview onClick={() => setCamView((v) => !v)} className={`h-8 px-2.5 rounded-md text-[12px] font-semibold ${camView ? "bg-blue-600" : "bg-white/10 hover:bg-white/15"}`}>🎥 {L.camView}</button>
          <button data-lp-panel-toggle onClick={() => setPanelOpen((v) => !v)} className="md:hidden h-8 px-2.5 rounded-md bg-white/10 text-[12px] font-semibold">☰ {L.fixtures}</button>
          <button data-lp-export-png onClick={exportPng} disabled={busy} className="h-8 px-2.5 rounded-md bg-white/10 hover:bg-white/15 text-[12px] font-semibold">{L.png}</button>
          <button data-lp-export-pdf onClick={exportPdf} disabled={busy} className="h-8 px-2.5 rounded-md bg-white/10 hover:bg-white/15 text-[12px] font-semibold">{L.pdf}</button>
          <button data-lp-close onClick={onClose} className="h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-500 text-[12px] font-semibold">{L.close}</button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* tools */}
        <div className="w-12 shrink-0 border-r border-white/10 flex flex-col items-center gap-1 py-2 overflow-y-auto">
          {([["select", "↖", L.select], ["box", "⬚", L.box], ["hand", "✋", L.hand], ...(editable ? [["walls", "▭", L.walls], ["text", "T", L.text]] : []), ["measure", "📏", L.measure]] as [Tool, string, string][]).map(([t, icon, label]) => (
            <button key={t} data-lp-tool={t} title={label} onClick={() => { setTool(t); setDraft(null); }}
              className={`w-9 h-9 rounded-lg text-[15px] ${tool === t ? "bg-blue-600 text-white" : "text-white/70 hover:bg-white/10"}`}>{icon}</button>
          ))}
          {editable && (
            <>
              <div className="w-7 h-px bg-white/10 my-1" />
              <button data-lp-add="talent" title={L.talent} onClick={() => addPerson("talent")} className="w-9 h-9 rounded-lg text-[15px] text-white/80 hover:bg-white/10">🧍</button>
              <button data-lp-add="camera" title={L.camera} onClick={() => addPerson("camera")} className="w-9 h-9 rounded-lg text-[15px] text-white/80 hover:bg-white/10">🎥</button>
              <button data-lp-add="light" title={L.library} onClick={() => setLibOpen((v) => !v)} className={`w-9 h-9 rounded-lg text-[15px] ${libOpen ? "bg-white/15" : "text-white/80 hover:bg-white/10"}`}>💡</button>
              <button data-lp-add="flag" title={L.flag} onClick={() => addMod("flag")} className="w-9 h-9 rounded-lg text-[13px] font-bold text-white/80 hover:bg-white/10">▬</button>
              <button data-lp-add="diffusion" title={L.diffusion} onClick={() => addMod("diffusion")} className="w-9 h-9 rounded-lg text-[13px] font-bold text-white/80 hover:bg-white/10">┅</button>
              <button data-lp-add="set" title={L.set} onClick={() => setSetOpen((v) => !v)} className={`w-9 h-9 rounded-lg text-[15px] ${setOpen ? "bg-white/15" : "text-white/80 hover:bg-white/10"}`}>🛋</button>
              {uploadFile && <button data-lp-add="photo" title={L.photo} onClick={pickPhoto} className="w-9 h-9 rounded-lg text-[15px] text-white/80 hover:bg-white/10">🗺</button>}
            </>
          )}
          <div className="flex-1" />
          <button title={L.fit} onClick={fit} className="w-9 h-9 rounded-lg text-[14px] text-white/70 hover:bg-white/10">⤢</button>
        </div>

        {/* plan (+ camera view) */}
        <div className="relative flex-1 min-w-0 flex">
        <div className={`relative flex-1 min-w-0 ${camView ? "hidden md:block" : ""}`}>
          {tool === "walls" && editable && (
            <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg bg-[#1c1c1e]/95 border border-white/10 p-1">
              {(["wall", "curve", "window", "door", "opening"] as WallKind[]).map((k) => (
                <button key={k} data-lp-wallkind={k} onClick={() => { setWallKind(k); setDraft(null); }} className={`h-7 px-2 rounded-md text-[12px] ${wallKind === k ? "bg-blue-600" : "hover:bg-white/10 text-white/75"}`}>{L[k]}</button>
              ))}
              <span className="px-2 text-[11px] text-white/45">{L.hint}</span>
            </div>
          )}
          {libOpen && editable && (
            <div data-lp-library className="absolute left-3 top-3 z-20 w-72 max-h-[70%] overflow-y-auto rounded-xl bg-[#1c1c1e] border border-white/12 shadow-2xl p-2">
              <div className="px-1 pb-1 text-[11px] uppercase tracking-wider text-white/45">{L.library}</div>
              {[...new Set(LIGHT_PRESETS.map((p) => p.brand))].map((brand) => (
                <div key={brand} className="mb-1">
                  <div className="px-1 text-[11px] font-semibold text-white/55">{brand}</div>
                  {LIGHT_PRESETS.filter((p) => p.brand === brand).map((p) => (
                    <button key={p.name} data-lp-preset={p.name} onClick={() => addLight(p.name)} className="w-full text-left px-2 py-1 rounded-md text-[12px] hover:bg-white/10 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: kelvinColor(p.k[0]) }} />
                      {p.name}
                      <span className="ml-auto text-[10px] text-white/40">{p.k[1] === p.k[2] ? `${p.k[1]} K` : `${p.k[1]}–${p.k[2]} K`}</span>
                    </button>
                  ))}
                </div>
              ))}
              <button onClick={() => addLight("")} className="w-full text-left px-2 py-1 rounded-md text-[12px] hover:bg-white/10">+ {L.customName}</button>
            </div>
          )}
          {setOpen && editable && (
            <div className="absolute left-3 top-3 z-20 grid grid-cols-2 gap-1 w-56 rounded-xl bg-[#1c1c1e] border border-white/12 shadow-2xl p-2">
              {(Object.keys(ITEM_SIZE) as ItemKind[]).map((k) => (
                <button key={k} data-lp-item={k} onClick={() => addItem(k)} className="h-8 rounded-md text-[12px] hover:bg-white/10 text-left px-2">{L[k]}</button>
              ))}
            </div>
          )}
          <svg
            ref={svgRef}
            data-lp-canvas
            className="absolute inset-0 w-full h-full touch-none"
            style={{ cursor: tool === "hand" ? "grab" : tool === "walls" || tool === "measure" || tool === "text" ? "crosshair" : "default" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => tool === "walls" && setDraft(null)}
          >
            <defs>
              <pattern id="lp-grid" width={grid} height={grid} patternUnits="userSpaceOnUse">
                <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1.5 / view.k} />
              </pattern>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <rect x={-200 * PX} y={-200 * PX} width={400 * PX} height={400 * PX} fill="url(#lp-grid)" />
              <LightPlotDrawing plot={plot} look={look} L={L} bgSrc={bg.src} selected={selected} editable={editable} />
              {draft && hover && (
                <polyline points={[...draft, hover].map((p) => `${p.x * PX},${p.y * PX}`).join(" ")} fill="none" stroke="#3b82f6" strokeWidth={6 / Math.max(0.5, view.k)} strokeDasharray="12 8" />
              )}
              {drag?.kind === "box" && (
                <rect x={Math.min(drag.a.x, drag.b.x) * PX} y={Math.min(drag.a.y, drag.b.y) * PX} width={Math.abs(drag.b.x - drag.a.x) * PX} height={Math.abs(drag.b.y - drag.a.y) * PX}
                  fill="rgba(59,130,246,0.12)" stroke="#3b82f6" strokeWidth={2 / view.k} />
              )}
              {measure && (
                <g data-lp-measure>
                  <line x1={measure.a.x * PX} y1={measure.a.y * PX} x2={measure.b.x * PX} y2={measure.b.y * PX} stroke="#fbbf24" strokeWidth={3 / view.k} />
                  <text x={((measure.a.x + measure.b.x) / 2) * PX} y={((measure.a.y + measure.b.y) / 2) * PX - 10 / view.k} textAnchor="middle" fontSize={16 / view.k} fill="#fbbf24" fontWeight={700}>
                    {Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y).toFixed(2)} m
                  </text>
                </g>
              )}
            </g>
          </svg>
          {/* metre scale */}
          <div className="absolute left-3 bottom-3 flex items-end gap-2 pointer-events-none">
            <div className="h-2 border-x-2 border-b-2 border-white/60" style={{ width: PX * view.k }} />
            <span className="text-[11px] text-white/60">1 m</span>
          </div>
          {!editable && <div className="absolute right-3 bottom-3 rounded-md bg-white/10 px-2 py-1 text-[11px] text-white/70">{L.readOnly}</div>}
        </div>
        {camView && (
          <div data-lp-camview-panel className="relative flex-1 min-w-0 flex flex-col border-l border-white/10 bg-black">
            <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 border-b border-white/10 shrink-0">
              {cameras.length > 1 && (
                <select value={viewCam?.id} onChange={(e) => setViewOpt({ camera: e.target.value })} className="h-7 rounded-md bg-white/10 px-1 text-[12px]">
                  {cameras.map((c, i) => <option key={c.id} value={c.id}>{c.name || `${L.camera} ${i + 1}`}</option>)}
                </select>
              )}
              <label className="flex items-center gap-1 text-[12px] text-white/70 whitespace-nowrap">{L.exposure}
                <input data-lp-exposure type="range" min={-6} max={6} step={0.5} value={plot.view.exposure ?? 0}
                  onChange={(e) => setPlot({ ...plot, view: { ...plot.view, exposure: +e.target.value } })} onPointerUp={() => save(plotRef.current)} className="w-24" />
                <span className="w-8 text-white/50">{(plot.view.exposure ?? 0) > 0 ? "+" : ""}{plot.view.exposure ?? 0}</span>
              </label>
              <div className="ml-auto flex items-center gap-1.5">
                <button onClick={exportCamPng} disabled={!viewCam} className="h-7 px-2 rounded-md bg-white/10 hover:bg-white/15 text-[12px] font-semibold whitespace-nowrap">{L.camViewPng}</button>
                {editable && uploadFile && (
                  <button data-lp-render onClick={renderStill} disabled={!viewCam || busy} className="h-7 px-2.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-[12px] font-semibold whitespace-nowrap">{L.render}</button>
                )}
              </div>
            </div>
            <div className="flex-1 min-h-0">
              <LightPlot3D ref={view3d} plot={plot} look={look} cam={viewCam} L={L} />
            </div>
            {notice && <div className="absolute left-1/2 -translate-x-1/2 bottom-3 rounded-lg bg-black/80 px-3 py-1.5 text-[12px] text-white">{notice}</div>}
          </div>
        )}
        </div>

        {/* right panel */}
        <div className={`${panelOpen ? "fixed inset-x-0 bottom-0 z-30 max-h-[55%] rounded-t-2xl bg-[#18181a] border-t" : "hidden"} md:static md:block md:max-h-none md:rounded-none md:bg-transparent md:border-t-0 w-full md:w-72 shrink-0 md:border-l border-white/10 overflow-y-auto`}>
          {one && (
            <Props L={L} one={one} plot={plot} editable={editable} onPatch={(p) => update(one.obj.id, p)} onDelete={deleteSelected}
              bg={!!plot.room.bg} />
          )}
          {editable && !one && (
            <div className="p-3 border-b border-white/10 space-y-2" data-lp-room>
              <div className="text-[11px] uppercase tracking-wider text-white/45">{L.room}</div>
              <Num label={L.wallHeight} value={plot.room.height ?? 2.6} min={2} max={8} step={0.1} onChange={(v) => commit({ ...plot, room: { ...plot.room, height: v } })} />
            </div>
          )}
          {plot.room.bg && editable && !one && (
            <div className="p-3 border-b border-white/10 space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-white/45">{L.photo}</div>
              <Num label={L.opacity} value={Math.round(plot.room.bg.opacity * 100)} min={5} max={100} onChange={(v) => commit({ ...plot, room: { ...plot.room, bg: { ...plot.room.bg!, opacity: v / 100 } } })} />
              <Num label={`${L.width} (m)`} value={plot.room.bg.w} min={0.5} max={400} step={0.5} onChange={(v) => commit({ ...plot, room: { ...plot.room, bg: { ...plot.room.bg!, h: (plot.room.bg!.h * v) / plot.room.bg!.w, w: v } } })} />
              <button onClick={removePhoto} className="text-[12px] text-red-300 hover:underline">{L.photoRemove}</button>
            </div>
          )}
          <div className="p-3" data-lp-fixtures>
            <div className="text-[11px] uppercase tracking-wider text-white/45 mb-2">{L.fixtures} – {look.name}</div>
            {!look.lights.length && <div className="text-[12px] text-white/40">{L.noFixtures}</div>}
            {look.lights.map((li, i) => (
              <button key={li.id} onClick={() => setSelected(new Set([li.id]))}
                className={`w-full text-left flex gap-2 items-start rounded-lg px-2 py-1.5 mb-1 ${selected.has(li.id) ? "bg-blue-600/25" : "hover:bg-white/5"}`}>
                <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full text-[11px] font-bold flex items-center justify-center" style={{ background: "#18181b", boxShadow: `inset 0 0 0 2px ${kelvinColor(li.kelvin)}` }}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold truncate">{li.name}</span>
                  <span className="block text-[11px] text-white/55">{roleText(L, li)} · {li.kelvin} K · {li.intensity}% · {modifierText(L, li)} {li.beam}°</span>
                </span>
              </button>
            ))}
            {plot.people.filter((p) => p.kind === "camera").map((p) => (
              <div key={p.id} className="mt-2 text-[11px] text-white/55">🎥 {p.name || L.camera}{p.body ? ` · ${p.body}` : ""} · {p.lens_mm} mm ({Math.round(cameraFov(p.lens_mm, p.sensor))}°) · {p.kelvin} K</div>
            ))}
          </div>
        </div>
      </div>

      {/* hidden export drawing: the whole plan + the fixture list of this look */}
      <svg ref={exportRef} xmlns="http://www.w3.org/2000/svg" className="hidden" fontFamily="system-ui, -apple-system, Helvetica, Arial, sans-serif" viewBox={`${vb.x * PX} ${vb.y * PX} ${(vb.w + legendW) * PX} ${exportH * PX}`}>
        <rect x={vb.x * PX} y={vb.y * PX} width={(vb.w + legendW) * PX} height={exportH * PX} fill="#141416" />
        <LightPlotDrawing plot={plot} look={look} L={L} bgSrc={bg.src} />
        <g transform={`translate(${(vb.x + vb.w + 0.2) * PX} ${(vb.y + 0.5) * PX})`} fontFamily="system-ui, sans-serif">
          <text fontSize={26} fontWeight={700} fill="#fff">{title}</text>
          <text y={30} fontSize={18} fill="rgba(255,255,255,0.6)">{look.name}</text>
          {look.lights.map((li, i) => (
            <g key={li.id} transform={`translate(0 ${70 + i * 42})`}>
              <circle cx={12} cy={-6} r={12} fill="#18181b" stroke={kelvinColor(li.kelvin)} strokeWidth={3} />
              <text x={12} y={-1} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">{i + 1}</text>
              <text x={34} y={-6} fontSize={16} fontWeight={600} fill="#fff">{li.name}</text>
              <text x={34} y={13} fontSize={13} fill="rgba(255,255,255,0.6)">{`${roleText(L, li)} · ${li.kelvin} K · ${li.intensity}% · ${modifierText(L, li)} ${li.beam}°`}</text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(root, document.body);
}

function Num({ label, value, min, max, step = 1, onChange, disabled }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className="block text-[11px] text-white/55">
      <span className="flex justify-between"><span>{label}</span><span className="text-white/80">{value}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(+e.target.value)} className="w-full" />
    </label>
  );
}

function Props({ L, one, plot, editable, onPatch, onDelete }: {
  L: ReturnType<typeof lpLabels>; one: { type: string; obj: Record<string, unknown> & { id: string } }; plot: LightPlotData; editable: boolean;
  onPatch: (p: Record<string, unknown>) => void; onDelete: () => void; bg: boolean;
}) {
  const o = one.obj as Record<string, unknown>;
  const field = "w-full mt-0.5 h-8 rounded-md bg-white/5 border border-white/10 px-2 text-[12px] text-white outline-none focus:border-blue-500";
  const text = (k: string, label: string) => (
    <label key={k} className="block text-[11px] text-white/55">{label}
      <input key={`${o.id}-${k}`} defaultValue={String(o[k] ?? "")} disabled={!editable} onBlur={(e) => e.target.value !== String(o[k] ?? "") && onPatch({ [k]: e.target.value.slice(0, 60) })} className={field} />
    </label>
  );
  const sel = (k: string, label: string, options: [string, string][]) => (
    <label key={k} className="block text-[11px] text-white/55">{label}
      <select value={String(o[k] ?? "")} disabled={!editable} onChange={(e) => onPatch({ [k]: e.target.value })} className={field}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
  let body: React.ReactNode = null;
  if (one.type === "light") {
    const li = o as unknown as import("@/lib/lightPlot").LpLight;
    const [kmin, kmax] = kelvinRange(li.preset);
    body = (
      <>
        <label className="block text-[11px] text-white/55">{L.preset}
          <select value={li.preset} disabled={!editable} className={field}
            onChange={(e) => { const p = presetOf(e.target.value); onPatch({ preset: e.target.value, name: e.target.value || li.name, ...(p ? { kelvin: Math.min(p.k[2], Math.max(p.k[1], li.kelvin)) } : {}) }); }}>
            <option value="">{L.customName}</option>
            {LIGHT_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </label>
        {text("name", L.name)}
        {sel("role", L.role, ROLES.map((r) => [r, L[r as Role]]))}
        {li.role === "custom" && text("role_label", L.roleLabel)}
        <Num label={L.kelvin} value={li.kelvin} min={kmin} max={kmax} step={50} disabled={!editable || kmin === kmax} onChange={(v) => onPatch({ kelvin: v })} />
        <Num label={`${L.intensity} %`} value={li.intensity} min={0} max={100} disabled={!editable} onChange={(v) => onPatch({ intensity: v })} />
        <label className="block text-[11px] text-white/55">{L.modifier}
          <select value={li.modifier} disabled={!editable} className={field} onChange={(e) => onPatch({ modifier: e.target.value, beam: MODIFIER_BEAM[e.target.value as Modifier] })}>
            {MODIFIERS.map((m) => <option key={m} value={m}>{L[m === "custom" ? "custom" : m]}</option>)}
          </select>
        </label>
        {li.modifier === "custom" && text("modifier_label", L.modLabel)}
        <Num label={`${L.beamAngle} °`} value={li.beam} min={5} max={360} disabled={!editable} onChange={(v) => onPatch({ beam: v })} />
        <Num label={`${L.rotation} °`} value={Math.round(li.rot)} min={-180} max={180} disabled={!editable} onChange={(v) => onPatch({ rot: v })} />
        <Num label={L.height} value={li.z ?? 2} min={0.2} max={6} step={0.1} disabled={!editable} onChange={(v) => onPatch({ z: v })} />
        <Num label={L.tilt} value={li.tilt ?? 25} min={-60} max={90} disabled={!editable} onChange={(v) => onPatch({ tilt: v })} />
      </>
    );
  } else if (one.type === "person") {
    body = (
      <>
        {text("name", L.name)}
        {o.kind === "camera" && (
          <>
            {text("body", L.body)}
            <Num label={`${L.wb} K`} value={Number(o.kelvin ?? 5600)} min={2000} max={10000} step={100} disabled={!editable} onChange={(v) => onPatch({ kelvin: v })} />
            <Num label={`${L.lens} mm`} value={Number(o.lens_mm ?? 35)} min={8} max={200} disabled={!editable} onChange={(v) => onPatch({ lens_mm: v })} />
            {sel("sensor", L.sensor, [["s35", "Super 35"], ["ff", "Full Frame"]])}
            <Num label={L.height} value={Number(o.z ?? 1.5)} min={0.2} max={5} step={0.05} disabled={!editable} onChange={(v) => onPatch({ z: v })} />
            <Num label={L.tilt} value={Number(o.tilt ?? 0)} min={-45} max={45} disabled={!editable} onChange={(v) => onPatch({ tilt: v })} />
          </>
        )}
        {o.kind === "talent" && (
          <>
            {sel("pose", L.pose, [["standing", L.standing], ["sitting", L.sitting]])}
            <Num label={L.bodyHeight} value={Number(o.height_m ?? 1.75)} min={0.9} max={2.2} step={0.05} disabled={!editable} onChange={(v) => onPatch({ height_m: v })} />
          </>
        )}
        <Num label={`${L.rotation} °`} value={Math.round(Number(o.rot ?? 0))} min={-180} max={180} disabled={!editable} onChange={(v) => onPatch({ rot: v })} />
      </>
    );
  } else if (one.type === "wall") {
    body = (
      <>
        {sel("kind", "", (["wall", "curve", "window", "door", "opening"] as WallKind[]).map((k) => [k, L[k]]))}
        {o.kind === "curve" && <Num label={L.bend} value={Number(o.bend ?? 0.25)} min={-1} max={1} step={0.05} disabled={!editable} onChange={(v) => onPatch({ bend: v })} />}
        <div className="text-[11px] text-white/55">{Math.hypot(Number(o.x2) - Number(o.x1), Number(o.y2) - Number(o.y1)).toFixed(2)} m</div>
      </>
    );
  } else if (one.type === "item") {
    body = (
      <>
        {sel("kind", "", (Object.keys(ITEM_SIZE) as ItemKind[]).map((k) => [k, L[k]]))}
        {text("label", L.label)}
        <Num label={`${L.width} (m)`} value={Number(o.w)} min={0.1} max={20} step={0.1} disabled={!editable} onChange={(v) => onPatch({ w: v })} />
        <Num label={`${L.depth} (m)`} value={Number(o.h)} min={0.1} max={20} step={0.1} disabled={!editable} onChange={(v) => onPatch({ h: v })} />
        <Num label={`${L.rotation} °`} value={Math.round(Number(o.rot ?? 0))} min={-180} max={180} disabled={!editable} onChange={(v) => onPatch({ rot: v })} />
      </>
    );
  } else if (one.type === "label") {
    body = text("text", L.label);
  } else if (one.type === "mod") {
    body = (
      <>
        {sel("kind", "", [["flag", L.flag], ["diffusion", L.diffusion]])}
        {text("label", L.label)}
      </>
    );
  }
  void plot;
  return (
    <div className="p-3 border-b border-white/10 space-y-2" data-lp-props>
      {body}
      {editable && <button onClick={onDelete} className="mt-1 h-7 px-2.5 rounded-md bg-red-600/90 hover:bg-red-500 text-[12px] font-semibold">{L.delete}</button>}
    </div>
  );
}

/** a one-page PDF with the plan as a JPEG (no library, no server) */
function makePdf(jpg: Uint8Array, w: number, h: number): Blob {
  const pageW = 842, pageH = Math.round((842 * h) / w); // A4 landscape width, height to the image's ratio
  const enc = new TextEncoder();
  const parts: (Uint8Array | string)[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (p: Uint8Array | string) => { const b = typeof p === "string" ? enc.encode(p) : p; parts.push(b); len += b.length; };
  push("%PDF-1.4\n");
  const obj = (n: number, body: (string | Uint8Array)[]) => { offsets[n] = len; push(`${n} 0 obj\n`); body.forEach(push); push("\nendobj\n"); };
  obj(1, ["<< /Type /Catalog /Pages 2 0 R >>"]);
  obj(2, ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"]);
  obj(3, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`]);
  obj(4, [`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream"]);
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  obj(5, [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const xref = len;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => `${String(offsets[n]).padStart(10, "0")} 00000 n \n`).join("")}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

export { emptyPlot };
