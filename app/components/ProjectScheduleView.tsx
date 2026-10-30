"use client";

/* 2026-10-30, Lino: «Shooting schedule» / «Drehplan» next to the PDF button on the ideas page
 * (and on the client's ideas share page) — the whole project's Drehplan as a full-screen view,
 * not a PDF: every idea board's scene cards in time order, the gaps between them as pause rows
 * (like the PDF, no «Pausen» tile), «Logistik» cards with their short label, warnings for
 * overlaps and scenes without a duration. Same presentation as the board's Timetable node
 * (BoardTimetable.tsx cells, columns, widths, compact cards when narrow). Read-only; loaded
 * fresh every time it opens (`load`), nothing is cached and nothing is ever changed. */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage, type TranslationKey } from "@/lib/i18n";
import type { TimetableColumn } from "@/lib/board";
import {
  SCHEDULE_COLUMNS,
  formatDuration,
  isLogistics,
  scheduleRow,
  type BoardSchedule,
  type ScheduleScene,
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
}: {
  /** fetches the schedule (app: GET /projects/{id}/board-schedule, share page: /share/{token}/board-schedule) */
  load: () => Promise<BoardSchedule>;
  onClose: () => void;
  onDownloadPdf?: () => Promise<void> | void;
  projectName?: string;
}) {
  const { t, language } = useLanguage();
  const [data, setData] = useState<BoardSchedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [width, setWidth] = useState(1200);
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
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per opening (the view is mounted on open)
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  useLayoutEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const check = () => setWidth(node.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const lines = useMemo<Line[]>(
    () =>
      (data?.items ?? []).map((it, i) =>
        it.kind === "pause" ? it : { kind: "scene", row: scheduleRow(it, i), scene: it }
      ),
    [data]
  );
  const untimed = useMemo(() => (data?.untimed ?? []).map((s, i) => ({ row: scheduleRow(s, 10000 + i), scene: s })), [data]);

  // warnings in the viewer's language, from the backend's flags (same rules as the PDF)
  const warnings = useMemo(() => {
    const out: string[] = [];
    let prev: ScheduleScene | null = null;
    for (const it of data?.items ?? []) {
      if (it.kind !== "scene") continue;
      const name = (s: ScheduleScene) => t("projectSchedule.sceneRef", { number: s.number ?? "–", title: s.title || "–", idea: s.idea_title || "–" });
      if (it.overlap && prev) out.push(t("projectSchedule.warnOverlap", { scene: name(it), start: it.start, other: name(prev) }));
      if (it.no_end) out.push(t("projectSchedule.warnNoEnd", { scene: name(it) }));
      prev = it;
    }
    return out;
  }, [data, t]);

  const columns = SCHEDULE_COLUMNS;
  const grid = { gridTemplateColumns: columns.map((c) => COL_WIDTH[c]).join(" ") };
  const compact = width < columns.reduce((sum, c) => sum + COL_MIN[c] + 12, 32);
  const colLabel = (c: TimetableColumn) => (c === "group" ? t("projectSchedule.colIdea") : t(`ideaBoard.timetable.col.${c}` as TranslationKey));
  const tot = data?.totals;
  const name = data?.project_name || projectName || "";
  const date = data?.shoot_date
    ? new Date(`${data.shoot_date}T12:00:00`).toLocaleDateString(language === "en" ? "en-GB" : "de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })
    : "";

  async function downloadPdf() {
    if (!onDownloadPdf || downloading) return;
    setDownloading(true);
    try {
      await onDownloadPdf();
    } finally {
      setDownloading(false);
    }
  }

  const sceneRow = (row: TimetableRow, scene: ScheduleScene, i: number) => {
    const logistics = isLogistics(scene);
    const flag = scene.overlap ? "overlap" : scene.no_end ? "noEnd" : null;
    const tone = flag === "overlap" ? "bg-red-500/[0.09] shadow-[inset_3px_0_0_rgb(239,68,68)]" : flag === "noEnd" ? "bg-amber-400/[0.07] shadow-[inset_3px_0_0_rgb(251,191,36)]" : logistics ? "bg-white/[0.035]" : i % 2 ? "bg-white/[0.02]" : "";
    const badge = flag && (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${flag === "overlap" ? "bg-red-500/20 text-red-300" : "bg-amber-400/15 text-amber-200"}`}>
        ⚠ {t(flag === "overlap" ? "projectSchedule.badgeOverlap" : "projectSchedule.badgeNoEnd")}
      </span>
    );
    if (compact) {
      return (
        <div key={row.id} className={`rounded-lg ${tone} ${logistics ? "opacity-80" : ""}`}>
          {badge && <div className="px-2 pt-2">{badge}</div>}
          <CompactRow row={row} columns={columns} striped={false} placeColor={null} goToLabel="" priorityLabel="" />
        </div>
      );
    }
    return (
      <div key={row.id} className={`grid gap-x-3 items-start rounded-lg px-2 py-2.5 border-t border-white/[0.06] ${tone}`} style={grid}>
        {columns.map((c) =>
          c === "group" && (logistics || badge) ? (
            <div key={c} className="min-w-0 flex flex-col items-start gap-1 pt-1">
              <span className={`text-[13px] leading-snug whitespace-pre-line break-words ${logistics ? "rounded-md bg-white/10 px-2 py-0.5 text-[12px] font-semibold text-white/75" : "text-white/70"}`}>
                {row.group}
              </span>
              {badge}
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
      ]
    : [];

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex sm:p-4 lg:p-6" role="dialog" aria-modal="true" aria-label={t("projectSchedule.title")}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-hidden bg-[#161617] text-white sm:rounded-2xl sm:border sm:border-white/10 shadow-2xl">
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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {stats.map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-3.5 py-2.5">
                    <div className="text-[17px] font-semibold tabular-nums">{value}</div>
                    <div className="text-[11px] text-white/45">{label}</div>
                  </div>
                ))}
              </div>

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
        </div>
      </div>
    </div>,
    document.body
  );
}
