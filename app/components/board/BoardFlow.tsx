"use client";

/**
 * 2026-11-11, Lino: «Frageablauf» — a decision flow node. ADMIN-ONLY for now (the API keeps it only on
 * the admin's projects, the add menus show it only to the admin).
 *
 * «Ansicht» plays it: the current question with «Ja» / «Nein», an end step with «Erledigt, weiter»,
 * «Zurück», «Neu starten» and the path so far. The play state lives in the node (shared live).
 * «Bearbeiten» (admin only) is a flow chart right in the node (2026-11-11, Lino: «so umständlich — ein
 * Node-System mit Linien», Variante 1): boxes laid out automatically as a tree, a click on a free
 * Ja / Nein / Weiter handle adds the next box below it, dragging a handle onto another box links there,
 * a click on a line removes it. The Ansicht / Bearbeiten switch is
 * per person (local state) and never touches the play progress.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FlowElement, FlowStep } from "@/lib/board";
import { flowAdvance, flowCurrent, newFlowStepId, type FlowAction, type FlowState } from "@/lib/flow";

export type FlowPatch = Partial<Pick<FlowElement, "title" | "steps" | "start_step">> & Partial<Record<keyof FlowState, unknown>>;


export function FlowNode({
  el,
  editable,
  canEdit,
  onCommit,
  onMeasure,
}: {
  el: FlowElement;
  /** may play (team board) — read-only views (client preview) only show the state */
  editable: boolean;
  /** admin: may switch to «Bearbeiten» */
  canEdit: boolean;
  onCommit: (patch: FlowPatch) => void;
  onMeasure: (h: number) => void;
}) {
  const [mode, setMode] = useState<"view" | "edit">(() => (canEdit && el.steps.length === 0 ? "edit" : "view"));
  const editing = mode === "edit" && canEdit;

  // the card follows its content (like the Timetable)
  const cardRef = useRef<HTMLDivElement>(null);
  const hRef = useRef(el.h);
  const measure = useRef(onMeasure);
  useLayoutEffect(() => {
    hRef.current = el.h;
    measure.current = onMeasure;
  });
  useEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const check = () => {
      const h = node.offsetHeight;
      if (Math.abs(h - hRef.current) > 1) measure.current(h);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  function play(action: FlowAction) {
    const next = flowAdvance(el, action);
    if (next) onCommit(next);
  }

  return (
    <div
      ref={cardRef}
      data-flow-node
      className="w-full rounded-xl bg-[#1f2026] border border-indigo-400/30 shadow-[0_2px_10px_rgba(0,0,0,0.35)] text-white overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-indigo-500/10">
        <span className="text-base">🧭</span>
        <span className="flex-1 min-w-0 truncate text-sm font-semibold">{el.title || "Frageablauf"}</span>
        {canEdit && (
          <div data-no-drag className="flex shrink-0 rounded-lg bg-black/30 p-0.5 text-xs font-semibold">
            {(["view", "edit"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2.5 py-1 rounded-md transition-colors ${mode === m ? "bg-indigo-500 text-white" : "text-white/60 hover:text-white"}`}
              >
                {m === "view" ? "Ansicht" : "Bearbeiten"}
              </button>
            ))}
          </div>
        )}
      </div>
      {editing ? <FlowGraphEditor el={el} onCommit={onCommit} /> : <FlowPlayer el={el} editable={editable} onPlay={play} />}
    </div>
  );
}

function FlowPlayer({ el, editable, onPlay }: { el: FlowElement; editable: boolean; onPlay: (a: FlowAction) => void }) {
  const steps = new Map(el.steps.map((s) => [s.id, s]));
  const cur = flowCurrent(el);
  const path = el.path ?? [];
  if (!cur) {
    return <p className="px-4 py-6 text-sm text-white/50">Noch keine Fragen. {editable ? "Unter «Bearbeiten» anlegen." : ""}</p>;
  }
  const btn = "rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-default";
  return (
    <div className="p-4 flex flex-col gap-3">
      {path.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {path.map((e, i) => {
            const s = steps.get(e.s);
            const label = e.a === "yes" ? (e.r ? "Ja ↩" : "Ja") : e.a === "no" ? "Nein" : "✓";
            return (
              <span
                key={i}
                title={s?.text}
                className={`max-w-[220px] truncate rounded-full px-2 py-0.5 text-[11px] ${e.a === "no" ? "bg-red-500/15 text-red-200" : e.a === "yes" ? "bg-emerald-500/15 text-emerald-200" : "bg-white/10 text-white/60"}`}
              >
                {(s?.text || "…").slice(0, 40)} · {label}
              </span>
            );
          })}
        </div>
      )}
      {el.finished ? (
        <div className="rounded-xl bg-emerald-500/15 border border-emerald-400/30 px-4 py-5 text-center">
          <div className="text-2xl">✓</div>
          <div className="text-sm font-semibold text-emerald-100 mt-1">Fertig</div>
        </div>
      ) : cur.kind === "question" ? (
        <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-4">
          <div className="text-[11px] uppercase tracking-wide text-white/40 mb-1">Frage</div>
          <div className="text-[15px] leading-snug whitespace-pre-wrap">{cur.text || "…"}</div>
          <div data-no-drag className="flex gap-2 mt-4">
            <button type="button" disabled={!editable} onClick={() => onPlay("yes")} className={`${btn} flex-1 bg-emerald-600 hover:bg-emerald-500`}>
              Ja
            </button>
            <button type="button" disabled={!editable} onClick={() => onPlay("no")} className={`${btn} flex-1 bg-red-600 hover:bg-red-500`}>
              Nein
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 px-4 py-4">
          <div className="text-[11px] uppercase tracking-wide text-amber-200/70 mb-1">Antwort / Aufgabe</div>
          <div className="text-[15px] leading-snug whitespace-pre-wrap">{cur.text || "…"}</div>
          <div data-no-drag className="mt-4">
            <button type="button" disabled={!editable} onClick={() => onPlay("done")} className={`${btn} w-full bg-amber-500 text-black hover:bg-amber-400`}>
              Erledigt, weiter
            </button>
          </div>
        </div>
      )}
      <div data-no-drag className="flex justify-between text-xs">
        <button type="button" disabled={!editable || path.length === 0} onClick={() => onPlay("back")} className="px-2 py-1 rounded-md text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30">
          ← Zurück
        </button>
        <button type="button" disabled={!editable || (path.length === 0 && !el.finished)} onClick={() => onPlay("restart")} className="px-2 py-1 rounded-md text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30">
          ↺ Neu starten
        </button>
      </div>
    </div>
  );
}


/** text that's stored when the field loses focus (one undo step per edit, not per key) */
function DraftText({ value, onSave, placeholder, className }: { value: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      rows={3}
      value={focused ? draft : value}
      placeholder={placeholder}
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onSave(draft);
      }}
      className={`w-full resize-none bg-transparent px-2.5 py-2 text-[13px] leading-snug outline-none select-text placeholder:text-white/30 ${className ?? ""}`}
    />
  );
}

// ── flow chart editor (automatic tree layout) ─────────────────────────────

const BOX_W = 210;
const BOX_H = 112;
const GAP_X = 36;
const ROW_H = BOX_H + 84;
const PAD = 24;

type PortKey = "yes" | "no" | "next";
type Pos = { x: number; y: number };

/** tree layout: each step sits under the first port that leads to it (Ja left, Nein right); links to a
 * step placed elsewhere are drawn as curved back-links. Steps nothing leads to start their own tree. */
function layoutFlow(steps: FlowStep[], start: string | undefined) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const children = new Map<string, string[]>();
  const placed = new Set<string>();
  const roots: string[] = [];
  const visit = (id: string) => {
    placed.add(id);
    const s = byId.get(id)!;
    const kids: string[] = [];
    for (const k of (s.kind === "question" ? ["yes", "no"] : ["next"]) as PortKey[]) {
      const t = s[k];
      if (t && byId.has(t) && !placed.has(t)) {
        placed.add(t);
        kids.push(t);
      }
    }
    children.set(id, kids);
    kids.forEach((k) => visit(k));
  };
  const order = [start, ...steps.map((s) => s.id)].filter((x): x is string => !!x && byId.has(x));
  for (const id of order) {
    if (placed.has(id)) continue;
    roots.push(id);
    visit(id);
  }
  const width = new Map<string, number>();
  const measure = (id: string): number => {
    const kids = children.get(id) ?? [];
    const w = kids.length ? Math.max(BOX_W, kids.reduce((a, k) => a + measure(k), 0) + GAP_X * (kids.length - 1)) : BOX_W;
    width.set(id, w);
    return w;
  };
  const pos = new Map<string, Pos>();
  let depthMax = 0;
  const place = (id: string, left: number, depth: number) => {
    const w = width.get(id)!;
    pos.set(id, { x: left + (w - BOX_W) / 2, y: depth * ROW_H });
    depthMax = Math.max(depthMax, depth);
    let x = left;
    const kids = children.get(id) ?? [];
    const sum = kids.reduce((a, k) => a + width.get(k)!, 0) + GAP_X * Math.max(0, kids.length - 1);
    x += (w - sum) / 2;
    for (const k of kids) {
      place(k, x, depth + 1);
      x += width.get(k)! + GAP_X;
    }
  };
  let left = 0;
  for (const r of roots) {
    measure(r);
    place(r, left, 0);
    left += width.get(r)! + GAP_X * 2;
  }
  const tree = new Set<string>();
  for (const [id, kids] of children) for (const k of kids) tree.add(`${id}>${k}`);
  return { pos, tree, w: Math.max(BOX_W, left - GAP_X * 2), h: depthMax * ROW_H + BOX_H };
}

function portX(s: FlowStep, k: PortKey): number {
  if (s.kind === "end") return BOX_W / 2;
  return k === "yes" ? BOX_W * 0.27 : BOX_W * 0.73;
}

const PORT_STYLE: Record<PortKey, { label: string; color: string; cls: string }> = {
  yes: { label: "Ja", color: "#34d399", cls: "bg-emerald-600 hover:bg-emerald-500" },
  no: { label: "Nein", color: "#f87171", cls: "bg-red-600 hover:bg-red-500" },
  next: { label: "Weiter", color: "#fbbf24", cls: "bg-amber-500 text-black hover:bg-amber-400" },
};

function FlowGraphEditor({ el, onCommit }: { el: FlowElement; onCommit: (patch: FlowPatch) => void }) {
  const steps = el.steps;
  const start = el.start_step ?? steps[0]?.id;
  const { pos, tree, w, h } = layoutFlow(steps, start);
  const areaRef = useRef<HTMLDivElement>(null);
  const [chooser, setChooser] = useState<{ from: string; key: PortKey } | null>(null);
  const [lineMenu, setLineMenu] = useState<{ from: string; key: PortKey; at: Pos } | null>(null);
  const [drag, setDrag] = useState<{ from: string; key: PortKey; at: Pos; over: string | null } | null>(null);

  // the node is as wide as the chart (it grows; never shrinks below what the person made it)
  const wantW = w + PAD * 2 + 2;
  const lastW = useRef(0);
  useEffect(() => {
    if (wantW > el.w + 1 && lastW.current !== wantW) {
      lastW.current = wantW;
      onCommit({ w: wantW } as FlowPatch);
    }
  }, [wantW, el.w, onCommit]);

  function local(e: { clientX: number; clientY: number }): Pos {
    const r = areaRef.current!.getBoundingClientRect();
    const k = areaRef.current!.offsetWidth / Math.max(1, r.width); // board zoom
    return { x: (e.clientX - r.left) * k - PAD, y: (e.clientY - r.top) * k - PAD };
  }

  function setSteps(next: FlowStep[], extra: FlowPatch = {}) {
    onCommit({ steps: next.map(clean), ...extra });
  }
  function update(id: string, patch: Partial<FlowStep>) {
    setSteps(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }
  function addStep(kind: FlowStep["kind"], from?: { from: string; key: PortKey }) {
    const step: FlowStep = { id: newFlowStepId(), kind, text: "" };
    const next = [...steps, step].map((s) => (from && s.id === from.from ? { ...s, [from.key]: step.id } : s));
    setSteps(next, steps.length === 0 ? { start_step: step.id } : {});
    setChooser(null);
  }
  function link(from: string, key: PortKey, to: string | undefined) {
    update(from, { [key]: to });
    setLineMenu(null);
  }
  function remove(id: string) {
    const next = steps.filter((s) => s.id !== id).map((s) => ({ ...s, yes: s.yes === id ? undefined : s.yes, no: s.no === id ? undefined : s.no, next: s.next === id ? undefined : s.next }));
    const extra: FlowPatch = {};
    if (start === id) extra.start_step = next[0]?.id;
    if (el.current_step === id || el.path?.some((p) => p.s === id)) Object.assign(extra, { current_step: undefined, path: undefined, finished: undefined });
    setSteps(next, extra);
  }

  function portDown(e: React.PointerEvent, s: FlowStep, key: PortKey) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      moved = true;
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-flow-step]");
      const over = hit && hit.dataset.flowStep !== s.id ? hit.dataset.flowStep! : null;
      setDrag({ from: s.id, key, at: local(ev), over });
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!moved) {
        // a click: a free handle adds the next box, a used one offers to remove its line
        if (s[key]) setLineMenu({ from: s.id, key, at: { x: (pos.get(s.id)?.x ?? 0) + portX(s, key), y: (pos.get(s.id)?.y ?? 0) + BOX_H + 30 } });
        else setChooser({ from: s.id, key });
        return;
      }
      const hit = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-flow-step]");
      const to = hit?.dataset.flowStep;
      if (to && to !== s.id) link(s.id, key, to);
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  }

  // lines: from a box's handle to the top of the box it leads to
  const lines: { from: string; key: PortKey; d: string; color: string; back: boolean; mid: Pos }[] = [];
  for (const s of steps) {
    const a = pos.get(s.id);
    if (!a) continue;
    for (const key of (s.kind === "question" ? ["yes", "no"] : ["next"]) as PortKey[]) {
      const to = s[key];
      const b = to ? pos.get(to) : undefined;
      if (!to || !b) continue;
      const x1 = a.x + portX(s, key);
      const y1 = a.y + BOX_H + 14;
      const back = !tree.has(`${s.id}>${to}`);
      let x2 = b.x + BOX_W / 2;
      let y2 = b.y - 2;
      let d = `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2}, ${x2} ${(y1 + y2) / 2}, ${x2} ${y2}`;
      if (back) {
        // a link to a box placed elsewhere (sideways / back up): into the box's side, dashed
        const right = b.x + BOX_W / 2 < a.x + portX(s, key) ? true : b.x >= a.x + BOX_W ? false : true;
        x2 = right ? b.x + BOX_W + 2 : b.x - 2;
        y2 = b.y + BOX_H / 2;
        const out = right ? x2 + 46 : x2 - 46;
        d = `M ${x1} ${y1} C ${x1} ${y1 + 50}, ${out} ${y2}, ${x2} ${y2}`;
      }
      lines.push({ from: s.id, key, d, color: PORT_STYLE[key].color, back, mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 } });
    }
  }
  const dragFrom = drag ? steps.find((s) => s.id === drag.from) : null;
  const dragStart = drag && dragFrom ? { x: (pos.get(dragFrom.id)?.x ?? 0) + portX(dragFrom, drag.key), y: (pos.get(dragFrom.id)?.y ?? 0) + BOX_H + 14 } : null;

  return (
    <div
      data-no-drag
      className="cursor-auto select-none"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 px-3 pt-3">
        <TitleInput value={el.title} onSave={(title) => onCommit({ title })} />
        <button type="button" onClick={() => addStep("question")} className="shrink-0 rounded-lg bg-indigo-500/25 hover:bg-indigo-500/40 px-2.5 py-1.5 text-xs font-semibold">
          ＋ Frage
        </button>
        <button type="button" onClick={() => addStep("end")} className="shrink-0 rounded-lg bg-amber-500/25 hover:bg-amber-500/40 px-2.5 py-1.5 text-xs font-semibold">
          ＋ Antwort
        </button>
      </div>
      <p className="px-3 pt-1.5 text-[11px] text-white/40">Klick auf «Ja» / «Nein» / «Weiter» = nächste Box darunter · Anschluss auf eine Box ziehen = dorthin verlinken · Klick auf eine Linie = löschen</p>
      <div ref={areaRef} className="relative" style={{ width: w + PAD * 2, height: (steps.length ? h : 120) + PAD * 2 + 40 }}>
        <svg className="absolute pointer-events-none" style={{ left: PAD, top: PAD, overflow: "visible" }} width={w} height={h}>
          <defs>
            {(["yes", "no", "next"] as PortKey[]).map((k) => (
              <marker key={k} id={`flow-arrow-${k}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill={PORT_STYLE[k].color} />
              </marker>
            ))}
          </defs>
          {lines.map((l) => (
            <g key={`${l.from}-${l.key}`}>
              <path d={l.d} fill="none" stroke={l.color} strokeWidth={2.5} strokeDasharray={l.back ? "6 5" : undefined} markerEnd={`url(#flow-arrow-${l.key})`} opacity={0.9} />
              <path
                d={l.d}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                className="pointer-events-auto cursor-pointer"
                data-flow-line={`${l.from}:${l.key}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setLineMenu({ from: l.from, key: l.key, at: local(e) });
                }}
              />
            </g>
          ))}
          {drag && dragStart && <path d={`M ${dragStart.x} ${dragStart.y} L ${drag.at.x} ${drag.at.y}`} stroke={PORT_STYLE[drag.key].color} strokeWidth={2.5} strokeDasharray="5 4" fill="none" />}
        </svg>
        {steps.length === 0 && (
          <div className="absolute inset-x-0 flex justify-center gap-2" style={{ top: PAD + 20 }}>
            <button type="button" onClick={() => addStep("question")} className="rounded-xl bg-indigo-500 hover:bg-indigo-400 px-4 py-2.5 text-sm font-semibold">
              ＋ Erste Frage
            </button>
          </div>
        )}
        {steps.map((s) => {
          const p = pos.get(s.id);
          if (!p) return null;
          const isQ = s.kind === "question";
          return (
            <div key={s.id} className="absolute" style={{ left: PAD + p.x, top: PAD + p.y, width: BOX_W }}>
              <div
                data-flow-step={s.id}
                className={`rounded-xl border-2 overflow-hidden transition-shadow ${isQ ? "bg-[#2a2b35] border-indigo-400/40" : "bg-[#352f22] border-amber-400/45"} ${drag?.over === s.id ? "ring-4 ring-white/60" : ""} ${s.id === start ? "shadow-[0_0_0_3px_rgba(129,140,248,0.55)]" : ""}`}
                style={{ height: BOX_H }}
              >
                <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[10px] font-bold uppercase tracking-wide">
                  <span className={isQ ? "text-indigo-200" : "text-amber-200"}>{isQ ? "Frage" : "Antwort / Aufgabe"}</span>
                  {s.id === start ? (
                    <span className="rounded bg-indigo-500 px-1.5 py-px text-white normal-case tracking-normal">▶ Start</span>
                  ) : (
                    <button type="button" title="Hier starten" onClick={() => onCommit({ start_step: s.id })} className="rounded px-1 text-white/30 hover:text-white hover:bg-white/10 normal-case tracking-normal">
                      ▶
                    </button>
                  )}
                  <button type="button" title="Box löschen" onClick={() => remove(s.id)} className="ml-auto rounded px-1 text-white/35 hover:text-red-300 hover:bg-white/10">
                    ✕
                  </button>
                </div>
                <DraftText value={s.text} placeholder={isQ ? "Frage eintippen …" : "Antwort / Aufgabe eintippen …"} onSave={(text) => update(s.id, { text })} />
              </div>
              <div className="flex justify-around mt-[-10px] relative">
                {((isQ ? ["yes", "no"] : ["next"]) as PortKey[]).map((key) => {
                  const st = PORT_STYLE[key];
                  const used = !!s[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      data-flow-port={`${s.id}:${key}`}
                      onPointerDown={(e) => portDown(e, s, key)}
                      title={used ? "Ziehen = anders verlinken · Klick = Linie löschen" : "Klick = neue Box darunter · Ziehen auf eine Box = verlinken"}
                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold shadow-md touch-none cursor-crosshair ${st.cls} ${used ? "" : "ring-2 ring-white/25"}`}
                    >
                      {used ? st.label : `＋ ${st.label}`}
                    </button>
                  );
                })}
              </div>
              {chooser?.from === s.id && (
                <div className="absolute z-10 left-1/2 -translate-x-1/2 mt-2 flex gap-1.5 rounded-xl bg-[#1c1c1e] border border-white/15 p-1.5 shadow-xl whitespace-nowrap">
                  <span className="self-center px-1 text-[11px] text-white/50">{PORT_STYLE[chooser.key].label} →</span>
                  <button type="button" onClick={() => addStep("question", chooser)} className="rounded-lg bg-indigo-500 hover:bg-indigo-400 px-2.5 py-1 text-xs font-semibold">
                    Frage
                  </button>
                  <button type="button" onClick={() => addStep("end", chooser)} className="rounded-lg bg-amber-500 text-black hover:bg-amber-400 px-2.5 py-1 text-xs font-semibold">
                    Antwort
                  </button>
                  <button type="button" onClick={() => setChooser(null)} className="rounded-lg px-1.5 text-white/50 hover:text-white">
                    ✕
                  </button>
                </div>
              )}
            </div>
          );
        })}
        {lineMenu && (
          <div className="absolute z-20 -translate-x-1/2 flex gap-1 rounded-lg bg-[#1c1c1e] border border-white/15 p-1 shadow-xl" style={{ left: PAD + lineMenu.at.x, top: PAD + lineMenu.at.y }}>
            <button type="button" onClick={() => link(lineMenu.from, lineMenu.key, undefined)} className="rounded-md bg-red-600 hover:bg-red-500 px-2.5 py-1 text-xs font-semibold whitespace-nowrap">
              Linie löschen
            </button>
            <button type="button" onClick={() => setLineMenu(null)} className="rounded-md px-1.5 text-white/50 hover:text-white">
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function TitleInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  return (
    <input
      value={focused ? draft : value}
      placeholder="Titel des Ablaufs"
      onFocus={() => {
        setDraft(value);
        setFocused(true);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setFocused(false);
        if (draft !== value) onSave(draft);
      }}
      className="flex-1 min-w-0 rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-indigo-400 select-text"
    />
  );
}

function clean(s: FlowStep): FlowStep {
  const out = { ...s };
  for (const k of ["yes", "no", "next"] as const) if (!out[k]) delete out[k];
  if (out.kind === "end") {
    delete out.yes;
    delete out.no;
  } else delete out.next;
  return out;
}
