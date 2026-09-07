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
import { ShotRowContent } from "./SceneCard";
import { useLanguage } from "@/lib/i18n";
import type { Scene, Shot } from "@/lib/types";

/** 2026-09-09, Lino: "die szenen-reihefolge zeigt quasi die szenen wie sie
 * im fertigen video nacheinander gezeigt werden... die shot-reihenfolge
 * zeigt die reihenfolge wie sie am set gefilmt wird, [...] man muss die
 * szenen verschieben können und sie müssen die nummer von der
 * szenen-reihenfolge behalten... so kann man sich die shot-reihefolge für
 * den drehtag zurechtlegen" — supersedes the 2026-09-07 first attempt at
 * this view, which flattened and freely interleaved individual SHOTS.
 * The real unit for a shooting-day schedule is the whole SCENE (its own
 * shots stay in their normal per-scene order, just along for the ride) —
 * this is that reorder, backed by Scene.shooting_order (independent of
 * sort_order, which drives the Szenen-Reihenfolge and never changes here). */
export function ShotOrderView({
  scenes,
  shotsFor,
  sceneNumberById,
  onReorder,
  onToggleDone,
  onEditShot,
  onEditScene,
}: {
  /** Already sorted (shooting_order, falling back to sort_order for
   * scenes that don't have one yet) — see the caller, projects/[id]/page.tsx. */
  scenes: Scene[];
  shotsFor: (sceneId: string) => Shot[];
  /** Position-in-section count from the Szenen-Reihenfolge (see
   * sceneNumberBySectionId's own doc comment in page.tsx) — dragging
   * scene BLOCKS around in here (Scene.shooting_order) never touches
   * Scene.sort_order, so this number is untouched by it. */
  sceneNumberById: Map<string, number>;
  onReorder: (orderedSceneIds: string[]) => void;
  onToggleDone: (shot: Shot) => void;
  onEditShot: (shot: Shot) => void;
  /** Clicking a shot-less scene's block opens the normal scene editor —
   * same as clicking its tile in the Szenen-Reihenfolge would — so adding
   * its first shot is one click away. */
  onEditScene: (scene: Scene) => void;
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
    const oldIndex = scenes.findIndex((s) => s.id === active.id);
    const newIndex = scenes.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder(arrayMove(scenes, oldIndex, newIndex).map((s) => s.id));
  }

  const draggingScene = draggingId ? scenes.find((s) => s.id === draggingId) : null;

  if (scenes.length === 0) {
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
      <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-3">
          {scenes.map((scene) => (
            <SortableSceneBlock
              key={scene.id}
              scene={scene}
              shots={shotsFor(scene.id)}
              sceneNumber={sceneNumberById.get(scene.id)}
              onToggleDone={onToggleDone}
              onEditShot={onEditShot}
              onEditScene={() => onEditScene(scene)}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {draggingScene && (
          <div className="shadow-2xl shadow-black/50 cursor-grabbing rounded-xl overflow-hidden opacity-90">
            <SceneBlockContent
              scene={draggingScene}
              shots={shotsFor(draggingScene.id)}
              sceneNumber={sceneNumberById.get(draggingScene.id)}
              onToggleDone={() => {}}
              onEditShot={() => {}}
              onEditScene={() => {}}
            />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function SortableSceneBlock({
  scene, shots, sceneNumber, onToggleDone, onEditShot, onEditScene,
}: {
  scene: Scene;
  shots: Shot[];
  sceneNumber: number | undefined;
  onToggleDone: (shot: Shot) => void;
  onEditShot: (shot: Shot) => void;
  onEditScene: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <SceneBlockContent
        scene={scene}
        shots={shots}
        sceneNumber={sceneNumber}
        onToggleDone={onToggleDone}
        onEditShot={onEditShot}
        onEditScene={onEditScene}
        dragHandleProps={{ attributes, listeners }}
      />
    </div>
  );
}

/** Plain presentational block, no useSortable of its own — reused as-is
 * for the DragOverlay's floating clone, same reasoning as ShotRowContent
 * itself (two elements can't both claim the same sortable id). */
function SceneBlockContent({
  scene, shots, sceneNumber, onToggleDone, onEditShot, onEditScene, dragHandleProps,
}: {
  scene: Scene;
  shots: Shot[];
  sceneNumber: number | undefined;
  onToggleDone: (shot: Shot) => void;
  onEditShot: (shot: Shot) => void;
  onEditScene: () => void;
  dragHandleProps?: { attributes: ReturnType<typeof useSortable>["attributes"]; listeners: ReturnType<typeof useSortable>["listeners"] };
}) {
  const { t } = useLanguage();
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/8 p-3">
      <div className="flex items-center gap-2 mb-2">
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
        <button onClick={onEditScene} className="flex items-center gap-2 min-w-0 flex-1 text-left">
          <span className="shrink-0 text-xs font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 text-white/70">
            {sceneNumber ?? `${scene.number}${scene.letter ?? ""}`}
          </span>
          <span className="text-sm font-semibold truncate">{scene.name || t("scene.unnamed")}</span>
        </button>
      </div>
      {shots.length > 0 ? (
        <div className="space-y-1.5">
          {shots.map((shot) => (
            <ShotRowContent key={shot.id} shot={shot} onToggleDone={() => onToggleDone(shot)} onEdit={() => onEditShot(shot)} />
          ))}
        </div>
      ) : (
        <button onClick={onEditScene} className="text-xs text-white/40 italic py-1.5 hover:text-white/60 transition-colors">
          {t("shotOrderView.noShotsYet")}
        </button>
      )}
    </div>
  );
}
