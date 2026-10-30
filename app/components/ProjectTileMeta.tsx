"use client";

import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { daysFromToday, formatStorage, type NextEvent, type ProjectMeta } from "@/lib/projectMeta";
import { ClientLogoImage } from "./ClientLogoImage";

// 2026-10-13, Lino: Projektübersicht — what a project tile shows from GET /projects/overview-meta:
// mini pipeline rings (same as the PipelineTimeline), the next date ("Dreh in 3 Tagen", red when
// overdue), the client logo (logo library) and the project's storage.

const GREEN = "#30d158";

function MiniRing({ ratio, done, size = 13 }: { ratio: number; done: boolean; size?: number }) {
  const r = size / 2 - 1.6;
  const c = 2 * Math.PI * r;
  if (done) {
    return (
      <span className="flex shrink-0 items-center justify-center rounded-full" style={{ width: size, height: size, background: GREEN }}>
        <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90" aria-hidden>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2" stroke="rgba(255,255,255,0.28)" />
      {ratio > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="2" strokeLinecap="round" stroke={GREEN} strokeDasharray={`${c * ratio} ${c}`} />}
    </svg>
  );
}

/** the pipeline as a frosted capsule of mini rings + the current step's name (tile badge) */
export function PipelineRingsBadge({ meta }: { meta: ProjectMeta }) {
  const { t } = useLanguage();
  const label = t(`overview.step.${meta.current_step}` as Parameters<typeof t>[0]);
  return (
    <span
      className="flex items-center gap-1 rounded-full bg-black/45 py-[3px] pl-1.5 pr-2 shadow-sm shadow-black/30 ring-1 ring-white/10 backdrop-blur-md"
      title={meta.steps.map((s) => `${t(`overview.step.${s.key}` as Parameters<typeof t>[0])}${s.total ? ` ${s.decided}/${s.total}` : ""}${s.done ? " ✓" : ""}`).join(" · ")}
    >
      {meta.steps.map((s) => (
        <MiniRing key={s.key} ratio={s.done ? 1 : s.total ? s.decided / s.total : 0} done={s.done} />
      ))}
      <span className="ml-0.5 text-[10px] font-semibold text-white">{label}</span>
    </span>
  );
}

export function nextEventText(e: NextEvent, t: ReturnType<typeof useLanguage>["t"], language: string): string {
  const days = daysFromToday(e.at);
  const when =
    e.overdue && days < 0
      ? t("overview.when.overdue", { n: -days })
      : days === 0
        ? t("overview.when.today")
        : days === 1
          ? t("overview.when.tomorrow")
          : days > 1 && days <= 14
            ? t("overview.when.inDays", { n: days })
            : t("overview.when.on", { date: new Date(e.at).toLocaleDateString(language === "en" ? "en-GB" : "de-CH", { day: "2-digit", month: "2-digit" }) });
  return t(`overview.next.${e.kind}` as Parameters<typeof t>[0], { when });
}

/** "📅 Dreh in 3 Tagen" — red when overdue, amber for today/tomorrow */
export function NextEventChip({ event }: { event: NextEvent }) {
  const { t, language } = useLanguage();
  const days = daysFromToday(event.at);
  const icon = event.kind === "shoot" ? "🎬" : event.kind === "deadline" ? "⏰" : "🔗";
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        event.overdue ? "bg-red-500/20 text-red-300" : days <= 1 ? "bg-amber-400/15 text-amber-200" : "bg-white/[0.07] text-white/70",
      )}
    >
      <span aria-hidden>{icon}</span>
      <span>{nextEventText(event, t, language)}</span>
    </span>
  );
}

/** the client's logo, filling its badge field (bottom-right of the tile image; 2026-10-30 no white plate) */
export function ClientLogoBadge({ url }: { url: string }) {
  return <ClientLogoImage src={url} className="h-8 w-14 shadow-md shadow-black/40 ring-1 ring-white/20" />;
}

/** under the title: next date chip + storage */
export function ProjectTileFooter({ meta }: { meta: ProjectMeta }) {
  const storage = formatStorage(meta.storage_bytes);
  if (!meta.next_event && !storage) return null;
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {meta.next_event && <NextEventChip event={meta.next_event} />}
      {storage && <span className="ml-auto shrink-0 text-[11px] tabular-nums text-white/35">{storage}</span>}
    </div>
  );
}
