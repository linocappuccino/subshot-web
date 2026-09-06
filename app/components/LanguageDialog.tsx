"use client";

import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useLanguage, type Language } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";
import { useToast } from "./ui/Toast";
import { ApiError } from "@/lib/api";

/** 2026-07-21 — opened from AppShell's UserButton custom "Sprache/Language"
 * action. Deliberately just two big buttons, not a dropdown/select — this
 * is a rare, high-consequence choice (changes the whole app's language),
 * matches how the Farbe/Emoji pickers elsewhere in this app favor a small
 * set of large tappable options over a compact form control. */
export function LanguageDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { language, setLanguage, t } = useLanguage();
  const api = useApi();
  const toast = useToast();

  async function pick(lang: Language) {
    if (lang === language) {
      onClose();
      return;
    }
    setLanguage(lang);
    try {
      await api.patchMe({ language: lang });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : "Sprache konnte nicht gespeichert werden.");
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title={t("language.dialogTitle")}>
      <div className="flex flex-col gap-2 p-4">
        <Button
          variant={language === "de" ? "primary" : "secondary"}
          onClick={() => pick("de")}
          className="justify-start"
        >
          {t("language.german")}
        </Button>
        <Button
          variant={language === "en" ? "primary" : "secondary"}
          onClick={() => pick("en")}
          className="justify-start"
        >
          {t("language.english")}
        </Button>
      </div>
    </Modal>
  );
}
