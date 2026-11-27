"use client";

import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { SafeZoneFinding, VideoQc, VideoQcCheck } from "@/lib/types";

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
              <li key={c.key} data-qc-check={c.key} className="px-3 py-2.5 bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <span
                    className={cn("h-2.5 w-2.5 shrink-0 rounded-full", !c.ok ? "bg-red-500" : c.warn ? "bg-amber-400" : "bg-emerald-400")}
                    aria-label={!c.ok ? "!" : c.warn ? "?" : "OK"}
                  />
                  <span className="w-44 shrink-0 text-sm text-white/80">{c.label}</span>
                  <span className={cn("min-w-0 flex-1 text-sm tabular-nums", !c.ok ? "text-red-300" : c.warn ? "text-amber-300" : "text-white/55")}>{c.value}</span>
                </div>
                {c.warn && c.findings && c.findings.length > 0 && <SafeZoneFindings check={c} />}
              </li>
            ))}
          </ul>
        )}
        {status === "done" && qc && (
          <p className={cn("text-sm font-medium", qc.failed ? "text-red-300" : qc.warnings ? "text-amber-300" : "text-emerald-300")}>
            {qc.failed ? t("videoQc.failedCount", { n: qc.failed }) : qc.warnings ? t("videoQc.safeZoneCheck") : t("videoQc.allGood")}
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

/** 2026-11-27, Lino: Safe-Zone-Check — every spot outside the zone as a small 9:16 picture: the frame, the blocked
 *  area of the platform (top / bottom / sides / icon column) shaded, the found text or graphic framed in orange */
function SafeZoneFindings({ check }: { check: VideoQcCheck }) {
  const { t } = useLanguage();
  const list = check.findings ?? [];
  const shown = list.slice(0, 12);
  return (
    <div data-safe-zone-findings className="mt-2.5 ml-[22px]">
      <div className="flex flex-wrap gap-2">
        {shown.map((f, i) => (
          <SafeZoneThumb key={i} f={f} rects={check.zone_rects} />
        ))}
      </div>
      {list.length > shown.length && <p className="mt-1.5 text-xs text-white/45">{t("videoQc.safeZoneMore", { n: list.length - shown.length })}</p>}
    </div>
  );
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

function SafeZoneThumb({ f, rects }: { f: SafeZoneFinding; rects?: VideoQcCheck["zone_rects"] }) {
  const [x, y, w, h] = f.box;
  const W = 90;
  const H = 160;
  return (
    <figure data-safe-zone-finding className="w-[90px]">
      <div className="relative overflow-hidden rounded-md bg-black/60" style={{ width: W, height: H }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- presigned R2 preview */}
        {f.preview_url && <img src={f.preview_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />}
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {rects && (
            <path
              fillRule="evenodd"
              fill="rgba(245,158,11,0.28)"
              d={`M0 0H1V1H0Z M${rects.safe[0]} ${rects.safe[1]}H${rects.safe[2]}V${rects.column[1]}H${rects.column[0]}V${rects.safe[3]}H${rects.safe[0]}Z`}
            />
          )}
          <rect x={x} y={y} width={w} height={h} fill="none" stroke="#f59e0b" strokeWidth={0.012} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 2 }} />
        </svg>
      </div>
      <figcaption className="mt-1 text-[10.5px] leading-tight text-white/60 tabular-nums">
        {f.kind_label ?? f.kind} · {fmt(f.t0)}–{fmt(f.t1)}
      </figcaption>
    </figure>
  );
}
