// 2026-10-29 — Timetable node: rows derived from the board's scene cards,
// Beginn/Ende/Dauer and "Zeiten verketten". Run: npm test (node --test, no extra deps)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_TIMETABLE_COLUMNS,
  cascadeTimes,
  chainEnabled,
  editSceneTime,
  formatDuration,
  htmlToPlain,
  normalizeTime,
  parseDuration,
  parseTimeInput,
  sceneTimes,
  timetableColumns,
  timetableRows,
} from "../lib/timetable.ts";
import type { BoardElement, SceneElement } from "../lib/board.ts";

const scene = (id: string, number: number, extra: Record<string, unknown> = {}): BoardElement =>
  ({ id, type: "scene", x: 0, y: 0, w: 312, h: 300, z: 1, number, title: "", html: "", ...extra }) as BoardElement;
const tt = (extra: Record<string, unknown> = {}) => ({ id: "tt", type: "timetable", x: 0, y: 0, w: 1, h: 1, z: 0, title: "Timetable", ...extra }) as BoardElement;

test("only scene cards become rows; other nodes are ignored", () => {
  const els = [scene("a", 1), { id: "t", type: "sticky", x: 0, y: 0, w: 1, h: 1, z: 0, html: "x", color: "yellow" } as BoardElement, tt()];
  assert.deepEqual(timetableRows(els).map((r) => r.id), ["a"]);
});

test("empty fields stay empty, never null/undefined text", () => {
  const [r] = timetableRows([scene("a", 3)]);
  assert.deepEqual([r.title, r.group, r.start, r.end, r.location, r.description], ["", "", "", "", "", ""]);
  assert.equal(r.duration, null);
  assert.deepEqual(r.dialogue, []);
  assert.deepEqual(r.tags, []);
  assert.equal(r.priority, null);
  assert.equal(r.image, null);
  assert.equal(formatDuration(r.duration), "");
});

test("numbers are exactly the cards' numbers", () => {
  assert.deepEqual(timetableRows([scene("a", 12), scene("b", 4), scene("c", 7)], "number").map((r) => r.number), [4, 7, 12]);
});

test("time order: timed first by start (or end), untimed after by number; ties by number", () => {
  const rows = timetableRows([
    scene("a", 1),
    scene("b", 2, { time: "14:00" }),
    scene("c", 3, { time: "09:30", duration: 45 }),
    scene("d", 4),
    scene("e", 5, { time_end: "11:00" }),
    scene("f", 9, { time: "08:00" }),
    scene("g", 8, { time: "08:00" }),
  ]);
  assert.deepEqual(rows.map((r) => r.id), ["g", "f", "c", "e", "b", "a", "d"]);
  const c = rows[2];
  assert.deepEqual([c.start, c.end, c.duration], ["09:30", "10:15", 45]);
});

test("the third time value is derived from the other two", () => {
  assert.deepEqual(sceneTimes({ time: "09:00", time_end: "10:30" }), { start: 540, end: 630, duration: 90, endNextDay: false });
  assert.deepEqual(sceneTimes({ time: "23:30", duration: 90 }), { start: 1410, end: 60, duration: 90, endNextDay: true });
  assert.deepEqual(sceneTimes({ time_end: "12:00", duration: 30 }), { start: null, end: 720, duration: 30, endNextDay: false });
});

test("editing one field fills in the third (both directions), clearing stays empty", () => {
  const base = { time: "09:00", time_end: "10:00", duration: 60 };
  assert.deepEqual(editSceneTime(base, "time", "09:30"), { time: "09:30", time_end: "10:30", duration: 60 });
  assert.deepEqual(editSceneTime(base, "duration", 90), { time: "09:00", time_end: "10:30", duration: 90 });
  assert.deepEqual(editSceneTime(base, "time_end", "11:15"), { time: "09:00", time_end: "11:15", duration: 135 });
  assert.deepEqual(editSceneTime({ time_end: "12:00" }, "duration", 45), { time: "11:15", time_end: "12:00", duration: 45 });
  assert.deepEqual(editSceneTime({}, "time", "08:00"), { time: "08:00", time_end: undefined, duration: undefined });
  assert.deepEqual(editSceneTime({ time: "08:00" }, "time_end", "08:20"), { time: "08:00", time_end: "08:20", duration: 20 });
  assert.deepEqual(editSceneTime(base, "duration", null), { time: "09:00", time_end: undefined, duration: undefined });
  assert.deepEqual(editSceneTime(base, "time_end", ""), { time: "09:00", time_end: undefined, duration: undefined });
  assert.deepEqual(editSceneTime(base, "time", ""), { time: undefined, time_end: "10:00", duration: 60 });
});

