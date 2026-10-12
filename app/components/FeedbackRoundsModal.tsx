"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/cn";

// 2026-10-12, Lino: "Feedback-Runden zählen — «Runde 2 von 3» mit vereinbarter Grenze. Nur intern
// sichtbar, der Kunde sieht das nie." A round = a version the client sent feedback on ("Feedback
// senden" in the preview). The agreed number is set per video or as the project default.

export function roundTone(used: number, limit: number | null): "ok" | "full" | "over" {
  if (limit === null) return "ok";
  return used > limit ? "over" : used === limit ? "full" : "ok";
}

export function FeedbackRoundsModal({
  open,
  onClose,
  title,
  used,
  versions,
  ownLimit,
  defaultLimit,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  used: number;
  versions: number[];
  ownLimit: number | null;
  defaultLimit: number | null;
  onSave: (limit: number | null, scope: "video" | "project") => Promise<void>;
}) {
  const { t } = useLanguage();
  const [limit, setLimit] = useState<number>(ownLimit ?? defaultLimit ?? 2);
  const [saving, setSaving] = useState(false);
  const effective = ownLimit ?? defaultLimit;
  const tone = roundTone(used, effective);
  async function save(scope: "video" | "project", value: number | null) {
    setSaving(true);
    try {
      await onSave(value, scope);
      onClose();
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal open={open} onClose={onClose} title={t("rounds.title", { title })}>
      <div className="space-y-5">
        <div className={cn("rounded-xl border px-4 py-3", tone === "over" ? "border-red-500/50 bg-red-500/10" : tone === "full" ? "border-amber-400/50 bg-amber-400/10" : "border-white/10 bg-white/[0.03]")}>
          <p className="text-2xl font-semibold tabular-nums text-white">
            {effective !== null ? t("rounds.usedOf", { used, limit: effective }) : t("rounds.usedOnly", { used })}
          </p>
          <p className="mt-1 text-xs text-white/50">
            {versions.length ? t("rounds.versions", { list: versions.map((v) => `V${v}`).join(", ") }) : t("rounds.none")}
          </p>
          {tone === "full" && <p className="mt-2 text-sm text-amber-300">{t("rounds.full")}</p>}
          {tone === "over" && <p className="mt-2 text-sm text-red-300">{t("rounds.over", { n: used - (effective ?? 0) })}</p>}
        </div>
        <p className="text-xs text-white/40">{t("rounds.explain")}</p>
        <div className="flex items-center gap-3">
          <span className="text-sm text-white/70">{t("rounds.agreed")}</span>
          <button type="button" onClick={() => setLimit((l) => Math.max(0, l - 1))} className="h-8 w-8 rounded-full bg-white/10 text-white hover:bg-white/20">
            −
          </button>
          <span className="w-6 text-center text-lg font-semibold tabular-nums text-white">{limit}</span>
          <button type="button" onClick={() => setLimit((l) => Math.min(20, l + 1))} className="h-8 w-8 rounded-full bg-white/10 text-white hover:bg-white/20">
            +
          </button>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {ownLimit !== null && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={() => save("video", null)}>
              {t("rounds.useDefault")}
            </Button>
          )}
          <Button variant="secondary" size="sm" disabled={saving} onClick={() => save("project", limit)}>
            {t("rounds.saveProject")}
          </Button>
          <Button variant="primary" size="sm" disabled={saving} onClick={() => save("video", limit)}>
            {t("rounds.saveVideo")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
