"use client";

import { useRef, useState } from "react";
import { Menu, MenuItem } from "./ui/Menu";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { VideoDeliverable, VideoExtras } from "@/lib/types";

// 2026-10-12, Lino: "das mit den versch. fassungen ist so viel zu kompliziert und versteckt! das muss
// viel einfacher sein!" — the Fassungen right on the Postproduction tile, no window: the main version's
// format as a ✓ chip, every Fassung as a chip (dashed + ⬆ = still missing: click it or drop a file on
// it to upload; ✓ = uploaded: click for download / replace / remove), "+ Fassung" picks a preset.
// Licences and renaming stay in the "Fassungen & Lizenzen" window ("Mehr …").

const PRESETS = ["16:9", "9:16", "1:1", "4:5", "Cutdown 30s", "Cutdown 15s", "Cutdown 6s", "Ohne Untertitel", "Mit Untertitel"];

const mimeOf = (f: File) => f.type || (/\.mov$/i.test(f.name) ? "video/quicktime" : /\.mp4$/i.test(f.name) ? "video/mp4" : "application/octet-stream");

export function VideoFassungenChips({
  videoId,
  mainFormat,
  extras,
  onChange,
  onOpenMore,
}: {
  videoId: string;
  /** "16:9" / "9:16" … of the main version (null = unknown) */
  mainFormat: string | null;
  extras: VideoExtras;
  onChange: (update: (x: VideoExtras) => VideoExtras) => void;
  /** the full "Fassungen & Lizenzen" window */
  onOpenMore?: () => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [dropOn, setDropOn] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  const fail = (e: unknown, fallback: string) => toast.showError(e instanceof ApiError ? e.message : fallback);
  const replace = (d: VideoDeliverable) => onChange((x) => ({ ...x, deliverables: x.deliverables.map((y) => (y.id === d.id ? d : y)) }));

  const deliverables = extras.deliverables;
  const existing = new Set(deliverables.map((d) => d.label.toLowerCase()));
  if (mainFormat) existing.add(mainFormat.toLowerCase());

  async function add(label: string, thenUpload = true) {
    try {
      const d = await api.createDeliverable(videoId, label);
      onChange((x) => ({ ...x, deliverables: [...x.deliverables, d] }));
      if (thenUpload) pick(d.id);
    } catch (e) {
      fail(e, t("videoExtras.failed"));
    }
  }

  function pick(id: string) {
    target.current = id;
    input.current?.click();
  }

  async function upload(id: string, file: File) {
    const type = mimeOf(file);
    setProgress((p) => ({ ...p, [id]: 0 }));
    try {
      const { upload_url } = await api.startDeliverableUpload(id, file, type);
      onChange((x) => ({ ...x, deliverables: x.deliverables.map((d) => (d.id === id ? { ...d, status: "uploading", original_filename: file.name } : d)) }));
      await api.putFile(upload_url, file, type, (f) => setProgress((p) => ({ ...p, [id]: f })));
      replace(await api.completeDeliverableUpload(id));
    } catch (e) {
      fail(e, t("videoExtras.uploadFailed"));
      onChange((x) => ({ ...x, deliverables: x.deliverables.map((d) => (d.id === id && d.status === "uploading" ? { ...d, status: "missing" } : d)) }));
    } finally {
      setProgress((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    }
  }

  async function download(id: string) {
    try {
      const { url } = await api.deliverableDownloadUrl(id);
      const a = document.createElement("a");
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      fail(e, t("videoExtras.failed"));
    }
  }

  async function remove(id: string) {
    const before = extras;
    onChange((x) => ({ ...x, deliverables: x.deliverables.filter((d) => d.id !== id) }));
    try {
      await api.deleteDeliverable(id);
    } catch (e) {
      onChange(() => before);
      fail(e, t("videoExtras.failed"));
    }
  }

  const dropProps = (id: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        e.stopPropagation();
        setDropOn(id);
      }
    },
    onDragLeave: () => setDropOn((cur) => (cur === id ? null : cur)),
    onDrop: (e: React.DragEvent) => {
      const file = e.dataTransfer.files?.[0];
      setDropOn(null);
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      void upload(id, file);
    },
  });

  const chip = "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-medium tracking-[-0.01em] transition-colors";

  return (
    <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f && target.current) void upload(target.current, f);
        }}
      />
      {mainFormat && (
        <span className={cn(chip, "bg-emerald-500/15 text-emerald-300")} title={t("videoFassungen.main")}>
          ✓ {mainFormat}
        </span>
      )}
      {deliverables.map((d) => {
        const p = progress[d.id];
        if (p !== undefined || d.status === "uploading") {
          return (
            <span key={d.id} className={cn(chip, "relative overflow-hidden bg-white/[0.08] text-white/80")}>
              <span className="absolute inset-y-0 left-0 bg-[#0a84ff]/40 transition-[width] duration-150" style={{ width: `${Math.round((p ?? 0) * 100)}%` }} />
              <span className="relative">
                ⬆ {d.label} {p !== undefined ? `${Math.round(p * 100)}%` : ""}
              </span>
            </span>
          );
        }
        if (d.status !== "ready") {
          return (
            <button
              key={d.id}
              type="button"
              {...dropProps(d.id)}
              onClick={() => pick(d.id)}
              title={t("videoFassungen.missingHint")}
              className={cn(
                chip,
                "border border-dashed",
                dropOn === d.id ? "border-[#0a84ff] bg-[#0a84ff]/20 text-white" : "border-white/30 text-white/70 hover:border-white/60 hover:text-white"
              )}
            >
              ⬆ {d.label}
            </button>
          );
        }
        return (
          <span key={d.id} {...dropProps(d.id)}>
            <Menu
              align="start"
              portal
              trigger={
                <button type="button" className={cn(chip, dropOn === d.id ? "bg-[#0a84ff]/30 text-white" : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25")} title={d.original_filename ?? d.label}>
                  ✓ {d.label}
                </button>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      close();
                      void download(d.id);
                    }}
                  >
                    ⬇ {t("videoExtras.download")}
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      close();
                      pick(d.id);
                    }}
                  >
                    ⬆ {t("videoExtras.replace")}
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      close();
                      void remove(d.id);
                    }}
                  >
                    {t("videoExtras.deletePoint")}
                  </MenuItem>
                </>
              )}
            </Menu>
          </span>
        );
      })}
      <Menu
        align="start"
        portal
        trigger={
          <button type="button" className={cn(chip, "text-[#0a84ff] hover:bg-[#0a84ff]/10")}>
            + {t("videoFassungen.add")}
          </button>
        }
      >
        {(close) => (
          <>
            {PRESETS.filter((p) => !existing.has(p.toLowerCase())).map((p) => (
              <MenuItem
                key={p}
                onClick={() => {
                  close();
                  void add(p);
                }}
              >
                {p}
              </MenuItem>
            ))}
            {onOpenMore && (
              <MenuItem
                onClick={() => {
                  close();
                  onOpenMore();
                }}
              >
                <span className="text-white/60">{t("videoFassungen.more")}</span>
              </MenuItem>
            )}
          </>
        )}
      </Menu>
    </div>
  );
}

/** "16:9" / "9:16" / "1:1" / "4:5" for a frame ratio, null if it's none of those */
export function formatOfRatio(r: number | null | undefined): string | null {
  if (!r) return null;
  const known: [string, number][] = [["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:5", 4 / 5], ["4:3", 4 / 3], ["21:9", 21 / 9]];
  const hit = known.find(([, v]) => Math.abs(v - r) / v < 0.04);
  return hit ? hit[0] : null;
}