test("chain: 15 cards, the first moves +30 → all following move, gaps and durations stay", () => {
  const els: BoardElement[] = [];
  for (let i = 0; i < 15; i++) els.push(scene(`s${i + 1}`, i + 1, { time: `${String(7 + i).padStart(2, "0")}:00`, duration: 45 }));
  const before = els[0] as SceneElement;
  const after = { ...before, ...editSceneTime(before, "time", "07:30") };
  const { patches, blocked, delta } = cascadeTimes(els, "s1", before, after);
  assert.equal(delta, 30);
  assert.equal(blocked, null);
  assert.equal(patches.size, 14);
  assert.deepEqual(patches.get("s2"), { time: "08:30", time_end: "09:15", duration: 45 });
  assert.deepEqual(patches.get("s15"), { time: "21:30", time_end: "22:15", duration: 45 });
});

test("chain: a longer duration pushes the followers by the difference", () => {
  const els = [scene("a", 1, { time: "08:00", duration: 60 }), scene("b", 2, { time: "09:15", duration: 30 })];
  const before = els[0] as SceneElement;
  const after = { ...before, ...editSceneTime(before, "duration", 90) };
  assert.deepEqual(cascadeTimes(els, "a", before, after).patches.get("b"), { time: "09:45", time_end: "10:15", duration: 30 });
});

test("chain: stops at a locked card, skips untimed cards", () => {
  const els = [
    scene("a", 1, { time: "08:00", duration: 30 }),
    scene("b", 2, { time: "09:00", duration: 30 }),
    scene("c", 3, { time: "10:00", duration: 30, time_fixed: true }),
    scene("d", 4, { time: "11:00", duration: 30 }),
    scene("x", 5),
  ];
  const before = els[0] as SceneElement;
  const after = { ...before, ...editSceneTime(before, "time", "08:15") };
  assert.deepEqual([...cascadeTimes(els, "a", before, after).patches.keys()], ["b"]);
});

test("chain: never past midnight — the chain stops and reports the card", () => {
  const els = [scene("a", 1, { time: "20:00", duration: 60 }), scene("b", 2, { time: "22:00", duration: 60 }), scene("c", 3, { time: "23:30", duration: 20 })];
  const before = els[0] as SceneElement;
  const after = { ...before, ...editSceneTime(before, "time", "21:00") };
  const r = cascadeTimes(els, "a", before, after);
  assert.equal(r.blocked, 3);
  assert.deepEqual([...r.patches.keys()], ["b"]);
});

test("chain: adding a time where there was none moves nothing", () => {
  const els = [scene("a", 1), scene("b", 2, { time: "09:00" })];
  const before = els[0] as SceneElement;
  const after = { ...before, ...editSceneTime(before, "time", "08:00") };
  assert.equal(cascadeTimes(els, "a", before, after).patches.size, 0);
});

test("chain switch: on by default, off when a Timetable node says chain: false", () => {
  assert.equal(chainEnabled([scene("a", 1)]), true);
  assert.equal(chainEnabled([tt()]), true);
  assert.equal(chainEnabled([tt({ chain: false })]), false);
});

test("a changed scene shows up in a fresh derivation (live, nothing copied)", () => {
  let els = [scene("a", 1, { title: "Intro", location_address: "Bahnhof Aarau" }), scene("b", 2, { title: "Outro" })];
  els = els.map((e) => (e.id === "a" ? ({ ...e, number: 5, title: "Intro neu", location_address: "Altstadt Lenzburg", time: "07:15" } as BoardElement) : e));
  const rows = timetableRows(els);
  assert.deepEqual([rows[0].id, rows[0].number, rows[0].title, rows[0].location, rows[0].start], ["a", 5, "Intro neu", "Altstadt Lenzburg", "07:15"]);
  assert.deepEqual(timetableRows(els.filter((e) => e.id !== "a")).map((r) => r.id), ["b"]);
});

