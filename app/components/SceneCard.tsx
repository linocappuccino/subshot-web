"use client";

import { useEffect, useRef, useState } from "react";
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
  type DragOverEvent,
  type DragStartEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { PALETTE, PRIORITY_COLORS, PRIORITY_LABELS, type Member, type Scene, type Shot } from "@/lib/types";
import { AuthImage } from "./AuthImage";
import { Pill, ColorBadge } from "./ui/Badge";
import { Avatar } from "./ui/Avatar";
import { Menu, MenuItem } from "./ui/Menu";
import { IconButton } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { ShotEditModal } from "./ShotEditModal";

/** True from `scheduled_at` until `scheduled_at + duration_minutes` — the
 * card pulses for exactly this window (Lino: "bei der kachel wo der timer
 * gerade läuft, soll die ganze kachel leicht pulsieren"). Re-checked every
 * 15s so the pulse starts/stops on its own without a page reload; no timer
 * at all (missing scheduled_at or duration_minutes) never pulses. */
function useSceneTimerRunning(scene: Scene): boolean {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(id);
  }, []);
  if (scene.completed || !scene.scheduled_at || !scene.duration_minutes) return false;
  const start = new Date(scene.scheduled_at).getTime();
  const end = start + scene.duration_minutes * 60000;
  return now >= start && now < end;
}

export function googleMapsUrl(scene: Scene): string {
  const query = scene.location_lat != null && scene.location_lng != null ? `${scene.location_lat},${scene.location_lng}` : scene.location_address ?? "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Renders an address with a `<wbr>` after every comma, so a wrapping
 * browser prefers breaking at "Strasse 1," / "8001 Zürich" boundaries over
 * splitting mid-word — falls back to the normal break-words behavior for
 * any segment still too long to fit on one line. */
function addressWithCommaBreaks(address: string) {
  const parts = address.split(", ");
  return parts.map((part, i) => (
    <span key={i}>
      {part}
      {i < parts.length - 1 && (
        <>
          ,<wbr />{" "}
        </>
      )}
    </span>
  ));
}

/** Pure — what `shots` (already scoped to one scene) would look like with
 * `activeId` moved to `overId`'s position, sort_order reassigned to match.
 * Shared by handleShotDragOver's debounced live preview and
 * handleShotDragEnd's definitive final computation so the two can never
 * disagree about what a given (shots, activeId, overId) triple resolves to. */
function computeShotReorder(shots: Shot[], activeId: string, overId: string): Shot[] | null {
  const oldIndex = shots.findIndex((s) => s.id === activeId);
  const newIndex = shots.findIndex((s) => s.id === overId);
  if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return null;
  return arrayMove(shots, oldIndex, newIndex).map((s, idx) => ({ ...s, sort_order: idx }));
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
/** Web equivalent of iOS's "sdcard.fill" SF Symbol, used on the good-take
 * button — a memory card with a clipped top-left corner. */
function SdCardIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17 2H9L4 7v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-9 4h2v5H8V6Zm4 0h2v5h-2V6Zm4 0h2v5h-2V6Z" />
    </svg>
  );
}

