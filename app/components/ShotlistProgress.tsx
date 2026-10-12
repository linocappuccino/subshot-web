"use client";

import { ProgressRing } from "./PipelineTimeline";
import { useLanguage } from "@/lib/i18n";
import type { Scene } from "@/lib/types";

// 2026-10-12, Lino: "in der shotlist overview auch anzeigen wie viel szenen von wie viel szenen schon
// geschossen / erledigt wurden" — per shotlist tile: Activity-style ring + "7/12 im Kasten" + a thin
// bar. Same rule as the pipeline timeline's Script step: every scene except info tiles, done =
// "im Kasten" (completed; "nicht gedreht" sets it too).

export function ShotlistProgress({ scenes }: { scenes: Scene[] }) {
  const { t } = useLanguage();
  const real = scenes.filter((s) => !s.is_project_info);
  const total = real.length;
  const done = real.filter((s) => s.completed).length;
  if (!total) return <div className="mt-1 text-sm text-white/40">{t("pipelineTimeline.empty")}</div>;
  const ratio = done / total;
  const complete = done === total;
  return (
    <div className="mt-2 [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
      <div className="flex items-center gap-2 text-[13px] tracking-[-0.01em]">
        <ProgressRing ratio={ratio} done={complete} active />
        <span className={complete ? "font-medium text-[#30d158]" : "text-white/70"}>
          <span className="tabular-nums">
            {done}/{total}
          </span>{" "}
          {t("shotlistProgress.shot")}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.08]">
        <div className="h-full rounded-full bg-[#30d158] transition-[width] duration-700 ease-out" style={{ width: `${Math.round(ratio * 100)}%` }} />
      </div>
    </div>
  );
}
