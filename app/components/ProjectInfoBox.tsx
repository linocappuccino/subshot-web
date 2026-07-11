"use client";

import { useRef, useState } from "react";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Member, Project, TodoList } from "@/lib/types";
import { Collapsible } from "./ui/Collapsible";
import { Switch } from "./ui/Switch";
import { LocationPicker } from "./ui/LocationPicker";
import { DateTimePicker } from "./ui/DateTimePicker";
import { Avatar } from "./ui/Avatar";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { TodoListsPanel } from "./TodoListsPanel";

/** Mirrors the iOS app's ProjectInfoBox: one collapsible panel at the top of
 * the project holding Drehdatum, Standort (with the same map-search picker
 * as scenes), the people on the project, and the Todo-Listen nested inside
 * it - not a separate section, same grouping as the app. */
export function ProjectInfoBox({
  project,
  members,
  onProjectChange,
  onOpenTeam,
  todoLists,
  onTodoListsChange,
}: {
  project: Project;
  members: Member[];
  onProjectChange: (updater: (p: Project) => Project) => void;
  onOpenTeam: () => void;
  todoLists: TodoList[];
  onTodoListsChange: (updater: (lists: TodoList[]) => TodoList[]) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [hasShootDate, setHasShootDate] = useState(Boolean(project.shoot_date));
  // Lazy initializer, not a direct Date.now() call in the render body - see
  // the same pattern (and why) in app/projects/page.tsx's ProjectTile.
  const [now] = useState(() => Date.now());
  const daysUntilDeletion = Math.max(
    0,
    Math.ceil((new Date(project.last_opened_at).getTime() + 30 * 24 * 3600 * 1000 - now) / (24 * 3600 * 1000))
  );

  async function updateShootDate(date: Date | null) {
    try {
      const updated = await api.patchProject(project.id, { shoot_date: date ? date.toISOString() : null });
      onProjectChange(() => updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  // LocationPicker fires onChange on every keystroke (no debounce, so the
  // map/geocode results can update live) — that used to mean every keystroke
  // also fired its own patchProject request with no ordering guarantee
  // between them. A slower request for an EARLIER (longer) value could
  // resolve after a newer, faster one for the just-edited (shorter) value,
  // and its response was applied unconditionally, silently reverting the
  // just-typed edit — most reliably reproduced by deleting the very first
  // character right after the address was set (Lino: "kann den ersten
  // Buchstaben nicht aus dem Adressfeld löschen"), since that's usually the
  // fastest possible single keystroke after a slower prior request (e.g. the
  // initial full address being set) is still in flight. Fix: a monotonic
  // request id — only the response to the MOST RECENTLY fired request is
  // ever applied, any stale one arriving late is discarded.
  const locationRequestId = useRef(0);
  async function updateLocation(address: string, lat: number | null, lng: number | null) {
    onProjectChange((p) => ({ ...p, location_address: address || null, location_lat: lat, location_lng: lng }));
    const requestId = ++locationRequestId.current;
    try {
      const updated = await api.patchProject(project.id, { location_address: address || null, location_lat: lat, location_lng: lng });
      if (requestId === locationRequestId.current) onProjectChange(() => updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  return (
    <div className="bg-white/[0.035] border border-white/8 rounded-2xl px-4 py-4 mb-8">
      <Collapsible
        title="Projektinfos"
        subtitle={`Wird in ${daysUntilDeletion} Tagen gelöscht`}
        defaultOpen={false}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
            <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" />
          </svg>
        }
      >
        <div className="space-y-5 pt-1">
          <div>
            <Switch
              checked={hasShootDate}
              onChange={(v) => {
                setHasShootDate(v);
                updateShootDate(v ? new Date() : null);
              }}
              label="Drehdatum festlegen"
            />
            {hasShootDate && (
              <div className="mt-2">
                <DateTimePicker value={project.shoot_date ? new Date(project.shoot_date) : new Date()} onChange={updateShootDate} />
              </div>
            )}
          </div>

          <div>
            <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">Standort</div>
            <LocationPicker
              address={project.location_address ?? ""}
              lat={project.location_lat}
              lng={project.location_lng}
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
            <TodoListsPanel projectId={project.id} todoLists={todoLists} members={members} onChange={onTodoListsChange} noMargin />
          </div>
        </div>
      </Collapsible>
    </div>
  );
}
