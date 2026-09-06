"use client";

import { useEffect, useState } from "react";
import { Modal } from "./ui/Modal";
import { Switch } from "./ui/Switch";
import { useLanguage } from "@/lib/i18n";
import { useApi } from "@/lib/useApi";
import { useToast } from "./ui/Toast";
import { ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";

type EmailPrefKey = "email_notify_idea_feedback" | "email_notify_video_feedback" | "email_notify_postproduction_status";

/** 2026-07-28 — opened from AppShell's UserButton custom "Benachrichtigungen"
 * action, sibling to LanguageDialog. Lino: "in den account einstellungen
 * soll man einstellen koennen welche email benachrichtigungen man moechte".
 * Only these 3 kinds ever send an email at all (see app/notifications.py) —
 * project/team invite emails aren't listed here on purpose, they're the only
 * way you'd learn you were invited in the first place. Toggling one off only
 * silences the EMAIL; the in-app bell + push notification for that same
 * event still fires either way. */
export function NotificationSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useLanguage();
  const api = useApi();
  const toast = useToast();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    if (!open) return;
    api.me().then(setMe).catch(() => {});
  }, [open, api]);

  async function toggle(key: EmailPrefKey, value: boolean) {
    if (!me) return;
    setMe({ ...me, [key]: value });
    try {
      await api.patchMe({ [key]: value });
    } catch (e) {
      setMe((prev) => (prev ? { ...prev, [key]: !value } : prev));
      toast.showError(e instanceof ApiError ? e.message : t("notificationSettings.saveError"));
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("notificationSettings.dialogTitle")}>
      {!me ? null : (
        <div className="flex flex-col gap-4">
          <div>
            <Switch
              checked={me.email_notify_idea_feedback}
              onChange={(v) => toggle("email_notify_idea_feedback", v)}
              label={t("notificationSettings.ideaFeedback")}
            />
            <div className="text-xs text-white/50 mt-0.5">{t("notificationSettings.ideaFeedbackHint")}</div>
          </div>
          <div>
            <Switch
              checked={me.email_notify_video_feedback}
              onChange={(v) => toggle("email_notify_video_feedback", v)}
              label={t("notificationSettings.videoFeedback")}
            />
            <div className="text-xs text-white/50 mt-0.5">{t("notificationSettings.videoFeedbackHint")}</div>
          </div>
          <div>
            <Switch
              checked={me.email_notify_postproduction_status}
              onChange={(v) => toggle("email_notify_postproduction_status", v)}
              label={t("notificationSettings.postproductionStatus")}
            />
            <div className="text-xs text-white/50 mt-0.5">{t("notificationSettings.postproductionStatusHint")}</div>
          </div>
        </div>
      )}
    </Modal>
  );
}
