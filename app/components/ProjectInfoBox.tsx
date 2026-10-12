"use client";

import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import type { InfoMember, Member, Project, TodoList } from "@/lib/types";
import { Collapsible } from "./ui/Collapsible";
import { Switch } from "./ui/Switch";
import { LocationPicker } from "./ui/LocationPicker";
import { DateTimePicker } from "./ui/DateTimePicker";
import { Textarea } from "./ui/Field";
import { Avatar } from "./ui/Avatar";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { TodoListsPanel } from "./TodoListsPanel";
import { useLanguage } from "@/lib/i18n";

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
  showDateLocation = true,
}: {
  project: Project;
  members: Member[];
  onProjectChange: (updater: (p: Project) => Project) => void;
  onOpenTeam: () => void;
  todoLists: TodoList[];
  onTodoListsChange: (updater: (lists: TodoList[]) => TodoList[]) => void;
  /** 2026-07-19, Lino: Drehdatum/Standort raus aus der Ideen-Workflow-Instanz
   * dieser Box — die Szenenübersicht-Instanz (#234) zeigt sie weiterhin, da
   * dort explizit gewünscht. Default true, damit bestehende Call-Sites ohne
   * Änderung ihr bisheriges Verhalten behalten. */
  showDateLocation?: boolean;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  // 2026-08-09 (#27), Lino: "soll in den Projektinfos nur immer der
  // Ersteller drin sein, hier kann man dann als Info mehrere Personen
  // hinzufügen" — a SEPARATE roster from `members` (the full editor/
  // projektleiter/owner roster this box used to render in full, see
  // InfoMember's own doc comment in lib/types.ts). Fetched independently
  // since it's a small, own-purpose list, same "own round trip" reasoning
  // TodoListsPanel already uses for its own data.
  const [infoMembers, setInfoMembers] = useState<InfoMember[]>([]);
  const [showInfoMemberPicker, setShowInfoMemberPicker] = useState(false);
  useEffect(() => {
    api.infoMembers(project.id).then(setInfoMembers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  const infoMemberIds = new Set(infoMembers.map((m) => m.user_id));
  async function toggleInfoMember(userId: string, isIn: boolean) {
    try {
      if (isIn) {
        await api.removeInfoMember(project.id, userId);
        setInfoMembers((prev) => prev.filter((m) => m.user_id !== userId));
      } else {
        const added = await api.addInfoMember(project.id, userId);
        setInfoMembers((prev) => [...prev, added]);
      }
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("projectInfoBox.genericFailed"));
    }
  }
  const [hasShootDate, setHasShootDate] = useState(Boolean(project.shoot_date));
  const [description, setDescription] = useState(project.description ?? "");
  // Same monotonic-request-id guard as updateLocation below — typing fast
  // and having an earlier keystroke's slower response land last would
  // otherwise silently revert the field mid-edit.
  const descriptionRequestId = useRef(0);
  async function updateDescription(value: string) {
    const requestId = ++descriptionRequestId.current;
    try {
      const updated = await api.patchProject(project.id, { description: value || null });
      if (requestId === descriptionRequestId.current) onProjectChange(() => updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("projectInfoBox.genericFailed"));
    }
  }
  async function updateShootDate(date: Date | null) {
    try {
      const updated = await api.patchProject(project.id, { shoot_date: date ? date.toISOString() : null });
      onProjectChange(() => updated);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("projectInfoBox.genericFailed"));
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
      toast.showError(e instanceof ApiError ? e.message : t("projectInfoBox.genericFailed"));
    }
  }

  return (
    <div className="bg-white/[0.035] border border-white/8 rounded-2xl px-4 py-4 mb-8">
      <Collapsible
        title={t("projectInfoBox.title")}
        defaultOpen={false}
        icon={
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/40">
            <circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" />
          </svg>
        }
      >
        <div className="space-y-5 pt-1">
          {showDateLocation && (
            <div>
              <Switch
                checked={hasShootDate}
                onChange={(v) => {
                  setHasShootDate(v);
                  updateShootDate(v ? new Date() : null);
                }}
                label={t("projectInfoBox.setShootDate")}
              />
              {hasShootDate && (
                <div className="mt-2">
                  <DateTimePicker value={project.shoot_date ? new Date(project.shoot_date) : null} onChange={updateShootDate} />
                </div>
              )}
            </div>
          )}

          {showDateLocation && (
            <div>
              <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">{t("projectInfoBox.location")}</div>
              <LocationPicker
                address={project.location_address ?? ""}
                lat={project.location_lat}
                lng={project.location_lng}
                onChange={updateLocation}
              />
            </div>
          )}

          <div>
            <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">{t("projectInfoBox.descriptionIdea")}</div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => updateDescription(description)}
              placeholder={t("projectInfoBox.descriptionPlaceholder")}
              rows={3}
              autoResize
            />
          </div>

          <div>
            <div className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-1.5">{t("projectInfoBox.team")}</div>
            {/* 2026-08-09 (#27) — only the creator + explicitly added info
                members render here now, not the full `members` roster (that
                full roster is still what onOpenTeam's Team-invite sheet
                manages — unrelated, unchanged). "+" opens a small checklist
                built from `members` (the pool of people already reachable
                on this project/team) to toggle who's shown here. */}
            <div className="flex items-center gap-2 flex-wrap relative">
              {infoMembers.map((m) => (
                <Avatar key={m.user_id} name={m.name} email={m.email} avatarUrl={m.avatar_url} size={30} />
              ))}
              <div className="relative">
                <Button variant="ghost" size="sm" onClick={() => setShowInfoMemberPicker((v) => !v)}>
                  +
                </Button>
                {showInfoMemberPicker && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setShowInfoMemberPicker(false)} />
                    <div className="absolute left-0 top-full mt-1 z-20 w-56 max-h-64 overflow-y-auto rounded-xl bg-[#242426] border border-white/10 shadow-2xl p-1.5">
                      {members
                        .filter((m) => m.role !== "owner")
                        .map((m) => {
                          const isIn = infoMemberIds.has(m.user_id);
                          return (
                            <button
                              key={m.user_id}
                              onClick={() => toggleInfoMember(m.user_id, isIn)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 text-left text-sm"
                            >
                              <Avatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={22} />
                              <span className="flex-1 truncate">{m.name || m.email}</span>
                              {isIn && (
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400 shrink-0">
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                              )}
                            </button>
                          );
                        })}
                      {members.filter((m) => m.role !== "owner").length === 0 && (
                        <p className="text-xs text-white/40 px-2 py-1.5">{t("projectInfoBox.noOtherMembers")}</p>
                      )}
                    </div>
                  </>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={onOpenTeam}>
                {t("projectInfoBox.manage")}
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
