"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import { useApi } from "@/lib/useApi";
import { readVideoMetadata } from "@/lib/media";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/app/components/ui/Toast";
import { ConfirmDialog } from "@/app/components/ui/ConfirmDialog";
import { Menu, MenuItem } from "@/app/components/ui/Menu";
import { IconButton } from "@/app/components/ui/Button";
import { AuthImage } from "@/app/components/AuthImage";
import type { Project } from "@/lib/types";

const ALLOWED_REFERENCE_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

type ReferenceVideoFields = Pick<
  Project,
  | "reference_video_url"
  | "reference_video_status"
  | "reference_video_original_filename"
  | "reference_video_duration_seconds"
  | "reference_video_thumbnail_url"
  | "reference_video_thumbnail_focus_x"
  | "reference_video_thumbnail_focus_y"
>;

/** 2026-09-08, Lino: "warum reloaded das video immer alle 5-10 sekunde" —
 * root cause, same as VideoReviewModal.tsx's own `resolveVideoSrc` (see its
 * doc comment): `reference_video_url`/`reference_video_thumbnail_url` are
 * presigned R2 URLs re-signed FRESH on every single API response
 * (ProjectOut's `_presign_image` field_validator), while this page polls
 * `projectDetail` every 12s (projects/[id]/page.tsx). Handing a `<video>`/
 * `<img>` a changed `src` string on every poll — even though it's still the
 * exact same underlying file — forces the browser to restart it. Pins the
 * URL by its PATH (everything before "?", stable across re-signs — only the
 * query-string signature/expiry changes) so React never sees a changed
 * `src` prop for as long as it's genuinely still the same object; only a
 * real replace/delete (different path) is let through. */
function usePinnedUrl(url: string | null | undefined): string | null {
  const ref = useRef<{ path: string; url: string } | null>(null);
  if (!url) {
    ref.current = null;
    return null;
  }
  const path = url.split("?")[0];
  if (ref.current?.path !== path) ref.current = { path, url };
  return ref.current.url;
}

/** 2026-09-08, Lino: "ganz oben in einer Shotlist soll man ein
 * Beispielvideo hochladen können, das man als Referenz abspielen lassen
 * kann" — shown above the Skript-Auswahlübersicht's Abschnitt-Kacheln
 * (projects/[id]/page.tsx). One slot per project (not per Abschnitt/
 * Section — a single reference for the whole shotlist), same presign-then-
 * complete upload flow the postproduction page's video versions already
 * use (see createReferenceVideo/completeReferenceVideo in lib/api.ts),
 * deliberately without versioning/comments/watermark — a single
 * replaceable file is enough here. */
