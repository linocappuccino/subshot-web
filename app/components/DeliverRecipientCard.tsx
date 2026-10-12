"use client";

import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import type { DeliverSettings } from "@/lib/types";

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
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [days, setDays] = useState(3);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api
      .deliverSettings(projectId)
      .then((s) => {
        if (!alive) return;
        setSt(s);
        setName(s.recipient_name ?? "");
        setEmail(s.recipient_email ?? "");
        setMessage(s.message ?? "");
        setDays(s.reminder_days || 3);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, projectId]);

  const dirty = st !== null && (name !== (st.recipient_name ?? "") || email !== (st.recipient_email ?? "") || message !== (st.message ?? "") || days !== st.reminder_days);

  async function save() {
    setSaving(true);
    try {
      const s = await api.putDeliverSettings(projectId, { recipient_name: name, recipient_email: email, message, reminder_days: days });
      setSt(s);
      toast.showSuccess(t("deliverRecipient.saved"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function uploadLogo(file: File) {
    setLogoBusy(true);
    try {
      const type = file.type || "image/png";
      const { key, upload_url } = await api.startDeliverLogoUpload(projectId, file.name, type);
      await api.putFile(upload_url, file, type);
      setSt(await api.completeDeliverLogoUpload(projectId, key));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
    } finally {
      setLogoBusy(false);
    }
  }

  async function removeLogo() {
    setLogoBusy(true);
    try {
      setSt(await api.deleteDeliverLogo(projectId));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
    } finally {
      setLogoBusy(false);
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
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-white/50">
          {t("deliverRecipient.name")}
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} placeholder="Sandra Muster" className={field} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/50">
          {t("deliverRecipient.email")}
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canEdit} placeholder="sandra@kunde.ch" className={field} />
        </label>
      </div>
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
      <label className="mt-4 flex flex-col gap-1 text-xs text-white/50">
        {t("deliverRecipient.message")}
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={!canEdit}
          rows={4}
          maxLength={2000}
          placeholder={t("deliverRecipient.messagePlaceholder")}
          className={`${field} resize-y leading-relaxed`}
        />
      </label>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-xs text-white/50">{t("deliverRecipient.logo")}</span>
        {st.client_logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
          <img src={st.client_logo_url} alt="" className="h-10 w-auto max-w-[140px] object-contain rounded bg-white/5 p-1" />
        ) : (
          <span className="text-xs text-white/30">{t("deliverRecipient.noLogo")}</span>
        )}
        {canEdit && (
          <>
            <Button variant="secondary" size="sm" disabled={logoBusy} onClick={() => logoInput.current?.click()}>
              {logoBusy ? t("common.saving") : st.client_logo_url ? t("deliverRecipient.replaceLogo") : t("deliverRecipient.uploadLogo")}
            </Button>
            {st.client_logo_url && (
              <button type="button" disabled={logoBusy} onClick={removeLogo} className="text-xs text-white/40 hover:text-red-400">
                {t("deliverRecipient.removeLogo")}
              </button>
            )}
          </>
        )}
      </div>
      {canEdit && (
        <div className="mt-5 flex justify-end">
          <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      )}
      <input
        ref={logoInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void uploadLogo(f);
        }}
      />
    </div>
  );
}
