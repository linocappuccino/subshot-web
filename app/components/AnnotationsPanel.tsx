"use client";

import { useMemo, useState } from "react";
import { Pill } from "./ui/Badge";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/Toast";
import { useLanguage } from "@/lib/i18n";
import type { Annotation, Scene } from "@/lib/types";

const STATUS_TONES: Record<Annotation["status"], "default" | "good" | "danger"> = {
  // "draft" never actually reaches this panel (list_project_annotations
  // filters it out server-side, same as list_idea_feedback's status=="sent"
  // filter) — included here only so the type checker is happy about
  // Annotation["status"] now allowing it (see that field's own doc comment
  // in lib/types.ts).
  draft: "default",
  open: "default",
  resolved: "good",
  rejected: "danger",
};

/** Reviewer comments/markups (2026-07-13 on the public preview page, now
 * also here in the logged-in app — 2026-07-14, Lino: "soll rechts am
 * browserrand die leiste mit den kommentaren sein... die markierungen
 * sollen auf der seite gezeigt werden... klickt man auf eine kommentar in
 * der leiste wird die markierung auf der seite gehighlighted"). A
 * right-docked panel rather than a centered Modal — no backdrop, since the
 * whole point is to keep interacting with the page (clicking a markup
 * directly) WHILE this is open, not block it. Only closes via its own ×
 * or re-toggling the "Kommentare" button, never click-outside (that would
 * fire on every markup click). */
