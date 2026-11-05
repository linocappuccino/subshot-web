// 2026-11-04, Lino: live clock in the Drehplan / Callsheet — which scene should be running now, a countdown on it,
// «Behind schedule» with minus minutes once the planned time is used up, and the delay carried onto every later
// scene. The clock only moves on when the scene is ticked off or cancelled (Scene.completed → status done/not_shot).
// Same delay model as the server's live schedule (app/live_schedule.py), on the Drehplan's linked scene cards.
import type { ScheduleScene } from "./timetable";

export interface LiveModel {
  state: "empty" | "not_started" | "running" | "wrapped";
  /** minutes, + = behind plan, − = ahead */
  delayMin: number;
  currentKey: string | null;
  current: ScheduleScene | null;
  /** when the current scene really started / how long it may take (ms) — drives the countdown */
  startedMs: number | null;
  durMs: number;
  plannedStartMs: number | null;
  /** key → shifted start (HH:MM) for every later open scene while the day is off plan */
  shifted: Record<string, string>;
  projectedEnd: string | null;
  plannedEnd: string | null;
}

const MIN = 60000;

function todayMs(hhmm: string, now: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || "");
  if (!m) return null;
  const d = new Date(now);
  d.setHours(+m[1], +m[2], 0, 0);
  return d.getTime();
}

export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function liveModel(items: ScheduleScene[], keyOf: (s: ScheduleScene) => string, now: Date): LiveModel {
  const nowMs = now.getTime();
  const seq = items
    .filter((s) => s.linked && todayMs(s.start, now) != null)
    .map((s) => ({ s, key: keyOf(s), start: todayMs(s.start, now) as number, dur: (s.duration ?? 0) * MIN }))
    .sort((a, b) => a.start - b.start);
  const empty: LiveModel = { state: "empty", delayMin: 0, currentKey: null, current: null, startedMs: null, durMs: 0, plannedStartMs: null, shifted: {}, projectedEnd: null, plannedEnd: null };
  if (!seq.length) return empty;
  const todayStr = now.toDateString();
  const doneTimes = seq
    .filter((r) => r.s.status && r.s.status !== "open" && r.s.done_at)
    .map((r) => new Date(r.s.done_at as string))
    .filter((d) => d.toDateString() === todayStr)
    .map((d) => d.getTime());
  const lastDone = doneTimes.length ? Math.max(...doneTimes) : null;
  const planEnd = Math.max(...seq.map((r) => r.start + r.dur));
  const idx = seq.findIndex((r) => (r.s.status ?? "open") === "open");
  if (idx < 0) {
    const delay = lastDone != null ? Math.round((lastDone - planEnd) / MIN) : 0;
    return { ...empty, state: "wrapped", delayMin: delay, plannedEnd: fmtClock(planEnd), projectedEnd: fmtClock(planEnd + delay * MIN) };
  }
  const cur = seq[idx];
  const started = lastDone != null && lastDone > cur.start - 6 * 3600000 ? lastDone : nowMs >= cur.start ? cur.start : null;
  if (started == null) {
    return { ...empty, state: "not_started", currentKey: cur.key, current: cur.s, durMs: cur.dur, plannedStartMs: cur.start, plannedEnd: fmtClock(planEnd), projectedEnd: fmtClock(planEnd) };
  }
  const delay = Math.round((Math.max(started + cur.dur, nowMs) - (cur.start + cur.dur)) / MIN);
  const shifted: Record<string, string> = {};
  if (delay !== 0) for (const r of seq.slice(idx)) shifted[r.key] = fmtClock(r.start + delay * MIN);
  return { state: "running", delayMin: delay, currentKey: cur.key, current: cur.s, startedMs: started, durMs: cur.dur, plannedStartMs: cur.start, shifted, plannedEnd: fmtClock(planEnd), projectedEnd: fmtClock(planEnd + delay * MIN) };
}

/** remaining ms → «12:05» / «1:02:05»; negative → «−03:10» */
export function fmtCountdown(remainingMs: number): string {
  const neg = remainingMs < 0;
  const total = Math.floor(Math.abs(remainingMs) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${neg ? "−" : ""}${h ? `${h}:${p(m)}` : p(m)}:${p(sec)}`;
}
