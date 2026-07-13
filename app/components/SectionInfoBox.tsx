"use client";

import { useState } from "react";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { Member, Section } from "@/lib/types";
import { Collapsible } from "./ui/Collapsible";
import { Switch } from "./ui/Switch";
import { LocationPicker } from "./ui/LocationPicker";
import { DateTimePicker } from "./ui/DateTimePicker";
import { Input } from "./ui/Field";
import { Avatar } from "./ui/Avatar";
import { Button, IconButton } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { TodoListsPanel } from "./TodoListsPanel";

/** Section-scoped counterpart to ProjectInfoBox, for multi-day shoots
 * (2026-07-10): a section can optionally carry its own mini info box (own
 * shoot date/location/todo lists, same fields/behavior as the project-level
 * one). Mirrors the iOS app's SectionInfoBox field-for-field. Unlike the
 * top-level ProjectInfoBox, this one CAN be deleted — the original
 * project-level box can't be moved or removed, only ones added to a section
 * can. */
export function SectionInfoBox({
  section,
  projectId,
  members,
  onOpenTeam,
  onSectionChange,
}: {
  section: Section;
  projectId: string;
  members: Member[];
  onOpenTeam: () => void;
  onSectionChange: (updated: Section) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [clientName, setClientName] = useState(section.client_name ?? "");

  async function updateClientName(value: string) {
    try {
      const updated = await api.patchSection(section.id, { client_name: value || null });
      onSectionChange(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function removeProjectInfo() {
    try {
      const updated = await api.patchSection(section.id, { remove_project_info: true });
      onSectionChange(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function updateShootDate(date: Date | null) {
    try {
      const updated = await api.patchSection(section.id, { shoot_date: date ? date.toISOString() : null });
      onSectionChange(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  async function updateLocation(address: string, lat: number | null, lng: number | null) {
    try {
      const updated = await api.patchSection(section.id, {
        location_address: address || undefined, location_lat: lat ?? undefined, location_lng: lng ?? undefined,
      });
      onSectionChange(updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Fehlgeschlagen.");
    }
  }

  // No more per-section "+ Projektinfo hinzufügen" button (2026-07-10,
  // Lino: it showed above every single section regardless of whether that
  // section had one yet, which read as clutter/confusing once "Projektinfo"
  // became its own option in the main "+ Hinzufügen" menu — that menu now
  // creates a section with project info already attached in one step, so
  // there's no longer a "plain section, add info later" path to support here.
  if (!section.has_project_info) {
    return null;
  }

  return (
    <div className="bg-white/[0.035] border border-white/8 rounded-2xl px-4 py-4 mb-5">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <Collapsible
            title={`Info: ${section.name}`}
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
                <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" />
              </svg>
            }
          >
            <div className="space-y-5 pt-1">
              <div>
                <Switch
                  checked={Boolean(section.shoot_date)}
                  onChange={(v) => updateShootDate(v ? new Date() : null)}
                  label="Drehdatum festlegen"
                />
                {section.shoot_date && (
                  <div className="mt-2">
                    <DateTimePicker value={new Date(section.shoot_date)} onChange={updateShootDate} />
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">Standort</div>
                <LocationPicker
                  address={section.location_address ?? ""}
                  lat={section.location_lat}
                  lng={section.location_lng}
                  onChange={updateLocation}
                />
              </div>

              <div>
                <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">Auftraggeber</div>
                <Input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  onBlur={() => updateClientName(clientName)}
                  placeholder="Name des Auftraggebers"
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
                  projectId={projectId}
                  sectionId={section.id}
                  todoLists={section.todo_lists}
                  members={members}
                  onChange={(updater) => onSectionChange({ ...section, todo_lists: updater(section.todo_lists) })}
                  noMargin
                />
              </div>
            </div>
          </Collapsible>
        </div>
        {/* Only added info boxes get this — the original top-level
            ProjectInfoBox has no delete button at all, by design. */}
        <IconButton size={28} onClick={removeProjectInfo} aria-label="Projektinfo löschen" className="text-white/40 hover:text-red-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6" />
          </svg>
        </IconButton>
      </div>
    </div>
  );
}
