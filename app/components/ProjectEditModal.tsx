"use client";

import { useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { EmojiField } from "./ui/EmojiField";
import { ColorPicker } from "./ui/ColorPicker";
import type { Project } from "@/lib/types";
import { PALETTE } from "@/lib/types";

export function ProjectEditModal({
  open,
  onClose,
  existing,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  existing: Project | null;
  onSave: (name: string, color: string, emoji: string | null) => Promise<void>;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? PALETTE[0]);
  const [emoji, setEmoji] = useState(existing?.emoji ?? "");
  const [saving, setSaving] = useState(false);

  const [openedFor, setOpenedFor] = useState(existing?.id ?? "new");
  if (open && openedFor !== (existing?.id ?? "new")) {
    setOpenedFor(existing?.id ?? "new");
    setName(existing?.name ?? "");
    setColor(existing?.color ?? PALETTE[0]);
    setEmoji(existing?.emoji ?? "");
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave(trimmed, color, emoji.trim() || null);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? "Projekt bearbeiten" : "Neues Projekt"}>
      <FieldGroup>
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Projektname"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
        />
      </FieldGroup>
      <FieldGroup>
        <Label>Emoji</Label>
        <EmojiField value={emoji} onChange={setEmoji} />
      </FieldGroup>
      <FieldGroup className="mb-0">
        <Label>Farbe</Label>
        <ColorPicker value={color} onChange={setColor} />
      </FieldGroup>
      <div className="flex justify-end gap-2 mt-6">
        <Button variant="ghost" onClick={onClose}>
          Abbrechen
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!name.trim() || saving}>
          {saving ? "Speichert…" : "Speichern"}
        </Button>
      </div>
    </Modal>
  );
}
