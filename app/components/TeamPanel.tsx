"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { Avatar } from "./ui/Avatar";
import { ConfirmDialog } from "./ui/ConfirmDialog";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "./ui/Toast";
import type { InviteRole, Member } from "@/lib/types";

const ROLE_LABELS: Record<string, string> = { owner: "Besitzer", editor: "Bearbeiter", viewer: "Betrachter" };

export function TeamPanel({
  open,
  onClose,
  projectId,
  members,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: Member[];
  onChange: (updater: (members: Member[]) => Member[]) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InviteRole>("editor");
  const [inviting, setInviting] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  async function sendInvite() {
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviting(true);
    try {
      await api.invite(projectId, trimmed, role);
      toast.showSuccess(`Einladung an ${trimmed} verschickt.`);
      setEmail("");
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Einladung fehlgeschlagen.");
    } finally {
      setInviting(false);
    }
  }

  async function removeMember() {
    if (!removeTarget) return;
    try {
      await api.removeMember(projectId, removeTarget.user_id);
      onChange((prev) => prev.filter((m) => m.user_id !== removeTarget.user_id));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Entfernen fehlgeschlagen.");
    } finally {
      setRemoveTarget(null);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Team">
        <FieldGroup>
          <Label>Person einladen</Label>
          <div className="flex gap-2">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendInvite()}
              placeholder="email@beispiel.ch"
              className="flex-1"
            />
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as InviteRole)}
              className="bg-white/5 border border-white/10 rounded-xl px-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            >
              <option value="editor">Bearbeiter</option>
              <option value="viewer">Betrachter</option>
            </select>
          </div>
          <Button variant="primary" size="sm" className="mt-2" onClick={sendInvite} disabled={!email.trim() || inviting}>
            {inviting ? "Sendet…" : "Einladen"}
          </Button>
        </FieldGroup>

        <FieldGroup className="mb-0">
          <Label>Mitglieder</Label>
          <div className="space-y-1">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2.5 py-1.5">
                <Avatar name={m.name} email={m.email} avatarUrl={m.avatar_url} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{m.name || m.email}</div>
                  <div className="text-xs text-white/40">{ROLE_LABELS[m.role] ?? m.role}</div>
                </div>
                {m.role !== "owner" && (
                  <button
                    onClick={() => setRemoveTarget(m)}
                    className="text-xs text-white/30 hover:text-red-400 transition-colors shrink-0"
                  >
                    Entfernen
                  </button>
                )}
              </div>
            ))}
          </div>
        </FieldGroup>
      </Modal>

      <ConfirmDialog
        open={removeTarget !== null}
        title="Mitglied entfernen?"
        message={`${removeTarget?.name || removeTarget?.email} verliert den Zugriff auf dieses Projekt.`}
        onConfirm={removeMember}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  );
}
