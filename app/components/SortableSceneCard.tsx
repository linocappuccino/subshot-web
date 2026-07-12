"use client";

import { useSortable } from "@dnd-kit/sortable";
import type { Member, Scene, Shot } from "@/lib/types";
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
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: scene.id });

  return (
    <div
      ref={setNodeRef}
      data-sortable-scene-id={scene.id}
      className={`relative ${scene.is_project_info ? "col-span-full" : ""}`}
      style={{ opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 10 : "auto" }}
    >
      {/* Thickened + much brighter/wider glow (was w-[3px], shadow blur
          8px) — Lino reported the indicator as "never shown" specifically
          when dragging a card past the outer edge of a 3-card row: it DID
          render (confirmed via screenshot), but a thin 3px line can end up
          ~100px+ away from the actual cursor/dragged-card ghost once
          you're past the row's own edge, which during a real fast drag is
          easy to miss entirely since your eyes are on the cursor, not
          scanning the screen for a thin line elsewhere (2026-07-13). Also
          extends slightly past the card's own top/bottom (-6/-6 instead of
          0/0) so it visually "pops" out of the row instead of blending
          into two card edges meeting flush. Deliberately still a thin BAR,
          not a ring around the whole card — an earlier ring-highlight
          attempt was rejected (see project memory): it reads as "drop
          ONTO this card" rather than "insert before/after it". */}
      {insertionEdge === "left" && (
        <div className="absolute -left-[11px] -top-1.5 -bottom-1.5 w-[5px] rounded-full bg-blue-400 shadow-[0_0_20px_6px_rgba(59,130,246,0.85)] pointer-events-none" />
      )}
      {insertionEdge === "right" && (
        <div className="absolute -right-[11px] -top-1.5 -bottom-1.5 w-[5px] rounded-full bg-blue-400 shadow-[0_0_20px_6px_rgba(59,130,246,0.85)] pointer-events-none" />
      )}
      {/* top/bottom only ever fires for this card when it's the full-width
          Projektinfo tile (see handleSceneDragOver in page.tsx) — the bar
          spans the tile's whole width to match, not a fixed edge marker
          like left/right (which sit on a normal-width neighbor). */}
      {insertionEdge === "top" && (
        <div className="absolute -top-[11px] -left-1.5 -right-1.5 h-[5px] rounded-full bg-blue-400 shadow-[0_0_20px_6px_rgba(59,130,246,0.85)] pointer-events-none" />
      )}
      {insertionEdge === "bottom" && (
        <div className="absolute -bottom-[11px] -left-1.5 -right-1.5 h-[5px] rounded-full bg-blue-400 shadow-[0_0_20px_6px_rgba(59,130,246,0.85)] pointer-events-none" />
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
        />
      )}
    </div>
  );
}
