"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { PRIORITY_COLORS, PRIORITY_LABELS, type Member, type Scene, type Shot } from "@/lib/types";
import { AuthImage } from "./AuthImage";
import { Pill, ColorBadge } from "./ui/Badge";
import { Avatar } from "./ui/Avatar";
import { Menu, MenuItem } from "./ui/Menu";
import { IconButton } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { ShotEditModal } from "./ShotEditModal";

export function googleMapsUrl(scene: Scene): string {
  const query = scene.location_lat != null && scene.location_lng != null ? `${scene.location_lat},${scene.location_lng}` : scene.location_address ?? "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function CalendarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}
function TextIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  );
}
function QuoteIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function SceneCard({
  scene,
  shots,
  members,
  onEdit,
  onDelete,
  onChange,
  dragHandleProps,
  dropHighlight,
}: {
  scene: Scene;
  shots: Shot[];
  members: Member[];
  onEdit: () => void;
  onDelete: () => void;
  onChange: (updater: (data: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  dragHandleProps?: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners };
  /** True while another scene is being dragged directly over this card —
   * rings it as the drop target, same style as SectionDropZone's isOver. */
  dropHighlight?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const [addingShot, setAddingShot] = useState(false);
  const [newShotText, setNewShotText] = useState("");
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [draggingShotId, setDraggingShotId] = useState<string | null>(null);
  const shotSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  /** Reorders this scene's shots and persists the new sort_order for every
   * shot whose position actually changed - the backend has no bulk-reorder
   * endpoint (same constraint the iOS app works around, see moveShot in
   * ShotListViewModel), so this is one PATCH per moved shot. */
  async function handleShotDragEnd(event: DragEndEvent) {
    setDraggingShotId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = shots.findIndex((s) => s.id === active.id);
    const newIndex = shots.findIndex((s) => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(shots, oldIndex, newIndex);
    onChange((d) => ({
      ...d,
      shots: d.shots.map((s) => {
        const idx = reordered.findIndex((r) => r.id === s.id);
        return idx === -1 ? s : { ...s, sort_order: idx };
      }),
    }));
    try {
      await Promise.all(
        reordered.map((s, idx) => (s.sort_order !== idx ? api.patchShot(s.id, { sort_order: idx }) : Promise.resolve()))
      );
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Sortierung fehlgeschlagen.");
    }
  }

  async function toggleCompleted() {
    try {
      const updated = await api.patchScene(scene.id, { completed: !scene.completed });
      onChange((d) => ({ ...d, scenes: d.scenes.map((s) => (s.id === updated.id ? updated : s)) }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function toggleDialogueLine(dialogueId: string, done: boolean) {
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

  async function toggleShotDone(shot: Shot) {
    try {
      const updated = await api.patchShot(shot.id, { status: shot.status === "done" ? "open" : "done" });
      onChange((d) => ({ ...d, shots: d.shots.map((s) => (s.id === updated.id ? updated : s)) }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function addShot() {
    const description = newShotText.trim();
    setAddingShot(false);
    if (!description) return;
    try {
      const shot = await api.createShot(scene.project_id, { scene_id: scene.id, description });
      onChange((d) => ({ ...d, shots: [...d.shots, shot] }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
    setNewShotText("");
  }

  async function assignTo(userId: string | null) {
    try {
      const updated = await api.patchScene(scene.id, { assignee_id: userId, clear_assignee: !userId });
      onChange((d) => ({ ...d, scenes: d.scenes.map((s) => (s.id === updated.id ? updated : s)) }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  const assignee = members.find((m) => m.user_id === scene.assignee_id);
  const color = PRIORITY_COLORS[scene.priority ?? "none"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className={`rounded-2xl p-4 border transition-colors ${
        dropHighlight
          ? "bg-blue-500/10 border-blue-500/40 ring-1 ring-inset ring-blue-500/40"
          : scene.completed
            ? "bg-emerald-500/10 border-emerald-500/20"
            : "bg-white/[0.045] border-white/8 hover:border-white/15"
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <ColorBadge label={`${scene.number}${scene.letter ?? ""}`} color={color} />
            <h3 className="font-semibold flex-1 min-w-0 truncate">{scene.name || "Unbenannte Szene"}</h3>
            {scene.priority && <ColorBadge label={PRIORITY_LABELS[scene.priority]} color={color} />}
            {scene.completed && (
              <Pill tone="good" icon={<CheckIcon />}>
                IM KASTEN
              </Pill>
            )}
          </div>
          {!scene.is_intermediate_step && scene.good_take_filename && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              <Pill tone="good">{scene.good_take_filename}</Pill>
            </div>
          )}
          {(scene.scheduled_at || scene.location_address) && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {scene.scheduled_at && (
                <Pill icon={<CalendarIcon />}>
                  Start: {new Date(scene.scheduled_at).toLocaleString("de-CH", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {scene.duration_minutes ? ` · ${scene.duration_minutes} Min.` : ""}
                </Pill>
              )}
              {scene.location_address && (
                <a
                  href={googleMapsUrl(scene)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="hover:brightness-125 transition-[filter] max-w-full min-w-0"
                >
                  <Pill icon={<PinIcon />} wrap>
                    {scene.location_address}
                  </Pill>
                </a>
              )}
            </div>
          )}
        </div>
        {dragHandleProps && (
          <button
            {...dragHandleProps.attributes}
            {...dragHandleProps.listeners}
            className="shrink-0 touch-none text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing p-1.5"
            aria-label="Szene verschieben"
          >
            <svg width="14" height="18" viewBox="0 0 12 16" fill="currentColor">
              <circle cx="2" cy="2" r="1.4" /><circle cx="2" cy="8" r="1.4" /><circle cx="2" cy="14" r="1.4" />
              <circle cx="9" cy="2" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="9" cy="14" r="1.4" />
            </svg>
          </button>
        )}
        <Menu
          trigger={
            <IconButton size={30}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="5" cy="12" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="19" cy="12" r="1.8" />
              </svg>
            </IconButton>
          }
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  onEdit();
                  close();
                }}
              >
                Bearbeiten
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  onDelete();
                  close();
                }}
              >
                Löschen
              </MenuItem>
            </>
          )}
        </Menu>
      </div>

      {scene.image_url && (
        <div className="cursor-pointer mb-2 rounded-xl overflow-hidden" onClick={onEdit}>
          <AuthImage path={scene.image_url} alt={scene.name ?? "Szene"} className="w-full object-cover" lockAspectRatio />
        </div>
      )}

      {scene.description && (
        <div className="mb-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/40 mb-1">
            <TextIcon /> Beschreibung
          </div>
          <p className="text-sm text-white/80 whitespace-pre-wrap">{scene.description}</p>
        </div>
      )}
      {scene.dialogue && <p className="text-sm italic text-white/50 mb-1.5">„{scene.dialogue}“</p>}

      {scene.dialogues.length > 0 && (
        <div className="bg-white/[0.03] rounded-lg p-2.5 mb-2">
          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/40 mb-1.5">
            <QuoteIcon /> Dialog
          </div>
          <div className="space-y-1">
            {scene.dialogues.map((d) => (
              <button key={d.id} onClick={() => toggleDialogueLine(d.id, d.done)} className="flex items-start gap-2 text-left w-full group">
                <span
                  className="w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 mt-0.5 transition-colors"
                  style={{ borderColor: d.done ? "#4caf6d" : "rgba(255,255,255,0.3)", backgroundColor: d.done ? "#4caf6d" : "transparent" }}
                >
                  {d.done && <CheckIcon />}
                </span>
                <span className={`text-sm ${d.done ? "line-through text-white/35" : "text-white/70"}`}>{d.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {!scene.is_intermediate_step && shots.length > 0 && (
        <DndContext
          sensors={shotSensors}
          collisionDetection={closestCenter}
          onDragStart={(e) => setDraggingShotId(String(e.active.id))}
          onDragEnd={handleShotDragEnd}
          onDragCancel={() => setDraggingShotId(null)}
        >
          <SortableContext items={shots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5 mb-2">
              {shots.map((shot) => (
                <SortableShotRow
                  key={shot.id}
                  shot={shot}
                  onToggleDone={() => toggleShotDone(shot)}
                  onEdit={() => setEditingShot(shot)}
                />
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {draggingShotId && (() => {
              const s = shots.find((x) => x.id === draggingShotId);
              return s ? (
                <div className="shadow-2xl shadow-black/50 cursor-grabbing rounded-lg overflow-hidden">
                  <ShotRowContent shot={s} onToggleDone={() => {}} onEdit={() => {}} />
                </div>
              ) : null;
            })()}
          </DragOverlay>
        </DndContext>
      )}

      {!scene.is_intermediate_step && (
        <div className="mb-3">
          {addingShot ? (
            <input
              autoFocus
              value={newShotText}
              onChange={(e) => setNewShotText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addShot()}
              onBlur={addShot}
              placeholder="Neue Einstellung"
              className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          ) : (
            <button onClick={() => setAddingShot(true)} className="text-xs font-semibold text-blue-400 hover:text-blue-300">
              + Einstellung hinzufügen
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Menu
          align="start"
          trigger={
            assignee ? (
              <Avatar name={assignee.name} email={assignee.email} avatarUrl={assignee.avatar_url} size={28} className="cursor-pointer" />
            ) : (
              <IconButton size={28} className="bg-white/5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
              </IconButton>
            )
          }
        >
          {(close) => (
            <>
              {assignee && (
                <MenuItem
                  onClick={() => {
                    assignTo(null);
                    close();
                  }}
                >
                  Niemand zugewiesen
                </MenuItem>
              )}
              {members.map((m) => (
                <MenuItem
                  key={m.user_id}
                  onClick={() => {
                    assignTo(m.user_id);
                    close();
                  }}
                >
                  {m.name || m.email}
                </MenuItem>
              ))}
            </>
          )}
        </Menu>
        <button
          onClick={toggleCompleted}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors ${
            scene.completed ? "bg-emerald-500/20 text-emerald-400" : "bg-white/8 text-white/60 hover:bg-white/14"
          }`}
        >
          {scene.completed && <CheckIcon />}
          Im Kasten
        </button>
      </div>

      <ShotEditModal
        open={editingShot !== null}
        onClose={() => setEditingShot(null)}
        shot={editingShot}
        onUpdated={(updated) => {
          onChange((d) => ({ ...d, shots: d.shots.map((s) => (s.id === updated.id ? updated : s)) }));
        }}
      />
    </motion.div>
  );
}

function SortableShotRow({ shot, onToggleDone, onEdit }: { shot: Shot; onToggleDone: () => void; onEdit: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shot.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}>
      <ShotRowContent shot={shot} onToggleDone={onToggleDone} onEdit={onEdit} dragHandleProps={{ attributes, listeners }} />
    </div>
  );
}

/** Plain presentational row, no useSortable of its own - reused as-is for
 * the DragOverlay's floating clone, which must NOT register its own
 * sortable id (dnd-kit doesn't allow two elements claiming the same one). */
function ShotRowContent({
  shot,
  onToggleDone,
  onEdit,
  dragHandleProps,
}: {
  shot: Shot;
  onToggleDone: () => void;
  onEdit: () => void;
  dragHandleProps?: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners };
}) {
  return (
    <div className="flex gap-2 items-center bg-white/[0.03] hover:bg-white/[0.06] rounded-lg p-2 transition-colors">
      <button
        {...dragHandleProps?.attributes}
        {...dragHandleProps?.listeners}
        className="shrink-0 touch-none text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing"
      >
        <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
          <circle cx="2" cy="2" r="1.4" /><circle cx="2" cy="8" r="1.4" /><circle cx="2" cy="14" r="1.4" />
          <circle cx="9" cy="2" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="9" cy="14" r="1.4" />
        </svg>
      </button>
      <button onClick={onToggleDone} className="shrink-0">
        <span
          className="w-5 h-5 rounded-full border-[1.5px] flex items-center justify-center transition-colors"
          style={{
            borderColor: shot.status === "done" ? "#4caf6d" : "rgba(255,255,255,0.3)",
            backgroundColor: shot.status === "done" ? "#4caf6d" : "transparent",
          }}
        >
          {shot.status === "done" && <CheckIcon />}
        </span>
      </button>
      {shot.image_url ? (
        <AuthImage path={shot.image_url} alt="" className="w-14 h-10 object-cover rounded-md shrink-0 cursor-pointer" />
      ) : (
        <div className="w-14 h-10 rounded-md shrink-0 bg-white/5" />
      )}
      <div className="text-sm min-w-0 flex-1 cursor-pointer" onClick={onEdit}>
        <div className={`truncate ${shot.status === "done" ? "line-through text-white/40" : ""}`}>
          {shot.description || "Ohne Beschreibung"}
        </div>
        {shot.good_take_filename && <div className="text-xs text-emerald-400">{shot.good_take_filename}</div>}
      </div>
    </div>
  );
}
