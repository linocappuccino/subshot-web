"use client";

import type {
  DraggableAttributes,
  DraggableSyntheticListeners,
} from "@dnd-kit/core";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Member, Scene, Shot, TodoList } from "@/lib/types";
import { Collapsible } from "./ui/Collapsible";
import { Switch } from "./ui/Switch";
import { LocationPicker } from "./ui/LocationPicker";
import { DateTimePicker } from "./ui/DateTimePicker";
import { Avatar } from "./ui/Avatar";
import { Button, IconButton } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { TodoListsPanel } from "./TodoListsPanel";

/** A "Projektinfo" tile (2026-07-10 redesign) — a scene with
 * is_project_info set, so it drags/reorders/moves-between-sections exactly
 * like any other scene tile (see computeSceneReorder in page.tsx), but
 * always spans the full grid width and always sorts first within whichever
 * section (or "Ohne Abschnitt") it's currently in.
 *
 * Field layout (Collapsible + vertical stack) intentionally mirrors
 * ProjectInfoBox exactly (2026-07-10, Lino: "MUSS GENAU DAS GLEICHE LAYOUT
 * UND FUNKTIONEN HABEN WIE DIE PROJEKTINFO KACHEL GANZ OBEN") — a 4-column
 * grid layout here before read as a visibly different, unrelated component
 * even though it edits the exact same kind of fields. The only structural
 * additions are the drag handle and delete button, both necessary here
 * (this tile is a draggable, deletable scene; the top-level box is neither). */
export function ProjectInfoTile({
  scene,
  members,
  onDelete,
  onChange,
  onOpenTeam,
  dragHandleProps,
}: {
  scene: Scene;
  members: Member[];
  onDelete: () => void;
  onChange: (updater: (data: { scenes: Scene[]; shots: Shot[] }) => { scenes: Scene[]; shots: Shot[] }) => void;
  onOpenTeam: () => void;
  dragHandleProps?: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners };
}) {
  const api = useApi();
  const toast = useToast();

  function applyScene(updated: Scene) {
    onChange((d) => ({ ...d, scenes: d.scenes.map((s) => (s.id === updated.id ? updated : s)) }));
  }

  async function updateShootDate(date: Date | null) {
    try {
      const updated = date
        ? await api.patchScene(scene.id, { scheduled_at: date.toISOString() })
        : await api.patchScene(scene.id, { scheduled_at: null });
      applyScene(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function updateLocation(address: string, lat: number | null, lng: number | null) {
    try {
      const updated = await api.patchScene(scene.id, {
        location_address: address || undefined, location_lat: lat ?? undefined, location_lng: lng ?? undefined,
      });
      applyScene(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  function updateTodoLists(updater: (lists: TodoList[]) => TodoList[]) {
    onChange((d) => ({
      ...d,
      scenes: d.scenes.map((s) => (s.id === scene.id ? { ...s, todo_lists: updater(s.todo_lists) } : s)),
    }));
  }

  return (
    <div className="col-span-full bg-white/[0.035] border border-white/8 rounded-2xl px-4 py-4">
      <div className="flex items-start gap-1">
        {dragHandleProps && (
          <button
            {...dragHandleProps.attributes}
            {...dragHandleProps.listeners}
            className="shrink-0 touch-none text-white/20 hover:text-white/50 cursor-grab active:cursor-grabbing p-1.5 mt-0.5"
            aria-label="Projektinfo verschieben"
          >
            <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
              <circle cx="2" cy="2" r="1.4" /><circle cx="2" cy="8" r="1.4" /><circle cx="2" cy="14" r="1.4" />
              <circle cx="9" cy="2" r="1.4" /><circle cx="9" cy="8" r="1.4" /><circle cx="9" cy="14" r="1.4" />
            </svg>
          </button>
        )}
        <div className="flex-1 min-w-0">
          <Collapsible
            title="Projektinfo"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" />
              </svg>
            }
            actions={
              <IconButton size={28} onClick={onDelete} aria-label="Projektinfo löschen" className="text-white/40 hover:text-red-400">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
                </svg>
              </IconButton>
            }
          >
            <div className="space-y-5 pt-1">
              <div>
                <Switch
                  checked={Boolean(scene.scheduled_at)}
                  onChange={(v) => updateShootDate(v ? new Date() : null)}
                  label="Drehdatum festlegen"
                />
                {scene.scheduled_at && (
                  <div className="mt-2">
                    <DateTimePicker value={new Date(scene.scheduled_at)} onChange={updateShootDate} />
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">Standort</div>
                <LocationPicker
                  address={scene.location_address ?? ""}
                  lat={scene.location_lat}
                  lng={scene.location_lng}
                  onChange={updateLocation}
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">Team</div>
                <div className="flex items-center gap-2 flex-wrap">
                  {members.map((m) => (
                    <Avatar key={m.user_id} name={m.name} email={m.email} avatarUrl={m.avatar_url} size={30} />
                  ))}
                  <Button variant="ghost" size="sm" onClick={onOpenTeam}>
                    Verwalten
                  </Button>
                </div>
              </div>

              <div>
                <TodoListsPanel
                  projectId={scene.project_id}
                  sceneId={scene.id}
                  todoLists={scene.todo_lists}
                  members={members}
                  onChange={updateTodoLists}
                  noMargin
                />
              </div>
            </div>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