export function SceneCard({
  scene,
  shots,
  members,
  onEdit,
  onDelete,
  onDuplicate,
  onChange,
  dragHandleProps,
}: {
  scene: Scene;
  shots: Shot[];
  members: Member[];
  onEdit: () => void;
  onDuplicate?: () => void;
  onDelete: () => void;
  onChange: (updater: (data: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  dragHandleProps?: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners };
}) {
  const api = useApi();
  const toast = useToast();
  const [addingShot, setAddingShot] = useState(false);
  const [newShotText, setNewShotText] = useState("");
  const [editingShot, setEditingShot] = useState<Shot | null>(null);
  const [draggingShotId, setDraggingShotId] = useState<string | null>(null);
  // Quick inline good-take editor, bottom-left of the tile — mirrors iOS's
  // sceneGoodTakeButton exactly (same capsule pill, same position in the
  // bottom action row), previously web-only had a read-only badge and the
  // full edit modal, no quick way to set/clear it straight from the tile.
  const [editingGoodTake, setEditingGoodTake] = useState(false);
  const [goodTakeText, setGoodTakeText] = useState(scene.good_take_filename ?? "");
  // Dialog list on the tile itself, collapsed by clicking its "Dialog"
  // header (2026-07-11, Lino) — defaults open so nothing changes for
  // scenes that were already showing their dialogue lines.
  const [dialogOpen, setDialogOpen] = useState(true);
  // Same collapsible idea as the Dialog list, for the description block.
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  // ...and for the shot ("Einstellung") list.
  const [shotsOpen, setShotsOpen] = useState(true);
  // Snapshot of `shots` taken at drag start — restored verbatim on
  // cancel/invalid-drop, same pattern as the scene grid's drag (see
  // handleSceneDragCancel in page.tsx).
  const shotDragOriginRef = useRef<Shot[] | null>(null);
  // Debounces the live-reorder preview (see handleShotDragOver) — a fast
  // sweep across several shot rows shouldn't reflow the list on every one
  // of them, only once near wherever the pointer actually settles.
  const shotDragOverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shotSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } })
  );

  function handleShotDragStart(event: DragStartEvent) {
    setDraggingShotId(String(event.active.id));
    shotDragOriginRef.current = shots;
  }

  /** Fires on every hover change while dragging. A real drag can fire this
   * dozens of times a second while sweeping across rows — debounced (like
   * the scene grid's handleSceneDragOver, see its comment for why) so it
   * only actually reorders `shots` ~100ms after the hovered row stops
   * changing, instead of reflowing on every row merely passed over. */
  function handleShotDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (shotDragOverTimeoutRef.current) clearTimeout(shotDragOverTimeoutRef.current);
    if (!over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    shotDragOverTimeoutRef.current = setTimeout(() => {
      onChange((d) => {
        // Same scoping + order as the shotsFor() prop this component
        // normally receives — d.shots itself isn't guaranteed sorted, and
        // computeShotReorder needs the current on-screen order to resolve
        // "move active to over's index" correctly.
        const currentShots = d.shots
          .filter((s) => s.scene_id === scene.id && s.status !== "deleted")
          .sort((a, b) => a.sort_order - b.sort_order);
        const reordered = computeShotReorder(currentShots, activeId, overId);
        if (!reordered) return d;
        return { ...d, shots: d.shots.map((s) => reordered.find((r) => r.id === s.id) ?? s) };
      });
    }, 100);
  }

  /** Never trusts whatever `shots` currently shows (the live preview is
   * debounced, so it can lag behind) — recomputes the definitive final
   * order fresh from dnd-kit's actual final `over`, then persists the new
   * sort_order for every shot whose position changed from the pre-drag
   * snapshot. The backend has no bulk-reorder endpoint (same constraint
   * the iOS app works around, see moveShot in ShotListViewModel), so this
   * is one PATCH per moved shot. */
  async function handleShotDragEnd(event: DragEndEvent) {
    setDraggingShotId(null);
    if (shotDragOverTimeoutRef.current) clearTimeout(shotDragOverTimeoutRef.current);
    const origin = shotDragOriginRef.current;
    shotDragOriginRef.current = null;
    const { active, over } = event;
    if (!over) {
      if (origin) onChange((d) => ({ ...d, shots: d.shots.map((s) => origin.find((o) => o.id === s.id) ?? s) }));
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);
    const finalOrder = activeId === overId ? shots : computeShotReorder(shots, activeId, overId) ?? shots;
    onChange((d) => ({ ...d, shots: d.shots.map((s) => finalOrder.find((f) => f.id === s.id) ?? s) }));
    if (activeId === overId) return;
    // Single server-authoritative move (2026-07-13) — replaces the old
    // per-changed-shot Promise.all(patchShot) loop, same reasoning as
    // Section's move above (see move_shot in the backend).
    const idx = finalOrder.findIndex((s) => s.id === activeId);
    const beforeId = finalOrder[idx + 1]?.id ?? null;
    try {
      await api.moveShot(activeId, beforeId);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Sortierung fehlgeschlagen.");
    }
  }

  /** Drag cancelled (Escape, dropped outside any droppable) — revert the
   * live preview from handleShotDragOver, nothing was persisted yet. */
  function handleShotDragCancel() {
    setDraggingShotId(null);
    if (shotDragOverTimeoutRef.current) clearTimeout(shotDragOverTimeoutRef.current);
    const origin = shotDragOriginRef.current;
    shotDragOriginRef.current = null;
    if (origin) onChange((d) => ({ ...d, shots: d.shots.map((s) => origin.find((o) => o.id === s.id) ?? s) }));
  }

  async function saveGoodTake() {
    setEditingGoodTake(false);
    const trimmed = goodTakeText.trim();
    if (trimmed === (scene.good_take_filename ?? "")) return;
    try {
      const updated = await api.patchScene(scene.id, { good_take_filename: trimmed || null, clear_good_take: !trimmed });
      onChange((d) => ({ ...d, scenes: d.scenes.map((s) => (s.id === updated.id ? updated : s)) }));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
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
  const isTimerRunning = useSceneTimerRunning(scene);

  return (
    <div className="relative">
      {/* Timer-running cue: a pulsing white glow behind the tile, not the
          tile itself moving (Lino, 2026-07-13: the old whole-card scale
          pulse "sieht scheisse aus"). Sits behind via -z-10 on a plain div
          in this same stacking context, no separate positioned ancestor
          needed since SortableSceneCard's wrapper is already `relative`. */}
      {isTimerRunning && (
        <motion.div
          aria-hidden
          className="absolute -inset-2 rounded-3xl bg-white blur-xl pointer-events-none -z-10"
          animate={{ opacity: [0.15, 0.5, 0.15] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        // backdrop-blur is safe here (unlike TileShell's photo tiles) — this
        // card has no 3D hover transform (rotateX/rotateY + preserve-3d),
        // which is what caused the earlier "mega verschwommen" compositing
        // bug on the folder/project tiles (see project memory). A real
        // frosted-glass material now, not just a gradient standing in for one
        // (Lino: "der apple glas effekt soll auf ALLEN Kacheln sein").
        className={`rounded-2xl p-4 border backdrop-blur-md backdrop-saturate-150 transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_1px_2px_rgba(0,0,0,0.2)] ${
          scene.completed
            ? "bg-gradient-to-b from-emerald-500/[0.14] to-emerald-500/[0.06] border-emerald-500/20"
            : "bg-gradient-to-b from-white/[0.075] to-white/[0.025] border-white/8 hover:border-white/15"
        }`}
      >
      <div className="flex items-start gap-2 mb-2">
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <ColorBadge label={`${scene.number}${scene.letter ?? ""}`} color={color} />
            {scene.priority && <ColorBadge label={PRIORITY_LABELS[scene.priority]} color={color} />}
            {scene.completed && (
              <Pill tone="good" icon={<CheckIcon />}>
                IM KASTEN
              </Pill>
            )}
          </div>
          <h3 className="font-semibold mb-1.5 break-words">{scene.name || "Unbenannte Szene"}</h3>
          {(scene.scheduled_at || scene.location_address) && (
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              {scene.scheduled_at && (
                <Pill icon={<CalendarIcon />} className="rounded-lg">
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
                  <Pill icon={<PinIcon />} wrap className="rounded-lg">
                    {addressWithCommaBreaks(scene.location_address)}
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
              {onDuplicate && (
                <MenuItem
                  onClick={() => {
                    onDuplicate();
                    close();
                  }}
                >
                  Duplizieren
                </MenuItem>
              )}
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
          <button
            onClick={() => setDescriptionOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/40 hover:text-white/70 transition-colors w-full mb-1"
          >
            <TextIcon /> Beschreibung
            <span className="ml-auto transition-transform duration-200 shrink-0" style={{ transform: descriptionOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </button>
          <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${descriptionOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden min-h-0">
              <p className="text-sm text-white/80 whitespace-pre-wrap">{scene.description}</p>
            </div>
          </div>
        </div>
      )}
      {scene.dialogue && <p className="text-sm italic text-white/50 mb-1.5">„{scene.dialogue}“</p>}

      {scene.dialogues.length > 0 && (
        <div className="bg-white/[0.03] rounded-lg p-2.5 mb-2">
          <button
            onClick={() => setDialogOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/40 hover:text-white/70 transition-colors w-full"
          >
            <QuoteIcon /> Dialog
            <span className="ml-auto text-white/30 normal-case tracking-normal font-medium">{scene.dialogues.length}</span>
            <span className="transition-transform duration-200 shrink-0" style={{ transform: dialogOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </button>
          <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${dialogOpen ? "grid-rows-[1fr] mt-1.5" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden min-h-0">
              <div className="space-y-1">
                {scene.dialogues.map((d, i) => {
                  // Cycles through the shared PALETTE (same swatches as
                  // project/folder colors) so consecutive lines read as
                  // visually separate blocks — dezent, not per-speaker
                  // (SceneDialogue has no speaker field), just enough to
                  // tell one line apart from the next at a glance.
                  const lineColor = PALETTE[i % PALETTE.length];
                  return (
                    <button
                      key={d.id}
                      onClick={() => toggleDialogueLine(d.id, d.done)}
                      className="flex items-start gap-2 text-left w-full group rounded-md px-1.5 py-1 -mx-1.5 border-l-2"
                      style={{ backgroundColor: `${lineColor}14`, borderColor: `${lineColor}80` }}
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-full border-[1.5px] flex items-center justify-center shrink-0 mt-0.5 transition-colors"
                        style={{ borderColor: d.done ? "#4caf6d" : "rgba(255,255,255,0.3)", backgroundColor: d.done ? "#4caf6d" : "transparent" }}
                      >
                        {d.done && <CheckIcon />}
                      </span>
                      <span className={`text-sm ${d.done ? "line-through text-white/35" : "text-white/70"}`}>{d.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {!scene.is_intermediate_step && shots.length > 0 && (
        <div className="mb-2">
          <button
            onClick={() => setShotsOpen((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/40 hover:text-white/70 transition-colors w-full mb-1.5"
          >
            Einstellungen
            <span className="ml-auto text-white/30 normal-case tracking-normal font-medium">{shots.length}</span>
            <span className="transition-transform duration-200 shrink-0" style={{ transform: shotsOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </button>
          <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${shotsOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden min-h-0">
              <DndContext
                sensors={shotSensors}
                collisionDetection={closestCenter}
                // Faster viewport-edge auto-scroll while dragging (2026-07-13,
                // Lino: dnd-kit's default acceleration was too slow to reach a
                // distant drop target) — same values used on the other two
                // DndContexts in this app (page.tsx, projects/page.tsx).
                autoScroll={{ acceleration: 40, interval: 5 }}
                onDragStart={handleShotDragStart}
                onDragOver={handleShotDragOver}
                onDragEnd={handleShotDragEnd}
                onDragCancel={handleShotDragCancel}
              >
                <SortableContext items={shots.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1.5">
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
            </div>
          </div>
        </div>
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

      <div className="flex items-center justify-between gap-2">
        {!scene.is_intermediate_step ? (
          editingGoodTake ? (
            <input
              autoFocus
              value={goodTakeText}
              onChange={(e) => setGoodTakeText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveGoodTake()}
              onBlur={saveGoodTake}
              placeholder="Dateiname, z.B. A003_C012"
              className="bg-white/5 border border-white/10 rounded-full px-3 py-1.5 text-xs w-36 min-w-0 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            />
          ) : (
            <button
              onClick={() => {
                setGoodTakeText(scene.good_take_filename ?? "");
                setEditingGoodTake(true);
              }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5 transition-colors min-w-0 ${
                scene.good_take_filename ? "bg-emerald-500/20 text-emerald-400" : "bg-white/8 text-white/50 hover:bg-white/14"
              }`}
            >
              <SdCardIcon />
              <span className="truncate max-w-[9rem]">{scene.good_take_filename || "Good Take"}</span>
            </button>
          )
        ) : (
          <span />
        )}
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
    </div>
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
