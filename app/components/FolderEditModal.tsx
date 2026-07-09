"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { EmojiField } from "./ui/EmojiField";
import { ColorPicker } from "./ui/ColorPicker";
import { ImageDropZone } from "./ui/ImageDropZone";
import { useApi } from "@/lib/useApi";
import type { ProjectFolder } from "@/lib/types";
import { PALETTE } from "@/lib/types";

export function FolderEditModal({
  open,
  onClose,
  existing,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  existing: ProjectFolder | null;
  onSave: (name: string, color: string, emoji: string | null, imageFile: File | null, clearImage: boolean) => Promise<void>;
}) {
  const api = useApi();
  const [name, setName] = useState(existing?.name ?? "");
  const [color, setColor] = useState(existing?.color ?? PALETTE[0]);
  const [emoji, setEmoji] = useState(existing?.emoji ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [clearImage, setClearImage] = useState(false);
  const [saving, setSaving] = useState(false);

  // Re-seed local state whenever a different folder opens (or "new") -
  // Modal stays mounted (for its exit animation), so this can't rely on
  // fresh useState defaults alone.
  const [openedFor, setOpenedFor] = useState(existing?.id ?? "new");
  if (open && openedFor !== (existing?.id ?? "new")) {
    setOpenedFor(existing?.id ?? "new");
    setName(existing?.name ?? "");
    setColor(existing?.color ?? PALETTE[0]);
    setEmoji(existing?.emoji ?? "");
    setImageFile(null);
    setImagePreview(null);
    setClearImage(false);
  }

  // Existing background image needs the same authenticated fetch as every
  // other upload in this app (see AuthImage) - a plain <img src> can't
  // attach the Bearer token.
  useEffect(() => {
    if (!open || !existing?.background_image_url) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api.fetchImageBlobUrl(existing.background_image_url).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setImagePreview(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id, existing?.background_image_url]);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSave(trimmed, color, emoji.trim() || null, imageFile, clearImage);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? "Ordner bearbeiten" : "Neuer Ordner"}>
      <FieldGroup>
        <Label>Name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Kunde XY" autoFocus />
      </FieldGroup>
      <FieldGroup>
        <Label>Emoji</Label>
        <EmojiField value={emoji} onChange={setEmoji} />
      </FieldGroup>
      <FieldGroup>
        <Label>Farbe</Label>
        <ColorPicker value={color} onChange={setColor} />
      </FieldGroup>
      <FieldGroup className="mb-0">
        <Label>Hintergrundbild</Label>
        <ImageDropZone
          previewUrl={imagePreview}
          onFile={(file) => {
            setImageFile(file);
            setClearImage(false);
            setImagePreview(URL.createObjectURL(file));
          }}
          className="h-32"
        />
        {imagePreview && (
          <button
            type="button"
            onClick={() => {
              setImageFile(null);
              setImagePreview(null);
              setClearImage(true);
            }}
            className="text-xs text-white/40 hover:text-red-400 transition-colors mt-1.5"
          >
            Bild entfernen
          </button>
        )}
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
