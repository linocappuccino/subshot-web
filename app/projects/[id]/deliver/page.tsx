"use client";

import { useEffect, useRef, useState, use as usePromise } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
import { Button } from "@/app/components/ui/Button";
import { Input, Label, FieldGroup } from "@/app/components/ui/Field";
import { useApi } from "@/lib/useApi";
import { ApiError } from "@/lib/api";
import { useToast } from "@/app/components/ui/Toast";
import { useLanguage, type TranslationKey } from "@/lib/i18n";
import type { DeliverStatus, DeliverMiscGroup } from "@/lib/types";
import { formatVersionLabel } from "@/lib/types";

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

  // 2026-09-20 (redesigned same day), Lino: "die sonstigen dateien werden
  // jetzt als liste dargestellt! das sieht schrecklich aus!... es soll auf
  // der Deliver page als Kachel dargestellt werden die gleich gross wie
  // die Videos... man kann immer noch nicht den Namen eingeben" — one tile
  // per upload batch (DeliverMiscGroup), named via a prompt() right at
  // upload time. See DeliverMiscGroup's own doc comment in models.py.
  const [miscGroups, setMiscGroups] = useState<DeliverMiscGroup[]>([]);
  const [uploadDone, setUploadDone] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploading = uploadTotal > 0 && uploadDone < uploadTotal;

  // 2026-09-20 (follow-up), Lino: "es öffnet immer den ordner den man
  // hochladen möchte anstatt ihn für den upload hochzuladen" — the
  // previous approach set `webkitdirectory` on a persisted hidden <input>
  // via useEffect, which apparently didn't reliably stick (the native
  // picker then behaved like a plain file dialog — double-clicking a
  // folder just navigates into it, exactly the reported symptom, since
  // folders aren't selectable items at all without that attribute truly
  // being honored). Switched to creating the input FRESH on every click
  // instead, with `setAttribute("webkitdirectory", "")` (the attribute
  // form, not just the JS property) set before it's ever attached to the
  // DOM — the standard, battle-tested pattern for this exact feature,
  // sidesteps whatever timing/attribute-reflection quirk the persisted-ref
  // version hit.
  function openFolderPicker() {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.style.display = "none";
    input.addEventListener("change", () => {
      handleFolderPicked(input.files);
      document.body.removeChild(input);
    });
    document.body.appendChild(input);
    input.click();
  }

  async function load() {
    setLoading(true);
    try {
      const [s, groups] = await Promise.all([api.deliverStatus(id), api.listDeliverMiscGroups(id)]);
      setStatus(s);
      setMiscGroups(groups);
      if (s.link) setCoverVersionId(s.link.cover_video_version_id);
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.loadFailed"));
    } finally {
      setLoading(false);
    }
  }

  // Bounded concurrency (4 at once) — a folder upload can easily contain
  // dozens of files; fully sequential would be needlessly slow, fully
  // parallel risks choking a weak connection with too many simultaneous
  // PUTs at once.
  async function uploadIntoGroup(group: DeliverMiscGroup, files: File[], relativePathFor: (file: File) => string) {
    setMiscGroups((prev) => [...prev, group]);
    setUploadTotal((t) => t + files.length);
    const maxConcurrent = 4;
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < files.length) {
        const file = files[nextIndex];
        nextIndex += 1;
        try {
          const { id: fileId, upload_url } = await api.createDeliverMiscFile(group.id, {
            relative_path: relativePathFor(file),
            content_type: file.type || "application/octet-stream",
            file_size_bytes: file.size,
          });
          await fetch(upload_url, {
            method: "PUT",
            headers: { "Content-Type": file.type || "application/octet-stream" },
            body: file,
          });
          const completed = await api.completeDeliverMiscFile(fileId);
          setMiscGroups((prev) => prev.map((g) => (g.id === group.id ? { ...g, files: [...g.files, completed] } : g)));
        } catch (e) {
          toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.miscUploadFailed"));
        } finally {
          setUploadDone((d) => d + 1);
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(maxConcurrent, files.length) }, worker));
    // Reset the counters once a batch fully lands, so a later batch starts
    // its own fresh "0 von N" progress instead of accumulating forever.
    setUploadDone(0);
    setUploadTotal(0);
  }

  // 2026-09-20 — a whole picked folder becomes ONE tile (kind="folder"),
  // named via a prompt() pre-filled with the folder's own name (the first
  // file's top-level webkitRelativePath segment). The leading "<folder>/"
  // prefix is stripped from each file's relative_path since the group's
  // own display_name already covers that level.
  async function handleFolderPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    const firstRelPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath || files[0].name;
    const defaultName = firstRelPath.split("/")[0] || "Ordner";
    const name = window.prompt(t("deliverAdmin.miscGroupNamePrompt"), defaultName);
    if (!name || !name.trim()) return;
    try {
      const group = await api.createDeliverMiscGroup(id, { display_name: name.trim(), kind: "folder" });
      await uploadIntoGroup(group, files, (file) => {
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        const parts = rel.split("/");
        return parts.length > 1 ? parts.slice(1).join("/") : file.name;
      });
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.miscUploadFailed"));
    }
  }

  // 2026-09-20 — each individually-picked file becomes its OWN tile
  // (kind="file"), named one at a time via its own prompt() (cancelling
  // one just skips that file, the rest still proceed).
  async function handleFilesPicked(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    for (const file of Array.from(fileList)) {
      const defaultName = file.name.replace(/\.[^/.]+$/, "");
      const name = window.prompt(t("deliverAdmin.miscFileNamePrompt", { filename: file.name }), defaultName);
      if (!name || !name.trim()) continue;
      try {
        const group = await api.createDeliverMiscGroup(id, { display_name: name.trim(), kind: "file" });
        await uploadIntoGroup(group, [file], () => file.name);
      } catch (e) {
        toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.miscUploadFailed"));
      }
    }
  }

  async function renameMiscGroup(group: DeliverMiscGroup) {
    const name = window.prompt(t("deliverAdmin.miscGroupNamePrompt"), group.display_name);
    if (!name || !name.trim() || name.trim() === group.display_name) return;
    try {
      const updated = await api.renameDeliverMiscGroup(group.id, name.trim());
      setMiscGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
    }
  }

  async function deleteMiscGroup(group: DeliverMiscGroup) {
    if (!confirm(t("deliverAdmin.miscDeleteConfirm"))) return;
    try {
      await api.deleteDeliverMiscGroup(group.id);
      setMiscGroups((prev) => prev.filter((g) => g.id !== group.id));
    } catch (e) {
      toast.showError(e instanceof ApiError ? e.message : t("deliverAdmin.saveFailed"));
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
                    {v.section_name} · {v.latest_version ? formatVersionLabel(v.latest_version) : "–"} · {formatBytes(v.latest_version?.file_size_bytes ?? null)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-8">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
            <Label>
              {miscGroups.length} {t(miscGroups.length === 1 ? "deliverAdmin.miscFile" : "deliverAdmin.miscFiles")}
            </Label>
            <div className="flex items-center gap-2">
              {uploading && (
                <span className="text-xs text-white/40">
                  {t("deliverAdmin.uploading")} {uploadDone}/{uploadTotal}
                </span>
              )}
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {t("deliverAdmin.uploadFiles")}
              </Button>
              <Button variant="secondary" size="sm" onClick={openFolderPicker} disabled={uploading}>
                {t("deliverAdmin.uploadFolder")}
              </Button>
            </div>
          </div>
          <p className="text-xs text-white/40 mb-3">{t("deliverAdmin.miscFilesHint")}</p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFilesPicked(e.target.files);
              e.target.value = "";
            }}
          />
          {miscGroups.length === 0 ? (
            <p className="text-sm text-white/40 mt-2">{t("deliverAdmin.noMiscFiles")}</p>
          ) : (
            // 2026-09-20, Lino: "es soll auf der Deliver page als Kachel
            // dargestellt werden die gleich gross wie die Videos" — same
            // grid/tile classNames as the video grid above, one tile per
            // upload batch (folder or solo file), not per individual file.
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3 mt-2">
              {miscGroups.map((g) => {
                const isUploading = g.files.length === 0 || g.files.some((f) => f.status === "uploading");
                const totalBytes = g.files.reduce((sum, f) => sum + (f.file_size_bytes || 0), 0);
                return (
                  <div key={g.id} className="flex flex-col gap-1">
                    <div className="group relative aspect-square overflow-hidden rounded-xl bg-white/5 flex items-center justify-center">
                      <span className="text-4xl" aria-hidden>
                        {g.kind === "folder" ? "📁" : "📄"}
                      </span>
                      {isUploading && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-white/80" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => renameMiscGroup(g)}
                        aria-label={t("deliverAdmin.rename")}
                        className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-1 text-[11px] text-white/70 opacity-0 transition-opacity hover:bg-black/80 hover:text-white group-hover:opacity-100"
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteMiscGroup(g)}
                        aria-label={t("common.delete")}
                        className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-1 text-[11px] text-white/70 opacity-0 transition-opacity hover:bg-black/80 hover:text-white group-hover:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                    <p className="truncate text-xs text-white/60" title={g.display_name}>
                      {g.display_name}
                    </p>
                    <p className="text-[11px] text-white/30">
                      {g.kind === "folder" ? `${g.files.length} ${t(g.files.length === 1 ? "deliverAdmin.file" : "deliverAdmin.files")}` : formatBytes(totalBytes)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
