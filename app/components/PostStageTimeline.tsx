"use client";

import { cn } from "@/lib/cn";
import { POST_STAGES, type PostStage, type StoredPostStage } from "@/lib/types";
import { useLanguage } from "@/lib/i18n";

// 2026-09-25, Lino: "Beim Videoplayer auf der Postproduction-Seite soll oben in der Mitte immer
// stehen, in welchem Stadium sich das Video befindet: Rohschnitt > Feinschnitt > Color Grading >
// Abgenommen … pro Version auswählen/definieren … wie ein Zeitstrahl … auch auf der Preview-Seite."
// Used in VideoReviewModal's header (clickable for editors, read-only on /preview) and, as the
// compact PostStageLabel, in VideoTile's footer.

export function usePostStageLabels(): Record<PostStage, string> {
  const { t } = useLanguage();
  return {
    rohschnitt: t("postStage.rohschnitt"),
    feinschnitt: t("postStage.feinschnitt"),
    color_grading: t("postStage.colorGrading"),
    abgenommen: t("postStage.abgenommen"),
  };
}

export function PostStageTimeline({
  stage,
  onChange,
  disabled = false,
}: {
  stage: PostStage | null;
  /** Undefined = read-only (public preview / non-editors). "abgenommen" is never selectable —
   * it follows the section's "Abgeschlossen" status automatically. */
  onChange?: (stage: StoredPostStage) => void;
  disabled?: boolean;
}) {
  const { t } = useLanguage();
  const labels = usePostStageLabels();
  const activeIndex = stage ? POST_STAGES.indexOf(stage) : -1;

  return (
    // 2026-09-25, Lino: "über dem jeweilig aktivierten Workflow … klein drüber schreiben
    // 'Working on'" — absolutely positioned above the current step; `pt-3` reserves that line
    // permanently (inside the scroll container's padding box, so it isn't clipped) so switching
    // stages never changes the header height. Not shown for "Abgenommen" (nothing in work).
    <ol className="flex items-center gap-0 min-w-0 pt-3" aria-label="Stadium">
      {POST_STAGES.map((s, i) => {
        const reached = i <= activeIndex;
        const current = i === activeIndex;
        const approved = s === "abgenommen";
        const clickable = Boolean(onChange) && !approved && !disabled;
        const dotColor = !reached
          ? "border-white/25 bg-transparent"
          : approved
            ? "border-emerald-400 bg-emerald-400"
            : "border-white bg-white";
        return (
          <li key={s} className="flex items-center shrink-0">
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "h-px w-3 sm:w-6 shrink-0 transition-colors",
                  reached ? (activeIndex === POST_STAGES.length - 1 ? "bg-emerald-400/70" : "bg-white/70") : "bg-white/15"
                )}
              />
            )}
            <span className="relative">
            {current && !approved && <WorkingOnKicker className="absolute bottom-full left-1/2 -translate-x-1/2" />}
            <button
              type="button"
              disabled={!clickable}
              onClick={() => clickable && onChange?.(s as StoredPostStage)}
              title={approved ? t("postStage.abgenommenHint") : labels[s]}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-1.5 sm:px-2 py-1 text-[11px] sm:text-xs whitespace-nowrap transition-colors",
                clickable ? "cursor-pointer hover:bg-white/10" : "cursor-default",
                current ? (approved ? "text-emerald-400 font-semibold" : "text-white font-semibold") : reached ? "text-white/60" : "text-white/35"
              )}
            >
              <span className={cn("w-2 h-2 rounded-full border shrink-0 transition-colors", dotColor)} />
              {/* Phone width: only the CURRENT step keeps its text (the others stay as dots with
                  a tooltip), otherwise four labels don't fit in one line. */}
              <span className={current ? undefined : "hidden sm:inline"}>{labels[s]}</span>
            </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Compact read-only "current stage" text for the tile footer. */
export function PostStageLabel({ stage, className }: { stage: PostStage | null; className?: string }) {
  const labels = usePostStageLabels();
  if (!stage) return null;
  const approved = stage === "abgenommen";
  return (
    <span className={cn("inline-flex flex-col items-end whitespace-nowrap", className)}>
      {/* Reserved (invisible) even when approved so every tile's footer has the same height. */}
      <WorkingOnKicker className={approved ? "invisible" : undefined} />
      <span className={cn("inline-flex items-center gap-1.5", approved ? "text-emerald-400" : "text-white/70")}>
        <span className={cn("w-1.5 h-1.5 rounded-full", approved ? "bg-emerald-400" : "bg-white/70")} />
        {labels[stage]}
      </span>
    </span>
  );
}

/** Tiny "Working on" caption above the current (not yet approved) stage. Deliberately English in
 * every UI language — Lino's wording. */
function WorkingOnKicker({ className }: { className?: string }) {
  return (
    <span className={cn("block text-[9px] leading-none uppercase tracking-wider text-white/40 whitespace-nowrap pb-0.5", className)}>
      Working on
    </span>
  );
}
