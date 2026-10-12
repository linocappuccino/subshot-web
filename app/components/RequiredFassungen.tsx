"use client";

import { useEffect, useState } from "react";
import { Menu, MenuItem } from "./ui/Menu";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

// 2026-10-12, Lino: "man muss im vorhinein irgendwo definieren können welche fassungen benötigt werden"
// then "es wird nicht immer von jedem video / idee die gleiche fassung verlangt" — the required
// Fassungen of ONE idea (backend /ideas/{id}/deliverable-defaults): on "Abgenommen" they go to its
// section, every video there gets them as open chips; removing one only drops it where nothing was
// uploaded yet. Per video, more are added right on the Postproduction tile.

const PRESETS = ["16:9", "9:16", "1:1", "4:5", "Cutdown 30s", "Cutdown 15s", "Cutdown 6s", "Ohne Untertitel", "Mit Untertitel"];

export function RequiredFassungen({
  ideaId,
  editable,
  onSaved,
  compact,
  onLabels,
}: {
  ideaId: string;
  editable: boolean;
  /** after a change (the videos' chips changed on the server) */
  onSaved?: () => void;
  /** a single row without the heading */
  compact?: boolean;
  /** the saved list (e.g. for a summary next to the trigger) */
  onLabels?: (labels: string[]) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [labels, setLabels] = useState<string[] | null>(null);
  const [custom, setCustom] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .ideaDeliverableDefaults(ideaId)
      .then((r) => alive && setLabels(r.labels))
      .catch(() => alive && setLabels([]));
    return () => {
      alive = false;
    };
  }, [api, ideaId]);

  async function save(next: string[]) {
    const before = labels;
    setLabels(next);
    try {
      const r = await api.putIdeaDeliverableDefaults(ideaId, next);
      onLabels?.(r.labels);
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

/** the idea window's header pill: "Fassungen · 16:9, 9:16" — click opens the editor in a popover */
export function IdeaFassungenButton({ ideaId, editable }: { ideaId: string; editable: boolean }) {
  const api = useApi();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .ideaDeliverableDefaults(ideaId)
      .then((r) => alive && setLabels(r.labels))
      .catch(() => alive && setLabels([]));
    return () => {
      alive = false;
    };
  }, [api, ideaId]);

  if (labels === null || (!editable && labels.length === 0)) return null;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={labels.length ? labels.join(", ") : undefined}
        className={cn(
          "flex h-9 max-w-[240px] items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-semibold transition-colors",
          open ? "bg-white/20 text-white" : "bg-white/10 text-white/80 hover:bg-white/15"
        )}
      >
        <span aria-hidden>🎬</span>
        {t("requiredFassungen.button")}
        <span className={cn("truncate font-medium", labels.length ? "text-white/60" : "text-[#0a84ff]")}>· {labels.length ? labels.join(", ") : t("requiredFassungen.none")}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-[320px] rounded-2xl bg-[#1c1c1e]/95 p-4 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] ring-1 ring-inset ring-white/10 backdrop-blur-xl">
            <RequiredFassungen ideaId={ideaId} editable={editable} onLabels={setLabels} />
          </div>
        </>
      )}
    </div>
  );
}
