"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  DndContext, type DragEndEvent, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy } from "@dnd-kit/sortable";
import { IdeaTile } from "./IdeaTile";
import { IdeaFocusView } from "./IdeaFocusView";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useApi } from "@/lib/useApi";
import { useToast } from "./ui/Toast";
import { ApiError } from "@/lib/api";
import { useLanguage } from "@/lib/i18n";
import type { Annotation, Idea, Member } from "@/lib/types";

/** 2026-07-17, Lino: "Ideen sollen in Abschnitte unterteilt werden: Idee,
 * 1. Feedback, 2. Feedback, Abgenommen" — exact order he gave, top to
 * bottom (the pipeline's natural progression), each idea falls into exactly
 * one group. */
function buildIdeaStatusGroups(t: ReturnType<typeof useLanguage>["t"]): { label: string; match: (idea: Idea) => boolean }[] {
  return [
    { label: t("ideaGrid.groupIdea"), match: (idea) => idea.status === "open" && idea.feedback_count === 0 },
    { label: t("ideaGrid.groupFeedback1"), match: (idea) => idea.status === "open" && idea.feedback_count === 1 },
    { label: t("ideaGrid.groupFeedback2"), match: (idea) => idea.status === "open" && idea.feedback_count >= 2 },
    { label: t("ideaGrid.groupApproved"), match: (idea) => idea.status === "approved" },
    // 2026-07-19, Lino: "nicht nur Abgenommen, auch ein Abgelehnt Button...
    // legt sie in den Abgelehnt Abschnitt und ignoriert diese Idee für den
    // weiteren Pipeline-Verlauf" — a rejected idea never becomes a
    // Section/Scene (see reject_idea in main.py), just sits here instead.
    { label: t("ideaGrid.groupRejected"), match: (idea) => idea.status === "rejected" },
  ];
}

/** Imperative handle (2026-07-17) — the page-level "+ Hinzufügen" FAB and
 * "Teilen" button live OUTSIDE this component (in page.tsx) but need to
 * act on it: create an idea from the FAB when scrolled to this section,
 * and know this section's own on-screen bounds to decide whether the page
 * is currently "in the Ideen section" at all (see page.tsx's scroll
 * listener). */
export interface IdeaGridHandle {
  createIdea: () => void;
  getBoundingClientRect: () => DOMRect | null;
  /** 2026-07-22 — lets page.tsx jump straight to a specific idea (from the
   * "Kommentare"-sidebar's onSelect, see page.tsx's handleAnnotationSelect)
   * the same way autoOpenIdeaId already does for notifications, but
   * callable on demand instead of only once via a prop/query-param change.
   * No-ops if the id isn't in this grid's own (already-loaded) ideas list. */
  openIdea: (id: string) => void;
}

/** "💡 Ideen" panel — the Planungssektor (2026-07-16), sits above the
 * project's Abschnitte/Sections list. Small reorderable grid overview
 * (Lino confirmed 2026-07-17 this stays as the default view — "im
 * Hintergrund finde ich das Kachel-System schon gut"); clicking a tile or
 * "+ Idee" opens the full-screen focused card (IdeaFocusView) with its own
 * left/right/create navigation — closing it returns here. */
