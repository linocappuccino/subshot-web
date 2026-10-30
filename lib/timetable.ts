/** 2026-10-29, Lino: "Timetable" node on the idea board — a clean Drehplan
 * for the day. Nothing is copied into the node: its rows are derived from
 * the board's scene cards on every render, so a changed title, number,
 * time, place, description or dialogue shows up at once (also live from
 * other people via the collab doc) and the numbers always match the cards.
 *
 * Scene card times (all optional): `time` = Beginn, `time_end` = Ende
 * ("HH:MM"), `duration` = Dauer in minutes. Two of them give the third
 * (Beginn + Dauer = Ende, Ende − Beginn = Dauer); `time_fixed` = 🔒 the
 * start never moves with the chain. "Zeiten verketten" (default on, off
 * when a Timetable node has chain: false): changing a card's start or
 * duration moves every following card (Timetable order) by the same amount,
 * so gaps and durations stay — up to the next 🔒 card. Plain arithmetic, no AI.
 *
 * Kept free of runtime imports so `node --test` can run its tests directly
 * (tests/timetable.test.mts). The backend mirrors the row derivation in
 * app/idea_board.py:timetable_rows (PDF export, "Abgenommen"). */

import type { BoardElement, SceneElement, TimetableColumn, TimetableElement } from "./board";

const DAY = 24 * 60;

export interface TimetableRow {
  /** the scene card's element id */
  id: string;
  /** exactly the number on the card */
  number: number;
  title: string;
  /** title of the group the card sits in ("" when none) */
  group: string;
  /** "HH:MM" or "" */
  start: string;
  /** "HH:MM" or "" (given, or Beginn + Dauer) */
  end: string;
  /** the end lies on the next day (night shoot past midnight) */
  endNextDay: boolean;
  /** minutes or null (given, or Ende − Beginn) */
  duration: number | null;
  fixed: boolean;
  location: string;
  /** the card's description as plain text */
  description: string;
  dialogue: string[];
  priority: NonNullable<SceneElement["priority"]> | null;
  tags: string[];
  image: string | null;
}

/** Lino 2026-10-29: Nr., Szene, Beginn, Ende, Dauer, Location, Beschreibung,
 * Dialog (the group column joins automatically when cards sit in named groups) */
export const DEFAULT_TIMETABLE_COLUMNS: TimetableColumn[] = ["number", "title", "start", "end", "duration", "location", "description", "dialogue"];

// ── time helpers ──────────────────────────────────────────────────────────

/** "9:5" / "09:05:00" / junk → "09:05" or "" */
export function normalizeTime(v: unknown): string {
  const m = toMin(v);
  return m === null ? "" : fromMin(m);
}

/** "HH:MM" → minutes after midnight, or null */
export function toMin(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^\s*(\d{1,2}):(\d{1,2})(?::\d{1,2})?\s*$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}

/** what people type into a time field: "8" / "08" / "800" / "0830" / "8:30" / "8.30" / "8h30" → "08:30", else "" */
export function parseTimeInput(v: string): string {
  const s = v.trim().toLowerCase().replace(/\s*uhr$/, "");
  let m = /^(\d{1,2})[:.h](\d{2})$/.exec(s);
  if (m) return normalizeTime(`${m[1]}:${m[2]}`);
  m = /^(\d{1,2})$/.exec(s);
  if (m) return normalizeTime(`${m[1]}:00`);
  m = /^(\d{1,2})(\d{2})$/.exec(s);
  if (m) return normalizeTime(`${m[1]}:${m[2]}`);
  return "";
}

/** minutes → "HH:MM" (wraps around midnight) */
export function fromMin(m: number): string {
  const x = ((Math.round(m) % DAY) + DAY) % DAY;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
}

/** a valid duration in minutes (1 … 24 h), else null */
export function cleanDuration(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r >= 1 && r <= DAY ? r : null;
}

/** "45" / "45 min" / "1:30" / "1h30" / "1 h 30" / "1.5h" → minutes, "" → null */
export function parseDuration(v: string): number | null {
  const s = v.trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let m = /^(\d+):(\d{1,2})$/.exec(s);
  if (m) return cleanDuration(Number(m[1]) * 60 + Number(m[2]));
  m = /^(\d+(?:\.\d+)?)\s*(?:h|std|stunden?)\s*(?:(\d+)\s*(?:m|min|minuten)?)?$/.exec(s);
  if (m) return cleanDuration(Number(m[1]) * 60 + Number(m[2] ?? 0));
  m = /^(\d+)\s*(?:m|min|minuten)?$/.exec(s);
  if (m) return cleanDuration(Number(m[1]));
  return null;
}

