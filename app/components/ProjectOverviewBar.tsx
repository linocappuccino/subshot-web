"use client";

import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { OverviewStepKey } from "@/lib/projectMeta";

// 2026-10-13, Lino: Projektübersicht — search across every folder (name, client), filter by the
// project's current pipeline step, the archive, and tiles ↔ calendar. No sorting on purpose
// (Lino: "sortieren soll man nicht können").

export type StepFilter = "all" | OverviewStepKey | "done";
export type OverviewMode = "tiles" | "calendar";

const STEPS: StepFilter[] = ["all", "ideas", "scenes", "postproduction", "deliver", "done"];

export function ProjectOverviewBar({
  query,
  onQuery,
  step,
  onStep,
  archive,
  onArchive,
  mode,
  onMode,
  counts,
}: {
  query: string;
  onQuery: (q: string) => void;
  step: StepFilter;
  onStep: (s: StepFilter) => void;
  archive: boolean;
  onArchive: (on: boolean) => void;
  mode: OverviewMode;
  onMode: (m: OverviewMode) => void;
  /** projects per current step (non-archived) */
  counts: Partial<Record<StepFilter, number>>;
}) {
  const { t } = useLanguage();
  const chip = "shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium tracking-[-0.01em] transition-colors whitespace-nowrap";
  return (
    <div className="mb-6 space-y-3 [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-inset ring-white/[0.08] focus-within:ring-[#0a84ff]/60">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="shrink-0 text-white/40" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t("overview.search")}
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
          />
          {query && (
            <button type="button" onClick={() => onQuery("")} className="text-white/40 hover:text-white" aria-label="✕">
              ✕
            </button>
          )}
        </label>
        <div className="flex rounded-full bg-white/[0.07] p-0.5">
          {(["tiles", "calendar"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onMode(m)}
              className={cn(chip, "py-1", mode === m ? "bg-white/[0.18] text-white shadow-[0_1px_3px_rgba(0,0,0,0.4)]" : "text-white/55 hover:text-white/85")}
            >
              {m === "tiles" ? "▦ " : "📅 "}
              {t(m === "tiles" ? "overview.tiles" : "overview.calendar")}
            </button>
          ))}
        </div>
      </div>
      {mode === "tiles" && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]">
          {STEPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                onStep(s);
                onArchive(false);
              }}
              className={cn(chip, !archive && step === s ? "bg-white text-black" : "bg-white/[0.06] text-white/70 hover:bg-white/[0.12]")}
            >
              {t(s === "all" ? "overview.all" : (`overview.step.${s}` as Parameters<typeof t>[0]))}
              {counts[s] != null && <span className={cn("ml-1.5 tabular-nums", !archive && step === s ? "text-black/50" : "text-white/35")}>{counts[s]}</span>}
            </button>
          ))}
          <span className="mx-1 h-5 w-px shrink-0 bg-white/10" />
          <button
            type="button"
            onClick={() => onArchive(!archive)}
            className={cn(chip, archive ? "bg-white text-black" : "bg-white/[0.06] text-white/70 hover:bg-white/[0.12]")}
          >
            🗄 {t("overview.archive")}
          </button>
        </div>
      )}
    </div>
  );
}
