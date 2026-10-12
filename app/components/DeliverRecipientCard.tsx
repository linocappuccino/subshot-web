"use client";

import { useEffect, useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import type { DeliverSettings } from "@/lib/types";
import { ClientLogoPicker } from "./ClientLogoPicker";

// 2026-10-12, Lino (Deliver page):
// - "Erinnerung vor dem Ablauf": the client (recipient e-mail) gets a friendly reminder N days
//   before the link expires — only if nothing was downloaded yet (cron, see backend
//   send_due_deliver_reminders); extending the link re-arms it.
// - "Persönliche Nachricht und Logo": a greeting shown on the public page + the client's logo
//   next to the team logo.

const REMINDER_DAYS = [1, 2, 3, 5, 7];

export function DeliverRecipientCard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const api = useApi();
  const toast = useToast();
  const { t, language } = useLanguage();
  const [st, setSt] = useState<DeliverSettings | null>(null);
  const [email, setEmail] = useState("");
  const [days, setDays] = useState(3);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .deliverSettings(projectId)
      .then((s) => {
        if (!alive) return;
        setSt(s);
        setEmail(s.recipient_email ?? "");
        setDays(s.reminder_days || 3);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, projectId]);

  const dirty = st !== null && (email !== (st.recipient_email ?? "") || days !== st.reminder_days);

  async function save() {
    setSaving(true);
    try {
      const s = await api.putDeliverSettings(projectId, { recipient_email: email, reminder_days: days });
      setSt(s);
      toast.showSuccess(t("deliverRecipient.saved"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (!st) return null;
  const field = "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30 disabled:opacity-60";
  const sentAt = st.reminder_sent_at
    ? new Date(st.reminder_sent_at).toLocaleString(language === "en" ? "en-GB" : "de-CH", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 mb-6">
      <h2 className="text-sm font-semibold text-white mb-1">{t("deliverRecipient.title")}</h2>
      <p className="text-xs text-white/40 mb-4">{t("deliverRecipient.hint")}</p>
      {/* 2026-10-12, Lino: "lassen wir das mit den begrüssungsnachrichten, das brauchen wir generell
          nicht" — name + personal message removed (several people open the same link); the email
          stays for the expiry reminder. */}
      <label className="flex max-w-sm flex-col gap-1 text-xs text-white/50">
        {t("deliverRecipient.email")}
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canEdit} placeholder="sandra@kunde.ch" className={field} />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-white/50">
        {t("deliverRecipient.reminder")}
        {REMINDER_DAYS.map((d) => (
          <button
            key={d}
            type="button"
            disabled={!canEdit}
            onClick={() => setDays(d)}
            className={`rounded-full px-3 py-1 transition-colors ${days === d ? "bg-white text-black" : "bg-white/5 text-white/70 hover:bg-white/10"}`}
          >
            {t(d === 1 ? "deliverRecipient.day" : "deliverRecipient.days", { n: d })}
          </button>
        ))}
        {sentAt && <span className="text-emerald-300/80">{t("deliverRecipient.sentAt", { when: sentAt })}</span>}
      </div>
      {/* 2026-10-12, Lino: logos come from the reusable library (ClientLogoPicker) */}
      <div className="mt-4">
        <ClientLogoPicker projectId={projectId} canEdit={canEdit} />
      </div>
      {canEdit && (
        <div className="mt-5 flex justify-end">
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
