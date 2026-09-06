"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { ColorPicker } from "./ui/ColorPicker";
import { Avatar } from "./ui/Avatar";
import { useApi } from "@/lib/useApi";
import type { InviteRole, Project, TeamMember } from "@/lib/types";
import { PALETTE } from "@/lib/types";
import { useLanguage, type TranslationKey } from "@/lib/i18n";

// 2026-08-31 — perf pass, same reasoning as FolderEditModal's identical
// change: defers EmojiField's ~232KB emoji JSON out of this modal's (and
// thus this whole page's) initial bundle into its own on-demand chunk.
const EmojiField = dynamic(() => import("./ui/EmojiField").then((m) => m.EmojiField), { ssr: false });

export type ProjectMemberPick = { email: string; role: InviteRole };

export type ProjectModules = {
  module_concept: boolean;
  module_scripting: boolean;
  module_postproduction: boolean;
};

const DEFAULT_MODULES: ProjectModules = {
  module_concept: true,
  module_scripting: true,
  module_postproduction: true,
};

// 2026-07-17, Lino, #96 (erster Baustein der grossen Pipeline-Vision:
// Idee -> Scripting -> Postproduction -> Video-Feedback): "Beim Projekt
// erstellen sollen Checkboxen kommen... einzeln markierbar, welche
// Pipelines fuer das Projekt genutzt werden."
// 2026-07-19: seit hier ein echtes Freischalt-Gate (vorher rein
// informativ) — siehe projects/[id]/page.tsx und postproduction/page.tsx.
// Wählt man z.B. nur Postproduction, landet das Projekt direkt dort und
// Ideen/Scripting sind gesperrt, bis man sie hier wieder aktiviert.
// 2026-07-19, Lino: "Postproduction tracking und video feedback sind das
// gleiche, diese zu einem Punkt zusammenführen" — module_video_feedback
// wurde nirgends als eigenes Gate gelesen (das Video-Feedback-Tool lebt
// ohnehin AUF der Postproduction-Seite, keine eigene Route), komplett
// entfernt statt nur in der UI verschmolzen.
const MODULE_OPTIONS: { key: keyof ProjectModules; labelKey: TranslationKey }[] = [
  { key: "module_concept", labelKey: "projectEditModal.moduleConcept" },
  { key: "module_scripting", labelKey: "projectEditModal.moduleScripting" },
  { key: "module_postproduction", labelKey: "projectEditModal.modulePostproduction" },
];

