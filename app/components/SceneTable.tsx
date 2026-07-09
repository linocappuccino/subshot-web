"use client";

import { DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { PRIORITY_COLORS, PRIORITY_LABELS, type Member, type Scene, type Shot } from "@/lib/types";
import { googleMapsUrl } from "./SceneCard";
import { ColorBadge, Pill } from "./ui/Badge";
import { Avatar } from "./ui/Avatar";
import { AuthImage } from "./AuthImage";
import { useToast } from "./ui/Toast";

/** Full-detail alternative to the card grid — every field the card shows
 * (image, description, dialogue lines, good-take, location, ...) still
 * shown, just as one wide row per scene instead of a tile, for scanning a
 * long shot list without scrolling past photos. Rows are drag-sortable the
 * same way the card grid is. */
export function SceneTable({
  scenes,
  shotsFor,
  members,
  onEditScene,
  onChange,
  onReorder,
}: {
  scenes: Scene[];
  shotsFor: (sceneId: string) => Shot[];
  members: Member[];
  onEditScene: (scene: Scene) => void;
  onChange: (updater: (d: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  onReorder: (ordered: Scene[], movedSceneId: string, beforeSceneId: string | null) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  async function toggleCompleted(scene: Scene) {
    try {
      const updated = await api.patchScene(scene.id, { completed: !scene.completed });
      onChange((d) => ({ ...d, scenes: d.scenes.map((s) => (s.id === updated.id ? updated : s)) }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function toggleDialogueLine(scene: Scene, dialogueId: string, done: boolean) {
    onChange((d) => ({
      ...d,
      scenes: d.scenes.map((s) =>
        s.id === scene.id ? { ...s, dialogues: s.dialogues.map((x) => (x.id === dialogueId ? { ...x, done: !done } : x)) } : s
      ),
    }));
    try {
      await api.patchDialogue(dialogueId, { done: !done });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = scenes.findIndex((s) => s.id === active.id);
    const newIndex = scenes.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(scenes, oldIndex, newIndex);
    onReorder(reordered, reordered[newIndex].id, reordered[newIndex + 1]?.id ?? null);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8 mb-2">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-white/[0.04] text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide">
            <th className="w-6" />
            <th className="px-3 py-2.5">Bild</th>
            <th className="px-3 py-2.5">Nr.</th>
            <th className="px-3 py-2.5">Name</th>
            <th className="px-3 py-2.5">Priorität</th>
            <th className="px-3 py-2.5">Start</th>
            <th className="px-3 py-2.5">Standort</th>
            <th className="px-3 py-2.5">Beschreibung</th>
            <th className="px-3 py-2.5">Dialog</th>
            <th className="px-3 py-2.5">Good Take</th>
            <th className="px-3 py-2.5">Zuständig</th>
            <th className="px-3 py-2.5 text-center">Einst.</th>
            <th className="px-3 py-2.5 text-center">Im Kasten</th>
          </tr>
        </thead>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {scenes.map((scene) => (
                <SceneRow
                  key={scene.id}
                  scene={scene}
                  shots={shotsFor(scene.id)}
                  members={members}
                  onEditScene={onEditScene}
                  onToggleCompleted={toggleCompleted}
                  onToggleDialogue={toggleDialogueLine}
                />
              ))}
            </tbody>
          </SortableContext>
        </DndContext>
      </table>
    </div>
  );
}

function SceneRow({
  scene,
  shots,
  members,
  onEditScene,
  onToggleCompleted,
  onToggleDialogue,
}: {
  scene: Scene;
  shots: Shot[];
  members: Member[];
  onEditScene: (scene: Scene) => void;
  onToggleCompleted: (scene: Scene) => void;
  onToggleDialogue: (scene: Scene, dialogueId: string, done: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: scene.id });
  const color = PRIORITY_COLORS[scene.priority ?? "none"];
  const assignee = members.find((m) => m.user_id === scene.assignee_id);
  const dialogues = [...scene.dialogues].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className={`border-t border-white/6 transition-colors hover:bg-white/[0.05] align-top ${scene.completed ? "bg-emerald-500/[0.06]" : ""}`}
    >
      <td className="pl-2 pt-3">
        <button
          {...attributes}
          {...listeners}
          className="touch-none text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing"
        >
          <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
            <circle cx="2" cy="2" r="1.4" /><circle cx="2" cy="8" r="1.4" /><circle cx="2" cy="14" r="1.4" />
            <circle cx="9" cy="2" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="9" cy="14" r="1.4" />
          </svg>
        </button>
      </td>
      <td className="px-3 py-2.5 cursor-pointer" onClick={() => onEditScene(scene)}>
        {scene.image_url ? (
          <AuthImage path={scene.image_url} alt="" className="w-11 h-11 object-cover rounded-lg" />
        ) : (
          <div className="w-11 h-11 rounded-lg bg-white/5" />
        )}
      </td>
      <td className="px-3 py-2.5 cursor-pointer" onClick={() => onEditScene(scene)}>
        <ColorBadge label={`${scene.number}${scene.letter ?? ""}`} color={color} />
      </td>
      <td className="px-3 py-2.5 font-medium cursor-pointer max-w-[160px]" onClick={() => onEditScene(scene)}>
        {scene.name || "Unbenannte Szene"}
      </td>
      <td className="px-3 py-2.5 cursor-pointer" onClick={() => onEditScene(scene)}>
        {scene.priority ? <ColorBadge label={PRIORITY_LABELS[scene.priority]} color={color} /> : <span className="text-white/25">—</span>}
      </td>
      <td className="px-3 py-2.5 text-white/70 whitespace-nowrap cursor-pointer" onClick={() => onEditScene(scene)}>
        {scene.scheduled_at ? (
          <>
            {new Date(scene.scheduled_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            {scene.duration_minutes ? (
              <>
                <br />
                {scene.duration_minutes} Min.
              </>
            ) : null}
          </>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-white/60 max-w-[160px]">
        {scene.location_address ? (
          <a href={googleMapsUrl(scene)} target="_blank" rel="noopener noreferrer" className="hover:text-white hover:underline">
            {scene.location_address}
          </a>
        ) : (
          <span className="text-white/25 cursor-pointer" onClick={() => onEditScene(scene)}>
            —
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 text-white/70 max-w-[220px] cursor-pointer" onClick={() => onEditScene(scene)}>
        {scene.description || <span className="text-white/25">—</span>}
      </td>
      <td className="px-3 py-2.5 max-w-[220px]">
        {scene.dialogue && <div className="italic text-white/50 mb-1">„{scene.dialogue}“</div>}
        {dialogues.length > 0 ? (
          <ul className="space-y-1">
            {dialogues.map((d) => (
              <li key={d.id} className="flex items-start gap-1.5">
                <button onClick={() => onToggleDialogue(scene, d.id, d.done)} className="shrink-0 mt-0.5">
                  <span
                    className="w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center"
                    style={{ borderColor: d.done ? "#4caf6d" : "rgba(255,255,255,0.3)", backgroundColor: d.done ? "#4caf6d" : "transparent" }}
                  >
                    {d.done && (
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                </button>
                <span className={`text-xs ${d.done ? "line-through text-white/35" : "text-white/70"}`}>{d.text}</span>
              </li>
            ))}
          </ul>
        ) : (
          !scene.dialogue && <span className="text-white/25">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 cursor-pointer" onClick={() => onEditScene(scene)}>
        {scene.good_take_filename ? (
          <Pill tone="good">{scene.good_take_filename}</Pill>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 cursor-pointer" onClick={() => onEditScene(scene)}>
        {assignee ? (
          <div className="flex items-center gap-1.5">
            <Avatar name={assignee.name} email={assignee.email} avatarUrl={assignee.avatar_url} size={20} />
            <span className="text-xs text-white/60 max-w-[90px]">{assignee.name || assignee.email}</span>
          </div>
        ) : (
          <span className="text-white/25">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-center text-white/60 cursor-pointer" onClick={() => onEditScene(scene)}>
        {scene.is_intermediate_step ? "—" : shots.length}
      </td>
      <td className="px-3 py-2.5 text-center">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleCompleted(scene);
          }}
        >
          <span
            className="inline-flex w-5 h-5 rounded-full border-[1.5px] items-center justify-center transition-colors"
            style={{
              borderColor: scene.completed ? "#4caf6d" : "rgba(255,255,255,0.3)",
              backgroundColor: scene.completed ? "#4caf6d" : "transparent",
            }}
          >
            {scene.completed && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )}
          </span>
        </button>
      </td>
    </tr>
  );
}
