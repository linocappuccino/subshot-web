"use client";

import { useCallback, useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { LiveSchedule } from "@/lib/types";

// 2026-10-12, Lino: "Zeitplan mit Live-Verzug — aus Dauer und Drehreihenfolge entsteht ein
// Tagesplan mit Uhrzeiten. Während des Drehs siehst du «X Min. hinter/vor Plan» und Vorschläge,
// was man kürzen oder streichen könnte." The server compares the plan with when scenes were really
// marked "Im Kasten" (backend app/live_schedule.py); this view refreshes every 30 s.

export function delayLabel(min: number, t: (k: never, v?: Record<string, unknown>) => string): string {
  if (Math.abs(min) < 1) return t("schedule.onPlan" as never);
  return min > 0 ? t("schedule.behind" as never, { n: min }) : t("schedule.ahead" as never, { n: -min });
}

export function LiveScheduleModal({
  open,
  onClose,
  projectId,
  planScenes,
  planLabel,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** the open shotlist's scenes in shooting order — "Tagesplan erstellen" times exactly these */
  planScenes: { id: string; title: string; minutes: number | null }[];
  planLabel?: string;
}) {
  const api = useApi();
  const toast = useToast();
  const { t, language } = useLanguage();
  const tt = t as unknown as (k: string, v?: Record<string, unknown>) => string;
  const [day, setDay] = useState<string | undefined>(undefined);
  const [data, setData] = useState<LiveSchedule | null>(null);
  const [planDate, setPlanDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [planStart, setPlanStart] = useState("08:00");
  const [planning, setPlanning] = useState(false);

  const load = useCallback(() => {
    api
      .liveSchedule(projectId, day)
      .then((d) => {
        setData(d);
        if (!day) setDay(d.date);
      })
      .catch(() => {});
  }, [api, projectId, day]);

  useEffect(() => {
    if (!open) return;
    load();
    const timer = window.setInterval(load, 30_000);
    const onMutated = () => window.setTimeout(load, 600);
    window.addEventListener("subshot:mutated", onMutated);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("subshot:mutated", onMutated);
    };
  }, [open, load]);

  async function makePlan() {
    setPlanning(true);
    try {
      const r = await api.autoSchedule(projectId, planDate, planStart, planScenes.map((s) => s.id));
      toast.showSuccess(tt("schedule.planned", { n: r.updated, end: r.end ?? "" }));
      setDay(planDate);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : tt("schedule.failed"));
    } finally {
      setPlanning(false);
    }
  }

  const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(language === "en" ? "en-GB" : "de-CH", { weekday: "short", day: "2-digit", month: "2-digit" });
  const behind = (data?.delay_min ?? 0) >= 1;
  const ahead = (data?.delay_min ?? 0) <= -1;

  return (
    <Modal open={open} onClose={onClose} title={tt("schedule.title")} wide>
      <div className="space-y-5">
        {data?.days && data.days.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.days.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={cn("rounded-full px-3 py-1.5 text-xs transition-colors", d === data.date ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10")}
              >
                {fmtDay(d)}
              </button>
            ))}
          </div>
        )}

        {!data ? (
          <p className="text-sm text-white/50 animate-pulse">{tt("common.loading")}</p>
        ) : data.state === "empty" ? (
          <p className="text-sm text-white/50">{tt("schedule.empty")}</p>
        ) : (
          <>
            <div
              className={cn(
                "rounded-2xl border px-5 py-4",
                behind ? "border-red-500/40 bg-red-500/10" : ahead ? "border-emerald-500/40 bg-emerald-500/10" : "border-white/10 bg-white/[0.03]"
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className={cn("text-2xl font-semibold tabular-nums", behind ? "text-red-300" : ahead ? "text-emerald-300" : "text-white")}>
                  {data.state === "not_started" ? tt("schedule.notStarted") : delayLabel(data.delay_min, t as never)}
                </p>
                <p className="text-sm text-white/60 tabular-nums">
                  {tt("schedule.wrap", { planned: data.planned_end, projected: data.projected_end })}
                </p>
              </div>
              <p className="mt-1 text-xs text-white/45">
                {tt("schedule.progress", { done: data.done, total: data.total, now: data.now })}
                {data.state === "wrapped" ? ` · ${tt("schedule.wrapped")}` : ""}
              </p>
            </div>

            {behind && ((data.suggestions?.length ?? 0) > 0 || data.shorten) && (
              <div className="rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3 text-sm">
                <p className="font-medium text-amber-200">{tt("schedule.catchUp", { n: data.delay_min })}</p>
                {(data.suggestions?.length ?? 0) > 0 && (
                  <p className="mt-1 text-white/75">
                    {tt("schedule.cut")}{" "}
                    {data.suggestions!.map((s) => `${s.number ? `#${s.number} ` : ""}${s.title} (${s.minutes} Min.${s.priority ? `, ${tt(`priority.${s.priority}`)}` : ""})`).join(" · ")}
                  </p>
                )}
                {data.shorten && <p className="mt-1 text-white/60">{tt("schedule.shorten", { n: data.shorten.scenes, m: data.shorten.minutes_each })}</p>}
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <tbody>
                  {data.rows.map((r) => (
                    <tr
                      key={r.scene_id}
                      className={cn(
                        "border-b border-white/6 last:border-0",
                        r.status === "current" && "bg-blue-500/10",
                        (r.status === "done" || r.status === "not_shot") && "opacity-55",
                        r.intermediate && "text-white/60"
                      )}
                    >
                      <td className="w-6 px-3 py-2 align-top">
                        {r.status === "done" ? "✓" : r.status === "not_shot" ? "✕" : r.status === "current" ? "▶" : ""}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top tabular-nums">
                        <span className={cn(r.new_start && "line-through text-white/35")}>{r.planned_start}</span>
                        {r.new_start && <span className={cn("ml-1.5", behind ? "text-red-300" : "text-emerald-300")}>{r.new_start}</span>}
                      </td>
                      <td className="px-2 py-2 align-top text-white">
                        {!r.intermediate && r.number ? <b className="mr-1.5">{r.number}{r.letter ?? ""}</b> : null}
                        {r.title || "–"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 align-top text-xs text-white/45 tabular-nums">{r.minutes ? `${r.minutes} Min.` : ""}</td>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-white/45 tabular-nums">{r.done_at ? tt("schedule.doneAt", { time: r.done_at }) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {planScenes.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
            <p className="text-sm font-medium text-white">{tt("schedule.makeTitle", { label: planLabel ?? "" })}</p>
            <p className="mt-0.5 text-xs text-white/45">{tt("schedule.makeHint", { n: planScenes.length })}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white [color-scheme:dark]" />
              <input type="time" value={planStart} onChange={(e) => setPlanStart(e.target.value)} className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white [color-scheme:dark]" />
              <Button variant="secondary" size="sm" onClick={makePlan} disabled={planning || !planDate || !planStart}>
                {planning ? tt("common.saving") : tt("schedule.make")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