export const IdeaGrid = forwardRef<IdeaGridHandle, {
  projectId: string;
  /** Fired right after an idea's "Abgenommen" creates its Section — the
   * new Section lives in the parent page's own `data.sections`, not
   * anything IdeaGrid holds, so without this the new Section only shows
   * up after a manual reload. */
  onIdeaApproved?: () => void;
  /** 2026-07-18, Lino: "klickt man auf eine Notification soll man direkt
   * zu dieser Seite und Kachel kommen" — set from a `?openIdea=` query
   * param by the parent page. Opens IdeaFocusView on that idea once it's
   * loaded, then calls onAutoOpened so the parent can clear the param
   * (otherwise a page refresh would keep reopening it). */
  autoOpenIdeaId?: string | null;
  onAutoOpened?: () => void;
  /** 2026-07-22 — passed straight through to IdeaFocusView/IdeaFloatingCard,
   * see IdeaFeedbackPanel's own doc comment for what this powers. */
  annotations?: Annotation[];
  highlightedAnnotationId?: string | null;
  onDeleteAnnotation?: (annotation: Annotation) => void;
  /** 2026-07-22, Lino: "die highlight kommentare und normalen kommentare
   * müssen GENAU DAS GLEICHE SYSTEM SEIN" — feedback comments can be
   * ticked off (resolved); highlight-comments now get the exact same
   * checkbox, this bubbles the resulting PATCH'd Annotation back up to
   * page.tsx's own `annotations` state (same "single updated item, not a
   * functional updater" shape IdeaFeedbackPanel's own onUpdated already
   * uses internally for IdeaFeedback). */
  onAnnotationUpdated?: (annotation: Annotation) => void;
  /** 2026-07-27, Todoist #356 — passed straight through to IdeaFocusView/
   * IdeaFloatingCard to gate the "Intern abgenommen/abgelehnt" buttons to
   * Projektleiter/Owner (visible to everyone, clickable only for those). */
  myRole?: Member["role"] | null;
}>(function IdeaGrid({ projectId, onIdeaApproved, autoOpenIdeaId, onAutoOpened, annotations, highlightedAnnotationId, onDeleteAnnotation, onAnnotationUpdated, myRole }, ref) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const IDEA_STATUS_GROUPS = buildIdeaStatusGroups(t);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  // 2026-07-18 (Todoist #210) — 3-Punkte-Menü auf der Kachel selbst
  // (Duplizieren/Löschen), gleiches ConfirmDialog-Pattern wie andere
  // Lösch-Aktionen im Web-App (siehe projects/[id]/page.tsx).
  const [deleteTarget, setDeleteTarget] = useState<Idea | null>(null);

  useEffect(() => {
    api
      .listIdeas(projectId)
      .then(setIdeas)
      .catch((e) => toast.showError(e instanceof ApiError ? e.message : t("ideaGrid.loadFailed")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!autoOpenIdeaId) return;
    const index = ideas.findIndex((i) => i.id === autoOpenIdeaId);
    if (index === -1) return;
    setFocusIndex(index);
    onAutoOpened?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenIdeaId, ideas]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ordered = [...ideas];
    const fromIndex = ordered.findIndex((i) => i.id === active.id);
    const toIndex = ordered.findIndex((i) => i.id === over.id);
    if (fromIndex === -1 || toIndex === -1) return;
    const [moved] = ordered.splice(fromIndex, 1);
    ordered.splice(toIndex, 0, moved);
    setIdeas(ordered);
    try {
      const beforeId = toIndex < ordered.length - 1 ? ordered[toIndex + 1].id : null;
      await api.moveIdea(String(active.id), beforeId);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaGrid.reorderFailed"));
      api.listIdeas(projectId).then(setIdeas).catch(() => {});
    }
  }

  // "Neue Idee" is created immediately (title defaults to "Neue Idee",
  // IdeaFloatingCard selects it so typing replaces it right away) — no
  // separate create dialog anymore, the floating card itself is the
  // create/edit UI (2026-07-17, Lino: "das brauchen wir anders").
  async function createIdea() {
    try {
      const created = await api.createIdea(projectId, t("ideaGrid.newIdeaTitle"), "", ideas.length);
      setIdeas((prev) => {
        const next = [...prev, created];
        setFocusIndex(next.length - 1);
        return next;
      });
      setJustCreatedId(created.id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaGrid.createFailed"));
    }
  }

  useImperativeHandle(ref, () => ({
    createIdea,
    getBoundingClientRect: () => containerRef.current?.getBoundingClientRect() ?? null,
    openIdea: (id: string) => {
      const index = ideas.findIndex((i) => i.id === id);
      if (index !== -1) setFocusIndex(index);
    },
  }));

  function handleUpdated(idea: Idea) {
    const wasApproved = ideas.find((i) => i.id === idea.id)?.status === "approved";
    setIdeas((prev) => prev.map((i) => (i.id === idea.id ? idea : i)));
    if (idea.status === "approved" && !wasApproved) onIdeaApproved?.();
  }

  function handleDeleted(id: string) {
    setIdeas((prev) => prev.filter((i) => i.id !== id));
  }

  async function handleDuplicate(idea: Idea) {
    try {
      const created = await api.duplicateIdea(idea.id);
      // Backend drops the copy right after the original (same sort_order
      // shape as duplicate_scene) — insert at the matching LOCAL index
      // too, not just appended at the end, so the grid doesn't visually
      // jump the copy to the end until the next reload.
      setIdeas((prev) => {
        const index = prev.findIndex((i) => i.id === idea.id);
        const next = [...prev];
        next.splice(index === -1 ? next.length : index + 1, 0, created);
        return next;
      });
      toast.showSuccess(t("ideaGrid.duplicated"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaGrid.duplicateFailed"));
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await api.deleteIdea(deleteTarget.id);
      handleDeleted(deleteTarget.id);
      toast.showSuccess(t("ideaGrid.deleted"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("ideaGrid.deleteFailed"));
    } finally {
      setDeleteTarget(null);
    }
  }

  if (loading) return null;

  return (
    <div className="mb-8" ref={containerRef}>
      {/* 2026-07-17, Lino: "jetzt ist der +idee button 2 mal sichtbar...
          wir brauchen ihn nur einmal... zeige ihn nur unten an" — the
          page-level FAB (see page.tsx) is now the ONLY "+ Idee" trigger;
          this inline one right next to the heading is gone. */}
      <h2 className="text-lg font-semibold flex items-center gap-2 mb-3">{t("ideaGrid.heading")} {ideas.length > 0 && <span className="text-sm text-white/40">({ideas.length})</span>}</h2>

      {ideas.length === 0 ? (
        <p className="text-sm text-white/40">{t("ideaGrid.emptyState")}</p>
      ) : (
        // 2026-07-17, Lino: "ideen sollen in Abschnitte unterteilt werden:
        // Idee, 1. Feedback, 2. Feedback, Abgenommen" — purely a display
        // grouping derived from status/feedback_count (never manually set),
        // so one shared DndContext/SortableContext still spans every idea
        // (drag-and-drop reordering unaffected, same flat sort_order as
        // before) — only the rendering below is split into 4 headed grids.
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ideas.map((i) => i.id)} strategy={rectSortingStrategy}>
            {IDEA_STATUS_GROUPS.map(({ label, match }) => {
              const group = ideas
                .map((idea, i) => ({ idea, i }))
                .filter(({ idea }) => match(idea));
              if (group.length === 0) return null;
              return (
                <div key={label} className="mb-5 last:mb-0">
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2">
                    {label} <span className="text-white/25">({group.length})</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {group.map(({ idea, i }) => (
                      <IdeaTile
                        key={idea.id}
                        idea={idea}
                        onClick={() => setFocusIndex(i)}
                        onDuplicate={() => handleDuplicate(idea)}
                        onDelete={() => setDeleteTarget(idea)}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </SortableContext>
        </DndContext>
      )}

      {focusIndex !== null && (
        <IdeaFocusView
          ideas={ideas}
          index={focusIndex}
          autoFocusTitleId={justCreatedId}
          onIndexChange={setFocusIndex}
          onCreateNext={createIdea}
          onUpdated={handleUpdated}
          onDeleted={(id) => {
            handleDeleted(id);
            setFocusIndex((i) => (i !== null ? Math.min(i, ideas.length - 2) : null));
          }}
          onClose={() => setFocusIndex(null)}
          annotations={annotations}
          highlightedAnnotationId={highlightedAnnotationId}
          onDeleteAnnotation={onDeleteAnnotation}
          onAnnotationUpdated={onAnnotationUpdated}
          myRole={myRole}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("ideaGrid.deleteTitle")}
        message={t("ideaGrid.deleteMessage", { title: deleteTarget?.title ?? "" })}
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
});
