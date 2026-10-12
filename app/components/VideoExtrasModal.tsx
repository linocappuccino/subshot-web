"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { useApi } from "@/lib/useApi";
import { useLanguage } from "@/lib/i18n";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/board";
import { cn } from "@/lib/cn";
import type { VideoDeliverable, VideoExtras, VideoLicenseFile } from "@/lib/types";

// 2026-10-12, Lino: "Deliverables-Checkliste pro Video — welche Fassungen gebraucht werden
// (16:9, 9:16, 1:1, mit/ohne Untertitel, Cutdowns), abgehakt sobald hochgeladen" + "Musiklizenzen
// sollen einfach zum Video hochgeladen werden können". Opened from a video tile's menu on the
// Postproduction page; the Deliver page shows the uploaded Fassungen + licences grouped under the
// video. Files go straight to R2 (presigned PUT), the API only records them.

const PRESETS = ["16:9", "9:16", "1:1", "4:5", "Cutdown 30s", "Cutdown 15s", "Cutdown 6s", "Ohne Untertitel", "Mit Untertitel"];

const mimeOf = (f: File) =>
  f.type ||
  (/\.mov$/i.test(f.name) ? "video/quicktime" : /\.mp4$/i.test(f.name) ? "video/mp4" : /\.pdf$/i.test(f.name) ? "application/pdf" : "application/octet-stream");