/** 90 → "1 h 30", 45 → "45 min", 120 → "2 h" */
export function formatDuration(min: number | null): string {
  if (min === null) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

type Timed = Pick<SceneElement, "time" | "time_end" | "duration">;

/** Beginn / Ende / Dauer of a card — the missing third derived from the other two */
export function sceneTimes(el: Timed): { start: number | null; end: number | null; duration: number | null; endNextDay: boolean } {
  const start = toMin(el.time);
  let end = toMin(el.time_end);
  let duration = cleanDuration(el.duration);
  if (start !== null && duration !== null) end = start + duration;
  else if (start !== null && end !== null) duration = (((end - start) % DAY) + DAY) % DAY || null;
  const endNextDay = start !== null && end !== null && (end >= DAY || end < start);
  return { start, end: end === null ? null : end % DAY, duration, endNextDay };
}

export type TimeField = "time" | "time_end" | "duration";
/** what to write on the card: a value, or undefined = remove the field */
export type TimePatch = { time?: string; time_end?: string; duration?: number };

/** one field edited ("" / null clears it) → the card's new time fields:
 * Beginn + Dauer = Ende, Ende − Beginn = Dauer, Ende − Dauer = Beginn */
export function editSceneTime(el: Timed, field: TimeField, value: string | number | null): TimePatch {
  let { start, end, duration } = sceneTimes(el);
  if (field === "time") {
    start = typeof value === "string" ? toMin(value) : null;
    if (start !== null) {
      if (duration !== null) end = start + duration;
      else if (end !== null) duration = (((end - start) % DAY) + DAY) % DAY || null;
    }
  } else if (field === "time_end") {
    end = typeof value === "string" ? toMin(value) : null;
    if (end !== null) {
      if (start !== null) duration = (((end - start) % DAY) + DAY) % DAY || null;
      else if (duration !== null) start = end - duration;
    } else if (start !== null) duration = null; // Ende cleared: its Dauer would bring it right back
  } else {
    duration = cleanDuration(value);
    if (duration !== null) {
      if (start !== null) end = start + duration;
      else if (end !== null) start = end - duration;
    } else if (start !== null) end = null; // Dauer cleared: its Ende would bring it right back
  }
  return {
    time: start === null ? undefined : fromMin(start),
    time_end: end === null ? undefined : fromMin(end),
    duration: duration ?? undefined,
  };
}

/** "Zeiten verketten" is on unless a Timetable node switched it off */
export function chainEnabled(elements: BoardElement[]): boolean {
  return !elements.some((el) => el.type === "timetable" && el.chain === false);
}

/** the order the chain follows: the (first) Timetable node's sort */
export function chainSort(elements: BoardElement[]): TimetableElement["sort"] {
  const tt = elements.find((el): el is TimetableElement => el.type === "timetable");
  return tt?.sort ?? "time";
}

/** "Zeiten verketten": card `id` changed from `before` to `after` → the
 * following cards (Timetable order of the board BEFORE the change) move by
 * the same number of minutes its end moved (or its start, when it has no
 * end), so pauses between cards and their durations stay. Stops at the next
 * 🔒 card; cards without times are skipped (nothing is invented). A card
 * that would leave the day (before 00:00 / after 23:59) stops the chain:
 * it and everything after stay, `blocked` reports it. */
export function cascadeTimes(
  elements: BoardElement[],
  id: string,
  before: Timed,
  after: Timed,
  sort: TimetableElement["sort"] = "time",
): { patches: Map<string, TimePatch>; blocked: number | null; delta: number } {
  const patches = new Map<string, TimePatch>();
  const a = sceneTimes(before);
  const b = sceneTimes(after);
  // where the card now ends (unwrapped, so a night shoot past midnight counts on)
  const endOf = (t: ReturnType<typeof sceneTimes>) => (t.start !== null && t.duration !== null ? t.start + t.duration : t.end);
  let delta = 0;
  if (endOf(a) !== null && endOf(b) !== null) delta = endOf(b)! - endOf(a)!;
  else if (a.start !== null && b.start !== null) delta = b.start - a.start;
  if (!delta) return { patches, blocked: null, delta: 0 };
  const order = timetableRows(elements, sort).map((r) => r.id);
  const at = order.indexOf(id);
  if (at < 0) return { patches, blocked: null, delta };
  const byId = new Map(elements.map((el) => [el.id, el]));
  for (const fid of order.slice(at + 1)) {
    const f = byId.get(fid);
    if (!f || f.type !== "scene") continue;
    if (f.time_fixed) break;
    const t = sceneTimes(f);
    if (t.start === null && t.end === null) continue;
    const anchor = t.start ?? t.end!;
    const moved = anchor + delta;
    if (moved < 0 || moved >= DAY) return { patches, blocked: f.number, delta };
    patches.set(fid, {
      time: t.start === null ? undefined : fromMin(t.start + delta),
      time_end: t.end === null ? undefined : fromMin(t.end + delta),
      duration: t.duration ?? undefined,
    });
  }
  return { patches, blocked: null, delta };
}

// ── rows ──────────────────────────────────────────────────────────────────

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** board html (sanitized, tags only) → plain text with line breaks */
export function htmlToPlain(html: unknown): string {
  if (typeof html !== "string" || !html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h1|h2|h3|blockquote)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, k: string) => ENTITIES[k])
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

