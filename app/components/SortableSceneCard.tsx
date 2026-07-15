"use client";

import { useSortable } from "@dnd-kit/sortable";
import type { Annotation, Member, Scene, Shot } from "@/lib/types";
import { SceneCard } from "./SceneCard";
import { ProjectInfoTile } from "./ProjectInfoTile";

/** Wraps SceneCard (or ProjectInfoTile, for scene.is_project_info tiles)
 * with dnd-kit's useSortable, exposing a dedicated grip handle (not the
 * whole card) as the drag source — the card also nests its own shot-list
 * drag handles (see SceneCard/SortableShotRow), and a whole-card drag
 * source would fight with those over the same pointerdown event bubbling
 * up through the DOM. A single small handle avoids that entirely and still
 * keeps every button/menu/input on the card clickable. */
export function SortableSceneCard({
  scene,
  shots,
  members,
  onEdit,
  onDelete,
  onDuplicate,
  onChange,
  onOpenTeam,
  insertionEdge,
  dragDisabled,
  annotations,
  highlightedAnnotationId,
  onAnnotationClick,
}: {
  scene: Scene;
  shots: Shot[];
  members: Member[];
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate?: () => void;
  onChange: (updater: (data: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  onOpenTeam: () => void;
  /** Notion-style insertion indicator — a thin blue line showing exactly
   * where the dragged card would land if dropped right now. See page.tsx's
   * insertionIndicator state. Grid drags normally produce "left"/"right"
   * (this card sits beside a same-row neighbor); "top"/"bottom" happen in
   * table view, AND in grid view whenever this card is the full-width
   * Projektinfo tile (col-span-full — no left/right neighbor to straddle). */
  insertionEdge?: "left" | "right" | "top" | "bottom" | null;
  /** 2026-07-14, comment mode (see page.tsx's showAnnotations) — "man kann
   * in diesem modus keine kacheln verschieben", passed straight to
   * useSortable's own disabled option. */
  dragDisabled?: boolean;
  annotations?: Annotation[];
  highlightedAnnotationId?: string | null;
  onAnnotationClick?: (a: Annotation) => void;
}) {
  // transform/transition deliberately NOT applied to the style below —
  // dnd-kit's useSortable computes them via rectSortingStrategy to shift
  // EVERY sibling toward its predicted post-drop position, which is exactly
  // the built-in "cards reflow to make way" behavior this app replaced with
  // the insertion-line-only design (see handleSceneDragOver's comment in
  // page.tsx). Removing the custom reflow logic alone (done 2026-07-10)
  // didn't actually turn this off — dnd-kit's own transform kept nudging
  // cards independently of that, which is what made the insertion line
  // "not match where it lands" (Lino, 2026-07-10): the line's position was
  // computed against a card rect that dnd-kit was ALSO silently moving out
  // from under it. isDragging/opacity is all this card needs — the actual
  // "am I being dragged" visual is the separate DragOverlay copy.
  // data.sectionId lets page.tsx's sceneCollisionDetection scope a drag to
  // only the section the pointer is currently over — see its own comment
  // for why (cross-section boundary ambiguity, 2026-07-15).
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({
    id: scene.id,
    disabled: dragDisabled,
    data: { sectionId: scene.section_id ?? null },
  });

  return (
    <div
      ref={setNodeRef}
      data-sortable-scene-id={scene.id}
      className={`relative ${scene.is_project_info ? "col-span-full" : ""}`}
      style={{ opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 10 : "auto" }}
    >
      {insertionEdge === "left" && (
        <div className="absolute -left-[9px] top-0 bottom-0 w-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none" />
      )}
      {insertionEdge === "right" && (
        <div className="absolute -right-[9px] top-0 bottom-0 w-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none" />
      )}
      {/* top/bottom only ever fires for this card when it's the full-width
          Projektinfo tile (see handleSceneDragOver in page.tsx) — the bar
          spans the tile's whole width to match, not a fixed 3px edge marker
          like left/right (which sit on a normal-width neighbor). */}
      {insertionEdge === "top" && (
        <div className="absolute -top-[9px] left-0 right-0 h-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none" />
      )}
      {insertionEdge === "bottom" && (
        <div className="absolute -bottom-[9px] left-0 right-0 h-[3px] rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.7)] pointer-events-none" />
      )}
      {scene.is_project_info ? (
        <ProjectInfoTile
          scene={scene}
          members={members}
          onDelete={onDelete}
          onChange={onChange}
          onOpenTeam={onOpenTeam}
          dragHandleProps={{ attributes, listeners }}
        />
      ) : (
        <SceneCard
          scene={scene}
          shots={shots}
          members={members}
          onEdit={onEdit}
          onDelete={onDelete}
          onDuplicate={onDuplicate}
          onChange={onChange}
          dragHandleProps={{ attributes, listeners }}
          annotations={annotations}
          highlightedAnnotationId={highlightedAnnotationId}
          onAnnotationClick={onAnnotationClick}
        />
      )}
    </div>
  );
}