export function VideoExtrasModal({
  open,
  onClose,
  videoId,
  videoTitle,
  extras,
  canEdit,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  videoId: string;
  videoTitle: string;
  extras: VideoExtras;
  canEdit: boolean;
  onChange: (next: VideoExtras) => void;
}) {
  const api = useApi();
  const toast = useToast();
  const { t } = useLanguage();
  const [custom, setCustom] = useState("");
  const [progress, setProgress] = useState<Record<string, number>>({}); // id → 0..1 while uploading
  const [editing, setEditing] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const deliverableInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string | null>(null);
  const licenseInput = useRef<HTMLInputElement>(null);
  // always work on the newest state (uploads finish asynchronously)
  const latest = useRef(extras);
  useEffect(() => {
    latest.current = extras;
  }, [extras]);
  const tmpSeq = useRef(0);
  const set = (fn: (x: VideoExtras) => VideoExtras) => {
    latest.current = fn(latest.current);
    onChange(latest.current);
  };
  const fail = (e: unknown, fallback: string) => toast.showError(e instanceof ApiError ? e.message : fallback);
  const replaceDeliverable = (d: VideoDeliverable) => set((x) => ({ ...x, deliverables: x.deliverables.map((y) => (y.id === d.id ? d : y)) }));

  const deliverables = extras.deliverables;
  const ready = deliverables.filter((d) => d.status === "ready").length;
  const existing = new Set(deliverables.map((d) => d.label.toLowerCase()));

  async function add(label: string) {
    const l = label.trim();
    if (!l) return;
    try {
      const d = await api.createDeliverable(videoId, l);
      set((x) => ({ ...x, deliverables: [...x.deliverables, d] }));
      setCustom("");
    } catch (e) {
      fail(e, t("videoExtras.failed"));
    }
  }

  async function uploadDeliverable(id: string, file: File) {
    const type = mimeOf(file);
    const before = latest.current.deliverables.find((d) => d.id === id);
    setProgress((p) => ({ ...p, [id]: 0 }));
    try {
      const { upload_url } = await api.startDeliverableUpload(id, file, type);
      set((x) => ({ ...x, deliverables: x.deliverables.map((d) => (d.id === id ? { ...d, status: "uploading", original_filename: file.name } : d)) }));
      await api.putFile(upload_url, file, type, (f) => setProgress((p) => ({ ...p, [id]: f })));
      replaceDeliverable(await api.completeDeliverableUpload(id));
    } catch (e) {
      fail(e, t("videoExtras.uploadFailed"));
      // the server drops the old file as soon as a new upload starts — after a failure the point
      // is open again (honest state), a never-uploaded point stays as it was
      if (before) replaceDeliverable(before.status === "ready" ? { ...before, status: "missing", original_filename: null, file_size_bytes: null } : before);
    } finally {
      setProgress((p) => {
        const n = { ...p };
        delete n[id];
        return n;
      });
    }
  }

  async function uploadLicenses(files: File[]) {
    for (const file of files) {
      const tmp = `lic-tmp-${++tmpSeq.current}`;
      setProgress((p) => ({ ...p, [tmp]: 0 }));
      set((x) => ({ ...x, licenses: [...x.licenses, { id: tmp, video_id: videoId, original_filename: file.name, content_type: null, file_size_bytes: file.size, status: "uploading", created_at: null }] }));
      try {
        const type = mimeOf(file);
        const { id, upload_url } = await api.startLicenseUpload(videoId, file, type);
        await api.putFile(upload_url, file, type, (f) => setProgress((p) => ({ ...p, [tmp]: f })));
        const done = await api.completeLicenseUpload(id);
        set((x) => ({ ...x, licenses: x.licenses.map((l) => (l.id === tmp ? done : l)) }));
      } catch (e) {
        set((x) => ({ ...x, licenses: x.licenses.filter((l) => l.id !== tmp) }));
        fail(e, t("videoExtras.uploadFailed"));
      } finally {
        setProgress((p) => {
          const n = { ...p };
          delete n[tmp];
          return n;
        });
      }
    }
  }

  async function download(get: () => Promise<{ url: string }>) {
    try {
      const { url } = await get();
      const a = document.createElement("a");
      a.href = url;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      fail(e, t("videoExtras.failed"));
    }
  }

  async function removeDeliverable(d: VideoDeliverable) {
    if (!window.confirm(t("videoExtras.confirmDelete", { label: d.label }))) return;
    try {
      await api.deleteDeliverable(d.id);
      set((x) => ({ ...x, deliverables: x.deliverables.filter((y) => y.id !== d.id) }));
    } catch (e) {
      fail(e, t("videoExtras.failed"));
    }
  }

  async function removeFile(d: VideoDeliverable) {
    if (!window.confirm(t("videoExtras.confirmRemoveFile", { label: d.label }))) return;
    try {
      await api.deleteDeliverableFile(d.id);
      replaceDeliverable({ ...d, status: "missing", original_filename: null, file_size_bytes: null, uploaded_at: null, content_type: null });
    } catch (e) {
      fail(e, t("videoExtras.failed"));
    }
  }

  async function saveLabel(d: VideoDeliverable) {
    setEditing(null);
    const l = editLabel.trim();
    if (!l || l === d.label) return;
    try {
      replaceDeliverable(await api.patchDeliverable(d.id, { label: l }));
    } catch (e) {
      fail(e, t("videoExtras.failed"));
    }
  }

  async function removeLicense(l: VideoLicenseFile) {
    if (!window.confirm(t("videoExtras.confirmDeleteLicense", { name: l.original_filename }))) return;
    try {
      await api.deleteLicense(l.id);
      set((x) => ({ ...x, licenses: x.licenses.filter((y) => y.id !== l.id) }));
    } catch (e) {
      fail(e, t("videoExtras.failed"));
    }
  }

  const iconBtn = "h-8 px-2.5 rounded-lg text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors whitespace-nowrap";

  return (
    <Modal open={open} onClose={onClose} title={t("videoExtras.title", { title: videoTitle })} wide>
      <div className="space-y-8">
        {/* ── Fassungen ── */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">{t("videoExtras.deliverables")}</h3>
            {deliverables.length > 0 && (
              <span className={cn("text-xs tabular-nums", ready === deliverables.length ? "text-emerald-400" : "text-white/50")}>
                {t("videoExtras.readyCount", { done: ready, total: deliverables.length })}
              </span>
            )}
          </div>
          {deliverables.length === 0 && <p className="text-sm text-white/40 mb-3">{t("videoExtras.noDeliverables")}</p>}
          <ul className="divide-y divide-white/8 rounded-xl border border-white/10 overflow-hidden">
            {deliverables.map((d) => {
              const p = progress[d.id];
              const isReady = d.status === "ready";
              return (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2.5 bg-white/[0.02]">
                  <span
                    className={cn(
                      "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border",
                      isReady ? "border-emerald-400 bg-emerald-400 text-[#161616]" : "border-white/30"
                    )}
                    aria-label={isReady ? t("videoExtras.done") : t("videoExtras.missing")}
                  >
                    {isReady && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    {editing === d.id ? (
                      <input
                        autoFocus
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onBlur={() => saveLabel(d)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveLabel(d);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="w-full rounded-md bg-white/10 px-2 py-1 text-sm text-white outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        disabled={!canEdit}
                        onClick={() => {
                          setEditing(d.id);
                          setEditLabel(d.label);
                        }}
                        className="text-sm font-medium text-white text-left truncate max-w-full enabled:hover:underline"
                        title={canEdit ? t("videoExtras.rename") : undefined}
                      >
                        {d.label}
                      </button>
                    )}
                    <div className="text-xs text-white/45 truncate">
                      {p !== undefined
                        ? `${t("videoExtras.uploading")} ${Math.round(p * 100)} %`
                        : isReady
                          ? `${d.original_filename ?? ""} · ${formatBytes(d.file_size_bytes ?? undefined)}`
                          : t("videoExtras.missing")}
                    </div>
                    {p !== undefined && (
                      <div className="mt-1 h-1 rounded-full bg-white/10 overflow-hidden">
                        <div className="h-full bg-blue-500 transition-all" style={{ width: `${Math.max(3, p * 100)}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {isReady && (
                      <button type="button" className={iconBtn} onClick={() => download(() => api.deliverableDownloadUrl(d.id))}>
                        {t("videoExtras.download")}
                      </button>
                    )}
                    {canEdit && p === undefined && (
                      <button
                        type="button"
                        className={cn(iconBtn, !isReady && "text-white bg-blue-600 hover:bg-blue-500")}
                        onClick={() => {
                          uploadTarget.current = d.id;
                          deliverableInput.current?.click();
                        }}
                      >
                        {isReady ? t("videoExtras.replace") : t("videoExtras.upload")}
                      </button>
                    )}
                    {canEdit && isReady && p === undefined && (
                      <button type="button" className={iconBtn} onClick={() => removeFile(d)} title={t("videoExtras.removeFile")}>
                        {t("videoExtras.removeFileShort")}
                      </button>
                    )}
                    {canEdit && p === undefined && (
                      <button type="button" className={cn(iconBtn, "hover:text-red-400")} onClick={() => removeDeliverable(d)} aria-label={t("videoExtras.deletePoint")} title={t("videoExtras.deletePoint")}>
                        ✕
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {canEdit && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.filter((p) => !existing.has(p.toLowerCase())).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => add(p)}
                    className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:text-white hover:border-white/40 hover:bg-white/5"
                  >
                    + {p}
                  </button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void add(custom);
                }}
              >
                <input
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  placeholder={t("videoExtras.customPlaceholder")}
                  className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                />
                <Button type="submit" size="sm" disabled={!custom.trim()}>
                  {t("videoExtras.add")}
                </Button>
              </form>
            </div>
          )}
        </section>

        {/* ── Musiklizenzen ── */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">{t("videoExtras.licenses")}</h3>
            {canEdit && (
              <Button type="button" size="sm" onClick={() => licenseInput.current?.click()}>
                {t("videoExtras.uploadLicenses")}
              </Button>
            )}
          </div>
          {extras.licenses.length === 0 ? (
            <p className="text-sm text-white/40">{t("videoExtras.noLicenses")}</p>
          ) : (
            <ul className="divide-y divide-white/8 rounded-xl border border-white/10 overflow-hidden">
              {extras.licenses.map((l) => {
                const p = progress[l.id];
                return (
                  <li key={l.id} className="flex items-center gap-3 px-3 py-2.5 bg-white/[0.02]">
                    <span className="text-lg leading-none" aria-hidden>
                      📄
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-white truncate">{l.original_filename}</div>
                      <div className="text-xs text-white/45">
                        {p !== undefined ? `${t("videoExtras.uploading")} ${Math.round(p * 100)} %` : formatBytes(l.file_size_bytes ?? undefined)}
                      </div>
                    </div>
                    {l.status === "ready" && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button type="button" className={iconBtn} onClick={() => download(() => api.licenseDownloadUrl(l.id))}>
                          {t("videoExtras.download")}
                        </button>
                        {canEdit && (
                          <button type="button" className={cn(iconBtn, "hover:text-red-400")} onClick={() => removeLicense(l)} aria-label={t("videoExtras.deletePoint")}>
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-xs text-white/35">{t("videoExtras.licensesHint")}</p>
        </section>
      </div>

      <input
        ref={deliverableInput}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file && uploadTarget.current) void uploadDeliverable(uploadTarget.current, file);
        }}
      />
      <input
        ref={licenseInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          if (files.length) void uploadLicenses(files);
        }}
      />
    </Modal>
  );
}