/** the columns a node shows: its own choice, else the default set (+ group when the board has named groups) */
export function timetableColumns(el: Pick<TimetableElement, "columns">, rows: TimetableRow[]): TimetableColumn[] {
  if (el.columns && el.columns.length) return el.columns;
  if (rows.some((r) => r.group)) return ["number", "group", ...DEFAULT_TIMETABLE_COLUMNS.slice(1)];
  return DEFAULT_TIMETABLE_COLUMNS;
}

export function timetableRows(elements: BoardElement[], sort: TimetableElement["sort"] = "time"): TimetableRow[] {
  const scenes = elements.filter((el): el is SceneElement => el.type === "scene");
  const groupOf = new Map<string, string>();
  for (const el of elements) {
    if (el.type === "group" && text(el.title)) for (const c of el.children ?? []) groupOf.set(c, text(el.title));
  }
  const times = new Map(scenes.map((el) => [el.id, sceneTimes(el)]));
  const byNumber = (a: SceneElement, b: SceneElement) => a.number - b.number || a.y - b.y || a.x - b.x;
  const sorted =
    sort === "number"
      ? [...scenes].sort(byNumber)
      : [...scenes].sort((a, b) => {
          // by start; a card with only an end sorts by that; untimed after all timed ones
          const ta = times.get(a.id)!;
          const tb = times.get(b.id)!;
          const ka = ta.start ?? ta.end;
          const kb = tb.start ?? tb.end;
          if (ka !== null && kb === null) return -1;
          if (ka === null && kb !== null) return 1;
          if (ka !== kb) return (ka ?? 0) - (kb ?? 0);
          return byNumber(a, b);
        });
  return sorted.map((el) => {
    const t = times.get(el.id)!;
    return {
      id: el.id,
      number: el.number,
      title: text(el.title),
      group: groupOf.get(el.id) ?? "",
      start: t.start === null ? "" : fromMin(t.start),
      end: t.end === null ? "" : fromMin(t.end),
      endNextDay: t.endNextDay,
      duration: t.duration,
      fixed: !!el.time_fixed,
      location: text(el.location_address),
      description: htmlToPlain(el.html),
      dialogue: (Array.isArray(el.dialogues) ? el.dialogues : []).map(text).filter(Boolean),
      priority: el.priority ?? null,
      tags: Array.isArray(el.tags) ? el.tags.map(text).filter(Boolean) : [],
      image: el.image_thumb_src || el.image_src || null,
    };
  });
}

// ── project-wide Drehplan (2026-10-30) ──────────────────────────────────────
/* Lino: «Shooting schedule» next to the PDF button on the ideas page — every idea board's
 * Timetable together, in time order, pauses between scenes. The rows come from the backend
 * (app/project_schedule.compute, the same data as the Drehplan PDF) and are shown with the
 * Timetable node's own cells (BoardTimetable.tsx). */

