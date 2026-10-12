"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { Callsheet, CallsheetDay } from "@/lib/types";

// 2026-10-12, Lino: "Callsheet / Dispo automatisch — ein Link bzw. PDF pro Drehtag für die Crew:
// Location und Karte, Zuständige und Zeiten, plus Wetter und Sonnenstand (Golden Hour,
// Sonnenuntergang) für jede Location". Shooting days come from the scenes' start times; the
// server builds the day (weather: Open-Meteo up to 16 days ahead, sun: computed) and the PDF.

function fmtDay(iso: string, lang: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(lang === "en" ? "en-GB" : "de-CH", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function CallsheetModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  const api = useApi();
  const toast = useToast();
  const { t, language } = useLanguage();
  const [days, setDays] = useState<CallsheetDay[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Callsheet | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);

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

  async function downloadPdf() {
    if (!day) return;
    setPdfBusy(true);
    try {
      const url = await api.callsheetPdfUrl(projectId, day);
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
  return (
    <Modal open={open} onClose={onClose} title={t("callsheet.title")} wide>
      {days === null ? (
        <p className="text-sm text-white/50 animate-pulse">{t("common.loading")}</p>
      ) : days.length === 0 ? (
        <p className="text-sm text-white/50">{t("callsheet.noDays")}</p>
      ) : (
        <div className="space-y-5">
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
              <div className="grid gap-3 sm:grid-cols-2">
                {shown.locations.map((l) => (
                  <div key={l.no} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
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
                      <p className="mt-1.5 text-white/75">
                        {l.weather.symbol} {l.weather.text} · {Math.round(l.weather.t_min)}–{Math.round(l.weather.t_max)} °C · {t("weather.rain")} {l.weather.rain_prob ?? 0} % · {t("weather.wind")}{" "}
                        {Math.round(l.weather.wind ?? 0)} km/h
                      </p>
                    ) : (
                      l.lat !== null && (
                        <p className="mt-1.5 text-white/40">
                          {shown.forecast_from ? t("callsheet.forecastFrom", { date: fmtDay(shown.forecast_from, language) }) : t("callsheet.noForecast")}
                        </p>
                      )
                    )}
                    {l.sun && l.sun.sunrise && (
                      <p className="mt-1 text-xs text-white/55">
                        ☀ {t("callsheet.sunrise")} {l.sun.sunrise} · {t("callsheet.sunset")} {l.sun.sunset}
                        <br />
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

              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="w-full text-sm">
                  <tbody>
                    {shown.rows.map((r, i) => (
                      <tr key={i} className={cn("border-b border-white/6 last:border-0", r.intermediate && "bg-white/[0.03]")}>
                        <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums text-white/80">
                          {r.start}
                          {r.end ? `–${r.end}` : ""}
                        </td>
                        <td className="px-3 py-2 align-top text-white">
                          {!r.intermediate && r.number ? <b className="mr-1.5">{r.number}{r.letter ?? ""}</b> : null}
                          {r.title || "–"}
                          {r.intermediate && <span className="ml-1.5 text-xs text-white/40">({t("callsheet.inBetween")})</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 align-top text-white/50">{r.location ? `L${r.location}` : ""}</td>
                        <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums text-white/70">{r.weather ? `${r.weather.symbol} ${Math.round(r.weather.temp)}°` : ""}</td>
                        <td className="px-3 py-2 align-top text-xs text-white/55">{r.assignees.join(", ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-white/35">{t("callsheet.hint")}</p>
                <Button variant="primary" size="sm" onClick={downloadPdf} disabled={pdfBusy}>
                  {pdfBusy ? t("common.loading") : t("callsheet.pdf")}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
