"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Input, Label, FieldGroup } from "./ui/Field";
import { ColorPicker } from "./ui/ColorPicker";
import { ImageDropZone } from "./ui/ImageDropZone";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import type { ProjectFolder } from "@/lib/types";
import { PALETTE } from "@/lib/types";

// 2026-08-31 — perf pass: EmojiField pulls in emojiData.json (~232KB,
// the full German-localized Apple emoji catalog, see that component's own
// doc comment) — was a static import, so every visitor to this modal's
// page shipped that JSON regardless of whether they ever open the emoji
// picker (rarely). next/dynamic defers loading EmojiField's whole module
// (JSON included) into its own chunk, fetched only once this modal
// actually renders it. `ssr: false` since it's purely client-interactive
// (a Menu-based picker) with nothing meaningful to server-render anyway.
const EmojiField = dynamic(() => import("./ui/EmojiField").then((m) => m.EmojiField), { ssr: false });

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
  const { t } = useLanguage();
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

  // Existing background image — background_image_url is a presigned R2 URL
  // since #248 (2026-07-22), directly usable as the preview's src, no fetch
  // needed anymore (see AuthImage.tsx's updated doc comment).
  useEffect(() => {
    if (!open || !existing?.background_image_url) return;
    setImagePreview(existing.background_image_url);
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
    <Modal open={open} onClose={onClose} title={existing ? t("folderEditModal.editTitle") : t("folderEditModal.newTitle")}>
      <FieldGroup>
        <Label>{t("folderEditModal.name")}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("folderEditModal.namePlaceholder")} autoFocus />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("folderEditModal.emoji")}</Label>
        <EmojiField value={emoji} onChange={setEmoji} />
      </FieldGroup>
      <FieldGroup>
        <Label>{t("folderEditModal.color")}</Label>
        <ColorPicker value={color} onChange={setColor} />
      </FieldGroup>
      <FieldGroup className="mb-0">
        <Label>{t("folderEditModal.backgroundImage")}</Label>
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
            {t("folderEditModal.removeImage")}
          </button>
        )}
      </FieldGroup>
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