export interface ScheduleScene {
  kind: "scene";
  id?: string;
  idea_id?: string;
  number: number | null;
  title: string;
  group: string;
  /** the idea's title — a «Logistik» card's short label (Aufbau, Briefing, Umbau, Mittag, Abbau) */
  idea_title: string;
  /** position of the idea on the ideas page (story order) */
  idea_order?: number;
  start: string;
  end: string;
  end_next_day: boolean;
  duration: number | null;
  fixed?: boolean;
  location: string;
  description: string;
  dialogue: string[];
  priority?: SceneElement["priority"] | null;
  tags?: string[];
  /** share page: set by the backend instead of the tags */
  logistics?: boolean;
  overlap?: boolean;
  no_end?: boolean;
}

export interface SchedulePause {
  kind: "pause";
  start: string;
  end: string;
  duration: number;
}

export interface BoardSchedule {
  items: (ScheduleScene | SchedulePause)[];
  untimed: ScheduleScene[];
  warnings: string[];
  totals: { scenes: number; first_start: string; last_end: string; span: number | null; shooting: number; pauses: number };
  project_name?: string;
  shoot_date?: string | null;
  /** editors: a snapshot to go back to exists (app/schedule_plan.py) */
  can_undo?: boolean;
}

/** 2026-10-30, Lino: «Shotreihenfolge planen» — the Drehplan's edit actions (POST …/board-schedule/plan) */
export type SchedulePlanOp =
  | { op: "order"; order: string[] }
  | { op: "time"; key: string; field: TimeField; value: string | number | null }
  | { op: "fixed"; key: string; value: boolean }
  | { op: "story" }
  | { op: "undo" };

/** the key a Drehplan scene is addressed by: «idea id:card id» */
export function scheduleKey(s: Pick<ScheduleScene, "idea_id" | "id">): string {
  return `${s.idea_id ?? ""}:${s.id ?? ""}`;
}

/** the timed scenes' keys with scene `key` moved one place up (-1) or down (+1); null when it can't move */
export function moveInOrder(keys: string[], key: string, dir: -1 | 1): string[] | null {
  const i = keys.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= keys.length) return null;
  const out = [...keys];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export const LOGISTICS_TAG = "Logistik";

/** the columns of the project Drehplan — the node's default set with the idea in the group column */
export const SCHEDULE_COLUMNS: TimetableColumn[] = ["number", "group", "title", "start", "end", "duration", "location", "description", "dialogue"];

export function isLogistics(s: ScheduleScene): boolean {
  return s.logistics ?? (Array.isArray(s.tags) && s.tags.includes(LOGISTICS_TAG));
}

/** a Drehplan scene as a Timetable row; the «group» cell shows the idea (+ the board group) */
export function scheduleRow(s: ScheduleScene, index: number): TimetableRow {
  const idea = s.idea_title || "";
  return {
    id: s.id ? `${s.idea_id ?? ""}:${s.id}` : `row-${index}`,
    number: s.number ?? 0,
    title: s.title || "",
    group: s.group ? `${idea}\n${s.group}` : idea,
    start: s.start || "",
    end: s.end || "",
    endNextDay: !!s.end_next_day,
    duration: s.duration ?? null,
    fixed: !!s.fixed,
    location: s.location || "",
    description: s.description || "",
    dialogue: Array.isArray(s.dialogue) ? s.dialogue : [],
    priority: s.priority ?? null,
    tags: [],
    image: null,
  };
}

export type ScheduleOrder = "shooting" | "story";

/** 2026-10-30, Lino: «Szenenreihenfolge» — the same scenes with exactly their real times, listed in story
 * order (ideas in their order, cards by number). Display only: no pause rows, no overlap / no-end
 * flags or warnings (they belong to the shooting order). Mirrors app/project_schedule.py story_view. */
export function storyOrder(s: BoardSchedule): BoardSchedule {
  const key = (r: ScheduleScene): [number, number, string] => [r.idea_order ?? 0, r.number ?? 0, r.title || ""];
  const cmp = (a: ScheduleScene, b: ScheduleScene) => {
    const ka = key(a);
    const kb = key(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  };
  const clean = (r: ScheduleScene): ScheduleScene => ({ ...r, overlap: false, no_end: false });
  return {
    ...s,
    items: s.items.filter((it): it is ScheduleScene => it.kind === "scene").map(clean).sort(cmp),
    untimed: s.untimed.map(clean).sort(cmp),
    warnings: [],
  };
}
