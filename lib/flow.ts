import type { FlowElement, FlowPathEntry, FlowStep } from "./board";

/** 2026-11-11, Lino: «Frageablauf» — one step of playing the flow. Mirrors subshot-api
 * idea_board.flow_advance exactly (the MCP tool flow_answer uses that one):
 * - yes / no on a question → its target (none = finished)
 * - done on an end step → its `next`; else back to the latest question answered «Nein» (and not
 *   answered again since), continuing with its «Ja»; nothing left = finished
 * - back = undo the last answer; restart = from the start step */
export type FlowAction = "yes" | "no" | "done" | "back" | "restart";

export type FlowState = Pick<FlowElement, "current_step" | "path" | "finished">;

export function flowCurrent(el: FlowElement): FlowStep | null {
  const id = el.current_step ?? el.start_step ?? el.steps[0]?.id;
  return el.steps.find((s) => s.id === id) ?? null;
}

export function flowAdvance(el: FlowElement, action: FlowAction): FlowState | null {
  const steps = new Map(el.steps.map((s) => [s.id, s]));
  const path: FlowPathEntry[] = [...(el.path ?? [])];
  const cur = el.current_step ?? el.start_step ?? el.steps[0]?.id;
  const state = (current: string | undefined, p: FlowPathEntry[], finished = false): FlowState => ({
    current_step: current,
    path: p.length ? p : undefined,
    finished: finished || undefined,
  });
  if (action === "restart") return state(el.start_step ?? el.steps[0]?.id, []);
  if (action === "back") {
    const last = path.pop();
    return last ? state(last.s, path) : state(cur, []);
  }
  const step = cur ? steps.get(cur) : undefined;
  if (el.finished || !step) return null;
  if (action === "yes" || action === "no") {
    if (step.kind !== "question") return null;
    path.push({ s: step.id, a: action });
    const target = step[action];
    return target && steps.has(target) ? state(target, path) : state(step.id, path, true);
  }
  if (step.kind !== "end") return null;
  path.push({ s: step.id, a: "done" });
  if (step.next && steps.has(step.next)) return state(step.next, path);
  const later = new Set<string>();
  for (let i = path.length - 1; i >= 0; i--) {
    const e = path[i];
    const q = steps.get(e.s);
    if (e.a === "no" && !later.has(e.s) && q?.yes && steps.has(q.yes)) {
      path.push({ s: e.s, a: "yes", r: true });
      return state(q.yes, path);
    }
    later.add(e.s);
  }
  return state(step.id, path, true);
}

/** the step id a new step gets */
export function newFlowStepId(): string {
  return Math.random().toString(36).slice(2, 10);
}
