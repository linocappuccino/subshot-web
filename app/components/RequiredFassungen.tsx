"use client";

import { useEffect, useState } from "react";
import { Menu, MenuItem } from "./ui/Menu";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

// 2026-10-12, Lino: "man muss im vorhinein irgendwo definieren können welche fassungen benötigt werden"
// → "Beides (gleiche Vorgabe)": the project's required Fassungen, editable in the project info AND on
// the Postproduction page (same list, backend: /projects/{id}/deliverable-defaults). Every video gets
// them as open chips automatically; removing one only drops it where nothing was uploaded yet.

const PRESETS = ["16:9", "9:16", "1:1", "4:5", "Cutdown 30s", "Cutdown 15s", "Cutdown 6s", "Ohne Untertitel", "Mit Untertitel"];

export function RequiredFassungen({
  projectId,
  editable,
  onSaved,
  compact,
}: {
  projectId: string;
  editable: boolean;
  /** after a change (the videos' chips changed on the server) */
  onSaved?: () => void;
  /** a single row without the heading (Postproduction toolbar) */
  compact?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [labels, setLabels] = useState<string[] | null>(null);
  const [custom, setCustom] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .deliverableDefaults(projectId)
      .then((r) => alive && setLabels(r.labels))
      .catch(() => alive && setLabels([]));
    // the other place (project info ↔ Postproduction) may have changed it
    const onMutated = () => api.deliverableDefaults(projectId).then((r) => alive && setLabels(r.labels)).catch(() => {});
    window.addEventListener("subshot:mutated", onMutated);
    return () => {
      alive = false;
      window.removeEventListener("subshot:mutated", onMutated);
    };
  }, [api, projectId]);

  async function save(next: string[]) {
    const before = labels;
    setLabels(next);
    try {
      const r = await api.putDeliverableDefaults(projectId, next);
      setLabels(r.labels);
      onSaved?.();
    } catch (e) {
      setLabels(before);
      toast.showError(e instanceof ApiError ? e.message : t("common.failed"));
    }
  }

  if (labels === null) return null;
  const have = new Set(labels.map((l) => l.toLowerCase()));
  const chip = "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium tracking-[-0.01em]";

  return (
    <div className={cn("[font-family:-apple-system,BlinkMacSystemFont,'SF_Pro_Text',system-ui,sans-serif]", compact ? "flex flex-wrap items-center gap-1.5" : "space-y-1.5")}>
      <div className={cn("text-[11px] font-medium uppercase tracking-[0.06em] text-white/40", compact && "mr-1")}>{t("requiredFassungen.title")}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.length === 0 && !editable && <span className="text-xs text-white/35">–</span>}
        {labels.map((l) => (
          <span key={l} className={cn(chip, "bg-white/[0.08] text-white/85", editable && "pr-1")}>
            {l}
            {editable && (
              <button
                type="button"
                onClick={() => save(labels.filter((x) => x !== l))}
                aria-label={t("requiredFassungen.remove", { label: l })}
                title={t("requiredFassungen.remove", { label: l })}
                className="flex h-5 w-5 items-center justify-center rounded-full text-white/45 hover:bg-white/15 hover:text-white"
              >
                ×
              </button>
            )}
          </span>
        ))}
        {editable &&
          (custom !== null ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = custom.trim();
                setCustom(null);
                if (v && !have.has(v.toLowerCase())) void save([...labels, v]);
              }}
            >
              <input
                autoFocus
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onBlur={(e) => {
                  const v = e.currentTarget.value.trim();
                  setCustom(null);
                  if (v && !have.has(v.toLowerCase())) void save([...labels, v]);
                }}
                onKeyDown={(e) => e.key === "Escape" && setCustom(null)}
                maxLength={80}
                placeholder={t("requiredFassungen.customPlaceholder")}
                className="h-7 w-44 rounded-full bg-white/[0.08] px-3 text-[12px] text-white outline-none ring-1 ring-[#0a84ff]/60 placeholder:text-white/35"
              />
            </form>
          ) : (
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
                  {PRESETS.filter((p) => !have.has(p.toLowerCase())).map((p) => (
                    <MenuItem
                      key={p}
                      onClick={() => {
                        close();
                        void save([...labels, p]);
                      }}
                    >
                      {p}
                    </MenuItem>
                  ))}
                  <MenuItem
                    onClick={() => {
                      close();
                      setCustom("");
                    }}
                  >
                    <span className="text-white/60">{t("requiredFassungen.custom")}</span>
                  </MenuItem>
                </>
              )}
            </Menu>
          ))}
      </div>
      {!compact && editable && <p className="text-xs text-white/35">{t("requiredFassungen.hint")}</p>}
    </div>
  );
}
