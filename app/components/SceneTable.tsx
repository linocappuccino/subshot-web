"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { PRIORITY_COLORS, PRIORITY_LABELS, type Member, type Scene, type Shot } from "@/lib/types";
import { googleMapsUrl } from "./SceneCard";
import { ColorBadge, Pill } from "./ui/Badge";
import { Avatar } from "./ui/Avatar";
import { AuthImage } from "./AuthImage";
import { useToast } from "./ui/Toast";
import { Menu, MenuItem } from "./ui/Menu";
import { IconButton } from "./ui/Button";

/** Full-detail alternative to the card grid — every field the card shows
 * (image, description, dialogue lines, good-take, location, ...) still
 * shown, just as one wide row per scene instead of a tile, for scanning a
 * long shot list without scrolling past photos. Rows are drag-sortable the
 * same way the card grid is.
 *
 * No DndContext/sensors here — a scene needs to be draggable from one
 * section's table straight into another's (or into/out of the card grid,
 * since both views share the same underlying scenes), which needs dnd-kit's
 * "multiple containers" pattern: one shared DndContext up on the page,
 * every section just contributes its own SortableContext. An own DndContext
 * here used to swallow every drag before it could ever reach the page-level
 * handler — the exact bug that made cross-section drag impossible in the
 * table view (see project memory). */
export function SceneTable({
  scenes,
  shotsFor,
  members,
  onEditScene,
  onDeleteScene,
  onChange,
  sectionId,
  insertionIndicator,
}: {
  scenes: Scene[];
  shotsFor: (sceneId: string) => Shot[];
  members: Member[];
  onEditScene: (scene: Scene) => void;
  onDeleteScene: (scene: Scene) => void;
  onChange: (updater: (d: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  /** Undefined for the "Ohne Abschnitt" bucket, same convention as
   * SectionBlock's own `section` prop. */
  sectionId?: string | null;
  insertionIndicator?: { targetId: string; edge: "left" | "right" | "top" | "bottom" } | null;
}) {
  const api = useApi();
  const toast = useToast();

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

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/8 mb-2">
      {/* min-w on the table (not just w-full) so text-heavy columns below
          get real breathing room instead of being squeezed down to fit the
          viewport — the outer overflow-x-auto above picks up the slack with
          a horizontal scrollbar on narrower screens instead. */}
      <table className="w-full min-w-[1540px] text-sm border-collapse">
        <thead>
          <tr className="bg-white/[0.04] text-left text-[11px] font-semibold text-white/40 uppercase tracking-wide">
            <th className="w-6" />
            <th className="px-3 py-2.5 w-16">Bild</th>
            <th className="px-3 py-2.5 w-16">Nr.</th>
            <th className="px-3 py-2.5 min-w-[160px]">Name</th>
            <th className="px-3 py-2.5 min-w-[110px]">Priorität</th>
            <th className="px-3 py-2.5 min-w-[110px]">Start</th>
            <th className="px-3 py-2.5 min-w-[220px]">Standort</th>
            <th className="px-3 py-2.5 min-w-[320px]">Beschreibung</th>
            <th className="px-3 py-2.5 min-w-[320px]">Dialog</th>
            <th className="px-3 py-2.5 min-w-[140px]">Good Take</th>
            <th className="px-3 py-2.5 min-w-[140px]">Zuständig</th>
            <th className="px-3 py-2.5 text-center w-16">Einst.</th>
            <th className="px-3 py-2.5 text-center w-20">Im Kasten</th>
            <th className="w-10" />
          </tr>
        </thead>
        <SortableContext items={scenes.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <tbody>
            {scenes.map((scene) => (
              <SceneRow
                key={scene.id}
                scene={scene}
                shots={shotsFor(scene.id)}
                members={members}
                onEditScene={onEditScene}
                onDeleteScene={onDeleteScene}
                onToggleCompleted={toggleCompleted}
                onToggleDialogue={toggleDialogueLine}
                insertionEdge={insertionIndicator?.targetId === scene.id ? insertionIndicator.edge : null}
              />
            ))}
            {/* Table equivalent of the grid's SectionDropZone — makes an
                empty section (or dropping past the last row) a valid target
                for a cross-section drag, same "section-drop:{id}" id the
                page-level handler already decodes. */}
            <TableDropZone sectionId={sectionId ?? null} insertionIndicator={insertionIndicator} />
          </tbody>
        </SortableContext>
      </table>
    </div>
  );
}

function TableDropZone({ sectionId, insertionIndicator }: { sectionId: string | null; insertionIndicator?: { targetId: string } | null }) {
  const { setNodeRef } = useDroppable({ id: `section-drop:${sectionId ?? ""}` });
  const active = insertionIndicator?.targetId === `section-drop:${sectionId ?? ""}`;
  return (
    <tr ref={setNodeRef}>
      <td colSpan={14} className={`h-11 border-2 border-dashed transition-colors ${active ? "border-blue-500 bg-blue-500/10" : "border-transparent"}`} />
    </tr>
  );
}

function SceneRow({
  scene,
  shots,
  members,
  onEditScene,
  onDeleteScene,
  onToggleCompleted,
  onToggleDialogue,
  insertionEdge,
}: {
  scene: Scene;
  shots: Shot[];
  members: Member[];
  onEditScene: (scene: Scene) => void;
  onDeleteScene: (scene: Scene) => void;
  onToggleCompleted: (scene: Scene) => void;
  onToggleDialogue: (scene: Scene, dialogueId: string, done: boolean) => void;
  /** Notion-style insertion indicator, table equivalent of
   * SortableSceneCard's left/right line — a row is a horizontal strip, so
   * top/bottom is the meaningful edge here instead. */
  insertionEdge?: "left" | "right" | "top" | "bottom" | null;
}) {
  // See SortableSceneCard's comment on the same pattern — transform/transition
  // deliberately dropped so dnd-kit's own rectSortingStrategy reflow can't
  // fight the insertion-line indicator.
  const { attributes, listeners, setNodeRef, isDragging } = useSortable({ id: scene.id });
  const color = PRIORITY_COLORS[scene.priority ?? "none"];
  const assignee = members.find((m) => m.user_id === scene.assignee_id);
  const dialogues = [...scene.dialogues].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <tr
      ref={setNodeRef}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className={`relative border-t border-white/6 transition-colors hover:bg-white/[0.05] align-top ${scene.completed ? "bg-emerald-500/[0.06]" : ""} ${
        insertionEdge === "top" ? "shadow-[inset_0_2px_0_0_#3b82f6]" : insertionEdge === "bottom" ? "shadow-[inset_0_-2px_0_0_#3b82f6]" : ""
      }`}
    >
      <td className="pl-2 pt-3">
        <button
          {...attributes}
          {...listeners}
          className="touch-none text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing"
          aria-label="Szene verschieben"
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
        {scene.is_project_info ? "Projektinfo" : scene.name || "Unbenannte Szene"}
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
      <td className="px-3 py-2.5 text-white/60">
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
      <td className="px-3 py-2.5 text-white/70 cursor-pointer" onClick={() => onEditScene(scene)}>
        {scene.description || <span className="text-white/25">—</span>}
      </td>
      <td className="px-3 py-2.5">
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
      <td className="px-1 py-2.5 text-center">
        <Menu
          trigger={
            <IconButton size={28}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
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
                  onEditScene(scene);
                  close();
                }}
              >
                Bearbeiten
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  onDeleteScene(scene);
                  close();
                }}
              >
                Löschen
              </MenuItem>
            </>
          )}
        </Menu>
      </td>
    </tr>
  );
}
