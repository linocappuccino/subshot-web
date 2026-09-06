"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Textarea, Label, FieldGroup } from "./ui/Field";
import { SegmentedControl } from "./ui/SegmentedControl";
import { useLanguage } from "@/lib/i18n";

/** "AI Bild generieren" popup (2026-07-17, Lino) — replaces the old inline
 * row of aspect-ratio/style switches + button that sat permanently under
 * the image box on both the Scene and Idea tiles. A dedicated, editable
 * "Bilderprompt" textarea (pre-filled from the scene's description / the
 * idea's text as a starting point, but no longer silently locked to it)
 * plus format + style switches + "Generieren", all in one place. Clicking
 * Generieren closes the popup and kicks off the fire-and-forget generation
 * exactly like before — this only changes where the controls live, not
 * the generation flow itself. */
export function ImageGeneratePopup({
  open,
  onClose,
  initialPrompt,
  onGenerate,
}: {
  open: boolean;
  onClose: () => void;
  initialPrompt: string;
  onGenerate: (prompt: string, style: "realistic" | "sketch" | "funny_sketch", aspectRatio: "16:9" | "9:16") => void;
}) {
  const { t } = useLanguage();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16">("16:9");
  const [style, setStyle] = useState<"realistic" | "sketch" | "funny_sketch">("realistic");

  // Re-seed the prompt from the current description/text each time the
  // popup opens — not on every keystroke elsewhere, only at open time, so
  // editing the prompt here never fights with the card's own autosave.
  useEffect(() => {
    if (open) setPrompt(initialPrompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function handleGenerate() {
    if (!prompt.trim()) return;
    onGenerate(prompt.trim(), style, aspectRatio);
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={t("imageGeneratePopup.title")}>
      <FieldGroup>
        <Label>{t("imageGeneratePopup.promptLabel")}</Label>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={7}
          placeholder={t("imageGeneratePopup.promptPlaceholder")}
          autoFocus
        />
      </FieldGroup>
      <div className="flex flex-wrap items-stretch gap-2">
        <div className="w-24">
          <SegmentedControl
            value={aspectRatio}
            onChange={setAspectRatio}
            options={[{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }]}
          />
        </div>
        <div className="w-56">
          <SegmentedControl
            value={style}
            onChange={setStyle}
            options={[
              { value: "realistic", label: t("imageGeneratePopup.styleRealistic") },
              { value: "sketch", label: t("imageGeneratePopup.styleSketch") },
              { value: "funny_sketch", label: t("imageGeneratePopup.styleFunnySketch") },
            ]}
          />
        </div>
        <Button variant="primary" size="sm" disabled={!prompt.trim()} onClick={handleGenerate}>
          {t("imageGeneratePopup.generate")}
        </Button>
      </div>
      <p className="text-[11px] text-white/25 mt-2">{t("imageGeneratePopup.creditsLabel")}</p>
    </Modal>
  );
}
