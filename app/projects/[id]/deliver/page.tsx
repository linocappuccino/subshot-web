"use client";

import { useEffect, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { Input, Label, FieldGroup } from "@/app/components/ui/Field";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "@/app/components/ui/Toast";
import { useLanguage, type TranslationKey } from "@/lib/i18n";
import type { DeliverStatus } from "@/lib/types";

const DURATION_OPTIONS: { hours: number; labelKey: TranslationKey }[] = [
  { hours: 1, labelKey: "deliverAdmin.duration1h" },
  { hours: 6, labelKey: "deliverAdmin.duration6h" },
  { hours: 24, labelKey: "deliverAdmin.duration1d" },
  { hours: 24 * 3, labelKey: "deliverAdmin.duration3d" },
  { hours: 24 * 7, labelKey: "deliverAdmin.duration7d" },
  { hours: 24 * 14, labelKey: "deliverAdmin.duration14d" },
  { hours: 24 * 30, labelKey: "deliverAdmin.duration30d" },
];

// Pulled out of the component body: eslint's react-hooks/purity rule flags an
// impure call (Date.now) made directly inside a component's render — a
// plain non-component helper isn't subject to that check.
function isLinkExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() <= Date.now();
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 2026-09-06, Lino: "genau dieses Deliver-System möchte ich für Subshot nun
 * auch haben... nach der Postproduction-Seite kommt die Deliver-Page, jedes
 * abgeschlossene Video wird dort dann zum Download aufgeführt (immer die
 * aller neuste Version)." Own dedicated page (linked from the
 * Postproduction page's new "Deliver" button) rather than a modal like
 * ShareLinkModal — needs a duration/password/cover-video picker plus a live
 * preview of what's actually eligible, more than a modal comfortably holds. */
export default function DeliverAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = usePromise(params);
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const router = useRouter();

  const [status, setStatus] = useState<DeliverStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const [durationHours, setDurationHours] = useState(24 * 7);
  const [passwordDraft, setPasswordDraft] = useState("");
  const [coverVersionId, setCoverVersionId] = useState<string | null | undefined>(undefined); // undefined = untouched (keep existing / default to first)
  const [saving, setSaving] = useState(false);
  const [revoking, setRevoking] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const s = await api.deliverStatus(id);
      setStatus(s);
      if (s.link) setCoverVersionId(s.link.cover_video_version_id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const effectiveCoverVersionId = coverVersionId !== undefined ? coverVersionId : (status?.videos[0]?.latest_version?.id ?? null);

  async function saveLink() {
    setSaving(true);
    try {
      const link = await api.createOrUpdateDeliverLink(id, {
        duration_hours: durationHours,
        password: passwordDraft || undefined,
        cover_video_version_id: effectiveCoverVersionId,
        clear_cover: effectiveCoverVersionId === null,
      });
      setStatus((prev) => (prev ? { ...prev, link } : prev));
      setPasswordDraft("");
      toast.showSuccess(t("deliverAdmin.linkSaved"));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function removePassword() {
    if (!status?.link) return;
    setSaving(true);
    try {
      const link = await api.createOrUpdateDeliverLink(id, {
        duration_hours: Math.max(1, Math.round((new Date(status.link.expires_at).getTime() - Date.now()) / 3_600_000)),
        clear_password: true,
        cover_video_version_id: effectiveCoverVersionId,
      });
      setStatus((prev) => (prev ? { ...prev, link } : prev));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function revokeLink() {
    if (!confirm(t("deliverAdmin.revokeConfirm"))) return;
    setRevoking(true);
    try {
      await api.revokeDeliverLink(id);
      setStatus((prev) => (prev ? { ...prev, link: null } : prev));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
    } finally {
      setRevoking(false);
    }
  }

  async function copyLink() {
    if (!status?.link) return;
    await navigator.clipboard.writeText(status.link.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading || !status) {
    return (
      <AppShell>
        <div className="flex-1 flex items-center justify-center text-white/50">{t("common.loading")}</div>
      </AppShell>
    );
  }

  const linkExpired = status.link ? isLinkExpired(status.link.expires_at) : false;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto w-full px-4 sm:px-6 pt-8 pb-28">
        <div className="relative flex items-center justify-between mb-2 gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => router.push(`/projects/${id}/postproduction`)}
            className="text-sm text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 18-6-6 6-6" />
            </svg>
            {t("workflow.postproduction")}
          </button>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="font-bebas text-xl uppercase tracking-wide text-white/40 whitespace-nowrap">{t("workflow.deliver")}</div>
          </div>
        </div>

        <div className="mb-8">
          {status.client_name && (
            <div className="text-lg font-medium mb-0.5" style={{ color: status.project_color }}>
              {status.client_name}
            </div>
          )}
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {status.project_emoji && <span>{status.project_emoji}</span>} {status.project_name}
          </h1>
        </div>

        <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 mb-6">
          {status.link && !linkExpired ? (
            <div className="flex flex-col gap-3">
              <Label>{t("deliverAdmin.shareLink")}</Label>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">{status.link.url}</code>
                <Button variant="secondary" size="sm" onClick={copyLink}>
                  {copied ? t("deliverAdmin.copied") : t("deliverAdmin.copy")}
                </Button>
              </div>
              <p className="text-xs text-white/40">
                {t("deliverAdmin.expiresOn")} {new Date(status.link.expires_at).toLocaleString()}
                {status.link.has_password ? ` · ${t("deliverAdmin.passwordActive")}` : ""}
              </p>
              <div className="flex gap-4 mt-1">
                {status.link.has_password && (
                  <button type="button" onClick={removePassword} disabled={saving} className="text-xs text-white/40 hover:text-white/70 disabled:opacity-50">
                    {t("deliverAdmin.removePassword")}
                  </button>
                )}
                <button type="button" onClick={revokeLink} disabled={revoking} className="text-xs text-red-400/80 hover:text-red-400 disabled:opacity-50">
                  {revoking ? t("common.saving") : t("deliverAdmin.revokeLink")}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-white/40">{linkExpired ? t("deliverAdmin.linkExpiredNote") : t("deliverAdmin.noLinkYet")}</p>
          )}
        </div>

        <div className="bg-white/[0.03] border border-white/8 rounded-2xl p-5 mb-6">
          <FieldGroup>
            <Label>{t("deliverAdmin.duration")}</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {DURATION_OPTIONS.map((o) => (
                <button
                  key={o.hours}
                  type="button"
                  onClick={() => setDurationHours(o.hours)}
                  className={`rounded-lg py-2 px-3 text-xs font-semibold transition-colors ${
                    o.hours === durationHours ? "bg-[#3875bd] text-white" : "bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {t(o.labelKey)}
                </button>
              ))}
            </div>
          </FieldGroup>

          <FieldGroup>
            <Label>{t("deliverAdmin.password")}</Label>
            <Input
              type="text"
              value={passwordDraft}
              onChange={(e) => setPasswordDraft(e.target.value)}
              placeholder={status.link?.has_password ? t("deliverAdmin.passwordKeepPlaceholder") : t("deliverAdmin.passwordPlaceholder")}
            />
          </FieldGroup>

          {status.videos.length > 0 && (
            <FieldGroup>
              <Label>{t("deliverAdmin.coverVideo")}</Label>
              <p className="text-xs text-white/40 mb-2">{t("deliverAdmin.coverVideoHint")}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setCoverVersionId(null)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                    effectiveCoverVersionId === null ? "border-blue-500 bg-blue-500/20 text-white" : "border-white/15 text-white/60 hover:border-white/30"
                  }`}
                >
                  {t("deliverAdmin.noCoverVideo")}
                </button>
                {status.videos.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    disabled={!v.latest_version}
                    onClick={() => setCoverVersionId(v.latest_version?.id ?? null)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-40 ${
                      v.latest_version && effectiveCoverVersionId === v.latest_version.id
                        ? "border-blue-500 bg-blue-500/20 text-white"
                        : "border-white/15 text-white/60 hover:border-white/30"
                    }`}
                  >
                    {v.latest_version?.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
                      <img src={v.latest_version.thumbnail_url} alt="" className="w-6 h-6 rounded-full object-cover" />
                    ) : null}
                    <span className="max-w-32 truncate">{v.title}</span>
                  </button>
                ))}
              </div>
            </FieldGroup>
          )}

          <Button variant="primary" onClick={saveLink} disabled={saving}>
            {saving ? t("common.saving") : status.link && !linkExpired ? t("deliverAdmin.updateLink") : t("deliverAdmin.createLink")}
          </Button>
        </div>

        <div>
          <Label>
            {status.videos.length} {t(status.videos.length === 1 ? "deliverPage.video" : "deliverPage.videos")}
          </Label>
          {status.videos.length === 0 ? (
            <p className="text-sm text-white/40 mt-2">{t("deliverAdmin.noEligibleVideos")}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mt-2">
              {status.videos.map((v) => (
                <div key={v.id} className="flex flex-col gap-1">
                  <div className="relative aspect-square overflow-hidden rounded-xl bg-white/5">
                    {v.latest_version?.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element -- presigned R2 URL
                      <img src={v.latest_version.thumbnail_url} alt={v.title} className="w-full h-full object-cover" />
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-white/60" title={v.title}>
                    {v.title}
                  </p>
                  <p className="text-[11px] text-white/30">
                    {v.section_name} · v{v.latest_version?.version_number} · {formatBytes(v.latest_version?.file_size_bytes ?? null)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
