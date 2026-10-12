"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi } from "@/lib/useApi";
import { cn } from "@/lib/cn";
import { useLanguage } from "@/lib/i18n";
import type { PipelineProgress, PipelineStepKey } from "@/lib/types";

// 2026-10-12, Lino: "über den einzelnen Pipeline-Seiten eine Timeline, mit einem Checkfeld — wenn
// jegliche Punkte abgenommen / abgelehnt wurden, wird der Pipeline-Punkt als abgecheckt markiert;
// oben kann man dann auch zu den einzelnen Pipeline-Seiten navigieren, wenn man draufklickt."
// The numbers come from the server (GET /projects/{id}/pipeline-progress, same rules as the
// project's pipeline_stage): Ideen = every idea approved/rejected, Script = every real scene
// "im Kasten" / "nicht gedreht", Postproduction = every section "abgeschlossen" / "abgelehnt",
// Deliver = every step before it checked. Steps of disabled modules are left out.

const POLL_MS = 15_000;

export function PipelineTimeline({
  projectId,
  current,
  refreshKey,
  onSelect,
  fetchProgress,
}: {
  projectId: string;
  current: PipelineStepKey;
  /** changes whenever the page changed something that counts (re-fetch right away) */
  refreshKey?: string | number;
  /** the page handles this step itself (Ideen ↔ Script live on the same route); return true if handled */
  onSelect?: (step: PipelineStepKey) => boolean | void;
  /** tests only: where the numbers come from (default: the API) */
  fetchProgress?: () => Promise<PipelineProgress>;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const api = useApi();
  const [progress, setProgress] = useState<PipelineProgress | null>(null);

  const load = useCallback(() => {
    (fetchProgress ? fetchProgress() : api.pipelineProgress(projectId))
      .then(setProgress)
      .catch(() => {
        // the timeline is extra information — the page works without it
      });
  }, [api, projectId, fetchProgress]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const id = window.setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    // any change made on this page (approve, reject, "im Kasten", status …) → re-read shortly after
    let soon: number | undefined;
    const onMutated = () => {
      window.clearTimeout(soon);
      soon = window.setTimeout(load, 350);
    };
    window.addEventListener("focus", load);
    window.addEventListener("subshot:mutated", onMutated);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(soon);
      window.removeEventListener("focus", load);
      window.removeEventListener("subshot:mutated", onMutated);
    };
  }, [load]);

  if (!progress) return <div className="h-[46px]" aria-hidden />;

  const labels: Record<PipelineStepKey, string> = {
    ideas: t("workflow.ideasConcept"),
    scenes: t("workflow.scriptShotlist"),
    postproduction: t("workflow.postproduction"),
    deliver: t("workflow.deliver"),
  };
  const counter = (key: PipelineStepKey, decided: number, total: number) => {
    if (key === "deliver") return null;
    if (!total) return t("pipelineTimeline.empty");
    return t(key === "scenes" ? "pipelineTimeline.shot" : "pipelineTimeline.decided", { done: decided, total });
  };

  function go(step: PipelineStepKey) {
    if (step === current) return;
    if (onSelect?.(step)) return;
    if (step === "ideas" || step === "scenes") {
      // the project page opens on the view it finds here (same flag as its own "back" buttons)
      sessionStorage.setItem("subshot:returnView", step);
      router.push(`/projects/${projectId}`);
    } else router.push(`/projects/${projectId}/${step}`);
  }

  const steps = progress.steps;
  // 2026-10-12, Lino: "die pipeline timeline etwas schöner darstellen, das sieht noch nicht apple
  // genug aus" — an iOS-style segmented capsule (frosted track, the current step a raised pill)
  // with an Activity-style progress ring per step that fills up and turns into a green tick.
  return (
    <nav aria-label={t("pipelineTimeline.label")} className="flex w-full justify-center overflow-x-auto px-2 py-1 [scrollbar-width:none]">
      <ol className="flex min-w-max items-center gap-0.5 rounded-full bg-white/[0.06] p-1 ring-1 ring-inset ring-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl">
        {steps.map((s, i) => {
          const isCurrent = s.key === current;
          const sub = counter(s.key, s.decided, s.total);
          const ratio = s.done ? 1 : s.total ? s.decided / s.total : 0;
          return (
            <li key={s.key} className="flex items-center">
              {i > 0 && (
                <svg aria-hidden width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mx-0.5 shrink-0 text-white/20">
                  <path d="m9 6 6 6-6 6" />
                </svg>
              )}
              <button
                type="button"
                onClick={() => go(s.key)}
                aria-current={isCurrent ? "step" : undefined}
                title={sub ? `${labels[s.key]} – ${sub}` : labels[s.key]}
                className={cn(
                  "group flex items-center gap-2 rounded-full py-1.5 pl-2 text-[13px] tracking-[-0.01em] transition-all duration-300 ease-out [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]",
                  isCurrent ? "pr-3.5" : "pr-2 sm:pr-3.5",
                  isCurrent
                    ? "bg-white/[0.14] text-white shadow-[0_1px_2px_rgba(0,0,0,0.35),0_4px_14px_-4px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.12)]"
                    : "cursor-pointer text-white/55 hover:bg-white/[0.06] hover:text-white/85 active:scale-[0.97]"
                )}
              >
                <ProgressRing ratio={ratio} done={s.done} active={isCurrent} />
                <span className={cn("whitespace-nowrap font-medium", !isCurrent && "hidden sm:inline")}>{labels[s.key]}</span>
                {sub && (
                  <span className={cn("hidden whitespace-nowrap text-[11px] tabular-nums md:inline", s.done ? "text-[#30d158]/80" : isCurrent ? "text-white/45" : "text-white/30")}>
                    {s.total && s.key !== "deliver" ? `${s.decided}/${s.total}` : sub}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Apple-Activity-style ring: track + green arc for the decided share, a filled green disc with a
 *  tick once the step is done. */
function ProgressRing({ ratio, done, active }: { ratio: number; done: boolean; active: boolean }) {
  const r = 7.25;
  const c = 2 * Math.PI * r;
  if (done) {
    return (
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#30d158] text-black shadow-[0_0_10px_-2px_rgba(48,209,88,0.7)]">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" className="shrink-0 -rotate-90" aria-hidden>
      <circle cx="9" cy="9" r={r} fill="none" strokeWidth="2.25" className={active ? "stroke-white/25" : "stroke-white/15"} />
      {ratio > 0 && (
        <circle
          cx="9"
          cy="9"
          r={r}
          fill="none"
          strokeWidth="2.25"
          strokeLinecap="round"
          stroke="#30d158"
          strokeDasharray={`${c * ratio} ${c}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      )}
    </svg>
  );
}