export function ReferenceVideoBlock({
  projectId,
  project,
  onUpdate,
}: {
  projectId: string;
  project: ReferenceVideoFields;
  onUpdate: (patch: Partial<Project>) => void;
}) {
  const { t } = useLanguage();
  const toast = useToast();
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ALLOWED_REFERENCE_VIDEO_TYPES.includes(file.type)) {
      toast.showError(t("referenceVideo.unsupportedType"));
      return;
    }
    setUploadProgress(0);
    try {
      const { upload_url } = await api.createReferenceVideo(projectId, file);
      onUpdate({ reference_video_status: "uploading", reference_video_original_filename: file.name });
      await api.uploadVideoFile(upload_url, file, setUploadProgress);
      const meta = await readVideoMetadata(file);
      const updated = await api.completeReferenceVideo(projectId, meta.duration);
      onUpdate(updated);
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.uploadFailed"));
      onUpdate({ reference_video_status: null, reference_video_url: null, reference_video_original_filename: null });
    } finally {
      setUploadProgress(null);
    }
  }

  async function handleDelete() {
    setConfirmingDelete(false);
    try {
      await api.deleteReferenceVideo(projectId);
      onUpdate({
        reference_video_url: null,
        reference_video_status: null,
        reference_video_original_filename: null,
        reference_video_duration_seconds: null,
      });
    } catch (err) {
      toast.showError(err instanceof ApiError ? err.message : t("referenceVideo.deleteFailed"));
    }
  }

  const hasVideo = project.reference_video_status === "ready" && !!project.reference_video_url;
  const pinnedVideoUrl = usePinnedUrl(project.reference_video_url);
  const pinnedThumbnailUrl = usePinnedUrl(project.reference_video_thumbnail_url);
  const thumbnailObjectPosition =
    project.reference_video_thumbnail_focus_x != null && project.reference_video_thumbnail_focus_y != null
      ? `${(project.reference_video_thumbnail_focus_x * 100).toFixed(1)}% ${(project.reference_video_thumbnail_focus_y * 100).toFixed(1)}%`
      : undefined;

  return (
    <div className="mb-5">
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_REFERENCE_VIDEO_TYPES.join(",")}
        className="hidden"
        onChange={handlePick}
      />
      {uploadProgress !== null ? (
        <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-4 flex flex-col gap-2">
          <span className="text-sm font-medium text-white/70">
            {t("postproduction.uploading", { percent: Math.round(uploadProgress * 100) })}
          </span>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-[width] duration-150"
              style={{ width: `${Math.round(uploadProgress * 100)}%` }}
            />
          </div>
        </div>
      ) : hasVideo ? (
        <div className="relative w-full sm:w-72 rounded-2xl bg-black overflow-hidden border border-white/10">
          {/* 2026-09-08, Lino: "es soll ein thumbnail dargestellt werden und
           * wenn man darauf klickt, soll sich das video in einer lightbox
           * öffnen" — was a full-width inline <video controls>; now a
           * compact clickable thumbnail that opens ReferenceVideoLightbox
           * below on click. Lino, same session: "das video thumbnail soll
           * dann auch immer ein zentriertes gesicht sein" — the real
           * thumbnail (reference_video_thumbnail_url, face-priority frame +
           * detect_face_focus object-position, same AuthImage/
           * background_image_focus_x/y convention projects/page.tsx already
           * uses for folder covers) is generated by a backend background
           * task shortly after upload and arrives on this same object via
           * the page's existing 12s poll — while it's still null (the
           * ~seconds-long window right after a fresh upload), falls back to
           * a muted <video preload="metadata"> showing its own first frame,
           * same "browser renders it like an <img> poster" trick as before. */}
          <button
            type="button"
            onClick={() => setShowLightbox(true)}
            className="group relative block w-full aspect-video"
            aria-label={t("referenceVideo.play")}
          >
            {pinnedThumbnailUrl ? (
              <AuthImage
                path={pinnedThumbnailUrl}
                alt=""
                className="w-full h-full object-cover"
                objectPosition={thumbnailObjectPosition}
              />
            ) : (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- reference footage, no track available
              <video src={pinnedVideoUrl ?? undefined} muted preload="metadata" playsInline className="w-full h-full object-cover" />
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/30 transition-colors">
              <div className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#000" className="translate-x-[1px]"><path d="M8 5v14l11-7z" /></svg>
              </div>
            </div>
          </button>
          <div className="absolute top-2 right-2">
            <Menu
              trigger={
                <IconButton size={28} className="bg-black/50 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/70">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </IconButton>
              }
            >
              {(close) => (
                <>
                  <MenuItem
                    onClick={() => {
                      inputRef.current?.click();
                      close();
                    }}
                  >
                    {t("referenceVideo.replace")}
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      setConfirmingDelete(true);
                      close();
                    }}
                  >
                    {t("common.delete")}
                  </MenuItem>
                </>
              )}
            </Menu>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full flex items-center gap-2 justify-center rounded-2xl border border-dashed border-white/15 hover:border-white/30 bg-white/[0.02] hover:bg-white/[0.05] text-white/50 hover:text-white/80 py-5 transition-colors text-sm font-medium"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {t("referenceVideo.upload")}
        </button>
      )}
      <ConfirmDialog
        open={confirmingDelete}
        title={t("referenceVideo.deleteTitle")}
        message={t("referenceVideo.deleteMessage")}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
      {showLightbox && hasVideo && pinnedVideoUrl && (
        <ReferenceVideoLightbox url={pinnedVideoUrl} onClose={() => setShowLightbox(false)} />
      )}
    </div>
  );
}

/** 2026-09-08 — simple fullscreen video-only lightbox for the Scribble
 * Video thumbnail above. Deliberately NOT VideoReviewModal (comments/
 * subtitles/versions — none of that applies to a single unversioned
 * reference file) nor PublicIdeaLightbox (idea-feedback-specific) — just
 * the shared backdrop/close-button/Escape convention those two already
 * use, around a plain native <video controls autoPlay>. */
function ReferenceVideoLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useLanguage();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-xl cursor-pointer" onClick={onClose} />
      <button
        onClick={onClose}
        aria-label={t("modal.closeAria")}
        className="absolute top-5 right-5 z-20 w-10 h-10 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
      <div className="relative z-10 max-w-[92vw] max-h-[88vh]">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption -- reference footage, no track available */}
        <video src={url} controls autoPlay preload="metadata" className="max-w-[92vw] max-h-[88vh] rounded-2xl shadow-2xl shadow-black/50" />
      </div>
    </div>,
    document.body
  );
}
