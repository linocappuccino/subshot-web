"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n";
import type { DeliverVideo } from "@/lib/types";

// 2026-10-12, Lino: "das mit den versch. fassungen ist so viel zu kompliziert und versteckt ... auch
// für den kunden muss das viel einfacher ersichtlich und übersichtlicher sein" — the client's card per
// video on the Deliver page: Apple-style format switch, preview in that format, one big download.

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** aspect ratio from a label like "9:16" / "4:5" (null for "Cutdown 15s" etc.) */
function ratioOfLabel(label: string): number | null {
  const m = label.match(/(\d+(?:[.,]\d+)?)\s*[:x×]\s*(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const a = parseFloat(m[1].replace(",", "."));
  const b = parseFloat(m[2].replace(",", "."));
  return a > 0 && b > 0 ? a / b : null;
}

/** "16:9" / "9:16" / "1:1" / "4:5" for the main version's own frame size */
function formatOfRatioLocal(r: number | null): string | null {
  if (!r) return null;
  const known: [string, number][] = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:5", 4 / 5], ["4:3", 4 / 3], ["21:9", 21 / 9]];
  const hit = known.find(([, v]) => Math.abs(v - r) / v < 0.04);
  return hit ? hit[0] : null;
}

export function DeliverVideoCard({
  video,
  zipPct,
  zipBusy,
  onPlay,
  onDownloadMain,
  onDownloadFile,
  onDownloadZip,
}: {
  video: DeliverVideo;
  zipPct: number | null;
  zipBusy: boolean;
  onPlay: () => void;
  onDownloadMain: () => void;
  onDownloadFile: (kind: "deliverable" | "license", id: string) => void;
  onDownloadZip: () => void;
}) {
  const { t } = useLanguage();
  const v = video.latest_version;
  const mainRatio = v?.filmstrip_frame_width && v?.filmstrip_frame_height ? v.filmstrip_frame_width / v.filmstrip_frame_height : 16 / 9;
  const mainFormat = formatOfRatioLocal(mainRatio);
  const formats = [
    { id: "main", label: mainFormat ?? t("deliverPage.mainVersion"), ratio: mainRatio, size: v?.file_size_bytes ?? null },
    ...(video.deliverables ?? []).map((d) => ({ id: d.id, label: d.label, ratio: ratioOfLabel(d.label) ?? mainRatio, size: d.file_size_bytes })),
  ];
  const [sel, setSel] = useState("main");
  const current = formats.find((f) => f.id === sel) ?? formats[0];
  const licenses = video.licenses ?? [];
  const extra = formats.length > 1 || licenses.length > 0;
  // the preview frame: as large as fits a square box, in the chosen format
  const frame = current.ratio >= 1 ? { width: "100%", aspectRatio: String(current.ratio) } : { height: "100%", aspectRatio: String(current.ratio) };

  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-inset ring-white/[0.06] [font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]">
      {formats.length > 1 && (
        <div className="flex self-center overflow-x-auto rounded-full bg-white/[0.07] p-0.5 [scrollbar-width:none]">
          {formats.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setSel(f.id)}
              className={`whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-medium tracking-[-0.01em] transition-all ${
                f.id === current.id ? "bg-white/[0.18] text-white shadow-[0_1px_3px_rgba(0,0,0,0.4)]" : "text-white/55 hover:text-white/85"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <div className="group relative flex aspect-square items-center justify-center overflow-hidden rounded-xl bg-black/30">
        <div className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-white/5 transition-all duration-300" style={frame}>
          {v?.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
            <img src={v.thumbnail_url} alt={video.title} className="h-full w-full object-cover" />
          ) : null}
          {current.id === "main" && (
            <button
              type="button"
              onClick={onPlay}
              aria-label={t("deliverPage.play")}
              className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/30"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform group-hover:scale-110">
                <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-5 w-5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </button>
          )}
        </div>
      </div>

      <div className="min-w-0 px-0.5">
        <p className="truncate text-[15px] font-semibold text-white">{video.title}</p>
        <p className="text-xs text-white/45">
          {current.label}
          {current.size ? ` · ${formatBytes(current.size)}` : ""}
        </p>
      </div>

      <button
        type="button"
        onClick={() => (current.id === "main" ? onDownloadMain() : onDownloadFile("deliverable", current.id))}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-white py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
      >
        ⬇ {t("deliverPage.downloadThis", { format: current.label })}
      </button>

      {extra && (
        <div className="flex flex-col items-center gap-2">
          {formats.length > 1 && (
            <button type="button" disabled={zipBusy} onClick={onDownloadZip} className="text-[13px] text-[#0a84ff] hover:opacity-80 disabled:opacity-50">
              {zipPct !== null ? `${t("deliverPage.zipping")} ${zipPct}%` : t("deliverPage.allFormatsZip", { n: formats.length })}
            </button>
          )}
          {licenses.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {licenses.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => onDownloadFile("license", l.id)}
                  title={l.filename}
                  className="max-w-full truncate rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/65 hover:bg-white/[0.12] hover:text-white"
                >
                  📄 {l.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
