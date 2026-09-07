"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AuthImage } from "./AuthImage";
import { useLanguage } from "@/lib/i18n";
import type { DraggableAttributes } from "@dnd-kit/core";
import type { DraggableSyntheticListeners } from "@dnd-kit/core";
import type { Scene, Shot } from "@/lib/types";

/** 2026-09-07, Lino: "2 sortierfunktionien 1. die Szenenreihenfolge 2.
 * Shotreihenfolge. diese 2 sortierungen kann man unabhäng voneinander
 * sortieren" — flat list of EVERY shot across EVERY scene in one opened
 * Section, in Shot.shooting_order (see that field's own doc comment on
 * Shot in models.py) — the actual filming order, completely independent
 * of the scene-grouped view's sort_order-within-scene. Reordering here
 * never touches which scene a shot belongs to or the scene-grouped view's
 * own order, only this separate field. Same drag pattern SectionBlock's
 * per-scene shot list already uses (SortableShotRow/ShotRowContent in
 * SceneCard.tsx), just flattened across scenes and showing which scene
 * each shot came from since they're now interleaved. */
export function ShotOrderView({
  shots,
  sceneById,
  onReorder,
  onToggleDone,
  onEditShot,
}: {
  /** Already sorted (shooting_order, falling back to (scene.sort_order,
   * shot.sort_order) for shots that don't have one yet) — see the caller,
   * projects/[id]/page.tsx. */
  shots: Shot[];
  sceneById: Map<string, Scene>;
  onReorder: (orderedShotIds: string[]) => void;
  onToggleDone: (shot: Shot) => void;
  onEditShot: (shot: Shot) => void;
}) {
  const { t } = useLanguage();
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  function handleDragEnd(event: DragEndEvent) {
    setDraggingId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = shots.findIndex((s) => s.id === active.id);
    const newIndex = shots.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(shots, oldIndex, newIndex).map((s) => s.id));
  }

  const draggingShot = draggingId ? shots.find((s) => s.id === draggingId) : null;

  if (shots.length === 0) {
    return <p className="text-sm text-white/40 py-10 text-center">{t("shotOrderView.empty")}</p>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(e) => setDraggingId(String(e.active.id))}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <SortableContext items={shots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-1.5">
          {shots.map((shot, i) => (
            <SortableFlatShotRow
              key={shot.id}
              index={i}
              shot={shot}
              scene={shot.scene_id ? sceneById.get(shot.scene_id) : undefined}
              onToggleDone={() => onToggleDone(shot)}
              onEdit={() => onEditShot(shot)}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {draggingShot && (
          <div className="shadow-2xl shadow-black/50 cursor-grabbing rounded-lg overflow-hidden">
            <FlatShotRowContent
              shot={draggingShot}
              scene={draggingShot.scene_id ? sceneById.get(draggingShot.scene_id) : undefined}
              onToggleDone={() => {}}
              onEdit={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SortableFlatShotRow({
  index, shot, scene, onToggleDone, onEdit,
}: {
  index: number;
  shot: Shot;
  scene: Scene | undefined;
  onToggleDone: () => void;
  onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shot.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <FlatShotRowContent
        index={index}
        shot={shot}
        scene={scene}
        onToggleDone={onToggleDone}
        onEdit={onEdit}
        dragHandleProps={{ attributes, listeners }}
      />
    </div>
  );
}

/** Plain presentational row, no useSortable of its own — reused as-is for
 * the DragOverlay's floating clone, same reasoning as ShotRowContent in
 * SceneCard.tsx (two elements can't both claim the same sortable id). */
function FlatShotRowContent({
  index, shot, scene, onToggleDone, onEdit, dragHandleProps,
}: {
  index?: number;
  shot: Shot;
  scene: Scene | undefined;
  onToggleDone: () => void;
  onEdit: () => void;
  dragHandleProps?: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners };
}) {
  const { t } = useLanguage();
  return (
    <div className="flex gap-2 items-center bg-white/[0.03] hover:bg-white/[0.06] rounded-lg p-2 transition-colors">
      {dragHandleProps && (
        <button
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
          className="shrink-0 touch-none text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing"
        >
          <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
            <circle cx="2" cy="2" r="1.4" /><circle cx="2" cy="8" r="1.4" /><circle cx="2" cy="14" r="1.4" />
            <circle cx="9" cy="2" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="9" cy="14" r="1.4" />
          </svg>
        </button>
      )}
      {index != null && <span className="shrink-0 w-5 text-xs text-white/30 font-mono text-right">{index + 1}</span>}
      <button onClick={onToggleDone} className="shrink-0">
        <span
          className="w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-colors"
          style={{
            borderColor: shot.status === "done" ? "#4caf6d" : "rgba(255,255,255,0.3)",
            backgroundColor: shot.status === "done" ? "#4caf6d" : "transparent",
          }}
        >
          {shot.status === "done" && (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
        </span>
      </button>
      {shot.image_url ? (
        <AuthImage path={shot.image_url} alt="" className="w-14 h-10 object-cover rounded-md shrink-0" />
      ) : (
        <div className="w-14 h-10 rounded-md shrink-0 bg-white/5" />
      )}
      <div className="text-sm min-w-0 flex-1 cursor-pointer" onClick={onEdit}>
        <div className={`truncate ${shot.status === "done" ? "line-through text-white/40" : ""}`}>
          {shot.description || t("shot.noDescription")}
        </div>
        {scene && (
          <div className="text-xs text-white/40 truncate">
            {scene.number}{scene.letter ?? ""} · {scene.name || t("scene.unnamed")}
          </div>
        )}
      </div>
    </div>
  );
}
