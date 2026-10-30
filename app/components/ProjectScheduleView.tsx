"use client";

/* 2026-10-30, Lino: «Shooting schedule» / «Drehplan» next to the PDF button on the ideas page
 * (and on the client's ideas share page) — the whole project's Drehplan as a full-screen view,
 * not a PDF: every idea board's scene cards in time order, the gaps between them as pause rows
 * (like the PDF, no «Pausen» tile), «Logistik» cards with their short label, warnings for
 * overlaps and scenes without a duration. Same presentation as the board's Timetable node
 * (BoardTimetable.tsx cells, columns, widths, compact cards when narrow). Read-only; loaded
 * fresh every time it opens (`load`), nothing is cached and nothing is ever changed. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLanguage, type TranslationKey } from "@/lib/i18n";
import type { TimetableColumn } from "@/lib/board";
import {
  SCHEDULE_COLUMNS,
  formatDuration,
  isLogistics,
  moveInOrder,
  parseDuration,
  parseTimeInput,
  scheduleKey,
  scheduleRow,
  storyOrder,
  type BoardSchedule,
  type ScheduleOrder,
  type SchedulePlanOp,
  type ScheduleScene,
  type TimeField,
  type TimetableRow,
} from "@/lib/timetable";
import { COL_MIN, COL_WIDTH, Cell, CompactRow } from "./board/BoardTimetable";

type Line =
  | { kind: "scene"; row: TimetableRow; scene: ScheduleScene }
  | { kind: "pause"; start: string; end: string; duration: number };

export function ProjectScheduleView({
  load,
  onClose,
  onDownloadPdf,
  projectName,
  onPlan,
  pollStatus,
  embedded = false,
  onOrderChange,
  rowExtra,
}: {
  /** fetches the schedule (app: GET /projects/{id}/board-schedule, share page: /share/{token}/board-schedule) */
  load: () => Promise<BoardSchedule>;
  onClose: () => void;
  /** the PDF in the order shown (story | shooting) */
  onDownloadPdf?: (order: ScheduleOrder) => Promise<void> | void;
  projectName?: string;
  /** 2026-10-30, Lino: «Shotreihenfolge planen» — editors only (never on the client share page): move
   * scenes up / down, edit Beginn / Ende / Dauer, lock, story order, undo. Returns the new schedule. */
  onPlan?: (op: SchedulePlanOp) => Promise<BoardSchedule>;
  /** 2026-10-30, Lino: «Status live» — a light check (hash) polled every ~5 s while the view is open; the plan
   * is reloaded quietly when it changes (app: …/board-schedule/status, share: /share/{token}/board-schedule/status) */
  pollStatus?: () => Promise<{ hash: string }>;
  /** inside another dialog (Callsheet): no own overlay / header, read-only */
  embedded?: boolean;
  /** the order switch changed (the Callsheet's PDF follows it) */
  onOrderChange?: (order: ScheduleOrder) => void;
  /** 2026-10-30 — small extra chips per scene (Callsheet: location no., weather, crew) */
  rowExtra?: (scene: ScheduleScene) => ReactNode;
}) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<BoardSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [width, setWidth] = useState(1200);
  const [busy, setBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // 2026-10-30, Lino: switch «Shootingreihenfolge» (time order, default) ↔ «Szenenreihenfolge» (story) —
  // display only, the real times stay; planning only in the shooting order
  const [order, setOrder] = useState<ScheduleOrder>("shooting");
  const editable = !!onPlan && order === "shooting" && !embedded;
  const bodyRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    load()
      .then((d) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error && e.message ? e.message : t("projectSchedule.loadError")))
      .finally(() => setLoading(false));
  }, [load, t]);

  useEffect(() => {
    // first load (loading is already true) — once per opening, the view is mounted on open
    let alive = true;
    load()
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof Error && e.message ? e.message : t("projectSchedule.loadError")))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per opening
  }, []);

  // live status: poll the hash, reload the plan quietly when it changed (not while a field is being edited)
  const loadRef = useRef(load);
  const busyRef = useRef(busy);
  useEffect(() => {
    loadRef.current = load;
    busyRef.current = busy;
  });
  useEffect(() => {
    if (!pollStatus) return;
    let last: string | null = null;
    let alive = true;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const { hash } = await pollStatus();
        if (!alive) return;
        if (last !== null && hash !== last) {
          const editing = document.activeElement instanceof HTMLInputElement && bodyRef.current?.contains(document.activeElement);
          if (editing || busyRef.current) return; // try again on the next tick
          const d = await loadRef.current();
          if (alive) setData(d);
        }
        last = hash;
      } catch {
        // offline for a moment — the next tick tries again
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    const onVisible = () => !document.hidden && tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one poller per opening
  }, []);

  useEffect(() => {
    if (embedded) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, embedded]);

  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const check = () => setWidth(node.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const shown = useMemo(() => (data && order === "story" ? storyOrder(data) : data), [data, order]);
  const lines = useMemo<Line[]>(
    () =>
      (shown?.items ?? []).map((it, i) =>
        it.kind === "pause" ? it : { kind: "scene", row: scheduleRow(it, i), scene: it }
      ),
    [shown]
  );
  const untimed = useMemo(() => (shown?.untimed ?? []).map((s, i) => ({ row: scheduleRow(s, 10000 + i), scene: s })), [shown]);

  // warnings in the viewer's language, from the backend's flags (same rules as the PDF)
  const warnings = useMemo(() => {
    const out: string[] = [];
    let prev: ScheduleScene | null = null;
    for (const it of shown?.items ?? []) {
      if (it.kind !== "scene") continue;
      const name = (s: ScheduleScene) => t("projectSchedule.sceneRef", { number: s.number ?? "–", title: s.title || "–", idea: s.idea_title || "–" });
      if (it.overlap && prev) out.push(t("projectSchedule.warnOverlap", { scene: name(it), start: it.start, other: name(prev) }));
      if (it.no_end) out.push(t("projectSchedule.warnNoEnd", { scene: name(it) }));
      prev = it;
    }
    return out;
  }, [shown, t]);

  const columns = SCHEDULE_COLUMNS;
  const timeCols: TimetableColumn[] = ["start", "end", "duration"];
  const editWidth: Partial<Record<TimetableColumn, string>> = { start: "92px", end: "72px", duration: "76px" };
  const grid = {
    gridTemplateColumns: (editable ? ["66px"] : []).concat(columns.map((c) => (editable && editWidth[c]) || COL_WIDTH[c])).join(" "),
  };
  const compact = width < columns.reduce((sum, c) => sum + COL_MIN[c] + 12, 32) + (editable ? 140 : 0);
  const colLabel = (c: TimetableColumn) => (c === "group" ? t("projectSchedule.colIdea") : t(`ideaBoard.timetable.col.${c}` as TranslationKey));
  const tot = data?.totals;
  const name = data?.project_name || projectName || "";
  const date = data?.shoot_date
    ? new Date(`${data.shoot_date}T12:00:00`).toLocaleDateString(language === "en" ? "en-GB" : "de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  const timedKeys = useMemo(() => (data?.items ?? []).flatMap((it) => (it.kind === "scene" ? [scheduleKey(it)] : [])), [data]);

  async function plan(op: SchedulePlanOp, optimistic?: (d: BoardSchedule) => BoardSchedule) {
    if (!onPlan || busy) return;
    const prev = data;
    if (prev && optimistic) setData(optimistic(prev));
    setBusy(true);
    setPlanMsg(null);
    try {
      setData(await onPlan(op));
      setPlanMsg({ kind: "ok", text: t("projectSchedule.saved") });
    } catch (e: unknown) {
      setData(prev);
      setPlanMsg({ kind: "error", text: e instanceof Error && e.message ? e.message : t("projectSchedule.saveError") });
    } finally {
      setBusy(false);
    }
  }

  function move(key: string, dir: -1 | 1) {
    const order = moveInOrder(timedKeys, key, dir);
    if (!order) return;
    // immediately visible: the two rows swap places, the server's new times follow
    plan({ op: "order", order }, (d) => {
      const scenes = d.items.filter((it): it is ScheduleScene => it.kind === "scene");
      const byKey = new Map(scenes.map((sc) => [scheduleKey(sc), sc]));
      let n = 0;
      return { ...d, items: d.items.map((it) => (it.kind === "scene" ? byKey.get(order[n++])! : it)) };
    });
  }

  async function downloadPdf() {
    if (!onDownloadPdf || downloading) return;
    setDownloading(true);
    try {
      await onDownloadPdf(order);
    } finally {
      setDownloading(false);
    }
  }

  const sceneRow = (row: TimetableRow, scene: ScheduleScene, i: number) => {
    const logistics = isLogistics(scene);
    const flag = scene.overlap ? "overlap" : scene.no_end ? "noEnd" : null;
    // 2026-10-30, Lino: status from the shot list — «im Kasten» green ✓, «nicht gedreht» red ✗ (wins over the plan hints)
    const status = scene.status ?? "open";
    const tone =
      status === "done"
        ? "bg-emerald-500/[0.10] shadow-[inset_3px_0_0_rgb(16,185,129)]"
        : status === "not_shot"
          ? "bg-red-500/[0.10] shadow-[inset_3px_0_0_rgb(239,68,68)]"
          : flag === "overlap" ? "bg-red-500/[0.09] shadow-[inset_3px_0_0_rgb(239,68,68)]" : flag === "noEnd" ? "bg-amber-400/[0.07] shadow-[inset_3px_0_0_rgb(251,191,36)]" : logistics ? "bg-white/[0.035]" : i % 2 ? "bg-white/[0.02]" : "";
    const statusChip = status !== "open" && (
      <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${status === "done" ? "bg-emerald-500/20 text-emerald-300" : "bg-red-500/20 text-red-300"}`}>
        {status === "done" ? "✓" : "✗"} {t(status === "done" ? "projectSchedule.statusDone" : "projectSchedule.statusNotShot")}
      </span>
    );
    const flagChip = flag && (
      <span className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider [overflow-wrap:anywhere] ${flag === "overlap" ? "bg-red-500/20 text-red-300" : "bg-amber-400/15 text-amber-200"}`}>
        ⚠ {t(flag === "overlap" ? "projectSchedule.badgeOverlap" : "projectSchedule.badgeNoEnd")}
      </span>
    );
    const extra = rowExtra?.(scene);
    const badge = (statusChip || flagChip || extra) && (
      <>
        {statusChip}
        {flagChip}
        {extra}
      </>
    );
    const key = scheduleKey(scene);
    const timedIndex = timedKeys.indexOf(key);
    const arrows = editable && (
      <MoveButtons
        disabledUp={busy || timedIndex <= 0 || !!scene.fixed}
        disabledDown={busy || timedIndex < 0 || timedIndex >= timedKeys.length - 1 || !!scene.fixed}
        hidden={timedIndex < 0}
        fixed={!!scene.fixed}
        onUp={() => move(key, -1)}
        onDown={() => move(key, 1)}
      />
    );
    const timeEdit = (f: TimeField) => (
      <TimeEdit
        key={`${f}-${key}-${f === "duration" ? row.duration : f === "time" ? row.start : row.end}`}
        field={f}
        shown={f === "duration" ? formatDuration(row.duration) : f === "time" ? row.start : row.end}
        disabled={busy}
        onCommit={(value) =>
          plan({ op: "time", key, field: f, value }, (d) => d)
        }
        label={t(f === "time" ? "ideaBoard.timetable.col.start" : f === "time_end" ? "ideaBoard.timetable.col.end" : "ideaBoard.timetable.col.duration")}
      />
    );
    const lock = editable && (
      <LockButton
        fixed={!!scene.fixed}
        disabled={busy}
        title={t(scene.fixed ? "projectSchedule.unfix" : "projectSchedule.fix")}
        onClick={() => plan({ op: "fixed", key, value: !scene.fixed })}
      />
    );
    if (compact) {
      return (
        <div key={row.id} className={`rounded-lg ${tone} ${logistics ? "opacity-90" : ""}`}>
          {badge && <div className="flex flex-wrap gap-1 px-2 pt-2">{badge}</div>}
          <CompactRow row={row} columns={editable ? columns.filter((c) => !timeCols.includes(c)) : columns} striped={false} placeColor={null} goToLabel="" priorityLabel="" />
          {editable && (
            <div className="flex flex-wrap items-end gap-2 px-2 pb-2.5 pl-[52px]">
              {arrows}
              <div className="flex items-end gap-1.5">
                <div className="w-[64px]">{timeEdit("time")}</div>
                <div className="w-[64px]">{timeEdit("time_end")}</div>
                <div className="w-[70px]">{timeEdit("duration")}</div>
                {lock}
              </div>
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={row.id} className={`grid gap-x-3 items-start rounded-lg px-2 py-2.5 border-t border-white/[0.06] ${tone}`} style={grid}>
        {editable && <div className="pt-0.5">{arrows}</div>}
        {columns.map((c) =>
          editable && c === "start" ? (
            <div key={c} className="flex min-w-0 items-center gap-1">
              {timeEdit("time")}
              {lock}
            </div>
          ) : editable && c === "end" ? (
            <div key={c} className="min-w-0">{timeEdit("time_end")}</div>
          ) : editable && c === "duration" ? (
            <div key={c} className="min-w-0">{timeEdit("duration")}</div>
          ) : c === "group" && (logistics || badge) ? (
            <div key={c} className="min-w-0 flex flex-col items-start gap-1 pt-1">
              <span className={`max-w-full text-[13px] leading-snug whitespace-pre-line break-words ${logistics ? "rounded-md bg-white/10 px-2 py-0.5 text-[12px] font-semibold text-white/75" : "text-white/70"}`}>
                {row.group}
              </span>
              <div className="flex max-w-full flex-wrap gap-1">{badge}</div>
            </div>
          ) : (
            <Cell key={c} col={c} row={row} placeColor={null} goToLabel="" priorityLabel="" />
          )
        )}
      </div>
    );
  };

  const pauseRow = (p: Extract<Line, { kind: "pause" }>, i: number) => (
    <div
      key={`pause-${i}`}
      className="my-1 flex items-center gap-2 rounded-lg border border-dashed border-blue-400/25 bg-blue-500/[0.07] px-3 py-1.5 text-[12px] font-semibold text-blue-200/90 tabular-nums"
    >
      <span aria-hidden>☕</span>
      <span>{t("projectSchedule.pause")}</span>
      <span className="text-blue-200/60 font-medium">
        {p.start}–{p.end} · {formatDuration(p.duration)}
      </span>
    </div>
  );

  const stats: [string, string][] = tot
    ? [
        [t("projectSchedule.statFirst"), tot.first_start || "–"],
        [t("projectSchedule.statLast"), tot.last_end || "–"],
        [t("projectSchedule.statSpan"), formatDuration(tot.span) || "–"],
        [t("projectSchedule.statShooting"), formatDuration(tot.shooting) || "0 min"],
        [t("projectSchedule.statScenes"), String(tot.scenes)],
        ...(tot.status_total
          ? ([[t("projectSchedule.statProgress", { notShot: tot.status_not_shot ?? 0 }), t("projectSchedule.statProgressValue", { done: tot.status_done ?? 0, total: tot.status_total })]] as [string, string][])
          : []),
      ]
    : [];

  const content = (
    <>
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-[13px] text-white/45">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white/60" />
              {t("projectSchedule.loading")}
            </div>
          ) : error && !data ? (
            <div className="mx-auto max-w-md py-20 text-center">
              <p className="text-[14px] text-red-300">{error}</p>
              <button type="button" onClick={reload} className="mt-4 rounded-lg bg-white/10 px-4 py-2 text-[13px] font-semibold hover:bg-white/15">
                {t("projectSchedule.retry")}
              </button>
            </div>
          ) : data ? (
            <>
              {/* stat tiles — like the PDF, no «Pausen» tile (Lino 2026-10-29) */}
              <div className={`grid grid-cols-2 gap-2 ${stats.length > 5 ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-5"}`}>
                {stats.map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-3.5 py-2.5">
                    <div className="text-[17px] font-semibold tabular-nums">{value}</div>
                    <div className="text-[11px] text-white/45">{label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div role="tablist" aria-label={t("projectSchedule.orderLabel")} className="flex rounded-lg bg-white/[0.06] p-0.5 text-[12px] font-semibold">
                  {(["shooting", "story"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="tab"
                      aria-selected={order === o}
                      onClick={() => {
                        setOrder(o);
                        onOrderChange?.(o);
                      }}
                      className={`rounded-md px-3 py-1.5 transition-colors ${order === o ? "bg-white/15 text-white" : "text-white/50 hover:text-white/85"}`}
                    >
                      {t(o === "shooting" ? "projectSchedule.orderShooting" : "projectSchedule.orderStory")}
                    </button>
                  ))}
                </div>
                {order === "story" && <span className="text-[12px] text-white/45">{t("projectSchedule.orderStoryHint")}</span>}
              </div>

              {editable && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => plan({ op: "undo" })}
                    disabled={busy || !data.can_undo}
                    className="h-9 rounded-lg bg-white/[0.07] px-3 text-[12px] font-semibold text-white/80 hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                  >
                    ↶ {t("projectSchedule.undo")}
                  </button>
                  <button
                    type="button"
                    onClick={() => plan({ op: "story" })}
                    disabled={busy || timedKeys.length < 2}
                    title={t("projectSchedule.storyHint")}
                    className="h-9 rounded-lg bg-white/[0.07] px-3 text-[12px] font-semibold text-white/80 hover:bg-white/[0.12] hover:text-white disabled:opacity-40"
                  >
                    {t("projectSchedule.story")}
                  </button>
                  <span className="text-[12px] text-white/45">{t("projectSchedule.editHint")}</span>
                  {(busy || planMsg) && (
                    <span className={`ml-auto text-[12px] font-semibold ${busy ? "text-white/55" : planMsg?.kind === "error" ? "text-red-300" : "text-emerald-300"}`}>
                      {busy ? t("projectSchedule.saving") : planMsg?.text}
                    </span>
                  )}
                </div>
              )}

              {warnings.length > 0 && (
                <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/[0.07] px-4 py-3">
                  <div className="mb-1 text-[12px] font-bold uppercase tracking-wider text-red-300">⚠ {t("projectSchedule.check")}</div>
                  <ul className="space-y-0.5 text-[13px] leading-snug text-red-100/85">
                    {warnings.map((w, i) => (
                      <li key={i}>• {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {lines.length === 0 && untimed.length === 0 ? (
                <div className="mx-auto max-w-md py-16 text-center text-[13px] leading-relaxed text-white/45">{t("projectSchedule.empty")}</div>
              ) : (
                <div className="mt-4 rounded-xl border border-white/10 bg-[#1d1d1f] p-2">
                  {!compact && lines.length > 0 && (
                    <div className="grid gap-x-3 px-2 pt-1.5 pb-2 text-[10px] font-semibold uppercase tracking-wider text-white/40" style={grid}>
                      {editable && <div className="truncate">{t("projectSchedule.colOrder")}</div>}
                      {columns.map((c) => (
                        <div key={c} className="truncate">
                          {colLabel(c)}
                        </div>
                      ))}
                    </div>
                  )}
                  {lines.length === 0 && <div className="px-3 py-6 text-center text-[13px] text-white/40">{t("projectSchedule.noTimes")}</div>}
                  {lines.map((l, i) => (l.kind === "pause" ? pauseRow(l, i) : sceneRow(l.row, l.scene, i)))}
                </div>
              )}

              {untimed.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 px-1 text-[14px] font-semibold text-white/80">{t("projectSchedule.untimed", { count: untimed.length })}</h3>
                  <div className="rounded-xl border border-white/10 bg-[#1d1d1f] p-2">{untimed.map((u, i) => sceneRow(u.row, u.scene, i))}</div>
                </div>
              )}
            </>
          ) : null}
    </>
  );

  if (embedded) {
    // inside the Callsheet: no overlay, no header — order switch, status and live sync stay
    return (
      <div ref={bodyRef} className="text-white">
        {content}
      </div>
    );
  }

  if (typeof document === "undefined") return null;
  return createPortal(
    // 2026-10-30, Lino: «Ansichtsfenster breiter, passt sich dem Bildschirm an» — the whole window minus a
    // small margin (8 px phone, 16 px tablet, 24 px desktop) instead of a fixed max width
    <div className="fixed inset-0 z-[80] flex p-2 sm:p-4 lg:p-6" role="dialog" aria-modal="true" aria-label={t("projectSchedule.title")}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-[#161617] text-white rounded-xl sm:rounded-2xl border border-white/10 shadow-2xl">
        {/* header */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <div className="shrink-0 h-9 w-9 rounded-lg bg-blue-500/15 text-blue-300 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="17" rx="2" />
              <path d="M3 9h18M8 4v17M16 2v4M8 2v4" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-semibold leading-tight">{t("projectSchedule.title")}</h2>
            <div className="truncate text-[12px] text-white/45">{[name, date].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={reload}
              disabled={loading}
              title={t("projectSchedule.refresh")}
              className="h-9 rounded-lg bg-white/[0.07] px-3 text-[12px] font-semibold text-white/75 hover:bg-white/[0.12] hover:text-white disabled:opacity-50"
            >
              ↻<span className="hidden sm:inline"> {t("projectSchedule.refresh")}</span>
            </button>
            {onDownloadPdf && (
              <button
                type="button"
                onClick={downloadPdf}
                disabled={downloading}
                className="h-9 rounded-lg bg-white/[0.07] px-3 text-[12px] font-semibold text-white/75 hover:bg-white/[0.12] hover:text-white disabled:opacity-50"
              >
                {downloading ? t("workflow.pdfExporting") : "PDF"}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common.close")}
              className="h-9 w-9 rounded-lg bg-white/[0.07] text-white/75 hover:bg-white/[0.12] hover:text-white flex items-center justify-center"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* body */}
        <div ref={bodyRef} className="flex-1 overflow-y-auto overscroll-contain px-3 pb-10 pt-4 sm:px-6">
          {content}
        </div>
      </div>
    </div>,
    document.body
  );
}

function MoveButtons({
  disabledUp,
  disabledDown,
  hidden,
  fixed,
  onUp,
  onDown,
}: {
  disabledUp: boolean;
  disabledDown: boolean;
  hidden: boolean;
  fixed: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  const { t } = useLanguage();
  if (hidden) return <div className="w-[62px]" />;
  const cls =
    "h-8 w-8 rounded-md border border-white/10 bg-white/[0.06] text-white/80 flex items-center justify-center hover:bg-white/[0.14] hover:text-white disabled:opacity-30 disabled:hover:bg-white/[0.06] touch-manipulation";
  const title = fixed ? t("projectSchedule.fixedNoMove") : undefined;
  return (
    <div className="flex gap-1" title={title}>
      <button type="button" aria-label={t("projectSchedule.moveUp")} title={title ?? t("projectSchedule.moveUp")} disabled={disabledUp} onClick={onUp} className={cls}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 15l6-6 6 6" /></svg>
      </button>
      <button type="button" aria-label={t("projectSchedule.moveDown")} title={title ?? t("projectSchedule.moveDown")} disabled={disabledDown} onClick={onDown} className={cls}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    </div>
  );
}

/** Beginn / Ende / Dauer as a text field like the scene card's time fields (8 / 800 / 8:30 / 8.30;
 * Dauer 45 / 1:30 / 1h30); commits on Enter / leaving the field, "" clears */
function TimeEdit({
  field,
  shown,
  disabled,
  label,
  onCommit,
}: {
  field: TimeField;
  shown: string;
  disabled: boolean;
  label: string;
  onCommit: (value: string | number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    const v = draft;
    setDraft(null);
    if (v === null || v.trim() === shown) return;
    if (!v.trim()) return onCommit(null);
    const parsed = field === "duration" ? parseDuration(v) : parseTimeInput(v);
    if (parsed === null || parsed === "") {
      setBad(true);
      setTimeout(() => setBad(false), 1500);
      return;
    }
    onCommit(parsed);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      placeholder={field === "duration" ? "min" : "--:--"}
      value={draft ?? shown}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(null);
        }
      }}
      className={`h-8 w-full min-w-0 rounded-md border bg-white/[0.06] px-1.5 text-[13px] font-semibold tabular-nums text-white/90 outline-none focus:border-blue-400/60 disabled:opacity-60 [color-scheme:dark] ${bad ? "border-red-400/70" : "border-white/10"}`}
    />
  );
}

function LockButton({ fixed, disabled, title, onClick }: { fixed: boolean; disabled: boolean; title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={fixed}
      className={`h-8 w-8 shrink-0 rounded-md border flex items-center justify-center disabled:opacity-50 ${fixed ? "border-amber-400/40 bg-amber-400/20 text-amber-300" : "border-white/10 text-white/40 hover:bg-white/10 hover:text-white/80"}`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d={fixed ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.5-2"} />
      </svg>
    </button>
  );
}
