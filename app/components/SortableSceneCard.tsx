"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Member, Scene, Shot } from "@/lib/types";
import { SceneCard } from "./SceneCard";

/** Wraps SceneCard with dnd-kit's useSortable, exposing a dedicated grip
 * handle (not the whole card) as the drag source — the card also nests its
 * own shot-list drag handles (see SceneCard/SortableShotRow), and a
 * whole-card drag source would fight with those over the same pointerdown
 * event bubbling up through the DOM. A single small handle avoids that
 * entirely and still keeps every button/menu/input on the card clickable. */
export function SortableSceneCard({
  scene,
  shots,
  members,
  onEdit,
  onDelete,
  onChange,
}: {
  scene: Scene;
  shots: Shot[];
  members: Member[];
  onEdit: () => void;
  onDelete: () => void;
  onChange: (updater: (data: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, zIndex: isDragging ? 10 : "auto" }}>
      <SceneCard
        scene={scene}
        shots={shots}
        members={members}
        onEdit={onEdit}
        onDelete={onDelete}
        onChange={onChange}
        dragHandleProps={{ attributes, listeners }}
      />
    </div>
  );
}