export function AnnotationsPanel({
  open,
  onClose,
  annotations,
  onChange,
  scenes,
  highlightedAnnotationId,
  onSelect,
  canDelete,
}: {
  open: boolean;
  onClose: () => void;
  /** Owned by the project page (fetched alongside project/members, kept
   * fresh by the same 12s poll) — this panel is a view + status-mutator
   * over that shared state, not its own data source, so the toolbar
   * badge count and the panel's list never disagree. */
  annotations: Annotation[];
  onChange: (updater: (annotations: Annotation[]) => Annotation[]) => void;
  scenes: Scene[];
  highlightedAnnotationId?: string | null;
  /** Pulses the matching markup on the page and scrolls it into view —
   * see page.tsx's handleAnnotationSelect. */
  onSelect?: (annotation: Annotation) => void;
  /** 2026-09-08, Lino: "man darf NUR eingeloggt kommentare löschen können!
   * und das auch nur als admin" — page.tsx's own isTeamAdmin/myRole
   * === "owner" check, UI-only (the DELETE endpoint enforces the real
   * permission itself), just hides a button that would otherwise 403. */
  canDelete: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [filter, setFilter] = useState<"open" | "all">("open");

  const STATUS_LABELS: Record<Annotation["status"], string> = {
    draft: "",
    open: t("annotationsPanel.statusOpen"),
    resolved: t("annotationsPanel.statusResolved"),
    rejected: t("annotationsPanel.statusRejected"),
  };

  // 2026-09-08 (functional audit finding, MEDIUM) — this used to always
  // render scene.number/letter, the old stable screenplay-style id
  // replaced everywhere a scene tile itself renders (SceneCard.tsx,
  // SceneTable.tsx, PublicSceneCard.tsx) by a LIVE position-in-section
  // count (see sceneNumberBySectionId in projects/[id]/page.tsx's own doc
  // comment) — a pill here could show "3B" while the tile it links to now
  // shows "4". Same computation, scoped to just the `scenes` this panel
  // already receives.
  const sceneNumberById = useMemo(() => {
    const bySection = new Map<string | null, Scene[]>();
    for (const s of scenes) {
      if (!bySection.has(s.section_id)) bySection.set(s.section_id, []);
      bySection.get(s.section_id)!.push(s);
    }
    const map = new Map<string, number>();
    for (const list of bySection.values()) {
      [...list].sort((a, b) => a.sort_order - b.sort_order).forEach((s, i) => map.set(s.id, i + 1));
    }
    return map;
  }, [scenes]);

  function sceneLabel(scene: Scene | undefined): string {
    if (!scene) return "";
    const liveNumber = sceneNumberById.get(scene.id);
    if (liveNumber != null) return t("annotationsPanel.sceneLabel", { number: liveNumber });
    return `${t("annotationsPanel.sceneLabel", { number: scene.number })}${scene.letter || ""}`;
  }

  async function setStatus(annotation: Annotation, status: "open" | "resolved" | "rejected") {
    try {
      const updated = await api.patchAnnotation(annotation.id, status);
      onChange((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("annotationsPanel.updateFailed"));
    }
  }

  // 2026-09-08, Lino: "als admin muss man kommentare auch löschen können
  // egal was für einen status sie haben" — same two-step "tap again to
  // confirm" pattern the public preview sidebars already use for the same
  // action (PublicAnnotationsSidebar/PublicSectionComments), works
  // regardless of a.status (open/resolved/rejected all show the button).
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  async function handleDelete(annotation: Annotation) {
    if (confirmingDeleteId !== annotation.id) {
      setConfirmingDeleteId(annotation.id);
      setTimeout(() => setConfirmingDeleteId((cur) => (cur === annotation.id ? null : cur)), 4000);
      return;
    }
    setConfirmingDeleteId(null);
    try {
      await api.deleteAnnotation(annotation.id);
      onChange((prev) => prev.filter((a) => a.id !== annotation.id));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("annotationsPanel.updateFailed"));
    }
  }

  // 2026-07-15, Lino: "erledigte und abgelehnte kommentare müssen in der
  // liste immer nach unten wandern" — open items first (newest first,
  // same as before), resolved/rejected always sink below them regardless
  // of date, in the "Alle" filter (the "Offen" filter never shows them at
  // all, unaffected either way).
  const sorted = [...annotations].sort((a, b) => {
    const aOpen = a.status === "open" ? 0 : 1;
    const bOpen = b.status === "open" ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const shown = filter === "open" ? sorted.filter((a) => a.status === "open") : sorted;
  const openCount = annotations.filter((a) => a.status === "open").length;

  if (!open) return null;
  return (
        <div className="fixed right-0 top-0 bottom-0 z-40 w-[380px] max-w-[90vw] bg-[#1c1c1e] border-l border-white/10 shadow-2xl flex flex-col">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-white/8 shrink-0">
            <h2 className="text-sm font-semibold">{t("annotationsPanel.title")}</h2>
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              aria-label={t("annotationsPanel.closeAria")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex gap-2 px-4 pt-3">
            <button
              onClick={() => setFilter("open")}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                filter === "open" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {t("annotationsPanel.filterOpen", { count: openCount })}
            </button>
            <button
              onClick={() => setFilter("all")}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors ${
                filter === "all" ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {t("annotationsPanel.filterAll", { count: annotations.length })}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {shown.length === 0 && (
              <p className="text-sm text-white/40">
                {filter === "open" ? t("annotationsPanel.noOpenComments") : t("annotationsPanel.noCommentsYet")}
              </p>
            )}
            {shown.map((a) => {
              const scene = scenes.find((s) => s.id === a.scene_id);
              return (
                <div
                  key={a.id}
                  onClick={() => onSelect?.(a)}
                  className={`rounded-2xl bg-white/5 border p-3.5 cursor-pointer transition-colors hover:bg-white/[0.08] ${
                    highlightedAnnotationId === a.id ? "border-blue-500/60 bg-blue-500/[0.08]" : "border-white/10"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="text-sm font-medium truncate">{a.author_name}</span>
                      <Pill tone="default">
                        {a.kind === "pen" ? t("annotationsPanel.kindSketch") : a.kind === "comment" ? t("annotationsPanel.kindComment") : t("annotationsPanel.kindHighlight")}
                      </Pill>
                      {scene && <Pill tone="default">{sceneLabel(scene)}</Pill>}
                      <Pill tone={STATUS_TONES[a.status]}>{STATUS_LABELS[a.status]}</Pill>
                    </div>
                    {/* Date-only before (2026-07-15, Lino: "es braucht
                        überall auch eine datum UND zeit information zu
                        jedem kommentar") -- added the time too. */}
                    {/* 2026-07-15, Lino: "die Sachen müssen ein bisschen
                        besser leserlich sein... auch für den Zeitstempel" —
                        /30 read as too dim against the dark panel. */}
                    <span className="text-[11px] text-white/50 shrink-0">
                      {new Date(a.created_at).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                      {" "}
                      {new Date(a.created_at).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  {a.text && <p className="text-xs text-white/65 italic mb-1 break-words">„{a.text}“</p>}
                  {a.comment && (
                    <p className={`text-sm text-white/85 break-words ${a.status === "resolved" ? "line-through decoration-white/40 text-white/50" : ""}`}>
                      {a.comment}
                    </p>
                  )}
                  {/* 2026-07-26 (#330) — who triaged this, small/greyed like
                      every other resolved-by hint in this app (see
                      IdeaFeedbackPanel's formatEntryDate line). */}
                  {a.status !== "open" && a.resolved_by_name && (
                    <p className="text-[11px] text-white/40 mt-1">
                      {a.status === "rejected" ? "✗" : "✓"} {a.resolved_by_name}
                    </p>
                  )}
                  <div className="flex gap-2 mt-2.5" onClick={(e) => e.stopPropagation()}>
                    {a.status !== "resolved" && (
                      <button
                        onClick={() => setStatus(a, "resolved")}
                        className="text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        {t("annotationsPanel.resolve")}
                      </button>
                    )}
                    {a.status !== "rejected" && (
                      <button
                        onClick={() => setStatus(a, "rejected")}
                        className="text-xs font-medium text-red-400/80 hover:text-red-400 transition-colors"
                      >
                        {t("annotationsPanel.reject")}
                      </button>
                    )}
                    {a.status !== "open" && (
                      <button
                        onClick={() => setStatus(a, "open")}
                        className="text-xs font-medium text-white/40 hover:text-white/70 transition-colors"
                      >
                        {t("annotationsPanel.reopen")}
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => handleDelete(a)}
                        title={confirmingDeleteId === a.id ? t("publicAnnotationsSidebar.clickAgainToDelete") : undefined}
                        className="text-xs font-medium text-red-400/60 hover:text-red-400 transition-colors ml-auto"
                      >
                        {confirmingDeleteId === a.id ? t("publicAnnotationsSidebar.clickAgainToDelete") : t("common.delete")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
  );
}
