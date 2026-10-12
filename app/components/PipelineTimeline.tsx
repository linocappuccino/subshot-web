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

  if (!progress) return <div className="h-11" aria-hidden />;

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
  return (
    <nav aria-label={t("pipelineTimeline.label")} className="w-full overflow-x-auto [scrollbar-width:none]">
      <ol className="flex items-start justify-center min-w-max px-2 py-1">
        {steps.map((s, i) => {
          const isCurrent = s.key === current;
          const sub = counter(s.key, s.decided, s.total);
          return (
            <li key={s.key} className="flex items-start">
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn("mt-[15px] h-px w-6 sm:w-14 shrink-0", steps[i - 1].done ? "bg-emerald-400/60" : "bg-white/15")}
                />
              )}
              <button
                type="button"
                onClick={() => go(s.key)}
                aria-current={isCurrent ? "step" : undefined}
                title={sub ? `${labels[s.key]} – ${sub}` : labels[s.key]}
                className={cn(
                  "group flex flex-col items-center gap-1 rounded-xl px-2 sm:px-3 py-1 transition-colors",
                  isCurrent ? "bg-white/[0.07]" : "hover:bg-white/5 cursor-pointer"
                )}
              >
                <span className="flex items-center gap-2">
                  {/* the checkbox: green with a tick once every point of the step is decided */}
                  <span
                    className={cn(
                      "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                      s.done ? "border-emerald-400 bg-emerald-400 text-[#161616]" : isCurrent ? "border-white/70" : "border-white/30"
                    )}
                  >
                    {s.done && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </span>
                  <span
                    className={cn(
                      "whitespace-nowrap text-xs sm:text-sm",
                      isCurrent ? "text-white font-semibold" : s.done ? "text-emerald-300/90 group-hover:text-emerald-200" : "text-white/55 group-hover:text-white/80",
                      // phones: only the current step keeps its name, the others are their checkbox
                      !isCurrent && "hidden sm:inline"
                    )}
                  >
                    {labels[s.key]}
                  </span>
                </span>
                {sub && <span className={cn("text-[10px] tabular-nums whitespace-nowrap", s.done ? "text-emerald-400/70" : "text-white/35", !isCurrent && "hidden sm:inline")}>{sub}</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