export function ProjectEditModal({
  open,
  onClose,
  existing,
  teamId,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  existing: Project | null;
  /** 2026-07-17, Lino: "drückt man + Projekt muss man auch definieren wer
   * zu diesem Projekt hinzugefügt wird" — nur bei Neuanlage relevant
   * (siehe unten, `!existing`), und nur wenn der User überhaupt ein Team
   * hat (Solo-Nutzer ohne Team haben niemanden, den sie hinzufügen
   * könnten). Der Ersteller selbst wird automatisch hinzugefügt (schon
   * bisheriges Verhalten via Project.owner_id, kein UI-Zutun nötig). */
  teamId?: string | null;
  onSave: (
    name: string,
    color: string,
    emoji: string | null,
    modules: ProjectModules,
    members: ProjectMemberPick[],
    clientName: string | null
  ) => Promise<void>;
}) {
  const api = useApi();
  const { t } = useLanguage();
  // 2026-07-29, Lino: "zuerst Auftraggeber, dann Projektname" — asked first
  // in the dialog (see JSX order below) and, once saved, shown alongside
  // the name in every pipeline page's header (projects/[id]/page.tsx +
  // postproduction/page.tsx). Reuses the client_name column that already
  // existed on Project (see its own comment in models.py) but was never
  // asked for at creation time before now.
  const [clientName, setClientName] = useState(existing?.client_name ?? "");
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? PALETTE[0]);
  const [emoji, setEmoji] = useState(existing?.emoji ?? "");
  const [modules, setModules] = useState<ProjectModules>(
    existing
      ? {
          module_concept: existing.module_concept,
          module_scripting: existing.module_scripting,
          module_postproduction: existing.module_postproduction,
        }
      : DEFAULT_MODULES
  );
  const [saving, setSaving] = useState(false);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [pickedMembers, setPickedMembers] = useState<Record<string, InviteRole>>({});
  // 2026-07-18 (Todoist #193, Lino: "kann man immernoch nicht Personen zum
  // Projekt hinzufügen") — this modal used to ONLY offer team members to
  // pick from, entirely hidden for a user with no Team at all ("niemanden,
  // den sie hinzufügen könnten" — wrong: create_invite (main.py) accepts
  // any raw email for a project with no team_id, no Team membership
  // required). Manual email entry works for every user, team or not.
  const [manualEmail, setManualEmail] = useState("");
  const [manualRole, setManualRole] = useState<InviteRole>("editor");
  const manualEmails = Object.keys(pickedMembers).filter((email) => !teamMembers.some((m) => m.email === email));

  useEffect(() => {
    if (!open || existing) return;
    setPickedMembers({});
    setManualEmail("");
    setManualRole("editor");
    if (teamId) api.teamMembers(teamId).then(setTeamMembers).catch(() => setTeamMembers([]));
    else setTeamMembers([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing, teamId]);

  function addManualEmail() {
    const trimmed = manualEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes("@")) return;
    setPickedMembers((prev) => ({ ...prev, [trimmed]: manualRole }));
    setManualEmail("");
    setManualRole("editor");
  }

  const [openedFor, setOpenedFor] = useState(existing?.id ?? "new");
  if (open && openedFor !== (existing?.id ?? "new")) {
    setOpenedFor(existing?.id ?? "new");
    setClientName(existing?.client_name ?? "");
    setName(existing?.name ?? "");
    setColor(existing?.color ?? PALETTE[0]);
    setEmoji(existing?.emoji ?? "");
    setModules(
      existing
        ? {
            module_concept: existing.module_concept,
            module_scripting: existing.module_scripting,
            module_postproduction: existing.module_postproduction,
          }
        : DEFAULT_MODULES
    );
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      const members: ProjectMemberPick[] = Object.entries(pickedMembers).map(([email, role]) => ({ email, role }));
      await onSave(trimmed, color, emoji.trim() || null, modules, members, clientName.trim() || null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? t("projectEditModal.editTitle") : t("projectEditModal.newTitle")}>
      <FieldGroup>
        <Label>{t("projectEditModal.clientName")}</Label>
        <Input
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder={t("projectEditModal.clientNamePlaceholder")}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("projectEditModal.name")}</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("projectEditModal.namePlaceholder")}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("projectEditModal.emoji")}</Label>
        <EmojiField value={emoji} onChange={setEmoji} />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("projectEditModal.color")}</Label>
        <ColorPicker value={color} onChange={setColor} />
      </FieldGroup>
      <FieldGroup className={teamMembers.length > 0 ? undefined : "mb-0"}>
        <Label>{t("projectEditModal.pipelineModules")}</Label>
        <div className="flex flex-col gap-2">
          {MODULE_OPTIONS.map((opt) => {
            // 2026-07-19, Lino: Module sind jetzt ein echtes Freischalt-Gate
            // (nicht mehr rein informativ) — mindestens eines muss aktiv
            // bleiben, sonst hätte das Projekt gar keine erreichbare Seite
            // mehr. Das letzte verbleibende Häkchen ist darum gesperrt statt
            // erst beim Speichern eine Fehlermeldung zu zeigen.
            const isOnlyOneChecked = modules[opt.key] && Object.values(modules).filter(Boolean).length === 1;
            return (
              <label
                key={opt.key}
                className={`flex items-center gap-2 text-sm text-white/80 select-none ${isOnlyOneChecked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={modules[opt.key]}
                  disabled={isOnlyOneChecked}
                  onChange={(e) => setModules((prev) => ({ ...prev, [opt.key]: e.target.checked }))}
                  className="w-4 h-4 rounded border-white/20 bg-white/5 accent-blue-500 cursor-pointer disabled:cursor-not-allowed"
                />
                {t(opt.labelKey)}
              </label>
            );
          })}
        </div>
      </FieldGroup>
      {/* 2026-07-17, Lino: "drückt man + Projekt muss man auch definieren
          wer zu diesem Projekt hinzugefügt wird" — nur bei Neuanlage
          (existing===null). Der Ersteller selbst braucht keinen Eintrag
          (automatisch via Project.owner_id).
          2026-07-18 (Todoist #193): shown for EVERY user now, not just
          those with an existing Team — the manual email row below works
          regardless (create_invite needs no Team at all for a project
          that has none). */}
      {!existing && (
        <FieldGroup className="mb-0">
          <Label>{t("projectEditModal.addPeople")}</Label>
          <div className="flex flex-col gap-1.5">
            {teamMembers.filter((m) => m.status === "active" && !m.is_owner).map((m) => {
              const picked = pickedMembers[m.email];
              return (
                <div key={m.id} className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={picked !== undefined}
                    onChange={(e) =>
                      setPickedMembers((prev) => {
                        const next = { ...prev };
                        if (e.target.checked) next[m.email] = "editor";
                        else delete next[m.email];
                        return next;
                      })
                    }
                    className="w-4 h-4 rounded border-white/20 bg-white/5 accent-blue-500 cursor-pointer shrink-0"
                  />
                  <Avatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={24} />
                  <span className="text-sm text-white/80 flex-1 min-w-0 truncate">{m.name || m.email}</span>
                  {picked !== undefined && (
                    <select
                      value={picked}
                      onChange={(e) => setPickedMembers((prev) => ({ ...prev, [m.email]: e.target.value as InviteRole }))}
                      className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50 shrink-0"
                    >
                      <option value="projektleiter">{t("roles.projectLead")}</option>
                      <option value="editor">{t("roles.editor")}</option>
                    </select>
                  )}
                </div>
              );
            })}
            {manualEmails.map((email) => (
              <div key={email} className="flex items-center gap-2.5">
                <Avatar name={null} email={email} size={24} />
                <span className="text-sm text-white/80 flex-1 min-w-0 truncate">{email}</span>
                <select
                  value={pickedMembers[email]}
                  onChange={(e) => setPickedMembers((prev) => ({ ...prev, [email]: e.target.value as InviteRole }))}
                  className="bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50 shrink-0"
                >
                  <option value="projektleiter">{t("roles.projectLead")}</option>
                  <option value="editor">{t("roles.editor")}</option>
                </select>
                <button
                  type="button"
                  onClick={() => setPickedMembers((prev) => { const next = { ...prev }; delete next[email]; return next; })}
                  className="text-white/40 hover:text-red-400 shrink-0 w-5 h-5 flex items-center justify-center"
                  aria-label={t("common.remove")}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 mt-1">
              <Input
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManualEmail();
                  }
                }}
                placeholder={t("projectEditModal.emailPlaceholder")}
                className="flex-1"
              />
              <select
                value={manualRole}
                onChange={(e) => setManualRole(e.target.value as InviteRole)}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/50 shrink-0"
              >
                <option value="projektleiter">{t("roles.projectLead")}</option>
                <option value="editor">{t("roles.editor")}</option>
              </select>
              <Button type="button" variant="ghost" onClick={addManualEmail} disabled={!manualEmail.trim()}>
                +
              </Button>
            </div>
          </div>
        </FieldGroup>
      )}
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!name.trim() || saving}>
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </Modal>
  );
}
