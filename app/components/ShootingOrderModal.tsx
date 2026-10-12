"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Scene, ShootingOrderStats, ShootingOrderSuggestion } from "@/lib/types";

// 2026-10-12, Lino: "Drehreihenfolge optimieren — ein Knopf schlägt eine Reihenfolge vor: gleiche
// Location, gleiche Linse und gleicher Lichtaufbau zusammen, Aussenszenen im passenden Licht".
// No AI: the server (app/shooting_order.py) groups by location, light keywords, rig and lens.
// Read-only until "Übernehmen", which the page saves as the section's Shot-Reihenfolge.

const LIGHT_ICON: Record<string, string> = { morning: "🌅", evening: "🌇", night: "🌙" };

export function ShootingOrderModal({
  open,
  onClose,
  sectionId,
  scenes,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  sectionId: string | null;
  scenes: Scene[];
  onApply: (orderedSceneIds: string[]) => Promise<void>;
}) {
  const api = useApi();
  const { t } = useLanguage();
  const [result, setResult] = useState<{ sectionId: string; data: ShootingOrderSuggestion | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !sectionId) return;
    let alive = true;
    api
      .suggestShootingOrder(sectionId)
      .then((data) => alive && setResult({ sectionId, data }))
      .catch(() => alive && setResult({ sectionId, data: null }));
    return () => {
      alive = false;
    };
  }, [api, sectionId, open]);

  const byId = new Map(scenes.map((s) => [s.id, s]));
  const shown = result && result.sectionId === sectionId ? result : null;
  const s = shown?.data ?? null;

  async function apply() {
    if (!s) return;
    setBusy(true);
    try {
      await onApply(s.order);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const label = (id: string) => {
    const sc = byId.get(id);
    return sc ? `${!sc.is_intermediate_step && sc.number ? `${sc.number}${sc.letter ?? ""} · ` : ""}${sc.name || "–"}` : "–";
  };

  const tag = (id: string) => {
    const info = s?.scenes[id];
    if (!info) return null;
    const bits = [info.place === "ext" ? "EXT" : info.place === "int" ? "INT" : "", LIGHT_ICON[info.light] ?? "", info.rig, info.lenses.join(" / ")].filter(Boolean);
    return bits.length ? <span className="ml-1.5 text-[11px] text-white/40">{bits.join(" · ")}</span> : null;
  };

  const metric = (key: keyof ShootingOrderStats, name: string) => {
    if (!s) return null;
    const a = s.before[key];
    const b = s.after[key];
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <div className="text-[11px] text-white/45">{name}</div>
        <div className="tabular-nums text-sm text-white">
          <span className="text-white/50">{a}</span> → <b className={cn(b < a ? "text-emerald-400" : b > a ? "text-amber-300" : "text-white")}>{b}</b>
        </div>
      </div>
    );
  };

  return (
    <Modal open={open} onClose={onClose} title={t("optimize.title")} wide>
      {!shown ? (
        <p className="text-sm text-white/50 animate-pulse">{t("common.loading")}</p>
      ) : !s ? (
        <p className="text-sm text-red-300">{t("optimize.failed")}</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-white/50">{t("optimize.intro")}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {metric("location_changes", t("optimize.locations"))}
            {metric("km", t("optimize.km"))}
            {metric("rig_changes", t("optimize.rigs"))}
            {metric("lens_changes", t("optimize.lenses"))}
          </div>
          {!s.changed ? (
            <p className="text-sm text-emerald-300">{t("optimize.already")}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ["current", s.current],
                  ["proposed", s.order],
                ] as const
              ).map(([kind, ids]) => (
                <div key={kind} className="overflow-hidden rounded-xl border border-white/10">
                  <div className="border-b border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white/70">{t(`optimize.${kind}`)}</div>
                  <ol className="text-sm">
                    {ids.map((id, i) => {
                      const sc = byId.get(id);
                      const reasons = kind === "proposed" ? s.reasons[id] ?? [] : [];
                      return (
                        <li key={id} className={cn("border-b border-white/6 px-3 py-1.5 last:border-0", sc?.is_intermediate_step && "bg-white/[0.03] text-white/60")}>
                          <span className="mr-2 inline-block w-5 tabular-nums text-white/35">{i + 1}.</span>
                          <span className="text-white">{label(id)}</span>
                          {tag(id)}
                          {sc?.location_address && <div className="ml-7 truncate text-[11px] text-white/40">📍 {sc.location_address}</div>}
                          {reasons.length > 0 && (
                            <div className="ml-7 mt-0.5 flex flex-wrap gap-1">
                              {reasons.map((r) => (
                                <span key={r} className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                  {t(`optimize.r.${r}` as Parameters<typeof t>[0])}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            {s.changed && (
              <Button variant="primary" size="sm" onClick={apply} disabled={busy}>
                {busy ? t("common.loading") : t("optimize.apply")}
              </Button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
