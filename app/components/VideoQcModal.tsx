"use client";

import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { VideoQc } from "@/lib/types";

// 2026-10-12, Lino: "Technischer Check beim Upload — grün oder rot pro Punkt". The server measures
// every new version (ffprobe/ffmpeg, see backend app/video_qc.py); the verdict is computed for the
// chosen loudness target, so switching the target here re-evaluates without measuring again.
// Internal only — never shown on client pages.

export const LOUDNESS_TARGETS: { value: number; key: string }[] = [
  { value: -14, key: "videoQc.targetSocial" },
  { value: -16, key: "videoQc.targetPodcast" },
  { value: -23, key: "videoQc.targetTv" },
];

export function VideoQcModal({
  open,
  onClose,
  title,
  versionLabel,
  qc,
  target,
  onTarget,
  onRerun,
  rerunning,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  versionLabel: string;
  qc: VideoQc | null;
  target: number;
  onTarget: (t: number) => void;
  onRerun?: () => void;
  rerunning?: boolean;
}) {
  const { t } = useLanguage();
  const status = qc?.status ?? "none";
  return (
    <Modal open={open} onClose={onClose} title={t("videoQc.title", { title, version: versionLabel })}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/50">
          {t("videoQc.target")}
          {LOUDNESS_TARGETS.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => onTarget(o.value)}
              className={cn("rounded-full px-3 py-1 transition-colors", target === o.value ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10")}
            >
              {t(o.key as never)} ({o.value} LUFS)
            </button>
          ))}
        </div>
        {status === "pending" && <p className="text-sm text-white/60 animate-pulse">{t("videoQc.pending")}</p>}
        {status === "none" && <p className="text-sm text-white/50">{t("videoQc.none")}</p>}
        {status === "error" && <p className="text-sm text-red-400">{t("videoQc.error")}</p>}
        {status === "done" && qc && (
          <ul className="divide-y divide-white/8 rounded-xl border border-white/10 overflow-hidden">
            {qc.checks.map((c) => (
              <li key={c.key} className="flex items-center gap-3 px-3 py-2.5 bg-white/[0.02]">
                <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", c.ok ? "bg-emerald-400" : "bg-red-500")} aria-label={c.ok ? "OK" : "!"} />
                <span className="w-44 shrink-0 text-sm text-white/80">{c.label}</span>
                <span className={cn("min-w-0 flex-1 text-sm tabular-nums", c.ok ? "text-white/55" : "text-red-300")}>{c.value}</span>
              </li>
            ))}
          </ul>
        )}
        {status === "done" && qc && (
          <p className={cn("text-sm font-medium", qc.failed ? "text-red-300" : "text-emerald-300")}>
            {qc.failed ? t("videoQc.failedCount", { n: qc.failed }) : t("videoQc.allGood")}
          </p>
        )}
        {onRerun && (
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={onRerun} disabled={rerunning || status === "pending"}>
              {status === "none" ? t("videoQc.run") : t("videoQc.rerun")}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
