"use client";

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/board";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";

// 2026-10-12, Lino: "Projekt-Archiv — nach Ablauf das gesamte Projekt als ZIP herunterladen und auf
// dem eigenen Server ablegen, Ordner wie die Pipeline". The server streams the ZIP (any size, no
// temp files) — the browser just saves it like any download, via a signed 1-hour link.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export function ProjectArchiveCard({ projectId, highlight }: { projectId: string; highlight?: boolean }) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ bytes: number; files: number } | null>(null);

  async function download() {
    setBusy(true);
    try {
      const { path, estimated_bytes, files } = await api.projectArchiveLink(projectId);
      setLast({ bytes: estimated_bytes, files });
      const a = document.createElement("a");
      a.href = `${API_BASE}${path}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast.showSuccess(t("archive.started"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("archive.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`rounded-2xl border p-5 mb-6 ${highlight ? "border-amber-400/40 bg-amber-400/[0.06]" : "border-white/8 bg-white/[0.03]"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-sm font-semibold text-white mb-1">{t("archive.title")}</h2>
          <p className="text-xs leading-relaxed text-white/50">{highlight ? t("archive.hintExpired") : t("archive.hint")}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-white/35 font-mono">
            01 Ideen – Konzept · 02 Script – Shotlist · 03 Postproduction · 04 Deliver · 05 Rohdaten · 06 Assets
          </p>
          {last && (
            <p className="mt-2 text-xs text-white/45">
              {t("archive.size", { files: last.files, size: formatBytes(last.bytes) || "0 KB" })}
            </p>
          )}
        </div>
        <Button variant={highlight ? "primary" : "secondary"} size="sm" onClick={download} disabled={busy}>
          {busy ? t("archive.preparing") : t("archive.download")}
        </Button>
      </div>
    </div>
  );
}
