"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { CalendarEvent } from "@/lib/projectMeta";

// 2026-10-13, Lino: "Kalenderansicht" — a month of every shooting day, Postproduction deadline and
// Deliver link expiry across all projects (GET /me/calendar). Click an entry → straight into that
// project (shot list / Postproduction / Deliver).

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function ProjectCalendar({ showArchived }: { showArchived: boolean }) {
  const api = useApi();
  const router = useRouter();
  const { t, language } = useLanguage();
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);

  // 6 weeks from the Monday on/before the 1st
  const days = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);

  useEffect(() => {
    let alive = true;
    api
      .calendar(iso(days[0]), iso(days[41]))
      .then((r) => alive && setEvents(r.events))
      .catch(() => alive && setEvents([]));
    return () => {
      alive = false;
    };
  }, [api, days]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events ?? []) {
      if (e.archived && !showArchived) continue;
      const list = m.get(e.date) ?? [];
      list.push(e);
      m.set(e.date, list);
    }
    return m;
  }, [events, showArchived]);

  const today = iso(new Date());
  const locale = language === "en" ? "en-GB" : "de-CH";
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: "short" }));

  function open(e: CalendarEvent) {
    if (e.kind === "shoot") {
      sessionStorage.setItem("subshot:returnView", "scenes");
      router.push(`/projects/${e.project_id}${e.section_id ? `?openSection=${e.section_id}` : ""}`);
    } else if (e.kind === "deadline") router.push(`/projects/${e.project_id}/postproduction`);
    else router.push(`/projects/${e.project_id}/deliver`);
  }

  return (
    <div className="[font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold capitalize">{month.toLocaleDateString(locale, { month: "long", year: "numeric" })}</h2>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="h-8 w-8 rounded-full text-white/70 hover:bg-white/10" aria-label="‹">
            ‹
          </button>
          <button
            type="button"
            onClick={() => {
              const n = new Date();
              setMonth(new Date(n.getFullYear(), n.getMonth(), 1));
            }}
            className="rounded-full px-3 py-1 text-[13px] text-[#0a84ff] hover:bg-white/[0.06]"
          >
            {t("overview.cal.today")}
          </button>
          <button type="button" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="h-8 w-8 rounded-full text-white/70 hover:bg-white/10" aria-label="›">
            ›
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-2xl ring-1 ring-white/[0.08]">
        {weekdays.map((w) => (
          <div key={w} className="bg-white/[0.04] px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-white/40">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const key = iso(d);
          const inMonth = d.getMonth() === month.getMonth();
          const list = byDay.get(key) ?? [];
          return (
            <div key={key} className={cn("min-h-[104px] border-t border-white/[0.06] p-1.5 [&:not(:nth-child(7n+1))]:border-l", !inMonth && "bg-black/20")}>
              <div className={cn("mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[12px] tabular-nums", key === today ? "bg-[#ff3b30] font-semibold text-white" : inMonth ? "text-white/75" : "text-white/25")}>
                {d.getDate()}
              </div>
              <div className="space-y-1">
                {list.slice(0, 4).map((e, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => open(e)}
                    title={`${e.project_name}${e.client_name ? ` · ${e.client_name}` : ""}`}
                    className={cn("flex w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight transition-[filter] hover:brightness-125", e.done && "opacity-50 line-through")}
                    style={{ background: `${e.color}33`, boxShadow: `inset 2px 0 0 ${e.color}` }}
                  >
                    <span aria-hidden>{e.kind === "shoot" ? "🎬" : e.kind === "deadline" ? "⏰" : "🔗"}</span>
                    <span className="truncate">
                      {e.kind === "shoot" && e.start ? <span className="tabular-nums text-white/60">{e.start} </span> : null}
                      {e.emoji ? `${e.emoji} ` : ""}
                      {e.project_name}
                    </span>
                  </button>
                ))}
                {list.length > 4 && <div className="px-1.5 text-[11px] text-white/40">+{list.length - 4}</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-white/45">
        <span>🎬 {t("overview.cal.shoot")}</span>
        <span>⏰ {t("overview.cal.deadline")}</span>
        <span>🔗 {t("overview.cal.deliver_expiry")}</span>
      </div>
      {events === null && <p className="mt-3 text-sm text-white/40 animate-pulse">…</p>}
    </div>
  );
}