test("dialogue lines trimmed, description html → plain", () => {
  const [r] = timetableRows([scene("a", 1, { dialogues: ["  Hallo!  ", "", "Tschüss"], html: "<p>Totale &amp; Schwenk</p><p></p><ul><li>Kran</li></ul>" })]);
  assert.deepEqual(r.dialogue, ["Hallo!", "Tschüss"]);
  assert.equal(r.description, "Totale & Schwenk\nKran");
  assert.equal(htmlToPlain(undefined), "");
});

test("group column joins the default set when cards sit in named groups", () => {
  const els = [scene("a", 1), scene("b", 2), { id: "g", type: "group", x: 0, y: 0, w: 1, h: 1, z: 0, title: "Szene Bahnhof", collapsed: false, children: ["a"] } as BoardElement];
  const rows = timetableRows(els);
  assert.deepEqual(rows.map((r) => r.group), ["Szene Bahnhof", ""]);
  assert.deepEqual(timetableColumns({}, rows), ["number", "group", ...DEFAULT_TIMETABLE_COLUMNS.slice(1)]);
  assert.deepEqual(timetableColumns({}, timetableRows([scene("a", 1)])), DEFAULT_TIMETABLE_COLUMNS);
  assert.deepEqual(timetableColumns({ columns: ["start", "number"] }, rows), ["start", "number"]);
});

test("parsing and formatting", () => {
  assert.equal(normalizeTime("9:5"), "09:05");
  assert.equal(normalizeTime("25:00"), "");
  assert.deepEqual(["8", "08", "800", "0830", "8:30", "8.30", "8h30", "17 Uhr", "2400", "x", ""].map(parseTimeInput), ["08:00", "08:00", "08:00", "08:30", "08:30", "08:30", "08:30", "17:00", "", "", ""]);
  assert.equal(parseDuration("45"), 45);
  assert.equal(parseDuration("45 min"), 45);
  assert.equal(parseDuration("1:30"), 90);
  assert.equal(parseDuration("1h30"), 90);
  assert.equal(parseDuration("1,5 h"), 90);
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration("abc"), null);
  assert.equal(formatDuration(90), "1 h 30");
  assert.equal(formatDuration(120), "2 h");
  assert.equal(formatDuration(45), "45 min");
});

// ── shared cases with the backend (tests/fixtures/timetable_cases.json, identical copy in /opt/subshot/tests/fixtures) ──
import { readFileSync } from "node:fs";
const CASES = JSON.parse(readFileSync(new URL("./fixtures/timetable_cases.json", import.meta.url), "utf8"));
const cards = (spec: [string, number, Record<string, unknown>][]) => spec.map(([id, n, extra]) => scene(id, n, extra));
const nullify = (p: Record<string, unknown>) => ({ time: p.time ?? null, time_end: p.time_end ?? null, duration: p.duration ?? null });

test("shared cases: editSceneTime", () => {
  for (const c of CASES.edit) assert.deepEqual(nullify(editSceneTime(c.card, c.field, c.value)), c.expect, JSON.stringify(c));
});

test("shared cases: cascadeTimes", () => {
  for (const c of CASES.cascade) {
    const els = cards(c.cards);
    const before = els.find((e) => e.id === c.id) as SceneElement;
    const after = { ...before, ...editSceneTime(before, c.field, c.value) };
    const r = cascadeTimes(els, c.id, before, after, c.sort);
    const patches = Object.fromEntries([...r.patches].map(([k, v]) => [k, nullify(v)]));
    assert.deepEqual({ delta: r.delta, blocked: r.blocked, patches }, c.expect, c.name);
  }
});

test("shared cases: timetableRows", () => {
  for (const c of CASES.rows) {
    assert.deepEqual(timetableRows(cards(c.cards), c.sort).map((r) => [r.id, r.number, r.start, r.end, r.duration]), c.expect);
  }
});
