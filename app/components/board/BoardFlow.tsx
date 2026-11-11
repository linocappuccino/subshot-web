"use client";

/**
 * 2026-11-11, Lino: «Frageablauf» — a decision flow node. ADMIN-ONLY for now (the API keeps it only on
 * the admin's projects, the add menus show it only to the admin).
 *
 * «Ansicht» plays it: the current question with «Ja» / «Nein», an end step with «Erledigt, weiter»,
 * «Zurück», «Neu starten» and the path so far. The play state lives in the node (shared live).
 * «Bearbeiten» (admin only) edits the steps right in the node. The Ansicht / Bearbeiten switch is
 * per person (local state) and never touches the play progress.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FlowElement, FlowStep } from "@/lib/board";
import { flowAdvance, flowCurrent, newFlowStepId, type FlowAction, type FlowState } from "@/lib/flow";

export type FlowPatch = Partial<Pick<FlowElement, "title" | "steps" | "start_step">> & Partial<Record<keyof FlowState, unknown>>;

const NEW_QUESTION = "__new_question";
const NEW_END = "__new_end";

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
      {editing ? <FlowEditor el={el} onCommit={onCommit} /> : <FlowPlayer el={el} editable={editable} onPlay={play} />}
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
function DraftText({ value, onSave, multiline, placeholder, className }: { value: string; onSave: (v: string) => void; multiline?: boolean; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : value;
  const props = {
    value: shown,
    placeholder,
    onFocus: () => {
      setDraft(value);
      setFocused(true);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => {
      setFocused(false);
      if (draft !== value) onSave(draft);
    },
    className: `w-full rounded-md bg-black/30 border border-white/10 px-2 py-1.5 text-sm outline-none focus:border-indigo-400 select-text ${className ?? ""}`,
  };
  return multiline ? <textarea rows={2} {...props} /> : <input {...props} />;
}

function FlowEditor({ el, onCommit }: { el: FlowElement; onCommit: (patch: FlowPatch) => void }) {
  const steps = el.steps;
  const start = el.start_step ?? steps[0]?.id;
  const label = (s: FlowStep, i: number) => `${s.kind === "question" ? "F" : "E"}${i + 1}: ${(s.text || "…").slice(0, 40)}`;

  function setSteps(next: FlowStep[], extra: FlowPatch = {}) {
    onCommit({ steps: next, ...extra });
  }
  function update(id: string, patch: Partial<FlowStep>) {
    setSteps(steps.map((s) => (s.id === id ? dropEmpty({ ...s, ...patch }) : s)));
  }
  function add(kind: FlowStep["kind"], linkFrom?: { id: string; key: "yes" | "no" | "next" }) {
    const step: FlowStep = { id: newFlowStepId(), kind, text: "" };
    const next = [...steps, step].map((s) => (linkFrom && s.id === linkFrom.id ? { ...s, [linkFrom.key]: step.id } : s));
    setSteps(next, steps.length === 0 ? { start_step: step.id } : {});
  }
  function remove(id: string) {
    const next = steps.filter((s) => s.id !== id).map((s) => dropEmpty({ ...s, yes: s.yes === id ? undefined : s.yes, no: s.no === id ? undefined : s.no, next: s.next === id ? undefined : s.next }));
    const extra: FlowPatch = {};
    if (start === id) extra.start_step = next[0]?.id;
    // the play state pointing at a removed step starts over
    if (el.current_step === id || el.path?.some((p) => p.s === id)) Object.assign(extra, { current_step: undefined, path: undefined, finished: undefined });
    setSteps(next, extra);
  }
  function target(s: FlowStep, key: "yes" | "no" | "next", value: string) {
    if (value === NEW_QUESTION) return add("question", { id: s.id, key });
    if (value === NEW_END) return add("end", { id: s.id, key });
    update(s.id, { [key]: value || undefined });
  }

  const select = "flex-1 min-w-0 rounded-md bg-black/30 border border-white/10 px-1.5 py-1 text-xs outline-none focus:border-indigo-400";
  const options = (self: string, emptyLabel: string) => (
    <>
      <option value="">{emptyLabel}</option>
      {steps.map((o, i) => (o.id === self ? null : <option key={o.id} value={o.id}>{label(o, i)}</option>))}
      <option value={NEW_QUESTION}>＋ Neue Frage</option>
      <option value={NEW_END}>＋ Neue Antwort / Aufgabe</option>
    </>
  );

  return (
    <div data-no-drag className="p-3 flex flex-col gap-3 cursor-auto">
      <DraftText value={el.title} placeholder="Titel des Ablaufs" onSave={(title) => onCommit({ title })} />
      {steps.length > 1 && (
        <label className="flex items-center gap-2 text-xs text-white/60">
          Start
          <select value={start} onChange={(e) => onCommit({ start_step: e.target.value })} className={select}>
            {steps.map((s, i) => <option key={s.id} value={s.id}>{label(s, i)}</option>)}
          </select>
        </label>
      )}
      {steps.map((s, i) => (
        <div key={s.id} className={`rounded-lg border p-2.5 flex flex-col gap-2 ${s.kind === "question" ? "border-white/10 bg-white/[0.03]" : "border-amber-400/25 bg-amber-500/[0.06]"}`}>
          <div className="flex items-center gap-2 text-[11px] font-semibold">
            <span className={`rounded px-1.5 py-0.5 ${s.kind === "question" ? "bg-indigo-500/30 text-indigo-100" : "bg-amber-500/30 text-amber-100"}`}>
              {s.kind === "question" ? `Frage F${i + 1}` : `Antwort / Aufgabe E${i + 1}`}
            </span>
            {s.id === start && <span className="text-white/40">Start</span>}
            <button type="button" onClick={() => remove(s.id)} className="ml-auto text-white/40 hover:text-red-300" title="Schritt löschen">
              ✕
            </button>
          </div>
          <DraftText multiline value={s.text} placeholder={s.kind === "question" ? "Frage …" : "Antwort oder Aufgabe …"} onSave={(text) => update(s.id, { text })} />
          {s.kind === "question" ? (
            <>
              <label className="flex items-center gap-2 text-xs">
                <span className="w-12 shrink-0 font-semibold text-emerald-300">Ja →</span>
                <select value={s.yes ?? ""} onChange={(e) => target(s, "yes", e.target.value)} className={select}>{options(s.id, "Ende des Ablaufs")}</select>
              </label>
              <label className="flex items-center gap-2 text-xs">
                <span className="w-12 shrink-0 font-semibold text-red-300">Nein →</span>
                <select value={s.no ?? ""} onChange={(e) => target(s, "no", e.target.value)} className={select}>{options(s.id, "Ende des Ablaufs")}</select>
              </label>
            </>
          ) : (
            <label className="flex items-center gap-2 text-xs">
              <span className="w-12 shrink-0 font-semibold text-amber-200">Weiter →</span>
              <select value={s.next ?? ""} onChange={(e) => target(s, "next", e.target.value)} className={select}>{options(s.id, "Zurück zur letzten «Nein»-Frage → Ja")}</select>
            </label>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={() => add("question")} className="flex-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 px-3 py-1.5 text-xs font-semibold">
          ＋ Frage
        </button>
        <button type="button" onClick={() => add("end")} className="flex-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 px-3 py-1.5 text-xs font-semibold">
          ＋ Antwort / Aufgabe
        </button>
      </div>
    </div>
  );
}

function dropEmpty(s: FlowStep): FlowStep {
  const out = { ...s };
  for (const k of ["yes", "no", "next"] as const) if (!out[k]) delete out[k];
  if (out.kind === "end") {
    delete out.yes;
    delete out.no;
  } else delete out.next;
  return out;
}
