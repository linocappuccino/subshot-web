"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Callsheet, CallsheetDay } from "@/lib/types";
import { ProjectScheduleView } from "./ProjectScheduleView";
import type { ScheduleOrder, ScheduleScene } from "@/lib/timetable";

// 2026-10-12, Lino: "Callsheet / Dispo automatisch — ein Link bzw. PDF pro Drehtag für die Crew:
// Location und Karte, Zuständige und Zeiten, plus Wetter und Sonnenstand (Golden Hour,
// Sonnenuntergang) für jede Location". Shooting days come from the scenes' start times; the
// server builds the day (weather: Open-Meteo up to 16 days ahead, sun: computed) and the PDF.
// 2026-10-30, Lino: «Callsheet bildschirmfüllend und aufgebaut wie der Timetable; die Tabelle „Szenen dieses Tages"
// brauchen wir nicht» — a full-window view (8/16/24 px margin) like the Drehplan: day chips, the locations as tiles,
// then the live Drehplan (status, order switch); location no., weather and crew of a scene are small chips on its row.

function fmtDay(iso: string, lang: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(lang === "en" ? "en-GB" : "de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

const tile = "rounded-xl bg-white/[0.04] border border-white/[0.06] px-3.5 py-2.5";

export function CallsheetModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const api = useApi();
  const toast = useToast();
  const { t, language } = useLanguage();
  const [days, setDays] = useState<CallsheetDay[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Callsheet | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [order, setOrder] = useState<ScheduleOrder>("shooting");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    api
      .callsheetDays(projectId)
      .then(({ days }) => {
        if (!alive) return;
        setDays(days);
        // the next upcoming shooting day, else the last one
        const today = new Date().toISOString().slice(0, 10);
        setDay((days.find((d) => d.date >= today) ?? days[days.length - 1])?.date ?? null);
      })
      .catch(() => alive && setDays([]));
    return () => {
      alive = false;
    };
  }, [api, projectId, open]);

  useEffect(() => {
    if (!day) return;
    let alive = true;
    api
      .callsheet(projectId, day)
      .then((s) => alive && setSheet(s))
      .catch(() => alive && setSheet(null));
    return () => {
      alive = false;
    };
  }, [api, projectId, day]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  async function downloadPdf() {
    if (!day) return;
    setPdfBusy(true);
    try {
      const url = await api.callsheetPdfUrl(projectId, day, order);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Callsheet ${sheet?.project ?? ""} ${day}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("callsheet.failed"));
    } finally {
      setPdfBusy(false);
    }
  }

  const shown = sheet && sheet.date === day ? sheet : null;
  // per scene number: location no., weather at its start, crew (what the old day table showed)
  const byNumber = useMemo(() => {
    const m = new Map<number, Callsheet["rows"][number]>();
    for (const r of shown?.rows ?? []) if (r.number != null && !r.intermediate) m.set(r.number, r);
    return m;
  }, [shown]);
  const rowExtra = (s: ScheduleScene) => {
    const r = s.number != null ? byNumber.get(s.number) : undefined;
    if (!r) return null;
    const chip = "inline-flex max-w-full items-center gap-1 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-white/65";
    return (
      <>
        {r.location ? <span className={chip}>L{r.location}</span> : null}
        {r.weather ? (
          <span className={chip}>
            {r.weather.symbol} {Math.round(r.weather.temp)}°{r.weather.rain_prob ? ` · ${r.weather.rain_prob}%` : ""}
          </span>
        ) : null}
        {r.assignees.length > 0 && <span className={cn(chip, "truncate")}>👤 {r.assignees.join(", ")}</span>}
      </>
    );
  };

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex p-2 sm:p-4 lg:p-6" role="dialog" aria-modal="true" aria-label={t("callsheet.title")}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl sm:rounded-2xl border border-white/10 bg-[#161617] text-white shadow-2xl">
        {/* header */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 px-4 py-3 sm:px-6 sm:py-4">
          <div className="shrink-0 h-9 w-9 rounded-lg bg-blue-500/15 text-blue-300 flex items-center justify-center" aria-hidden>
            📋
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[18px] font-semibold leading-tight">{t("callsheet.title")}</h2>
            <div className="truncate text-[12px] text-white/45">{[shown?.project, shown?.client].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="flex items-center gap-1.5">
            {day && (
              <button
                type="button"
                onClick={downloadPdf}
                disabled={pdfBusy}
                className="h-9 rounded-lg bg-blue-600 px-3 text-[12px] font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {pdfBusy ? t("common.loading") : t("callsheet.pdf")}
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
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-10 pt-4 sm:px-6">
          {days === null ? (
            <p className="py-20 text-center text-sm text-white/50 animate-pulse">{t("common.loading")}</p>
          ) : days.length === 0 ? (
            <p className="py-20 text-center text-sm text-white/50">{t("callsheet.noDays")}</p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-1.5">
                {days.map((d) => (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => setDay(d.date)}
                    className={cn("rounded-full px-3 py-1.5 text-xs transition-colors", d.date === day ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10")}
                  >
                    {fmtDay(d.date, language)} · {d.start}–{d.end} · {t("callsheet.scenes", { n: d.scenes })}
                  </button>
                ))}
              </div>

              {!shown ? (
                <p className="text-sm text-white/50 animate-pulse">{t("common.loading")}</p>
              ) : (
                <>
                  {/* the day's locations as tiles: address + map, weather, sun */}
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {shown.locations.map((l) => (
                      <div key={l.no} className={cn(tile, "text-[13px]")}>
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-white">
                            <b>L{l.no}</b> · {l.address ?? "–"}
                          </span>
                          {l.maps && (
                            <a href={l.maps} target="_blank" rel="noopener noreferrer" className="shrink-0 text-xs text-blue-400 hover:underline">
                              {t("callsheet.map")} ↗
                            </a>
                          )}
                        </div>
                        {l.weather ? (
                          <p className="mt-1 text-white/75">
                            {l.weather.symbol} {l.weather.text} · {Math.round(l.weather.t_min)}–{Math.round(l.weather.t_max)} °C · {t("weather.rain")} {l.weather.rain_prob ?? 0} % ·{" "}
                            {t("weather.wind")} {Math.round(l.weather.wind ?? 0)} km/h
                          </p>
                        ) : (
                          l.lat !== null && (
                            <p className="mt-1 text-white/40">
                              {shown.forecast_from ? t("callsheet.forecastFrom", { date: fmtDay(shown.forecast_from, language) }) : t("callsheet.noForecast")}
                            </p>
                          )
                        )}
                        {l.sun && l.sun.sunrise && (
                          <p className="mt-1 text-[11px] text-white/55">
                            ☀ {t("callsheet.sunrise")} {l.sun.sunrise} · {t("callsheet.sunset")} {l.sun.sunset} ·{" "}
                            <span className="text-amber-300/90">
                              {t("callsheet.golden")} {l.sun.golden_morning} / {l.sun.golden_evening}
                            </span>{" "}
                            ·{" "}
                            <span className="text-sky-300/90">
                              {t("callsheet.blue")} {l.sun.blue_morning} / {l.sun.blue_evening}
                            </span>
                          </p>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* the live Drehplan: same tiles, order switch and table as the Timetable view */}
                  <ProjectScheduleView
                    embedded
                    load={() => api.boardSchedule(projectId)}
                    pollStatus={() => api.boardScheduleStatus(projectId)}
                    onClose={() => {}}
                    onOrderChange={setOrder}
                    rowExtra={rowExtra}
                  />
                  <p className="text-xs text-white/35">{t("callsheet.hint")}</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
